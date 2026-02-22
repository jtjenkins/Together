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
  ActionSheetIOS,
  Platform,
  Image,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { ServersStackParamList } from "../navigation";
import { useMessageStore } from "../stores/messageStore";
import { useAuthStore } from "../stores/authStore";
import { useServerStore } from "../stores/serverStore";
import * as DocumentPicker from "expo-document-picker";
import type { Message, Attachment } from "../types";
import type { MobileFile } from "../api/client";

type Props = NativeStackScreenProps<ServersStackParamList, "Chat">;

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

export function ChatScreen({ route }: Props) {
  const { channelId, serverId } = route.params;
  const user = useAuthStore((s) => s.user);
  const members = useServerStore((s) => s.members);
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
  const flatListRef = useRef<FlatList>(null);
  const hasFetchedRef = useRef(false);

  // Fetch members for the server when entering the chat
  const fetchMembers = useServerStore((s) => s.fetchMembers);

  useEffect(() => {
    fetchMembers(serverId);
    clearMessages();
    fetchMessages(channelId);
    hasFetchedRef.current = true;
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

  const handleLongPress = (msg: Message) => {
    if (msg.deleted) return;
    const isOwn = msg.author_id === user?.id;

    const options = isOwn
      ? ["Reply", "Edit", "Delete", "Cancel"]
      : ["Reply", "Cancel"];

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          destructiveButtonIndex: isOwn ? 2 : undefined,
          cancelButtonIndex: options.length - 1,
        },
        (idx) => handleAction(idx, msg, isOwn),
      );
    } else {
      // Android: use Alert as a simple action menu
      const buttons = [
        { text: "Reply", onPress: () => setReplyingTo(msg) },
        ...(isOwn
          ? [
              {
                text: "Edit",
                onPress: () => {
                  setEditingId(msg.id);
                  setEditContent(msg.content);
                },
              },
              {
                text: "Delete",
                style: "destructive" as const,
                onPress: () => confirmDelete(msg.id),
              },
            ]
          : []),
        { text: "Cancel", style: "cancel" as const },
      ];
      Alert.alert("Message", undefined, buttons);
    }
  };

  const handleAction = (idx: number, msg: Message, isOwn: boolean) => {
    if (idx === 0) {
      setReplyingTo(msg);
    } else if (isOwn && idx === 1) {
      setEditingId(msg.id);
      setEditContent(msg.content);
    } else if (isOwn && idx === 2) {
      confirmDelete(msg.id);
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

  // Messages arrive oldest-first from API but FlatList is inverted,
  // so we reverse to show newest at bottom.
  const reversedMessages = [...messages].reverse();

  const renderItem = ({ item, index }: { item: Message; index: number }) => {
    // reversed list: prev in display order is the next item in the array
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
                    {item.content}
                  </Text>
                )}
                {renderAttachments(item.id)}
              </>
            )}
            <Text style={styles.timestamp}>{formatTime(item.created_at)}</Text>
          </View>
        </TouchableOpacity>
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
});
