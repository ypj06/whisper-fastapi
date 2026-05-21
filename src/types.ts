/**
 * 全局类型定义
 */

export interface Env {
  SESSIONS: KVNamespace;
  ASSETS: Fetcher;
  GEMINI_API_KEY: string;
  GEMINI_MODEL?: string;
  DEMO_FALLBACK?: string;
  WEBSHARE_PROXY?: string;
  /**
   * 可选：YouTube 登录态 cookie 串（"name=value; name2=value2; ..."）。
   * 用于绕开数据中心 / webshare 共享 IP 上的 "Sign in to confirm you're not a bot"。
   * 最少需要 SAPISID / __Secure-3PSID / __Secure-3PAPISID 等条目。
   */
  YT_COOKIE?: string;
  /**
   * 可选：Cloudflare AI Gateway 的 google-ai-studio base url。
   * 形如 https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/google-ai-studio
   * 配置后可绕开 Gemini 对部分 Cloudflare 出口 IP 的地区限制。
   */
  CF_AIG_URL?: string;
  /**
   * 可选：当 AI Gateway 开启了 "Authenticated Gateway" 时所需的 token。
   * 会通过 `cf-aig-authorization: Bearer <token>` 头携带。
   * 在 Cloudflare Dashboard → AI Gateway → 你的 gateway → API Keys 创建。
   */
  CF_AIG_TOKEN?: string;
}

/** 用户的生成偏好（可选） */
export interface GenerationPreferences {
  taskType?: string;   // 任务类型：如「深度解读」「快速速览」「金句提炼」
  style?: string;      // 输出风格：如「学术」「轻松口语」「商业洞察」
  audience?: string;   // 目标受众：如「投资人」「开发者」「普通读者」
  constraints?: string; // 约束条件：如「不超过 3000 字」「重点突出 AI 商业模式」
}

/** 字幕片段（带时间戳便于后续做高级特性） */
export interface TranscriptCue {
  start: number;  // seconds
  duration: number;
  text: string;
}

export interface TranscriptResult {
  source: "youtube" | "demo";
  videoId: string;
  title?: string;
  author?: string;
  language: string;
  cues: TranscriptCue[];
  /** 拼接好的纯文本字幕，方便直接喂给 LLM */
  fullText: string;
}

/** 服务端为单次生成保存的上下文（KV） */
export interface SessionContext {
  id: string;
  createdAt: number;
  videoId: string;
  videoTitle?: string;
  videoUrl: string;
  preferences: GenerationPreferences;
  transcript: {
    source: "youtube" | "demo";
    language: string;
    fullText: string;
  };
  /** 生成完成后的最终中文文章（HTML / Markdown 原文） */
  article: string;
  /** 文章按章节切分后的列表（基于 ## 标题） */
  chapters: ChapterMeta[];
}

export interface ChapterMeta {
  index: number;
  title: string;
  /** 章节正文（Markdown） */
  content: string;
}

export interface FiveW1H {
  who: string;
  what: string;
  when: string;
  where: string;
  why: string;
  how: string;
}
