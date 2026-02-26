import React, { useEffect } from "react";
import {
  View,
  Text,
  SectionList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { ServersStackParamList } from "../navigation";
import { useChannelStore } from "../stores/channelStore";
import { useServerStore } from "../stores/serverStore";
import { useReadStateStore } from "../stores/readStateStore";
import { api } from "../api/client";
import type { Channel } from "../types";

type Props = NativeStackScreenProps<ServersStackParamList, "ChannelList">;

export function ChannelListScreen({ route, navigation }: Props) {
  const { serverId } = route.params;
  const { channels, isLoading, error, fetchChannels, setActiveChannel } =
    useChannelStore();
  const setActiveServer = useServerStore((s) => s.setActiveServer);
  const unreadCounts = useReadStateStore((s) => s.unreadCounts);
  const markRead = useReadStateStore((s) => s.markRead);
  const mentionCounts = useReadStateStore((s) => s.mentionCounts);
  const clearMentions = useReadStateStore((s) => s.clearMentions);

  useEffect(() => {
    setActiveServer(serverId);
    fetchChannels(serverId);
  }, [serverId, setActiveServer, fetchChannels]);

  const textChannels = channels.filter((c) => c.type === "text");
  const voiceChannels = channels.filter((c) => c.type === "voice");

  const sections = [
    ...(textChannels.length > 0
      ? [{ title: "Text Channels", data: textChannels }]
      : []),
    ...(voiceChannels.length > 0
      ? [{ title: "Voice Channels", data: voiceChannels }]
      : []),
  ];

  const handleChannelPress = (channel: Channel) => {
    setActiveChannel(channel.id);
    if (channel.type === "text") {
      markRead(channel.id);
      clearMentions(channel.id);
      api.ackChannel(channel.id).catch((err) => {
        console.warn("[ChannelListScreen] ack failed", err);
      });
      navigation.navigate("Chat", {
        channelId: channel.id,
        channelName: channel.name,
        serverId,
      });
    } else {
      navigation.navigate("Voice", {
        channelId: channel.id,
        channelName: channel.name,
        serverId,
      });
    }
  };

  if (isLoading && channels.length === 0) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color="#7289da" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {error && channels.length === 0 && (
        <Text style={styles.errorText}>{error}</Text>
      )}
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
          </View>
        )}
        renderItem={({ item }) => {
          const unread = unreadCounts[item.id] ?? 0;
          const mentions = mentionCounts[item.id] ?? 0;
          return (
            <TouchableOpacity
              style={styles.channelItem}
              onPress={() => handleChannelPress(item)}
            >
              <View style={styles.channelPrefixContainer}>
                {item.type === "text" ? (
                  <Text style={styles.channelPrefixText}>#</Text>
                ) : (
                  <Feather name="volume-2" size={16} color="#72767d" />
                )}
              </View>
              <Text
                style={[
                  styles.channelName,
                  unread > 0 && styles.channelNameUnread,
                ]}
              >
                {item.name}
              </Text>
              {mentions > 0 && (
                <View style={styles.mentionBadge}>
                  <Text style={styles.mentionBadgeText}>@</Text>
                </View>
              )}
              {unread > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>
                    {unread > 99 ? "99+" : unread}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <Text style={styles.empty}>No channels in this server yet.</Text>
        }
        contentContainerStyle={styles.list}
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
    paddingBottom: 20,
  },
  sectionHeader: {
    backgroundColor: "#1a1a2e",
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 6,
  },
  sectionTitle: {
    color: "#72767d",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  channelItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 6,
    marginHorizontal: 8,
  },
  channelPrefixContainer: {
    width: 20,
    alignItems: "center",
    marginRight: 8,
  },
  channelPrefixText: {
    color: "#72767d",
    fontSize: 16,
  },
  channelName: {
    color: "#dcddde",
    fontSize: 16,
    flex: 1,
  },
  channelNameUnread: {
    color: "#fff",
    fontWeight: "600",
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
  mentionBadge: {
    backgroundColor: "#ed4245",
    borderRadius: 10,
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 4,
  },
  mentionBadgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
  empty: {
    color: "#72767d",
    textAlign: "center",
    marginTop: 40,
    fontSize: 15,
  },
  errorText: {
    color: "#ff4444",
    padding: 16,
    textAlign: "center",
  },
});
