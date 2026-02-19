import { create } from 'zustand';
import type { Message, CreateMessageRequest, MessageDeleteEvent } from '../types';
import { api, ApiRequestError } from '../api/client';

interface MessageState {
  messages: Message[];
  isLoading: boolean;
  hasMore: boolean;
  error: string | null;
  replyingTo: Message | null;

  fetchMessages: (channelId: string, before?: string) => Promise<void>;
  sendMessage: (channelId: string, data: CreateMessageRequest) => Promise<void>;
  editMessage: (messageId: string, content: string) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  addMessage: (message: Message) => void;
  updateMessage: (message: Message) => void;
  removeMessage: (event: MessageDeleteEvent) => void;
  setReplyingTo: (message: Message | null) => void;
  clearMessages: () => void;
  clearError: () => void;
}

export const useMessageStore = create<MessageState>((set) => ({
  messages: [],
  isLoading: false,
  hasMore: true,
  error: null,
  replyingTo: null,

  fetchMessages: async (channelId, before) => {
    set({ isLoading: true });
    try {
      const fetched = await api.listMessages(channelId, { before, limit: 50 });
      set((state) => {
        const newMessages = before
          ? [...fetched, ...state.messages]
          : fetched;
        return {
          messages: newMessages,
          hasMore: fetched.length === 50,
          isLoading: false,
        };
      });
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : 'Failed to fetch messages';
      set({ error: message, isLoading: false });
    }
  },

  sendMessage: async (channelId, data) => {
    try {
      await api.createMessage(channelId, data);
      set({ replyingTo: null });
      // Message will arrive via WebSocket
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : 'Failed to send message';
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
      const message = err instanceof ApiRequestError ? err.message : 'Failed to edit message';
      set({ error: message });
      throw err;
    }
  },

  deleteMessage: async (messageId) => {
    try {
      await api.deleteMessage(messageId);
      // Deletion event arrives via WebSocket
    } catch (err) {
      const msg = err instanceof ApiRequestError ? err.message : 'Failed to delete message';
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
        m.id === event.id ? { ...m, deleted: true, content: '' } : m,
      ),
    }));
  },

  setReplyingTo: (message) => set({ replyingTo: message }),

  clearMessages: () => set({ messages: [], hasMore: true, replyingTo: null }),

  clearError: () => set({ error: null }),
}));
