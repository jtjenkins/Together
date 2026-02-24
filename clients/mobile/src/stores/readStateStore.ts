import { create } from "zustand";
import type { MentionCount, UnreadCount } from "../types";

interface ReadStateState {
  unreadCounts: Record<string, number>;
  mentionCounts: Record<string, number>;

  setUnreadCounts: (counts: UnreadCount[]) => void;
  markRead: (channelId: string) => void;
  incrementUnread: (channelId: string) => void;

  setMentionCounts: (counts: MentionCount[]) => void;
  incrementMention: (channelId: string) => void;
  clearMentions: (channelId: string) => void;
}

export const useReadStateStore = create<ReadStateState>((set) => ({
  unreadCounts: {},
  mentionCounts: {},

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

  setMentionCounts: (counts) => {
    const mapped: Record<string, number> = {};
    counts.forEach((c) => {
      mapped[c.channel_id] = c.count;
    });
    set({ mentionCounts: mapped });
  },

  incrementMention: (channelId) =>
    set((state) => ({
      mentionCounts: {
        ...state.mentionCounts,
        [channelId]: (state.mentionCounts[channelId] ?? 0) + 1,
      },
    })),

  clearMentions: (channelId) =>
    set((state) => ({
      mentionCounts: { ...state.mentionCounts, [channelId]: 0 },
    })),
}));
