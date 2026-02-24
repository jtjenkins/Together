import React, { useEffect, useRef, useState, useCallback } from "react";
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
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { ServersStackParamList } from "../navigation";
import { useMessageStore } from "../stores/messageStore";
import { useAuthStore } from "../stores/authStore";
import { useServerStore } from "../stores/serverStore";
import type { Message } from "../types";

type Props = NativeStackScreenProps<ServersStackParamList, "Thread">;

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ThreadScreen({ route }: Props) {
  const { channelId, messageId, rootContent, serverId } = route.params;

  const user = useAuthStore((s) => s.user);
  const members = useServerStore((s) => s.members);
  const fetchMembers = useServerStore((s) => s.fetchMembers);

  const { threadCache, fetchThreadReplies, sendThreadReply } =
    useMessageStore();

  const replies: Message[] = threadCache[messageId] ?? [];

  const [replyText, setReplyText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    fetchMembers(serverId);
  }, [serverId, fetchMembers]);

  useEffect(() => {
    setIsLoading(true);
    fetchThreadReplies(channelId, messageId).finally(() =>
      setIsLoading(false),
    );
  }, [channelId, messageId, fetchThreadReplies]);

  const getAuthorName = useCallback(
    (authorId: string | null): string => {
      if (!authorId) return "Deleted User";
      const member = members.find((m) => m.user_id === authorId);
      return member?.nickname ?? member?.username ?? "Unknown User";
    },
    [members],
  );

  const handleSend = async () => {
    const trimmed = replyText.trim();
    if (!trimmed) return;
    setIsSending(true);
    try {
      await sendThreadReply(channelId, messageId, trimmed);
      setReplyText("");
      // Scroll to end after sending
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    } catch {
      Alert.alert("Error", "Failed to send reply.");
    } finally {
      setIsSending(false);
    }
  };

  const renderReply = ({ item }: { item: Message }) => {
    const isOwn = item.author_id === user?.id;

    return (
      <View style={styles.messageRow}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {getAuthorName(item.author_id).charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.messageBody}>
          <View style={styles.messageHeader}>
            <Text style={styles.authorName}>
              {getAuthorName(item.author_id)}
            </Text>
            <Text style={styles.timestamp}>{formatTime(item.created_at)}</Text>
          </View>
          {item.deleted ? (
            <Text style={styles.deletedText}>[This message was deleted]</Text>
          ) : (
            <Text style={isOwn ? styles.contentOwn : styles.content}>
              {item.content}
            </Text>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Root message */}
      <View style={styles.rootMessage}>
        <Text style={styles.rootLabel}>Original message</Text>
        <Text style={styles.rootContent} numberOfLines={3}>
          {rootContent}
        </Text>
      </View>

      <View style={styles.divider} />

      {/* Thread replies */}
      {isLoading ? (
        <ActivityIndicator
          size="large"
          color="#7289da"
          style={styles.loader}
        />
      ) : (
        <FlatList
          ref={flatListRef}
          data={replies}
          keyExtractor={(item) => item.id}
          renderItem={renderReply}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No replies yet.</Text>
              <Text style={styles.emptySubtext}>Start the conversation!</Text>
            </View>
          }
          onContentSizeChange={() =>
            flatListRef.current?.scrollToEnd({ animated: false })
          }
        />
      )}

      {/* Reply input */}
      <View style={styles.inputBar}>
        <TextInput
          style={styles.textInput}
          value={replyText}
          onChangeText={setReplyText}
          placeholder="Reply in thread…"
          placeholderTextColor="#72767d"
          multiline
          maxLength={4000}
          returnKeyType="default"
        />
        <TouchableOpacity
          onPress={handleSend}
          disabled={isSending || !replyText.trim()}
          style={[
            styles.sendBtn,
            (isSending || !replyText.trim()) && styles.sendBtnDisabled,
          ]}
        >
          {isSending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.sendBtnText}>{"➤"}</Text>
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
  rootMessage: {
    backgroundColor: "#2a2a3e",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderLeftWidth: 3,
    borderLeftColor: "#7289da",
    margin: 12,
    borderRadius: 6,
  },
  rootLabel: {
    color: "#7289da",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  rootContent: {
    color: "#dcddde",
    fontSize: 14,
    lineHeight: 20,
  },
  divider: {
    height: 1,
    backgroundColor: "#40444b",
    marginHorizontal: 12,
  },
  loader: {
    flex: 1,
    marginTop: 40,
  },
  list: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexGrow: 1,
  },
  emptyContainer: {
    alignItems: "center",
    paddingTop: 40,
  },
  emptyText: {
    color: "#b9bbbe",
    fontSize: 16,
    fontWeight: "600",
  },
  emptySubtext: {
    color: "#72767d",
    fontSize: 14,
    marginTop: 4,
  },
  messageRow: {
    flexDirection: "row",
    marginBottom: 12,
    alignItems: "flex-start",
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#7289da",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
    flexShrink: 0,
  },
  avatarText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  messageBody: {
    flex: 1,
  },
  messageHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    marginBottom: 3,
    gap: 8,
  },
  authorName: {
    color: "#7289da",
    fontSize: 14,
    fontWeight: "700",
  },
  timestamp: {
    color: "#72767d",
    fontSize: 11,
  },
  content: {
    color: "#dcddde",
    fontSize: 15,
    lineHeight: 20,
  },
  contentOwn: {
    color: "#fff",
    fontSize: 15,
    lineHeight: 20,
  },
  deletedText: {
    color: "#72767d",
    fontSize: 14,
    fontStyle: "italic",
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
