import { db, ORDER_BY } from "../db";
import * as ranobelib from "../sources/ranobelib";
import * as syosetu from "../sources/syosetu";
import { SITES } from "../sources/sites";

export interface ChapterRow {
  id: number;
  book_id: number;
  source: string;
  volume: string;
  number: string;
  title: string | null;
  sort_key: number;
  origin: "native" | "orig" | "mt";
  provider: string | null;
  url: string | null;
}

export interface BookRow {
  id: number;
  source: string;
  source_slug: string;
  title_ru: string;
  [k: string]: any;
}

export function getBook(bookId: number): BookRow | null {
  return (
    db.getFirstSync<BookRow>("SELECT * FROM books WHERE id = ?", [bookId]) ?? null
  );
}

export function getChapters(bookId: number): ChapterRow[] {
  return db.getAllSync<ChapterRow>(
    `SELECT * FROM chapters WHERE book_id = ? ${ORDER_BY}`,
    [bookId],
  );
}

/** Абзацы главы: из кэша или из сети (с сохранением в кэш). */
export async function ensureChapterText(book: BookRow, ch: ChapterRow): Promise<string[]> {
  const stored = db.getFirstSync<{ body_json: string }>(
    "SELECT body_json FROM chapter_content WHERE chapter_id = ?",
    [ch.id],
  );
  if (stored) return JSON.parse(stored.body_json);

  let paragraphs: string[] = [];
  if (ch.source === "ranobelib") {
    const html = await ranobelib.chapterContent(book.source_slug, ch.volume, ch.number);
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
      if (t) paragraphs.push(t);
    }
  } else if (ch.source === "syosetu") {
    const link = db.getFirstSync<{ url: string }>(
      "SELECT url FROM source_links WHERE book_id = ? AND kind = 'original' AND source = 'syosetu'",
      [book.id],
    );
    if (!link?.url) throw new Error("Источник syosetu не подключён");
    const novelId = syosetu.parseNovelId(link.url);
    paragraphs = await syosetu.chapterText(novelId, ch.url || ch.number);
  } else if (SITES[ch.source] && ch.url) {
    // Универсальные адаптеры (kakuyomu и будущие): url главы — полный путь.
    paragraphs = await SITES[ch.source].chapterText(ch.url);
  } else {
    throw new Error("Текст главы не импортирован");
  }

  db.runSync(
    "INSERT INTO chapter_content(chapter_id, body_json) VALUES(?, ?) ON CONFLICT(chapter_id) DO NOTHING",
    [ch.id, JSON.stringify(paragraphs)],
  );
  return paragraphs;
}

/** Скачивает тексты первых N непрочитанных/нескачанных глав в кэш (офлайн-чтение). */
export async function downloadAhead(bookId: number, count: number): Promise<number> {
  const book = getBook(bookId);
  if (!book) throw new Error("Книга не найдена");
  const rows = db.getAllSync<ChapterRow>(
    `SELECT c.* FROM chapters c
     LEFT JOIN chapter_content cc ON cc.chapter_id = c.id
     WHERE c.book_id = ? AND cc.chapter_id IS NULL ${ORDER_BY} LIMIT ?`,
    [bookId, count],
  );
  let done = 0;
  for (const ch of rows) {
    try {
      await ensureChapterText(book, ch);
      done++;
    } catch {
      // пропускаем недоступные (например, лицензированные без токена)
    }
  }
  return done;
}

// ---------- Библиотека ----------

export async function addToLibrary(slug: string): Promise<number> {
  const meta = await ranobelib.book(slug);
  const existing = db.getFirstSync<{ id: number }>(
    "SELECT id FROM books WHERE source = 'ranobelib' AND source_slug = ?",
    [slug],
  );
  let bookId: number;
  if (existing) {
    bookId = existing.id;
  } else {
    db.runSync(
      "INSERT INTO books(source, source_slug, title_ru, title_orig, cover_url, description, status, metadata_json) VALUES(?,?,?,?,?,?,?,?)",
      [
        "ranobelib",
        slug,
        meta.title,
        meta.title_orig,
        meta.cover_url,
        meta.description,
        meta.status,
        JSON.stringify(meta.metadata),
      ],
    );
    bookId = db.getFirstSync<{ id: number }>(
      "SELECT id FROM books WHERE source = 'ranobelib' AND source_slug = ?",
      [slug],
    )!.id;
  }
  // Дозаполняем список глав: одна транзакция на всё (тысячи INSERT по одной
  // транзакции = секунды лага на телефоне).
  const all = await ranobelib.chapters(slug);
  db.withTransactionSync(() => {
    const have = new Set(
      db.getAllSync<{ k: string }>(
        "SELECT volume || ':' || number AS k FROM chapters WHERE book_id = ? AND source = 'ranobelib'",
        [bookId],
      ).map((r) => r.k),
    );
    for (const ch of all) {
      const key = `${ch.volume}:${ch.number}`;
      if (have.has(key)) continue;
      db.runSync(
        "INSERT INTO chapters(book_id, source, volume, number, title, sort_key, origin) VALUES(?,?,?,?,?,?,'native')",
        [bookId, "ranobelib", ch.volume, ch.number, ch.title, ch.sortKey],
      );
    }
  });
  return bookId;
}

