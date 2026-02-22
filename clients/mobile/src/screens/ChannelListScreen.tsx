import React, { useEffect } from "react";
import {
  View,
  Text,
  SectionList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { ServersStackParamList } from "../navigation";
import { useChannelStore } from "../stores/channelStore";
import { useServerStore } from "../stores/serverStore";
import type { Channel } from "../types";

type Props = NativeStackScreenProps<ServersStackParamList, "ChannelList">;

export function ChannelListScreen({ route, navigation }: Props) {
  const { serverId } = route.params;
  const { channels, isLoading, fetchChannels, setActiveChannel } =
    useChannelStore();
  const setActiveServer = useServerStore((s) => s.setActiveServer);

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
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.channelItem}
            onPress={() => handleChannelPress(item)}
          >
            <Text style={styles.channelPrefix}>
              {item.type === "text" ? "#" : "🔊"}
            </Text>
            <Text style={styles.channelName}>{item.name}</Text>
          </TouchableOpacity>
        )}
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
  channelPrefix: {
    color: "#72767d",
    fontSize: 16,
    marginRight: 8,
    width: 20,
    textAlign: "center",
  },
  channelName: {
    color: "#dcddde",
    fontSize: 16,
  },
  empty: {
    color: "#72767d",
    textAlign: "center",
    marginTop: 40,
    fontSize: 15,
  },
});
