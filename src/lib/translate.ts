import { db } from "../db";
import { getBook, getChapters, type ChapterRow } from "./library";

// ---------- Провайдер: онлайн-Google (вежливый темп, см. ADR-0002) ----------

const MIN_INTERVAL = 3500;
const BLOCK_WAIT = 45000;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

let lastCall = 0;
let queueTail: Promise<any> = Promise.resolve(); // сериализует все вызовы

async function googleCall(text: string, target = "ru"): Promise<string> {
  const exec = async () => {
    const endpoints: [string, string][] = [
      [
        `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=${target}&q=${encodeURIComponent(text)}`,
        "t",
      ],
      [
        `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${target}&dt=t&q=${encodeURIComponent(text)}`,
        "single",
      ],
    ];
    for (const [url, kind] of endpoints) {
      const wait = MIN_INTERVAL + Math.random() * 1500 - (Date.now() - lastCall);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastCall = Date.now();
      try {
        const res = await fetch(url, { headers: { "User-Agent": UA } });
        if (!res.ok) {
          await new Promise((r) => setTimeout(r, BLOCK_WAIT));
          continue;
        }
        const raw = await res.text();
        if (!raw.trim().startsWith("[")) {
          // «Sorry…» HTML — IP временно помечен
          await new Promise((r) => setTimeout(r, BLOCK_WAIT));
          continue;
        }
        const data = JSON.parse(raw);
        if (kind === "t") {
          const first = data[0];
          if (Array.isArray(first) && typeof first[0] === "string") return first[0];
          if (Array.isArray(first) && Array.isArray(first[0]))
            return first.map((seg: any) => seg[0]).join("");
        } else if (data?.[0]) {
          return data[0].map((seg: any) => seg?.[0] ?? "").join("");
        }
      } catch {
        // пробуем следующий эндпоинт
      }
    }
    throw new Error("Google: эндпоинты недоступны (rate-limit)");
  };
  // Все вызовы идут строго по очереди — темп не нарушается из параллельных задач.
  const run = queueTail.then(exec, exec);
  queueTail = run.catch(() => {});
  return run;
}

function applyGlossary(text: string, glossary: Record<string, string>): string {
  let out = text;
  for (const [src, ru] of Object.entries(glossary)) {
    if (src && ru) out = out.replace(new RegExp(`(?<![\\w])${src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`, "g"), ru);
  }
  return out;
}

