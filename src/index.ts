/**
 * Cloudflare Worker 入口。
 *
 * 路由：
 *   GET  /                       前端 SPA（由 ASSETS binding 服务 public/index.html）
 *   GET  /api/health             健康检查 / 配置自检
 *   GET  /api/debug/gemini       (可选) 真打一次 Gemini，定位"上游报错被吞掉"
 *   POST /api/generate           SSE 流式生成主文章
 *                                  ├─ event: meta   (videoId / title / source / sessionId)
 *                                  ├─ event: token  (Markdown 增量)
 *                                  ├─ event: done   (chapters 列表)
 *                                  └─ event: error
 *   POST /api/5w1h               基于 sessionId + chapterIndex 返回章节 5W1H JSON
 *   GET  /api/session/:id        查看保存到 KV 的本次生成上下文
 *   GET  /*                      其他路径回落到静态资源
 */

import { Hono } from "hono";
import type { Env, GenerationPreferences, SessionContext } from "./types";
import { parseVideoId } from "./utils/youtube";
import { fetchTranscript, getDemoTranscript, TranscriptError } from "./services/transcript";
import {
  build5W1HPrompt,
  buildArticlePrompt,
  generateJson,
  resolveEndpoint,
  streamGenerate,
  type FiveW1H,
} from "./services/gemini";
import { splitChapters } from "./services/markdown";
import { loadSession, newSessionId, saveSession } from "./services/session";

const app = new Hono<{ Bindings: Env }>();

/* -------------------- CORS（同源够用，留作本地开发兼容） -------------------- */

app.use("*", async (c, next) => {
  await next();
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type");
});

app.options("*", () => new Response(null, { status: 204 }));

/* -------------------- Health / Debug -------------------- */

/** AI Gateway URL 脱敏：把 account / gateway 段替换成 ***，保留可识别的形状 */
function redactAigUrl(u: string | undefined): string | null {
  if (!u) return null;
  return u.replace(/(\/v1\/)([^/]+)(\/)([^/]+)(\/)/, "$1***$3***$5");
}

app.get("/api/health", (c) => {
  const aigUrl = c.env.CF_AIG_URL || "";
  return c.json({
    ok: true,
    model: c.env.GEMINI_MODEL || "gemini-2.5-flash",
    hasKey: Boolean(c.env.GEMINI_API_KEY),
    demoFallback: c.env.DEMO_FALLBACK !== "false",
    proxyConfigured: Boolean(c.env.WEBSHARE_PROXY),
    cookieConfigured: Boolean(c.env.YT_COOKIE),
    aig: {
      configured: Boolean(aigUrl),
      shapeOk: /^https?:\/\/[^/]+\/v1\/[^/<>\s]+\/[^/<>\s]+\/google-ai-studio\/*$/.test(aigUrl),
      urlRedacted: redactAigUrl(aigUrl),
      hasToken: Boolean(c.env.CF_AIG_TOKEN),
    },
    time: new Date().toISOString(),
  });
});

/**
 * 触发一次最小 Gemini 调用，把上游 status / 错误体回前端。
 * 用于在 "网页一直转圈" 时一眼看出是 key 错 / 模型不可用 / 区域被拒 / AI Gateway 配错。
 */
app.get("/api/debug/gemini", async (c) => {
  const apiKey = c.env.GEMINI_API_KEY;
  if (!apiKey) {
    return c.json({ ok: false, step: "config", error: "服务端未配置 GEMINI_API_KEY" }, 500);
  }
  const model = c.env.GEMINI_MODEL || "gemini-2.5-flash";
  const baseUrl = c.env.CF_AIG_URL || undefined;
  const gatewayToken = c.env.CF_AIG_TOKEN || undefined;

  let url: string;
  let headers: Record<string, string>;
  let viaGateway: boolean;
  try {
    ({ url, headers, viaGateway } = resolveEndpoint(
      { apiKey, model, baseUrl, gatewayToken },
      model,
      "generateContent"
    ));
  } catch (e) {
    return c.json(
      { ok: false, step: "resolve-endpoint", model, error: (e as Error).message },
      500
    );
  }

  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "用一句中文说：你好" }] }],
        generationConfig: { temperature: 0.2 },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const elapsedMs = Date.now() - started;
    const text = await res.text();
    let parsed: unknown = null;
    try { parsed = JSON.parse(text); } catch { /* 非 JSON 时保留 raw 前 2KB */ }
    return c.json({
      ok: res.ok,
      status: res.status,
      elapsedMs,
      model,
      viaGateway,
      urlRedacted: redactAigUrl(url),
      body: parsed ?? text.slice(0, 2000),
    });
  } catch (e) {
    const err = e as Error;
    return c.json(
      {
        ok: false,
        step: "fetch",
        model,
        viaGateway,
        urlRedacted: redactAigUrl(url),
        elapsedMs: Date.now() - started,
        error: err.message,
        name: err.name,
      },
      502
    );
  }
});

/* -------------------- 主文章：SSE 流式生成 -------------------- */

interface GenerateBody {
  url: string;
  preferences?: GenerationPreferences;
  /** 调试 / 离线演示：强制使用内置 demo 字幕，跳过 YouTube 抓取 */
  forceDemo?: boolean;
}

