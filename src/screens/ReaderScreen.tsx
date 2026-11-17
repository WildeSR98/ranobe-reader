import React, { useEffect, useRef, useState } from "react";
import { FlatList, Modal, ScrollView, Text, TouchableOpacity, View, StyleSheet, type ScrollViewInstance } from "react-native";
import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { db, getSetting } from "../db";
import { colors } from "../theme";
import { addBookmark, ensureChapterText, getBook, getChapters, saveProgress, type ChapterRow } from "../lib/library";
import { enqueue, onQueueChange } from "../lib/translate";
import { getReaderSettings, READER_THEMES } from "../reader";
import type { RootStackParamList } from "../../App";

export default function ReaderScreen() {
  const route = useRoute<RouteProp<RootStackParamList, "Reader">>();
  const { bookId, chapterId } = route.params;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [chapter, setChapter] = useState<(ChapterRow & { paragraphs: string[] }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const restored = useRef(false);
  const scrollRef = useRef<ScrollViewInstance | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPct = useRef(0);
  const [rs, setRs] = useState(getReaderSettings());
  const [, setTick] = useState(0);
  const [barPct, setBarPct] = useState(0);
  const [showAa, setShowAa] = useState(false);
  const [showChapters, setShowChapters] = useState(false);

  // Настройки ридера могли измениться в Настройках — перечитываем при фокусе.
  useFocusEffect(() => {
    setRs(getReaderSettings());
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity onPress={() => navigation.navigate("Book", { bookId })}>
          <Text style={{ color: colors.accent, fontSize: 15 }}>Книга</Text>
        </TouchableOpacity>
      ),
    });
  });

  useEffect(() => onQueueChange(() => setTick((t) => t + 1)), []);

  async function load() {
    setChapter(null);
    setError(null);
    restored.current = false;
    try {
      const book = getBook(bookId);
      if (!book) throw new Error("Книга не найдена");
      const all = getChapters(bookId);
      const ch = all.find((c) => c.id === chapterId);
      if (!ch) throw new Error("Глава не найдена");
      const paragraphs = await ensureChapterText(book, ch);
      setChapter({ ...ch, paragraphs });
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  }

  useEffect(() => {
    load();
  }, [bookId, chapterId]);

  // Перевод этой главы завершён → перезагрузить содержимое.
  useEffect(() => {
    if (chapter && chapter.origin === "orig") {
      const t = setInterval(async () => {
        const row = db.getFirstSync<{ origin: string }>(
          "SELECT origin FROM chapters WHERE id = ?",
          [chapterId],
        );
        if (row && row.origin !== "orig") load();
      }, 4000);
      return () => clearInterval(t);
    }
  }, [chapter, chapterId]);

  // Восстановление позиции.
  useEffect(() => {
    if (!chapter || restored.current) return;
    restored.current = true;
    const p = db.getFirstSync<{ scroll_pct: number; chapter_id: number }>(
      "SELECT chapter_id, scroll_pct FROM reading_progress WHERE book_id = ?",
      [bookId],
    );
    if (p && p.chapter_id === chapterId && p.scroll_pct > 0) {
      setTimeout(() => {
        scrollRef.current?.scrollTo({ y: p.scroll_pct, animated: false });
      }, 400);
    }
  }, [chapter, bookId, chapterId]);

  if (error) {
    return (
      <View style={[styles.wrap, { backgroundColor: READER_THEMES[rs.theme].bg }]}>
        <Text style={styles.dim}>{error}</Text>
        <Text style={[styles.dim, { marginTop: 10 }]}>
          Если вы офлайн — глава могла быть не скачана. Откройте карточку книги и нажмите
          «Скачать» (раздел «Перевод»), чтобы главы появились в офлайн-кэше.
        </Text>
      </View>
    );
  }
  if (!chapter) {
    return (
      <View style={[styles.wrap, { backgroundColor: READER_THEMES[rs.theme].bg }]}>
        <Text style={styles.dim}>Загрузка главы…</Text>
      </View>
    );
  }

  const all = getChapters(bookId);
  const idx = all.findIndex((c) => c.id === chapterId);
  const prev = idx > 0 ? all[idx - 1] : null;
  const next = idx + 1 < all.length ? all[idx + 1] : null;
  const go = (ch: ChapterRow) => navigation.replace("Reader", { bookId, chapterId: ch.id });
  const t = READER_THEMES[rs.theme];

  const isOrig = chapter.origin === "orig";

  return (
    <View style={[styles.wrap, { backgroundColor: t.bg }]}>
      <ScrollView
        ref={scrollRef}
        scrollEventThrottle={200}
        onScroll={(e) => {
          const y = e.nativeEvent.contentOffset.y;
          const max = e.nativeEvent.contentSize.height - e.nativeEvent.layoutMeasurement.height;
          lastPct.current = max > 0 ? Math.max(0, Math.round((y / max) * 100)) : 0;
          setBarPct(lastPct.current);
          if (saveTimer.current) clearTimeout(saveTimer.current);
          saveTimer.current = setTimeout(() => {
            saveProgress(bookId, chapterId, lastPct.current);
          }, 800);
        }}
        contentContainerStyle={{ padding: 16, paddingBottom: 48, maxWidth: rs.width, width: "100%", alignSelf: "center" }}
      >
        <Text style={[styles.meta, { color: t.dim }]}>
          Т.{chapter.volume} · Гл.{chapter.number}
          {chapter.source !== "ranobelib" ? ` · ${chapter.source}` : ""}
          {isOrig ? " · оригинал, не переведено" : ""}
          {chapter.origin === "mt" ? ` · MT (${chapter.provider})` : ""}
        </Text>
        {chapter.title ? <Text style={[styles.title, { color: t.text }]}>{chapter.title}</Text> : null}

        {/* Полоса прогресса главы */}
        <View style={[styles.barBg, { backgroundColor: t.surface }]}>
          <View style={[styles.bar, { width: barPct + "%", backgroundColor: colors.accent }]} />
        </View>

        <View style={styles.toolsRow}>
          <TouchableOpacity
            style={[styles.toolBtn, { backgroundColor: t.surface }]}
            onPress={() => {
              addBookmark(bookId, chapterId, lastPct.current, `${lastPct.current}% · гл.${chapter.number}`);
            }}
          >
            <Text style={[styles.toolText, { color: t.text }]}>☆ Закладка</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toolBtn, { backgroundColor: t.surface }]}
            onPress={() => setShowAa(true)}
          >
            <Text style={[styles.toolText, { color: t.text }]}>Aa</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toolBtn, { backgroundColor: t.surface }]}
            onPress={() => setShowChapters(true)}
          >
            <Text style={[styles.toolText, { color: t.text }]}>☰ Главы</Text>
          </TouchableOpacity>
        </View>

        {isOrig && (
          <TouchableOpacity
            style={styles.btn}
            onPress={() => {
              enqueue([chapter.id], "google");
              alert("Глава в очереди перевода — текст обновится автоматически.");
            }}
          >
            <Text style={styles.btnText}>Перевести эту главу</Text>
          </TouchableOpacity>
        )}

        {chapter.paragraphs.map((p, i) => (
          <Text key={i} style={[styles.para, { color: t.text, fontSize: rs.font, lineHeight: rs.line }]}>
            {p}
          </Text>
        ))}

        <View style={styles.navRow}>
          {prev ? (
            <TouchableOpacity style={[styles.btnPlain, { backgroundColor: t.surface }]} onPress={() => go(prev)}>
              <Text style={[styles.btnText, { color: t.text }]}>← Назад</Text>
            </TouchableOpacity>
          ) : (
            <View />
          )}
          {next ? (
            <TouchableOpacity style={styles.btn} onPress={() => go(next)}>
              <Text style={styles.btnText}>Вперёд →</Text>
            </TouchableOpacity>
          ) : (
            <Text style={[styles.dim, { color: t.dim }]}>Последняя глава</Text>
          )}
        </View>
      </ScrollView>

      {/* Настройки чтения (Aa) */}
      <Modal visible={showAa} transparent animationType="fade" onRequestClose={() => setShowAa(false)}>
        <TouchableOpacity style={styles.modalBg} onPress={() => setShowAa(false)}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
            <Text style={styles.modalTitle}>Настройки чтения</Text>
            {([["Шрифт", "font", 13, 26, 1], ["Интервал", "line", 20, 40, 2], ["Ширина", "width", 480, 960, 60]] as const).map(
              ([label, key, min, max, step]) => (
                <View key={key} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Text style={styles.dim}>{label}</Text>
                  <TouchableOpacity
                    style={styles.step}
                    onPress={() => {
                      const v = Math.max(min, (rs as any)[key] - step);
                      setRs({ ...rs, [key]: v });
                      import("../reader").then((m) => m.setReaderSetting(key as any, v as any));
                    }}
                  >
                    <Text style={{ color: colors.text }}>−</Text>
                  </TouchableOpacity>
                  <Text style={{ color: colors.text, minWidth: 44, textAlign: "center" }}>{(rs as any)[key]}</Text>
                  <TouchableOpacity
                    style={styles.step}
                    onPress={() => {
                      const v = Math.min(max, (rs as any)[key] + step);
                      setRs({ ...rs, [key]: v });
                      import("../reader").then((m) => m.setReaderSetting(key as any, v as any));
                    }}
                  >
                    <Text style={{ color: colors.text }}>+</Text>
                  </TouchableOpacity>
                </View>
              ),
            )}
            <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
              {(Object.keys(READER_THEMES) as (keyof typeof READER_THEMES)[]).map((name) => (
                <TouchableOpacity
                  key={name}
                  style={[styles.themeBtn, { backgroundColor: READER_THEMES[name].bg }, rs.theme === name && { borderWidth: 2, borderColor: colors.accent }]}
                  onPress={() => {
                    setRs({ ...rs, theme: name });
                    import("../reader").then((m) => m.setReaderSetting("theme", name));
                  }}
                >
                  <Text style={{ color: READER_THEMES[name].text, fontSize: 12 }}>
                    {name === "dark" ? "тёмная" : name === "sepia" ? "сепия" : "светлая"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Список глав */}
      <Modal visible={showChapters} transparent animationType="slide" onRequestClose={() => setShowChapters(false)}>
        <View style={styles.modalBg}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface, height: "80%", width: "94%" }]}>
            <Text style={styles.modalTitle}>Главы</Text>
            <FlatList
              data={getChapters(bookId)}
              keyExtractor={(c) => String(c.id)}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.chapterRow, item.id === chapter.id && { backgroundColor: colors.surface2 }]}
                  onPress={() => {
                    setShowChapters(false);
                    navigation.replace("Reader", { bookId, chapterId: item.id });
                  }}
                >
                  <Text style={{ color: colors.text, flex: 1 }} numberOfLines={1}>
                    Т.{item.volume} Гл.{item.number}{item.title ? " — " + item.title : ""}
                  </Text>
                  <Text style={styles.dim}>
                    {item.source === "ranobelib" ? (item.origin === "native" ? "пер." : "MT") : "ориг."}
                  </Text>
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity style={styles.btn} onPress={() => setShowChapters(false)}>
              <Text style={styles.btnText}>Закрыть</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  meta: { fontSize: 12 },
  title: { fontSize: 19, fontWeight: "700", marginVertical: 8 },
  para: { marginBottom: 14 },
  dim: { color: colors.dim },
  btn: { backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, alignSelf: "flex-start", marginVertical: 8 },
  btnPlain: { backgroundColor: colors.surface2, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  btnText: { color: "#fff", fontSize: 14 },
  toolsRow: { flexDirection: "row", gap: 8, marginVertical: 4 },
  toolBtn: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  toolText: { fontSize: 13 },
  barBg: { height: 3, width: '100%', overflow: 'hidden' },
  bar: { height: 3 },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
  modalCard: { borderRadius: 12, padding: 16, gap: 10, width: '88%' },
  modalTitle: { color: colors.text, fontSize: 16, fontWeight: "600" },
  step: { backgroundColor: colors.surface2, borderRadius: 8, width: 36, height: 32, alignItems: 'center', justifyContent: 'center' },
  themeBtn: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: colors.border },
  chapterRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, paddingVertical: 8 },
  navRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 20,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
