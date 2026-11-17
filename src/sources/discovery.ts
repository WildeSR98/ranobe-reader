import { SITES } from "./sites";

const UA = "RanobeReader/1.0";
const CJK = /[　-ヿ一-龯]/;

export interface OriginalCandidate {
  site: string;       // id адаптера: 'syosetu' | 'kakuyomu'
  url: string;        // страница произведения
  title: string;
  author: string;
  chapters: number;
}

export interface DiscoveryResult {
  candidates: OriginalCandidate[];
  stats: { anilistTitles: number; terms: string[]; sites: string[] };
}

interface AniListMedia {
  title: { native: string | null; romaji: string | null };
  format: string;
}

/** Автопоиск оригинала по нескольким сайтам:
 *  название с ранобелиба → AniList (канзи/романдзи) → поиск на каждом сайте.
 *  manualQuery — слово пользователя (канзи/романдзи): идёт первым, AniList пропускается. */
export async function findOriginalCandidates(
  titleEng: string | null,
  manualQuery: string | null,
): Promise<DiscoveryResult> {
  const manual = (manualQuery ?? "").trim();
  const selfQuery = (titleEng ?? "").trim();
  const terms = new Set<string>();

  if (manual) {
    terms.add(manual);
  } else if (selfQuery) {
    try {
      const res = await fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": UA,
        },
        body: JSON.stringify({
          query:
            'query ($s: String) { Page(perPage: 10) { media(search: $s, type: MANGA) { title { native romaji } format } } }',
          variables: { s: selfQuery },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const media: AniListMedia[] = data?.data?.Page?.media ?? [];
        const ordered = [...media].sort(
          (a, b) => (b.format === "NOVEL" ? 1 : 0) - (a.format === "NOVEL" ? 1 : 0),
        );
        for (const m of ordered) {
          if (m.title.native) terms.add(m.title.native);
          if (m.title.romaji) terms.add(m.title.romaji);
        }
      }
    } catch {
      // AniList недоступен — ищем по латинице напрямую
    }
    terms.add(selfQuery);
  }

  const termList = [...terms].slice(0, 6);
  const seen = new Map<string, OriginalCandidate>();

  // Все сайты параллельно, по первым трём словам.
  const jobs: Promise<void>[] = [];
  for (const site of Object.values(SITES)) {
    for (const term of termList.slice(0, 3)) {
      jobs.push(
        site
          .search(term)
          .then((results) => {
            for (const r of results) {
              const key = `${site.id}:${r.url}`;
              if (!seen.has(key)) {
                seen.set(key, { site: site.id, ...r });
              }
            }
          })
          .catch(() => {}),
      );
    }
  }
  await Promise.all(jobs);

  const candidates = [...seen.values()].sort((a, b) => b.chapters - a.chapters).slice(0, 8);
  return {
    candidates,
    stats: {
      anilistTitles: terms.size,
      terms: termList,
      sites: Object.keys(SITES),
    },
  };
}
