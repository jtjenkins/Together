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
}

export const useMessageStore = create<MessageState>((set) => ({
  messages: [],
  isLoading: false,
  hasMore: true,
  error: null,
  replyingTo: null,
  attachmentCache: {},

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
      // Batch-fetch attachments for loaded messages (fire-and-forget)
      const results = await Promise.allSettled(
        fetched.map((m) => api.listAttachments(m.id)),
      );
      set((state) => {
        const updates: Record<string, Attachment[]> = {};
        results.forEach((r, i) => {
          if (r.status === "fulfilled" && r.value.length > 0) {
            updates[fetched[i].id] = r.value;
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
    try {
      const msg = await api.createMessage(channelId, data);
      set({ replyingTo: null });
      // Message will also arrive via WebSocket, but upload attachments now
      if (files && files.length > 0) {
        const attachments = await api.uploadAttachments(msg.id, files);
        set((state) => ({
          attachmentCache: {
            ...state.attachmentCache,
            [msg.id]: attachments,
          },
        }));
      }
    } catch (err) {
      const message =
        err instanceof ApiRequestError ? err.message : "Failed to send message";
      set({ error: message });
      throw err;
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
    set({ messages: [], hasMore: true, replyingTo: null, attachmentCache: {} }),

  clearError: () => set({ error: null }),
}));
