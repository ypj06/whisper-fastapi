/**
 * Gemini API 封装
 *
 * 文档：https://ai.google.dev/gemini-api/docs/text-generation
 *  - streamGenerateContent: SSE 风格的流式输出（alt=sse）
 *  - generateContent: 单次返回
 *
 * 这里我们只依赖 fetch + ReadableStream，Worker 原生可用。
 */

import type { FiveW1H, GenerationPreferences, TranscriptResult } from "../types";

const DEFAULT_MODEL = "gemini-2.5-flash";
/** Gemini 请求超时（毫秒）。避免 Worker 在 fetch 挂起时只发出 meta、永远没有 token。 */
const GEMINI_FETCH_TIMEOUT_MS = 90_000;
const ARTICLE_MAX_OUTPUT_TOKENS = 16_384;

interface GeminiPart {
  text?: string;
  thought?: boolean; // 2.5 系列在 thinking 时，parts 里会有 thought:true 的占位
}
interface GeminiContent {
  role?: "user" | "model";
  parts: GeminiPart[];
}
interface GeminiSafetyRating {
  category?: string;
  probability?: string;
  blocked?: boolean;
}
interface GeminiStreamChunk {
  candidates?: {
    content?: GeminiContent;
    finishReason?: string;
    safetyRatings?: GeminiSafetyRating[];
  }[];
  promptFeedback?: { blockReason?: string; safetyRatings?: GeminiSafetyRating[] };
}

/** Gemini 2.x 兼容的最宽松 safety 配置：把分类全部 BLOCK_NONE。
 *  说明：本应用输入是用户提供的视频字幕，输出是中文长文，没有 NSFW / 高危场景需求；
 *  默认 safety 在长字幕上偶尔会误判把 candidate 直接关掉，导致流式响应为空。 */
const RELAXED_SAFETY = [
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_NONE" },
];

export interface GeminiConfig {
  apiKey: string;
  model?: string;
  /**
   * 可选：Cloudflare AI Gateway 的 google-ai-studio 基址。
   * 形如 https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/google-ai-studio
   * 配置后，所有请求经 AI Gateway 转发，可绕过部分 Gemini 区域限制（如 "User location is not supported"）。
   */
  baseUrl?: string;
  /**
   * 可选：AI Gateway 开启了 "Authenticated Gateway" 时所需的 token，
   * 会通过 cf-aig-authorization: Bearer <token> 头携带。
   */
  gatewayToken?: string;
}

/**
 * 校验 Cloudflare AI Gateway base URL 的形态。
 * 合法形如：https://gateway.ai.cloudflare.com/v1/<accountTag>/<gatewayId>/google-ai-studio
 * 不合法直接抛错，避免被 AI Gateway 反馈一个二级 "Invalid request path"。
 */
