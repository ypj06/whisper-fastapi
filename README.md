# 视见 Vidsight · YouTube 知识萃取

> 粘贴任意带字幕的 YouTube 链接 → Gemini 实时为你写出一篇结构清晰的中文长文 → 每个章节都能一键调出 **5W1H** 总结。

完全部署在 **Cloudflare Workers** 上：零冷启、全球边缘节点；前端是一个零构建的单文件 SPA，通过 Workers Assets 分发。后端、前端、Prompt 工程都是 TypeScript，模块边界清晰，单文件不超过 ~400 行。

- 演示视频：<https://www.youtube.com/watch?v=xRh2sVcNXQ8>
- 演示地址：见下方部署步骤生成的 `*.workers.dev` 域名

---

## 特性

- **流式生成**：服务端用 Gemini `streamGenerateContent`（SSE）逐 token 推送；前端用 `fetch + ReadableStream` 自行解析，每个增量都用 `markdown-it` 重新渲染，所以你看到的全程是排好版的 Markdown，而不是 `## `、`**` 这种裸符号。
- **章节级 5W1H**：主文章按 `## ` 切分为章节；前端只需要带 `{sessionId, chapterIndex}` 请求 `/api/5w1h`，**不需要重传文章内容**。完整上下文保存在 Cloudflare KV 里（TTL 7 天）。
- **个性化 prompt**：可填「任务类型 / 输出风格 / 目标受众 / 约束条件」，或一键选用「商业洞察 / 技术深读 / 轻松口语」三个预设。
- **AI Gateway 集成**（可选）：配一行 `CF_AIG_URL` 即让所有 Gemini 流量走 Cloudflare AI Gateway，绕开 Gemini 对部分 Workers 出口 IP 的地区限制（"User location is not supported"），同时拿到平台级缓存 / 限速 / 计量 / 可观测能力。
- **YouTube 字幕多路降级**：HTML 内嵌 → Innertube `player` 多客户端策略 → Innertube `next → get_transcript`；timedtext 自动在 xml / srv3 / vtt / json3 / ttml 之间切换；可选走 webshare 代理。任何一步失败都会自动尝试下一条路径。
- **零依赖前端**：`public/` 三个文件就是整个 SPA，通过 importmap + esm.sh 加载 `markdown-it` 与 `dompurify`。无 bundler、无构建步骤。
- **可降级 UX**：抓字幕失败时（如视频无字幕、IP 被风控）自动回落到内置 demo 字幕，前端会出现金色 banner 说明原因，绝不静默假装成功。

---

## 快速开始

```bash
git clone <this-repo>
cd youtube-knowledge-extractor

# 1. 安装依赖
npm install

# 2. 准备本地配置（不会进入 git）
cp .dev.vars.example .dev.vars
# 然后编辑 .dev.vars，填入你的 GEMINI_API_KEY

# 3. 本地启动
npm run dev
# 打开 http://127.0.0.1:8787
```

只需一个 `GEMINI_API_KEY` 即可跑通本地开发。其他变量都是可选项，用于解决部署后才会遇到的网络问题。

---

## 部署到 Cloudflare Workers

```bash
# 1. 登录
npx wrangler login

# 2. 创建 KV namespace（用于保存 5W1H 上下文），把返回的 id 写进 wrangler.toml
npx wrangler kv namespace create SESSIONS
npx wrangler kv namespace create SESSIONS --preview
# 提示：如果以前创建过、报 "a namespace with this account ID and title already exists
# [code: 10014]"，直接 `npx wrangler kv namespace list` 把现有 id 拿出来复用即可，
# 不需要重新创建。

# 3. 配置 secrets
npx wrangler secret put GEMINI_API_KEY    # 必填

# 4.（强烈推荐）AI Gateway，绕开 Gemini 对部分 Cloudflare 出口 IP 的地区限制
#    Cloudflare Dashboard → AI → AI Gateway → Create Gateway
npx wrangler secret put CF_AIG_URL
# 提示输入时粘贴：
# https://gateway.ai.cloudflare.com/v1/<your-account-id>/<gateway-name>/google-ai-studio

# 5. 部署
npm run deploy

# 6.（可选）实时日志
npx wrangler tail youtube-knowledge-extractor --format pretty
```

