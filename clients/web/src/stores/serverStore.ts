import { create } from "zustand";
import type {
  ServerDto,
  CreateServerRequest,
  UpdateServerRequest,
  MemberDto,
  ServerBan,
} from "../types";
import { api, ApiRequestError } from "../api/client";
import { useCustomEmojiStore } from "./customEmojiStore";

interface ServerState {
  servers: ServerDto[];
  activeServerId: string | null;
  members: MemberDto[];
  isLoading: boolean;
  error: string | null;
  discoverableServers: ServerDto[];
  isBrowseLoading: boolean;
  browseError: string | null;

  setServers: (servers: ServerDto[]) => void;
  setActiveServer: (id: string | null) => void;
  fetchServers: () => Promise<void>;
  createServer: (data: CreateServerRequest) => Promise<ServerDto>;
  updateServer: (id: string, data: UpdateServerRequest) => Promise<void>;
  deleteServer: (id: string) => Promise<void>;
  joinServer: (id: string) => Promise<void>;
  leaveServer: (id: string) => Promise<void>;
  fetchMembers: (serverId: string) => Promise<void>;
  updateMemberPresence: (
    userId: string,
    status: string,
    customStatus: string | null,
    activity: string | null,
  ) => void;
  fetchDiscoverableServers: () => Promise<void>;
  clearError: () => void;
  kickMember: (
    serverId: string,
    userId: string,
    reason?: string,
  ) => Promise<void>;
  banMember: (
    serverId: string,
    userId: string,
    reason?: string,
  ) => Promise<void>;
  timeoutMember: (
    serverId: string,
    userId: string,
    durationMinutes: number,
    reason?: string,
  ) => Promise<void>;
  removeTimeout: (serverId: string, userId: string) => Promise<void>;
  removeMemberLocally: (userId: string) => void;
  setMemberTimeout: (userId: string, expiresAt: string | null) => void;
  bans: ServerBan[];
  isBansLoading: boolean;
  fetchBans: (serverId: string) => Promise<void>;
  unbanMember: (serverId: string, userId: string) => Promise<void>;
}

