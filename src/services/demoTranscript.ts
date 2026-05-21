/**
 * Demo 字幕：当 YouTube 抓取失败时使用。
 *
 * 对照视频：https://www.youtube.com/watch?v=xRh2sVcNXQ8
 * 《对话 Marc Andreessen：AI 革命的万亿美金之问》
 *
 * 这里整理了一份覆盖核心讨论的英文转写片段（节选+精炼），
 * 足以驱动 Gemini 产出包含多章节的中文对话长文。
 */

import type { TranscriptCue } from "../types";

interface DemoTranscript {
  videoId: string;
  title: string;
  author: string;
  language: string;
  cues: TranscriptCue[];
}

const RAW: { t: number; d: number; text: string }[] = [
  { t: 0,    d: 12, text: "Welcome back. Today I'm sitting down with Marc Andreessen to talk about what may be the single biggest investable trend of our lifetime: the AI revolution." },
  { t: 12,   d: 14, text: "Marc, you've called this a trillion-dollar question. What do you actually mean by that?" },
  { t: 26,   d: 18, text: "Look, we're watching software eat the world in a much more literal sense now. AI is the first technology in fifty years that simultaneously expands revenue and compresses cost." },
  { t: 44,   d: 16, text: "On the revenue side, consumer subscriptions are scaling faster than anything we've seen. ChatGPT went from zero to hundreds of millions of paying or active users in under two years." },
  { t: 60,   d: 18, text: "On the enterprise side, companies are paying per token, per seat, or directly tying spend to business outcomes — that's a fundamentally new pricing surface." },
  { t: 78,   d: 14, text: "And the unit economics keep getting better. GPU supply is improving, data centers are coming online, inference cost is dropping maybe ten-x a year." },
  { t: 92,   d: 16, text: "So the very same dollar of demand buys more intelligence each quarter — which then unlocks new use cases that weren't economical before." },
  { t: 108,  d: 14, text: "Let's talk about the agentic shift. Many people now believe 2025 and 2026 are the years agents go mainstream." },
  { t: 122,  d: 16, text: "Right. An agent isn't just a chatbot — it's a system that can plan, call tools, browse, write code, and complete multi-step tasks with minimal supervision." },
  { t: 138,  d: 18, text: "In the enterprise that means knowledge work gets unbundled. Tasks that used to require a junior analyst, a paralegal, or a customer support rep can be done by an agent inside an existing SaaS workflow." },
  { t: 156,  d: 14, text: "And for consumers it means the browser, the operating system, and the assistant all start to merge. The interface becomes intent, not clicks." },
  { t: 170,  d: 16, text: "But there's a real moat question here. If everyone has access to similar foundation models, where does durable advantage come from?" },
  { t: 186,  d: 18, text: "Three places: proprietary data, distribution to end users, and what I call workflow gravity — the deeper an agent is wired into a customer's actual process, the harder it is to rip out." },
  { t: 204,  d: 14, text: "We're also seeing a new generation of vertical AI companies. Legal, healthcare, finance, manufacturing — each gets its own native AI-first stack." },
  { t: 218,  d: 16, text: "These aren't SaaS-with-AI-features. They're AI-natives that re-imagine the entire workflow, often charging based on outcomes rather than seats." },
  { t: 234,  d: 14, text: "Let's switch to infrastructure. Sovereign AI, energy, chips — how do you think about the picks-and-shovels layer?" },
  { t: 248,  d: 18, text: "We are entering a build-out comparable to the railroads or the early internet. Hundreds of billions in capex into data centers, power generation, networking and custom silicon." },
  { t: 266,  d: 16, text: "Nation states now treat compute as strategic. Sovereign AI means having your own models, your own data, your own infrastructure inside your borders." },
  { t: 282,  d: 14, text: "Energy is the binding constraint. If you can't get a gigawatt online, you can't train the next-generation model." },
  { t: 296,  d: 16, text: "Which is why we're seeing AI companies sign nuclear deals, geothermal deals, modular reactor deals. Energy is the new GPU." },
  { t: 312,  d: 14, text: "What about open source versus closed source? That debate seems to be heating up again." },
  { t: 326,  d: 18, text: "Open source models are now roughly twelve months behind the frontier and closing. For most enterprise tasks the gap doesn't matter — what matters is control, cost and customization." },
  { t: 344,  d: 14, text: "And politically, open source models will be how a lot of the world participates in AI without depending on two or three U.S. labs." },
  { t: 358,  d: 16, text: "Let's get tactical. For a founder building today, what would you actually do differently in 2026 versus 2023?" },
  { t: 374,  d: 18, text: "First, assume models will become commodities and ten times cheaper every year. Don't build a business that requires today's prices to work." },
  { t: 392,  d: 14, text: "Second, build for agents, not for humans clicking buttons. Your customer might literally be another piece of software." },
  { t: 406,  d: 16, text: "Third, own a proprietary data loop. Every interaction should make your system smarter than the foundation model alone." },
  { t: 422,  d: 14, text: "And finally — distribution still wins. Pick a real market, find your wedge, and go hard." },
  { t: 436,  d: 16, text: "Last question. What's the risk people are underestimating right now?" },
  { t: 452,  d: 18, text: "Two things. One: regulatory capture — a handful of incumbents trying to lock in their position by writing the rules. Two: complacency about how fast capabilities are still improving." },
  { t: 470,  d: 14, text: "The honest answer is we have not seen the ceiling yet. Every six months we are surprised again." },
  { t: 484,  d: 14, text: "Marc, thank you. This was a fantastic conversation." },
  { t: 498,  d: 8,  text: "Thanks for having me. Always good." },
];

export const DEMO_TRANSCRIPT: DemoTranscript = {
  videoId: "xRh2sVcNXQ8",
  title: "对话 Marc Andreessen：AI 革命的万亿美金之问 (Demo Transcript)",
  author: "a16z",
  language: "en",
  cues: RAW.map((r) => ({ start: r.t, duration: r.d, text: r.text })),
};
