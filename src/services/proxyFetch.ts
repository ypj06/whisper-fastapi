/**
 * 通过 webshare 等 HTTP 代理发起 HTTPS 请求 —— Cloudflare Worker 版。
 *
 * 协议选择（重要）：
 *   HTTP 代理有两种用法。
 *   (1) CONNECT 隧道：客户端发 `CONNECT host:443`，代理建到目标 TCP 后透传字节，
 *       客户端自己跟目标做 TLS 握手。
 *       —— 在 Cloudflare Workers 上需要 socket.startTls()，而 startTls 在 workerd
 *       目前存在已知 bug（参见 cloudflare/workerd#2712）：在已读过数据的 socket 上
 *       startTls 会出现 "TLS Handshake Failed."，整条路走不通。
 *   (2) 绝对 URI 转发（"forward proxy"）：客户端跟代理之间走**普通明文 TCP**，
 *       请求行写成 `GET https://host/path HTTP/1.1`，**代理替我们做 TLS**，把已解密的
 *       HTTP 响应回传给我们。
 *
 *   我们选 (2)，因为：
 *     - 不需要 startTls，完全绕开 workerd 的 bug；
 *     - 不需要自己实现 TLS，代码量减半；
 *     - webshare backbone（p.webshare.io:80）正是这种 forward proxy。
 *
 * 安全考虑：
 *   - Worker ↔ webshare 这段链路是明文，但 Webshare 是受信代理服务商，且整条 webshare
 *     ↔ youtube 链路仍然是 TLS。我们只在请求 Authorization 头里塞了 webshare 凭据。
 *   - 不会把用户的 Gemini API key 等敏感字段送进 proxyFetch。
 *
 * 其他设计取舍：
 *   - 仅实现 GET（YouTube 字幕的两次请求都是 GET），保持精简。
 *   - 主动声明 `Accept-Encoding: identity` 避免 gzip。
 *   - 解析支持 Content-Length / chunked / connection-close 三种 body 终止方式。
 *   - 整个通信 15s 总超时，避免坏代理拖垮 worker。
 */

import { connect } from "cloudflare:sockets";

export interface ProxyConfig {
  host: string;
  port: number;
  user?: string;
  pass?: string;
}

/**
 * 解析 "host:port:user:pass"；密码不允许含 `:`。
 *
 * 防御一个常见的人为粘贴失误：webshare 控制台里 `p.webshare.io` 后面跟了一个 ⓘ 图标，
 * 复制时极易漏掉 `.io`。我们要求 host 至少有一个 "."，否则视为非法配置。
 */
export function parseProxyString(s: string | undefined): ProxyConfig | null {
  if (!s) return null;
  const parts = s.trim().split(":");
  if (parts.length < 2) return null;
  const [host, portRaw, user, pass] = parts;
  const port = parseInt(portRaw ?? "0", 10);
  if (!host || !port) return null;
  if (!host.includes(".")) {
    console.warn(`[proxy] host "${host}" 看上去不合法（缺少点号），忽略代理配置`);
    return null;
  }
  return { host, port, user, pass };
}

interface ProxyFetchOptions {
  headers?: Record<string, string>;
  method?: "GET" | "POST";
  body?: string;
  /** 单次握手 + 请求 + 读完整个 body 的总超时，毫秒 */
  timeoutMs?: number;
}

/**
 * 通过 HTTP 代理 fetch 一个 https:// URL，返回标准 Response。
 * 支持 GET / POST（HTTPS 目标，forward-proxy 绝对 URI 模式）。
 */
