import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Image, ScrollView, Text, TextInput, TouchableOpacity, View, StyleSheet } from "react-native";
import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { colors } from "../theme";
import { db } from "../db";
import {
  addBookmark, addToLibrary, deleteBookmark, downloadAhead, getBook, getBookmarks,
  getChapters, getOriginalLink, getProgress, refreshBook, removeFromLibrary, saveProgress,
  setBookStatus, BOOK_STATUSES, type BookStatus,
} from "../lib/library";
import {
  addGlossaryEntry, alignOriginal, deleteGlossaryEntry, detachOriginal,
  getGlossaryList, onQueueChange, queueStatus, translateAhead,
} from "../lib/translate";
import * as syosetu from "../sources/syosetu";
import { COVER_HEADERS } from "../sources/ranobelib";
import { findOriginalCandidates, type OriginalCandidate } from "../sources/discovery";
import { SITES } from "../sources/sites";
import { toast } from "../toast";
import type { ChapterRow } from "../lib/library";
import type { RootStackParamList } from "../../App";

type BookTab = "about" | "chapters" | "bookmarks" | "glossary";

const TABS: { key: BookTab; label: string }[] = [
  { key: "about", label: "О тайтле" },
  { key: "chapters", label: "Главы" },
  { key: "bookmarks", label: "Закладки" },
  { key: "glossary", label: "Глоссарий" },
];

const STATUS_COLORS: Record<string, string> = {
  Онгоинг: "#4caf50",
  Завершён: "#7b6cf6",
  Анонс: "#e0a24c",
  Заморожен: "#9494a5",
  Вышел: "#4caf50",
};

