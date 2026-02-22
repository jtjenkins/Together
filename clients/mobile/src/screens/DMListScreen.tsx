import React, { useEffect } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { DmStackParamList } from "../navigation";
import { useDmStore } from "../stores/dmStore";
import { useReadStateStore } from "../stores/readStateStore";
import type { DirectMessageChannel } from "../types";

type Props = NativeStackScreenProps<DmStackParamList, "DMList">;

function formatLastMessageTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString();
}

export function DMListScreen({ navigation }: Props) {
  const { dmChannels, isLoading, fetchDmChannels } = useDmStore();
  const unreadCounts = useReadStateStore((s) => s.unreadCounts);

  useEffect(() => {
    fetchDmChannels();
  }, [fetchDmChannels]);

  const renderItem = ({ item }: { item: DirectMessageChannel }) => {
    const unread = unreadCounts[item.id] ?? 0;
    const initial = item.recipient.username.charAt(0).toUpperCase();

    return (
      <TouchableOpacity
        style={styles.dmItem}
        onPress={() =>
          navigation.navigate("DMChat", {
            channelId: item.id,
            recipientUsername: item.recipient.username,
            recipientId: item.recipient.id,
          })
        }
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initial}</Text>
        </View>
        <View style={styles.dmInfo}>
          <Text style={styles.username}>{item.recipient.username}</Text>
          {item.last_message_at && (
            <Text style={styles.lastTime}>
              {formatLastMessageTime(item.last_message_at)}
            </Text>
          )}
        </View>
        {unread > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unread > 99 ? "99+" : unread}</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  if (isLoading && dmChannels.length === 0) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color="#7289da" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={dmChannels}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No direct messages yet.</Text>
            <Text style={styles.emptySubtext}>
              Start a conversation from a user's profile.
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a1a2e",
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
  },
  list: {
    paddingVertical: 8,
  },
  dmItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#36393f",
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#7289da",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  avatarText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
  },
  dmInfo: {
    flex: 1,
  },
  username: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  lastTime: {
    color: "#72767d",
    fontSize: 12,
    marginTop: 2,
  },
  badge: {
    backgroundColor: "#ed4245",
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  badgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
  emptyContainer: {
    alignItems: "center",
    paddingTop: 60,
    paddingHorizontal: 32,
  },
  emptyText: {
    color: "#b9bbbe",
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
  },
  emptySubtext: {
    color: "#72767d",
    fontSize: 14,
    marginTop: 8,
    textAlign: "center",
  },
});
