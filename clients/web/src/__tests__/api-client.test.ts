import { describe, it, expect, vi, beforeEach } from "vitest";
import { api, ApiRequestError } from "../api/client";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
  api.setToken(null);
});

describe("ApiClient", () => {
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

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: () => Promise.resolve(authResponse),
      });

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

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(authResponse),
      });

      const result = await api.login({
        username: "testuser",
        password: "password123",
      });

      expect(result).toEqual(authResponse);
    });

    it("should include auth header when token is set", async () => {
      api.setToken("my-token");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
      });

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
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
      });

      await api.listServers();

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers.Authorization).toBeUndefined();
    });
  });

  describe("error handling", () => {
    it("should throw ApiRequestError on non-ok response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: "Invalid credentials" }),
      });

      await expect(
        api.login({ username: "bad", password: "bad" }),
      ).rejects.toThrow(ApiRequestError);

      try {
        await api.login({ username: "bad", password: "bad" });
      } catch (err) {
        // Already thrown above, this is just to verify the first throw
      }
    });

    it("should handle json parse failure gracefully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error("Invalid JSON")),
      });

      await expect(api.listServers()).rejects.toThrow("Unknown error");
    });
  });

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

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: () => Promise.resolve(server),
      });

      const result = await api.createServer({ name: "Test Server" });
      expect(result).toEqual(server);
    });

    it("should list servers", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
      });

      const result = await api.listServers();
      expect(result).toEqual([]);
    });

    it("should delete a server (204 response)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
      });

      const result = await api.deleteServer("server-1");
      expect(result).toBeUndefined();
    });

    it("should join a server", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ message: "Joined server" }),
      });

      const result = await api.joinServer("server-1");
      expect(result).toEqual({ message: "Joined server" });
    });
  });

  describe("channels", () => {
    beforeEach(() => {
      api.setToken("test-token");
    });

    it("should list channels for a server", async () => {
      const channels = [
        {
          id: "ch-1",
          server_id: "server-1",
          name: "general",
          type: "text",
          position: 0,
          category: null,
          topic: null,
          created_at: "2024-01-01T00:00:00Z",
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(channels),
      });

      const result = await api.listChannels("server-1");
      expect(result).toEqual(channels);
    });

    it("should create a channel", async () => {
      const channel = {
        id: "ch-2",
        server_id: "server-1",
        name: "random",
        type: "text",
        position: 1,
        category: null,
        topic: "Random stuff",
        created_at: "2024-01-01T00:00:00Z",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: () => Promise.resolve(channel),
      });

      const result = await api.createChannel("server-1", {
        name: "random",
        type: "text",
        topic: "Random stuff",
      });

      expect(result).toEqual(channel);
    });
  });

  describe("messages", () => {
    beforeEach(() => {
      api.setToken("test-token");
    });

    it("should list messages with pagination params", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
      });

      await api.listMessages("ch-1", { before: "msg-10", limit: 25 });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("before=msg-10");
      expect(url).toContain("limit=25");
    });

    it("should send a message", async () => {
      const message = {
        id: "msg-1",
        channel_id: "ch-1",
        author_id: "user-1",
        content: "Hello!",
        reply_to: null,
        edited_at: null,
        deleted: false,
        created_at: "2024-01-01T00:00:00Z",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: () => Promise.resolve(message),
      });

      const result = await api.createMessage("ch-1", { content: "Hello!" });
      expect(result).toEqual(message);
    });

    it("should update a message", async () => {
      const updated = {
        id: "msg-1",
        channel_id: "ch-1",
        author_id: "user-1",
        content: "Updated!",
        reply_to: null,
        edited_at: "2024-01-01T00:01:00Z",
        deleted: false,
        created_at: "2024-01-01T00:00:00Z",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(updated),
      });

      const result = await api.updateMessage("msg-1", { content: "Updated!" });
      expect(result.content).toBe("Updated!");
      expect(result.edited_at).not.toBeNull();
    });

    it("should delete a message", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
      });

      const result = await api.deleteMessage("msg-1");
      expect(result).toBeUndefined();
    });
  });

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

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(user),
      });

      const result = await api.getCurrentUser();
      expect(result).toEqual(user);
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

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(updated),
      });

      const result = await api.updateCurrentUser({
        avatar_url: "https://example.com/avatar.png",
        custom_status: "Coding",
      });

      expect(result.avatar_url).toBe("https://example.com/avatar.png");
      expect(result.custom_status).toBe("Coding");
    });
  });
});