export const useServerStore = create<ServerState>((set, get) => ({
  servers: [],
  activeServerId: null,
  members: [],
  isLoading: false,
  error: null,
  discoverableServers: [],
  isBrowseLoading: false,
  browseError: null,
  bans: [],
  isBansLoading: false,

  setServers: (servers) => set({ servers }),

  setActiveServer: (id) => {
    set({ activeServerId: id, members: [] });
    if (id) {
      get().fetchMembers(id);
      useCustomEmojiStore.getState().loadEmojis(id);
    }
  },

  fetchServers: async () => {
    set({ isLoading: true });
    try {
      const servers = await api.listServers();
      set({ servers, isLoading: false });
    } catch (err) {
      const message =
        err instanceof ApiRequestError
          ? err.message
          : "Failed to fetch servers";
      set({ error: message, isLoading: false });
    }
  },

  createServer: async (data) => {
    try {
      const server = await api.createServer(data);
      set((state) => ({ servers: [...state.servers, server] }));
      return server;
    } catch (err) {
      const message =
        err instanceof ApiRequestError
          ? err.message
          : "Failed to create server";
      set({ error: message });
      throw err;
    }
  },

  updateServer: async (id, data) => {
    try {
      const updated = await api.updateServer(id, data);
      set((state) => ({
        servers: state.servers.map((s) => (s.id === id ? updated : s)),
      }));
    } catch (err) {
      const message =
        err instanceof ApiRequestError
          ? err.message
          : "Failed to update server";
      set({ error: message });
      throw err;
    }
  },

  deleteServer: async (id) => {
    try {
      await api.deleteServer(id);
      set((state) => ({
        servers: state.servers.filter((s) => s.id !== id),
        activeServerId:
          state.activeServerId === id ? null : state.activeServerId,
      }));
    } catch (err) {
      const message =
        err instanceof ApiRequestError
          ? err.message
          : "Failed to delete server";
      set({ error: message });
      throw err;
    }
  },

  joinServer: async (id) => {
    try {
      await api.joinServer(id);
      await get().fetchServers();
    } catch (err) {
      const message =
        err instanceof ApiRequestError ? err.message : "Failed to join server";
      set({ error: message });
      throw err;
    }
  },

  leaveServer: async (id) => {
    try {
      await api.leaveServer(id);
      set((state) => ({
        servers: state.servers.filter((s) => s.id !== id),
        activeServerId:
          state.activeServerId === id ? null : state.activeServerId,
      }));
    } catch (err) {
      const message =
        err instanceof ApiRequestError ? err.message : "Failed to leave server";
      set({ error: message });
      throw err;
    }
  },

  fetchMembers: async (serverId) => {
    try {
      const members = await api.listMembers(serverId);
      set({ members });
    } catch {
      // Non-critical — silently fail
    }
  },

  updateMemberPresence: (userId, status, customStatus, activity) => {
    set((state) => ({
      members: state.members.map((m) =>
        m.user_id === userId
          ? {
              ...m,
              status: status as MemberDto["status"],
              custom_status: customStatus,
              activity,
            }
          : m,
      ),
    }));
  },

  fetchDiscoverableServers: async () => {
    set({ isBrowseLoading: true, browseError: null });
    try {
      const discoverableServers = await api.browseServers();
      set({ discoverableServers, isBrowseLoading: false });
    } catch (err) {
      const message =
        err instanceof ApiRequestError
          ? err.message
          : "Failed to load public server list";
      set({ browseError: message, isBrowseLoading: false });
    }
  },

  kickMember: async (serverId, userId, reason) => {
    try {
      await api.kickMember(serverId, userId, reason ? { reason } : undefined);
      set((state) => ({
        members: state.members.filter((m) => m.user_id !== userId),
      }));
    } catch (err) {
      const message =
        err instanceof ApiRequestError ? err.message : "Failed to kick member";
      set({ error: message });
      throw err;
    }
  },

  banMember: async (serverId, userId, reason) => {
    try {
      await api.banMember(serverId, userId, reason ? { reason } : undefined);
      set((state) => ({
        members: state.members.filter((m) => m.user_id !== userId),
      }));
    } catch (err) {
      const message =
        err instanceof ApiRequestError ? err.message : "Failed to ban member";
      set({ error: message });
      throw err;
    }
  },

  timeoutMember: async (serverId, userId, durationMinutes, reason) => {
    try {
      await api.timeoutMember(serverId, userId, {
        duration_minutes: durationMinutes,
        reason,
      });
    } catch (err) {
      const message =
        err instanceof ApiRequestError
          ? err.message
          : "Failed to timeout member";
      set({ error: message });
      throw err;
    }
  },

  removeTimeout: async (serverId, userId) => {
    try {
      await api.removeTimeout(serverId, userId);
      set((state) => ({
        members: state.members.map((m) =>
          m.user_id === userId ? { ...m, timeout_expires_at: null } : m,
        ),
      }));
    } catch (err) {
      const message =
        err instanceof ApiRequestError
          ? err.message
          : "Failed to remove timeout";
      set({ error: message });
      throw err;
    }
  },

  removeMemberLocally: (userId) => {
    set((state) => ({
      members: state.members.filter((m) => m.user_id !== userId),
    }));
  },

  setMemberTimeout: (userId, expiresAt) => {
    set((state) => ({
      members: state.members.map((m) =>
        m.user_id === userId ? { ...m, timeout_expires_at: expiresAt } : m,
      ),
    }));
  },

  clearError: () => set({ error: null }),

  fetchBans: async (serverId) => {
    set({ isBansLoading: true });
    try {
      const bans = await api.listBans(serverId);
      set({ bans, isBansLoading: false });
    } catch (e) {
      const msg =
        e instanceof ApiRequestError ? e.message : "Failed to fetch bans";
      set({ error: msg, isBansLoading: false });
    }
  },

  unbanMember: async (serverId, userId) => {
    try {
      await api.removeBan(serverId, userId);
      set((state) => ({
        bans: state.bans.filter((b) => b.user_id !== userId),
      }));
    } catch (e) {
      const msg =
        e instanceof ApiRequestError ? e.message : "Failed to unban user";
      set({ error: msg });
    }
  },
}));
