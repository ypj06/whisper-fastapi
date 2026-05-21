/**
 * 视见 Vidsight — 前端入口
 *
 * 设计要点：
 *  1. 主文章用 SSE 流式接收。每次拿到 token 都 append 到 buffer，
 *     然后用 markdown-it 把 buffer 重新渲染成 HTML，写入容器。
 *     —— 这样能在流式过程中也正确显示 Markdown 排版，而不是看到原始 *、## 等。
 *  2. 流结束后扫描所有 <h2>，注入「5W1H」按钮。点击 → 调 /api/5w1h 并打开抽屉。
 *  3. 章节索引：服务端 splitChapters 与前端渲染顺序一致（都按 ## 出现顺序）。
 *  4. 所有渲染后的 HTML 都过 DOMPurify。
 */

import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  typographer: true,
});

const $ = (sel) => document.querySelector(sel);

const ui = {
  form: $("#gen-form"),
  urlInput: $("#video-url"),
  fillDemoBtn: $("#fill-demo"),
  forceDemo: $("#force-demo"),
  clearPrefsBtn: $("#clear-prefs"),
  prefTask: $("#pref-task"),
  prefStyle: $("#pref-style"),
  prefAudience: $("#pref-audience"),
  prefConstraints: $("#pref-constraints"),
  submitBtn: $("#submit-btn"),
  stopBtn: $("#stop-btn"),
  copyArticleBtn: $("#copy-article-btn"),
  backToTopBtn: $("#back-to-top"),
  empty: $("#empty-state"),
  article: $("#article"),
  articleMeta: $("#article-meta"),
  articleBody: $("#article-body"),
  streamCursor: $("#streaming-cursor"),
  statusBar: $("#status-bar"),
  statusDot: $("#status-dot"),
  statusText: $("#status-text"),
  metaSource: $("#meta-source"),
  metaTitle: $("#meta-title"),
  metaLink: $("#meta-link"),
  transcriptBtn: $("#transcript-btn"),
  errorBox: $("#error-box"),
  errorText: $("#error-text"),
  fallbackNotice: $("#fallback-notice"),
  fallbackReason: $("#fallback-reason"),
  drawer: $("#drawer"),
  drawerEyebrow: $("#drawer-eyebrow"),
  drawerTitle: $("#drawer-title"),
  drawerBody: $("#drawer-body"),
};

const state = {
  sessionId: null,
  articleBuf: "",
  abortController: null,
  chapters: [], // { index, title }
  transcript: null,
};

/* ----------------------- Presets ----------------------- */

const PRESETS = {
  exec: {
    taskType: "深度商业洞察",
    style: "克制、专业、有洞见的商业财经稿",
    audience: "二级市场基金经理 / VC 投资人",
    constraints: "突出商业模式、单位经济与可投资标的，关键数字要保留",
  },
  dev: {
    taskType: "技术深读",
    style: "工程思维、清晰准确",
    audience: "全栈 / AI 工程师",
    constraints: "保留关键技术名词的英文原文；尽量给出可落地的工程启示",
  },
  casual: {
    taskType: "轻松解读",
    style: "亲切、有点幽默的口语化中文",
    audience: "对 AI 感兴趣但非从业者的普通读者",
    constraints: "回避术语，必要时举生活化的例子",
  },
};

document.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    const preset = PRESETS[chip.dataset.preset];
    if (!preset) return;
    ui.prefTask.value = preset.taskType;
    ui.prefStyle.value = preset.style;
    ui.prefAudience.value = preset.audience;
    ui.prefConstraints.value = preset.constraints;
    $("#advanced").open = true;
  });
});

ui.clearPrefsBtn.addEventListener("click", () => {
  ui.prefTask.value = "";
  ui.prefStyle.value = "";
  ui.prefAudience.value = "";
  ui.prefConstraints.value = "";
  ui.prefTask.focus();
});

ui.fillDemoBtn.addEventListener("click", () => {
  ui.urlInput.value = "https://www.youtube.com/watch?v=xRh2sVcNXQ8";
  ui.urlInput.focus();
});

document.querySelectorAll(".inspo").forEach((btn) => {
  btn.addEventListener("click", () => {
    const url = btn.dataset.url;
    if (!url) return;
    ui.urlInput.value = url;
    ui.urlInput.scrollIntoView({ behavior: "smooth", block: "center" });
    ui.urlInput.focus();
  });
});

