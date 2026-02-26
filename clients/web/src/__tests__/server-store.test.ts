import { describe, it, expect, vi, beforeEach } from "vitest";
import { useServerStore } from "../stores/serverStore";
import { api } from "../api/client";
import type { ServerDto } from "../types";

vi.mock("../api/client", () => ({
  api: {
    listServers: vi.fn(),
    createServer: vi.fn(),
    updateServer: vi.fn(),
    deleteServer: vi.fn(),
    joinServer: vi.fn(),
    leaveServer: vi.fn(),
    listMembers: vi.fn(),
    browseServers: vi.fn(),
  },
  ApiRequestError: class extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

const mockServer = (overrides: Partial<ServerDto> = {}): ServerDto => ({
  id: "server-1",
  name: "Test Server",
  owner_id: "user-1",
  icon_url: null,
  is_public: false,
  member_count: 1,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
  ...overrides,
});

beforeEach(() => {
  useServerStore.setState({
    servers: [],
    activeServerId: null,
    members: [],
    isLoading: false,
    error: null,
    discoverableServers: [],
    isBrowseLoading: false,
    browseError: null,
  });
  vi.clearAllMocks();
});

describe("serverStore", () => {
  describe("fetchServers", () => {
    it("should fetch and store servers", async () => {
      const servers = [mockServer()];
      vi.mocked(api.listServers).mockResolvedValueOnce(servers);

      await useServerStore.getState().fetchServers();

      expect(useServerStore.getState().servers).toEqual(servers);
      expect(useServerStore.getState().isLoading).toBe(false);
    });

    it("should handle fetch error", async () => {
      vi.mocked(api.listServers).mockRejectedValueOnce(
        new Error("Network error"),
      );

      await useServerStore.getState().fetchServers();

      expect(useServerStore.getState().error).toBe("Failed to fetch servers");
    });
  });

  describe("createServer", () => {
    it("should create and add a server", async () => {
      const newServer = mockServer({ id: "server-new" });
      vi.mocked(api.createServer).mockResolvedValueOnce(newServer);

      const result = await useServerStore
        .getState()
        .createServer({ name: "New Server" });

      expect(result).toEqual(newServer);
      expect(useServerStore.getState().servers).toContainEqual(newServer);
    });
  });

  describe("updateServer", () => {
    it("should update a server in the list", async () => {
      useServerStore.setState({ servers: [mockServer()] });
      const updated = mockServer({ name: "Updated Server" });
      vi.mocked(api.updateServer).mockResolvedValueOnce(updated);

      await useServerStore
        .getState()
        .updateServer("server-1", { name: "Updated Server" });

      expect(useServerStore.getState().servers[0].name).toBe("Updated Server");
    });
  });

  describe("deleteServer", () => {
    it("should remove a server from the list", async () => {
      useServerStore.setState({
        servers: [mockServer()],
        activeServerId: "server-1",
      });
      vi.mocked(api.deleteServer).mockResolvedValueOnce(undefined);

      await useServerStore.getState().deleteServer("server-1");

      expect(useServerStore.getState().servers).toHaveLength(0);
      expect(useServerStore.getState().activeServerId).toBeNull();
    });

    it("should not reset activeServerId if different server deleted", async () => {
      useServerStore.setState({
        servers: [mockServer(), mockServer({ id: "server-2" })],
        activeServerId: "server-1",
      });
      vi.mocked(api.deleteServer).mockResolvedValueOnce(undefined);

      await useServerStore.getState().deleteServer("server-2");

      expect(useServerStore.getState().activeServerId).toBe("server-1");
    });
  });

  describe("setActiveServer", () => {
    it("should set active server and clear members", () => {
      vi.mocked(api.listMembers).mockResolvedValueOnce([]);
      useServerStore.setState({
        members: [
          {
            user_id: "u1",
            username: "test",
            avatar_url: null,
            status: "online",
            nickname: null,
            joined_at: "",
          },
        ],
      });

      useServerStore.getState().setActiveServer("server-1");

      expect(useServerStore.getState().activeServerId).toBe("server-1");
      expect(useServerStore.getState().members).toEqual([]);
    });
  });

  describe("leaveServer", () => {
    it("should remove server from list", async () => {
      useServerStore.setState({
        servers: [mockServer()],
        activeServerId: "server-1",
      });
      vi.mocked(api.leaveServer).mockResolvedValueOnce(undefined);

      await useServerStore.getState().leaveServer("server-1");

      expect(useServerStore.getState().servers).toHaveLength(0);
      expect(useServerStore.getState().activeServerId).toBeNull();
    });
  });

  describe("joinServer", () => {
    it("should call api.joinServer with the correct server ID", async () => {
      vi.mocked(api.joinServer).mockResolvedValueOnce({ message: "ok" });
      vi.mocked(api.listServers).mockResolvedValueOnce([]);

      await useServerStore.getState().joinServer("server-1");

      expect(api.joinServer).toHaveBeenCalledWith("server-1");
    });

    it("should call fetchServers after a successful join", async () => {
      const servers = [mockServer()];
      vi.mocked(api.joinServer).mockResolvedValueOnce({ message: "ok" });
      vi.mocked(api.listServers).mockResolvedValueOnce(servers);

      await useServerStore.getState().joinServer("server-1");

      expect(api.listServers).toHaveBeenCalledTimes(1);
      expect(useServerStore.getState().servers).toEqual(servers);
    });

    it("should set error on the store and re-throw on failure", async () => {
      vi.mocked(api.joinServer).mockRejectedValueOnce(
        new Error("Network error"),
      );

      await expect(
        useServerStore.getState().joinServer("server-1"),
      ).rejects.toBeDefined();

      expect(useServerStore.getState().error).toBe("Failed to join server");
    });
  });

  describe("fetchDiscoverableServers", () => {
    it("should populate discoverableServers and clear loading on success", async () => {
      const servers = [mockServer({ id: "s-public", is_public: true })];
      vi.mocked(api.browseServers).mockResolvedValueOnce(servers);

      await useServerStore.getState().fetchDiscoverableServers();

      expect(useServerStore.getState().discoverableServers).toEqual(servers);
      expect(useServerStore.getState().isBrowseLoading).toBe(false);
      expect(useServerStore.getState().browseError).toBeNull();
    });

    it("should set browseError and clear loading on failure", async () => {
      vi.mocked(api.browseServers).mockRejectedValueOnce(new Error("Network"));

      await useServerStore.getState().fetchDiscoverableServers();

      expect(useServerStore.getState().browseError).toBeTruthy();
      expect(useServerStore.getState().isBrowseLoading).toBe(false);
      expect(useServerStore.getState().discoverableServers).toEqual([]);
    });

    it("should extract message from ApiRequestError when browseServers fails", async () => {
      const { ApiRequestError: MockApiRequestError } = await import(
        "../api/client"
      );
      vi.mocked(api.browseServers).mockRejectedValueOnce(
        new MockApiRequestError(500, "Internal Server Error"),
      );

      await useServerStore.getState().fetchDiscoverableServers();

      expect(useServerStore.getState().browseError).toBe(
        "Internal Server Error",
      );
      expect(useServerStore.getState().isBrowseLoading).toBe(false);
    });

    it("should reset browseError to null before fetching", async () => {
      useServerStore.setState({ browseError: "old error" });
      vi.mocked(api.browseServers).mockResolvedValueOnce([]);

      const promise = useServerStore.getState().fetchDiscoverableServers();
      expect(useServerStore.getState().browseError).toBeNull();
      await promise;
    });
  });

  describe("updateMemberPresence", () => {
    it("should update member status", () => {
      useServerStore.setState({
        members: [
          {
            user_id: "u1",
            username: "test",
            avatar_url: null,
            status: "online",
            nickname: null,
            joined_at: "",
          },
        ],
      });

      useServerStore.getState().updateMemberPresence("u1", "away", "BRB");

      expect(useServerStore.getState().members[0].status).toBe("away");
    });
  });
});
