import JSZip from "jszip";

export interface ImportedChapter {
  title: string | null;
  paragraphs: string[];
}

function textFromHtml(html: string): string[] {
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

function unzipSyncLike(b64: string) {
  // JSZip async-обёртка: единая точка для epub
  return JSZip.loadAsync(b64, { base64: true });
}

async function epubChapters(b64: string): Promise<{ title: string | null; chapters: ImportedChapter[] }> {
  const zip = await unzipSyncLike(b64);

  const container = await zip.file("META-INF/container.xml")?.async("string");
  if (!container) throw new Error("EPUB: нет container.xml");
  const opfPath = container.match(/full-path="([^"]+)"/)?.[1];
  if (!opfPath) throw new Error("EPUB: не найден OPF");
  const dir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/")) : "";

  const opf = await zip.file(opfPath)?.async("string");
  if (!opf) throw new Error("EPUB: OPF не прочитан");
  const title = opf.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/)?.[1]?.trim() ?? null;

  const items = new Map<string, string>();
  for (const m of opf.matchAll(/<item\b[^>]*>/g)) {
    const tag = m[0];
    const id = tag.match(/id="([^"]+)"/)?.[1];
    const href = tag.match(/href="([^"]+)"/)?.[1];
    if (id && href) items.set(id, href);
  }
  const spine = [...opf.matchAll(/<itemref[^>]*idref="([^"]+)"/g)].map((m) => m[1]);

  const chapters: ImportedChapter[] = [];
  for (const idref of spine) {
    const href = items.get(idref);
    if (!href || !/\.(xhtml|html|htm)$/i.test(href)) continue;
    const doc = await zip.file(dir ? `${dir}/${href}` : href)?.async("string");
    if (!doc) continue;
    const paragraphs = textFromHtml(doc);
    if (!paragraphs.length) continue;
    const first = paragraphs[0];
    chapters.push({
      title: first.length <= 80 ? first : null,
      paragraphs,
    });
  }
  if (!chapters.length) throw new Error("EPUB: глав с текстом не найдено");
  return { title, chapters };
}

const HEADING = /^\s*((?:Глава|ГЛАВА|Chapter|CHAPTER|Пролог|Эпилог|Epilogue)\s*[0-9A-Za-zА-Яа-яёЁ.\-]*)\s*$/;

function txtChapters(content: string): ImportedChapter[] {
  const lines = content.split(/\r?\n/);
  const heads: { line: number; text: string }[] = [];
  lines.forEach((l, i) => {
    const m = HEADING.exec(l.trim());
    if (m) heads.push({ line: i, text: m[1].trim() });
  });

  const chapters: ImportedChapter[] = [];
  if (heads.length >= 2) {
    const bounds = heads.map((h) => h.line).concat([lines.length]);
    heads.forEach((h, k) => {
      const body = lines.slice(h.line + 1, bounds[k + 1]).join("\n");
      const paras = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
      if (paras.length) chapters.push({ title: h.text, paragraphs: paras });
    });
  } else {
    const paras = content.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    for (let i = 0; i < paras.length; i += 120) {
      chapters.push({ title: null, paragraphs: paras.slice(i, i + 120) });
    }
  }
  if (!chapters.length) throw new Error("TXT: файл пуст");
  return chapters;
}

/** Импорт .epub или .txt (uri из DocumentPicker). Возвращает название и главы. */
export async function importFile(
  uri: string,
  name: string,
): Promise<{ title: string; chapters: ImportedChapter[] }> {
  const lower = name.toLowerCase();
  if (lower.endsWith(".epub")) {
    const { readAsStringAsync, EncodingType } = await import("expo-file-system");
    const b64 = await readAsStringAsync(uri, { encoding: EncodingType.Base64 });
    const { title, chapters } = await epubChapters(b64);
    return { title: title ?? name, chapters };
  }
  if (lower.endsWith(".txt")) {
    const { readAsStringAsync, EncodingType } = await import("expo-file-system");
    const content = await readAsStringAsync(uri, { encoding: EncodingType.UTF8 });
    const chapters = txtChapters(content);
    return { title: name.replace(/\.txt$/i, ""), chapters };
  }
  throw new Error("Поддерживаются .epub и .txt");
}
