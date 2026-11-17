import React, { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Text, TouchableOpacity, View, StyleSheet } from "react-native";
import { colors } from "../theme";
import { DEFAULT_UPDATE_REPO } from "../version";
import { checkForUpdate, downloadAndInstall, type ReleaseInfo } from "../lib/updater";

/** Проверяет обновление при запуске приложения и предлагает установить. */
export default function UpdateGate() {
  const [info, setInfo] = useState<ReleaseInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [downloading, setDownloading] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Небольшая задержка: не конкурируем с загрузкой библиотеки на старте.
    const t = setTimeout(() => {
      checkForUpdate(DEFAULT_UPDATE_REPO)
        .then(setInfo)
        .catch(() => {});
    }, 4000);
    return () => clearTimeout(t);
  }, []);

  if (!info || dismissed) return null;

  return (
    <Modal transparent animationType="fade" onRequestClose={() => setDismissed(true)}>
      <View style={styles.bg}>
        <View style={styles.card}>
          <Text style={styles.title}>Доступно обновление</Text>
          <Text style={styles.text}>
            Версия {info.version} — установить поверх текущей?
          </Text>
          {info.notes ? (
            <Text style={[styles.text, { maxHeight: 120 }]} numberOfLines={8}>
              {info.notes}
            </Text>
          ) : null}

          {downloading === null ? (
            <View style={{ flexDirection: "row", gap: 10 }}>
              <TouchableOpacity style={styles.btn} onPress={() => setDismissed(true)}>
                <Text style={styles.btnText}>Позже</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.btnAccent}
                onPress={async () => {
                  setDownloading(0);
                  try {
                    await downloadAndInstall(info.apkUrl, setDownloading);
                    // Установщик открылся — окно можно закрыть.
                    setDismissed(true);
                  } catch (e: any) {
                    setDownloading(null);
                    setError(String(e.message ?? e));
                  }
                }}
              >
                <Text style={styles.btnText}>Обновить</Text>
              </TouchableOpacity>
            </View>
          ) : downloading < 100 ? (
            <View style={{ gap: 8 }}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.text}>Скачивание… {downloading}%</Text>
            </View>
          ) : (
            <Text style={styles.text}>Открываю установщик…</Text>
          )}

          {error ? <Text style={[styles.text, { color: "salmon" }]}>{error}</Text> : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bg: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 18,
    gap: 10,
    width: "100%",
  },
  title: { color: colors.text, fontSize: 17, fontWeight: "700" },
  text: { color: colors.dim, fontSize: 13, lineHeight: 19 },
  btn: {
    flex: 1,
    backgroundColor: colors.surface2,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  btnAccent: {
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  btnText: { color: "#fff", fontSize: 14 },
});
