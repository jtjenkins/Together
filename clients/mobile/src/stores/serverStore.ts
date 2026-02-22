import { create } from "zustand";
import type {
  ServerDto,
  CreateServerRequest,
  UpdateServerRequest,
  MemberDto,
} from "../types";
import { api, ApiRequestError } from "../api/client";

interface ServerState {
  servers: ServerDto[];
  activeServerId: string | null;
  members: MemberDto[];
  isLoading: boolean;
  error: string | null;

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
  ) => void;
  clearError: () => void;
}

export const useServerStore = create<ServerState>((set, get) => ({
  servers: [],
  activeServerId: null,
  members: [],
  isLoading: false,
  error: null,

  setServers: (servers) => set({ servers }),

  setActiveServer: (id) => {
    set({ activeServerId: id, members: [] });
    if (id) {
      get().fetchMembers(id);
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

  updateMemberPresence: (userId, status, customStatus) => {
    set((state) => ({
      members: state.members.map((m) =>
        m.user_id === userId
          ? {
              ...m,
              status: status as MemberDto["status"],
              custom_status: customStatus,
            }
          : m,
      ),
    }));
  },

  clearError: () => set({ error: null }),
}));