ui.copyArticleBtn.addEventListener("click", () => {
  copyText(state.articleBuf.trim(), ui.copyArticleBtn, "复制全文");
});

ui.backToTopBtn.addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
});

window.addEventListener("scroll", () => {
  ui.backToTopBtn.hidden = window.scrollY < 520;
}, { passive: true });

/* ----------------------- 状态显示 ----------------------- */

function setStatus(text, kind = "idle") {
  ui.statusBar.hidden = false;
  ui.statusText.textContent = text;
  ui.statusDot.classList.remove("is-active", "is-done", "is-error");
  if (kind === "active") ui.statusDot.classList.add("is-active");
  if (kind === "done") ui.statusDot.classList.add("is-done");
  if (kind === "error") ui.statusDot.classList.add("is-error");
}

function showError(msg) {
  ui.errorBox.hidden = false;
  ui.errorText.textContent = msg;
}

function hideError() {
  ui.errorBox.hidden = true;
}

function setSubmitting(submitting) {
  ui.submitBtn.disabled = submitting;
  ui.submitBtn.classList.toggle("is-loading", submitting);
  ui.submitBtn.querySelector(".btn__text").textContent = submitting ? "生成中" : "开始生成";
  ui.stopBtn.hidden = !submitting;
}

async function copyText(text, btn, idleText = "复制") {
  if (!text) return;
  const originalText = btn.textContent;
  btn.disabled = true;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      fallbackCopyText(text);
    }
    btn.textContent = "已复制";
  } catch {
    btn.textContent = "复制失败";
  } finally {
    window.setTimeout(() => {
      btn.disabled = false;
      btn.textContent = originalText || idleText;
    }, 1200);
  }
}

