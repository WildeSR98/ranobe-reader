import React, { useCallback, useState } from "react";
import { FlatList, Image, Text, TouchableOpacity, View, StyleSheet } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { colors } from "../theme";
import { db, getSetting, setSetting } from "../db";
import { BOOK_STATUSES, refreshBook, type BookStatus } from "../lib/library";
import { COVER_HEADERS } from "../sources/ranobelib";
import { toast } from "../toast";

interface LibBook {
  id: number;
  source_slug: string;
  title_ru: string;
  cover_url: string | null;
  chapters_total: number;
  my_status: BookStatus;
  progress_chapter_id: number | null;
  progress_volume: string | null;
  progress_number: string | null;
  progress_sk: number | null;
  read_count: number;
  pct: number;
}

const STATUS_FILTERS: { key: "all" | BookStatus; label: string }[] = [
  { key: "all", label: "Все" },
  { key: "reading", label: "Читаю" },
  { key: "planned", label: "В планах" },
  { key: "dropped", label: "Заброшено" },
  { key: "completed", label: "Прочитано" },
];

export default function LibraryScreen() {
  const [books, setBooks] = useState<LibBook[]>([]);
  const [filter, setFilter] = useState<"all" | BookStatus>("all");
  const navigation = useNavigation<any>();

  useFocusEffect(
    useCallback(() => {
      loadBooks();
      void maybeAutoRefresh();
    }, []),
  );

  function loadBooks() {
    const rows = db.getAllSync<any>(
      `SELECT b.id, b.source_slug, b.title_ru, b.cover_url, b.my_status,
              (SELECT COUNT(*) FROM chapters ch WHERE ch.book_id = b.id) AS chapters_total,
              r.chapter_id AS progress_chapter_id, c.volume AS progress_volume,
              c.number AS progress_number, c.sort_key AS progress_sk
       FROM books b
       LEFT JOIN reading_progress r ON r.book_id = b.id
       LEFT JOIN chapters c ON c.id = r.chapter_id
       ORDER BY b.created_at DESC, b.id DESC`,
    );
    for (const r of rows) {
      r.read_count = 0;
      if (r.progress_sk != null) {
        r.read_count =
          db.getFirstSync<{ n: number }>(
            "SELECT COUNT(*) AS n FROM chapters WHERE book_id = ? AND sort_key <= ?",
            [r.id, r.progress_sk],
          )?.n ?? 0;
      }
      r.pct =
        r.chapters_total > 0
          ? Math.min(100, Math.round((r.read_count / r.chapters_total) * 100))
          : 0;
    }
    setBooks(rows);
  }

  // Тихое обновление книг с оригиналом не чаще раза в час.
  async function maybeAutoRefresh() {
    const last = Number(getSetting("last_refresh") ?? 0);
    if (Date.now() - last < 60 * 60 * 1000) return;
    setSetting("last_refresh", String(Date.now()));
    const targets = db.getAllSync<{ id: number }>(
      "SELECT DISTINCT b.id FROM books b JOIN source_links sl ON sl.book_id = b.id AND sl.kind = 'original' LIMIT 10",
    );
    let added = 0;
    for (const t of targets) {
      try {
        const r = await refreshBook(t.id);
        added += r.newNative + r.newOriginal;
      } catch {
        // недоступна — молча
      }
    }
    if (added > 0) {
      toast(`Новых глав: ${added}`);
      loadBooks();
    }
  }

  const reading = books.filter((b) => b.progress_chapter_id != null);
  const shown = filter === "all" ? books : books.filter((b) => b.my_status === filter);
  const countOf = (key: "all" | BookStatus) =>
    key === "all" ? books.length : books.filter((b) => b.my_status === key).length;

  return (
    <View style={styles.wrap}>
      {reading.length > 0 && (
        <View style={styles.shelfWrap}>
          <Text style={styles.shelfTitle}>Продолжить чтение</Text>
          <FlatList
            horizontal
            data={reading}
            keyExtractor={(b) => String(b.id)}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 10, paddingHorizontal: 12 }}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.shelfCard}
                onPress={() =>
                  navigation.navigate("Reader", {
                    bookId: item.id,
                    chapterId: item.progress_chapter_id,
                  })
                }
              >
                <Image
                  source={{ uri: item.cover_url ?? undefined, headers: COVER_HEADERS }}
                  style={styles.shelfCover}
                />
                <View style={styles.shelfBarBg}>
                  <View style={[styles.shelfBar, { width: item.pct + "%" }]} />
                </View>
                <Text numberOfLines={1} style={styles.shelfLabel}>
                  гл.{item.progress_number} · {item.pct}%
                </Text>
              </TouchableOpacity>
            )}
          />
        </View>
      )}

      <View style={styles.chips}>
        {STATUS_FILTERS.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.chip, filter === f.key && styles.chipActive]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[styles.chipText, filter === f.key && styles.chipTextActive]}>
              {f.label} {countOf(f.key)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {shown.length === 0 && (
        <Text style={styles.empty}>
          {filter === "all"
            ? "Пусто. Найдите книгу в каталоге и откройте её карточку."
            : "В этой категории пока пусто."}
        </Text>
      )}
      <FlatList
        data={shown}
        keyExtractor={(b) => String(b.id)}
        numColumns={3}
        columnWrapperStyle={{ gap: 10, paddingHorizontal: 12 }}
        contentContainerStyle={{ gap: 12, paddingVertical: 12 }}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() =>
              item.progress_chapter_id
                ? navigation.navigate("Reader", {
                    bookId: item.id,
                    chapterId: item.progress_chapter_id,
                  })
                : navigation.navigate("Book", { bookId: item.id })
            }
          >
            <Image
              source={{ uri: item.cover_url ?? undefined, headers: COVER_HEADERS }}
              style={styles.cover}
            />
            {item.progress_chapter_id != null && (
              <View style={styles.barBg}>
                <View style={[styles.bar, { width: item.pct + "%" }]} />
              </View>
            )}
            <Text numberOfLines={2} style={styles.title}>
              {item.title_ru}
            </Text>
            <Text style={styles.sub} numberOfLines={1}>
              {item.progress_chapter_id
                ? item.read_count + "/" + item.chapters_total + " гл."
                : (BOOK_STATUSES[item.my_status] ?? "Читаю") + " · " + item.chapters_total + " гл."}
            </Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  shelfWrap: { paddingTop: 10 },
  shelfTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "600",
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  shelfCard: { width: 96 },
  shelfCover: { width: 96, height: 138, borderRadius: 8, backgroundColor: colors.surface2 },
  shelfBarBg: { height: 4, backgroundColor: colors.surface2, borderRadius: 2, marginTop: 6, overflow: "hidden" },
  shelfBar: { height: 4, backgroundColor: colors.accent },
  shelfLabel: { color: colors.dim, fontSize: 11, marginTop: 3 },
  chips: { flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingTop: 10, flexWrap: "wrap" },
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
  empty: { color: colors.dim, padding: 20, textAlign: "center", marginTop: 20 },
  card: { flex: 1, backgroundColor: colors.surface, borderRadius: 10, overflow: "hidden" },
  cover: { width: "100%", aspectRatio: 2 / 3, backgroundColor: colors.surface2 },
  barBg: { height: 3, backgroundColor: colors.surface2 },
  bar: { height: 3, backgroundColor: colors.accent },
  title: { color: colors.text, fontSize: 13, lineHeight: 17, padding: 8 },
  sub: { color: colors.dim, fontSize: 11.5, paddingHorizontal: 8, paddingBottom: 8 },
});
