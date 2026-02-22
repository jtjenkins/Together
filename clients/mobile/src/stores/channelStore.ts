import { create } from "zustand";
import type {
  Channel,
  CreateChannelRequest,
  UpdateChannelRequest,
} from "../types";
import { api, ApiRequestError } from "../api/client";

interface ChannelState {
  channels: Channel[];
  activeChannelId: string | null;
  isLoading: boolean;
  error: string | null;

  setActiveChannel: (id: string | null) => void;
  fetchChannels: (serverId: string) => Promise<void>;
  createChannel: (
    serverId: string,
    data: CreateChannelRequest,
  ) => Promise<Channel>;
  updateChannel: (
    serverId: string,
    channelId: string,
    data: UpdateChannelRequest,
  ) => Promise<void>;
  deleteChannel: (serverId: string, channelId: string) => Promise<void>;
  clearChannels: () => void;
  clearError: () => void;
}

export const useChannelStore = create<ChannelState>((set) => ({
  channels: [],
  activeChannelId: null,
  isLoading: false,
  error: null,

  setActiveChannel: (id) => set({ activeChannelId: id }),

  fetchChannels: async (serverId) => {
    set({ isLoading: true });
    try {
      const channels = await api.listChannels(serverId);
      channels.sort((a, b) => a.position - b.position);
      set({ channels, isLoading: false });
    } catch (err) {
      const message =
        err instanceof ApiRequestError
          ? err.message
          : "Failed to fetch channels";
      set({ error: message, isLoading: false });
    }
  },

  createChannel: async (serverId, data) => {
    try {
      const channel = await api.createChannel(serverId, data);
      set((state) => ({ channels: [...state.channels, channel] }));
      return channel;
    } catch (err) {
      const message =
        err instanceof ApiRequestError
          ? err.message
          : "Failed to create channel";
      set({ error: message });
      throw err;
    }
  },

  updateChannel: async (serverId, channelId, data) => {
    try {
      const updated = await api.updateChannel(serverId, channelId, data);
      set((state) => ({
        channels: state.channels.map((c) => (c.id === channelId ? updated : c)),
      }));
    } catch (err) {
      const message =
        err instanceof ApiRequestError
          ? err.message
          : "Failed to update channel";
      set({ error: message });
      throw err;
    }
  },

  deleteChannel: async (serverId, channelId) => {
    try {
      await api.deleteChannel(serverId, channelId);
      set((state) => ({
        channels: state.channels.filter((c) => c.id !== channelId),
        activeChannelId:
          state.activeChannelId === channelId ? null : state.activeChannelId,
      }));
    } catch (err) {
      const message =
        err instanceof ApiRequestError
          ? err.message
          : "Failed to delete channel";
      set({ error: message });
      throw err;
    }
  },

  clearChannels: () => set({ channels: [], activeChannelId: null }),

  clearError: () => set({ error: null }),
}));
