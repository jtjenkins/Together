import React, {
  useEffect,
  useCallback,
  useRef,
  useState,
  useMemo,
} from "react";
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ActionSheetIOS,
  Platform,
  Image,
  Modal,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { ServersStackParamList } from "../navigation";
import { useMessageStore } from "../stores/messageStore";
import { useAuthStore } from "../stores/authStore";
import { useServerStore } from "../stores/serverStore";
import { useReadStateStore } from "../stores/readStateStore";
import { api } from "../api/client";
import * as DocumentPicker from "expo-document-picker";
import type { Message, Attachment, ReactionCount } from "../types";
import type { MobileFile } from "../api/client";

type Props = NativeStackScreenProps<ServersStackParamList, "Chat">;

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🎉"];

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

/** Split content on @word boundaries and return an array of Text-compatible spans. */
function renderMentionSpans(
  content: string,
  memberUsernames: Set<string>,
  currentUsername: string | null,
): React.ReactNode[] {
  return content.split(/(@\w+)/g).map((part, i) => {
    const stripped = part.startsWith("@") ? part.slice(1) : null;
    if (stripped !== null) {
      if (stripped === "everyone" || memberUsernames.has(stripped)) {
        const isSelf = stripped !== "everyone" && stripped === currentUsername;
        return (
          <Text key={i} style={isSelf ? mentionSelfStyle : mentionStyle}>
            {part}
          </Text>
        );
      }
    }
    return <Text key={i}>{part}</Text>;
  });
}

const mentionStyle = {
  backgroundColor: "rgba(88,101,242,0.15)",
  color: "#7289da",
  fontWeight: "500" as const,
  borderRadius: 3,
};

const mentionSelfStyle = {
  backgroundColor: "rgba(250,166,26,0.3)",
  color: "#faa61a",
  fontWeight: "500" as const,
  borderRadius: 3,
};

function shouldShowHeader(msg: Message, prev: Message | null): boolean {
  if (!prev) return true;
  if (prev.author_id !== msg.author_id) return true;
  if (
    new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime() >
    5 * 60 * 1000
  )
    return true;
  if (msg.reply_to !== null) return true;
  return false;
}