function fallbackCopyText(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

/* ----------------------- 渲染 ----------------------- */

function renderArticleBuf() {
  const html = md.render(state.articleBuf);
  ui.articleBody.innerHTML = DOMPurify.sanitize(html, { ADD_ATTR: ["target", "rel"] });
}

function showMeta(meta) {
  ui.empty.hidden = true;
  ui.article.hidden = false;
  ui.streamCursor.hidden = false;

  const bits = [];
  bits.push(meta.source === "youtube" ? "字幕：YouTube 官方" : "字幕：演示数据（fallback）");
  if (meta.language) bits.push(`语言：${meta.language}`);
  ui.articleMeta.textContent = bits.join("　·　");

  ui.metaSource.hidden = false;
  ui.metaSource.textContent = meta.source === "youtube" ? "● 真实字幕" : "● 演示字幕";
  ui.metaSource.style.color = meta.source === "youtube" ? "var(--success)" : "var(--warning)";

  ui.metaTitle.hidden = true;
  ui.metaTitle.textContent = "";
  if (meta.videoUrl) {
    ui.metaLink.hidden = false;
    ui.metaLink.href = meta.videoUrl;
  }

  state.transcript = meta.transcript
    ? {
        source: meta.source,
        title: meta.title,
        language: meta.language,
        cueCount: meta.transcript.cueCount,
        fullText: meta.transcript.fullText || "",
      }
    : null;
  ui.transcriptBtn.hidden = !state.transcript?.fullText;

  if (meta.transcriptError || meta.source === "demo") {
    ui.fallbackNotice.hidden = false;
    if (meta.transcriptError) {
      const reasonMap = {
        "no-captions": "视频可能没有可用字幕",
        blocked: "YouTube 触发了验证码 / 同意墙",
        network: "网络异常",
        parse: "字幕解析失败",
      };
      ui.fallbackReason.textContent = `原因：${reasonMap[meta.transcriptError.reason] || meta.transcriptError.message}。已回落到内置 Demo 字幕，演示效果不受影响。`;
    } else {
      ui.fallbackReason.textContent = "你勾选了「强制使用演示字幕」，下方文章基于内置 Demo 字幕生成。";
    }
  } else {
    ui.fallbackNotice.hidden = true;
  }
}

/* ----------------------- 章节按钮注入 ----------------------- */

function injectChapterButtons() {
  const headings = ui.articleBody.querySelectorAll("h2");
  headings.forEach((h2, idx) => {
    if (h2.dataset.bound) return;
    h2.dataset.bound = "1";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chapter-btn";
    btn.innerHTML = `<span>5W1H</span>`;
    btn.title = "查看本章节的 5W1H 总结";
    btn.addEventListener("click", () => requestFiveW1H(idx, h2.textContent.trim(), btn));
    h2.appendChild(btn);
  });
}

/* ----------------------- 5W1H 抽屉 ----------------------- */

function openDrawer(title, eyebrow = "5W1H · 章节结构化总结") {
  ui.drawer.hidden = false;
  ui.drawer.setAttribute("aria-hidden", "false");
  ui.drawerEyebrow.textContent = eyebrow;
  ui.drawerTitle.textContent = title;
  ui.drawerBody.innerHTML = `
    <div class="skeleton-grid">
      <div class="skeleton-card"></div><div class="skeleton-card"></div>
      <div class="skeleton-card"></div><div class="skeleton-card"></div>
      <div class="skeleton-card"></div><div class="skeleton-card"></div>
    </div>
  `;
  document.body.style.overflow = "hidden";
}

function closeDrawer() {
  ui.drawer.hidden = true;
  ui.drawer.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

ui.transcriptBtn.addEventListener("click", () => {
  if (!state.transcript?.fullText) {
    alert("当前还没有可查看的字幕数据。");
    return;
  }
  openTranscriptDrawer();
});

ui.drawer.addEventListener("click", (e) => {
  if (e.target.matches("[data-close]") || e.target.closest("[data-close]")) {
    closeDrawer();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !ui.drawer.hidden) closeDrawer();
});

const W_LABELS = [
  { key: "who", zh: "WHO", label: "谁" },
  { key: "what", zh: "WHAT", label: "做了什么" },
  { key: "when", zh: "WHEN", label: "何时" },
  { key: "where", zh: "WHERE", label: "何地" },
  { key: "why", zh: "WHY", label: "为何" },
  { key: "how", zh: "HOW", label: "如何" },
];

function renderFiveW1H(result) {
  const cards = W_LABELS.map(({ key, zh, label }) => {
    const text = result[key] || "—";
    return `
      <div class="w-card">
        <div class="w-card__label">${zh}</div>
        <div class="w-card__key">${label}</div>
        <div class="w-card__text">${escapeHtml(text)}</div>
      </div>`;
  }).join("");
  const copyPayload = formatFiveW1H(result);
  ui.drawerBody.innerHTML = `
    <div class="drawer-actions">
      <button type="button" class="ghost-btn" id="copy-fivew-btn">复制本章 5W1H</button>
    </div>
    <div class="w-grid">${cards}</div>
  `;
  $("#copy-fivew-btn").addEventListener("click", (e) => {
    copyText(copyPayload, e.currentTarget, "复制本章 5W1H");
  });
}

function formatFiveW1H(result) {
  return W_LABELS.map(({ key, zh, label }) => {
    const text = result[key] || "—";
    return `${zh} ${label}：${text}`;
  }).join("\n");
}

function openTranscriptDrawer() {
  const transcript = state.transcript;
  const sourceLabel = transcript.source === "youtube" ? "YouTube 官方字幕" : "演示字幕";
  const meta = [
    sourceLabel,
    transcript.language ? `语言：${transcript.language}` : "",
    Number.isFinite(transcript.cueCount) ? `${transcript.cueCount} 段字幕` : "",
  ].filter(Boolean).join(" · ");

  openDrawer(transcript.title || "本次字幕数据", "TRANSCRIPT · 原始字幕");
  ui.drawerBody.innerHTML = `
    <section class="transcript-viewer">
      <div class="transcript-viewer__meta">${escapeHtml(meta)}</div>
      <pre class="transcript-viewer__text">${escapeHtml(transcript.fullText)}</pre>
    </section>
  `;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function requestFiveW1H(chapterIndex, chapterTitle, btn) {
  if (!state.sessionId) {
    alert("会话尚未建立，请先生成文章。");
    return;
  }
  const cleanTitle = chapterTitle.replace(/\s*5W1H\s*$/i, "").trim();
  openDrawer(cleanTitle);

  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spin"></span><span>分析中</span>`;

  try {
    const res = await fetch("/api/5w1h", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: state.sessionId, chapterIndex }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    renderFiveW1H(data.result);
  } catch (e) {
    ui.drawerBody.innerHTML = `<div class="drawer__error">5W1H 生成失败：${escapeHtml(e.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

/* ----------------------- 提交 + SSE ----------------------- */

ui.stopBtn.addEventListener("click", () => {
  if (state.abortController) {
    state.abortController.abort();
  }
});

ui.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideError();

  const url = ui.urlInput.value.trim();
  if (!url) {
    showError("请输入 YouTube 链接");
    return;
  }

  const preferences = {
    taskType: ui.prefTask.value.trim() || undefined,
    style: ui.prefStyle.value.trim() || undefined,
    audience: ui.prefAudience.value.trim() || undefined,
    constraints: ui.prefConstraints.value.trim() || undefined,
  };

  state.articleBuf = "";
  state.sessionId = null;
  state.chapters = [];
  state.transcript = null;
  ui.articleBody.innerHTML = "";
  ui.articleMeta.textContent = "";
  ui.empty.hidden = true;
  ui.article.hidden = false;
  ui.streamCursor.hidden = false;
  ui.fallbackNotice.hidden = true;
  ui.metaSource.hidden = true;
  ui.metaTitle.hidden = true;
  ui.metaTitle.textContent = "";
  ui.metaLink.hidden = true;
  ui.metaLink.removeAttribute("href");
  ui.transcriptBtn.hidden = true;
  ui.copyArticleBtn.hidden = true;

  setSubmitting(true);
  setStatus("正在抓取字幕…", "active");

  const ac = new AbortController();
  state.abortController = ac;

  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        preferences,
        forceDemo: ui.forceDemo.checked,
      }),
      signal: ac.signal,
    });

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      let msg = `请求失败 (${res.status})`;
      try {
        const j = JSON.parse(text);
        if (j.error) msg = j.error;
      } catch {}
      throw new Error(msg);
    }

    let serverError = null;
    let sawAnyEvent = false;
    await readSse(res.body, {
      onEvent: (event, data) => {
        sawAnyEvent = true;
        if (event === "meta") {
          state.sessionId = data.sessionId;
          showMeta(data);
          setStatus("AI 正在生成…", "active");
        } else if (event === "token") {
          state.articleBuf += data.text;
          renderArticleBuf();
          autoScrollIfAtBottom();
        } else if (event === "done") {
          state.chapters = data.chapters || [];
          renderArticleBuf();
          injectChapterButtons();
          ui.streamCursor.hidden = true;
          ui.copyArticleBtn.hidden = !state.articleBuf.trim();
          setStatus(`生成完成 · ${state.chapters.length} 个章节，点击章节标题旁的 5W1H 查看`, "done");
        } else if (event === "error") {
          // 服务器主动告知错误；记录下来在流结束后再抛，避免被 readSse 的 try/catch 吞掉
          serverError = new Error(data.message || "服务端返回错误");
        }
      },
    });
    if (serverError) throw serverError;
    if (!sawAnyEvent) throw new Error("服务端没有返回任何事件（可能流被中断）");
    if (!state.articleBuf.trim()) {
      throw new Error("AI 未返回任何内容，请检查服务端 GEMINI_API_KEY / 模型 / 网络（可访问 /api/health 或 /api/debug/gemini 进一步排查）");
    }
  } catch (e) {
    if (e.name === "AbortError") {
      setStatus("已停止", "error");
      ui.streamCursor.hidden = true;
    } else {
      showError(e.message);
      setStatus("出错了", "error");
      ui.streamCursor.hidden = true;
    }
  } finally {
    setSubmitting(false);
    state.abortController = null;
  }
});

function autoScrollIfAtBottom() {
  const threshold = 160;
  const distance = document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
  if (distance < threshold) {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
  }
}

/**
 * 解析 SSE 流（fetch + ReadableStream）
 * 每个事件块用 \n\n 分割，事件块内每行 "key: value"
 */
async function readSse(body, { onEvent }) {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buf = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    // 容忍上游 CRLF 行尾，统一成 \n 后按 \n\n 拆事件
    buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

    let idx;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);

      let event = "message";
      const dataLines = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length === 0) continue;
      const payload = dataLines.join("\n");
      let json;
      try {
        json = JSON.parse(payload);
      } catch {
        continue; // 跳过非 JSON 心跳 / 注释
      }
      onEvent(event, json); // 不再 try/catch 吞错；让上层处理
    }
  }
}
