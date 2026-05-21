/**
 * Session 上下文存储 —— 用 Cloudflare KV 持久化。
 *
 * 设计原则：章节「5W1H 总结」请求不得由前端重新提交整篇文章内容；
 * 系统应基于服务端保存的本次生成上下文完成总结。
 *
 * 因此我们在「主文章流式生成结束」之后，把完整 article + chapters + preferences
 * 写入 KV，前端只持有 sessionId。后续 /api/5w1h 用 sessionId + chapterIndex 即可。
 */

import type { Env, SessionContext } from "../types";

const KEY_PREFIX = "session:";
const TTL_SECONDS = 60 * 60 * 24 * 7; // 7 天

function key(id: string): string {
  return `${KEY_PREFIX}${id}`;
}

export async function saveSession(env: Env, ctx: SessionContext): Promise<void> {
  await env.SESSIONS.put(key(ctx.id), JSON.stringify(ctx), {
    expirationTtl: TTL_SECONDS,
  });
}

export async function loadSession(env: Env, id: string): Promise<SessionContext | null> {
  const raw = await env.SESSIONS.get(key(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionContext;
  } catch {
    return null;
  }
}

/** 简短的随机 id（不依赖 nanoid，避免额外依赖） */
export function newSessionId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