export async function fetchViaProxy(
  url: string,
  cfg: ProxyConfig,
  opts: ProxyFetchOptions = {}
): Promise<Response> {
  const target = new URL(url);
  if (target.protocol !== "https:") {
    throw new Error(`fetchViaProxy 只支持 https:// (got ${target.protocol})`);
  }

  const timeoutMs = opts.timeoutMs ?? 15_000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  // 直接 await Promise.race 会泄漏 socket；用 try/finally 显式 close
  try {
    return await Promise.race([
      doProxyFetch(target, cfg, {
        method: opts.method ?? "GET",
        body: opts.body,
        headers: opts.headers ?? {},
      }),
      new Promise<Response>((_, reject) =>
        ctrl.signal.addEventListener("abort", () =>
          reject(new Error(`proxy fetch timeout after ${timeoutMs}ms`))
        )
      ),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function doProxyFetch(
  target: URL,
  cfg: ProxyConfig,
  req: { method: "GET" | "POST"; body?: string; headers: Record<string, string> }
): Promise<Response> {
  const targetHost = target.hostname;

  // 1) 明文 TCP 连接到代理。secureTransport: "off" —— 全程不需要 TLS，
  //    代理替我们做对 youtube 的 TLS。
  const socket = connect(
    { hostname: cfg.host, port: cfg.port },
    { secureTransport: "off", allowHalfOpen: false }
  );

  try {
    await socket.opened;
  } catch (e) {
    throw new Error(`无法连接到代理 ${cfg.host}:${cfg.port}: ${(e as Error).message}`);
  }

  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const enc = new TextEncoder();

  try {
    // 2) 用「绝对 URI」方式发请求：请求行带完整 https:// URL，由代理替我们走 TLS。
    //    这是 HTTP/1.1 RFC 7230 §5.3.2 描述的 forward proxy request form。
    const absoluteUri = target.toString();
    const reqHeaders: Record<string, string> = {
      Host: targetHost,
      "Accept-Encoding": "identity", // 让代理别回 gzip，省掉解压
      Connection: "close",           // 发完就关，方便 EOF 判定
      ...req.headers,
    };
    if (cfg.user && cfg.pass) {
      reqHeaders["Proxy-Authorization"] = `Basic ${btoa(`${cfg.user}:${cfg.pass}`)}`;
    }
    const body = req.body;
    if (body) {
      reqHeaders["Content-Length"] = String(new TextEncoder().encode(body).byteLength);
      if (!reqHeaders["Content-Type"]) reqHeaders["Content-Type"] = "application/json";
    }
    const reqLines = [`${req.method} ${absoluteUri} HTTP/1.1`];
    for (const [k, v] of Object.entries(reqHeaders)) reqLines.push(`${k}: ${v}`);
    reqLines.push("", "");
    const head = reqLines.join("\r\n");
    await writer.write(enc.encode(body ? head + body : head));

    // 3) 读响应头
    const { headerBytes, leftover } = await readHeader(reader);
    const { status, statusText, headers } = parseHeaderBlock(headerBytes);

    // 4) 按 header 决定 body 读取模式
    let bodyBytes: Uint8Array;
    const te = (headers.get("transfer-encoding") || "").toLowerCase();
    const clRaw = headers.get("content-length");
    if (te.includes("chunked")) {
      bodyBytes = await readChunkedBody(reader, leftover);
    } else if (clRaw) {
      bodyBytes = await readFixedBody(reader, leftover, parseInt(clRaw, 10));
    } else {
      // 我们声明了 Connection: close，读到 EOF 即结束
      bodyBytes = await readUntilClose(reader, leftover);
    }

    // 5) 过滤掉 Cloudflare Response ctor 不允许或会引起 length 误判的 hop-by-hop 头
    const safeHeaders = filterResponseHeaders(headers);
    return new Response(toArrayBufferView(bodyBytes), { status, statusText, headers: safeHeaders });
  } finally {
    try { writer.releaseLock(); } catch { /* ignore */ }
    try { reader.releaseLock(); } catch { /* ignore */ }
    try { await socket.close(); } catch { /* ignore */ }
  }
}

/* -------------------------- Helpers: 字节流处理 -------------------------- */

function bytesToString(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/**
 * 拼接两个 Uint8Array，并确保底层 buffer 是普通 ArrayBuffer
 * （workers-types 把 Response/TextDecoder 的入参限制成 Uint8Array<ArrayBuffer>，
 *  不接受可能来自 SharedArrayBuffer 的 ArrayBufferLike）
 */
function concat(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(a.byteLength + b.byteLength));
  out.set(a, 0);
  out.set(b, a.byteLength);
  return out;
}

/** 把任意 Uint8Array 复制到一个 ArrayBuffer-backed 的 Uint8Array，方便交给 Response */
function toArrayBufferView(src: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(src.byteLength));
  out.set(src);
  return out;
}

function indexOfDoubleCrlf(buf: Uint8Array): number {
  // \r\n\r\n
  for (let i = 0; i + 3 < buf.byteLength; i++) {
    if (buf[i] === 0x0d && buf[i + 1] === 0x0a && buf[i + 2] === 0x0d && buf[i + 3] === 0x0a) {
      return i;
    }
  }
  return -1;
}

function indexOfCrlf(buf: Uint8Array, from = 0): number {
  for (let i = from; i + 1 < buf.byteLength; i++) {
    if (buf[i] === 0x0d && buf[i + 1] === 0x0a) return i;
  }
  return -1;
}

/**
 * 一直读直到出现 \r\n\r\n。
 *
 * 边界情形：有些代理在拒绝鉴权时会发完一行 4xx 头就立刻关闭连接，此时 `done=true` 但
 * buf 里其实已经能解析出 status——我们尽量把这种情况转成有意义的报错而不是含糊
 * "提前关闭"。
 */
async function readHeader(
  reader: ReadableStreamDefaultReader<Uint8Array>
): Promise<{ headerBytes: Uint8Array; leftover: Uint8Array }> {
  let buf = new Uint8Array(0);
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      if (buf.byteLength === 0) throw new Error("代理在收到任何字节前就关闭了连接");
      const idx = indexOfDoubleCrlf(buf);
      if (idx >= 0) {
        return { headerBytes: buf.subarray(0, idx + 4), leftover: buf.subarray(idx + 4) };
      }
      const text = bytesToString(buf).split("\r\n", 1)[0] ?? "";
      throw new Error(`代理在收到完整响应头前关闭了连接（已收到 ${buf.byteLength} 字节，首行: "${text}"）`);
    }
    buf = concat(buf, value);
    const idx = indexOfDoubleCrlf(buf);
    if (idx >= 0) {
      const headerBytes = buf.subarray(0, idx + 4);
      const leftover = buf.subarray(idx + 4);
      return { headerBytes, leftover };
    }
    if (buf.byteLength > 64 * 1024) throw new Error("响应头超过 64KB，可能不是合法 HTTP 响应");
  }
}

function parseHeaderBlock(headerBytes: Uint8Array): {
  status: number;
  statusText: string;
  headers: Headers;
} {
  const text = bytesToString(headerBytes);
  const lines = text.split("\r\n");
  const statusLine = lines.shift() || "";
  const m = /^HTTP\/1\.[01]\s+(\d{3})\s*(.*)$/.exec(statusLine);
  if (!m) throw new Error(`非法响应状态行: ${statusLine}`);
  const status = parseInt(m[1] as string, 10);
  const statusText = (m[2] ?? "").trim();
  const headers = new Headers();
  for (const line of lines) {
    if (!line) continue;
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    try { headers.append(k, v); } catch { /* 跳过非法 header 名 */ }
  }
  return { status, statusText, headers };
}

async function readFixedBody(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  leftover: Uint8Array,
  contentLength: number
): Promise<Uint8Array> {
  if (contentLength <= 0) return new Uint8Array(0);
  let buf = leftover;
  while (buf.byteLength < contentLength) {
    const { value, done } = await reader.read();
    if (done) break;
    buf = concat(buf, value);
  }
  return buf.subarray(0, Math.min(buf.byteLength, contentLength));
}

async function readUntilClose(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  leftover: Uint8Array
): Promise<Uint8Array> {
  let buf = leftover;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf = concat(buf, value);
    if (buf.byteLength > 8 * 1024 * 1024) {
      throw new Error("响应体超过 8MB，疑似异常，已中止");
    }
  }
  return buf;
}