function validateAigBaseUrl(raw: string): string {
  const base = raw.trim().replace(/\/+$/, "");
  const re = /^https?:\/\/[^/]+\/v1\/[^/<>\s]+\/[^/<>\s]+\/google-ai-studio$/;
  if (!re.test(base)) {
    let hint = "";
    if (/<.*?>/.test(base)) hint = "URL 里仍有 <gateway-name> 这样的占位符未替换；";
    else if (!/\/google-ai-studio$/.test(base)) hint = "URL 末尾必须是 /google-ai-studio；";
    else if (!/\/v1\//.test(base)) hint = "URL 必须包含 /v1/<account>/<gateway>/ 这一段；";
    throw new Error(
      `CF_AIG_URL 不合法：${hint}应形如 https://gateway.ai.cloudflare.com/v1/<accountTag>/<gatewayId>/google-ai-studio，但实际是「${base}」`
    );
  }
  return base;
}

/** 解析最终上游 URL。AI Gateway 透传 Google REST 路径，因此后缀与原生一致。 */
export function resolveEndpoint(
  cfg: GeminiConfig,
  model: string,
  op: "streamGenerateContent" | "generateContent"
): { url: string; headers: Record<string, string>; viaGateway: boolean } {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const suffix = `models/${encodeURIComponent(model)}:${op}${op === "streamGenerateContent" ? "?alt=sse" : ""}`;
  if (cfg.baseUrl) {
    const base = validateAigBaseUrl(cfg.baseUrl);
    // AI Gateway 推荐用 x-goog-api-key 而不是 query string，避免 key 写进 gateway 日志
    headers["x-goog-api-key"] = cfg.apiKey;
    if (cfg.gatewayToken) headers["cf-aig-authorization"] = `Bearer ${cfg.gatewayToken}`;
    return { url: `${base}/v1beta/${suffix}`, headers, viaGateway: true };
  }
  const sep = suffix.includes("?") ? "&" : "?";
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/${suffix}${sep}key=${encodeURIComponent(cfg.apiKey)}`,
    headers,
    viaGateway: false,
  };
}

/** 调用 Gemini 流式接口，返回纯文本增量（已剥离 SSE 协议） */
export async function* streamGenerate(
  cfg: GeminiConfig,
  prompt: string,
  systemInstruction?: string,
  options: { temperature?: number; jsonMode?: boolean } = {}
): AsyncGenerator<string, void, unknown> {
  const model = cfg.model || DEFAULT_MODEL;
  const { url, headers } = resolveEndpoint(cfg, model, "streamGenerateContent");

  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: options.temperature ?? 0.7,
      // 让模型可以一口气写完一篇长文，避免 token 早早耗尽
      maxOutputTokens: ARTICLE_MAX_OUTPUT_TOKENS,
      // gemini-2.5-flash 是"思考"模型，默认会先在 thinking 阶段占用大量 token，
      // 表现就是流式半天不出 text；显式禁用 thinking，让它直接进入回答阶段。
      thinkingConfig: { thinkingBudget: 0 },
      ...(options.jsonMode ? { responseMimeType: "application/json" } : {}),
    },
    safetySettings: RELAXED_SAFETY,
  };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(GEMINI_FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    const err = e as Error;
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      throw new Error(
        `Gemini 请求超时（${GEMINI_FETCH_TIMEOUT_MS / 1000}s），请检查 API Key、模型名（当前 ${model}）及到 Google API 的网络`
      );
    }
    throw new Error(`Gemini 网络错误：${err.message}`);
  }

  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Gemini stream failed: ${res.status} ${txt.slice(0, 500)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let rawSeen = ""; // 留前 2KB 用于诊断
  let yielded = 0;
  let lastFinishReason: string | undefined;
  let lastBlockReason: string | undefined;
  let lastSafetyRatings: GeminiSafetyRating[] | undefined;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    // 规范化换行：Google 原生用 \n\n 分隔事件，但走 Cloudflare AI Gateway 转发后
    // 上游会变成 \r\n\r\n（CRLF）；这里统一成 \n，下面的解析无需关心来源差异。
    buffer += chunk.replace(/\r\n/g, "\n");
    if (rawSeen.length < 2048) rawSeen += chunk;

    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const event = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);

      for (const line of event.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload) as GeminiStreamChunk;
          const cand = json.candidates?.[0];
          if (cand?.finishReason) lastFinishReason = cand.finishReason;
          if (cand?.safetyRatings) lastSafetyRatings = cand.safetyRatings;
          if (json.promptFeedback?.blockReason) lastBlockReason = json.promptFeedback.blockReason;
          const parts = cand?.content?.parts ?? [];
          for (const p of parts) {
            if (p.thought) continue; // thought 占位（已禁用 thinking 后正常不会出现，保险）
            if (typeof p.text === "string" && p.text.length > 0) {
              yielded++;
              yield p.text;
            }
          }
        } catch {
          // 忽略不完整 JSON
        }
      }
    }
  }

  if (yielded === 0) {
    const diag: string[] = [];
    if (lastBlockReason) diag.push(`promptBlockReason=${lastBlockReason}`);
    if (lastFinishReason) diag.push(`finishReason=${lastFinishReason}`);
    if (lastSafetyRatings && lastSafetyRatings.length) {
      diag.push(
        "safety=" +
          lastSafetyRatings
            .map((r) => `${r.category}:${r.probability}${r.blocked ? "(blocked)" : ""}`)
            .join("|")
      );
    }
    // 把上游真实回包前 600 字带出来——AI Gateway 偶尔会改写 SSE 格式，
    // 这时候 diag 全空但 rawSeen 里能立刻看出"原来不是 data: 开头"
    const rawHint = rawSeen.trim().slice(0, 600).replace(/\s+/g, " ");
    throw new Error(
      `Gemini 流式响应为空（模型 ${model}）。${diag.length ? "诊断：" + diag.join("; ") + "。" : ""}` +
        `常见原因：safety 过滤、思考预算占满、模型名不可用、AI Gateway 改写了 SSE 格式。` +
        (rawHint ? ` 上游回包前缀：${rawHint}` : " 上游回包完全为空，请用 /api/debug/stream 进一步排查。")
    );
  }

  if (lastFinishReason === "MAX_TOKENS") {
    throw new Error(
      `模型输出达到上限（${ARTICLE_MAX_OUTPUT_TOKENS} tokens），文章可能未写完。请减少高级要求里的篇幅约束，或换用输出上限更高的模型后重试。`
    );
  }
}

/** 非流式：用于 5W1H 这种需要 JSON 的小请求 */
export async function generateJson<T>(
  cfg: GeminiConfig,
  prompt: string,
  systemInstruction?: string
): Promise<T> {
  const model = cfg.model || DEFAULT_MODEL;
  const { url, headers } = resolveEndpoint(cfg, model, "generateContent");

  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.4,
      responseMimeType: "application/json",
      maxOutputTokens: 1024,
      thinkingConfig: { thinkingBudget: 0 },
    },
    safetySettings: RELAXED_SAFETY,
  };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(GEMINI_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Gemini JSON request failed: ${res.status} ${txt.slice(0, 500)}`);
  }
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned empty content");

  return JSON.parse(text) as T;
}

