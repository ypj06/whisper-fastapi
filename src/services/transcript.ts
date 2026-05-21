/**
 * YouTube 字幕抓取
 *
 * 整体策略（按顺序尝试，任一步成功即返回）：
 *   1. 抓 watch 页 HTML → 解析 ytInitialPlayerResponse 拿 captionTracks
 *   2. HTML 无内嵌播放器数据 → 调 Innertube `/youtubei/v1/player`（多客户端策略）
 *   3. 仍拿不到 captionTracks → 走 Innertube `next → get_transcript`，直接拿文本
 *   4. 拿到 captionTracks 后，按 (手动 > 自动, 中文 > 英文) 选最优轨道
 *      → 请求 timedtext baseUrl（支持 xml / srv3 / json3 / vtt / ttml 多格式回退）
 *   5. 全部失败：抛 TranscriptError，由上层根据 DEMO_FALLBACK 决定是否兜底
 *
 * Cloudflare Worker 不支持给 fetch 直接配出站代理。通过 cloudflare:sockets
 * 走 webshare 的 "absolute URI" forward proxy（见 ./proxyFetch.ts）。
 * 配置了 WEBSHARE_PROXY 时优先走代理，失败自动降级为直连；
 * 直连仍失败再交给上层 DEMO_FALLBACK。
 */

import type { TranscriptCue, TranscriptResult } from "../types";
import { DEMO_TRANSCRIPT } from "./demoTranscript";
import { fetchViaProxy, parseProxyString } from "./proxyFetch";

export class TranscriptError extends Error {
  constructor(message: string, public readonly reason: "no-captions" | "blocked" | "network" | "parse") {
    super(message);
    this.name = "TranscriptError";
  }
}

interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  name?: string;
  kind?: string;
}

interface FetchOptions {
  proxy?: string;
  /** YouTube 登录态 cookie（绕开数据中心 IP 上的 "Sign in to confirm you're not a bot"） */
  cookie?: string;
}

/** 兜底 cookie：跳过 EU consent 拦截 */
const DEFAULT_COOKIE = "CONSENT=YES+1; SOCS=CAI";

const COMMON_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  Cookie: DEFAULT_COOKIE,
};

const INNERTUBE_ANDROID_VERSION = "20.10.38";
const INNERTUBE_ANDROID_UA = `com.google.android.youtube/${INNERTUBE_ANDROID_VERSION} (Linux; U; Android 14)`;

/** 把用户 cookie 与默认 consent cookie 合并；同 key 用户值覆盖默认值 */
function mergeCookie(userCookie?: string): string {
  if (!userCookie) return DEFAULT_COOKIE;
  const userKeys = new Set(
    userCookie.split(";").map((c) => c.trim().split("=")[0]).filter(Boolean)
  );
  const defaults = DEFAULT_COOKIE.split(";")
    .map((c) => c.trim())
    .filter((c) => {
      const key = c.split("=")[0];
      return key && !userKeys.has(key);
    });
  return [userCookie.trim(), ...defaults].filter(Boolean).join("; ");
}

/**
 * 统一的 HTTP 客户端：有代理配置时优先走代理，失败降级为直连。
 * 支持 GET / POST；调用方可在 opts.headers 里覆盖 Cookie / UA 等头。
 */
async function smartRequest(
  url: string,
  opts: FetchOptions & { method?: "GET" | "POST"; body?: string; headers?: Record<string, string> } = {}
): Promise<Response> {
  const headers = { ...COMMON_HEADERS, ...opts.headers };
  if (!opts.headers || !("Cookie" in opts.headers || "cookie" in opts.headers)) {
    headers.Cookie = mergeCookie(opts.cookie);
  }
  const proxyCfg = parseProxyString(opts.proxy);
  if (proxyCfg && url.startsWith("https://")) {
    try {
      return await fetchViaProxy(url, proxyCfg, {
        headers,
        method: opts.method,
        body: opts.body,
        timeoutMs: 20_000,
      });
    } catch (e) {
      console.warn("[transcript] proxy request failed, fallback to direct:", (e as Error).message);
    }
  }
  return fetch(url, { method: opts.method ?? "GET", headers, body: opts.body });
}

