import { create } from "zustand";
import { api } from "../api/client";
import { ApiRequestError } from "../api/client";
import type {
  AutoModConfig,
  AutoModActionEvent,
  UpdateAutoModConfigRequest,
  AutoModWordFilter,
  AutoModLog,
} from "../types";

interface AutoModState {
  config: AutoModConfig | null;
  words: AutoModWordFilter[];
  logs: AutoModLog[];
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;

  fetchConfig: (serverId: string) => Promise<void>;
  updateConfig: (
    serverId: string,
    data: UpdateAutoModConfigRequest,
  ) => Promise<void>;
  fetchWords: (serverId: string) => Promise<void>;
  addWord: (serverId: string, word: string) => Promise<void>;
  removeWord: (serverId: string, wordId: string) => Promise<void>;
  fetchLogs: (serverId: string) => Promise<void>;
  /** Prepend a real-time AUTOMOD_ACTION event to the log list. */
  appendRealtimeLog: (event: AutoModActionEvent) => void;
  clearError: () => void;
  reset: () => void;
}

export const useAutoModStore = create<AutoModState>((set) => ({
  config: null,
  words: [],
  logs: [],
  isLoading: false,
  isSaving: false,
  error: null,

  fetchConfig: async (serverId) => {
    set({ isLoading: true, error: null });
    try {
      const config = await api.getAutomodConfig(serverId);
      set({ config, isLoading: false });
    } catch (err) {
      set({
        error:
          err instanceof ApiRequestError
            ? err.message
            : "Failed to load auto-mod config",
        isLoading: false,
      });
    }
  },

  updateConfig: async (serverId, data) => {
    set({ isSaving: true, error: null });
    try {
      const config = await api.updateAutomodConfig(serverId, data);
      set({ config, isSaving: false });
    } catch (err) {
      set({
        error:
          err instanceof ApiRequestError
            ? err.message
            : "Failed to save auto-mod config",
        isSaving: false,
      });
      throw err;
    }
  },

  fetchWords: async (serverId) => {
    set({ isLoading: true, error: null });
    try {
      const words = await api.listWordFilters(serverId);
      set({ words, isLoading: false });
    } catch (err) {
      set({
        error:
          err instanceof ApiRequestError
            ? err.message
            : "Failed to load word filters",
        isLoading: false,
      });
    }
  },

  addWord: async (serverId, word) => {
    try {
      const filter = await api.addWordFilter(serverId, word);
      set((s) => ({ words: [...s.words, filter] }));
    } catch (err) {
      const message =
        err instanceof ApiRequestError ? err.message : "Failed to add word";
      set({ error: message });
      throw err;
    }
  },

  removeWord: async (serverId, wordId) => {
    try {
      await api.removeWordFilter(serverId, wordId);
      set((s) => ({ words: s.words.filter((w) => w.id !== wordId) }));
    } catch (err) {
      const message =
        err instanceof ApiRequestError ? err.message : "Failed to remove word";
      set({ error: message });
      throw err;
    }
  },

  fetchLogs: async (serverId) => {
    set({ isLoading: true, error: null });
    try {
      const logs = await api.listAutomodLogs(serverId);
      set({ logs, isLoading: false });
    } catch (err) {
      set({
        error:
          err instanceof ApiRequestError
            ? err.message
            : "Failed to load audit logs",
        isLoading: false,
      });
    }
  },

  appendRealtimeLog: (event) =>
    set((s) => ({
      logs: [
        {
          id: crypto.randomUUID(),
          server_id: event.server_id,
          channel_id: event.channel_id ?? null,
          user_id: event.user_id,
          username: event.username,
          rule_type: event.rule_type,
          action_taken: event.action_taken,
          message_content: null,
          matched_term: event.matched_term ?? null,
          created_at: new Date().toISOString(),
        },
        ...s.logs,
      ].slice(0, 100),
    })),

  clearError: () => set({ error: null }),

  reset: () =>
    set({
      config: null,
      words: [],
      logs: [],
      isLoading: false,
      isSaving: false,
      error: null,
    }),
}));
