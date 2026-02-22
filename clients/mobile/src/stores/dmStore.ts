import { create } from "zustand";
import type { DirectMessageChannel, DirectMessage } from "../types";
import { api, ApiRequestError } from "../api/client";

interface DmState {
  dmChannels: DirectMessageChannel[];
  activeDmChannelId: string | null;
  dmMessages: Record<string, DirectMessage[]>;
  isLoading: boolean;
  error: string | null;

  setDmChannels: (channels: DirectMessageChannel[]) => void;
  setActiveDmChannel: (id: string | null) => void;
  addDmChannel: (channel: DirectMessageChannel) => void;
  fetchDmChannels: () => Promise<void>;
  sendDmMessage: (channelId: string, content: string) => Promise<void>;
  fetchDmMessages: (channelId: string, before?: string) => Promise<void>;
  addDmMessage: (message: DirectMessage) => void;
  clearError: () => void;
}

export const useDmStore = create<DmState>((set) => ({
  dmChannels: [],
  activeDmChannelId: null,
  dmMessages: {},
  isLoading: false,
  error: null,

  setDmChannels: (channels) => set({ dmChannels: channels }),

  setActiveDmChannel: (id) => set({ activeDmChannelId: id }),

  addDmChannel: (channel) =>
    set((state) => {
      if (state.dmChannels.some((c) => c.id === channel.id)) return state;
      return { dmChannels: [channel, ...state.dmChannels] };
    }),

  fetchDmChannels: async () => {
    set({ isLoading: true });
    try {
      const channels = await api.listDmChannels();
      set({ dmChannels: channels, isLoading: false });
    } catch (err) {
      const message =
        err instanceof ApiRequestError
          ? err.message
          : "Failed to fetch DM channels";
      set({ error: message, isLoading: false });
    }
  },

  sendDmMessage: async (channelId, content) => {
    try {
      const message = await api.sendDmMessage(channelId, content);
      set((state) => {
        const existing = state.dmMessages[channelId] ?? [];
        if (existing.some((m) => m.id === message.id)) return state;
        return {
          dmMessages: {
            ...state.dmMessages,
            [channelId]: [...existing, message],
          },
        };
      });
    } catch (err) {
      const message =
        err instanceof ApiRequestError
          ? err.message
          : "Failed to send DM message";
      set({ error: message });
      throw err;
    }
  },

  fetchDmMessages: async (channelId, before) => {
    set({ isLoading: true });
    try {
      const fetched = await api.listDmMessages(channelId, before);
      set((state) => {
        const existing = before ? (state.dmMessages[channelId] ?? []) : [];
        const merged = before ? [...fetched, ...existing] : fetched;
        return {
          dmMessages: {
            ...state.dmMessages,
            [channelId]: merged,
          },
          isLoading: false,
        };
      });
    } catch (err) {
      const message =
        err instanceof ApiRequestError
          ? err.message
          : "Failed to fetch DM messages";
      set({ error: message, isLoading: false });
    }
  },

  addDmMessage: (message) =>
    set((state) => {
      const existing = state.dmMessages[message.channel_id] ?? [];
      if (existing.some((m) => m.id === message.id)) return state;
      return {
        dmMessages: {
          ...state.dmMessages,
          [message.channel_id]: [...existing, message],
        },
      };
    }),

  clearError: () => set({ error: null }),
}));