/** 直连 fetch（跳过代理），用于代理 IP 被 timedtext 限流时兜底 */
async function directRequest(url: string, opts: FetchOptions, headers: Record<string, string>): Promise<Response> {
  const h = { ...headers };
  if (!("Cookie" in h)) h.Cookie = mergeCookie(opts.cookie);
  return fetch(url, { headers: h });
}

/* ----------------------------- HTML 解析 ----------------------------- */

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/\n/g, " ");
}

/**
 * 从 HTML 里按变量名提取 JSON 对象。
 * 用括号配对而不是非贪婪正则，避免大 JSON 被截断（ytInitialPlayerResponse 经常 >100KB）。
 */
function extractJsonVariable(html: string, varName: string): unknown | null {
  const marker = `${varName} =`;
  const idx = html.indexOf(marker);
  if (idx < 0) return null;
  const start = html.indexOf("{", idx + marker.length);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

function tracksFromPlayerJson(json: unknown): CaptionTrack[] {
  const list = (json as { captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: unknown[] } } })
    ?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!Array.isArray(list)) return [];
  const out: CaptionTrack[] = [];
  for (const t of list) {
    const row = t as { baseUrl?: string; languageCode?: string; name?: { simpleText?: string }; kind?: string };
    if (row?.baseUrl && row?.languageCode) {
      out.push({
        baseUrl: row.baseUrl,
        languageCode: row.languageCode,
        name: row.name?.simpleText,
        kind: row.kind,
      });
    }
  }
  return out;
}

function extractFromWatchPage(html: string): { tracks: CaptionTrack[]; title?: string; author?: string } {
  const player = extractJsonVariable(html, "ytInitialPlayerResponse");
  if (player && typeof player === "object") {
    const tracks = tracksFromPlayerJson(player);
    const vd = (player as { videoDetails?: { title?: string; author?: string } }).videoDetails;
    return { tracks, title: vd?.title, author: vd?.author };
  }
  // 部分页面只有 ytInitialData，捞 captionTracks 数组
  const initial = extractJsonVariable(html, "ytInitialData");
  if (initial) {
    const blob = JSON.stringify(initial);
    const m = /"captionTracks":(\[[\s\S]*?\])\s*,\s*"/.exec(blob);
    if (m?.[1]) {
      try {
        const list = JSON.parse(m[1]) as Array<{ baseUrl?: string; languageCode?: string; kind?: string }>;
        const tracks = list
          .filter((t) => t.baseUrl && t.languageCode)
          .map((t) => ({
            baseUrl: t.baseUrl as string,
            languageCode: t.languageCode as string,
            kind: t.kind,
          }));
        if (tracks.length > 0) return { tracks };
      } catch { /* ignore */ }
    }
  }
  return { tracks: [] };
}

/** 全文搜索 "captionTracks":[...] 做最后兜底（当 ytInitialPlayerResponse 缺失时） */
function scrapeCaptionTracksFromHtml(html: string): CaptionTrack[] {
  const marker = '"captionTracks":';
  const idx = html.indexOf(marker);
  if (idx < 0) return [];
  const start = html.indexOf("[", idx + marker.length);
  if (start < 0) return [];

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        try {
          const list = JSON.parse(html.slice(start, i + 1)) as Array<{
            baseUrl?: string;
            languageCode?: string;
            kind?: string;
            name?: { simpleText?: string };
          }>;
          return list
            .filter((t) => t.baseUrl && t.languageCode)
            .map((t) => ({
              baseUrl: t.baseUrl as string,
              languageCode: t.languageCode as string,
              kind: t.kind,
              name: t.name?.simpleText,
            }));
        } catch { return []; }
      }
    }
  }
  return [];
}

