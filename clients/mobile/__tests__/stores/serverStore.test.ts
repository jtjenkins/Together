import { useServerStore } from "../../src/stores/serverStore";
import { api, ApiRequestError } from "../../src/api/client";

jest.mock("../../src/api/client", () => ({
  api: {
    listServers: jest.fn(),
    createServer: jest.fn(),
    deleteServer: jest.fn(),
    listMembers: jest.fn(),
    updateServer: jest.fn(),
    joinServer: jest.fn(),
    leaveServer: jest.fn(),
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

const mockApi = api as jest.Mocked<typeof api>;

const fakeServer = {
  id: "srv-1",
  name: "Test Server",
  owner_id: "u1",
  icon_url: null,
  member_count: 5,
  created_at: "2024-01-01",
  updated_at: "2024-01-01",
};

function resetStore() {
  useServerStore.setState({
    servers: [],
    activeServerId: null,
    members: [],
    isLoading: false,
    error: null,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  resetStore();
});

describe("serverStore", () => {
  describe("fetchServers", () => {
    it("populates servers on success", async () => {
      mockApi.listServers.mockResolvedValueOnce([fakeServer]);
      await useServerStore.getState().fetchServers();
      expect(useServerStore.getState().servers).toEqual([fakeServer]);
      expect(useServerStore.getState().isLoading).toBe(false);
    });

    it("sets error on failure", async () => {
      mockApi.listServers.mockRejectedValueOnce(
        new ApiRequestError(500, "Server error"),
      );
      await useServerStore.getState().fetchServers();
      expect(useServerStore.getState().error).toBe("Server error");
      expect(useServerStore.getState().isLoading).toBe(false);
    });
  });

  describe("setActiveServer", () => {
    it("calls fetchMembers when id is provided", async () => {
      mockApi.listMembers.mockResolvedValueOnce([]);
      useServerStore.getState().setActiveServer("srv-1");
      await new Promise((r) => setTimeout(r, 0));
      expect(mockApi.listMembers).toHaveBeenCalledWith("srv-1");
    });

    it("does not call fetchMembers when id is null", () => {
      useServerStore.getState().setActiveServer(null);
      expect(mockApi.listMembers).not.toHaveBeenCalled();
    });
  });

  describe("fetchMembers", () => {
    it("populates members on success", async () => {
      const member = {
        user_id: "u1",
        username: "alice",
        avatar_url: null,
        status: "online" as const,
        nickname: null,
        joined_at: "2024-01-01",
        custom_status: null,
      };
      mockApi.listMembers.mockResolvedValueOnce([member]);
      await useServerStore.getState().fetchMembers("srv-1");
      expect(useServerStore.getState().members).toEqual([member]);
    });

    it("logs error on failure without throwing", async () => {
      const consoleSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      mockApi.listMembers.mockRejectedValueOnce(new Error("Network error"));
      await expect(
        useServerStore.getState().fetchMembers("srv-1"),
      ).resolves.toBeUndefined();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("createServer", () => {
    it("adds the new server to state and returns it", async () => {
      mockApi.createServer.mockResolvedValueOnce(fakeServer);
      const result = await useServerStore
        .getState()
        .createServer({ name: "Test Server" });
      expect(result).toEqual(fakeServer);
      expect(useServerStore.getState().servers).toContainEqual(fakeServer);
    });
  });

  describe("deleteServer", () => {
    it("removes the server from state", async () => {
      useServerStore.setState({ servers: [fakeServer] });
      mockApi.deleteServer.mockResolvedValueOnce(undefined);
      await useServerStore.getState().deleteServer("srv-1");
      expect(useServerStore.getState().servers).toHaveLength(0);
    });
  });
});
