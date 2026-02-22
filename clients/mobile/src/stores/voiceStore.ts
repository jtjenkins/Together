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
  toggleMute: () => Promise<void>;
  toggleDeafen: () => Promise<void>;
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
    set({ connectedChannelId: null, isMuted: false, isDeafened: false });
    try {
      await api.leaveVoiceChannel(channelId);
    } catch (err) {
      console.error("[VoiceStore] leave: failed to notify server", err);
    }
  },

  toggleMute: async () => {
    const { connectedChannelId: channelId, isMuted: currentMuted } =
      useVoiceStore.getState();
    if (!channelId) return;
    const newMuted = !currentMuted;
    set({ isMuted: newMuted });
    try {
      await api.updateVoiceState(channelId, {
        self_mute: newMuted,
      } satisfies UpdateVoiceStateRequest);
    } catch (err) {
      set({ isMuted: currentMuted });
      throw err;
    }
  },

  toggleDeafen: async () => {
    const { connectedChannelId: channelId, isDeafened: currentDeafened } =
      useVoiceStore.getState();
    if (!channelId) return;
    const newDeafened = !currentDeafened;
    set({ isDeafened: newDeafened });
    try {
      await api.updateVoiceState(channelId, {
        self_deaf: newDeafened,
      } satisfies UpdateVoiceStateRequest);
    } catch (err) {
      set({ isDeafened: currentDeafened });
      throw err;
    }
  },

  clearError: () => set({ error: null }),
}));