function extractInnertubeApiKey(html: string): string | null {
  const patterns = [
    /"INNERTUBE_API_KEY":"([^"]+)"/,
    /INNERTUBE_API_KEY":"([^"]+)"/,
    /innertubeApiKey":"([^"]+)"/,
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m?.[1]) return m[1];
  }
  return null;
}

/* ----------------------------- Innertube ----------------------------- */

interface InnertubeAttempt {
  data: unknown | null;
  status: number;
  label: string;
}

function playabilityHint(data: unknown): string | undefined {
  const err = (data as { error?: { message?: string; status?: string; code?: number } })?.error;
  if (err?.message) {
    return `ERROR${err.code ? ` ${err.code}` : ""}${err.status ? ` ${err.status}` : ""}: ${err.message}`;
  }
  const ps = (data as { playabilityStatus?: { status?: string; reason?: string } })?.playabilityStatus;
  if (!ps?.status) return undefined;
  return `${ps.status}${ps.reason ? `: ${ps.reason}` : ""}`;
}

/** Innertube POST。direct=true 时跳过代理直连，用于代理 IP 被 youtubei 限流的场景 */
async function innertubePost(
  endpoint: string,
  payload: Record<string, unknown>,
  opts: FetchOptions,
  reqHeaders: Record<string, string>,
  apiKey?: string,
  direct = false
): Promise<InnertubeAttempt> {
  const q = apiKey ? `?key=${encodeURIComponent(apiKey)}&prettyPrint=false` : "?prettyPrint=false";
  const url = `https://www.youtube.com/youtubei/v1/${endpoint}${q}`;
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = { "Content-Type": "application/json", ...reqHeaders };
  const res = direct
    ? await fetch(url, {
        method: "POST",
        headers: { ...headers, Cookie: headers.Cookie ?? mergeCookie(opts.cookie) },
        body,
      })
    : await smartRequest(url, { ...opts, method: "POST", body, headers });
  const text = await res.text();
  let data: unknown | null = null;
  try { data = JSON.parse(text); } catch {
    return { data: null, status: res.status, label: endpoint };
  }
  // playabilityHint 仅在日志里有用
  void playabilityHint(data);
  return { data, status: res.status, label: endpoint };
}

/**
 * 多策略拉 Innertube player：
 *   1) ANDROID 客户端 + Android UA（不带 key）——最常见成功路径
 *   2) ANDROID 客户端 + Android UA + 页面 key
 *   3) WEB 客户端 + 桌面 UA + Origin/Referer（配 YT_COOKIE 时可绕 LOGIN_REQUIRED）
 */
async function fetchInnertubePlayerMulti(
  videoId: string,
  apiKey: string | null,
  opts: FetchOptions
): Promise<unknown | null> {
  const androidCtx = {
    context: { client: { clientName: "ANDROID", clientVersion: INNERTUBE_ANDROID_VERSION } },
    videoId,
  };

  const a1 = await innertubePost("player", androidCtx, opts, { "User-Agent": INNERTUBE_ANDROID_UA });
  if (a1.data && tracksFromPlayerJson(a1.data).length > 0) return a1.data;

  if (apiKey) {
    const a2 = await innertubePost("player", androidCtx, opts, { "User-Agent": INNERTUBE_ANDROID_UA }, apiKey);
    if (a2.data && tracksFromPlayerJson(a2.data).length > 0) return a2.data;
  }

  const webCtx = {
    context: {
      client: { clientName: "WEB", clientVersion: "2.20240401.00.00", hl: "en", gl: "US" },
    },
    videoId,
  };
  const a3 = await innertubePost(
    "player",
    webCtx,
    opts,
    {
      ...COMMON_HEADERS,
      Origin: "https://www.youtube.com",
      Referer: `https://www.youtube.com/watch?v=${videoId}`,
      "X-Youtube-Client-Name": "1",
      "X-Youtube-Client-Version": "2.20240401.00.00",
    },
    apiKey ?? undefined
  );
  if (a3.data && tracksFromPlayerJson(a3.data).length > 0) return a3.data;

  return a1.data ?? a3.data ?? null;
}

function extractTranscriptParamsFromHtml(html: string): string | null {
  const findParams = (node: unknown): string | null => {
    if (!node || typeof node !== "object") return null;
    const obj = node as Record<string, unknown>;
    const endpoint = obj.getTranscriptEndpoint as { params?: unknown } | undefined;
    if (endpoint && typeof endpoint.params === "string") return endpoint.params;
    for (const value of Object.values(obj)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          const found = findParams(item);
          if (found) return found;
        }
      } else if (value && typeof value === "object") {
        const found = findParams(value);
        if (found) return found;
      }
    }
    return null;
  };
  const initial = extractJsonVariable(html, "ytInitialData");
  const parsed = findParams(initial);
  if (parsed) return parsed;

  const decodeParam = (raw: string): string => {
    try { return JSON.parse(`"${raw.replace(/"/g, '\\"')}"`) as string; }
    catch { return raw; }
  };
  const m = /"getTranscriptEndpoint"\s*:\s*\{\s*"params"\s*:\s*"([^"]+)"/.exec(html);
  if (m?.[1]) return decodeParam(m[1]);
  const m2 = /getTranscriptEndpoint.*?params.*?"([A-Za-z0-9_-]{20,})"/s.exec(html);
  return m2?.[1] ? decodeParam(m2[1]) : null;
}

