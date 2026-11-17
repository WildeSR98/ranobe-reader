import type { ChapterRef } from "./ranobelib";
import { sortKey } from "./ranobelib";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const MIN_INTERVAL = 700;

let lastCall = 0;

async function get(url: string, retries = 3): Promise<string> {
  const wait = MIN_INTERVAL - (Date.now() - lastCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) throw new Error(`Syosetu ${res.status}`);
      return await res.text();
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error("unreachable");
}

export function parseNovelId(url: string): string {
  const m = url.match(/ncode\.syosetu\.com\/([nN0-9a-zA-Z]+)/);
  if (!m) throw new Error("Это не ссылка на Syosetu");
  return m[1];
}

function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function toc(novelId: string): Promise<{ title: string; chapters: ChapterRef[] }> {
  const html = await get(`https://ncode.syosetu.com/${novelId}/`);
  const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  const title = titleMatch ? stripTags(titleMatch[1]) : novelId;

  const out: ChapterRef[] = [];
  const seen = new Set<string>();
  const linkRe = new RegExp(`href="/${novelId}/([0-9]+)/?":[^>]*`, "g");
  // Проще: ищем все ссылки на главы.
  const re = new RegExp(`<a[^>]+href="/${novelId}/(\\d+)/?"[^>]*>([\\s\\S]*?)</a>`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const n = m[1];
    if (seen.has(n)) continue;
    seen.add(n);
    out.push({
      volume: "1",
      number: n,
      title: stripTags(m[2]) || null,
      sortKey: sortKey("1", n),
      ref: n,
    });
  }
  out.sort((a, b) => a.sortKey - b.sortKey);
  if (!out.length) throw new Error("Syosetu: оглавление пустое");
  void linkRe;
  return { title, chapters: out };
}

export async function chapterText(novelId: string, number: string): Promise<string[]> {
  const html = await get(`https://ncode.syosetu.com/${novelId}/${number}/`);
  // Текст: контейнер js-novel-text (новая вёрстка) или #novel_honbun (старая).
  const container =
    html.match(/class="js-novel-text[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1] ??
    html.match(/id="novel_honbun"[\s\S]*?>([\s\S]*?)<\/div>/)?.[1];
  if (!container) throw new Error("Syosetu: текст главы не найден");
  const paras: string[] = [];
  const re = /<p[^>]*>([\s\S]*?)<\/p>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(container))) {
    const t = stripTags(m[1]);
    if (t) paras.push(t);
  }
  return paras;
}
