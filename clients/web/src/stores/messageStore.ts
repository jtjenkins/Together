import { create } from "zustand";
import type {
  Message,
  CreateMessageRequest,
  MessageDeleteEvent,
  Attachment,
} from "../types";
import { api, ApiRequestError } from "../api/client";

interface MessageState {
  messages: Message[];
  isLoading: boolean;
  hasMore: boolean;
  error: string | null;
  replyingTo: Message | null;
  /** Attachments keyed by message ID — populated after upload. */
  attachmentCache: Record<string, Attachment[]>;

  // ── Thread state ──────────────────────────────────────────
  /** Thread replies keyed by root message ID. */
  threadCache: Record<string, Message[]>;
  /** ID of the root message whose thread panel is open; null when closed. */
  activeThreadId: string | null;

  fetchMessages: (channelId: string, before?: string) => Promise<void>;
  sendMessage: (
    channelId: string,
    data: CreateMessageRequest,
    files?: File[],
  ) => Promise<void>;
  editMessage: (messageId: string, content: string) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  addMessage: (message: Message) => void;
  updateMessage: (message: Message) => void;
  removeMessage: (event: MessageDeleteEvent) => void;
  setReplyingTo: (message: Message | null) => void;
  cacheAttachments: (messageId: string, attachments: Attachment[]) => void;
  clearMessages: () => void;
  clearError: () => void;

  // ── Thread actions ────────────────────────────────────────
  openThread: (messageId: string) => void;
  closeThread: () => void;
  fetchThreadReplies: (channelId: string, messageId: string) => Promise<void>;
  sendThreadReply: (
    channelId: string,
    messageId: string,
    content: string,
  ) => Promise<void>;
  /** Called when a THREAD_MESSAGE_CREATE WebSocket event arrives. */
  addThreadMessage: (msg: Message) => void;
}

