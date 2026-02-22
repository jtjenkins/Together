import { create } from "zustand";
import type { UnreadCount } from "../types";

interface ReadStateStore {
  /** channelId → unread count */
  unreadCounts: Record<string, number>;

  setUnreadCounts: (counts: UnreadCount[]) => void;
  markRead: (channelId: string) => void;
  incrementUnread: (channelId: string) => void;
}

export const useReadStateStore = create<ReadStateStore>((set) => ({
  unreadCounts: {},

  setUnreadCounts: (counts) => {
    const map: Record<string, number> = {};
    for (const { channel_id, unread_count } of counts) {
      map[channel_id] = unread_count;
    }
    set({ unreadCounts: map });
  },

  markRead: (channelId) =>
    set((state) => ({
      unreadCounts: { ...state.unreadCounts, [channelId]: 0 },
    })),

  incrementUnread: (channelId) =>
    set((state) => ({
      unreadCounts: {
        ...state.unreadCounts,
        [channelId]: (state.unreadCounts[channelId] ?? 0) + 1,
      },
    })),
}));
