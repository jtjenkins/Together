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
  Linking,
  Modal,
  Animated,
} from "react-native";
import { Feather } from "@expo/vector-icons";
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
import { EMOJI_CATEGORIES, parseEmoji } from "../utils/emoji";
import { extractUrls, isImageUrl } from "../utils/links";
import { LinkPreview } from "../components/LinkPreview";

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

interface RenderedContent {
  /** Text-compatible nodes (strings, mention spans, link spans) — for inside <Text>. */
  textNodes: React.ReactNode[];
  /** Inline image blocks extracted from the message — rendered outside <Text>. */
  imageNodes: React.ReactNode[];
  /** The first non-image URL in the message, for the preview card. */
  firstLinkUrl: string | null;
}

/** Renders message content: emoji codes, mention highlighting, inline images, and link highlighting.
 *  Returns text nodes (for <Text>), image nodes (for <View>), and the first link URL for a preview card. */
function renderContent(
  content: string,
  memberUsernames: Set<string>,
  currentUsername: string | null,
): RenderedContent {
  const processed = parseEmoji(content);

  const allUrls = extractUrls(processed);
  const firstLinkUrl = allUrls.find((u) => !isImageUrl(u)) ?? null;

  const urlPattern = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;
  const parts = processed.split(urlPattern);
  const urlMatches = [...processed.matchAll(urlPattern)].map((m) => m[0]);

  const textNodes: React.ReactNode[] = [];
  const imageNodes: React.ReactNode[] = [];

  parts.forEach((textPart, i) => {
    if (textPart) {
      textPart.split(/(@\w+)/g).forEach((chunk, j) => {
        const stripped = chunk.startsWith("@") ? chunk.slice(1) : null;
        if (stripped !== null) {
          if (stripped === "everyone" || memberUsernames.has(stripped)) {
            const isSelf =
              stripped !== "everyone" && stripped === currentUsername;
            textNodes.push(
              <Text
                key={`t${i}-${j}`}
                style={isSelf ? mentionSelfStyle : mentionStyle}
              >
                {chunk}
              </Text>,
            );
            return;
          }
        }
        textNodes.push(<Text key={`t${i}-${j}`}>{chunk}</Text>);
      });
    }

    const url = urlMatches[i];
    if (url) {
      if (isImageUrl(url)) {
        // Image goes into imageNodes (outside <Text>)
        imageNodes.push(
          <Image
            key={`u${i}`}
            source={{ uri: url }}
            style={inlineImageStyle}
            resizeMode="contain"
          />,
        );
      } else {
        // Non-image link stays in textNodes (inside <Text>)
        textNodes.push(
          <Text
            key={`u${i}`}
            style={linkStyle}
            onPress={() => {
              Linking.openURL(url).catch((err: unknown) => {
                console.warn("[ChatScreen] Linking.openURL failed", {
                  url,
                  err,
                });
                Alert.alert(
                  "Could not open link",
                  "This link cannot be opened on your device.",
                );
              });
            }}
          >
            {url}
          </Text>,
        );
      }
    }
  });

  return { textNodes, imageNodes, firstLinkUrl };
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

const linkStyle = {
  color: "#00aff4" as const,
};

const inlineImageStyle = {
  width: 200,
  height: 150,
  borderRadius: 4,
  marginTop: 4,
} as const;

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

// ─── EmojiPickerSheet ───────────────────────────────────────

interface EmojiPickerSheetProps {
  messageId: string | null;
  onSelect: (messageId: string, emoji: string) => void;
  onClose: () => void;
}

function EmojiPickerSheet({
  messageId,
  onSelect,
  onClose,
}: EmojiPickerSheetProps) {
  const [query, setQuery] = React.useState("");
  const [activeCat, setActiveCat] = React.useState(0);

  const searchResults = React.useMemo(() => {
    if (!query.trim()) return null;
    const q = query.toLowerCase();
    const results: { emoji: string; name: string }[] = [];
    for (const cat of EMOJI_CATEGORIES) {
      for (const entry of cat.emojis) {
        if (
          entry.name.includes(q) ||
          entry.aliases?.some((a) => a.includes(q))
        ) {
          results.push(entry);
          if (results.length >= 80) return results;
        }
      }
    }
    return results;
  }, [query]);

  const displayEmojis = searchResults ?? EMOJI_CATEGORIES[activeCat].emojis;

  const handleSelect = (emoji: string) => {
    if (messageId) onSelect(messageId, emoji);
    onClose();
  };

  return (
    <View style={pickerStyles.card}>
      {/* Header */}
      <View style={pickerStyles.header}>
        <Text style={pickerStyles.title}>Add Reaction</Text>
        <TouchableOpacity onPress={onClose} style={pickerStyles.closeBtn}>
          <Feather name="x" size={18} color="#b9bbbe" />
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={pickerStyles.searchRow}>
        <View style={pickerStyles.searchBox}>
          <Feather
            name="search"
            size={14}
            color="#72767d"
            style={{ marginRight: 6 }}
          />
          <TextInput
            style={pickerStyles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search emoji…"
            placeholderTextColor="#72767d"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      </View>

      {/* Category tabs */}
      {!searchResults && (
        <View style={pickerStyles.tabs}>
          {EMOJI_CATEGORIES.map((cat, i) => (
            <TouchableOpacity
              key={cat.label}
              style={[
                pickerStyles.tab,
                i === activeCat && pickerStyles.tabActive,
              ]}
              onPress={() => setActiveCat(i)}
            >
              <Text style={pickerStyles.tabText}>{cat.icon}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Emoji grid */}
      <FlatList
        data={displayEmojis}
        keyExtractor={(item) => item.emoji + item.name}
        numColumns={8}
        style={pickerStyles.grid}
        contentContainerStyle={pickerStyles.gridContent}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={pickerStyles.emojiBtn}
            onPress={() => handleSelect(item.emoji)}
          >
            <Text style={pickerStyles.emojiText}>{item.emoji}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <Text style={pickerStyles.noResults}>No results</Text>
        }
      />
    </View>
  );
}

const pickerStyles = StyleSheet.create({
  card: {
    backgroundColor: "#16213e",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: 420,
    width: "100%" as const,
    paddingBottom: 20,
  },
  header: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },
  title: {
    color: "#b9bbbe",
    fontSize: 13,
    fontWeight: "600" as const,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
  },
  closeBtn: {
    padding: 4,
  },
  searchRow: {
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  searchBox: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    backgroundColor: "#1e2a4a",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  searchInput: {
    flex: 1,
    color: "#fff",
    fontSize: 14,
    padding: 0,
  },
  tabs: {
    flexDirection: "row" as const,
    paddingHorizontal: 8,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#0f3460",
  },
  tab: {
    flex: 1,
    alignItems: "center" as const,
    paddingVertical: 6,
    borderRadius: 6,
    opacity: 0.5,
  },
  tabActive: {
    backgroundColor: "rgba(114,137,218,0.2)",
    opacity: 1,
  },
  tabText: {
    fontSize: 18,
  },
  grid: {
    flex: 1,
  },
  gridContent: {
    paddingHorizontal: 8,
    paddingTop: 6,
  },
  emojiBtn: {
    flex: 1,
    aspectRatio: 1,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    borderRadius: 6,
    padding: 4,
  },
  emojiText: {
    fontSize: 22,
  },
  noResults: {
    color: "#72767d",
    textAlign: "center" as const,
    marginTop: 20,
    fontSize: 14,
  },
});

// ────────────────────────────────────────────────────────────

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
  const [showMembers, setShowMembers] = useState(false);

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
  const slideAnim = useRef(new Animated.Value(600)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const fetchMembers = useServerStore((s) => s.fetchMembers);

  const openMembers = useCallback(() => {
    setShowMembers(true);
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 65,
        friction: 11,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  const closeMembers = useCallback(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 600,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => setShowMembers(false));
  }, [fadeAnim, slideAnim]);

  // Set members button in header
  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity onPress={openMembers} style={{ padding: 4 }}>
          <View
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              backgroundColor: "rgba(114,137,218,0.2)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Feather name="users" size={18} color="#fff" />
          </View>
        </TouchableOpacity>
      ),
    });
  }, [navigation, openMembers]);

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
              <Feather
                name="file-text"
                size={14}
                color="#dcddde"
                style={{ marginRight: 6 }}
              />
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
              Replying to a message
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
                {item.content !== "\u200b" &&
                  (() => {
                    const { textNodes, imageNodes, firstLinkUrl } =
                      renderContent(
                        item.content,
                        memberUsernameSet,
                        user?.username ?? null,
                      );
                    return (
                      <>
                        <Text
                          style={isOwn ? styles.contentOwn : styles.content}
                        >
                          {textNodes}
                        </Text>
                        {imageNodes.length > 0 && (
                          <View style={styles.inlineImagesRow}>
                            {imageNodes}
                          </View>
                        )}
                        {firstLinkUrl && <LinkPreview url={firstLinkUrl} />}
                      </>
                    );
                  })()}
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
            <Feather name="message-square" size={12} color="#7289da" />
            <Text style={styles.threadFooterText}>
              {item.thread_reply_count}{" "}
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
            Replying to {getAuthorName(replyingTo.author_id)}
          </Text>
          <TouchableOpacity
            onPress={() => setReplyingTo(null)}
            style={{ paddingLeft: 8 }}
          >
            <Feather name="x" size={16} color="#72767d" />
          </TouchableOpacity>
        </View>
      )}

      {/* Pending files preview */}
      {pendingFiles.length > 0 && (
        <View style={styles.filesPreview}>
          {pendingFiles.map((f, i) => (
            <View key={i} style={styles.fileChip}>
              {f.type.startsWith("image/") ? (
                <Feather
                  name="image"
                  size={14}
                  color="#dcddde"
                  style={{ marginRight: 4 }}
                />
              ) : (
                <Feather
                  name="file-text"
                  size={14}
                  color="#dcddde"
                  style={{ marginRight: 4 }}
                />
              )}
              <Text style={styles.fileChipName} numberOfLines={1}>
                {f.name}
              </Text>
              <TouchableOpacity
                onPress={() =>
                  setPendingFiles((prev) => prev.filter((_, j) => j !== i))
                }
                style={{ marginLeft: 4 }}
              >
                <Feather name="x" size={14} color="#72767d" />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {/* Input bar */}
      <View style={styles.inputBar}>
        <TouchableOpacity onPress={handlePickFile} style={styles.attachBtn}>
          <Feather name="paperclip" size={20} color="#b9bbbe" />
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
            <Feather name="send" size={16} color="#fff" />
          )}
        </TouchableOpacity>
      </View>

      {/* Emoji picker modal */}
      <Modal
        visible={reactionPickerMessageId !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setReactionPickerMessageId(null)}
      >
        <TouchableOpacity
          style={styles.pickerOverlay}
          activeOpacity={1}
          onPress={() => setReactionPickerMessageId(null)}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <EmojiPickerSheet
              messageId={reactionPickerMessageId}
              onSelect={handleReactionPickerSelect}
              onClose={() => setReactionPickerMessageId(null)}
            />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Members panel */}
      <Modal
        visible={showMembers}
        animationType="none"
        transparent
        onRequestClose={closeMembers}
      >
        {/* Tapping the backdrop dismisses the panel */}
        <TouchableOpacity
          style={styles.membersContainer}
          activeOpacity={1}
          onPress={closeMembers}
        >
          {/* Backdrop fades in separately — does not slide */}
          <Animated.View
            style={[styles.membersBackdrop, { opacity: fadeAnim }]}
            pointerEvents="none"
          />
          {/* Panel slides up from the bottom */}
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <Animated.View
              style={[
                styles.membersPanel,
                { transform: [{ translateY: slideAnim }] },
              ]}
            >
              <View style={styles.membersPanelHeader}>
                <Text style={styles.membersPanelTitle}>
                  Members — {members.length}
                </Text>
                <TouchableOpacity onPress={closeMembers}>
                  <Feather name="x" size={20} color="#b9bbbe" />
                </TouchableOpacity>
              </View>
              <FlatList
                data={members}
                keyExtractor={(m) => m.user_id}
                renderItem={({ item }) => (
                  <View style={styles.memberRow}>
                    <View
                      style={[
                        styles.memberAvatar,
                        item.status === "online" && styles.memberAvatarOnline,
                      ]}
                    >
                      <Text style={styles.memberAvatarText}>
                        {(item.nickname ?? item.username)
                          .charAt(0)
                          .toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.memberInfo}>
                      <Text style={styles.memberName}>
                        {item.nickname ?? item.username}
                        {item.user_id === user?.id ? " (you)" : ""}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.statusDot,
                        item.status === "online"
                          ? styles.statusOnline
                          : item.status === "away"
                            ? styles.statusAway
                            : styles.statusOffline,
                      ]}
                    />
                  </View>
                )}
              />
            </Animated.View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a1a2e",
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
    backgroundColor: "#16213e",
  },
  dateText: {
    color: "#72767d",
    fontSize: 12,
    fontWeight: "600",
    marginHorizontal: 10,
  },
  messageRow: {
    flexDirection: "row",
    marginBottom: 6,
    alignItems: "flex-end",
  },
  messageRowOwn: {
    flexDirection: "row-reverse",
  },
  messageRowCompact: {
    marginBottom: 3,
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
    flex: 1,
    borderRadius: 12,
    padding: 10,
  },
  bubbleOwn: {
    backgroundColor: "#7289da",
    borderBottomRightRadius: 4,
    marginLeft: 44,
  },
  bubbleOther: {
    backgroundColor: "#16213e",
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
  inlineImagesRow: {
    marginTop: 4,
    gap: 4,
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
    backgroundColor: "#16213e",
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: "#0f3460",
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
    backgroundColor: "#1e2a4a",
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
    backgroundColor: "#16213e",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: "#0f3460",
  },
  replyBarText: {
    color: "#b9bbbe",
    fontSize: 13,
    flex: 1,
    marginRight: 8,
  },
  filesPreview: {
    flexDirection: "row",
    flexWrap: "wrap",
    backgroundColor: "#16213e",
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: "#0f3460",
  },
  fileChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1e2a4a",
    borderRadius: 6,
    padding: 6,
    maxWidth: 200,
  },
  fileChipName: {
    color: "#dcddde",
    fontSize: 12,
    flex: 1,
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    backgroundColor: "#16213e",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#0f3460",
  },
  attachBtn: {
    paddingHorizontal: 6,
    paddingBottom: 8,
    marginRight: 6,
  },
  textInput: {
    flex: 1,
    backgroundColor: "#1e2a4a",
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
    backgroundColor: "#16213e",
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  threadFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
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
  membersContainer: {
    flex: 1,
    justifyContent: "flex-end",
  },
  membersBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  membersPanel: {
    backgroundColor: "#16213e",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: "70%",
    paddingBottom: 32,
  },
  membersPanelHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#0f3460",
  },
  membersPanelTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  memberAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#4f545c",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  memberAvatarOnline: {
    backgroundColor: "#7289da",
  },
  memberAvatarText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    color: "#dcddde",
    fontSize: 15,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusOnline: {
    backgroundColor: "#43b581",
  },
  statusAway: {
    backgroundColor: "#faa61a",
  },
  statusOffline: {
    backgroundColor: "#747f8d",
  },
});
