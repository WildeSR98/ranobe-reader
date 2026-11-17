import { getSetting } from "../db";

export const COVER_HEADERS = { Referer: "https://ranobelib.me/" };

const BASE = "https://api.imglib.info/api";
const SITE_ID = 3; // ranobelib (Manga=1, Yaoi=2, Ranobe=3, Hentai=4, Anime=5)
const MIN_INTERVAL = 600; // вежливый темп, мс

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

let lastCall = 0;

async function get(path: string, params: Record<string, string | number> = {}) {
  const wait = MIN_INTERVAL - (Date.now() - lastCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  const headers: Record<string, string> = {
    "Site-Id": String(SITE_ID),
    Accept: "application/json",
    "User-Agent": UA,
    // API отклоняет запросы без браузерных Referer/Origin (403).
    Referer: "https://ranobelib.me/",
    Origin: "https://ranobelib.me",
  };
  const token = getSetting("ranobelib_token");
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}?${qs}`, { headers });
  if (!res.ok) throw new Error(`RanobeLIB ${res.status}: ${path}`);
  return res.json();
}

function listFields(params: Record<string, string | number>) {
  ["rate", "rate_avg", "userBookmark", "releaseDate"].forEach(
    (f, i) => (params[`fields[${i}]`] = f),
  );
  return params;
}

export interface Genre {
  id: number;
  name: string;
}

/** Справочник жанров (кэшируется в памяти на сессию). */
let _genres: Genre[] | null = null;
export async function getGenres(): Promise<Genre[]> {
  if (_genres) return _genres;
  const data = await get("/constants", { "fields[0]": "genres" });
  const out = (data?.data?.genres ?? []).map((g: any) => ({ id: Number(g.id), name: String(g.name) }));
  _genres = out;
  return out;
}

export interface BookItem {
  slug: string;
  title: string;
  title_orig: string | null;
  cover: string | null;
  rate: number | null;
  release_date: string | null;
  type_label: string | null;
}

function parseItem(raw: any): BookItem {
  return {
    slug: raw.slug_url ?? raw.slug,
    title: raw.rus_name || raw.eng_name || raw.name,
    title_orig: raw.eng_name ?? null,
    cover: raw.cover?.thumbnail ?? raw.cover?.default ?? null,
    rate: raw.rate_avg ?? null,
    release_date: raw.releaseDate ? String(raw.releaseDate) : null,
    type_label: raw.type?.label ?? null,
  };
}

export async function search(query: string, page = 1, genreId: number | null = null) {
  const params = listFields({ q: query, "site_id[0]": SITE_ID, page });
  if (genreId) params["genres[0]"] = genreId;
  const data = await get("/manga", params);
  return {
    items: (data.data ?? []).map(parseItem),
    page: data.meta?.current_page ?? page,
    has_next: !!data.meta?.has_next_page,
  };
}

export async function catalog(page = 1, genreId: number | null = null) {
  const params = listFields({ "site_id[0]": SITE_ID, page });
  if (genreId) params["genres[0]"] = genreId;
  const data = await get("/manga", params);
  return {
    items: (data.data ?? []).map(parseItem),
    page: data.meta?.current_page ?? page,
    has_next: !!data.meta?.has_next_page,
  };
}

export interface BookMeta {
  slug: string;
  title: string;
  title_orig: string | null;
  cover_url: string | null;
  description: string | null;
  status: string | null;
  metadata: Record<string, any>;
}

const STATUS_NAMES: Record<number, string> = {
  1: "Онгоинг",
  2: "Завершён",
  3: "Анонс",
  4: "Заморожен",
  5: "Вышел",
};

const BOOK_FIELDS = [
  "background", "eng_name", "otherNames", "summary", "releaseDate", "country",
  "type_id", "caution", "views", "close_view", "rate_avg", "rate", "genres",
  "tags", "teams", "user", "franchise", "authors", "publisher", "userRating",
  "moderated", "metadata", "metadata.count", "metadata.close_comments",
  "translation_quality_rating", "manga_status_id", "chap_count", "status_id",
  "extra_release_status", "artists", "format",
];

function tiptapToText(node: any): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(tiptapToText).join("");
  if (node && typeof node === "object") {
    if ("text" in node) return String(node.text ?? "");
    const inner = tiptapToText(node.content);
    return node.type === "paragraph" || node.type === "hardBreak" ? inner + "\n" : inner;
  }
  return "";
}

export async function book(slug: string): Promise<BookMeta> {
  const params: Record<string, string | number> = {};
  BOOK_FIELDS.forEach((f, i) => (params[`fields[${i}]`] = f));
  const raw = await get(`/manga/${slug}`, params);
  const d = raw.data;
  return {
    slug: d.slug_url ?? slug,
    title: d.rus_name || d.eng_name || d.name || slug,
    title_orig: d.eng_name ?? null,
    cover_url: d.cover?.default ?? d.cover?.thumbnail ?? null,
    description: (tiptapToText(d.summary) as string).trim() || null,
    status: STATUS_NAMES[d.manga_status_id] ?? null,
    metadata: {
      genres: (d.genres ?? []).slice(0, 10).map((g: any) => g.name).join(", "),
      year: d.releaseDate,
      rate: d.rate_avg,
      chap_count: d.chap_count,
      is_licensed: d.is_licensed,
    },
  };
}

export interface ChapterRef {
  volume: string;
  number: string;
  title: string | null;
  sortKey: number;
  ref: string | null; // для syosetu — номер главы в источнике
}

export function sortKey(volume: string, number: string): number {
  const v = parseFloat(volume) || 0;
  const n = parseFloat(number) || 0;
  return v * 100000 + n;
}

export async function chapters(slug: string): Promise<ChapterRef[]> {
  const raw = await get(`/manga/${slug}/chapters`);
  const out: ChapterRef[] = (raw.data ?? []).map((item: any) => {
    const v = String(item.volume ?? "1");
    const n = String(item.number ?? "");
    return { volume: v, number: n, title: item.name ?? null, sortKey: sortKey(v, n), ref: null };
  });
  out.sort((a, b) => a.sortKey - b.sortKey);
  return out;
}

export async function chapterContent(slug: string, volume: string, number: string): Promise<string> {
  const raw = await get(`/manga/${slug}/chapter`, { volume, number });
  return raw.data?.content ?? "";
}