/* ----------------------- Prompt 构建 ----------------------- */

function buildPreferencesBlock(pref: GenerationPreferences): string {
  const lines: string[] = [];
  if (pref.taskType) lines.push(`- 任务类型：${pref.taskType}`);
  if (pref.style) lines.push(`- 输出风格：${pref.style}`);
  if (pref.audience) lines.push(`- 目标受众：${pref.audience}`);
  if (pref.constraints) lines.push(`- 约束条件：${pref.constraints}`);
  if (lines.length === 0) return "（用户未提供额外要求，按默认深度解读处理）";
  return lines.join("\n");
}

/** 主文章生成 Prompt：要求章节化、Markdown、便于前端切分 */
export function buildArticlePrompt(transcript: TranscriptResult, pref: GenerationPreferences): {
  system: string;
  prompt: string;
} {
  const system = `你是一位资深的中文科技/财经内容编辑，擅长把英文长视频的对话整理成结构清晰、可读性极高的中文深度文章。
你的输出会被直接渲染到产品页面，所以排版必须工整、用词必须考究。`;

  const prompt = `请基于下面这段 YouTube 视频字幕（英文原文），生成一篇高质量的中文文章。

【视频信息】
- 标题：${transcript.title ?? "（未知）"}
- 作者：${transcript.author ?? "（未知）"}
- 字幕来源：${transcript.source === "youtube" ? "YouTube 官方字幕" : "演示字幕"}

【用户生成要求】
${buildPreferencesBlock(pref)}

【硬性输出规范】
1. 必须使用 Markdown 输出。
2. 文章顶部使用 \`# \` 作为整篇标题（一行，吸引人，体现核心观点）。
3. 文章正文按 3~6 个章节组织，每个章节使用 \`## \` 作为章节标题（标题应有信息量，不要"前言/结语"这种空洞标题；最后一个章节可以是总结/启示）。
4. 每个章节正文 200~500 字。允许使用 \`### \` 子标题、有序/无序列表、\`>\` 引用、**加粗** 强调关键观点。
5. 如果原视频是对话，请尽可能保留对话感（如使用「主持人：」「Marc：」之类的发言人标记），但中文要自然，不要逐句直译。
6. 不要输出任何与文章无关的解释、声明、Markdown 代码围栏，直接输出 Markdown。
7. 中文标点，全角符号；英文术语首次出现可附原文，如 "智能体（Agent）"。

【字幕原文（节选/全部）】
${transcript.fullText}
`;
  return { system, prompt };
}

/** 5W1H Prompt：服务端基于 sessionContext.article + chapter 重新构造 */
export function build5W1HPrompt(args: {
  article: string;
  chapterTitle: string;
  chapterContent: string;
  preferences: GenerationPreferences;
}): { system: string; prompt: string } {
  const system = `你是一位结构化信息提取专家，擅长针对单个章节做 5W1H 总结。
你的回答必须是严格的 JSON，字段为 who/what/when/where/why/how，每个字段为中文字符串，简洁有力。`;

  const prompt = `下面是一篇基于视频生成的中文文章。请仅针对其中【目标章节】做 5W1H 总结，但允许结合全文上下文做合理推断。

【用户生成要求】
${buildPreferencesBlock(args.preferences)}

【全文（仅作上下文参考）】
${args.article}

【目标章节】
标题：${args.chapterTitle}
正文：
${args.chapterContent}

【输出格式】
仅输出 JSON，形如：
{
  "who": "...",
  "what": "...",
  "when": "...",
  "where": "...",
  "why": "...",
  "how": "..."
}

要求：
- 每个字段控制在 50 字以内，能写一句话写一句话，必要时换行。
- 字段必须聚焦【目标章节】，但不能脱离全文语境。
- 若某个维度章节中确实没有提及，用合理推断写一句，不要写"无"或留空。
- 中文标点。`;

  return { system, prompt };
}

export type { FiveW1H };
