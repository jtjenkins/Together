import React, { useEffect, useCallback, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { DmStackParamList } from "../navigation";
import { useDmStore } from "../stores/dmStore";
import { useReadStateStore } from "../stores/readStateStore";
import { useAuthStore } from "../stores/authStore";
import { api } from "../api/client";
import type { DirectMessage } from "../types";

type Props = NativeStackScreenProps<DmStackParamList, "DMChat">;

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString();
}

export function DMChatScreen({ route }: Props) {
  const { channelId, recipientUsername, recipientId } = route.params;
  const user = useAuthStore((s) => s.user);
  const {
    dmMessages,
    activeDmChannelId,
    setActiveDmChannel,
    sendDmMessage,
    fetchDmMessages,
    error,
    clearError,
  } = useDmStore();
  const markRead = useReadStateStore((s) => s.markRead);

  const messages = dmMessages[channelId] ?? [];

  // Show a dismissible alert whenever the store surfaces a DM error.
  useEffect(() => {
    if (error) {
      Alert.alert("Error", error, [{ text: "OK", onPress: clearError }]);
    }
  }, [error, clearError]);

  const [content, setContent] = useState("");
  const [isSending, setIsSending] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    setActiveDmChannel(channelId);
    markRead(channelId);
    fetchDmMessages(channelId);

    // Acknowledge the channel as read on the server
    api.ackDmChannel(channelId).catch((err) => {
      console.warn("[DMChatScreen] ack failed", err);
    });

    return () => {
      // Only clear active if this channel is still active when unmounting
      if (useDmStore.getState().activeDmChannelId === channelId) {
        setActiveDmChannel(null);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  // Mark read whenever we become the active DM channel
  useEffect(() => {
    if (activeDmChannelId === channelId) {
      markRead(channelId);
    }
  }, [activeDmChannelId, channelId, markRead]);

  const handleLoadMore = useCallback(() => {
    if (messages.length > 0) {
      fetchDmMessages(channelId, messages[0].id);
    }
  }, [messages, channelId, fetchDmMessages]);

  const handleSend = async () => {
    const trimmed = content.trim();
    if (!trimmed) return;
    setIsSending(true);
    try {
      await sendDmMessage(channelId, trimmed);
      setContent("");
    } catch {
      // Error handled by store
    } finally {
      setIsSending(false);
    }
  };

  const getAuthorLabel = (authorId: string | null): string => {
    if (!authorId) return "Deleted User";
    if (authorId === user?.id) return "You";
    return recipientUsername;
  };

  const reversedMessages = [...messages].reverse();

  const renderItem = ({
    item,
    index,
  }: {
    item: DirectMessage;
    index: number;
  }) => {
    const isOwn = item.author_id === user?.id;
    const prevInDisplay =
      index < reversedMessages.length - 1 ? reversedMessages[index + 1] : null;

    const showDateSeparator =
      prevInDisplay === null ||
      formatDate(item.created_at) !== formatDate(prevInDisplay.created_at);

    const showHeader =
      !prevInDisplay ||
      prevInDisplay.author_id !== item.author_id ||
      new Date(item.created_at).getTime() -
        new Date(prevInDisplay.created_at).getTime() >
        5 * 60 * 1000;

    return (
      <View>
        {showDateSeparator && (
          <View style={styles.dateSeparator}>
            <View style={styles.dateLine} />
            <Text style={styles.dateText}>{formatDate(item.created_at)}</Text>
            <View style={styles.dateLine} />
          </View>
        )}
        <View
          style={[
            styles.messageRow,
            isOwn && styles.messageRowOwn,
            !showHeader && styles.messageRowCompact,
          ]}
        >
          {showHeader && !isOwn && (
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {recipientId === item.author_id
                  ? recipientUsername.charAt(0).toUpperCase()
                  : (user?.username.charAt(0).toUpperCase() ?? "?")}
              </Text>
            </View>
          )}
          {!showHeader && !isOwn && <View style={styles.avatarSpacer} />}

          <View
            style={[
              styles.bubble,
              isOwn ? styles.bubbleOwn : styles.bubbleOther,
            ]}
          >
            {showHeader && !isOwn && (
              <Text style={styles.authorName}>
                {getAuthorLabel(item.author_id)}
              </Text>
            )}
            {item.deleted ? (
              <Text style={styles.deletedText}>[This message was deleted]</Text>
            ) : (
              <Text style={isOwn ? styles.contentOwn : styles.content}>
                {item.content}
              </Text>
            )}
            <Text style={styles.timestamp}>{formatTime(item.created_at)}</Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <FlatList
        ref={flatListRef}
        data={reversedMessages}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        inverted
        contentContainerStyle={styles.list}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.3}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>
              This is the beginning of your conversation with{" "}
              {recipientUsername}.
            </Text>
          </View>
        }
      />

      <View style={styles.inputBar}>
        <TextInput
          style={styles.textInput}
          value={content}
          onChangeText={setContent}
          placeholder={`Message ${recipientUsername}…`}
          placeholderTextColor="#72767d"
          multiline
          maxLength={4000}
          returnKeyType="default"
        />
        <TouchableOpacity
          onPress={handleSend}
          disabled={isSending || !content.trim()}
          style={[
            styles.sendBtn,
            (isSending || !content.trim()) && styles.sendBtnDisabled,
          ]}
        >
          {isSending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Feather name="send" size={16} color="#fff" />
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#36393f",
  },
  list: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  emptyContainer: {
    alignItems: "center",
    paddingTop: 40,
    paddingHorizontal: 24,
  },
  emptyText: {
    color: "#72767d",
    fontSize: 14,
    textAlign: "center",
  },
  dateSeparator: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 12,
  },
  dateLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#4f545c",
  },
  dateText: {
    color: "#72767d",
    fontSize: 12,
    fontWeight: "600",
    marginHorizontal: 10,
  },
  messageRow: {
    flexDirection: "row",
    marginBottom: 2,
    alignItems: "flex-end",
  },
  messageRowOwn: {
    flexDirection: "row-reverse",
  },
  messageRowCompact: {
    marginBottom: 1,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#7289da",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
    marginBottom: 2,
  },
  avatarText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  avatarSpacer: {
    width: 44,
  },
  bubble: {
    maxWidth: "75%",
    borderRadius: 12,
    padding: 10,
  },
  bubbleOwn: {
    backgroundColor: "#7289da",
    borderBottomRightRadius: 4,
    marginLeft: 44,
  },
  bubbleOther: {
    backgroundColor: "#2a2a3e",
    borderBottomLeftRadius: 4,
  },
  authorName: {
    color: "#7289da",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 3,
  },
  content: {
    color: "#dcddde",
    fontSize: 15,
  },
  contentOwn: {
    color: "#fff",
    fontSize: 15,
  },
  deletedText: {
    color: "#72767d",
    fontSize: 14,
    fontStyle: "italic",
  },
  timestamp: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 10,
    marginTop: 4,
    alignSelf: "flex-end",
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    backgroundColor: "#2a2a3e",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#40444b",
  },
  textInput: {
    flex: 1,
    backgroundColor: "#40444b",
    borderRadius: 8,
    color: "#fff",
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxHeight: 120,
  },
  sendBtn: {
    backgroundColor: "#7289da",
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  sendBtnDisabled: {
    backgroundColor: "#4f545c",
  },
  sendBtnText: {
    color: "#fff",
    fontSize: 16,
  },
});
