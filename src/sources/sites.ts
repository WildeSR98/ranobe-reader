/** Адаптеры сайтов-источников оригинала (см. CONTEXT.md: Автопоиск).
 *  На сайтах с антиботом (RoyalRoad — Anubis, Webnovel — TLS/защита)
 *  адаптеров нет: такие оригиналы подключаются через EPUB-импорт. */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface SiteChapter {
  title: string | null;
  ref: string; // ключ главы внутри сайта (номер/путь)
}

export interface SiteSearchResult {
  url: string;   // страница произведения (для toc)
  title: string;
  author: string;
  chapters: number;
}

export interface SiteAdapter {
  id: string;
  label: string;
  search(query: string): Promise<SiteSearchResult[]>;
  toc(url: string): Promise<{ title: string; chapters: SiteChapter[] }>;
  chapterText(chapterRefOrUrl: string): Promise<string[]>;
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

async function getHtml(url: string, retries = 2): Promise<string> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw new Error("unreachable");
}

function paragraphsFrom(html: string): string[] {
  const out: string[] = [];
  const re = /<(?:p|div)[^>]*>([\s\S]*?)<\/(?:p|div)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const t = m[1]
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
    if (t) out.push(t);
  }
  return out;
}

// ---------- Syosetu ----------

const syosetu: SiteAdapter = {
  id: "syosetu",
  label: "Syosetu",

  async search(query) {
    const url = `https://api.syosetu.com/novelapi/api/?out=json&word=${encodeURIComponent(query)}&lim=5&order=favnopoint`;
    const res = await fetch(url, { headers: { "User-Agent": "RanobeReader/1.0" } });
    if (!res.ok) return [];
    const data = await res.json();
    const out: SiteSearchResult[] = [];
    for (const n of Array.isArray(data) ? data.slice(1) : []) {
      const chapters = Number(n.general_all_no ?? 0);
      if (chapters < 10) continue; // блоги/эссе мимо
      out.push({
        url: `https://ncode.syosetu.com/${String(n.ncode).toUpperCase()}/`,
        title: String(n.title ?? ""),
        author: String(n.writer ?? ""),
        chapters,
      });
    }
    return out;
  },

  async toc(url) {
    const html = await getHtml(url);
    const ncode = url.match(/ncode\.syosetu\.com\/([nN0-9a-zA-Z]+)/)?.[1] ?? "";
    const t = html.match(new RegExp(`<a[^>]+href="/${ncode}/\\d+/?".*?<h1[^>]*>([\\s\\S]*?)</h1>`, "i"));
    const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
    const title = titleMatch ? stripTags(titleMatch[1]) : ncode;
    void t;
    const out: SiteChapter[] = [];
    const seen = new Set<string>();
    const re = new RegExp(`<a[^>]+href="/${ncode}/(\\d+)/?"[^>]*>([\\s\\S]*?)</a>`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      out.push({ title: stripTags(m[2]) || null, ref: m[1] });
    }
    out.sort((a, b) => (parseFloat(a.ref ?? "0") || 0) - (parseFloat(b.ref ?? "0") || 0));
    return { title, chapters: out };
  },

  async chapterText(ref) {
    // ref = номер главы; полный url собирает загрузчик (см. library.ts)
    const url = ref.startsWith("http")
      ? ref
      : `https://ncode.syosetu.com/${ref}`;
    const html = ref.includes("/")
      ? await getHtml(ref)
      : await getHtml(url);
    const body =
      html.match(/class="js-novel-text[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1] ??
      html.match(/id="novel_honbun"[\s\S]*?>([\s\S]*?)<\/div>/)?.[1];
    if (!body) throw new Error("Syosetu: текст главы не найден");
    return paragraphsFrom(body).filter((p) => !/^[,.\-—ー\s]*$/.test(p) || p.length > 3);
  },
};

// ---------- Kakuyomu ----------

const kakuyomu: SiteAdapter = {
  id: "kakuyomu",
  label: "Kakuyomu",

  async search(query) {
    const html = await getHtml(`https://kakuyomu.jp/search?q=${encodeURIComponent(query)}`);
    // Уникальные страницы произведений из выдачи (до 5).
    const paths: string[] = [];
    const seenPath = new Set<string>();
    const re = /href="(\/works\/\d+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      if (!seenPath.has(m[1])) {
        seenPath.add(m[1]);
        paths.push(m[1]);
      }
      if (paths.length >= 5) break;
    }

    // Страница выдачи не содержит числа глав — заходим на каждую страницу
    // произведения за реальными данными (главы, автор, точное название).
    const out: SiteSearchResult[] = [];
    for (const path of paths) {
      try {
        const page = await getHtml(`https://kakuyomu.jp${path}`);
        const og = page.match(/property="og:title" content="([^"]+)"/)?.[1];
        const title = (og ? stripTags(og) : stripTags(path)).replace(/\s*-\s*Kakuyomu.*$/i, "").trim();
        const author = stripTags(
          page.match(/class="[^"]*kakuyomu-author[^"]*"[^>]*>([^<]+)</)?.[1] ??
            page.match(/@([A-Za-z0-9_]+)/)?.[0] ?? "",
        );
        const chapters = new Set(
          [...page.matchAll(/href="(\/works\/\d+\/episodes\/\d+)"/g)].map((x) => x[1]),
        ).size;
        if (chapters === 0) continue; // не роман (анонс/эссе)
        out.push({ url: `https://kakuyomu.jp${path}`, title, author, chapters });
      } catch {
        // страница не открылась — пропускаем
      }
    }
    return out;
  },

  async toc(url) {
    const html = await getHtml(url);
    const t =
      html.match(/property="og:title" content="([^"]+)"/)?.[1] ??
      html.match(/<title>([^<]+)<\/title>/)?.[1];
    const title = t ? stripTags(t).replace(/\s*[-–]\s*Kakuyomu.*$/i, "").trim() : url;
    const out: SiteChapter[] = [];
    const seen = new Set<string>();
    const re = /href="(\/works\/\d+\/episodes\/\d+)"[^>]*>([\s\S]*?)<\/a>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      const t2 = stripTags(m[2]);
      if (!t2) continue;
      out.push({ title: t2, ref: m[1] });
    }
    return { title, chapters: out };
  },

  async chapterText(chapterUrl) {
    const url = chapterUrl.startsWith("http")
      ? chapterUrl
      : `https://kakuyomu.jp${chapterUrl}`;
    const html = await getHtml(url);
    const body = html.match(
      /class="widget-episodeBody[\s\S]*?">([\s\S]*?)<\/div>/,
    )?.[1];
    if (!body) throw new Error("Kakuyomu: текст главы не найден");
    return paragraphsFrom(body);
  },
};

export const SITES: Record<string, SiteAdapter> = {
  syosetu,
  kakuyomu,
};

export function siteLabel(source: string): string {
  return SITES[source]?.label ?? source;
}
