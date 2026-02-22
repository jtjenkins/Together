import { create } from "zustand";
import type { UnreadCount } from "../types";

interface ReadStateState {
  unreadCounts: Record<string, number>;

  setUnreadCounts: (counts: UnreadCount[]) => void;
  markRead: (channelId: string) => void;
  incrementUnread: (channelId: string) => void;
}

export const useReadStateStore = create<ReadStateState>((set) => ({
  unreadCounts: {},

  setUnreadCounts: (counts) => {
    const mapped: Record<string, number> = {};
    counts.forEach((c) => {
      mapped[c.channel_id] = c.unread_count;
    });
    set({ unreadCounts: mapped });
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