export function removeFromLibrary(bookId: number) {
  db.runSync(
    "DELETE FROM chapter_content WHERE chapter_id IN (SELECT id FROM chapters WHERE book_id = ?)",
    [bookId],
  );
  db.runSync("DELETE FROM chapters WHERE book_id = ?", [bookId]);
  db.runSync("DELETE FROM reading_progress WHERE book_id = ?", [bookId]);
  db.runSync("DELETE FROM source_links WHERE book_id = ?", [bookId]);
  db.runSync("DELETE FROM glossary WHERE book_id = ?", [bookId]);
  db.runSync("DELETE FROM books WHERE id = ?", [bookId]);
}

export function saveProgress(bookId: number, chapterId: number, scrollPct: number) {
  db.runSync(
    "INSERT INTO reading_progress(book_id, chapter_id, scroll_pct, updated_at) VALUES(?,?,?, datetime('now')) ON CONFLICT(book_id) DO UPDATE SET chapter_id = excluded.chapter_id, scroll_pct = excluded.scroll_pct, updated_at = datetime('now')",
    [bookId, chapterId, scrollPct],
  );
}

export function getProgress(bookId: number): { chapter_id: number; volume: string; number: string; scroll_pct: number } | null {
  return (
    db.getFirstSync<any>(
      `SELECT r.chapter_id, c.volume, c.number, r.scroll_pct
       FROM reading_progress r JOIN chapters c ON c.id = r.chapter_id
       WHERE r.book_id = ?`,
      [bookId],
    ) ?? null
  );
}

// ---------- Личный статус книги ----------

export const BOOK_STATUSES = {
  reading: "Читаю",
  planned: "В планах",
  dropped: "Заброшено",
  completed: "Прочитано",
} as const;

export type BookStatus = keyof typeof BOOK_STATUSES;

export function setBookStatus(bookId: number, status: BookStatus) {
  db.runSync("UPDATE books SET my_status = ? WHERE id = ?", [status, bookId]);
}

// ---------- Закладки ----------

export function addBookmark(bookId: number, chapterId: number, scrollPct: number, label: string) {
  db.runSync(
    "INSERT INTO bookmarks(book_id, chapter_id, scroll_pct, label) VALUES(?,?,?,?)",
    [bookId, chapterId, scrollPct, label],
  );
}

export function getBookmarks(bookId: number) {
  return db.getAllSync<any>(
    `SELECT bm.id, bm.scroll_pct, bm.label, bm.chapter_id,
            c.volume, c.number, c.title AS chapter_title
     FROM bookmarks bm JOIN chapters c ON c.id = bm.chapter_id
     WHERE bm.book_id = ?
     ORDER BY bm.created_at DESC, bm.id DESC`,
    [bookId],
  );
}

export function deleteBookmark(id: number) {
  db.runSync("DELETE FROM bookmarks WHERE id = ?", [id]);
}

// ---------- Ссылка на оригинал (живёт здесь, чтобы не было цикла импортов) ----------

export function getOriginalLink(bookId: number) {
  return (
    db.getFirstSync<{ source: string; url: string; config_json: string }>(
      "SELECT source, url, config_json FROM source_links WHERE book_id = ? AND kind = 'original'",
      [bookId],
    ) ?? null
  );
}

// ---------- Обновление книги: новые главы + автопродление сшивки ----------

export interface RefreshResult {
  newNative: number;   // новые готовые главы перевода
  newOriginal: number; // новые главы оригинала
  retired: number;     // MTL/ориг. главы, перекрытые переводом
}

