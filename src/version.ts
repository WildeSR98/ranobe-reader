/** Версия приложения и канал обновлений (GitHub Releases).
 *  При выпуске новой версии bump-им APP_VERSION и app.json version/versionCode,
 *  затем публикуем релиз с тегом v<версия> и APK-ассетом. */
export const APP_VERSION = "1.3.1";

/** Репозиторий обновлений по умолчанию (owner/repo).
 *  Можно переопределить в Настройках — там же кнопка проверки. */
export const DEFAULT_UPDATE_REPO = "WildeSR98/ranobe-reader";

export interface ReleaseInfo {
  version: string;
  notes: string;
  apkUrl: string;
  apkName: string;
}

export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Последний релиз из GitHub Releases. Бросает ошибку, если репозиторий недоступен. */
export async function fetchLatestRelease(repo: string): Promise<ReleaseInfo> {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "RanobeReader" },
  });
  if (res.status === 404) throw new Error("Релизов пока нет в этом репозитории");
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  const data = await res.json();
  const asset = (data.assets ?? []).find((a: any) => a.name.toLowerCase().endsWith(".apk"));
  if (!asset) throw new Error("В релизе нет APK-файла");
  return {
    version: String(data.tag_name ?? "").replace(/^v/, ""),
    notes: String(data.body ?? ""),
    apkUrl: asset.browser_download_url,
    apkName: asset.name,
  };
}
