import React, { useState, useEffect } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  Image,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
} from "react-native";
import { api } from "../api/client";
import type { GifResult } from "../types";

interface GifPickerModalProps {
  visible: boolean;
  initialQuery: string;
  onSelect: (gif: GifResult) => void;
  onClose: () => void;
}

export function GifPickerModal({
  visible,
  initialQuery,
  onSelect,
  onClose,
}: GifPickerModalProps) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<GifResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const colWidth = (Dimensions.get("window").width - 48) / 2;

  useEffect(() => {
    if (visible) setQuery(initialQuery);
  }, [visible, initialQuery]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const id = setTimeout(async () => {
      setIsLoading(true);
      setError(null);
      try {
        const gifs = await api.searchGifs(query, 12);
        setResults(gifs);
      } catch {
        setError("Could not load GIFs");
      } finally {
        setIsLoading(false);
      }
    }, 500);
    return () => clearTimeout(id);
  }, [query]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>🔍 GIF Search</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.closeBtn}>✕</Text>
          </TouchableOpacity>
        </View>
        <TextInput
          style={styles.searchInput}
          placeholder="Search GIFs…"
          placeholderTextColor="#888"
          value={query}
          onChangeText={setQuery}
          autoFocus
        />
        {isLoading && (
          <ActivityIndicator color="#5865f2" style={{ margin: 20 }} />
        )}
        {error && <Text style={styles.status}>{error}</Text>}
        {!isLoading &&
          !error &&
          results.length === 0 &&
          query.trim() !== "" && (
            <Text style={styles.status}>No GIFs found</Text>
          )}
        <FlatList
          data={results}
          numColumns={2}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={styles.row}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.gifTile, { width: colWidth }]}
              onPress={() => onSelect(item)}
            >
              <Image
                source={{ uri: item.preview_url }}
                style={{
                  width: colWidth,
                  height: colWidth * (item.height / item.width),
                }}
                resizeMode="cover"
              />
            </TouchableOpacity>
          )}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#1e1f22" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    paddingTop: 20,
  },
  title: { color: "#fff", fontSize: 17, fontWeight: "600" },
  closeBtn: { color: "#aaa", fontSize: 22 },
  searchInput: {
    margin: 12,
    marginTop: 0,
    padding: 10,
    backgroundColor: "#2b2d31",
    borderRadius: 8,
    color: "#fff",
    fontSize: 15,
  },
  status: { color: "#888", textAlign: "center", margin: 20, fontSize: 14 },
  grid: { padding: 12 },
  row: { gap: 8, marginBottom: 8 },
  gifTile: {
    borderRadius: 6,
    overflow: "hidden",
    backgroundColor: "#383a40",
  },
});