app.post("/api/generate", async (c) => {
  let body: GenerateBody;
  try {
    body = await c.req.json<GenerateBody>();
  } catch {
    return c.json({ error: "请求体必须是合法 JSON" }, 400);
  }

  const videoId = parseVideoId(body.url);
  if (!videoId) return c.json({ error: "无法解析视频链接，请检查输入" }, 400);

  if (!c.env.GEMINI_API_KEY) {
    return c.json(
      { error: "服务端未配置 GEMINI_API_KEY（部署前请执行 wrangler secret put GEMINI_API_KEY）" },
      500
    );
  }

  const preferences = body.preferences ?? {};
  const demoFallback = c.env.DEMO_FALLBACK !== "false"; // 默认开启

  // 字幕需要在 SSE 流之前拿到，meta 事件才能立刻发出
  let transcript;
  let transcriptError: TranscriptError | null = null;
  if (body.forceDemo === true) {
    transcript = getDemoTranscript(videoId);
  } else {
    try {
      transcript = await fetchTranscript(videoId, {
        proxy: c.env.WEBSHARE_PROXY,
        cookie: c.env.YT_COOKIE,
      });
    } catch (e) {
      transcriptError = e instanceof TranscriptError ? e : new TranscriptError(String(e), "network");
      if (demoFallback) {
        transcript = getDemoTranscript(videoId);
      } else {
        return c.json(
          { error: `获取字幕失败：${transcriptError.message}`, reason: transcriptError.reason },
          502
        );
      }
    }
  }

  const sessionId = newSessionId();
  const { system, prompt } = buildArticlePrompt(transcript, preferences);
  const apiKey = c.env.GEMINI_API_KEY;
  const model = c.env.GEMINI_MODEL || "gemini-2.5-flash";
  const baseUrl = c.env.CF_AIG_URL || undefined;
  const gatewayToken = c.env.CF_AIG_TOKEN || undefined;
  const env = c.env;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        send("meta", {
          sessionId,
          videoId,
          videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
          title: transcript.title,
          author: transcript.author,
          source: transcript.source,
          language: transcript.language,
          transcript: {
            cueCount: transcript.cues.length,
            fullText: transcript.fullText,
          },
          transcriptError: transcriptError
            ? { message: transcriptError.message, reason: transcriptError.reason }
            : undefined,
        });

        let articleBuf = "";
        for await (const token of streamGenerate(
          { apiKey, model, baseUrl, gatewayToken },
          prompt,
          system,
          { temperature: 0.7 }
        )) {
          articleBuf += token;
          send("token", { text: token });
        }

        if (!articleBuf.trim()) {
          throw new Error("Gemini 未返回文章内容，请检查 API Key 与模型配置后重试");
        }

        const chapters = splitChapters(articleBuf);

        const ctx: SessionContext = {
          id: sessionId,
          createdAt: Date.now(),
          videoId,
          videoTitle: transcript.title,
          videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
          preferences,
          transcript: {
            source: transcript.source,
            language: transcript.language,
            // 控制 KV 单 key 大小（25MB 上限，但保守一些便于热点访问）
            fullText: transcript.fullText.slice(0, 30_000),
          },
          article: articleBuf,
          chapters,
        };
        await saveSession(env, ctx);

        send("done", {
          sessionId,
          chapters: chapters.map(({ index, title }) => ({ index, title })),
          length: articleBuf.length,
        });
      } catch (e) {
        const err = e as Error;
        console.error("[generate] failed", {
          name: err?.name,
          message: err?.message,
          videoId,
          model,
          transcriptSource: transcript.source,
        });
        send("error", { message: err?.message || "生成失败", name: err?.name });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});

/* -------------------- 章节 5W1H -------------------- */

interface FiveW1HBody {
  sessionId: string;
  chapterIndex: number;
}

app.post("/api/5w1h", async (c) => {
  let body: FiveW1HBody;
  try {
    body = await c.req.json<FiveW1HBody>();
  } catch {
    return c.json({ error: "请求体必须是合法 JSON" }, 400);
  }
  if (!body.sessionId || typeof body.chapterIndex !== "number") {
    return c.json({ error: "缺少 sessionId 或 chapterIndex" }, 400);
  }

  const ctx = await loadSession(c.env, body.sessionId);
  if (!ctx) return c.json({ error: "会话已过期或不存在，请重新生成文章" }, 404);

  const chapter = ctx.chapters[body.chapterIndex];
  if (!chapter) return c.json({ error: "章节索引越界" }, 404);

  if (!c.env.GEMINI_API_KEY) return c.json({ error: "服务端未配置 GEMINI_API_KEY" }, 500);

  const { system, prompt } = build5W1HPrompt({
    article: ctx.article,
    chapterTitle: chapter.title,
    chapterContent: chapter.content,
    preferences: ctx.preferences,
  });

  try {
    const result = await generateJson<FiveW1H>(
      {
        apiKey: c.env.GEMINI_API_KEY,
        model: c.env.GEMINI_MODEL,
        baseUrl: c.env.CF_AIG_URL || undefined,
        gatewayToken: c.env.CF_AIG_TOKEN || undefined,
      },
      prompt,
      system
    );
    return c.json({ ok: true, chapter: { index: chapter.index, title: chapter.title }, result });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

/* -------------------- Session 查看（调试 5W1H 时用） -------------------- */

app.get("/api/session/:id", async (c) => {
  const ctx = await loadSession(c.env, c.req.param("id"));
  if (!ctx) return c.json({ error: "not found" }, 404);
  return c.json(ctx);
});

/* -------------------- 静态资源兜底 -------------------- */

app.get("*", async (c) => c.env.ASSETS.fetch(c.req.raw));

export default app satisfies ExportedHandler<Env>;