function extractTranscriptParamsFromNext(nextData: unknown): string | null {
  const panels = (nextData as { engagementPanels?: unknown[] })?.engagementPanels;
  if (!Array.isArray(panels)) return null;
  for (const p of panels) {
    const r = (p as { engagementPanelSectionListRenderer?: Record<string, unknown> })
      ?.engagementPanelSectionListRenderer;
    if (r?.panelIdentifier !== "engagement-panel-searchable-transcript") continue;
    const params = (
      r?.content as { continuationItemRenderer?: { continuationEndpoint?: { getTranscriptEndpoint?: { params?: string } } } }
    )?.continuationItemRenderer?.continuationEndpoint?.getTranscriptEndpoint?.params;
    if (typeof params === "string") return params;
  }
  return null;
}

/** 从 get_transcript 响应递归解析 cues（YouTube 偶尔会调整层级） */
function cuesFromGetTranscript(data: unknown): TranscriptCue[] {
  const cues: TranscriptCue[] = [];
  const pushSegment = (renderer: Record<string, unknown>) => {
    const startText = (renderer.startTimeText as { simpleText?: string })?.simpleText ?? "0:00";
    const snippet = (
      (renderer.snippet as { runs?: Array<{ text?: string }> })?.runs?.map((r) => r.text ?? "").join("") ?? ""
    ).trim();
    if (!snippet) return;
    const startMs = typeof renderer.startMs === "string" ? parseInt(renderer.startMs, 10) : NaN;
    const endMs = typeof renderer.endMs === "string" ? parseInt(renderer.endMs, 10) : NaN;
    if (Number.isFinite(startMs)) {
      cues.push({
        start: startMs / 1000,
        duration: Number.isFinite(endMs) ? Math.max(0, (endMs - startMs) / 1000) : 0,
        text: snippet,
      });
      return;
    }
    const parts = startText.split(":").map(Number);
    const start =
      parts.length === 3 ? parts[0]! * 3600 + parts[1]! * 60 + parts[2]!
      : parts.length === 2 ? parts[0]! * 60 + parts[1]!
      : Number(parts[0]) || 0;
    cues.push({ start, duration: 0, text: snippet });
  };

  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    const renderer = obj.transcriptSegmentRenderer;
    if (renderer && typeof renderer === "object") {
      pushSegment(renderer as Record<string, unknown>);
    }
    for (const value of Object.values(obj)) {
      if (Array.isArray(value)) for (const item of value) visit(item);
      else if (value && typeof value === "object") visit(value);
    }
  };
  visit(data);
  return cues;
}