部署完成后会得到 `https://youtube-knowledge-extractor.<account>.workers.dev`。

### 不想动 `wrangler.toml`？用本地 override

如果你 fork 了这个仓库并打算长期自己部署，建议保留仓库里的 `wrangler.toml` 作为开源模板（KV id 是占位），而把你的真实 id 写在本地的 `wrangler.local.toml`（已被 `.gitignore`）：

```bash
cp wrangler.local.toml.example wrangler.local.toml
# 编辑 wrangler.local.toml，把 KV id / preview_id 替换为真实值
#   - 第一次部署：用 `wrangler kv namespace create` 的返回值
#   - 已经创建过（再跑会报 code 10014 重名错误）：直接 `wrangler kv namespace list` 拿现有 id 复用

npm run dev:my       # = wrangler dev    --config wrangler.local.toml
npm run deploy:my    # = wrangler deploy --config wrangler.local.toml
```

> Secrets 也建议带 `--config wrangler.local.toml`，例如
> `npx wrangler secret put GEMINI_API_KEY --config wrangler.local.toml`，保证写到本地配置对应的 worker name 上。

这样你 pull 上游更新时不会跟自己的 KV id 冲突，也不会不小心把真实 id 提交到公开仓库。

---

## 配置项

| 类型 | 名称 | 必填 | 说明 |
|------|------|------|------|
| Secret | `GEMINI_API_KEY` | ✅ | Google AI Studio key |
| Secret | `CF_AIG_URL` | ⛔ | Cloudflare AI Gateway base URL，形如 `…/v1/<account>/<gateway>/google-ai-studio`。强烈推荐 |
| Secret | `CF_AIG_TOKEN` | ⛔ | AI Gateway 启用 "Authenticated Gateway" 时所需的 Bearer token |
| Secret | `WEBSHARE_PROXY` | ⛔ | webshare 代理 `host:port:user:pass`，用于绕过 YouTube 同意墙 |
| Secret | `YT_COOKIE` | ⛔ | YouTube 登录 cookie 串，缓解数据中心 IP 的 bot 检测 |
| Var | `GEMINI_MODEL` | ⛔ | 默认 `gemini-2.5-flash`，可改成其他可用模型 |
| Var | `DEMO_FALLBACK` | ⛔ | 字幕抓取失败时是否回落到内置 demo 字幕，默认 `true` |
| Binding | `SESSIONS` (KV) | ✅ | 章节 5W1H 的服务端会话存储 |
| Binding | `ASSETS` | ✅ | 由 `wrangler.toml` 自动绑定到 `./public` |

---

## 工作原理

### 1. 字幕抓取（`src/services/transcript.ts`）

按下面的顺序尝试，任一步成功即返回：

1. 抓 `https://www.youtube.com/watch?v=<id>` 页面 HTML，从中解析 `ytInitialPlayerResponse` 拿到 `captionTracks`。
2. HTML 没有播放器数据时，调 Innertube `/youtubei/v1/player`，依次尝试 ANDROID 客户端（最稳）、ANDROID + API key、WEB 客户端 + 桌面 UA + Origin/Referer 三种策略。
3. 仍没有 `captionTracks` 时，走 Innertube `next → get_transcript`，**直接拿带时间戳的文本**，绕开 timedtext。
4. 拿到 `captionTracks` 后按 `(手动 > 自动, 中文 > 英文)` 选最优轨道，请求 timedtext 签名 URL。`baseUrl` 自带 fmt 时原样请求；否则按 `srv3 → vtt → json3 → ttml` 依次回退；同一 URL 还会同时尝试代理出口与 Worker 直连出口（YouTube 对 datacenter IP 的 timedtext 限流和对小语种 ASR 的 fmt 兼容性都不太一致，多路兜底最稳）。
5. 一切失败 → 抛 `TranscriptError`；服务端根据 `DEMO_FALLBACK` 决定是否回落到内置 demo 字幕。

### 2. 走代理：`cloudflare:sockets` 实现的 forward proxy（`src/services/proxyFetch.ts`）

