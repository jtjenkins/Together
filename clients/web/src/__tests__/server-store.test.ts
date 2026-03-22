import { describe, it, expect, vi, beforeEach } from "vitest";
import { useServerStore } from "../stores/serverStore";
import { api } from "../api/client";
import type { ServerDto, MemberDto } from "../types";

vi.mock("../stores/customEmojiStore", () => ({
  useCustomEmojiStore: {
    getState: () => ({ loadEmojis: vi.fn() }),
  },
}));

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
    kickMember: vi.fn(),
    banMember: vi.fn(),
    timeoutMember: vi.fn(),
    removeTimeout: vi.fn(),
    acceptInvite: vi.fn(),
    listBans: vi.fn(),
    removeBan: vi.fn(),
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

const mockMember = (overrides: Partial<MemberDto> = {}): MemberDto => ({
  user_id: "u1",
  username: "test",
  avatar_url: null,
  status: "online",
  custom_status: null,
  activity: null,
  nickname: null,
  joined_at: "2024-01-01T00:00:00Z",
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
    bans: [],
    isBansLoading: false,
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

    it("should handle fetch error with generic Error", async () => {
      vi.mocked(api.listServers).mockRejectedValueOnce(
        new Error("Network error"),
      );

      await useServerStore.getState().fetchServers();

      expect(useServerStore.getState().error).toBe("Failed to fetch servers");
      expect(useServerStore.getState().isLoading).toBe(false);
    });

    it("should extract message from ApiRequestError on fetch failure", async () => {
      const { ApiRequestError: MockApiRequestError } = await import(
        "../api/client"
      );
      vi.mocked(api.listServers).mockRejectedValueOnce(
        new MockApiRequestError(500, "Server is down"),
      );

      await useServerStore.getState().fetchServers();

      expect(useServerStore.getState().error).toBe("Server is down");
    });

    it("should set isLoading true before fetching", async () => {
      vi.mocked(api.listServers).mockImplementation(async () => {
        expect(useServerStore.getState().isLoading).toBe(true);
        return [];
      });

      await useServerStore.getState().fetchServers();
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

    it("should set error and re-throw on failure with generic Error", async () => {
      vi.mocked(api.createServer).mockRejectedValueOnce(
        new Error("Network error"),
      );

      await expect(
        useServerStore.getState().createServer({ name: "New" }),
      ).rejects.toBeDefined();

      expect(useServerStore.getState().error).toBe("Failed to create server");
    });

    it("should extract message from ApiRequestError on create failure", async () => {
      const { ApiRequestError: MockApiRequestError } = await import(
        "../api/client"
      );
      vi.mocked(api.createServer).mockRejectedValueOnce(
        new MockApiRequestError(400, "Name taken"),
      );

      await expect(
        useServerStore.getState().createServer({ name: "Dup" }),
      ).rejects.toBeDefined();

      expect(useServerStore.getState().error).toBe("Name taken");
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

    it("should set error and re-throw on update failure with generic Error", async () => {
      vi.mocked(api.updateServer).mockRejectedValueOnce(
        new Error("Network error"),
      );

      await expect(
        useServerStore.getState().updateServer("server-1", { name: "X" }),
      ).rejects.toBeDefined();

      expect(useServerStore.getState().error).toBe("Failed to update server");
    });

    it("should extract message from ApiRequestError on update failure", async () => {
      const { ApiRequestError: MockApiRequestError } = await import(
        "../api/client"
      );
      vi.mocked(api.updateServer).mockRejectedValueOnce(
        new MockApiRequestError(403, "Forbidden"),
      );

      await expect(
        useServerStore.getState().updateServer("server-1", { name: "X" }),
      ).rejects.toBeDefined();

      expect(useServerStore.getState().error).toBe("Forbidden");
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

    it("should set error and re-throw on delete failure with generic Error", async () => {
      vi.mocked(api.deleteServer).mockRejectedValueOnce(
        new Error("Network error"),
      );

      await expect(
        useServerStore.getState().deleteServer("server-1"),
      ).rejects.toBeDefined();

      expect(useServerStore.getState().error).toBe("Failed to delete server");
    });

    it("should extract message from ApiRequestError on delete failure", async () => {
      const { ApiRequestError: MockApiRequestError } = await import(
        "../api/client"
      );
      vi.mocked(api.deleteServer).mockRejectedValueOnce(
        new MockApiRequestError(403, "Not owner"),
      );

      await expect(
        useServerStore.getState().deleteServer("server-1"),
      ).rejects.toBeDefined();

      expect(useServerStore.getState().error).toBe("Not owner");
    });
  });

  describe("setActiveServer", () => {
    it("should set active server and clear members", () => {
      vi.mocked(api.listMembers).mockResolvedValueOnce([]);
      useServerStore.setState({
        members: [mockMember()],
      });

      useServerStore.getState().setActiveServer("server-1");

      expect(useServerStore.getState().activeServerId).toBe("server-1");
      expect(useServerStore.getState().members).toEqual([]);
    });

    it("should not fetchMembers when set to null", () => {
      useServerStore.getState().setActiveServer(null);

      expect(useServerStore.getState().activeServerId).toBeNull();
      expect(api.listMembers).not.toHaveBeenCalled();
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

    it("should not reset activeServerId if leaving a different server", async () => {
      useServerStore.setState({
        servers: [mockServer(), mockServer({ id: "server-2" })],
        activeServerId: "server-1",
      });
      vi.mocked(api.leaveServer).mockResolvedValueOnce(undefined);

      await useServerStore.getState().leaveServer("server-2");

      expect(useServerStore.getState().activeServerId).toBe("server-1");
    });

    it("should set error and re-throw on leave failure", async () => {
      vi.mocked(api.leaveServer).mockRejectedValueOnce(
        new Error("Network error"),
      );

      await expect(
        useServerStore.getState().leaveServer("server-1"),
      ).rejects.toBeDefined();

      expect(useServerStore.getState().error).toBe("Failed to leave server");
    });

    it("should extract message from ApiRequestError on leave failure", async () => {
      const { ApiRequestError: MockApiRequestError } = await import(
        "../api/client"
      );
      vi.mocked(api.leaveServer).mockRejectedValueOnce(
        new MockApiRequestError(403, "Owner cannot leave"),
      );

      await expect(
        useServerStore.getState().leaveServer("server-1"),
      ).rejects.toBeDefined();

      expect(useServerStore.getState().error).toBe("Owner cannot leave");
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

    it("should extract message from ApiRequestError on join failure", async () => {
      const { ApiRequestError: MockApiRequestError } = await import(
        "../api/client"
      );
      vi.mocked(api.joinServer).mockRejectedValueOnce(
        new MockApiRequestError(403, "Banned from server"),
      );

      await expect(
        useServerStore.getState().joinServer("server-1"),
      ).rejects.toBeDefined();

      expect(useServerStore.getState().error).toBe("Banned from server");
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
    it("should update member status, custom_status, and activity", () => {
      useServerStore.setState({
        members: [mockMember()],
      });

      useServerStore
        .getState()
        .updateMemberPresence("u1", "away", "BRB", "Playing a game");

      const member = useServerStore.getState().members[0];
      expect(member.status).toBe("away");
      expect(member.custom_status).toBe("BRB");
      expect(member.activity).toBe("Playing a game");
    });

    it("should not update members with non-matching user_id", () => {
      useServerStore.setState({
        members: [
          mockMember(),
          mockMember({ user_id: "u2", username: "other" }),
        ],
      });

      useServerStore
        .getState()
        .updateMemberPresence("u1", "offline", null, null);

      expect(useServerStore.getState().members[0].status).toBe("offline");
      expect(useServerStore.getState().members[1].status).toBe("online");
    });
  });

  describe("fetchMembers", () => {
    it("should fetch and store members", async () => {
      const members = [mockMember()];
      vi.mocked(api.listMembers).mockResolvedValueOnce(members);

      await useServerStore.getState().fetchMembers("server-1");

      expect(api.listMembers).toHaveBeenCalledWith("server-1");
      expect(useServerStore.getState().members).toEqual(members);
    });

    it("should silently fail on error", async () => {
      vi.mocked(api.listMembers).mockRejectedValueOnce(new Error("fail"));

      await useServerStore.getState().fetchMembers("server-1");

      expect(useServerStore.getState().members).toEqual([]);
      expect(useServerStore.getState().error).toBeNull();
    });
  });

  describe("kickMember", () => {
    it("should remove the kicked member from the list", async () => {
      useServerStore.setState({
        members: [
          mockMember(),
          mockMember({ user_id: "u2", username: "other" }),
        ],
      });
      vi.mocked(api.kickMember).mockResolvedValueOnce(undefined);

      await useServerStore.getState().kickMember("server-1", "u1");

      expect(useServerStore.getState().members).toHaveLength(1);
      expect(useServerStore.getState().members[0].user_id).toBe("u2");
    });

    it("should call api.kickMember with reason when provided", async () => {
      useServerStore.setState({ members: [mockMember()] });
      vi.mocked(api.kickMember).mockResolvedValueOnce(undefined);

      await useServerStore
        .getState()
        .kickMember("server-1", "u1", "Rule violation");

      expect(api.kickMember).toHaveBeenCalledWith("server-1", "u1", {
        reason: "Rule violation",
      });
    });

    it("should call api.kickMember without reason body when no reason", async () => {
      useServerStore.setState({ members: [mockMember()] });
      vi.mocked(api.kickMember).mockResolvedValueOnce(undefined);

      await useServerStore.getState().kickMember("server-1", "u1");

      expect(api.kickMember).toHaveBeenCalledWith("server-1", "u1", undefined);
    });

    it("should set error and re-throw on kick failure with generic Error", async () => {
      vi.mocked(api.kickMember).mockRejectedValueOnce(
        new Error("Network error"),
      );

      await expect(
        useServerStore.getState().kickMember("server-1", "u1"),
      ).rejects.toBeDefined();

      expect(useServerStore.getState().error).toBe("Failed to kick member");
    });

    it("should extract message from ApiRequestError on kick failure", async () => {
      const { ApiRequestError: MockApiRequestError } = await import(
        "../api/client"
      );
      vi.mocked(api.kickMember).mockRejectedValueOnce(
        new MockApiRequestError(403, "Missing permissions"),
      );

      await expect(
        useServerStore.getState().kickMember("server-1", "u1"),
      ).rejects.toBeDefined();

      expect(useServerStore.getState().error).toBe("Missing permissions");
    });
  });

  describe("banMember", () => {
    it("should remove the banned member from the list", async () => {
      useServerStore.setState({
        members: [
          mockMember(),
          mockMember({ user_id: "u2", username: "other" }),
        ],
      });
      vi.mocked(api.banMember).mockResolvedValueOnce(undefined);

      await useServerStore.getState().banMember("server-1", "u1");

      expect(useServerStore.getState().members).toHaveLength(1);
      expect(useServerStore.getState().members[0].user_id).toBe("u2");
    });

    it("should call api.banMember with reason when provided", async () => {
      useServerStore.setState({ members: [mockMember()] });
      vi.mocked(api.banMember).mockResolvedValueOnce(undefined);

      await useServerStore.getState().banMember("server-1", "u1", "Spamming");

      expect(api.banMember).toHaveBeenCalledWith("server-1", "u1", {
        reason: "Spamming",
      });
    });

    it("should call api.banMember without reason body when no reason", async () => {
      useServerStore.setState({ members: [mockMember()] });
      vi.mocked(api.banMember).mockResolvedValueOnce(undefined);

      await useServerStore.getState().banMember("server-1", "u1");

      expect(api.banMember).toHaveBeenCalledWith("server-1", "u1", undefined);
    });

    it("should set error and re-throw on ban failure with generic Error", async () => {
      vi.mocked(api.banMember).mockRejectedValueOnce(
        new Error("Network error"),
      );

      await expect(
        useServerStore.getState().banMember("server-1", "u1"),
      ).rejects.toBeDefined();

      expect(useServerStore.getState().error).toBe("Failed to ban member");
    });

    it("should extract message from ApiRequestError on ban failure", async () => {
      const { ApiRequestError: MockApiRequestError } = await import(
        "../api/client"
      );
      vi.mocked(api.banMember).mockRejectedValueOnce(
        new MockApiRequestError(403, "Cannot ban owner"),
      );

      await expect(
        useServerStore.getState().banMember("server-1", "u1"),
      ).rejects.toBeDefined();

      expect(useServerStore.getState().error).toBe("Cannot ban owner");
    });
  });

  describe("timeoutMember", () => {
    it("should call api.timeoutMember with correct payload", async () => {
      vi.mocked(api.timeoutMember).mockResolvedValueOnce(undefined);

      await useServerStore
        .getState()
        .timeoutMember("server-1", "u1", 30, "Warning");

      expect(api.timeoutMember).toHaveBeenCalledWith("server-1", "u1", {
        duration_minutes: 30,
        reason: "Warning",
      });
    });

    it("should call api.timeoutMember without reason when not provided", async () => {
      vi.mocked(api.timeoutMember).mockResolvedValueOnce(undefined);

      await useServerStore.getState().timeoutMember("server-1", "u1", 10);

      expect(api.timeoutMember).toHaveBeenCalledWith("server-1", "u1", {
        duration_minutes: 10,
        reason: undefined,
      });
    });

    it("should set error and re-throw on timeout failure with generic Error", async () => {
      vi.mocked(api.timeoutMember).mockRejectedValueOnce(
        new Error("Network error"),
      );

      await expect(
        useServerStore.getState().timeoutMember("server-1", "u1", 30),
      ).rejects.toBeDefined();

      expect(useServerStore.getState().error).toBe("Failed to timeout member");
    });

    it("should extract message from ApiRequestError on timeout failure", async () => {
      const { ApiRequestError: MockApiRequestError } = await import(
        "../api/client"
      );
      vi.mocked(api.timeoutMember).mockRejectedValueOnce(
        new MockApiRequestError(403, "Not allowed"),
      );

      await expect(
        useServerStore.getState().timeoutMember("server-1", "u1", 10),
      ).rejects.toBeDefined();

      expect(useServerStore.getState().error).toBe("Not allowed");
    });
  });

  describe("removeTimeout", () => {
    it("should clear timeout_expires_at for the member", async () => {
      useServerStore.setState({
        members: [mockMember({ timeout_expires_at: "2024-12-31T23:59:59Z" })],
      });
      vi.mocked(api.removeTimeout).mockResolvedValueOnce(undefined);

      await useServerStore.getState().removeTimeout("server-1", "u1");

      expect(api.removeTimeout).toHaveBeenCalledWith("server-1", "u1");
      expect(
        useServerStore.getState().members[0].timeout_expires_at,
      ).toBeNull();
    });

    it("should not modify other members", async () => {
      useServerStore.setState({
        members: [
          mockMember({ timeout_expires_at: "2024-12-31T23:59:59Z" }),
          mockMember({
            user_id: "u2",
            username: "other",
            timeout_expires_at: "2025-01-01T00:00:00Z",
          }),
        ],
      });
      vi.mocked(api.removeTimeout).mockResolvedValueOnce(undefined);

      await useServerStore.getState().removeTimeout("server-1", "u1");

      expect(useServerStore.getState().members[1].timeout_expires_at).toBe(
        "2025-01-01T00:00:00Z",
      );
    });

    it("should set error and re-throw on failure with generic Error", async () => {
      vi.mocked(api.removeTimeout).mockRejectedValueOnce(
        new Error("Network error"),
      );

      await expect(
        useServerStore.getState().removeTimeout("server-1", "u1"),
      ).rejects.toBeDefined();

      expect(useServerStore.getState().error).toBe("Failed to remove timeout");
    });

    it("should extract message from ApiRequestError on failure", async () => {
      const { ApiRequestError: MockApiRequestError } = await import(
        "../api/client"
      );
      vi.mocked(api.removeTimeout).mockRejectedValueOnce(
        new MockApiRequestError(404, "User not found"),
      );

      await expect(
        useServerStore.getState().removeTimeout("server-1", "u1"),
      ).rejects.toBeDefined();

      expect(useServerStore.getState().error).toBe("User not found");
    });
  });

  describe("removeMemberLocally", () => {
    it("should remove a member from the list by user_id", () => {
      useServerStore.setState({
        members: [
          mockMember(),
          mockMember({ user_id: "u2", username: "other" }),
        ],
      });

      useServerStore.getState().removeMemberLocally("u1");

      expect(useServerStore.getState().members).toHaveLength(1);
      expect(useServerStore.getState().members[0].user_id).toBe("u2");
    });

    it("should handle removing non-existent member gracefully", () => {
      useServerStore.setState({ members: [mockMember()] });

      useServerStore.getState().removeMemberLocally("non-existent");

      expect(useServerStore.getState().members).toHaveLength(1);
    });
  });

  describe("setMemberTimeout", () => {
    it("should set timeout_expires_at for a specific member", () => {
      useServerStore.setState({ members: [mockMember()] });

      useServerStore.getState().setMemberTimeout("u1", "2024-12-31T23:59:59Z");

      expect(useServerStore.getState().members[0].timeout_expires_at).toBe(
        "2024-12-31T23:59:59Z",
      );
    });

    it("should set timeout_expires_at to null", () => {
      useServerStore.setState({
        members: [mockMember({ timeout_expires_at: "2024-12-31T23:59:59Z" })],
      });

      useServerStore.getState().setMemberTimeout("u1", null);

      expect(
        useServerStore.getState().members[0].timeout_expires_at,
      ).toBeNull();
    });

    it("should not modify other members", () => {
      useServerStore.setState({
        members: [
          mockMember(),
          mockMember({ user_id: "u2", username: "other" }),
        ],
      });

      useServerStore.getState().setMemberTimeout("u1", "2024-12-31T23:59:59Z");

      expect(
        useServerStore.getState().members[1].timeout_expires_at,
      ).toBeUndefined();
    });
  });

  describe("joinServerByInvite", () => {
    it("should call acceptInvite and then fetchServers", async () => {
      const servers = [mockServer()];
      vi.mocked(api.acceptInvite).mockResolvedValueOnce({
        message: "ok",
        server_id: "server-1",
      });
      vi.mocked(api.listServers).mockResolvedValueOnce(servers);

      await useServerStore.getState().joinServerByInvite("abc123");

      expect(api.acceptInvite).toHaveBeenCalledWith("abc123");
      expect(api.listServers).toHaveBeenCalledTimes(1);
      expect(useServerStore.getState().servers).toEqual(servers);
    });

    it("should set error and re-throw on failure with generic Error", async () => {
      vi.mocked(api.acceptInvite).mockRejectedValueOnce(
        new Error("Invalid invite"),
      );

      await expect(
        useServerStore.getState().joinServerByInvite("bad-code"),
      ).rejects.toBeDefined();

      expect(useServerStore.getState().error).toBe(
        "Failed to join server via invite",
      );
    });

    it("should extract message from ApiRequestError on failure", async () => {
      const { ApiRequestError: MockApiRequestError } = await import(
        "../api/client"
      );
      vi.mocked(api.acceptInvite).mockRejectedValueOnce(
        new MockApiRequestError(404, "Invite expired"),
      );

      await expect(
        useServerStore.getState().joinServerByInvite("expired"),
      ).rejects.toBeDefined();

      expect(useServerStore.getState().error).toBe("Invite expired");
    });
  });

  describe("fetchBans", () => {
    it("should fetch and store bans", async () => {
      const bans = [
        {
          user_id: "u1",
          server_id: "server-1",
          banned_by: "admin-1",
          reason: "Spamming",
          created_at: "2024-01-01T00:00:00Z",
        },
      ];
      vi.mocked(api.listBans).mockResolvedValueOnce(bans);

      await useServerStore.getState().fetchBans("server-1");

      expect(api.listBans).toHaveBeenCalledWith("server-1");
      expect(useServerStore.getState().bans).toEqual(bans);
      expect(useServerStore.getState().isBansLoading).toBe(false);
    });

    it("should set isBansLoading true before fetching", async () => {
      vi.mocked(api.listBans).mockImplementation(async () => {
        expect(useServerStore.getState().isBansLoading).toBe(true);
        return [];
      });

      await useServerStore.getState().fetchBans("server-1");
    });

    it("should set error and re-throw on failure with generic Error", async () => {
      vi.mocked(api.listBans).mockRejectedValueOnce(new Error("Network error"));

      await expect(
        useServerStore.getState().fetchBans("server-1"),
      ).rejects.toBeDefined();

      expect(useServerStore.getState().error).toBe("Failed to fetch bans");
      expect(useServerStore.getState().isBansLoading).toBe(false);
    });

    it("should extract message from ApiRequestError on failure", async () => {
      const { ApiRequestError: MockApiRequestError } = await import(
        "../api/client"
      );
      vi.mocked(api.listBans).mockRejectedValueOnce(
        new MockApiRequestError(403, "No permission"),
      );

      await expect(
        useServerStore.getState().fetchBans("server-1"),
      ).rejects.toBeDefined();

      expect(useServerStore.getState().error).toBe("No permission");
    });
  });

  describe("unbanMember", () => {
    it("should remove the ban from the list", async () => {
      useServerStore.setState({
        bans: [
          {
            user_id: "u1",
            server_id: "server-1",
            banned_by: "admin-1",
            reason: null,
            created_at: "2024-01-01T00:00:00Z",
          },
          {
            user_id: "u2",
            server_id: "server-1",
            banned_by: "admin-1",
            reason: null,
            created_at: "2024-01-01T00:00:00Z",
          },
        ],
      });
      vi.mocked(api.removeBan).mockResolvedValueOnce(undefined);

      await useServerStore.getState().unbanMember("server-1", "u1");

      expect(api.removeBan).toHaveBeenCalledWith("server-1", "u1");
      expect(useServerStore.getState().bans).toHaveLength(1);
      expect(useServerStore.getState().bans[0].user_id).toBe("u2");
    });

    it("should set error and re-throw on failure with generic Error", async () => {
      vi.mocked(api.removeBan).mockRejectedValueOnce(
        new Error("Network error"),
      );

      await expect(
        useServerStore.getState().unbanMember("server-1", "u1"),
      ).rejects.toBeDefined();

      expect(useServerStore.getState().error).toBe("Failed to unban user");
    });

    it("should extract message from ApiRequestError on failure", async () => {
      const { ApiRequestError: MockApiRequestError } = await import(
        "../api/client"
      );
      vi.mocked(api.removeBan).mockRejectedValueOnce(
        new MockApiRequestError(404, "Ban not found"),
      );

      await expect(
        useServerStore.getState().unbanMember("server-1", "u1"),
      ).rejects.toBeDefined();

      expect(useServerStore.getState().error).toBe("Ban not found");
    });
  });

  describe("clearError", () => {
    it("should clear the error", () => {
      useServerStore.setState({ error: "Some error" });

      useServerStore.getState().clearError();

      expect(useServerStore.getState().error).toBeNull();
    });
  });

  describe("setServers", () => {
    it("should replace the servers list", () => {
      const servers = [mockServer(), mockServer({ id: "server-2" })];

      useServerStore.getState().setServers(servers);

      expect(useServerStore.getState().servers).toEqual(servers);
    });
  });
});
