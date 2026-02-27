import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  Linking,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { api } from "../api/client";
import type { LinkPreviewDto } from "../types";

interface LinkPreviewProps {
  url: string;
}

export function LinkPreview({ url }: LinkPreviewProps) {
  const [data, setData] = useState<LinkPreviewDto | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .getLinkPreview(url)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err: unknown) => {
        // Link preview failures are non-fatal — the component renders nothing.
        // Log so systematic failures (auth regression, server down) are visible.
        console.warn("[LinkPreview] fetch failed", { url, err });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (loading) {
    return (
      <View style={styles.skeleton}>
        <ActivityIndicator size="small" color="#5865f2" />
      </View>
    );
  }

  if (!data?.title) return null;

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => {
        Linking.openURL(url).catch((err: unknown) => {
          console.warn("[LinkPreview] Linking.openURL failed", { url, err });
          Alert.alert(
            "Could not open link",
            "This link cannot be opened on your device.",
          );
        });
      }}
      activeOpacity={0.8}
    >
      <View style={styles.content}>
        {data.site_name && (
          <Text style={styles.siteName} numberOfLines={1}>
            {data.site_name}
          </Text>
        )}
        <Text style={styles.title} numberOfLines={2}>
          {data.title}
        </Text>
        {data.description && (
          <Text style={styles.description} numberOfLines={2}>
            {data.description}
          </Text>
        )}
      </View>
      {data.image && (
        <Image
          source={{ uri: data.image }}
          style={styles.thumbnail}
          resizeMode="cover"
        />
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  skeleton: {
    height: 64,
    marginTop: 6,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.06)",
    justifyContent: "center",
    alignItems: "center",
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
    borderLeftWidth: 3,
    borderLeftColor: "#5865f2",
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.04)",
    overflow: "hidden",
  },
  content: {
    flex: 1,
    padding: 10,
    gap: 2,
  },
  siteName: {
    fontSize: 10,
    fontWeight: "700",
    color: "#8e9297",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  title: {
    fontSize: 13,
    fontWeight: "600",
    color: "#00aff4",
  },
  description: {
    fontSize: 12,
    color: "#b9bbbe",
    lineHeight: 16,
  },
  thumbnail: {
    width: 72,
    height: 72,
    flexShrink: 0,
  },
});
