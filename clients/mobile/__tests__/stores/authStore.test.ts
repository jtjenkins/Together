import { useAuthStore } from "../../src/stores/authStore";
import { api, ApiRequestError } from "../../src/api/client";
import { gateway } from "../../src/api/websocket";
import { storage } from "../../src/utils/storage";

jest.mock("../../src/api/client", () => ({
  api: {
    register: jest.fn(),
    login: jest.fn(),
    getCurrentUser: jest.fn(),
    setToken: jest.fn(),
    updateCurrentUser: jest.fn(),
    setSessionExpiredCallback: jest.fn(),
  },
  ApiRequestError: class ApiRequestError extends Error {
    status: number;
    constructor(statusCode: number, message: string) {
      super(message);
      this.status = statusCode;
      this.name = "ApiRequestError";
    }
  },
}));

jest.mock("../../src/api/websocket", () => ({
  gateway: {
    connect: jest.fn(),
    disconnect: jest.fn(),
    sendPresenceUpdate: jest.fn(),
  },
}));

jest.mock("../../src/utils/storage", () => ({
  storage: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
    clear: jest.fn(),
  },
}));

const mockApi = api as jest.Mocked<typeof api>;
const mockGateway = gateway as jest.Mocked<typeof gateway>;
const mockStorage = storage as jest.Mocked<typeof storage>;

function resetStore() {
  useAuthStore.setState({
    user: null,
    isAuthenticated: false,
    isLoading: true,
    error: null,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  resetStore();
});

describe("authStore", () => {
  describe("initial state", () => {
    it("has null user and isLoading=true", () => {
      resetStore();
      const { user, isAuthenticated, isLoading } = useAuthStore.getState();
      expect(user).toBeNull();
      expect(isAuthenticated).toBe(false);
      expect(isLoading).toBe(true);
    });
  });

  describe("login", () => {
    const fakeUser = {
      id: "u1",
      username: "alice",
      email: null,
      avatar_url: null,
      status: "online" as const,
      custom_status: null,
      created_at: "2024-01-01",
    };

    it("sets user and isAuthenticated on success", async () => {
      mockApi.login.mockResolvedValueOnce({
        access_token: "at",
        refresh_token: "rt",
        user: fakeUser,
      });

      await useAuthStore.getState().login({ username: "alice", password: "p" });

      const { user, isAuthenticated, isLoading, error } =
        useAuthStore.getState();
      expect(user).toEqual(fakeUser);
      expect(isAuthenticated).toBe(true);
      expect(isLoading).toBe(false);
      expect(error).toBeNull();
    });

    it("calls gateway.connect with access token", async () => {
      mockApi.login.mockResolvedValueOnce({
        access_token: "at2",
        refresh_token: "rt2",
        user: fakeUser,
      });
      await useAuthStore.getState().login({ username: "alice", password: "p" });
      expect(mockGateway.connect).toHaveBeenCalledWith("at2");
    });

    it("sets error state on failure", async () => {
      mockApi.login.mockRejectedValueOnce(
        new ApiRequestError(401, "Bad credentials"),
      );

      await expect(
        useAuthStore.getState().login({ username: "x", password: "y" }),
      ).rejects.toBeDefined();

      const { error, isLoading } = useAuthStore.getState();
      expect(error).toBe("Bad credentials");
      expect(isLoading).toBe(false);
    });
  });

  describe("register", () => {
    it("sets user and calls gateway.connect on success", async () => {
      const fakeUser = {
        id: "u2",
        username: "bob",
        email: null,
        avatar_url: null,
        status: "online" as const,
        custom_status: null,
        created_at: "2024-01-01",
      };
      mockApi.register.mockResolvedValueOnce({
        access_token: "at3",
        refresh_token: "rt3",
        user: fakeUser,
      });

      await useAuthStore
        .getState()
        .register({ username: "bob", password: "pass" });

      expect(useAuthStore.getState().user).toEqual(fakeUser);
      expect(mockGateway.connect).toHaveBeenCalledWith("at3");
    });

    it("sets error on failure and rethrows", async () => {
      mockApi.register.mockRejectedValueOnce(
        new ApiRequestError(409, "Username taken"),
      );

      await expect(
        useAuthStore.getState().register({ username: "dup", password: "pass" }),
      ).rejects.toBeDefined();

      expect(useAuthStore.getState().error).toBe("Username taken");
    });
  });

  describe("logout", () => {
    it("clears user, token storage, and disconnects gateway", async () => {
      useAuthStore.setState({
        user: { id: "u1" } as never,
        isAuthenticated: true,
      });

      useAuthStore.getState().logout();

      const { user, isAuthenticated } = useAuthStore.getState();
      expect(user).toBeNull();
      expect(isAuthenticated).toBe(false);
      expect(mockStorage.removeItem).toHaveBeenCalledWith(
        "together_access_token",
      );
      expect(mockStorage.removeItem).toHaveBeenCalledWith(
        "together_refresh_token",
      );
      expect(mockApi.setToken).toHaveBeenCalledWith(null);
      expect(mockGateway.disconnect).toHaveBeenCalled();
    });
  });

  describe("restoreSession", () => {
    it("restores user when token is valid", async () => {
      const fakeUser = {
        id: "u3",
        username: "carol",
        email: null,
        avatar_url: null,
        status: "online" as const,
        custom_status: null,
        created_at: "2024-01-01",
      };
      mockStorage.getItem.mockReturnValueOnce("saved-token");
      mockApi.getCurrentUser.mockResolvedValueOnce(fakeUser);

      await useAuthStore.getState().restoreSession();

      const { user, isAuthenticated, isLoading } = useAuthStore.getState();
      expect(user).toEqual(fakeUser);
      expect(isAuthenticated).toBe(true);
      expect(isLoading).toBe(false);
    });

    it("clears state on 401 error", async () => {
      mockStorage.getItem.mockReturnValueOnce("expired-token");
      mockApi.getCurrentUser.mockRejectedValueOnce(
        new ApiRequestError(401, "Unauthorized"),
      );

      await useAuthStore.getState().restoreSession();

      const { user, isAuthenticated, isLoading } = useAuthStore.getState();
      expect(user).toBeNull();
      expect(isAuthenticated).toBe(false);
      expect(isLoading).toBe(false);
    });

    it("sets isLoading=false when no token stored", async () => {
      mockStorage.getItem.mockReturnValueOnce(null);

      await useAuthStore.getState().restoreSession();

      expect(useAuthStore.getState().isLoading).toBe(false);
      expect(mockApi.getCurrentUser).not.toHaveBeenCalled();
    });
  });
});