/** 用页面里已有的 params 调 get_transcript（先直连后代理：timedtext 代理常被 429，直连更稳） */
async function fetchGetTranscriptByParams(
  params: string,
  videoId: string,
  apiKey: string | null,
  opts: FetchOptions
): Promise<TranscriptCue[]> {
  const webHeaders = {
    ...timedTextHeaders(videoId),
    "X-Youtube-Client-Name": "1",
    "X-Youtube-Client-Version": "2.20240401.00.00",
  };
  const payload = {
    params,
    context: { client: { clientName: "WEB", clientVersion: "2.20240401.00.00", hl: "en", gl: "US" } },
  };

  const direct = await innertubePost("get_transcript", payload, opts, webHeaders, apiKey ?? undefined, true);
  const directCues = direct.data ? cuesFromGetTranscript(direct.data) : [];
  if (directCues.length > 0) return directCues;
  if (direct.status !== 400) return directCues;

  const proxied = await innertubePost("get_transcript", payload, opts, webHeaders, apiKey ?? undefined);
  return proxied.data ? cuesFromGetTranscript(proxied.data) : [];
}

/** Innertube `next → get_transcript`：不依赖 captionTracks 直接取文本 */
async function fetchViaInnertubeTranscript(
  videoId: string,
  apiKey: string | null,
  opts: FetchOptions
): Promise<TranscriptCue[]> {
  const webCtx = {
    context: { client: { clientName: "WEB", clientVersion: "2.20240401.00.00", hl: "en", gl: "US" } },
    videoId,
  };
  const webHeaders = {
    ...COMMON_HEADERS,
    Origin: "https://www.youtube.com",
    Referer: `https://www.youtube.com/watch?v=${videoId}`,
    "X-Youtube-Client-Name": "1",
    "X-Youtube-Client-Version": "2.20240401.00.00",
  };
  const next = await innertubePost("next", webCtx, opts, webHeaders, apiKey ?? undefined);
  const params = next.data ? extractTranscriptParamsFromNext(next.data) : null;
  if (!params) return [];

  const tr = await innertubePost(
    "get_transcript",
    { params, context: webCtx.context },
    opts,
    webHeaders,
    apiKey ?? undefined
  );
  return tr.data ? cuesFromGetTranscript(tr.data) : [];
}

/* ----------------------------- timedtext ----------------------------- */

function resolveTimedTextUrl(baseUrl: string): string {
  if (baseUrl.startsWith("http://") || baseUrl.startsWith("https://")) return baseUrl;
  if (baseUrl.startsWith("//")) return `https:${baseUrl}`;
  if (baseUrl.startsWith("/")) return `https://www.youtube.com${baseUrl}`;
  return `https://www.youtube.com/${baseUrl}`;
}

/** timedtext 请求头：与 watch 页一致（桌面 UA + Referer + Origin），勿用 Android UA */
function timedTextHeaders(videoId: string): Record<string, string> {
  return {
    ...COMMON_HEADERS,
    Referer: `https://www.youtube.com/watch?v=${videoId}`,
    Origin: "https://www.youtube.com",
  };
}

/**
 * 拉取 timedtext 字幕。
 * baseUrl 自带签名，原样请求最稳；遇到 429 / 空 body 时换 fmt 或换直连兜底。
 */