Cloudflare Workers 的 `fetch` 不支持配置出站代理。这里用 `cloudflare:sockets` 的 `connect()` 直接建 TCP，再用 HTTP/1.1 的 **绝对 URI 转发**（"forward proxy"，RFC 7230 §5.3.2）实现：

```
Worker  --TCP-->  webshare 代理  --TLS-->  www.youtube.com
        GET https://www.youtube.com/... HTTP/1.1
```

即 Worker 跟代理之间走明文 TCP，请求行写完整的 `https://` URL，**代理替我们做 TLS**。这样可以完全绕开 `socket.startTls()` 在 workerd 上的已知问题（[workerd#2712](https://github.com/cloudflare/workerd/issues/2712)），代码量也比手写 CONNECT + TLS 隧道少一半。

响应解析支持 `Content-Length` / `Transfer-Encoding: chunked` / `Connection: close` 三种 body 终止方式；声明 `Accept-Encoding: identity` 跳过 gzip；整路 15 秒总超时；失败立刻降级为 `fetch()` 直连。

### 3. Gemini 流式生成（`src/services/gemini.ts`）

- 用 Gemini 原生 `streamGenerateContent?alt=sse`，不引入任何 SDK。
- 在 Worker 里手写 SSE 解析（按 `\n\n` 拆事件、按 `data:` 拆行），通过 `async function*` 暴露成异步字符串迭代器。
- `resolveEndpoint()` 在「Google 直连」与「Cloudflare AI Gateway」之间无缝切换：两条路径共用同一份解析逻辑，因为 AI Gateway 透传 Google 的 REST 路径。AI Gateway 模式下用 `x-goog-api-key` header 而非 query string，避免 key 出现在 gateway 日志。
- 显式关闭 `thinkingConfig.thinkingBudget`（避免 2.5 系列在 thinking 阶段占用 token，导致流式半天不出 text），并把 `safetySettings` 全设 `BLOCK_NONE`（输入是用户给的字幕，不存在 NSFW 场景；默认安全阈值在长字幕上偶尔会误判把 candidate 关掉，导致响应为空）。
- 主路由 `/api/generate` 自身也是 SSE，依次发：

  | event | data |
  |------|------|
  | `meta` | `sessionId / videoId / title / source / language / transcriptError?` |
  | `token` | `{ text }` — 每个 Gemini 增量片段 |
  | `done` | `{ sessionId, chapters: [{index, title}], length }` |
  | `error` | `{ message, name }` |

### 4. 章节 5W1H（`src/services/session.ts` + `/api/5w1h`）

> 章节「5W1H 总结」不允许由前端重新提交整篇文章。

- 主文章流结束后，服务端用 `splitChapters()`（按 `## ` 切分）把文章拆成章节，连同完整 article、用户偏好一起写入 KV (`SESSIONS` 命名空间，TTL 7 天)。SessionId 是 96-bit 随机十六进制，提前通过 SSE `meta` 事件发给前端。
- 前端只持有 `sessionId`，扫描渲染好的 `<h2>` 注入 `[5W1H]` 按钮，点击仅 POST `{sessionId, chapterIndex}`。
- 服务端从 KV 读出 session → 拼章节级 prompt → 调 Gemini `generateContent`（开 `responseMimeType: application/json`），直接拿到结构化的 6 个字段，前端用六张卡片 + 抽屉动效展示。

### 5. 用户生成要求如何影响输出（`GenerationPreferences` + `buildArticlePrompt`）

左侧「高级生成要求」里的四个字段——**任务类型 / 输出风格 / 目标受众 / 约束条件**——会在点击「开始生成」时随 `/api/generate` 请求体里的 `preferences` 对象一并提交。服务端在 `buildArticlePrompt()` 里把它们拼成 prompt 的 **【用户生成要求】** 段落，与 **【硬性输出规范】**（Markdown 结构、3~6 个 `##` 章节、字数区间等）分开注入，让模型在固定排版框架内按用户意图调整侧重点。

| 字段 | 作用 | 示例 |
|------|------|------|
| `taskType` | 决定文章「写什么角度」 | 深度商业洞察 / 技术深读 / 轻松解读 |
| `style` | 决定语气与行文风格 | 克制专业 / 工程思维 / 亲切口语 |
| `audience` | 决定术语深度与举例方式 | 投资人 / 工程师 / 普通读者 |
| `constraints` | 额外硬性或软性约束 | 保留关键数字 / 回避术语 / 不超过 3000 字 |

**预设快捷填充**：前端三个 chip（商业洞察 / 技术深读 / 轻松口语）会一次性写入上述四个字段，用户仍可继续微调。四个字段均为可选；全部留空时 prompt 会注明「按默认深度解读处理」，不影响生成。

**影响范围与边界**：

- **主文章**：偏好直接参与 Gemini 流式生成，影响章节选材、措辞、术语密度、举例风格等「内容层」决策；不会改变 `##` 章节切分协议（前端 5W1H 按钮依赖此结构）。
- **章节 5W1H**：同一份 `preferences` 在主文章结束后写入 KV session；点击 `[5W1H]` 时服务端从 KV 读出并注入 `build5W1HPrompt()`，使 Who/What/When/Where/Why/How 的提炼角度与主文一致（例如「技术深读」预设会保留英文术语，「轻松解读」会回避行话）。
- **软约束，不是硬过滤**：这些字段通过自然语言 prompt 引导模型，不保证 100% 覆盖每一条约束，但也不会主动超出用户描述的范围。真正不可协商的是 **【硬性输出规范】**（Markdown、`#` / `##` 结构、禁止输出代码围栏等）。

数据流概览：

```
用户填写 preferences
    → POST /api/generate { url, preferences }
    → buildArticlePrompt(transcript, preferences)  // 【用户生成要求】进主文 prompt
    → 流式生成 + 写入 KV { article, chapters, preferences }
    → POST /api/5w1h { sessionId, chapterIndex }
    → build5W1HPrompt({ ..., preferences })        // 同一套偏好进 5W1H prompt
```

---

## 主要工程取舍与亮点

| 取舍 | 选择 | 理由 |
|------|------|------|
| 前端构建 | **零构建**（`index.html` + importmap + esm.sh） | 改 UI 即刷新即见；代价是运行时依赖 CDN，但 Workers Assets 静态分发足够轻 |
| LLM 调用 | **原生 `fetch` + 手写 SSE 解析**，不引 SDK | Worker 包体小、无多余抽象；流式逻辑完全可控，AI Gateway / 直连共用一套解析 |
| 流式渲染 | **每个 token 增量都用 `markdown-it` 全量重渲染** | 用户全程看到排版好的 Markdown，而非裸 `#` / `**`；代价是前端 CPU 略高，但长文场景可接受 |
| 5W1H 上下文 | **KV 存 session，前端只传 `{sessionId, chapterIndex}`** | 避免重传整篇文章（带宽 + 篡改风险）；7 天 TTL 自动过期；sessionId 为 96-bit 随机 hex |
| YouTube 字幕 | **多路降级 + 可选代理**，而非单一路径 | HTML → Innertube player → get_transcript → timedtext 多 fmt；数据中心 IP 风控是常态，复杂度换成功率 |
| 代理实现 | **`cloudflare:sockets` forward proxy**（绝对 URI） | Workers `fetch` 无法配代理；绕开 `startTls()` 在 workerd 上的坑，比 CONNECT 隧道简单一半 |
| 字幕失败 | **Demo fallback + 金色 banner**，而非静默失败 | 保证演示/开发可跑通；用户明确知道当前是演示数据，不假装成功 |
| Gemini 配置 | **关闭 thinkingBudget + safety `BLOCK_NONE`** | 2.5 系列 thinking 会拖慢首 token；长字幕输入偶发误杀 candidate，此场景输入可控 |
| 代码组织 | **单文件 ~400 行、Hono 路由、TypeScript strict** | 模块边界清晰，便于阅读与二次开发；不引入重型框架 |
| 部署模型 | **纯 Workers + KV + Assets**，无 Node 服务器 | 零冷启、边缘就近；secrets 与 KV id 分离（`wrangler.local.toml`）避免 fork 后配置冲突 |
| AI Gateway | **可选 `CF_AIG_URL` 一行切换** | 直连与 Gateway 共用 `resolveEndpoint()`；key 走 header 不进 gateway 日志；绕开地区限制 |

**亮点摘要**：

1. **端到端 TypeScript**：后端 Prompt 工程、SSE 协议、前端流式解析同一语言栈，类型从 `types.ts` 贯穿到 API 请求体。
2. **双层 prompt 设计**：用户偏好（软）与输出规范（硬）分离，既满足个性化又保证章节可切分、可渲染。
3. **可观测与可降级**：`/api/health`、`/api/debug/gemini` 把「转圈」问题定位到上游；字幕/Gemini 各有独立降级路径，不互相拖死。
4. **产品级 UX 细节**：流式光标、章节旁 `[5W1H]` 按钮注入、抽屉骨架屏、复制全文/本章、回到顶部——在零构建前提下仍做到完整交互。

---

## 已知限制

- **YouTube 对数据中心 IP 的风控**：Cloudflare Workers 的出口 IP 段（以及大部分 webshare 免费代理的 IP 段）有时会被 YouTube 标记为 bot，触发 `timedtext` 限流（429）或 `get_transcript` 的 `FAILED_PRECONDITION`。本项目已实现多路降级，但若一个特定视频在一段时间内对你的出口 IP 全军覆没，会自动回落到内置 demo 字幕。改善方法：
  - 配置 `WEBSHARE_PROXY`（webshare 免费 10 个代理即可），让出口走住宅级或 backbone 代理；
  - 配置 `YT_COOKIE`（从浏览器复制完整登录 cookie），把请求伪装成已登录用户；
  - 或者尝试别的视频。**实测有字幕的主流视频在配置了 cookie + 代理后绝大部分能直接走通。**
- **Gemini 地区限制**：部分 Cloudflare 边缘节点对 `generativelanguage.googleapis.com` 会返回 `User location is not supported for the API use.`。配置 `CF_AIG_URL`（Cloudflare AI Gateway）即可绕开。

---

## 健康检查与排障

| 端点 | 用途 |
|------|------|
| `GET /api/health` | 配置自检：是否注入 key、AI Gateway 形态是否正确、是否配了代理 / cookie |
| `GET /api/debug/gemini` | 触发一次最小 Gemini 调用，把上游 HTTP 状态码 / 错误体直接回前端，定位"网页一直转圈"的根因 |
| `GET /api/session/:id` | 查看某次生成保存到 KV 的完整上下文（用于排查 5W1H） |

最常见的两类问题：

**网页一直转圈，下面是空的** → 多半是 Gemini 上游被拒。打开 `/api/debug/gemini`，看返回里的 `body`。若是 `User location is not supported for the API use.`，按"快速开始"第 4 步配置 `CF_AIG_URL`。

**banner 提示「正在使用演示字幕」** → 字幕抓取触发了 YouTube 的 consent / 验证码 / 限流。参考"已知限制"配置 `WEBSHARE_PROXY` 或 `YT_COOKIE`。

---

## 目录结构

```
.
├── public/                      # 零构建前端，由 Workers Assets 分发
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── src/
│   ├── index.ts                 # Hono 路由：/api/generate /api/5w1h /api/health 等
│   ├── types.ts
│   ├── utils/youtube.ts         # 解析各种形态的 YouTube URL → videoId
│   └── services/
│       ├── transcript.ts        # 字幕抓取（HTML / Innertube / timedtext 多路降级）
│       ├── proxyFetch.ts        # 基于 cloudflare:sockets 的 forward proxy
│       ├── gemini.ts            # Gemini 流式 / JSON 调用 + Prompt 工程
│       ├── markdown.ts          # 按 ## 切分章节
│       ├── session.ts           # KV 上下文存储
│       └── demoTranscript.ts    # 字幕抓取失败时的兜底字幕
├── wrangler.toml
├── tsconfig.json
├── package.json
└── README.md
```

---

## 开发约定

- 单文件控制在 ~400 行内；优先用原生 `fetch` / 标准 Web API，不引入 LLM SDK / 重型框架。
- 改完代码先跑 `npm run typecheck`，TypeScript `strict` 全开。
- 前端零构建：直接 `npm run dev` 看修改效果，不要为前端引入打包器。
- 不要把 secrets 写进 `wrangler.toml`，都走 `wrangler secret put`。

---

## License

MIT
