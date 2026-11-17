import React, { useState } from "react";
import { Alert, ScrollView, Text, TextInput, TouchableOpacity, View, StyleSheet } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { colors } from "../theme";
import { getSetting, setSetting } from "../db";
import { toast } from "../toast";
import { getReaderSettings, setReaderSetting, READER_THEMES, type ReaderSettings } from "../reader";
import { APP_VERSION, DEFAULT_UPDATE_REPO, checkForUpdate, downloadAndInstall } from "../lib/updater";
import type { ReleaseInfo } from "../version";
import type { RootStackParamList } from "../../App";

function Stepper({ label, value, min, max, step, onChange, suffix }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; suffix?: string;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Text style={styles.dim}>{label}</Text>
      <TouchableOpacity style={styles.step} onPress={() => onChange(Math.max(min, value - step))}>
        <Text style={{ color: colors.text }}>−</Text>
      </TouchableOpacity>
      <Text style={{ color: colors.text, minWidth: 46, textAlign: "center" }}>{value}{suffix}</Text>
      <TouchableOpacity style={styles.step} onPress={() => onChange(Math.min(max, value + step))}>
        <Text style={{ color: colors.text }}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function SettingsScreen() {
  const [token, setToken] = useState(getSetting("ranobelib_token") ?? "");
  const [saved, setSaved] = useState(false);
  const [rs, setRs] = useState<ReaderSettings>(getReaderSettings());
  const [repo, setRepo] = useState(getSetting("update_repo") ?? DEFAULT_UPDATE_REPO);
  const [checking, setChecking] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<ReleaseInfo | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<number | null>(null);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  function updateRs<K extends keyof ReaderSettings>(key: K, value: ReaderSettings[K]) {
    setReaderSetting(key, value);
    setRs({ ...rs, [key]: value });
  }

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <View style={styles.paper}>
        <Text style={styles.h2}>Ридер</Text>
        <View style={{ gap: 10 }}>
          <Stepper label="Шрифт" value={rs.font} min={13} max={26} step={1} onChange={(v) => updateRs("font", v)} />
          <Stepper label="Интервал" value={rs.line} min={20} max={40} step={2} onChange={(v) => updateRs("line", v)} />
          <Stepper label="Ширина" value={rs.width} min={480} max={960} step={60} onChange={(v) => updateRs("width", v)} />
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <Text style={styles.dim}>Тема</Text>
            {(Object.keys(READER_THEMES) as (keyof typeof READER_THEMES)[]).map((name) => (
              <TouchableOpacity
                key={name}
                style={[styles.themeBtn, { backgroundColor: READER_THEMES[name].bg }, rs.theme === name && { borderWidth: 2, borderColor: colors.accent }]}
                onPress={() => updateRs("theme", name)}
              >
                <Text style={{ color: READER_THEMES[name].text, fontSize: 12 }}>
                  {name === "dark" ? "тёмная" : name === "sepia" ? "сепия" : "светлая"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      <View style={styles.paper}>
        <Text style={styles.h2}>Обновление приложения</Text>
        <Text style={styles.dim}>
          Текущая версия: {APP_VERSION}. Репозиторий GitHub (owner/repo),
          где публикуются релизы с APK:
        </Text>
        <TextInput
          style={styles.input}
          placeholder="username/ranobe-reader"
          placeholderTextColor={colors.dim}
          autoCapitalize="none"
          autoCorrect={false}
          value={repo}
          onChangeText={setRepo}
        />
        <TouchableOpacity
          style={[styles.btn, (!repo.trim() || checking || downloading !== null) && { opacity: 0.5 }]}
          disabled={!repo.trim() || checking || downloading !== null}
          onPress={async () => {
            const r = repo.trim();
            setSetting("update_repo", r);
            setChecking(true);
            setUpdateInfo(null);
            setCheckError(null);
            try {
              const info = await checkForUpdate(r);
              if (info) {
                setUpdateInfo(info);
              } else {
                toast("У вас последняя версия " + APP_VERSION);
              }
            } catch (e: any) {
              setCheckError(String(e.message ?? e));
            } finally {
              setChecking(false);
            }
          }}
        >
          <Text style={styles.btnText}>{checking ? "Проверяю…" : "Проверить обновления"}</Text>
        </TouchableOpacity>
        {checkError ? <Text style={[styles.dim, { color: "salmon" }]}>{checkError}</Text> : null}
        {updateInfo && (
          <View style={{ gap: 8 }}>
            <Text style={{ color: colors.text }}>
              Доступна версия {updateInfo.version} — скачать и установить?
            </Text>
            {updateInfo.notes ? (
              <Text style={styles.dim} numberOfLines={6}>{updateInfo.notes}</Text>
            ) : null}
            <TouchableOpacity
              style={styles.btn}
              disabled={downloading !== null}
              onPress={async () => {
                setDownloading(0);
                try {
                  await downloadAndInstall(updateInfo.apkUrl, (pct) => setDownloading(pct));
                } catch (e: any) {
                  setDownloading(null);
                  Alert.alert("Ошибка установки", String(e.message ?? e));
                }
              }}
            >
              <Text style={styles.btnText}>
                {downloading === null
                  ? "Скачать и установить"
                  : downloading < 100
                    ? `Скачивание… ${downloading}%`
                    : "Открываю установщик…"}
              </Text>
            </TouchableOpacity>
            <Text style={styles.dim}>
              Первый раз Android попросит разрешить установку для этого приложения — это одноразово.
            </Text>
          </View>
        )}
      </View>

      <View style={styles.paper}>
        <Text style={styles.h2}>Токен RanobeLIB</Text>
        <Text style={styles.dim}>
          Открывает лицензированные тайтлы и 18+. Как получить: откройте
          ranobelib.me в браузере, войдите, F12 → Application → Local Storage →
          скопируйте значение ключа, начинающегося с «auth» (длинная строка).
        </Text>
        <TextInput
          style={styles.input}
          placeholder="вставьте токен (необязательно)"
          placeholderTextColor={colors.dim}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          value={token}
          onChangeText={setToken}
        />
        <TouchableOpacity
          style={styles.btn}
          onPress={() => {
            setSetting("ranobelib_token", token.trim());
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
          }}
        >
          <Text style={styles.btnText}>Сохранить</Text>
        </TouchableOpacity>
        {saved ? <Text style={styles.dim}>Сохранено</Text> : null}
      </View>

      <View style={styles.paper}>
        <Text style={styles.h2}>Перевод</Text>
        <Text style={styles.dim}>
          Бесплатный онлайн-Google (вежливый темп, без ключей). Офлайн-перевод
          (ML Kit) — в следующей версии. Очередь переводит, пока приложение
          открыто: читайте текущую главу — следующие переводятся сами.
        </Text>
      </View>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  paper: { backgroundColor: colors.surface, borderRadius: 10, padding: 14, gap: 10 },
  h2: { color: colors.text, fontSize: 16, fontWeight: "600" },
  dim: { color: colors.dim, fontSize: 13, lineHeight: 19 },
  input: {
    backgroundColor: colors.surface2,
    color: colors.text,
    borderRadius: 10,
    padding: 12,
    minHeight: 60,
    fontSize: 14,
  },
  btn: { backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, alignSelf: "flex-start" },
  btnPlain: { backgroundColor: colors.surface2, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, alignItems: "center" },
  btnText: { color: "#fff", fontSize: 14 },
  step: {
    backgroundColor: colors.surface2,
    borderRadius: 8,
    width: 36,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  themeBtn: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: colors.border },
});