async function fetchTimedTextPayload(
  baseUrl: string,
  videoId: string,
  opts: FetchOptions
): Promise<{ payload: string; status: number }> {
  const url0 = resolveTimedTextUrl(baseUrl);
  const headers = timedTextHeaders(videoId);

  const attempts: Array<{ url: string; direct: boolean }> = [
    { url: url0, direct: false },
    { url: url0, direct: true },
  ];
  if (!url0.includes("fmt=")) {
    const sep = url0.includes("?") ? "&" : "?";
    for (const fmt of ["srv3", "vtt", "json3", "ttml"]) {
      attempts.push({ url: `${url0}${sep}fmt=${fmt}`, direct: false });
      attempts.push({ url: `${url0}${sep}fmt=${fmt}`, direct: true });
    }
  }
  // 最小 timedtext URL：部分 ASR 轨道签名参数偶尔失效，但 lang+fmt 仍可返回
  const minimal = `https://www.youtube.com/api/timedtext?v=${encodeURIComponent(videoId)}&lang=en&fmt=json3`;
  attempts.push({ url: minimal, direct: false }, { url: minimal, direct: true });

  let lastStatus = 0;
  let lastBody = "";
  for (const a of attempts) {
    const res = a.direct
      ? await directRequest(a.url, opts, headers)
      : await smartRequest(a.url, { ...opts, headers });
    lastStatus = res.status;
    lastBody = await res.text();
    if (res.ok && lastBody.length > 0 && !lastBody.includes("Sorry...") && parseTimedTextPayload(lastBody).length > 0) {
      return { payload: lastBody, status: res.status };
    }
  }
  return { payload: lastBody, status: lastStatus };
}

/* ----------------------------- timedtext 多格式解析 ----------------------------- */

function parseTimedTextJson3(raw: string): TranscriptCue[] {
  try {
    const data = JSON.parse(raw) as {
      events?: Array<{ tStartMs?: number; dDurationMs?: number; segs?: Array<{ utf8?: string }> }>;
    };
    const cues: TranscriptCue[] = [];
    for (const ev of data.events ?? []) {
      const text = (ev.segs ?? []).map((s) => s.utf8 ?? "").join("").trim();
      if (!text || text === "\n") continue;
      cues.push({
        start: (ev.tStartMs ?? 0) / 1000,
        duration: (ev.dDurationMs ?? 0) / 1000,
        text,
      });
    }
    return cues;
  } catch { return []; }
}

function parseTimedTextSrv3(xml: string): TranscriptCue[] {
  const cues: TranscriptCue[] = [];
  const re = /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const start = parseInt(m[1] as string, 10) / 1000;
    const dur = parseInt(m[2] as string, 10) / 1000;
    const inner = m[3] ?? "";
    let text = "";
    const sRe = /<s[^>]*>([^<]*)<\/s>/g;
    let s: RegExpExecArray | null;
    while ((s = sRe.exec(inner)) !== null) text += s[1] ?? "";
    if (!text) text = inner.replace(/<[^>]+>/g, "");
    text = decodeHtmlEntities(text).trim();
    if (text) cues.push({ start, duration: dur, text });
  }
  return cues;
}

function parseTimedTextVtt(raw: string): TranscriptCue[] {
  if (!raw.includes("WEBVTT")) return [];
  const cues: TranscriptCue[] = [];
  const blocks = raw.split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 2) continue;
    const timeLine = lines.find((l) => l.includes("-->"));
    if (!timeLine) continue;
    const [startStr, endStr] = timeLine.split("-->").map((s) => s.trim());
    const text = lines
      .filter((l) => !l.includes("-->") && !/^\d+$/.test(l.trim()))
      .join(" ")
      .trim();
    if (!text) continue;
    const parseTs = (s: string) => {
      const p = s.split(":").map(parseFloat);
      if (p.length === 3) return p[0]! * 3600 + p[1]! * 60 + p[2]!;
      if (p.length === 2) return p[0]! * 60 + p[1]!;
      return 0;
    };
    const start = parseTs(startStr ?? "0");
    const end = parseTs(endStr ?? "0");
    cues.push({ start, duration: Math.max(0, end - start), text });
  }
  return cues;
}

