import React, { useCallback, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Text, TouchableOpacity, View, StyleSheet } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { colors } from "../theme";
import { db } from "../db";
import { importFile } from "../lib/epub";
import { sortKey } from "../sources/ranobelib";
import { toast } from "../toast";
import type { RootStackParamList } from "../../App";

interface EpubBook {
  id: number;
  title_ru: string;
  chapters_total: number;
}

function importToDb(name: string, title: string, chapters: { title: string | null; paragraphs: string[] }[]): number {
  let bookId: number = 0;
  db.withTransactionSync(() => {
    db.runSync(
      "INSERT INTO books(source, source_slug, title_ru, title_orig, cover_url, description, status, metadata_json) VALUES('epub', ?, ?, NULL, NULL, NULL, NULL, '{}')",
      [`${name}-${Date.now()}`, title],
    );
    bookId = db.getFirstSync<{ id: number }>(
      "SELECT id FROM books WHERE source = 'epub' ORDER BY id DESC LIMIT 1",
    )!.id;
    chapters.forEach((ch, idx) => {
      db.runSync(
        "INSERT INTO chapters(book_id, source, volume, number, title, sort_key, origin, url) VALUES(?,?,?,?,?,?,'orig',?)",
        [bookId, "epub", "1", String(idx + 1), ch.title, sortKey("1", String(idx + 1)), `epub://${name}#${idx}`],
      );
      const row = db.getFirstSync<{ id: number }>(
        "SELECT id FROM chapters WHERE book_id = ? AND source = 'epub' AND number = ?",
        [bookId, String(idx + 1)],
      )!;
      db.runSync("INSERT INTO chapter_content(chapter_id, body_json) VALUES(?, ?)", [
        row.id,
        JSON.stringify(ch.paragraphs),
      ]);
    });
  });
  return bookId;
}

export default function EpubScreen() {
  const [busy, setBusy] = useState(false);
  const [books, setBooks] = useState<EpubBook[]>([]);
  const navigation = useNavigation<any>();

  useFocusEffect(
    useCallback(() => {
      setBooks(
        db.getAllSync<any>(
          `SELECT b.id, b.title_ru, (SELECT COUNT(*) FROM chapters c WHERE c.book_id = b.id) AS chapters_total
           FROM books b WHERE b.source = 'epub' ORDER BY b.created_at DESC`,
        ),
      );
    }, []),
  );

  async function pick() {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
      });
      if (res.canceled) return;
      const asset = res.assets[0];
      if (!/\.(epub|txt)$/i.test(asset.name ?? "")) {
        Alert.alert("Формат", "Поддерживаются .epub и .txt");
        return;
      }
      setBusy(true);
      const { title, chapters } = await importFile(asset.uri, asset.name);
      const bookId = importToDb(asset.name, title, chapters);
      toast(`Импортировано глав: ${chapters.length}`);
      navigation.navigate("Book", { bookId });
    } catch (e: any) {
      Alert.alert("Ошибка импорта", String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <View style={{ padding: 16, gap: 10 }}>
        <Text style={{ color: colors.text, fontSize: 16, fontWeight: "600" }}>Оригинал из файла</Text>
        <Text style={styles.dim}>
          Импортируйте .epub или .txt — это любой оригинал откуда угодно: переводы,
          выгрузки с сайтов, собственные файлы. Книга появится в библиотеке, главы
          будут доступны офлайн и для перевода.
        </Text>
        <TouchableOpacity style={styles.btn} onPress={pick} disabled={busy}>
          <Text style={styles.btnText}>{busy ? "Импортирую…" : "Выбрать файл"}</Text>
        </TouchableOpacity>
        {busy && <ActivityIndicator color={colors.accent} />}
      </View>

      {books.length > 0 && (
        <View style={{ paddingHorizontal: 16, gap: 8 }}>
          <Text style={styles.dim}>Импортированные книги:</Text>
          <FlatList
            data={books}
            keyExtractor={(b) => String(b.id)}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.row}
                onPress={() => navigation.navigate("Book", { bookId: item.id })}
              >
                <Text style={{ color: colors.text, flex: 1 }} numberOfLines={1}>
                  {item.title_ru}
                </Text>
                <Text style={styles.dim}>гл. {item.chapters_total}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  dim: { color: colors.dim, fontSize: 13, lineHeight: 19 },
  btn: { backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, alignSelf: "flex-start" },
  btnText: { color: "#fff", fontSize: 14 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 12,
  },
});