export const useMessageStore = create<MessageState>((set) => ({
  messages: [],
  isLoading: false,
  hasMore: true,
  error: null,
  replyingTo: null,
  attachmentCache: {},
  threadCache: {},
  activeThreadId: null,

  fetchMessages: async (channelId, before) => {
    set({ isLoading: true });
    try {
      const fetched = await api.listMessages(channelId, { before, limit: 50 });
      set((state) => {
        const newMessages = before ? [...fetched, ...state.messages] : fetched;
        return {
          messages: newMessages,
          hasMore: fetched.length === 50,
          isLoading: false,
        };
      });
      // Batch-fetch attachments for all loaded messages in parallel
      const results = await Promise.allSettled(
        fetched.map((m) => api.listAttachments(m.id)),
      );
      set((state) => {
        const updates: Record<string, Attachment[]> = {};
        results.forEach((r, i) => {
          if (r.status === "fulfilled" && r.value.length > 0) {
            updates[fetched[i].id] = r.value;
          } else if (r.status === "rejected") {
            console.warn(
              "[MessageStore] Failed to load attachments for",
              fetched[i].id,
              r.reason,
            );
          }
        });
        return {
          attachmentCache: { ...state.attachmentCache, ...updates },
        };
      });
    } catch (err) {
      const message =
        err instanceof ApiRequestError
          ? err.message
          : "Failed to fetch messages";
      set({ error: message, isLoading: false });
    }
  },

  sendMessage: async (channelId, data, files) => {
    let msg: Message;
    try {
      msg = await api.createMessage(channelId, data);
      set({ replyingTo: null });
    } catch (err) {
      const message =
        err instanceof ApiRequestError ? err.message : "Failed to send message";
      set({ error: message });
      throw err;
    }

    // Message delivery succeeded — upload attachments separately
    if (files && files.length > 0) {
      try {
        const attachments = await api.uploadAttachments(msg.id, files);
        set((state) => ({
          attachmentCache: {
            ...state.attachmentCache,
            [msg.id]: attachments,
          },
        }));
      } catch (err) {
        const message =
          err instanceof ApiRequestError
            ? err.message
            : "Message sent but file upload failed";
        set({ error: message });
        // Do not re-throw — the message itself was delivered successfully
      }
    }
  },

  editMessage: async (messageId, content) => {
    try {
      const updated = await api.updateMessage(messageId, { content });
      set((state) => ({
        messages: state.messages.map((m) => (m.id === messageId ? updated : m)),
      }));
    } catch (err) {
      const message =
        err instanceof ApiRequestError ? err.message : "Failed to edit message";
      set({ error: message });
      throw err;
    }
  },

  deleteMessage: async (messageId) => {
    try {
      await api.deleteMessage(messageId);
      // Deletion event arrives via WebSocket
    } catch (err) {
      const msg =
        err instanceof ApiRequestError
          ? err.message
          : "Failed to delete message";
      set({ error: msg });
      throw err;
    }
  },

  addMessage: (message) => {
    set((state) => {
      if (state.messages.some((m) => m.id === message.id)) return state;
      return { messages: [...state.messages, message] };
    });
  },

  updateMessage: (message) => {
    set((state) => ({
      messages: state.messages.map((m) => (m.id === message.id ? message : m)),
    }));
  },

  removeMessage: (event) => {
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === event.id ? { ...m, deleted: true, content: "" } : m,
      ),
    }));
  },

  setReplyingTo: (message) => set({ replyingTo: message }),

  cacheAttachments: (messageId, attachments) =>
    set((state) => ({
      attachmentCache: { ...state.attachmentCache, [messageId]: attachments },
    })),

  clearMessages: () =>
    set({
      messages: [],
      hasMore: true,
      replyingTo: null,
      attachmentCache: {},
      threadCache: {},
      activeThreadId: null,
    }),

  clearError: () => set({ error: null }),

  // ── Thread actions ────────────────────────────────────────

  openThread: (messageId) => set({ activeThreadId: messageId }),

  closeThread: () => set({ activeThreadId: null }),

  fetchThreadReplies: async (channelId, messageId) => {
    set({ isLoading: true, error: null });
    try {
      const replies = await api.listThreadReplies(channelId, messageId);
      set((state) => ({
        threadCache: { ...state.threadCache, [messageId]: replies },
        isLoading: false,
      }));
    } catch (err) {
      const message =
        err instanceof ApiRequestError
          ? err.message
          : "Failed to load thread replies";
      set({ error: message, isLoading: false });
    }
  },

  sendThreadReply: async (channelId, messageId, content) => {
    try {
      const reply = await api.createThreadReply(channelId, messageId, {
        content,
      });
      set((state) => ({
        threadCache: {
          ...state.threadCache,
          [messageId]: [...(state.threadCache[messageId] ?? []), reply],
        },
        // Bump the reply count on the root message optimistically.
        messages: state.messages.map((m) =>
          m.id === messageId
            ? { ...m, thread_reply_count: m.thread_reply_count + 1 }
            : m,
        ),
      }));
    } catch (err) {
      const message =
        err instanceof ApiRequestError
          ? err.message
          : "Failed to send thread reply";
      set({ error: message });
      throw err;
    }
  },

  addThreadMessage: (msg) => {
    if (!msg.thread_id) {
      console.warn(
        "[MessageStore] Received THREAD_MESSAGE_CREATE with null thread_id",
        msg,
      );
      return;
    }
    const rootId = msg.thread_id;
    set((state) => {
      // Only append if the thread panel is loaded (cache entry exists).
      const existing = state.threadCache[rootId];
      const alreadyCached = existing?.some((r) => r.id === msg.id) ?? false;
      const updatedCache = existing
        ? {
            ...state.threadCache,
            [rootId]: alreadyCached ? existing : [...existing, msg],
          }
        : state.threadCache;

      // Only increment the reply count if the message was not already in the
      // cache (i.e. it was not sent by the current user via sendThreadReply,
      // which already incremented the count optimistically).
      const updatedMessages = alreadyCached
        ? state.messages
        : state.messages.map((m) =>
            m.id === rootId
              ? { ...m, thread_reply_count: m.thread_reply_count + 1 }
              : m,
          );

      return { threadCache: updatedCache, messages: updatedMessages };
    });
  },
}));