function parseTimedTextXml(xml: string): TranscriptCue[] {
  const cues: TranscriptCue[] = [];
  const re = /<text\s+([^>]*)>([\s\S]*?)<\/text>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const attrs = m[1] ?? "";
    const raw = m[2] ?? "";
    const startMatch = /start="([\d.]+)"/.exec(attrs);
    const durMatch = /dur="([\d.]+)"/.exec(attrs);
    const start = startMatch ? parseFloat(startMatch[1] as string) : 0;
    const dur = durMatch ? parseFloat(durMatch[1] as string) : 0;
    const text = decodeHtmlEntities(raw).replace(/<[^>]+>/g, "").trim();
    if (text) cues.push({ start, duration: dur, text });
  }
  return cues;
}

function parseTimedTextPayload(raw: string): TranscriptCue[] {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    const json3 = parseTimedTextJson3(trimmed);
    if (json3.length > 0) return json3;
  }
  const srv3 = parseTimedTextSrv3(trimmed);
  if (srv3.length > 0) return srv3;
  const vtt = parseTimedTextVtt(trimmed);
  if (vtt.length > 0) return vtt;
  return parseTimedTextXml(trimmed);
}

/* ----------------------------- 主流程 ----------------------------- */

/** consent / captcha / 精简页：没有 player JSON 也没有 captionTracks */
function isLikelyBlockedPage(html: string): boolean {
  if (html.includes("ytInitialPlayerResponse") || html.includes("captionTracks")) return false;
  if (/consent\.youtube|recaptcha|unusual traffic|Before you continue/i.test(html)) return true;
  if (html.length < 80_000) return true;
  return false;
}

/** 选择最合适的字幕轨道：手动 > 自动；中文 > 英文 > 其他 */
function pickBestTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  if (tracks.length === 0) return null;
  const score = (t: CaptionTrack) => {
    let s = 0;
    if (t.kind !== "asr") s += 100;
    if (/^zh/i.test(t.languageCode)) s += 50;
    else if (/^en/i.test(t.languageCode)) s += 30;
    return s;
  };
  return [...tracks].sort((a, b) => score(b) - score(a))[0] ?? null;
}

/** 依次尝试多个页面 URL，返回第一个解析出字幕轨道的 HTML */
async function fetchWatchHtmlWithTracks(
  videoId: string,
  opts: FetchOptions
): Promise<{ html: string; tracks: CaptionTrack[]; title?: string; author?: string }> {
  const candidates = [
    `https://www.youtube.com/watch?v=${videoId}&hl=en&persist_hl=1`,
    `https://www.youtube.com/embed/${videoId}?hl=en`,
  ];
  let lastHtml = "";
  for (const url of candidates) {
    const res = await smartRequest(url, opts);
    if (!res.ok) continue;
    const html = await res.text();
    lastHtml = html;
    const parsed = extractFromWatchPage(html);
    if (parsed.tracks.length > 0) return { html, ...parsed };
  }
  return { html: lastHtml, tracks: [] };
}

/** 汇总字幕轨道：HTML 内嵌 → HTML 全文搜索 → Innertube player → Innertube get_transcript */
async function resolveCaptionTracks(
  videoId: string,
  html: string,
  opts: FetchOptions
): Promise<{
  tracks: CaptionTrack[];
  title?: string;
  author?: string;
  /** 若 get_transcript 直接拿到了文本，这里返回 cues，主流程跳过 timedtext */
  directCues?: TranscriptCue[];
}> {
  const fromPage = extractFromWatchPage(html);
  if (fromPage.tracks.length > 0) return fromPage;

  const scraped = scrapeCaptionTracksFromHtml(html);
  if (scraped.length > 0) return { tracks: scraped };

  const apiKey = extractInnertubeApiKey(html);
  const player = await fetchInnertubePlayerMulti(videoId, apiKey, opts);
  if (player) {
    const tracks = tracksFromPlayerJson(player);
    const vd = (player as { videoDetails?: { title?: string; author?: string } }).videoDetails;
    if (tracks.length > 0) return { tracks, title: vd?.title, author: vd?.author };
  }

  const directCues = await fetchViaInnertubeTranscript(videoId, apiKey, opts);
  if (directCues.length > 0) return { tracks: [], directCues };

  return { tracks: [] };
}