export async function translateBlocks(blocks: string[], glossary: Record<string, string>): Promise<string[]> {
  const out = [...blocks];
  // группы по ~2000 символов, join "\n\n"
  const groups: number[][] = [];
  let cur: number[] = [];
  let size = 0;
  blocks.forEach((b, i) => {
    if (cur.length && size + b.length > 2000) {
      groups.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(i);
    size += b.length;
  });
  if (cur.length) groups.push(cur);

  for (const g of groups) {
    const joined = g.map((i) => applyGlossary(blocks[i], glossary)).join("\n\n");
    const translated = await googleCall(joined);
    const parts = translated.split("\n\n");
    if (parts.length === g.length) {
      g.forEach((idx, j) => (out[idx] = parts[j].trim()));
    } else {
      for (const idx of g) {
        out[idx] = (await googleCall(applyGlossary(blocks[idx], glossary))).trim();
      }
    }
  }
  return out;
}

// ---------- Очередь перевода (работает при открытом приложении) ----------

type Job = { chapterId: number; provider: string };
const queue: Job[] = [];
let running = false;

const listeners = new Set<() => void>();
export function onQueueChange(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
function notify() {
  listeners.forEach((fn) => fn());
}

export function queueStatus() {
  return { pending: queue.length, running };
}

export function enqueue(chapterIds: number[], provider = "google") {
  for (const id of chapterIds) queue.push({ chapterId: id, provider });
  notify();
  void drain();
}

async function drain() {
  if (running) return;
  running = true;
  notify();
  while (queue.length) {
    const job = queue.shift()!;
    try {
      await translateChapter(job.chapterId, job.provider);
    } catch (e) {
      console.warn("translate failed", job.chapterId, e);
    }
    notify();
  }
  running = false;
  notify();
}

export function glossaryOf(bookId: number): Record<string, string> {
  const rows = db.getAllSync<{ term_src: string; term_ru: string }>(
    "SELECT term_src, term_ru FROM glossary WHERE book_id = ?",
    [bookId],
  );
  return Object.fromEntries(rows.map((r) => [r.term_src, r.term_ru]));
}

export async function translateChapter(chapterId: number, provider: string) {
  const ch = db.getFirstSync<ChapterRow>("SELECT * FROM chapters WHERE id = ?", [chapterId]);
  if (!ch) return;
  const book = getBook(ch.book_id);
  if (!book) return;

  const { ensureChapterText } = await import("./library");
  await ensureChapterText(book, ch); // текст мог быть ещё не скачан

  const content = db.getFirstSync<{ body_json: string; orig_json: string | null }>(
    "SELECT body_json, orig_json FROM chapter_content WHERE chapter_id = ?",
    [chapterId],
  )!;
  const blocks: string[] = JSON.parse(content.orig_json ?? content.body_json);

  let translated: string[];
  if (provider === "google") {
    translated = await translateBlocks(blocks, glossaryOf(book.id));
  } else {
    throw new Error(`Провайдер ${provider} пока не подключён`);
  }

  db.runSync(
    "UPDATE chapter_content SET body_json = ?, orig_json = ? WHERE chapter_id = ?",
    [JSON.stringify(translated), JSON.stringify(blocks), chapterId],
  );
  db.runSync(
    "UPDATE chapters SET origin = 'mt', provider = ?, updated_at = datetime('now') WHERE id = ?",
    [provider, chapterId],
  );
}

/** Перевести вперёд N глав-оригиналов. */
export function translateAhead(bookId: number, count: number, provider = "google"): number {
  const ids = db.getAllSync<{ id: number }>(
    "SELECT id FROM chapters WHERE book_id = ? AND origin = 'orig' ORDER BY sort_key LIMIT ?",
    [bookId, count],
  ).map((r) => r.id);
  if (ids.length) enqueue(ids, provider);
  return ids.length;
}

/** Главы оригинала, готовые к переводу (для объединения со сшивкой). */
export function alignOriginal(
  bookId: number,
  source: string,
  url: string,
  chapters: { title: string | null; ref: string | null }[],
  alignNative: string,
  alignOriginal: number,
): number {
  const anchor = db.getFirstSync<{ sort_key: number; volume: string; number: string }>(
    "SELECT sort_key, volume, number FROM chapters WHERE book_id = ? AND source = 'ranobelib' AND number = ? ORDER BY sort_key DESC LIMIT 1",
    [bookId, alignNative],
  );
  if (!anchor) throw new Error(`Глава ${alignNative} не найдена среди глав перевода`);
  const baseNumber = parseInt(parseFloat(anchor.number).toFixed(0));

  db.runSync(
    "DELETE FROM chapter_content WHERE chapter_id IN (SELECT id FROM chapters WHERE book_id = ? AND source = ?)",
    [bookId, source],
  );
  db.runSync("DELETE FROM chapters WHERE book_id = ? AND source = ?", [bookId, source]);

  let count = 0;
  chapters.forEach((ch, idx) => {
    db.runSync(
      "INSERT INTO chapters(book_id, source, volume, number, title, sort_key, origin, url) VALUES(?,?,?,?,?,?,'orig',?)",
      [bookId, source, anchor.volume, String(baseNumber + idx + 1), ch.title, anchor.sort_key + idx + 1, ch.ref],
    );
    count++;
  });
  db.runSync(
    "INSERT INTO source_links(book_id, kind, source, url, config_json) VALUES(?, 'original', ?, ?, ?) ON CONFLICT(book_id, kind, source) DO UPDATE SET url = excluded.url, config_json = excluded.config_json",
    [bookId, source, url, JSON.stringify({ align_native: alignNative, align_original: alignOriginal })],
  );
  return count;
}

export function detachOriginal(bookId: number) {
  db.runSync(
    "DELETE FROM chapter_content WHERE chapter_id IN (SELECT id FROM chapters WHERE book_id = ? AND source != 'ranobelib')",
    [bookId],
  );
  db.runSync("DELETE FROM chapters WHERE book_id = ? AND source != 'ranobelib'", [bookId]);
  db.runSync("DELETE FROM source_links WHERE book_id = ? AND kind = 'original'", [bookId]);
}

export function getGlossaryList(bookId: number) {
  return db.getAllSync<{ id: number; term_src: string; term_ru: string }>(
    "SELECT id, term_src, term_ru FROM glossary WHERE book_id = ? ORDER BY term_src",
    [bookId],
  );
}

export function addGlossaryEntry(bookId: number, termSrc: string, termRu: string) {
  db.runSync(
    "INSERT INTO glossary(book_id, term_src, term_ru) VALUES(?,?,?) ON CONFLICT(book_id, term_src) DO UPDATE SET term_ru = excluded.term_ru",
    [bookId, termSrc, termRu],
  );
}

export function deleteGlossaryEntry(id: number) {
  db.runSync("DELETE FROM glossary WHERE id = ?", [id]);
}

export function getBookChapters(bookId: number) {
  return getChapters(bookId);
}
