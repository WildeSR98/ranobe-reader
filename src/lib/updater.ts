import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import { APP_VERSION, DEFAULT_UPDATE_REPO, compareVersions, fetchLatestRelease, type ReleaseInfo } from "../version";

export { APP_VERSION, DEFAULT_UPDATE_REPO };
export type { ReleaseInfo };

/** Проверяет, есть ли релиз новее текущей версии. null — версия актуальна. */
export async function checkForUpdate(repo: string): Promise<ReleaseInfo | null> {
  const r = repo.trim() || DEFAULT_UPDATE_REPO;
  if (!r) throw new Error("Укажите репозиторий обновлений (owner/repo)");
  const latest = await fetchLatestRelease(r);
  return compareVersions(latest.version, APP_VERSION) > 0 ? latest : null;
}

/** Скачивает APK из релиза и открывает системный установщик.
 *  При первом обновлении Android попросит разрешить установку для приложения. */
export async function downloadAndInstall(
  apkUrl: string,
  onProgress?: (pct: number) => void,
): Promise<void> {
  const dest = (FileSystem.documentDirectory ?? "") + "update.apk";
  const resumable = FileSystem.createDownloadResumable(apkUrl, dest, {}, (p) => {
    const total = (p as any).totalBytesExpectedToWrite ?? 0;
    if (total > 0) {
      onProgress?.(Math.round((p.totalBytesWritten / total) * 100));
    }
  });
  const result = await resumable.downloadAsync();
  onProgress?.(100);
  if (!result?.uri) throw new Error("Скачивание не удалось");
  const contentUri = await FileSystem.getContentUriAsync(result.uri);
  await IntentLauncher.startActivityAsync("android.intent.action.INSTALL_PACKAGE", {
    data: contentUri,
    flags: 1, // GRANT_READ_URI_PERMISSION
  });
}
