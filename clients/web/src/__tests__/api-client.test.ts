import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api, ApiRequestError } from "../api/client";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

/** Shorthand to create a mock Response with ok:true */
function okJson(data: unknown, status = 200) {
  return { ok: true, status, json: () => Promise.resolve(data) };
}

/** Shorthand to create a 204 No Content response */
function ok204() {
  return { ok: true, status: 204 };
}

/** Shorthand to create a mock error Response */
function errJson(status: number, error: string) {
  return { ok: false, status, json: () => Promise.resolve({ error }) };
}

beforeEach(() => {
  mockFetch.mockReset();
  api.setToken(null);
  localStorage.clear();
  // Ensure apiBase is set for all tests
  api.setServerUrl("http://test.local");
});

describe("ApiClient", () => {
  // ─── Authentication ────────────────────────────────────────────────────────

  describe("authentication", () => {
    it("should send register request", async () => {
      const authResponse = {
        access_token: "access-123",
        refresh_token: "refresh-123",
        user: {
          id: "user-1",
          username: "testuser",
          email: null,
          avatar_url: null,
          status: "online",
          custom_status: null,
          created_at: "2024-01-01T00:00:00Z",
        },
      };

      mockFetch.mockResolvedValueOnce(okJson(authResponse, 201));

      const result = await api.register({
        username: "testuser",
        password: "password123",
      });

      expect(result).toEqual(authResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/auth/register"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            username: "testuser",
            password: "password123",
          }),
        }),
      );
    });

    it("should send login request", async () => {
      const authResponse = {
        access_token: "access-456",
        refresh_token: "refresh-456",
        user: {
          id: "user-1",
          username: "testuser",
          email: null,
          avatar_url: null,
          status: "online",
          custom_status: null,
          created_at: "2024-01-01T00:00:00Z",
        },
      };

      mockFetch.mockResolvedValueOnce(okJson(authResponse));

      const result = await api.login({
        username: "testuser",
        password: "password123",
      });

      expect(result).toEqual(authResponse);
    });

    it("should include auth header when token is set", async () => {
      api.setToken("my-token");

      mockFetch.mockResolvedValueOnce(okJson([]));

      await api.listServers();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer my-token",
          }),
        }),
      );
    });

    it("should not include auth header when no token", async () => {
      mockFetch.mockResolvedValueOnce(okJson([]));

      await api.listServers();

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers.Authorization).toBeUndefined();
    });

    it("getToken returns the current token", () => {
      expect(api.getToken()).toBeNull();
      api.setToken("tok-1");
      expect(api.getToken()).toBe("tok-1");
    });
  });

  // ─── Token refresh ──────────────────────────────────────────────────────────

  describe("token refresh on 401", () => {
    it("should silently refresh and retry when a request returns 401", async () => {
      api.setToken("expired-token");
      localStorage.setItem("together_refresh_token", "refresh-abc");

      // First call: 401
      mockFetch.mockResolvedValueOnce(errJson(401, "Token expired"));
      // Refresh call: success
      mockFetch.mockResolvedValueOnce(
        okJson({
          access_token: "new-access",
          refresh_token: "new-refresh",
          user: { id: "u1" },
        }),
      );
      // Retry call: success
      mockFetch.mockResolvedValueOnce(okJson([{ id: "server-1" }]));

      const result = await api.listServers();

      expect(result).toEqual([{ id: "server-1" }]);
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(api.getToken()).toBe("new-access");
      expect(localStorage.getItem("together_access_token")).toBe("new-access");
      expect(localStorage.getItem("together_refresh_token")).toBe(
        "new-refresh",
      );
    });

    it("should not retry if no refresh token is stored", async () => {
      api.setToken("expired-token");
      // No refresh token in localStorage

      mockFetch.mockResolvedValueOnce(errJson(401, "Token expired"));

      await expect(api.listServers()).rejects.toThrow(ApiRequestError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should fire sessionExpired callback when refresh returns 401", async () => {
      const sessionExpiredCb = vi.fn();
      api.setSessionExpiredCallback(sessionExpiredCb);
      api.setToken("expired-token");
      localStorage.setItem("together_refresh_token", "dead-refresh");

      // Original call: 401
      mockFetch.mockResolvedValueOnce(errJson(401, "Token expired"));
      // Refresh call: also 401 (session dead)
      mockFetch.mockResolvedValueOnce(errJson(401, "Refresh token invalid"));

      await expect(api.listServers()).rejects.toThrow(ApiRequestError);
      expect(sessionExpiredCb).toHaveBeenCalledTimes(1);
    });

    it("should not fire sessionExpired on network error during refresh", async () => {
      const sessionExpiredCb = vi.fn();
      api.setSessionExpiredCallback(sessionExpiredCb);
      api.setToken("expired-token");
      localStorage.setItem("together_refresh_token", "some-refresh");

      // Original call: 401
      mockFetch.mockResolvedValueOnce(errJson(401, "Token expired"));
      // Refresh call: network failure
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      await expect(api.listServers()).rejects.toThrow(ApiRequestError);
      expect(sessionExpiredCb).not.toHaveBeenCalled();
    });

    it("should not infinite-loop refresh (skipRefresh on retry)", async () => {
      api.setToken("expired-token");
      localStorage.setItem("together_refresh_token", "refresh-tok");

      // Original call: 401
      mockFetch.mockResolvedValueOnce(errJson(401, "Token expired"));
      // Refresh succeeds
      mockFetch.mockResolvedValueOnce(
        okJson({
          access_token: "new-access",
          refresh_token: "new-refresh",
          user: { id: "u1" },
        }),
      );
      // Retry still returns 401 — should NOT trigger another refresh
      mockFetch.mockResolvedValueOnce(errJson(401, "Still expired"));

      await expect(api.listServers()).rejects.toThrow(ApiRequestError);
      // Should be exactly 3 calls: original, refresh, retry
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  // ─── Error handling ─────────────────────────────────────────────────────────

  describe("error handling", () => {
    it("should throw ApiRequestError on non-ok response", async () => {
      mockFetch.mockResolvedValueOnce(errJson(401, "Invalid credentials"));

      await expect(
        api.login({ username: "bad", password: "bad" }),
      ).rejects.toThrow(ApiRequestError);
    });

    it("should handle json parse failure gracefully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error("Invalid JSON")),
      });

      await expect(api.listServers()).rejects.toThrow("Unknown error");
    });

    it("ApiRequestError has correct name and status", () => {
      const err = new ApiRequestError(404, "Not found");
      expect(err.name).toBe("ApiRequestError");
      expect(err.status).toBe(404);
      expect(err.message).toBe("Not found");
      expect(err).toBeInstanceOf(Error);
    });

    it("should use 'Request failed' when error body has no error field", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: () => Promise.resolve({}),
      });

      await expect(api.listServers()).rejects.toThrow("Request failed");
    });
  });

  // ─── setServerUrl ───────────────────────────────────────────────────────────

  describe("setServerUrl", () => {
    afterEach(() => {
      localStorage.clear();
    });

    it("should update the URL used for subsequent requests", async () => {
      api.setServerUrl("http://myserver.example.com");

      mockFetch.mockResolvedValueOnce(okJson([]));

      await api.listServers();

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("http://myserver.example.com/api");
    });

    it("should persist the URL to localStorage", () => {
      api.setServerUrl("http://myserver.example.com");
      expect(localStorage.getItem("server_url")).toBe(
        "http://myserver.example.com",
      );
    });

    it("should also update the URL used for file attachments", () => {
      api.setServerUrl("http://myserver.example.com");
      const url = api.fileUrl("/uploads/abc.png");
      expect(url).toBe("http://myserver.example.com/api/uploads/abc.png");
    });

    it("should throw TypeError for an invalid URL string", () => {
      expect(() => api.setServerUrl("not-a-url")).toThrow(TypeError);
    });
  });

  // ─── Users ──────────────────────────────────────────────────────────────────

  describe("users", () => {
    beforeEach(() => {
      api.setToken("test-token");
    });

    it("should get current user", async () => {
      const user = {
        id: "user-1",
        username: "testuser",
        email: null,
        avatar_url: null,
        status: "online",
        custom_status: null,
        created_at: "2024-01-01T00:00:00Z",
      };

      mockFetch.mockResolvedValueOnce(okJson(user));

      const result = await api.getCurrentUser();
      expect(result).toEqual(user);
      expect(mockFetch.mock.calls[0][0]).toContain("/users/@me");
    });

    it("should update current user", async () => {
      const updated = {
        id: "user-1",
        username: "testuser",
        email: null,
        avatar_url: "https://example.com/avatar.png",
        status: "online",
        custom_status: "Coding",
        created_at: "2024-01-01T00:00:00Z",
      };

      mockFetch.mockResolvedValueOnce(okJson(updated));

      const result = await api.updateCurrentUser({
        avatar_url: "https://example.com/avatar.png",
        custom_status: "Coding",
      });

      expect(result.avatar_url).toBe("https://example.com/avatar.png");
      expect(result.custom_status).toBe("Coding");
      expect(mockFetch.mock.calls[0][1].method).toBe("PATCH");
    });

    it("should get a user profile by ID", async () => {
      const profile = {
        id: "user-2",
        username: "otheruser",
        avatar_url: null,
        status: "offline",
        custom_status: null,
      };
      mockFetch.mockResolvedValueOnce(okJson(profile));

      const result = await api.getUserProfile("user-2");
      expect(result).toEqual(profile);
      expect(mockFetch.mock.calls[0][0]).toContain("/users/user-2");
    });
  });

  // ─── Servers ────────────────────────────────────────────────────────────────

  describe("servers", () => {
    beforeEach(() => {
      api.setToken("test-token");
    });

    it("should create a server", async () => {
      const server = {
        id: "server-1",
        name: "Test Server",
        owner_id: "user-1",
        icon_url: null,
        member_count: 1,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      };

      mockFetch.mockResolvedValueOnce(okJson(server, 201));

      const result = await api.createServer({ name: "Test Server" });
      expect(result).toEqual(server);
    });

    it("should list servers", async () => {
      mockFetch.mockResolvedValueOnce(okJson([]));

      const result = await api.listServers();
      expect(result).toEqual([]);
    });

    it("should get a single server", async () => {
      const server = { id: "s1", name: "My Server" };
      mockFetch.mockResolvedValueOnce(okJson(server));

      const result = await api.getServer("s1");
      expect(result).toEqual(server);
      expect(mockFetch.mock.calls[0][0]).toContain("/servers/s1");
    });

    it("should update a server", async () => {
      const server = { id: "s1", name: "Renamed" };
      mockFetch.mockResolvedValueOnce(okJson(server));

      const result = await api.updateServer("s1", { name: "Renamed" });
      expect(result.name).toBe("Renamed");
      expect(mockFetch.mock.calls[0][1].method).toBe("PATCH");
    });

    it("should delete a server (204 response)", async () => {
      mockFetch.mockResolvedValueOnce(ok204());

      const result = await api.deleteServer("server-1");
      expect(result).toBeUndefined();
    });

    it("should join a server", async () => {
      mockFetch.mockResolvedValueOnce(
        okJson({ message: "Joined server" }, 201),
      );

      const result = await api.joinServer("server-1");
      expect(result).toEqual({ message: "Joined server" });
      expect(mockFetch.mock.calls[0][1].method).toBe("POST");
    });

    it("should leave a server", async () => {
      mockFetch.mockResolvedValueOnce(ok204());

      const result = await api.leaveServer("s1");
      expect(result).toBeUndefined();
      expect(mockFetch.mock.calls[0][1].method).toBe("DELETE");
      expect(mockFetch.mock.calls[0][0]).toContain("/servers/s1/leave");
    });

    it("should browse servers", async () => {
      mockFetch.mockResolvedValueOnce(okJson([{ id: "s1" }]));

      const result = await api.browseServers();
      expect(result).toEqual([{ id: "s1" }]);
      expect(mockFetch.mock.calls[0][0]).toContain("/servers/browse");
    });

    it("should list templates", async () => {
      mockFetch.mockResolvedValueOnce(okJson([{ id: "t1", name: "Gaming" }]));

      const result = await api.listTemplates();
      expect(result).toEqual([{ id: "t1", name: "Gaming" }]);
      expect(mockFetch.mock.calls[0][0]).toContain("/server-templates");
    });

    it("should list members", async () => {
      mockFetch.mockResolvedValueOnce(okJson([{ user_id: "u1" }]));

      const result = await api.listMembers("s1");
      expect(result).toEqual([{ user_id: "u1" }]);
      expect(mockFetch.mock.calls[0][0]).toContain("/servers/s1/members");
    });
  });

  // ─── Channels ───────────────────────────────────────────────────────────────

  describe("channels", () => {
    beforeEach(() => {
      api.setToken("test-token");
    });

    it("should list channels for a server", async () => {
      const channels = [{ id: "ch-1", name: "general" }];
      mockFetch.mockResolvedValueOnce(okJson(channels));

      const result = await api.listChannels("server-1");
      expect(result).toEqual(channels);
    });

    it("should create a channel", async () => {
      const channel = { id: "ch-2", name: "random", type: "text" };
      mockFetch.mockResolvedValueOnce(okJson(channel, 201));

      const result = await api.createChannel("server-1", {
        name: "random",
        type: "text",
      });
      expect(result).toEqual(channel);
      expect(mockFetch.mock.calls[0][1].method).toBe("POST");
    });

    it("should get a single channel", async () => {
      const channel = { id: "ch-1", name: "general" };
      mockFetch.mockResolvedValueOnce(okJson(channel));

      const result = await api.getChannel("s1", "ch-1");
      expect(result).toEqual(channel);
      expect(mockFetch.mock.calls[0][0]).toContain("/servers/s1/channels/ch-1");
    });

    it("should update a channel", async () => {
      const channel = { id: "ch-1", name: "updated", topic: "new topic" };
      mockFetch.mockResolvedValueOnce(okJson(channel));

      const result = await api.updateChannel("s1", "ch-1", {
        name: "updated",
        topic: "new topic",
      });
      expect(result.name).toBe("updated");
      expect(mockFetch.mock.calls[0][1].method).toBe("PATCH");
    });

    it("should delete a channel", async () => {
      mockFetch.mockResolvedValueOnce(ok204());

      const result = await api.deleteChannel("s1", "ch-1");
      expect(result).toBeUndefined();
      expect(mockFetch.mock.calls[0][1].method).toBe("DELETE");
    });
  });

  // ─── Messages ───────────────────────────────────────────────────────────────

  describe("messages", () => {
    beforeEach(() => {
      api.setToken("test-token");
    });

    it("should list messages with pagination params", async () => {
      mockFetch.mockResolvedValueOnce(okJson([]));

      await api.listMessages("ch-1", { before: "msg-10", limit: 25 });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("before=msg-10");
      expect(url).toContain("limit=25");
    });

    it("should list messages without query params", async () => {
      mockFetch.mockResolvedValueOnce(okJson([]));

      await api.listMessages("ch-1");

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("/channels/ch-1/messages");
      expect(url).not.toContain("?");
    });

    it("should get a single message", async () => {
      const msg = { id: "msg-1", content: "Hello" };
      mockFetch.mockResolvedValueOnce(okJson(msg));

      const result = await api.getMessage("ch-1", "msg-1");
      expect(result).toEqual(msg);
      expect(mockFetch.mock.calls[0][0]).toContain(
        "/channels/ch-1/messages/msg-1",
      );
    });

    it("should send a message", async () => {
      const message = { id: "msg-1", content: "Hello!" };
      mockFetch.mockResolvedValueOnce(okJson(message, 201));

      const result = await api.createMessage("ch-1", { content: "Hello!" });
      expect(result).toEqual(message);
    });

    it("should update a message", async () => {
      const updated = {
        id: "msg-1",
        content: "Updated!",
        edited_at: "2024-01-01T00:01:00Z",
      };
      mockFetch.mockResolvedValueOnce(okJson(updated));

      const result = await api.updateMessage("msg-1", { content: "Updated!" });
      expect(result.content).toBe("Updated!");
      expect(result.edited_at).not.toBeNull();
    });

    it("should delete a message", async () => {
      mockFetch.mockResolvedValueOnce(ok204());

      const result = await api.deleteMessage("msg-1");
      expect(result).toBeUndefined();
    });
  });

  // ─── Voice ──────────────────────────────────────────────────────────────────

  describe("voice", () => {
    beforeEach(() => {
      api.setToken("test-token");
    });

    it("should join a voice channel", async () => {
      const participant = { user_id: "u1", channel_id: "ch-1" };
      mockFetch.mockResolvedValueOnce(okJson(participant, 201));

      const result = await api.joinVoiceChannel("ch-1");
      expect(result).toEqual(participant);
      expect(mockFetch.mock.calls[0][1].method).toBe("POST");
      expect(mockFetch.mock.calls[0][0]).toContain("/channels/ch-1/voice");
    });

    it("should leave a voice channel", async () => {
      mockFetch.mockResolvedValueOnce(ok204());

      const result = await api.leaveVoiceChannel("ch-1");
      expect(result).toBeUndefined();
      expect(mockFetch.mock.calls[0][1].method).toBe("DELETE");
    });

    it("should update voice state", async () => {
      const participant = { user_id: "u1", is_muted: true };
      mockFetch.mockResolvedValueOnce(okJson(participant));

      const result = await api.updateVoiceState("ch-1", { self_mute: true });
      expect(result).toEqual(participant);
      expect(mockFetch.mock.calls[0][1].method).toBe("PATCH");
    });

    it("should list voice participants", async () => {
      mockFetch.mockResolvedValueOnce(okJson([{ user_id: "u1" }]));

      const result = await api.listVoiceParticipants("ch-1");
      expect(result).toEqual([{ user_id: "u1" }]);
    });
  });

  // ─── Go Live ────────────────────────────────────────────────────────────────

  describe("go live", () => {
    beforeEach(() => {
      api.setToken("test-token");
    });

    it("should start go live", async () => {
      const session = { id: "gl-1", channel_id: "ch-1" };
      mockFetch.mockResolvedValueOnce(okJson(session, 201));

      const result = await api.startGoLive("ch-1", { quality: "720p" });
      expect(result).toEqual(session);
      expect(mockFetch.mock.calls[0][0]).toContain("/channels/ch-1/go-live");
      expect(mockFetch.mock.calls[0][1].method).toBe("POST");
    });

    it("should stop go live", async () => {
      mockFetch.mockResolvedValueOnce(ok204());

      const result = await api.stopGoLive("ch-1");
      expect(result).toBeUndefined();
      expect(mockFetch.mock.calls[0][1].method).toBe("DELETE");
    });

    it("should get go live session", async () => {
      const session = { id: "gl-1" };
      mockFetch.mockResolvedValueOnce(okJson(session));

      const result = await api.getGoLive("ch-1");
      expect(result).toEqual(session);
    });
  });

  // ─── Attachments ────────────────────────────────────────────────────────────

  describe("attachments", () => {
    beforeEach(() => {
      api.setToken("test-token");
    });

    it("should upload attachments with FormData (skipContentType)", async () => {
      const attachments = [{ id: "a1", filename: "file.png" }];
      mockFetch.mockResolvedValueOnce(okJson(attachments, 201));

      const file = new File(["data"], "file.png", { type: "image/png" });
      const result = await api.uploadAttachments("msg-1", [file]);

      expect(result).toEqual(attachments);
      expect(mockFetch.mock.calls[0][1].method).toBe("POST");
      // Should NOT have Content-Type header (browser sets it with boundary)
      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers["Content-Type"]).toBeUndefined();
    });

    it("should list attachments", async () => {
      mockFetch.mockResolvedValueOnce(okJson([]));

      const result = await api.listAttachments("msg-1");
      expect(result).toEqual([]);
      expect(mockFetch.mock.calls[0][0]).toContain(
        "/messages/msg-1/attachments",
      );
    });

    it("fileUrl returns the correct URL path", () => {
      api.setServerUrl("http://myserver.com");
      expect(api.fileUrl("/uploads/pic.jpg")).toBe(
        "http://myserver.com/api/uploads/pic.jpg",
      );
    });
  });

  // ─── Read States ────────────────────────────────────────────────────────────

  describe("read states", () => {
    beforeEach(() => {
      api.setToken("test-token");
    });

    it("should acknowledge a channel", async () => {
      mockFetch.mockResolvedValueOnce(ok204());

      const result = await api.ackChannel("ch-1");
      expect(result).toBeUndefined();
      expect(mockFetch.mock.calls[0][1].method).toBe("POST");
      expect(mockFetch.mock.calls[0][0]).toContain("/channels/ch-1/ack");
    });
  });

  // ─── Direct Messages ───────────────────────────────────────────────────────

  describe("direct messages", () => {
    beforeEach(() => {
      api.setToken("test-token");
    });

    it("should open a DM channel", async () => {
      const dmChannel = { id: "dm-1", user_id: "u2" };
      mockFetch.mockResolvedValueOnce(okJson(dmChannel, 201));

      const result = await api.openDmChannel("u2");
      expect(result).toEqual(dmChannel);
      expect(mockFetch.mock.calls[0][0]).toContain("/dm-channels");
      expect(mockFetch.mock.calls[0][1].method).toBe("POST");
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
        user_id: "u2",
      });
    });

    it("should list DM channels", async () => {
      mockFetch.mockResolvedValueOnce(okJson([]));

      const result = await api.listDmChannels();
      expect(result).toEqual([]);
    });

    it("should send a DM message", async () => {
      const msg = { id: "dm-msg-1", content: "Hi!" };
      mockFetch.mockResolvedValueOnce(okJson(msg, 201));

      const result = await api.sendDmMessage("dm-1", "Hi!");
      expect(result).toEqual(msg);
      expect(mockFetch.mock.calls[0][0]).toContain(
        "/dm-channels/dm-1/messages",
      );
    });

    it("should list DM messages with query params", async () => {
      mockFetch.mockResolvedValueOnce(okJson([]));

      await api.listDmMessages("dm-1", { before: "msg-5", limit: 10 });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("before=msg-5");
      expect(url).toContain("limit=10");
    });

    it("should list DM messages without query params", async () => {
      mockFetch.mockResolvedValueOnce(okJson([]));

      await api.listDmMessages("dm-1");

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).not.toContain("?");
    });

    it("should acknowledge a DM channel", async () => {
      mockFetch.mockResolvedValueOnce(ok204());

      const result = await api.ackDmChannel("dm-1");
      expect(result).toBeUndefined();
      expect(mockFetch.mock.calls[0][0]).toContain("/dm-channels/dm-1/ack");
    });
  });

  // ─── Threads ────────────────────────────────────────────────────────────────

  describe("threads", () => {
    beforeEach(() => {
      api.setToken("test-token");
    });

    it("should list thread replies with pagination", async () => {
      mockFetch.mockResolvedValueOnce(okJson([]));

      await api.listThreadReplies("ch-1", "msg-1", {
        before: "reply-5",
        limit: 20,
      });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("/channels/ch-1/messages/msg-1/thread");
      expect(url).toContain("before=reply-5");
      expect(url).toContain("limit=20");
    });

    it("should list thread replies without pagination", async () => {
      mockFetch.mockResolvedValueOnce(okJson([]));

      await api.listThreadReplies("ch-1", "msg-1");

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).not.toContain("?");
    });

    it("should create a thread reply", async () => {
      const reply = { id: "reply-1", content: "reply text" };
      mockFetch.mockResolvedValueOnce(okJson(reply, 201));

      const result = await api.createThreadReply("ch-1", "msg-1", {
        content: "reply text",
      });
      expect(result).toEqual(reply);
      expect(mockFetch.mock.calls[0][1].method).toBe("POST");
    });
  });

  // ─── Custom Emojis ─────────────────────────────────────────────────────────

  describe("custom emojis", () => {
    beforeEach(() => {
      api.setToken("test-token");
    });

    it("should list custom emojis", async () => {
      mockFetch.mockResolvedValueOnce(okJson([{ id: "e1", name: "kappa" }]));

      const result = await api.listCustomEmojis("s1");
      expect(result).toEqual([{ id: "e1", name: "kappa" }]);
      expect(mockFetch.mock.calls[0][0]).toContain("/servers/s1/emojis");
    });

    it("should upload a custom emoji with FormData", async () => {
      const emoji = { id: "e2", name: "pepehands" };
      mockFetch.mockResolvedValueOnce(okJson(emoji, 201));

      const file = new File(["img"], "pepehands.png", { type: "image/png" });
      const result = await api.uploadCustomEmoji("s1", "pepehands", file);
      expect(result).toEqual(emoji);
      expect(mockFetch.mock.calls[0][1].method).toBe("POST");
      // Should NOT have Content-Type (multipart)
      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers["Content-Type"]).toBeUndefined();
    });

    it("should delete a custom emoji", async () => {
      mockFetch.mockResolvedValueOnce(ok204());

      const result = await api.deleteCustomEmoji("s1", "e1");
      expect(result).toBeUndefined();
      expect(mockFetch.mock.calls[0][1].method).toBe("DELETE");
      expect(mockFetch.mock.calls[0][0]).toContain("/servers/s1/emojis/e1");
    });
  });

  // ─── Reactions ──────────────────────────────────────────────────────────────

  describe("reactions", () => {
    beforeEach(() => {
      api.setToken("test-token");
    });

    it("should add a reaction (encodes emoji)", async () => {
      mockFetch.mockResolvedValueOnce(ok204());

      await api.addReaction("ch-1", "msg-1", "👍");
      expect(mockFetch.mock.calls[0][1].method).toBe("PUT");
      expect(mockFetch.mock.calls[0][0]).toContain(encodeURIComponent("👍"));
    });

    it("should remove a reaction", async () => {
      mockFetch.mockResolvedValueOnce(ok204());

      await api.removeReaction("ch-1", "msg-1", "😀");
      expect(mockFetch.mock.calls[0][1].method).toBe("DELETE");
    });

    it("should list reactions", async () => {
      mockFetch.mockResolvedValueOnce(okJson([{ emoji: "👍", count: 3 }]));

      const result = await api.listReactions("ch-1", "msg-1");
      expect(result).toEqual([{ emoji: "👍", count: 3 }]);
    });
  });

  // ─── Pins ───────────────────────────────────────────────────────────────────

  describe("pins", () => {
    beforeEach(() => {
      api.setToken("test-token");
    });

    it("should pin a message", async () => {
      mockFetch.mockResolvedValueOnce(ok204());

      await api.pinMessage("ch-1", "msg-1");
      expect(mockFetch.mock.calls[0][1].method).toBe("POST");
      expect(mockFetch.mock.calls[0][0]).toContain(
        "/channels/ch-1/messages/msg-1/pin",
      );
    });

    it("should unpin a message", async () => {
      mockFetch.mockResolvedValueOnce(ok204());

      await api.unpinMessage("ch-1", "msg-1");
      expect(mockFetch.mock.calls[0][1].method).toBe("DELETE");
    });

    it("should list pinned messages", async () => {
      mockFetch.mockResolvedValueOnce(okJson([]));

      const result = await api.listPinnedMessages("ch-1");
      expect(result).toEqual([]);
      expect(mockFetch.mock.calls[0][0]).toContain(
        "/channels/ch-1/pinned-messages",
      );
    });
  });

  // ─── Link Preview & Giphy ──────────────────────────────────────────────────

  describe("link preview and giphy", () => {
    beforeEach(() => {
      api.setToken("test-token");
    });

    it("should get a link preview (encodes URL)", async () => {
      const preview = { title: "Example", url: "https://example.com" };
      mockFetch.mockResolvedValueOnce(okJson(preview));

      const result = await api.getLinkPreview("https://example.com");
      expect(result).toEqual(preview);
      expect(mockFetch.mock.calls[0][0]).toContain(
        encodeURIComponent("https://example.com"),
      );
    });

    it("should search gifs with default limit", async () => {
      mockFetch.mockResolvedValueOnce(okJson([]));

      await api.searchGifs("cat");
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("q=cat");
      expect(url).toContain("limit=15");
    });

    it("should search gifs with custom limit", async () => {
      mockFetch.mockResolvedValueOnce(okJson([]));

      await api.searchGifs("dog", 5);
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("limit=5");
    });
  });

  // ─── Polls & Events ────────────────────────────────────────────────────────

  describe("polls and events", () => {
    beforeEach(() => {
      api.setToken("test-token");
    });

    it("should create a poll", async () => {
      const msg = { id: "msg-1", poll: { id: "p1" } };
      mockFetch.mockResolvedValueOnce(okJson(msg, 201));

      const result = await api.createPoll("ch-1", {
        question: "Favorite?",
        options: ["A", "B"],
      });
      expect(result).toEqual(msg);
      expect(mockFetch.mock.calls[0][0]).toContain("/channels/ch-1/polls");
    });

    it("should cast a vote", async () => {
      const poll = { id: "p1", votes: [] };
      mockFetch.mockResolvedValueOnce(okJson(poll));

      const result = await api.castVote("p1", "opt-1");
      expect(result).toEqual(poll);
      expect(mockFetch.mock.calls[0][0]).toContain("/polls/p1/vote");
    });

    it("should create an event", async () => {
      const msg = { id: "msg-1", event: { name: "Game night" } };
      mockFetch.mockResolvedValueOnce(okJson(msg, 201));

      const result = await api.createEvent("ch-1", {
        name: "Game night",
        starts_at: "2024-06-01T20:00:00Z",
      });
      expect(result).toEqual(msg);
      expect(mockFetch.mock.calls[0][0]).toContain("/channels/ch-1/events");
    });
  });

  // ─── Password Reset ────────────────────────────────────────────────────────

  describe("password reset", () => {
    it("should send forgot password", async () => {
      const response = { reset_token: "tok-1" };
      mockFetch.mockResolvedValueOnce(okJson(response));

      const result = await api.forgotPassword("user@example.com");
      expect(result).toEqual(response);
      expect(mockFetch.mock.calls[0][0]).toContain("/auth/forgot-password");
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
        email: "user@example.com",
      });
    });

    it("should reset password", async () => {
      mockFetch.mockResolvedValueOnce(ok204());

      const result = await api.resetPassword({
        token: "tok-1",
        new_password: "newpass123",
      });
      expect(result).toBeUndefined();
      expect(mockFetch.mock.calls[0][0]).toContain("/auth/reset-password");
    });
  });

  // ─── Search ─────────────────────────────────────────────────────────────────

  describe("search", () => {
    beforeEach(() => {
      api.setToken("test-token");
    });

    it("should search messages with all params", async () => {
      const response = { messages: [], total: 0 };
      mockFetch.mockResolvedValueOnce(okJson(response));

      await api.searchMessages("s1", {
        q: "hello world",
        channel_id: "ch-1",
        before: "2024-01-01",
        limit: 10,
      });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("/servers/s1/search");
      expect(url).toContain("q=hello+world");
      expect(url).toContain("channel_id=ch-1");
      expect(url).toContain("before=2024-01-01");
      expect(url).toContain("limit=10");
    });

    it("should search with only required q param", async () => {
      mockFetch.mockResolvedValueOnce(okJson({ messages: [], total: 0 }));

      await api.searchMessages("s1", { q: "test" });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("q=test");
      expect(url).not.toContain("channel_id");
    });

    it("should pass abort signal", async () => {
      mockFetch.mockResolvedValueOnce(okJson({ messages: [], total: 0 }));

      const controller = new AbortController();
      await api.searchMessages("s1", { q: "test" }, controller.signal);

      expect(mockFetch.mock.calls[0][1].signal).toBe(controller.signal);
    });
  });

  // ─── ICE Servers ────────────────────────────────────────────────────────────

  describe("ICE servers", () => {
    it("should get ICE servers", async () => {
      const response = { iceServers: [], ttl: 3600 };
      api.setToken("test-token");
      mockFetch.mockResolvedValueOnce(okJson(response));

      const result = await api.getIceServers();
      expect(result).toEqual(response);
      expect(mockFetch.mock.calls[0][0]).toContain("/ice-servers");
    });
  });

  // ─── Automod ────────────────────────────────────────────────────────────────

  describe("automod", () => {
    beforeEach(() => {
      api.setToken("test-token");
    });

    it("should get automod config", async () => {
      const config = { enabled: true };
      mockFetch.mockResolvedValueOnce(okJson(config));

      const result = await api.getAutomodConfig("s1");
      expect(result).toEqual(config);
      expect(mockFetch.mock.calls[0][0]).toContain("/servers/s1/automod");
    });

    it("should update automod config", async () => {
      const config = { enabled: false };
      mockFetch.mockResolvedValueOnce(okJson(config));

      const result = await api.updateAutomodConfig("s1", { enabled: false });
      expect(result).toEqual(config);
      expect(mockFetch.mock.calls[0][1].method).toBe("PATCH");
    });

    it("should list word filters", async () => {
      mockFetch.mockResolvedValueOnce(okJson([]));

      const result = await api.listWordFilters("s1");
      expect(result).toEqual([]);
      expect(mockFetch.mock.calls[0][0]).toContain("/servers/s1/automod/words");
    });

    it("should add a word filter", async () => {
      const filter = { id: "wf-1", word: "badword" };
      mockFetch.mockResolvedValueOnce(okJson(filter, 201));

      const result = await api.addWordFilter("s1", "badword");
      expect(result).toEqual(filter);
      expect(mockFetch.mock.calls[0][1].method).toBe("POST");
    });

    it("should remove a word filter (encodes word)", async () => {
      mockFetch.mockResolvedValueOnce(ok204());

      await api.removeWordFilter("s1", "bad word");
      expect(mockFetch.mock.calls[0][1].method).toBe("DELETE");
      expect(mockFetch.mock.calls[0][0]).toContain(
        encodeURIComponent("bad word"),
      );
    });

    it("should list automod logs", async () => {
      mockFetch.mockResolvedValueOnce(okJson([]));

      const result = await api.listAutomodLogs("s1");
      expect(result).toEqual([]);
      expect(mockFetch.mock.calls[0][0]).toContain("/servers/s1/automod/logs");
    });
  });

  // ─── Bans ───────────────────────────────────────────────────────────────────

  describe("bans", () => {
    beforeEach(() => {
      api.setToken("test-token");
    });

    it("should list bans", async () => {
      mockFetch.mockResolvedValueOnce(okJson([]));

      const result = await api.listBans("s1");
      expect(result).toEqual([]);
      expect(mockFetch.mock.calls[0][0]).toContain("/servers/s1/bans");
    });

    it("should remove a ban", async () => {
      mockFetch.mockResolvedValueOnce(ok204());

      await api.removeBan("s1", "u1");
      expect(mockFetch.mock.calls[0][1].method).toBe("DELETE");
      expect(mockFetch.mock.calls[0][0]).toContain("/servers/s1/bans/u1");
    });
  });

  // ─── Bots ───────────────────────────────────────────────────────────────────

  describe("bots", () => {
    beforeEach(() => {
      api.setToken("test-token");
    });

    it("should list bots", async () => {
      mockFetch.mockResolvedValueOnce(okJson({ bots: [] }));

      const result = await api.listBots();
      expect(result).toEqual({ bots: [] });
      expect(mockFetch.mock.calls[0][0]).toContain("/bots");
    });

    it("should create a bot", async () => {
      const response = { bot: { id: "b1" }, token: "bot-token" };
      mockFetch.mockResolvedValueOnce(okJson(response, 201));

      const result = await api.createBot({ name: "TestBot" });
      expect(result).toEqual(response);
    });

    it("should revoke a bot", async () => {
      mockFetch.mockResolvedValueOnce(ok204());

      const result = await api.revokeBot("b1");
      expect(result).toBeUndefined();
      expect(mockFetch.mock.calls[0][1].method).toBe("DELETE");
    });

    it("should regenerate bot token", async () => {
      const response = { bot: { id: "b1" }, token: "new-token" };
      mockFetch.mockResolvedValueOnce(okJson(response));

      const result = await api.regenerateBotToken("b1");
      expect(result).toEqual(response);
      expect(mockFetch.mock.calls[0][0]).toContain("/bots/b1/token/regenerate");
    });

    it("should update a bot", async () => {
      const bot = { id: "b1", name: "UpdatedBot" };
      mockFetch.mockResolvedValueOnce(okJson(bot));

      const result = await api.updateBot("b1", { name: "UpdatedBot" });
      expect(result).toEqual(bot);
      expect(mockFetch.mock.calls[0][1].method).toBe("PATCH");
    });

    it("should get bot logs", async () => {
      mockFetch.mockResolvedValueOnce(okJson({ logs: [] }));

      const result = await api.getBotLogs("b1");
      expect(result).toEqual({ logs: [] });
      expect(mockFetch.mock.calls[0][0]).toContain("/bots/b1/logs");
    });
  });

  // ─── Export ─────────────────────────────────────────────────────────────────

  describe("exportServer", () => {
    beforeEach(() => {
      api.setToken("test-token");
    });

    it("should download and trigger file download", async () => {
      const blob = new Blob(["zip-data"], { type: "application/zip" });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        blob: () => Promise.resolve(blob),
        headers: new Headers({
          "Content-Disposition": 'attachment; filename="export.zip"',
        }),
      });

      const mockUrl = "blob:http://test/abc";
      const createObjectURL = vi.fn().mockReturnValue(mockUrl);
      const revokeObjectURL = vi.fn();
      globalThis.URL.createObjectURL = createObjectURL;
      globalThis.URL.revokeObjectURL = revokeObjectURL;

      const mockClick = vi.fn();
      const mockRemove = vi.fn();
      const mockElement = {
        href: "",
        download: "",
        click: mockClick,
        remove: mockRemove,
      };
      vi.spyOn(document, "createElement").mockReturnValueOnce(
        mockElement as unknown as HTMLAnchorElement,
      );
      vi.spyOn(document.body, "appendChild").mockImplementation((node) => node);

      await api.exportServer("s1");

      expect(createObjectURL).toHaveBeenCalledWith(blob);
      expect(mockElement.download).toBe("export.zip");
      expect(mockClick).toHaveBeenCalled();
      expect(mockRemove).toHaveBeenCalled();
      expect(revokeObjectURL).toHaveBeenCalledWith(mockUrl);
    });

    it("should use default filename when Content-Disposition is missing", async () => {
      const blob = new Blob(["zip"]);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        blob: () => Promise.resolve(blob),
        headers: new Headers(),
      });

      globalThis.URL.createObjectURL = vi.fn().mockReturnValue("blob:x");
      globalThis.URL.revokeObjectURL = vi.fn();

      const el = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
      vi.spyOn(document, "createElement").mockReturnValueOnce(
        el as unknown as HTMLAnchorElement,
      );
      vi.spyOn(document.body, "appendChild").mockImplementation((n) => n);

      await api.exportServer("s1");
      expect(el.download).toBe("server-export.zip");
    });

    it("should throw on error response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: () => Promise.resolve("Forbidden"),
      });

      await expect(api.exportServer("s1")).rejects.toThrow(ApiRequestError);
    });

    it("should handle text() failure gracefully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.reject(new Error("fail")),
      });

      await expect(api.exportServer("s1")).rejects.toThrow("Export failed");
    });
  });

  // ─── Moderation ─────────────────────────────────────────────────────────────

  describe("moderation", () => {
    beforeEach(() => {
      api.setToken("test-token");
    });

    it("should kick a member with reason", async () => {
      mockFetch.mockResolvedValueOnce(ok204());

      await api.kickMember("s1", "u1", { reason: "spam" });
      expect(mockFetch.mock.calls[0][1].method).toBe("POST");
      expect(mockFetch.mock.calls[0][0]).toContain(
        "/servers/s1/members/u1/kick",
      );
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
        reason: "spam",
      });
    });

    it("should kick a member without reason (defaults to {})", async () => {
      mockFetch.mockResolvedValueOnce(ok204());

      await api.kickMember("s1", "u1");
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({});
    });

    it("should ban a member", async () => {
      mockFetch.mockResolvedValueOnce(ok204());

      await api.banMember("s1", "u1", { reason: "toxic" });
      expect(mockFetch.mock.calls[0][0]).toContain(
        "/servers/s1/members/u1/ban",
      );
    });

    it("should ban a member without data (defaults to {})", async () => {
      mockFetch.mockResolvedValueOnce(ok204());

      await api.banMember("s1", "u1");
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({});
    });

    it("should timeout a member", async () => {
      mockFetch.mockResolvedValueOnce(ok204());

      await api.timeoutMember("s1", "u1", {
        duration_minutes: 60,
        reason: "spam",
      });
      expect(mockFetch.mock.calls[0][0]).toContain(
        "/servers/s1/members/u1/timeout",
      );
    });

    it("should remove a timeout", async () => {
      mockFetch.mockResolvedValueOnce(ok204());

      await api.removeTimeout("s1", "u1");
      expect(mockFetch.mock.calls[0][1].method).toBe("DELETE");
    });
  });

  // ─── Invites ────────────────────────────────────────────────────────────────

  describe("invites", () => {
    beforeEach(() => {
      api.setToken("test-token");
    });

    it("should list invites", async () => {
      mockFetch.mockResolvedValueOnce(okJson([]));

      const result = await api.listInvites("s1");
      expect(result).toEqual([]);
      expect(mockFetch.mock.calls[0][0]).toContain("/servers/s1/invites");
    });

    it("should create an invite", async () => {
      const invite = { id: "inv-1", code: "abc123" };
      mockFetch.mockResolvedValueOnce(okJson(invite, 201));

      const result = await api.createInvite("s1", { max_uses: 10 });
      expect(result).toEqual(invite);
    });

    it("should delete an invite", async () => {
      mockFetch.mockResolvedValueOnce(ok204());

      await api.deleteInvite("s1", "inv-1");
      expect(mockFetch.mock.calls[0][1].method).toBe("DELETE");
    });

    it("should preview an invite (encodes code)", async () => {
      const preview = { server_name: "Cool Server" };
      mockFetch.mockResolvedValueOnce(okJson(preview));

      const result = await api.previewInvite("abc 123");
      expect(result).toEqual(preview);
      expect(mockFetch.mock.calls[0][0]).toContain(
        encodeURIComponent("abc 123"),
      );
    });

    it("should accept an invite", async () => {
      const response = { message: "Joined", server_id: "s1" };
      mockFetch.mockResolvedValueOnce(okJson(response));

      const result = await api.acceptInvite("abc123");
      expect(result).toEqual(response);
      expect(mockFetch.mock.calls[0][1].method).toBe("POST");
      expect(mockFetch.mock.calls[0][0]).toContain("/invites/abc123/accept");
    });
  });

  // ─── Webhooks ───────────────────────────────────────────────────────────────

  describe("webhooks", () => {
    beforeEach(() => {
      api.setToken("test-token");
    });

    it("should list webhooks", async () => {
      mockFetch.mockResolvedValueOnce(okJson({ webhooks: [] }));

      const result = await api.listWebhooks("s1");
      expect(result).toEqual({ webhooks: [] });
    });

    it("should create a webhook", async () => {
      const response = { webhook: { id: "wh-1" }, token: "wh-tok" };
      mockFetch.mockResolvedValueOnce(okJson(response, 201));

      const result = await api.createWebhook("s1", {
        name: "My Hook",
        url: "https://hooks.example.com",
        event_types: ["message.created"],
      });
      expect(result).toEqual(response);
    });

    it("should update a webhook", async () => {
      const webhook = { id: "wh-1", name: "Updated" };
      mockFetch.mockResolvedValueOnce(okJson(webhook));

      const result = await api.updateWebhook("s1", "wh-1", {
        name: "Updated",
      });
      expect(result).toEqual(webhook);
      expect(mockFetch.mock.calls[0][1].method).toBe("PATCH");
    });

    it("should delete a webhook", async () => {
      mockFetch.mockResolvedValueOnce(ok204());

      await api.deleteWebhook("s1", "wh-1");
      expect(mockFetch.mock.calls[0][1].method).toBe("DELETE");
    });

    it("should test a webhook", async () => {
      mockFetch.mockResolvedValueOnce(ok204());

      await api.testWebhook("s1", "wh-1");
      expect(mockFetch.mock.calls[0][1].method).toBe("POST");
      expect(mockFetch.mock.calls[0][0]).toContain(
        "/servers/s1/webhooks/wh-1/test",
      );
    });
  });

  // ─── Roles ──────────────────────────────────────────────────────────────────

  describe("roles", () => {
    beforeEach(() => {
      api.setToken("test-token");
    });

    it("should list roles", async () => {
      mockFetch.mockResolvedValueOnce(okJson([]));

      const result = await api.listRoles("s1");
      expect(result).toEqual([]);
      expect(mockFetch.mock.calls[0][0]).toContain("/servers/s1/roles");
    });

    it("should create a role", async () => {
      const role = { id: "r1", name: "Admin" };
      mockFetch.mockResolvedValueOnce(okJson(role, 201));

      const result = await api.createRole("s1", {
        name: "Admin",
        permissions: 8,
      });
      expect(result).toEqual(role);
    });

    it("should update a role", async () => {
      const role = { id: "r1", name: "Mod" };
      mockFetch.mockResolvedValueOnce(okJson(role));

      const result = await api.updateRole("s1", "r1", { name: "Mod" });
      expect(result).toEqual(role);
      expect(mockFetch.mock.calls[0][1].method).toBe("PATCH");
    });

    it("should delete a role", async () => {
      mockFetch.mockResolvedValueOnce(ok204());

      await api.deleteRole("s1", "r1");
      expect(mockFetch.mock.calls[0][1].method).toBe("DELETE");
    });

    it("should assign a role to a user", async () => {
      mockFetch.mockResolvedValueOnce(ok204());

      await api.assignRole("s1", "u1", "r1");
      expect(mockFetch.mock.calls[0][1].method).toBe("PUT");
      expect(mockFetch.mock.calls[0][0]).toContain(
        "/servers/s1/members/u1/roles/r1",
      );
    });

    it("should remove a role from a user", async () => {
      mockFetch.mockResolvedValueOnce(ok204());

      await api.removeRole("s1", "u1", "r1");
      expect(mockFetch.mock.calls[0][1].method).toBe("DELETE");
    });
  });

  // ─── Content-Type header ────────────────────────────────────────────────────

  describe("request headers", () => {
    it("should include Content-Type: application/json by default", async () => {
      api.setToken("test-token");
      mockFetch.mockResolvedValueOnce(okJson([]));

      await api.listServers();

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers["Content-Type"]).toBe("application/json");
    });
  });
});
