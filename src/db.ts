import * as SQLite from "expo-sqlite";

export const db = SQLite.openDatabaseSync("ranobe.db");

export function initDb() {
  db.execSync("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
  db.execSync(`
    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY,
      source TEXT NOT NULL,
      source_slug TEXT NOT NULL,
      title_ru TEXT NOT NULL,
      title_orig TEXT,
      cover_url TEXT,
      description TEXT,
      status TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      my_status TEXT NOT NULL DEFAULT 'reading',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(source, source_slug)
    );
    CREATE TABLE IF NOT EXISTS chapters (
      id INTEGER PRIMARY KEY,
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      source TEXT NOT NULL,
      volume TEXT NOT NULL DEFAULT '1',
      number TEXT NOT NULL,
      title TEXT,
      sort_key REAL NOT NULL,
      origin TEXT NOT NULL DEFAULT 'native',
      provider TEXT,
      url TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(book_id, source, volume, number)
    );
    CREATE INDEX IF NOT EXISTS idx_chapters_book ON chapters(book_id, sort_key);
    CREATE TABLE IF NOT EXISTS chapter_content (
      chapter_id INTEGER PRIMARY KEY REFERENCES chapters(id) ON DELETE CASCADE,
      body_json TEXT NOT NULL,
      orig_json TEXT,
      glossary_hash TEXT,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS source_links (
      id INTEGER PRIMARY KEY,
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      source TEXT NOT NULL,
      url TEXT,
      config_json TEXT NOT NULL DEFAULT '{}',
      UNIQUE(book_id, kind, source)
    );
    CREATE TABLE IF NOT EXISTS glossary (
      id INTEGER PRIMARY KEY,
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      term_src TEXT NOT NULL,
      term_ru TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'name',
      UNIQUE(book_id, term_src)
    );
    CREATE TABLE IF NOT EXISTS reading_progress (
      book_id INTEGER PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
      chapter_id INTEGER NOT NULL,
      scroll_pct REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS bookmarks (
      id INTEGER PRIMARY KEY,
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
      scroll_pct REAL NOT NULL DEFAULT 0,
      label TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  // Миграция: личный статус книги (у баз, созданных раньше, колонки нет).
  const hasStatus = db.getFirstSync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM pragma_table_info('books') WHERE name = 'my_status'",
  );
  if (!hasStatus?.n) {
    db.execSync("ALTER TABLE books ADD COLUMN my_status TEXT NOT NULL DEFAULT 'reading'");
  }
}

export function getSetting(key: string): string | null {
  const row = db.getFirstSync<{ value: string | null }>(
    "SELECT value FROM settings WHERE key = ?",
    [key],
  );
  return row?.value ?? null;
}

export function setSetting(key: string, value: string) {
  db.runSync(
    "INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}

export const ORDER_BY =
  "ORDER BY sort_key, CASE WHEN source = 'ranobelib' THEN 0 ELSE 1 END, id";
