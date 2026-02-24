import { create } from "zustand";
import type { MentionCount, UnreadCount } from "../types";

interface ReadStateStore {
  /** channelId → unread count */
  unreadCounts: Record<string, number>;
  /** channelId → unread @mention count */
  mentionCounts: Record<string, number>;

  setUnreadCounts: (counts: UnreadCount[]) => void;
  markRead: (channelId: string) => void;
  incrementUnread: (channelId: string) => void;

  setMentionCounts: (counts: MentionCount[]) => void;
  incrementMention: (channelId: string) => void;
  clearMentions: (channelId: string) => void;
}

export const useReadStateStore = create<ReadStateStore>((set) => ({
  unreadCounts: {},
  mentionCounts: {},

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

  setMentionCounts: (counts) => {
    const map: Record<string, number> = {};
    for (const { channel_id, count } of counts) {
      map[channel_id] = count;
    }
    set({ mentionCounts: map });
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