export default function BookScreen() {
  const route = useRoute<RouteProp<RootStackParamList, "Book">>();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [bookId, setBookId] = useState<number | null>(route.params.bookId ?? null);
  const [adding, setAdding] = useState(!route.params.bookId && !!route.params.slug);
  const [addError, setAddError] = useState<string | null>(null);

  const [book, setBook] = useState<any>(null);
  const [chapters, setChapters] = useState<ChapterRow[]>([]);
  const [progress, setProgress] = useState<any>(null);
  const [original, setOriginal] = useState<any>(null);
  const [jobs, setJobs] = useState(queueStatus());
  const [tab, setTab] = useState<BookTab>("about");
  const [chapterQuery, setChapterQuery] = useState("");

  const [origUrl, setOrigUrl] = useState("");
  const [alignNative, setAlignNative] = useState("");
  const [trCount, setTrCount] = useState("5");
  const [dlCount, setDlCount] = useState("10");
  const [busy, setBusy] = useState(false);
  const [candidates, setCandidates] = useState<OriginalCandidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchWord, setSearchWord] = useState("");
  const [glossary, setGlossary] = useState<{ id: number; term_src: string; term_ru: string }[]>([]);
  const [gSrc, setGSrc] = useState("");
  const [gRu, setGRu] = useState("");
  const [bookmarks, setBookmarks] = useState<any[]>([]);
  const [myStatus, setMyStatus] = useState<BookStatus>("reading");

  function load() {
    if (!bookId) return;
    const b = getBook(bookId);
    setBook(b);
    setChapters(getChapters(bookId));
    setProgress(getProgress(bookId));
    setOriginal(getOriginalLink(bookId));
    setGlossary(getGlossaryList(bookId));
    setBookmarks(getBookmarks(bookId));
    setMyStatus((b?.my_status as BookStatus) ?? "reading");
  }

  useFocusEffect(useCallback(() => { load(); }, [bookId]));

  // Открытие из каталога: slug → добавляем в библиотеку здесь, со спиннером.
  useEffect(() => {
    const slug = route.params.slug;
    if (bookId || !slug) return;
    let cancelled = false;
    (async () => {
      try {
        const id = await addToLibrary(slug);
        if (!cancelled) {
          setBookId(id);
          // Первые главы — в офлайн-кэш сразу (см. CONTEXT: офлайн-чтение).
          void downloadAhead(id, 10).catch(() => {});
        }
      } catch (e: any) {
        if (!cancelled) setAddError(String(e.message ?? e));
      } finally {
        if (!cancelled) setAdding(false);
      }
    })();
    return () => { cancelled = true; };
  }, [bookId, route.params.slug]);

  useEffect(() => onQueueChange(() => {
    setJobs(queueStatus());
    load();
  }), [bookId]);

  useEffect(() => {
    const t = setInterval(() => {
      setJobs(queueStatus());
      if (jobs.pending > 0 || jobs.running) load();
    }, 3000);
    return () => clearInterval(t);
  }, [jobs, bookId]);

  async function autoFind() {
    setSearching(true);
    setCandidates(null);
    try {
      const { candidates: found, stats } = await findOriginalCandidates(
        book?.title_orig ?? null,
        searchWord.trim() || null,
      );
      setCandidates(found);
      if (found.length) {
        toast(`Кандидатов: ${found.length}`);
      } else {
        Alert.alert(
          "Не найдено",
          "Названий на AniList: " + stats.anilistTitles +
          ". Проверенные слова: " + (stats.terms.join(", ") || "—") +
          ". Если оригинал — не японская веб-новела, автопоиск бессилен: вставьте ссылку вручную или импортируйте EPUB.",
        );
      }
    } catch (e: any) {
      Alert.alert("Ошибка поиска", String(e.message ?? e));
    } finally {
      setSearching(false);
    }
  }

  async function attachCandidate(c: OriginalCandidate) {
    setBusy(true);
    try {
      const adapter = SITES[c.site];
      const { title: siteTitle, chapters: toc } = await adapter.toc(c.url);
      const n = alignOriginal(
        bookId!, c.site, c.url,
        toc.map((ch) => ({ title: ch.title, ref: ch.ref })),
        alignNative || "1", 1,
      );
      toast(`Подключено глав (${siteTitle || c.title}): ${n}`);
      setCandidates(null);
      load();
    } catch (e: any) {
      Alert.alert("Ошибка", String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function attachSyosetu() {
    setBusy(true);
    try {
      const novelId = syosetu.parseNovelId(origUrl);
      const { chapters: toc } = await syosetu.toc(novelId);
      const n = alignOriginal(
        bookId!, "syosetu", `https://ncode.syosetu.com/${novelId}/`,
        toc.map((ch) => ({ title: ch.title, ref: ch.ref })),
        alignNative || "1", 1,
      );
      toast(`Подключено глав оригинала: ${n}`);
      load();
    } catch (e: any) {
      Alert.alert("Ошибка", String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  if (addError) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.dim}>Ошибка: {addError}</Text>
      </View>
    );
  }
  if (adding || !book) {
    return (
      <View style={styles.wrap}>
        <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
        <Text style={[styles.dim, { textAlign: "center", marginTop: 12 }]}>
          Загружаю книгу из ранобелиба…
        </Text>
      </View>
    );
  }

  const meta = JSON.parse(book.metadata_json || "{}");
  const readUrl = (chapterId: number) => () => navigation.navigate("Reader", { bookId: bookId!, chapterId });
  const badge = (ch: ChapterRow) =>
    ch.source === "ranobelib"
      ? ch.origin === "native" ? "перевод" : "MT"
      : ch.origin === "mt" ? `MT·${ch.provider}` : "ориг.";

  const firstChapter = chapters.find((ch) => ch.number !== "0") ?? chapters[0];
  const progressSk = progress
    ? chapters.find((c) => c.id === progress.chapter_id)?.sort_key ?? null
    : null;
  const readCount = progressSk != null
    ? chapters.filter((c) => c.sort_key <= progressSk).length
    : 0;

  const filteredChapters = chapterQuery.trim()
    ? chapters.filter((c) =>
        (c.title ?? "").toLowerCase().includes(chapterQuery.toLowerCase()) ||
        c.number.includes(chapterQuery.trim()))
    : chapters;

  return (
    <View style={styles.wrap}>
      <ScrollView contentContainerStyle={{ padding: 12, gap: 14 }}>
        {/* Шапка */}
        <View style={{ flexDirection: "row", gap: 14 }}>
          <Image source={{ uri: book.cover ?? undefined, headers: COVER_HEADERS }} style={styles.cover} />
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={styles.h1}>{book.title}</Text>
            <Text style={styles.dim}>{book.title_orig}</Text>
            <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
              {meta.rate ? <Text style={styles.rate}>★ {meta.rate}</Text> : null}
              {book.status ? (
                <View style={[styles.statusChip, { backgroundColor: (STATUS_COLORS[book.status] ?? colors.dim) + "33" }]}>
                  <Text style={{ color: STATUS_COLORS[book.status] ?? colors.dim, fontSize: 12 }}>{book.status}</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.dim}>
              {[meta.year && meta.year + " г.", "Глав: " + chapters.length].filter(Boolean).join(" · ")}
            </Text>
          </View>
        </View>

        {/* Кнопки */}
        <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
          {progress ? (
            <TouchableOpacity style={styles.btn} onPress={readUrl(progress.chapter_id)}>
              <Text style={styles.btnText}>
                Продолжить · {readCount} / {chapters.length}
              </Text>
            </TouchableOpacity>
          ) : firstChapter ? (
            <TouchableOpacity style={styles.btn} onPress={() => navigation.navigate("Reader", { bookId: bookId!, chapterId: firstChapter.id })}>
              <Text style={styles.btnText}>Начать читать · 0 / {chapters.length}</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={styles.btnPlain}
            onPress={async () => {
              setBusy(true);
              try {
                const r = await refreshBook(bookId!);
                toast(`Новых глав: перевод ${r.newNative}, оригинал ${r.newOriginal}` +
                  (r.retired ? `, перекрыто MTL: ${r.retired}` : ""));
                load();
              } catch (e: any) {
                Alert.alert("Ошибка", String(e.message ?? e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Text style={styles.btnText}>Обновить</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.btnPlain}
            onPress={() => {
              removeFromLibrary(bookId!);
              navigation.goBack();
            }}
          >
            <Text style={styles.btnText}>Удалить</Text>
          </TouchableOpacity>
        </View>

        {/* Личный статус */}
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {(Object.keys(BOOK_STATUSES) as BookStatus[]).map((key) => (
            <TouchableOpacity
              key={key}
              style={[styles.chip, myStatus === key && styles.chipActive]}
              onPress={() => {
                setBookStatus(bookId!, key);
                setMyStatus(key);
                toast(`Статус: ${BOOK_STATUSES[key]}`);
                if (key === "reading" || key === "planned") {
                  void downloadAhead(bookId!, 10)
                    .then((n) => n > 0 && toast(`Для офлайна скачано глав: ${n}`))
                    .catch(() => {});
                }
              }}
            >
              <Text style={[styles.chipText, myStatus === key && styles.chipTextActive]}>
                {BOOK_STATUSES[key]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Вкладки */}
        <View style={styles.tabBar}>
          {TABS.map((t) => (
            <TouchableOpacity
              key={t.key}
              style={[styles.tabBtn, tab === t.key && styles.tabBtnActive]}
              onPress={() => setTab(t.key)}
            >
              <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {tab === "about" && (
          <View style={{ gap: 14 }}>
            {book.description ? (
              <Text style={[styles.dim, { lineHeight: 20 }]}>{book.description}</Text>
            ) : null}
            {meta.genres ? (
              <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                {String(meta.genres).split(",").map((g: string) => (
                  <View key={g} style={styles.genreChip}>
                    <Text style={styles.dim}>{g.trim()}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {/* Перевод */}
            <View style={styles.paper}>
              <Text style={styles.h2}>Перевод (онлайн-Google)</Text>
              {original ? (
                <View style={{ gap: 10 }}>
                  <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <Text style={styles.dim}>Вперёд</Text>
                    <TextInput style={styles.input} keyboardType="number-pad" value={trCount} onChangeText={setTrCount} />
                    <Text style={styles.dim}>глав</Text>
                    <TouchableOpacity
                      style={styles.btn}
                      onPress={() => {
                        const n = translateAhead(bookId!, parseInt(trCount) || 5, "google");
                        toast(n ? `В очереди перевода: ${n} глав` : "Непереведённых глав нет");
                      }}
                    >
                      <Text style={styles.btnText}>Запустить</Text>
                    </TouchableOpacity>
                  </View>
                  {(jobs.pending > 0 || jobs.running) && (
                    <Text style={styles.dim}>
                      {jobs.running ? "переводим… " : ""}
                      {jobs.pending ? "в очереди: " + jobs.pending : ""}
                    </Text>
                  )}
                  <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                    <Text style={styles.dim}>Скачать для офлайна</Text>
                    <TextInput style={styles.input} keyboardType="number-pad" value={dlCount} onChangeText={setDlCount} />
                    <TouchableOpacity
                      style={styles.btnPlain}
                      onPress={async () => {
                        setBusy(true);
                        try {
                          const n = await downloadAhead(bookId!, parseInt(dlCount) || 10);
                          toast("Скачано для офлайна: " + n + " глав");
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <Text style={styles.btnText}>Скачать</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <Text style={styles.dim}>Сначала подключите оригинал ниже.</Text>
              )}
            </View>

            {/* Оригинал */}
            <View style={styles.paper}>
              <Text style={styles.h2}>Оригинал (продолжение перевода)</Text>
              {original ? (
                <View style={{ gap: 8 }}>
                  <Text style={styles.dim}>
                    Подключён: {original.source} · {original.url}
                  </Text>
                  <TouchableOpacity
                    style={styles.btnPlain}
                    onPress={() => {
                      detachOriginal(bookId!);
                      load();
                    }}
                  >
                    <Text style={styles.btnText}>Отключить</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={{ gap: 10 }}>
                  <Text style={styles.dim}>
                    Глава перевода = глава оригинала. Главы после стыковки появятся как «ориг.».
                  </Text>
                  <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                    <Text style={styles.dim}>Гл. перевода</Text>
                    <TextInput
                      style={[styles.input, { width: 70 }]}
                      keyboardType="numbers-and-punctuation"
                      placeholder="120"
                      placeholderTextColor={colors.dim}
                      value={alignNative}
                      onChangeText={setAlignNative}
                    />
                  </View>
                  <TextInput
                    style={styles.input}
                    placeholder="Своё слово для поиска (канзи/романдзи) — необязательно"
                    placeholderTextColor={colors.dim}
                    autoCapitalize="none"
                    value={searchWord}
                    onChangeText={setSearchWord}
                  />
                  <TouchableOpacity
                    style={[styles.btn, (searching || !alignNative) && { opacity: 0.5 }]}
                    disabled={searching || !alignNative}
                    onPress={autoFind}
                  >
                    <Text style={styles.btnText}>
                      {searching ? "Ищу оригинал…" : "Найти оригинал автоматически"}
                    </Text>
                  </TouchableOpacity>

                  {candidates && candidates.length > 0 && (
                    <View style={{ gap: 6 }}>
                      <Text style={styles.dim}>Кандидаты — нажмите, чтобы подключить:</Text>
                      {candidates.map((c) => (
                        <TouchableOpacity
                          key={c.site + c.url}
                          style={styles.candidateRow}
                          disabled={busy}
                          onPress={() => attachCandidate(c)}
                        >
                          <Text style={styles.chapterTitle} numberOfLines={1}>
                            [{SITES[c.site]?.label ?? c.site}] {c.title}
                          </Text>
                          <Text style={styles.dim}>
                            {c.author ? c.author + " · " : ""}гл. {c.chapters}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}

                  <Text style={styles.dim}>…или вставьте ссылку вручную:</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="https://ncode.syosetu.com/n…"
                    placeholderTextColor={colors.dim}
                    autoCapitalize="none"
                    value={origUrl}
                    onChangeText={setOrigUrl}
                  />
                  <TouchableOpacity
                    style={[styles.btnPlain, (busy || !origUrl || !alignNative) && { opacity: 0.5 }]}
                    disabled={busy || !origUrl || !alignNative}
                    onPress={attachSyosetu}
                  >
                    <Text style={styles.btnText}>Подключить по ссылке</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>
        )}

        {tab === "chapters" && (
          <View style={{ gap: 10 }}>
            <TextInput
              style={styles.input}
              placeholder="Поиск главы по номеру/названию…"
              placeholderTextColor={colors.dim}
              value={chapterQuery}
              onChangeText={setChapterQuery}
            />
            <View style={{ backgroundColor: colors.surface, borderRadius: 10, overflow: "hidden" }}>
              {filteredChapters.map((ch) => (
                <TouchableOpacity
                  key={ch.source + "-" + ch.id}
                  style={styles.chapterRow}
                  onPress={readUrl(ch.id)}
                >
                  <Text style={styles.chapterTitle} numberOfLines={1}>
                    Т.{ch.volume} Гл.{ch.number}
                    {ch.title ? " — " + ch.title : ""}
                  </Text>
                  <Text style={styles.dim}>{badge(ch)}</Text>
                </TouchableOpacity>
              ))}
              {filteredChapters.length === 0 && (
                <Text style={[styles.dim, { padding: 14 }]}>Ничего не найдено.</Text>
              )}
            </View>
          </View>
        )}

        {tab === "bookmarks" && (
          <View style={styles.paper}>
            {bookmarks.length === 0 ? (
              <Text style={styles.dim}>
                Закладок нет. В ридере есть кнопка «☆ Закладка» — она запомнит место в главе.
              </Text>
            ) : (
              bookmarks.map((bm) => (
                <View key={bm.id} style={styles.chapterRow}>
                  <TouchableOpacity
                    style={{ flex: 1 }}
                    onPress={() => {
                      saveProgress(bookId!, bm.chapter_id, bm.scroll_pct);
                      navigation.navigate("Reader", { bookId: bookId!, chapterId: bm.chapter_id });
                    }}
                  >
                    <Text style={styles.chapterTitle} numberOfLines={1}>
                      {bm.label || "Т." + bm.volume + " Гл." + bm.number}
                    </Text>
                    <Text style={styles.dim}>
                      Т.{bm.volume} Гл.{bm.number}{bm.chapter_title ? " — " + bm.chapter_title : ""}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => { deleteBookmark(bm.id); load(); }}>
                    <Text style={styles.dim}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
          </View>
        )}

        {tab === "glossary" && (
          <View style={styles.paper}>
            <Text style={styles.dim}>
              Имена и термины для перевода: «оригинал → перевод». Учитывается при переводе глав.
            </Text>
            {glossary.map((g) => (
              <View key={g.id} style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                <Text style={{ color: colors.text, flex: 1 }} numberOfLines={1}>
                  {g.term_src} → {g.term_ru}
                </Text>
                <TouchableOpacity onPress={() => { deleteGlossaryEntry(g.id); load(); }}>
                  <Text style={styles.dim}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="Оригинал"
                placeholderTextColor={colors.dim}
                value={gSrc}
                onChangeText={setGSrc}
              />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="Перевод"
                placeholderTextColor={colors.dim}
                value={gRu}
                onChangeText={setGRu}
              />
            </View>
            <TouchableOpacity
              style={styles.btnPlain}
              onPress={() => {
                if (!gSrc.trim() || !gRu.trim()) return;
                addGlossaryEntry(bookId!, gSrc.trim(), gRu.trim());
                setGSrc(""); setGRu("");
                load();
              }}
            >
              <Text style={styles.btnText}>Добавить</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  cover: { width: 110, height: 165, borderRadius: 10, backgroundColor: colors.surface2 },
  h1: { color: colors.text, fontSize: 20, fontWeight: "700" },
  h2: { color: colors.text, fontSize: 16, fontWeight: "600" },
  dim: { color: colors.dim, fontSize: 13 },
  rate: { color: "#ffd75e", fontSize: 16, fontWeight: "700" },
  statusChip: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  paper: { backgroundColor: colors.surface, borderRadius: 10, padding: 14, gap: 8 },
  btn: { backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  btnPlain: { backgroundColor: colors.surface2, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  btnText: { color: "#fff", fontSize: 14 },
  input: {
    backgroundColor: colors.surface2,
    color: colors.text,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 120,
    fontSize: 14,
  },
  chip: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.dim, fontSize: 13 },
  chipTextActive: { color: "#fff" },
  genreChip: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tabBar: {
    flexDirection: "row",
    gap: 4,
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 4,
  },
  tabBtn: { flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: 8 },
  tabBtnActive: { backgroundColor: colors.surface2 },
  tabText: { color: colors.dim, fontSize: 13.5 },
  tabTextActive: { color: colors.text, fontWeight: "600" },
  chapterRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  chapterTitle: { color: colors.text, fontSize: 14, flex: 1 },
  candidateRow: {
    backgroundColor: colors.surface2,
    borderRadius: 8,
    padding: 10,
    gap: 2,
  },
});
