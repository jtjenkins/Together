import { create } from "zustand";

interface TypingUser {
  userId: string;
  username: string;
  channelId: string;
  timestamp: number;
}

interface TypingState {
  /** Typing users keyed by channel ID */
  typingUsers: Record<string, TypingUser[]>;

  /** Add a typing user to a channel */
  addTypingUser: (userId: string, username: string, channelId: string) => void;

  /** Remove a typing user from a channel */
  removeTypingUser: (userId: string, channelId: string) => void;

  /** Clear all typing users for a channel */
  clearChannelTyping: (channelId: string) => void;

  /** Get typing users for a channel (excluding self) */
  getTypingUsers: (channelId: string, selfUserId?: string) => TypingUser[];

  /** Clean up expired typing indicators (>10 seconds old) */
  cleanupExpired: () => void;
}

// Auto-expire typing indicators after 10 seconds
const TYPING_TIMEOUT_MS = 10000;

export const useTypingStore = create<TypingState>((set, get) => ({
  typingUsers: {},

  addTypingUser: (userId, username, channelId) => {
    set((state) => {
      const channelTyping = state.typingUsers[channelId] || [];
      const existing = channelTyping.find((u) => u.userId === userId);

      if (existing) {
        // Update timestamp for existing user
        return {
          typingUsers: {
            ...state.typingUsers,
            [channelId]: channelTyping.map((u) =>
              u.userId === userId ? { ...u, timestamp: Date.now() } : u,
            ),
          },
        };
      }

      // Add new typing user
      return {
        typingUsers: {
          ...state.typingUsers,
          [channelId]: [
            ...channelTyping,
            { userId, username, channelId, timestamp: Date.now() },
          ],
        },
      };
    });
  },

  removeTypingUser: (userId, channelId) => {
    set((state) => {
      const channelTyping = state.typingUsers[channelId] || [];
      const filtered = channelTyping.filter((u) => u.userId !== userId);

      if (filtered.length === channelTyping.length) {
        return state;
      }

      return {
        typingUsers: {
          ...state.typingUsers,
          [channelId]: filtered,
        },
      };
    });
  },

  clearChannelTyping: (channelId) => {
    set((state) => {
      if (!state.typingUsers[channelId]) {
        return state;
      }
      const { [channelId]: _removed, ...rest } = state.typingUsers;
      return { typingUsers: rest };
    });
  },

  getTypingUsers: (channelId, selfUserId) => {
    const channelTyping = get().typingUsers[channelId] || [];
    const now = Date.now();

    return channelTyping.filter(
      (u) => u.userId !== selfUserId && now - u.timestamp < TYPING_TIMEOUT_MS,
    );
  },

  cleanupExpired: () => {
    const now = Date.now();
    set((state) => {
      const cleaned: Record<string, TypingUser[]> = {};

      for (const [channelId, users] of Object.entries(state.typingUsers)) {
        const filtered = users.filter(
          (u) => now - u.timestamp < TYPING_TIMEOUT_MS,
        );
        if (filtered.length > 0) {
          cleaned[channelId] = filtered;
        }
      }

      return { typingUsers: cleaned };
    });
  },
}));

// Auto-cleanup every 5 seconds
if (typeof window !== "undefined") {
  setInterval(() => {
    useTypingStore.getState().cleanupExpired();
  }, 5000);
}
