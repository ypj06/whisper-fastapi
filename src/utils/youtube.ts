/**
 * 从各种 YouTube URL 中解析 videoId
 *  - https://www.youtube.com/watch?v=xxx
 *  - https://youtu.be/xxx
 *  - https://www.youtube.com/embed/xxx
 *  - https://www.youtube.com/shorts/xxx
 *  - 直接传入 11 位 videoId
 */
export function parseVideoId(input: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();

  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    const host = url.hostname.replace(/^www\./, "");

    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }

    if (host.endsWith("youtube.com")) {
      const v = url.searchParams.get("v");
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;

      const segments = url.pathname.split("/").filter(Boolean);
      const [head, id] = segments;
      if ((head === "embed" || head === "shorts" || head === "live") && id && /^[a-zA-Z0-9_-]{11}$/.test(id)) {
        return id;
      }
    }
  } catch {
    // not a URL
  }
  return null;
}