export async function refreshBook(bookId: number): Promise<RefreshResult> {
  const book = getBook(bookId);
  if (!book) throw new Error("Книга не найдена");
  const all = await ranobelib.chapters(book.source_slug);
  let newNative = 0;

  // 1. Догружаем новые готовые главы перевода.
  db.withTransactionSync(() => {
    const have = new Set(
      db.getAllSync<{ k: string }>(
        "SELECT volume || ':' || number AS k FROM chapters WHERE book_id = ? AND source = 'ranobelib'",
        [bookId],
      ).map((r) => r.k),
    );
    for (const ch of all) {
      const key = `${ch.volume}:${ch.number}`;
      if (have.has(key)) continue;
      db.runSync(
        "INSERT INTO chapters(book_id, source, volume, number, title, sort_key, origin) VALUES(?,?,?,?,?,?,'native')",
        [bookId, "ranobelib", ch.volume, ch.number, ch.title, ch.sortKey],
      );
      newNative++;
    }
  });

  // 2. Догружаем новые главы оригинала (Syosetu), если подключён.
  let newOriginal = 0;
  const link = getOriginalLink(bookId);
  if (link && SITES[link.source] && link.url) {
    const adapter = SITES[link.source];
    const { chapters: toc } = await adapter.toc(link.url);
    const existing = new Set(
      db.getAllSync<{ url: string | null }>(
        "SELECT url FROM chapters WHERE book_id = ? AND source = ?",
        [bookId, link.source],
      ).map((r) => r.url),
    );
    const lastSk = db.getFirstSync<{ m: number | null }>(
      "SELECT MAX(sort_key) AS m FROM chapters WHERE book_id = ? AND source = ?",
      [bookId, link.source],
    )?.m;
    let sk = lastSk ?? 0;
    for (const t of toc) {
      if (existing.has(t.ref)) continue;
      sk += 1;
      db.runSync(
        "INSERT INTO chapters(book_id, source, volume, number, title, sort_key, origin, url) VALUES(?,?,?,?,?,?,'orig',?)",
        [bookId, link.source, "1", t.ref, t.title, sk, t.ref],
      );
      newOriginal++;
    }
  }

  // 3. Автопродление: главы хвоста, перекрытые готовым переводом, удаляем,
  //    остальные переставляем вплотную к последней главе перевода.
  let retired = 0;
  const maxNative = db.getFirstSync<{ m: number | null }>(
    "SELECT MAX(sort_key) AS m FROM chapters WHERE book_id = ? AND source = 'ranobelib'",
    [bookId],
  )?.m;
  if (maxNative != null) {
    const toRetire = db.getFirstSync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM chapters WHERE book_id = ? AND source != 'ranobelib' AND sort_key <= ?",
      [bookId, maxNative],
    )?.n ?? 0;
    db.withTransactionSync(() => {
      db.runSync(
        "DELETE FROM chapter_content WHERE chapter_id IN (SELECT id FROM chapters WHERE book_id = ? AND source != 'ranobelib' AND sort_key <= ?)",
        [bookId, maxNative],
      );
      db.runSync(
        "DELETE FROM chapters WHERE book_id = ? AND source != 'ranobelib' AND sort_key <= ?",
        [bookId, maxNative],
      );
    });
    retired = toRetire;

    // 4. Перенумерация оставшегося хвоста вплотную к переводу.
    const anchor = db.getFirstSync<{ sort_key: number; volume: string; number: string }>(
      "SELECT sort_key, volume, number FROM chapters WHERE book_id = ? AND source = 'ranobelib' ORDER BY sort_key DESC LIMIT 1",
      [bookId],
    )!;
    const baseNumber = parseInt(parseFloat(anchor.number).toFixed(0));
    const tail = db.getAllSync<{ id: number }>(
      "SELECT id FROM chapters WHERE book_id = ? AND source != 'ranobelib' ORDER BY sort_key",
      [bookId],
    );
    db.withTransactionSync(() => {
      tail.forEach((row, idx) => {
        db.runSync(
          "UPDATE chapters SET sort_key = ?, number = ?, volume = ? WHERE id = ?",
          [anchor.sort_key + idx + 1, String(baseNumber + idx + 1), anchor.volume, row.id],
        );
      });
    });
  }

  return { newNative, newOriginal, retired };
}
