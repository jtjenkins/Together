import { create } from "zustand";
import type {
  AdminStatsResponse,
  AdminUserDto,
  AdminServerDto,
  UpdateAdminUserRequest,
} from "../types";
import { api, ApiRequestError } from "../api/client";

interface AdminState {
  stats: AdminStatsResponse | null;
  statsLoading: boolean;
  statsError: string | null;

  users: AdminUserDto[];
  usersTotal: number;
  usersPage: number;
  usersPerPage: number;
  usersSearch: string;
  usersLoading: boolean;
  usersError: string | null;

  servers: AdminServerDto[];
  serversTotal: number;
  serversPage: number;
  serversPerPage: number;
  serversSearch: string;
  serversLoading: boolean;
  serversError: string | null;

  fetchStats: () => Promise<void>;
  fetchUsers: (page?: number, search?: string) => Promise<void>;
  updateUser: (userId: string, data: UpdateAdminUserRequest) => Promise<void>;
  deleteUser: (userId: string) => Promise<void>;
  fetchServers: (page?: number, search?: string) => Promise<void>;
  deleteServer: (serverId: string) => Promise<void>;
  setUsersSearch: (search: string) => void;
  setServersSearch: (search: string) => void;
  clearErrors: () => void;
}

export const useAdminStore = create<AdminState>((set, get) => ({
  stats: null,
  statsLoading: false,
  statsError: null,

  users: [],
  usersTotal: 0,
  usersPage: 1,
  usersPerPage: 20,
  usersSearch: "",
  usersLoading: false,
  usersError: null,

  servers: [],
  serversTotal: 0,
  serversPage: 1,
  serversPerPage: 20,
  serversSearch: "",
  serversLoading: false,
  serversError: null,

  fetchStats: async () => {
    set({ statsLoading: true, statsError: null });
    try {
      const stats = await api.getAdminStats();
      set({ stats, statsLoading: false });
    } catch (err) {
      const message =
        err instanceof ApiRequestError ? err.message : "Failed to fetch stats";
      set({ statsError: message, statsLoading: false });
    }
  },

  fetchUsers: async (page?: number, search?: string) => {
    const state = get();
    const p = page ?? state.usersPage;
    const s = search ?? state.usersSearch;
    set({ usersLoading: true, usersError: null, usersPage: p, usersSearch: s });
    try {
      const res = await api.getAdminUsers({
        page: p,
        per_page: state.usersPerPage,
        search: s || undefined,
      });
      set({
        users: res.users,
        usersTotal: res.total,
        usersLoading: false,
      });
    } catch (err) {
      const message =
        err instanceof ApiRequestError ? err.message : "Failed to fetch users";
      set({ usersError: message, usersLoading: false });
    }
  },

  updateUser: async (userId, data) => {
    try {
      await api.updateAdminUser(userId, data);
      // Refresh user list to reflect changes
      await get().fetchUsers();
    } catch (err) {
      const message =
        err instanceof ApiRequestError ? err.message : "Failed to update user";
      set({ usersError: message });
      throw err;
    }
  },

  deleteUser: async (userId) => {
    try {
      await api.deleteAdminUser(userId);
      await get().fetchUsers();
    } catch (err) {
      const message =
        err instanceof ApiRequestError ? err.message : "Failed to delete user";
      set({ usersError: message });
      throw err;
    }
  },

  fetchServers: async (page?: number, search?: string) => {
    const state = get();
    const p = page ?? state.serversPage;
    const s = search ?? state.serversSearch;
    set({
      serversLoading: true,
      serversError: null,
      serversPage: p,
      serversSearch: s,
    });
    try {
      const res = await api.getAdminServers({
        page: p,
        per_page: state.serversPerPage,
        search: s || undefined,
      });
      set({
        servers: res.servers,
        serversTotal: res.total,
        serversLoading: false,
      });
    } catch (err) {
      const message =
        err instanceof ApiRequestError
          ? err.message
          : "Failed to fetch servers";
      set({ serversError: message, serversLoading: false });
    }
  },

  deleteServer: async (serverId) => {
    try {
      await api.deleteAdminServer(serverId);
      await get().fetchServers();
    } catch (err) {
      const message =
        err instanceof ApiRequestError
          ? err.message
          : "Failed to delete server";
      set({ serversError: message });
      throw err;
    }
  },

  setUsersSearch: (search) => set({ usersSearch: search }),
  setServersSearch: (search) => set({ serversSearch: search }),
  clearErrors: () =>
    set({ statsError: null, usersError: null, serversError: null }),
}));
