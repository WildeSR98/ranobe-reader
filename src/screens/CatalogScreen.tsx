import React, { useEffect, useState } from "react";
import { FlatList, Image, Text, TextInput, TouchableOpacity, View, StyleSheet, ActivityIndicator } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { colors } from "../theme";
import { catalog, search, getGenres, COVER_HEADERS, type BookItem, type Genre } from "../sources/ranobelib";
import type { RootStackParamList } from "../../App";

export default function CatalogScreen() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<BookItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [genres, setGenres] = useState<Genre[]>([]);
  const [genreId, setGenreId] = useState<number | null>(null);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  async function load(q: string, nextPage: number, append: boolean, gId: number | null = genreId) {
    setLoading(true);
    try {
      const data = q ? await search(q, nextPage, gId) : await catalog(nextPage, gId);
      setItems((prev) => (append ? [...prev, ...data.items] : data.items));
      setHasNext(data.has_next);
      setPage(nextPage);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load("", 1, false);
    getGenres().then(setGenres).catch(() => {});
  }, []);

  // Поиск с задержкой 500 мс.
  useEffect(() => {
    if (!query) return;
    const t = setTimeout(() => load(query, 1, false), 500);
    return () => clearTimeout(t);
  }, [query]);

  // Смена жанра — перезагрузка с первой страницы.
  useEffect(() => {
    load(query, 1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genreId]);

  function open(item: BookItem) {
    // Переход мгновенный; карточку и главы BookScreen грузит сам со спиннером.
    navigation.navigate("Book", { slug: item.slug });
  }

  return (
    <View style={styles.wrap}>
      <TextInput
        style={styles.search}
        placeholder="Поиск на ранобелибе…"
        placeholderTextColor={colors.dim}
        value={query}
        onChangeText={setQuery}
      />
      {genres.length > 0 && (
        <FlatList
          horizontal
          data={genres}
          keyExtractor={(g) => String(g.id)}
          showsHorizontalScrollIndicator={false}
          style={{ maxHeight: 44 }}
          contentContainerStyle={{ gap: 8, paddingHorizontal: 12, paddingBottom: 4 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.chip, genreId === item.id && styles.chipActive]}
              onPress={() => setGenreId(genreId === item.id ? null : item.id)}
            >
              <Text style={[styles.chipText, genreId === item.id && styles.chipTextActive]}>
                {item.name}
              </Text>
            </TouchableOpacity>
          )}
        />
      )}
      <FlatList
        data={items}
        keyExtractor={(b, i) => `${b.slug}-${i}`}
        numColumns={3}
        columnWrapperStyle={{ gap: 10, paddingHorizontal: 12 }}
        contentContainerStyle={{ gap: 12, paddingVertical: 12 }}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => open(item)}>
            <Image source={{ uri: item.cover ?? undefined, headers: COVER_HEADERS }} style={styles.cover} />
            <View style={styles.wnBadge}>
              <Text style={styles.wnBadgeText}>{item.type_label ?? "WN"}</Text>
            </View>
            {item.rate ? (
              <View style={styles.rateBadge}>
                <Text style={styles.rateText}>★ {item.rate}</Text>
              </View>
            ) : null}
            <Text numberOfLines={2} style={styles.title}>
              {item.title}
            </Text>
          </TouchableOpacity>
        )}
        onEndReached={() => {
          if (hasNext && !loading) load(query, page + 1, true);
        }}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          loading ? <ActivityIndicator color={colors.accent} style={{ margin: 16 }} /> : undefined
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  search: {
    backgroundColor: colors.surface2,
    color: colors.text,
    borderRadius: 10,
    padding: 12,
    margin: 12,
    fontSize: 15,
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
  card: { flex: 1, backgroundColor: colors.surface, borderRadius: 10, overflow: "hidden" },
  cover: { width: "100%", aspectRatio: 2 / 3, backgroundColor: colors.surface2 },
  wnBadge: {
    position: "absolute",
    top: 6,
    left: 6,
    backgroundColor: "rgba(15,15,20,0.75)",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  wnBadgeText: { color: colors.accent, fontSize: 10, fontWeight: "700" },
  rateBadge: {
    position: "absolute",
    top: 6,
    right: 6,
    backgroundColor: "rgba(15,15,20,0.75)",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  rateText: { color: "#ffd75e", fontSize: 10, fontWeight: "600" },
  title: { color: colors.text, fontSize: 13, lineHeight: 17, padding: 8 },
  more: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 14,
    margin: 12,
    alignItems: "center",
  },
});
