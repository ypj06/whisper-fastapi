/**
 * 极简 Markdown 章节切分：按 ## 一级章节标题分块。
 * 不解析整篇 Markdown，因为渲染由前端 markdown-it 完成。
 */

import type { ChapterMeta } from "../types";

export function splitChapters(markdown: string): ChapterMeta[] {
  const lines = markdown.split(/\r?\n/);
  const chapters: ChapterMeta[] = [];
  let current: { title: string; buf: string[] } | null = null;

  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m && !line.startsWith("###")) {
      if (current) {
        chapters.push({
          index: chapters.length,
          title: current.title,
          content: current.buf.join("\n").trim(),
        });
      }
      current = { title: m[1] ?? "", buf: [] };
    } else if (current) {
      current.buf.push(line);
    }
    // 标题前的内容（# 一级标题 / 简介）直接忽略，5W1H 只针对章节
  }
  if (current) {
    chapters.push({
      index: chapters.length,
      title: current.title,
      content: current.buf.join("\n").trim(),
    });
  }
  return chapters;
}