/**
 * 解析 chunked transfer-encoding。
 * 每个 chunk = `<hex size>\r\n<bytes>\r\n`，size=0 表示结束。
 */
async function readChunkedBody(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  leftover: Uint8Array
): Promise<Uint8Array> {
  let buf = leftover;
  let out = new Uint8Array(0);

  const ensure = async (n: number): Promise<boolean> => {
    while (buf.byteLength < n) {
      const { value, done } = await reader.read();
      if (done) return false;
      buf = concat(buf, value);
    }
    return true;
  };

  while (true) {
    // 读 chunk size 行
    let crlf = indexOfCrlf(buf);
    while (crlf < 0) {
      const { value, done } = await reader.read();
      if (done) throw new Error("chunked: 流提前结束于 size 行");
      buf = concat(buf, value);
      crlf = indexOfCrlf(buf);
    }
    const sizeLine = bytesToString(buf.subarray(0, crlf)).split(";")[0]?.trim() ?? "";
    const size = parseInt(sizeLine, 16);
    if (!Number.isFinite(size) || size < 0) throw new Error(`chunked: 非法 size "${sizeLine}"`);
    buf = buf.subarray(crlf + 2);

    if (size === 0) {
      // 跳过可能存在的 trailer headers，直到再一个 \r\n
      while (true) {
        const idx = indexOfCrlf(buf);
        if (idx === 0) { buf = buf.subarray(2); break; }
        if (idx > 0) { buf = buf.subarray(idx + 2); continue; }
        const { value, done } = await reader.read();
        if (done) break;
        buf = concat(buf, value);
      }
      return out;
    }

    // 读 size 个字节 + 末尾的 \r\n
    if (!(await ensure(size + 2))) throw new Error("chunked: 流提前结束于 data");
    out = concat(out, buf.subarray(0, size));
    buf = buf.subarray(size + 2); // 跳过 trailing CRLF
  }
}

/** 过滤掉 Cloudflare Response ctor 不允许或会引起重复 Content-Length 误判的头 */
function filterResponseHeaders(headers: Headers): Headers {
  const drop = new Set([
    "transfer-encoding",
    "content-encoding", // 我们已要求 identity，但有些代理仍会回 gzip 头（实际未压缩）
    "content-length",   // 让运行时根据实际 body 自己算
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-connection",
    "upgrade",
  ]);
  const out = new Headers();
  headers.forEach((v, k) => {
    if (!drop.has(k.toLowerCase())) {
      try { out.append(k, v); } catch { /* ignore */ }
    }
  });
  return out;
}
