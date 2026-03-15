import { create } from "zustand";
import { api } from "../api/client";
import type { CustomEmoji } from "../types";

interface CustomEmojiState {
  /** Map from server_id to emoji list */
  emojis: Record<string, CustomEmoji[]>;
  getEmojis: (serverId: string) => CustomEmoji[];
  /** Load emojis for a server (no-op if already loaded). */
  loadEmojis: (serverId: string) => Promise<void>;
  /** Force re-fetch. Used after upload/delete. */
  refreshEmojis: (serverId: string) => Promise<void>;
  /** Called from WS CUSTOM_EMOJI_CREATE. */
  addEmoji: (emoji: CustomEmoji) => void;
  /** Called from WS CUSTOM_EMOJI_DELETE. */
  removeEmoji: (serverId: string, emojiId: string) => void;
}

export const useCustomEmojiStore = create<CustomEmojiState>((set, get) => ({
  emojis: {},

  getEmojis: (serverId) => get().emojis[serverId] ?? [],

  loadEmojis: async (serverId) => {
    if (get().emojis[serverId] !== undefined) return;
    await get().refreshEmojis(serverId);
  },

  refreshEmojis: async (serverId) => {
    try {
      const list = await api.listCustomEmojis(serverId);
      set((s) => ({ emojis: { ...s.emojis, [serverId]: list } }));
    } catch (e) {
      console.warn("[customEmojiStore] Failed to load emojis for", serverId, e);
    }
  },

  addEmoji: (emoji) => {
    set((s) => {
      const current = s.emojis[emoji.server_id] ?? [];
      if (current.some((e) => e.id === emoji.id)) return s;
      return {
        emojis: { ...s.emojis, [emoji.server_id]: [...current, emoji] },
      };
    });
  },

  removeEmoji: (serverId, emojiId) => {
    set((s) => {
      const current = s.emojis[serverId];
      if (!current) return s;
      return {
        emojis: {
          ...s.emojis,
          [serverId]: current.filter((e) => e.id !== emojiId),
        },
      };
    });
  },
}));