export function ChatScreen({ route, navigation }: Props) {
  const { channelId, serverId } = route.params;
  const user = useAuthStore((s) => s.user);
  const members = useServerStore((s) => s.members);
  const memberUsernameSet = useMemo(
    () => new Set(members.map((m) => m.username)),
    [members],
  );
  const markRead = useReadStateStore((s) => s.markRead);
  const {
    messages,
    hasMore,
    isLoading,
    replyingTo,
    attachmentCache,
    fetchMessages,
    sendMessage,
    editMessage,
    deleteMessage,
    setReplyingTo,
    clearMessages,
  } = useMessageStore();

  const [content, setContent] = useState("");
  const [pendingFiles, setPendingFiles] = useState<MobileFile[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [isSending, setIsSending] = useState(false);

  // Reactions state: messageId -> ReactionCount[]
  const [reactions, setReactions] = useState<Record<string, ReactionCount[]>>(
    {},
  );
  // Emoji picker state
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState<
    string | null
  >(null);

  const flatListRef = useRef<FlatList>(null);
  const hasFetchedRef = useRef(false);

  const fetchMembers = useServerStore((s) => s.fetchMembers);

  useEffect(() => {
    fetchMembers(serverId);
    clearMessages();
    fetchMessages(channelId);
    markRead(channelId);
    hasFetchedRef.current = true;

    // Acknowledge channel read on the server
    api.ackChannel(channelId).catch((err) => {
      console.warn("[ChatScreen] ack failed", err);
    });

    return () => {
      clearMessages();
      hasFetchedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  const getAuthorName = (authorId: string | null): string => {
    if (!authorId) return "Deleted User";
    const member = members.find((m) => m.user_id === authorId);
    return member?.nickname ?? member?.username ?? "Unknown User";
  };

  const handleLoadMore = useCallback(() => {
    if (!isLoading && hasMore && messages.length > 0) {
      fetchMessages(channelId, messages[0].id);
    }
  }, [isLoading, hasMore, messages, channelId, fetchMessages]);

  const handleSend = async () => {
    const trimmed = content.trim();
    if (!trimmed && pendingFiles.length === 0) return;
    setIsSending(true);
    try {
      await sendMessage(
        channelId,
        { content: trimmed || "\u200b", reply_to: replyingTo?.id },
        pendingFiles.length > 0 ? pendingFiles : undefined,
      );
      setContent("");
      setPendingFiles([]);
    } catch {
      // Error handled by store
    } finally {
      setIsSending(false);
    }
  };

  const handlePickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const files: MobileFile[] = result.assets.map((a) => ({
        uri: a.uri,
        name: a.name,
        type: a.mimeType ?? "application/octet-stream",
      }));
      setPendingFiles((prev) => {
        const existing = new Set(prev.map((f) => f.name));
        return [...prev, ...files.filter((f) => !existing.has(f.name))];
      });
    } catch (err) {
      console.error("[ChatScreen] DocumentPicker failed", err);
      Alert.alert("Error", "Could not open file picker. Please try again.");
    }
  };

  // ─── Reactions ─────────────────────────────────────────────

  const fetchReactionsForMessage = useCallback(
    async (messageId: string) => {
      try {
        const counts = await api.listReactions(channelId, messageId);
        setReactions((prev) => ({ ...prev, [messageId]: counts }));
      } catch (err) {
        console.warn("[ChatScreen] Failed to fetch reactions", err);
      }
    },
    [channelId],
  );

  const handleToggleReaction = async (messageId: string, emoji: string) => {
    const existing = reactions[messageId] ?? [];
    const current = existing.find((r) => r.emoji === emoji);
    const isActive = current?.me === true;

    // Optimistic update
    setReactions((prev) => {
      const list = prev[messageId] ?? [];
      if (isActive) {
        return {
          ...prev,
          [messageId]: list
            .map((r) =>
              r.emoji === emoji ? { ...r, count: r.count - 1, me: false } : r,
            )
            .filter((r) => r.count > 0),
        };
      } else {
        const idx = list.findIndex((r) => r.emoji === emoji);
        if (idx >= 0) {
          const updated = [...list];
          updated[idx] = {
            ...updated[idx],
            count: updated[idx].count + 1,
            me: true,
          };
          return { ...prev, [messageId]: updated };
        }
        return {
          ...prev,
          [messageId]: [...list, { emoji, count: 1, me: true }],
        };
      }
    });

    try {
      if (isActive) {
        await api.removeReaction(channelId, messageId, emoji);
      } else {
        await api.addReaction(channelId, messageId, emoji);
      }
    } catch (err) {
      console.warn("[ChatScreen] Reaction toggle failed", err);
      // Revert by re-fetching the authoritative state
      fetchReactionsForMessage(messageId);
    }
  };

  const handleReactionPickerSelect = async (
    messageId: string,
    emoji: string,
  ) => {
    setReactionPickerMessageId(null);
    await handleToggleReaction(messageId, emoji);
  };

  // ─── Long Press ────────────────────────────────────────────

  const handleLongPress = (msg: Message) => {
    if (msg.deleted) return;
    const isOwn = msg.author_id === user?.id;
    const isRoot = !msg.thread_id;

    type ActionItem = {
      label: string;
      action: () => void;
      destructive?: boolean;
    };
    const actionItems: ActionItem[] = [
      { label: "Reply", action: () => setReplyingTo(msg) },
      { label: "React", action: () => setReactionPickerMessageId(msg.id) },
      ...(isRoot
        ? [
            {
              label: "Open Thread",
              action: () =>
                navigation.navigate("Thread", {
                  channelId,
                  messageId: msg.id,
                  rootContent: msg.content,
                  serverId,
                }),
            },
          ]
        : []),
      ...(isOwn
        ? [
            {
              label: "Edit",
              action: () => {
                setEditingId(msg.id);
                setEditContent(msg.content);
              },
            },
            {
              label: "Delete",
              action: () => confirmDelete(msg.id),
              destructive: true,
            },
          ]
        : []),
    ];

    if (Platform.OS === "ios") {
      const destructiveIdx = actionItems.findIndex((a) => a.destructive);
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...actionItems.map((a) => a.label), "Cancel"],
          // Pass undefined (not -1) when there is no destructive action;
          // iOS treats -1 as an invalid index and may behave unexpectedly.
          destructiveButtonIndex:
            destructiveIdx >= 0 ? destructiveIdx : undefined,
          cancelButtonIndex: actionItems.length,
        },
        (idx) => {
          if (idx < actionItems.length) {
            actionItems[idx].action();
          }
        },
      );
    } else {
      Alert.alert("Message", undefined, [
        ...actionItems.map((a) => ({
          text: a.label,
          style: a.destructive
            ? ("destructive" as const)
            : ("default" as const),
          onPress: a.action,
        })),
        { text: "Cancel", style: "cancel" as const },
      ]);
    }
  };

  const confirmDelete = (messageId: string) => {
    Alert.alert(
      "Delete Message",
      "Are you sure you want to delete this message?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteMessage(messageId);
            } catch {
              Alert.alert("Error", "Failed to delete message.");
            }
          },
        },
      ],
    );
  };

  const handleEditSave = async () => {
    if (!editingId) return;
    const trimmed = editContent.trim();
    if (!trimmed) return;
    try {
      await editMessage(editingId, trimmed);
      setEditingId(null);
    } catch {
      Alert.alert("Error", "Failed to edit message.");
    }
  };

  const renderAttachments = (messageId: string): React.ReactNode => {
    const attachments: Attachment[] = attachmentCache[messageId] ?? [];
    if (attachments.length === 0) return null;
    return (
      <View style={styles.attachmentsRow}>
        {attachments.map((a) => {
          const isImage = a.mime_type?.startsWith("image/");
          if (isImage) {
            return (
              <Image
                key={a.id}
                source={{ uri: a.url }}
                style={styles.attachmentImage}
                resizeMode="cover"
              />
            );
          }
          return (
            <View key={a.id} style={styles.attachmentChip}>
              <Text style={styles.attachmentIcon}>📄</Text>
              <Text style={styles.attachmentName} numberOfLines={1}>
                {a.filename}
              </Text>
            </View>
          );
        })}
      </View>
    );
  };

  const renderReactions = (messageId: string): React.ReactNode => {
    const msgReactions = reactions[messageId];
    if (!msgReactions || msgReactions.length === 0) return null;
    return (
      <View style={styles.reactionsRow}>
        {msgReactions.map((r) => (
          <TouchableOpacity
            key={r.emoji}
            style={[styles.reactionPill, r.me && styles.reactionPillActive]}
            onPress={() => handleToggleReaction(messageId, r.emoji)}
          >
            <Text style={styles.reactionEmoji}>{r.emoji}</Text>
            <Text
              style={[styles.reactionCount, r.me && styles.reactionCountActive]}
            >
              {r.count}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  // Fetch reactions for all visible messages when messages load
  useEffect(() => {
    if (messages.length === 0) return;
    messages.forEach((m) => {
      if (!reactions[m.id]) {
        fetchReactionsForMessage(m.id);
      }
    });
    // Intentionally not including `reactions` to avoid re-fetch loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, fetchReactionsForMessage]);

  const reversedMessages = [...messages].reverse();

  const renderItem = ({ item, index }: { item: Message; index: number }) => {
    const prevInDisplay =
      index < reversedMessages.length - 1 ? reversedMessages[index + 1] : null;
    const showHeader = shouldShowHeader(item, prevInDisplay);
    const isOwn = item.author_id === user?.id;

    const showDateSeparator =
      prevInDisplay === null ||
      formatDate(item.created_at) !== formatDate(prevInDisplay.created_at);

    return (
      <View>
        {showDateSeparator && (
          <View style={styles.dateSeparator}>
            <View style={styles.dateLine} />
            <Text style={styles.dateText}>{formatDate(item.created_at)}</Text>
            <View style={styles.dateLine} />
          </View>
        )}
        {item.reply_to && (
          <View style={styles.replyPreview}>
            <Text style={styles.replyPreviewText} numberOfLines={1}>
              ↩ Replying to a message
            </Text>
          </View>
        )}
        <TouchableOpacity
          style={[
            styles.messageRow,
            isOwn && styles.messageRowOwn,
            !showHeader && styles.messageRowCompact,
          ]}
          onLongPress={() => handleLongPress(item)}
          activeOpacity={0.7}
        >
          {showHeader && !isOwn && (
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {getAuthorName(item.author_id).charAt(0).toUpperCase()}
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
                {getAuthorName(item.author_id)}
              </Text>
            )}
            {item.deleted ? (
              <Text style={styles.deletedText}>[This message was deleted]</Text>
            ) : editingId === item.id ? (
              <View>
                <TextInput
                  style={styles.editInput}
                  value={editContent}
                  onChangeText={setEditContent}
                  multiline
                  autoFocus
                />
                <View style={styles.editActions}>
                  <TouchableOpacity
                    onPress={() => setEditingId(null)}
                    style={styles.editCancelBtn}
                  >
                    <Text style={styles.editCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleEditSave}
                    style={styles.editSaveBtn}
                  >
                    <Text style={styles.editSaveText}>Save</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <>
                {item.content !== "\u200b" && (
                  <Text style={isOwn ? styles.contentOwn : styles.content}>
                    {renderMentionSpans(
                      item.content,
                      memberUsernameSet,
                      user?.username ?? null,
                    )}
                  </Text>
                )}
                {renderAttachments(item.id)}
              </>
            )}
            <Text style={styles.timestamp}>{formatTime(item.created_at)}</Text>
          </View>
        </TouchableOpacity>
        {renderReactions(item.id)}
        {!item.deleted && !item.thread_id && item.thread_reply_count > 0 && (
          <TouchableOpacity
            style={styles.threadFooter}
            onPress={() =>
              navigation.navigate("Thread", {
                channelId,
                messageId: item.id,
                rootContent: item.content,
                serverId,
              })
            }
          >
            <Text style={styles.threadFooterText}>
              {"💬"} {item.thread_reply_count}{" "}
              {item.thread_reply_count === 1 ? "reply" : "replies"}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Message list — inverted so newest is at the bottom */}
      <FlatList
        ref={flatListRef}
        data={reversedMessages}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        inverted
        contentContainerStyle={styles.list}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.3}
        ListFooterComponent={
          isLoading ? (
            <ActivityIndicator
              size="small"
              color="#7289da"
              style={styles.loader}
            />
          ) : null
        }
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No messages yet.</Text>
              <Text style={styles.emptySubtext}>
                Be the first to say something!
              </Text>
            </View>
          ) : null
        }
      />

      {/* Reply bar */}
      {replyingTo && (
        <View style={styles.replyBar}>
          <Text style={styles.replyBarText} numberOfLines={1}>
            ↩ Replying to {getAuthorName(replyingTo.author_id)}
          </Text>
          <TouchableOpacity onPress={() => setReplyingTo(null)}>
            <Text style={styles.replyBarClose}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Pending files preview */}
      {pendingFiles.length > 0 && (
        <View style={styles.filesPreview}>
          {pendingFiles.map((f, i) => (
            <View key={i} style={styles.fileChip}>
              <Text style={styles.fileChipIcon}>
                {f.type.startsWith("image/") ? "🖼️" : "📄"}
              </Text>
              <Text style={styles.fileChipName} numberOfLines={1}>
                {f.name}
              </Text>
              <TouchableOpacity
                onPress={() =>
                  setPendingFiles((prev) => prev.filter((_, j) => j !== i))
                }
              >
                <Text style={styles.fileChipRemove}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {/* Input bar */}
      <View style={styles.inputBar}>
        <TouchableOpacity onPress={handlePickFile} style={styles.attachBtn}>
          <Text style={styles.attachBtnText}>📎</Text>
        </TouchableOpacity>
        <TextInput
          style={styles.textInput}
          value={content}
          onChangeText={setContent}
          placeholder="Message…"
          placeholderTextColor="#72767d"
          multiline
          maxLength={4000}
          returnKeyType="default"
        />
        <TouchableOpacity
          onPress={handleSend}
          disabled={isSending || (!content.trim() && pendingFiles.length === 0)}
          style={[
            styles.sendBtn,
            (isSending || (!content.trim() && pendingFiles.length === 0)) &&
              styles.sendBtnDisabled,
          ]}
        >
          {isSending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.sendBtnText}>➤</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Emoji picker modal */}
      <Modal
        visible={reactionPickerMessageId !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setReactionPickerMessageId(null)}
      >
        <TouchableOpacity
          style={styles.pickerOverlay}
          activeOpacity={1}
          onPress={() => setReactionPickerMessageId(null)}
        >
          <View style={styles.pickerCard}>
            <Text style={styles.pickerTitle}>Add Reaction</Text>
            <View style={styles.pickerRow}>
              {QUICK_REACTIONS.map((emoji) => (
                <TouchableOpacity
                  key={emoji}
                  style={styles.pickerEmoji}
                  onPress={() => {
                    if (reactionPickerMessageId) {
                      handleReactionPickerSelect(
                        reactionPickerMessageId,
                        emoji,
                      );
                    }
                  }}
                >
                  <Text style={styles.pickerEmojiText}>{emoji}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
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
  loader: {
    paddingVertical: 16,
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
  replyPreview: {
    paddingLeft: 52,
    marginBottom: 2,
  },
  replyPreviewText: {
    color: "#72767d",
    fontSize: 12,
    fontStyle: "italic",
  },
  attachmentsRow: {
    marginTop: 6,
  },
  attachmentImage: {
    width: 200,
    height: 150,
    borderRadius: 8,
    marginBottom: 4,
  },
  attachmentChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.2)",
    borderRadius: 6,
    padding: 6,
    marginBottom: 4,
  },
  attachmentIcon: {
    marginRight: 6,
  },
  attachmentName: {
    color: "#dcddde",
    fontSize: 13,
    flex: 1,
  },
  reactionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingLeft: 52,
    paddingRight: 12,
    marginTop: 2,
    marginBottom: 4,
    gap: 4,
  },
  reactionPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#2a2a3e",
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: "#40444b",
  },
  reactionPillActive: {
    backgroundColor: "rgba(114,137,218,0.2)",
    borderColor: "#7289da",
  },
  reactionEmoji: {
    fontSize: 14,
  },
  reactionCount: {
    color: "#b9bbbe",
    fontSize: 12,
    fontWeight: "600",
    marginLeft: 4,
  },
  reactionCountActive: {
    color: "#7289da",
  },
  editInput: {
    backgroundColor: "#40444b",
    borderRadius: 6,
    color: "#fff",
    fontSize: 15,
    padding: 8,
    minHeight: 40,
  },
  editActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 6,
    gap: 8,
  },
  editCancelBtn: {
    padding: 6,
  },
  editCancelText: {
    color: "#b9bbbe",
    fontSize: 13,
  },
  editSaveBtn: {
    backgroundColor: "#7289da",
    borderRadius: 4,
    padding: 6,
    paddingHorizontal: 10,
  },
  editSaveText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
  replyBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#2a2a3e",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: "#40444b",
  },
  replyBarText: {
    color: "#b9bbbe",
    fontSize: 13,
    flex: 1,
    marginRight: 8,
  },
  replyBarClose: {
    color: "#72767d",
    fontSize: 16,
  },
  filesPreview: {
    flexDirection: "row",
    flexWrap: "wrap",
    backgroundColor: "#2a2a3e",
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: "#40444b",
  },
  fileChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#40444b",
    borderRadius: 6,
    padding: 6,
    maxWidth: 200,
  },
  fileChipIcon: {
    marginRight: 4,
  },
  fileChipName: {
    color: "#dcddde",
    fontSize: 12,
    flex: 1,
  },
  fileChipRemove: {
    color: "#72767d",
    fontSize: 14,
    marginLeft: 4,
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
  attachBtn: {
    paddingHorizontal: 6,
    paddingBottom: 8,
    marginRight: 6,
  },
  attachBtnText: {
    fontSize: 20,
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
  pickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  pickerCard: {
    backgroundColor: "#2a2a3e",
    borderRadius: 12,
    padding: 20,
    minWidth: 280,
  },
  pickerTitle: {
    color: "#b9bbbe",
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 12,
    textAlign: "center",
  },
  pickerRow: {
    flexDirection: "row",
    justifyContent: "space-around",
  },
  pickerEmoji: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: "#36393f",
  },
  pickerEmojiText: {
    fontSize: 26,
  },
  threadFooter: {
    marginLeft: 52,
    marginTop: 2,
    marginBottom: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: "rgba(114,137,218,0.1)",
    borderRadius: 12,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "rgba(114,137,218,0.3)",
  },
  threadFooterText: {
    color: "#7289da",
    fontSize: 12,
    fontWeight: "600" as const,
  },
});
