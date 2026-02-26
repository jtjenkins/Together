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
    const refreshToken = storage.getItem(REFRESH_KEY);

    if (!token && !refreshToken) {
      set({ isLoading: false });
      return;
    }

    // Set whatever access token we have (may be expired — the API client's
    // 401 interceptor will automatically exchange the refresh token for a new
    // one and retry, so we don't need to handle that case explicitly here).
    if (token) {
      api.setToken(token);
    }

    try {
      const user = await api.getCurrentUser();
      // Use api.getToken() rather than the captured `token` variable: the
      // interceptor may have silently swapped in a fresh access token.
      const activeToken = api.getToken()!;
      gateway.connect(activeToken);
      set({ user, isAuthenticated: true, isLoading: false });
    } catch (err) {
      if (
        err instanceof ApiRequestError &&
        (err.status === 401 || err.status === 403)
      ) {
        // Credentials are invalid — clear them so the user goes to the login screen.
        storage.removeItem(TOKEN_KEY);
        storage.removeItem(REFRESH_KEY);
      } else {
        // Network or server error — leave credentials intact so the next launch can retry.
        console.error("[Auth] Unexpected session restore failure:", err);
      }
      api.setToken(null);
      set({ isLoading: false });
    }
  },

  clearError: () => set({ error: null }),
}));

// When the API client exhausts the refresh token (session truly dead),
// clear all credentials and drop back to the Auth screen automatically.
api.setSessionExpiredCallback(() => {
  storage.removeItem(TOKEN_KEY);
  storage.removeItem(REFRESH_KEY);
  api.setToken(null);
  gateway.disconnect();
  useAuthStore.setState({
    user: null,
    isAuthenticated: false,
    isLoading: false,
  });
});