/** 按 track.baseUrl 拉 cues；timedtext 全军覆没时退到 get_transcript */
async function fetchCuesForTrack(
  videoId: string,
  track: CaptionTrack,
  watchHtml: string,
  opts: FetchOptions
): Promise<TranscriptCue[]> {
  const tt = await fetchTimedTextPayload(track.baseUrl, videoId, opts);
  const cues = parseTimedTextPayload(tt.payload);
  if (cues.length > 0) return cues;

  const apiKey = extractInnertubeApiKey(watchHtml);
  const params = extractTranscriptParamsFromHtml(watchHtml);
  if (params) {
    const fromParams = await fetchGetTranscriptByParams(params, videoId, apiKey, opts);
    if (fromParams.length > 0) return fromParams;
  }

  const fromNext = await fetchViaInnertubeTranscript(videoId, apiKey, opts);
  if (fromNext.length > 0) return fromNext;

  throw new TranscriptError(
    `字幕下载失败：timedtext ${tt.status}，bytes=${tt.payload.length}`,
    tt.status === 429 ? "blocked" : "parse"
  );
}

/** 主入口：根据 videoId 抓取字幕 */
export async function fetchTranscript(videoId: string, opts: FetchOptions = {}): Promise<TranscriptResult> {
  let watchHtml: string;
  let title: string | undefined;
  let author: string | undefined;
  let tracks: CaptionTrack[];
  let directCues: TranscriptCue[] | undefined;

  try {
    const got = await fetchWatchHtmlWithTracks(videoId, opts);
    watchHtml = got.html;
    title = got.title;
    author = got.author;
    const resolved = await resolveCaptionTracks(videoId, got.html, opts);
    tracks = resolved.tracks;
    title = title ?? resolved.title;
    author = author ?? resolved.author;
    directCues = resolved.directCues;
  } catch (e) {
    if (e instanceof TranscriptError) throw e;
    throw new TranscriptError(`抓取 watch 页失败：${(e as Error).message}`, "network");
  }

  if (isLikelyBlockedPage(watchHtml)) {
    throw new TranscriptError("YouTube 返回了 consent / 验证码 / 精简页（无播放器数据）", "blocked");
  }

  let cues: TranscriptCue[];
  let language = "en";

  if (directCues && directCues.length > 0) {
    cues = directCues;
  } else {
    const track = pickBestTrack(tracks);
    if (!track) {
      throw new TranscriptError("视频没有可用字幕（Innertube player / get_transcript 均无数据）", "no-captions");
    }
    language = track.languageCode;
    cues = await fetchCuesForTrack(videoId, track, watchHtml, opts);
  }

  const fullText = cues.map((c) => c.text).join(" ").replace(/\s+/g, " ").trim();
  return {
    source: "youtube",
    videoId,
    title,
    author,
    language,
    cues,
    fullText,
  };
}

/** 拿不到真实字幕时的兜底（演示用） */
export function getDemoTranscript(videoId?: string): TranscriptResult {
  return {
    source: "demo",
    videoId: videoId ?? DEMO_TRANSCRIPT.videoId,
    title: DEMO_TRANSCRIPT.title,
    author: DEMO_TRANSCRIPT.author,
    language: DEMO_TRANSCRIPT.language,
    cues: DEMO_TRANSCRIPT.cues,
    fullText: DEMO_TRANSCRIPT.cues.map((c) => c.text).join(" "),
  };
}
