import { create } from "zustand";
import type {
  UserDto,
  RegisterRequest,
  LoginRequest,
  UpdateUserDto,
  UserStatus,
} from "../types";
import { api, ApiRequestError } from "../api/client";
import { gateway } from "../api/websocket";
import { storage } from "../utils/storage";
import { TOKEN_KEY, REFRESH_KEY } from "../utils/platform";

interface AuthState {
  user: UserDto | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  register: (data: RegisterRequest) => Promise<void>;
  login: (data: LoginRequest) => Promise<void>;
  logout: () => void;
  updateProfile: (data: UpdateUserDto) => Promise<void>;
  updatePresence: (status: UserStatus, customStatus?: string | null) => void;
  setUser: (user: UserDto) => void;
  restoreSession: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,

  register: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.register(data);
      storage.setItem(TOKEN_KEY, res.access_token);
      storage.setItem(REFRESH_KEY, res.refresh_token);
      api.setToken(res.access_token);
      gateway.connect(res.access_token);
      set({ user: res.user, isAuthenticated: true, isLoading: false });
    } catch (err) {
      const message =
        err instanceof ApiRequestError ? err.message : "Registration failed";
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  login: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.login(data);
      storage.setItem(TOKEN_KEY, res.access_token);
      storage.setItem(REFRESH_KEY, res.refresh_token);
      api.setToken(res.access_token);
      gateway.connect(res.access_token);
      set({ user: res.user, isAuthenticated: true, isLoading: false });
    } catch (err) {
      const message =
        err instanceof ApiRequestError ? err.message : "Login failed";
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  logout: () => {
    storage.removeItem(TOKEN_KEY);
    storage.removeItem(REFRESH_KEY);
    api.setToken(null);
    gateway.disconnect();
    set({ user: null, isAuthenticated: false, isLoading: false, error: null });
  },

  updateProfile: async (data) => {
    try {
      const user = await api.updateCurrentUser(data);
      set({ user });
    } catch (err) {
      const message =
        err instanceof ApiRequestError ? err.message : "Update failed";
      set({ error: message });
      throw err;
    }
  },

  updatePresence: (status, customStatus = null) => {
    gateway.sendPresenceUpdate(status, customStatus);
    const user = get().user;
    if (user) {
      set({
        user: {
          ...user,
          status,
          custom_status: customStatus ?? user.custom_status,
        },
      });
    }
  },

  setUser: (user) => set({ user }),

  restoreSession: async () => {
    const token = storage.getItem(TOKEN_KEY);
    if (!token) {
      set({ isLoading: false });
      return;
    }

    api.setToken(token);
    try {
      const user = await api.getCurrentUser();
      gateway.connect(token);
      set({ user, isAuthenticated: true, isLoading: false });
    } catch (err) {
      if (
        !(
          err instanceof ApiRequestError &&
          (err.status === 401 || err.status === 403)
        )
      ) {
        console.error("[Auth] Unexpected session restore failure:", err);
      }
      storage.removeItem(TOKEN_KEY);
      storage.removeItem(REFRESH_KEY);
      api.setToken(null);
      set({ isLoading: false });
    }
  },

  clearError: () => set({ error: null }),
}));
