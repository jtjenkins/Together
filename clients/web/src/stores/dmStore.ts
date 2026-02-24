import { create } from "zustand";
import type { DirectMessage, DirectMessageChannel } from "../types";
import { api, ApiRequestError } from "../api/client";

interface DmState {
  channels: DirectMessageChannel[];
  activeDmChannelId: string | null;
  /** Messages keyed by DM channel ID, newest-last for rendering. */
  messagesByChannel: Record<string, DirectMessage[]>;
  /** Whether there are more messages to load for the active channel. */
  hasMore: boolean;
  isLoading: boolean;
  error: string | null;

  setChannels: (channels: DirectMessageChannel[]) => void;
  addChannel: (channel: DirectMessageChannel) => void;
  setActiveDmChannel: (id: string | null) => void;

  fetchChannels: () => Promise<void>;
  openOrCreateDm: (userId: string) => Promise<DirectMessageChannel>;

  fetchMessages: (channelId: string, before?: string) => Promise<void>;
  sendMessage: (channelId: string, content: string) => Promise<void>;
  addMessage: (message: DirectMessage) => void;

  clearError: () => void;
}

export const useDmStore = create<DmState>((set, get) => ({
  channels: [],
  activeDmChannelId: null,
  messagesByChannel: {},
  hasMore: true,
  isLoading: false,
  error: null,

  setChannels: (channels) => set({ channels }),

  addChannel: (channel) =>
    set((state) => {
      const exists = state.channels.some((c) => c.id === channel.id);
      if (exists) return {};
      return { channels: [channel, ...state.channels] };
    }),

  setActiveDmChannel: (id) => set({ activeDmChannelId: id, hasMore: true }),

  fetchChannels: async () => {
    try {
      const channels = await api.listDmChannels();
      set({ channels });
    } catch (err) {
      const message =
        err instanceof ApiRequestError ? err.message : "Failed to load DMs";
      set({ error: message });
    }
  },

  openOrCreateDm: async (userId) => {
    try {
      const channel = await api.openDmChannel(userId);
      set((state) => {
        const exists = state.channels.some((c) => c.id === channel.id);
        if (exists) return {};
        return { channels: [channel, ...state.channels] };
      });
      return channel;
    } catch (err) {
      const message =
        err instanceof ApiRequestError ? err.message : "Failed to open DM";
      set({ error: message });
      throw err;
    }
  },

  fetchMessages: async (channelId, before) => {
    set({ isLoading: true });
    try {
      const fetched = await api.listDmMessages(channelId, {
        before,
        limit: 50,
      });
      // Server returns newest-first; reverse for display (oldest at top).
      const ordered = [...fetched].reverse();
      set((state) => {
        const existing = state.messagesByChannel[channelId] ?? [];
        const messages = before ? [...ordered, ...existing] : ordered;
        return {
          messagesByChannel: {
            ...state.messagesByChannel,
            [channelId]: messages,
          },
          hasMore: fetched.length === 50,
          isLoading: false,
        };
      });
    } catch (err) {
      const message =
        err instanceof ApiRequestError
          ? err.message
          : "Failed to load messages";
      set({ isLoading: false, error: message });
    }
  },

  sendMessage: async (channelId, content) => {
    try {
      const message = await api.sendDmMessage(channelId, content);
      get().addMessage(message);
    } catch (err) {
      const message =
        err instanceof ApiRequestError ? err.message : "Failed to send message";
      set({ error: message });
      throw err;
    }
  },

  addMessage: (message) => {
    set((state) => {
      const existing = state.messagesByChannel[message.channel_id] ?? [];
      // Avoid duplicates (e.g. own message via WS echo + optimistic).
      if (existing.some((m) => m.id === message.id)) return {};
      return {
        messagesByChannel: {
          ...state.messagesByChannel,
          [message.channel_id]: [...existing, message],
        },
        // Update last_message_at on the channel.
        channels: state.channels.map((c) =>
          c.id === message.channel_id
            ? { ...c, last_message_at: message.created_at }
            : c,
        ),
      };
    });
  },

  clearError: () => set({ error: null }),
}));
