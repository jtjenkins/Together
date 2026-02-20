import { create } from "zustand";
import type { VoiceParticipant, UpdateVoiceStateRequest } from "../types";
import { api, ApiRequestError } from "../api/client";

interface VoiceStore {
  connectedChannelId: string | null;
  isMuted: boolean;
  isDeafened: boolean;
  isConnecting: boolean;
  error: string | null;

  join: (channelId: string) => Promise<VoiceParticipant>;
  leave: () => Promise<void>;
  toggleMute: (
    channelId: string,
    currentMuted: boolean,
  ) => Promise<VoiceParticipant>;
  toggleDeafen: (
    channelId: string,
    currentDeafened: boolean,
  ) => Promise<VoiceParticipant>;
  clearError: () => void;
}

export const useVoiceStore = create<VoiceStore>((set) => ({
  connectedChannelId: null,
  isMuted: false,
  isDeafened: false,
  isConnecting: false,
  error: null,

  join: async (channelId) => {
    set({ isConnecting: true, error: null });
    try {
      const vs = await api.joinVoiceChannel(channelId);
      set({
        connectedChannelId: channelId,
        isMuted: vs.self_mute,
        isDeafened: vs.self_deaf,
        isConnecting: false,
      });
      return vs;
    } catch (err) {
      const message =
        err instanceof ApiRequestError ? err.message : "Failed to join voice";
      set({ error: message, isConnecting: false });
      throw err;
    }
  },

  leave: async () => {
    const { connectedChannelId: channelId } = useVoiceStore.getState();
    if (!channelId) return;
    // Clear local state immediately for snappy UI, ignore API errors
    set({ connectedChannelId: null, isMuted: false, isDeafened: false });
    await api.leaveVoiceChannel(channelId).catch(() => {
      // Ignore — the server will clean up via WebSocket disconnect
    });
  },

  toggleMute: async (channelId, currentMuted) => {
    const newMuted = !currentMuted;
    set({ isMuted: newMuted });
    try {
      return await api.updateVoiceState(channelId, {
        self_mute: newMuted,
      } satisfies UpdateVoiceStateRequest);
    } catch (err) {
      set({ isMuted: currentMuted }); // revert on failure
      throw err;
    }
  },

  toggleDeafen: async (channelId, currentDeafened) => {
    const newDeafened = !currentDeafened;
    set({ isDeafened: newDeafened });
    try {
      return await api.updateVoiceState(channelId, {
        self_deaf: newDeafened,
      } satisfies UpdateVoiceStateRequest);
    } catch (err) {
      set({ isDeafened: currentDeafened }); // revert on failure
      throw err;
    }
  },

  clearError: () => set({ error: null }),
}));
