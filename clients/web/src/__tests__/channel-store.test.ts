import { describe, it, expect, vi, beforeEach } from "vitest";
import { useChannelStore } from "../stores/channelStore";
import { api } from "../api/client";
import type { Channel } from "../types";

vi.mock("../api/client", () => ({
  api: {
    listChannels: vi.fn(),
    createChannel: vi.fn(),
    updateChannel: vi.fn(),
    deleteChannel: vi.fn(),
  },
  ApiRequestError: class extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

const mockChannel = (overrides: Partial<Channel> = {}): Channel => ({
  id: "ch-1",
  server_id: "server-1",
  name: "general",
  type: "text",
  position: 0,
  category: null,
  topic: null,
  created_at: "2024-01-01T00:00:00Z",
  ...overrides,
});

beforeEach(() => {
  useChannelStore.setState({
    channels: [],
    activeChannelId: null,
    isLoading: false,
    error: null,
  });
  vi.clearAllMocks();
});

describe("channelStore", () => {
  describe("fetchChannels", () => {
    it("should fetch channels sorted by position", async () => {
      const channels = [
        mockChannel({ id: "ch-2", position: 2 }),
        mockChannel({ id: "ch-1", position: 0 }),
        mockChannel({ id: "ch-3", position: 1 }),
      ];
      vi.mocked(api.listChannels).mockResolvedValueOnce(channels);

      await useChannelStore.getState().fetchChannels("server-1");

      const stored = useChannelStore.getState().channels;
      expect(stored[0].position).toBe(0);
      expect(stored[1].position).toBe(1);
      expect(stored[2].position).toBe(2);
    });

    it("should set isLoading true before fetching", async () => {
      vi.mocked(api.listChannels).mockImplementation(async () => {
        expect(useChannelStore.getState().isLoading).toBe(true);
        return [];
      });

      await useChannelStore.getState().fetchChannels("server-1");
    });

    it("should set isLoading false after successful fetch", async () => {
      vi.mocked(api.listChannels).mockResolvedValueOnce([]);

      await useChannelStore.getState().fetchChannels("server-1");

      expect(useChannelStore.getState().isLoading).toBe(false);
    });

    it("should set error and isLoading false on failure with generic Error", async () => {
      vi.mocked(api.listChannels).mockRejectedValueOnce(
        new Error("Network error"),
      );

      await useChannelStore.getState().fetchChannels("server-1");

      expect(useChannelStore.getState().error).toBe("Failed to fetch channels");
      expect(useChannelStore.getState().isLoading).toBe(false);
    });

    it("should extract message from ApiRequestError on fetch failure", async () => {
      const { ApiRequestError: MockApiRequestError } = await import(
        "../api/client"
      );
      vi.mocked(api.listChannels).mockRejectedValueOnce(
        new MockApiRequestError(500, "Server down"),
      );

      await useChannelStore.getState().fetchChannels("server-1");

      expect(useChannelStore.getState().error).toBe("Server down");
      expect(useChannelStore.getState().isLoading).toBe(false);
    });

    it("should call api.listChannels with the correct serverId", async () => {
      vi.mocked(api.listChannels).mockResolvedValueOnce([]);

      await useChannelStore.getState().fetchChannels("server-42");

      expect(api.listChannels).toHaveBeenCalledWith("server-42");
    });
  });

  describe("createChannel", () => {
    it("should create and add a channel", async () => {
      const newChannel = mockChannel({ id: "ch-new", name: "random" });
      vi.mocked(api.createChannel).mockResolvedValueOnce(newChannel);

      const result = await useChannelStore
        .getState()
        .createChannel("server-1", {
          name: "random",
          type: "text",
        });

      expect(result).toEqual(newChannel);
      expect(useChannelStore.getState().channels).toContainEqual(newChannel);
    });

    it("should append to existing channels", async () => {
      const existing = mockChannel({ id: "ch-1" });
      useChannelStore.setState({ channels: [existing] });
      const newChannel = mockChannel({ id: "ch-2", name: "voice" });
      vi.mocked(api.createChannel).mockResolvedValueOnce(newChannel);

      await useChannelStore.getState().createChannel("server-1", {
        name: "voice",
        type: "voice",
      });

      expect(useChannelStore.getState().channels).toHaveLength(2);
    });

    it("should set error and re-throw on failure with generic Error", async () => {
      vi.mocked(api.createChannel).mockRejectedValueOnce(
        new Error("Network error"),
      );

      await expect(
        useChannelStore.getState().createChannel("server-1", {
          name: "test",
          type: "text",
        }),
      ).rejects.toBeDefined();

      expect(useChannelStore.getState().error).toBe("Failed to create channel");
    });

    it("should extract message from ApiRequestError on create failure", async () => {
      const { ApiRequestError: MockApiRequestError } = await import(
        "../api/client"
      );
      vi.mocked(api.createChannel).mockRejectedValueOnce(
        new MockApiRequestError(400, "Name already exists"),
      );

      await expect(
        useChannelStore.getState().createChannel("server-1", {
          name: "dup",
          type: "text",
        }),
      ).rejects.toBeDefined();

      expect(useChannelStore.getState().error).toBe("Name already exists");
    });
  });

  describe("updateChannel", () => {
    it("should update a channel in the list", async () => {
      useChannelStore.setState({ channels: [mockChannel()] });
      const updated = mockChannel({ name: "renamed" });
      vi.mocked(api.updateChannel).mockResolvedValueOnce(updated);

      await useChannelStore
        .getState()
        .updateChannel("server-1", "ch-1", { name: "renamed" });

      expect(useChannelStore.getState().channels[0].name).toBe("renamed");
    });

    it("should not modify other channels", async () => {
      useChannelStore.setState({
        channels: [
          mockChannel({ id: "ch-1", name: "general" }),
          mockChannel({ id: "ch-2", name: "random" }),
        ],
      });
      const updated = mockChannel({ id: "ch-1", name: "renamed" });
      vi.mocked(api.updateChannel).mockResolvedValueOnce(updated);

      await useChannelStore
        .getState()
        .updateChannel("server-1", "ch-1", { name: "renamed" });

      expect(useChannelStore.getState().channels[0].name).toBe("renamed");
      expect(useChannelStore.getState().channels[1].name).toBe("random");
    });

    it("should set error and re-throw on failure with generic Error", async () => {
      vi.mocked(api.updateChannel).mockRejectedValueOnce(
        new Error("Network error"),
      );

      await expect(
        useChannelStore
          .getState()
          .updateChannel("server-1", "ch-1", { name: "x" }),
      ).rejects.toBeDefined();

      expect(useChannelStore.getState().error).toBe("Failed to update channel");
    });

    it("should extract message from ApiRequestError on update failure", async () => {
      const { ApiRequestError: MockApiRequestError } = await import(
        "../api/client"
      );
      vi.mocked(api.updateChannel).mockRejectedValueOnce(
        new MockApiRequestError(403, "Forbidden"),
      );

      await expect(
        useChannelStore
          .getState()
          .updateChannel("server-1", "ch-1", { name: "x" }),
      ).rejects.toBeDefined();

      expect(useChannelStore.getState().error).toBe("Forbidden");
    });
  });

  describe("deleteChannel", () => {
    it("should remove a channel from the list", async () => {
      useChannelStore.setState({
        channels: [mockChannel()],
        activeChannelId: "ch-1",
      });
      vi.mocked(api.deleteChannel).mockResolvedValueOnce(undefined);

      await useChannelStore.getState().deleteChannel("server-1", "ch-1");

      expect(useChannelStore.getState().channels).toHaveLength(0);
      expect(useChannelStore.getState().activeChannelId).toBeNull();
    });

    it("should not reset activeChannelId if different channel deleted", async () => {
      useChannelStore.setState({
        channels: [mockChannel({ id: "ch-1" }), mockChannel({ id: "ch-2" })],
        activeChannelId: "ch-1",
      });
      vi.mocked(api.deleteChannel).mockResolvedValueOnce(undefined);

      await useChannelStore.getState().deleteChannel("server-1", "ch-2");

      expect(useChannelStore.getState().activeChannelId).toBe("ch-1");
      expect(useChannelStore.getState().channels).toHaveLength(1);
    });

    it("should set error and re-throw on failure with generic Error", async () => {
      vi.mocked(api.deleteChannel).mockRejectedValueOnce(
        new Error("Network error"),
      );

      await expect(
        useChannelStore.getState().deleteChannel("server-1", "ch-1"),
      ).rejects.toBeDefined();

      expect(useChannelStore.getState().error).toBe("Failed to delete channel");
    });

    it("should extract message from ApiRequestError on delete failure", async () => {
      const { ApiRequestError: MockApiRequestError } = await import(
        "../api/client"
      );
      vi.mocked(api.deleteChannel).mockRejectedValueOnce(
        new MockApiRequestError(403, "Not allowed"),
      );

      await expect(
        useChannelStore.getState().deleteChannel("server-1", "ch-1"),
      ).rejects.toBeDefined();

      expect(useChannelStore.getState().error).toBe("Not allowed");
    });
  });

  describe("clearChannels", () => {
    it("should clear channels and activeChannelId", () => {
      useChannelStore.setState({
        channels: [mockChannel()],
        activeChannelId: "ch-1",
      });

      useChannelStore.getState().clearChannels();

      expect(useChannelStore.getState().channels).toEqual([]);
      expect(useChannelStore.getState().activeChannelId).toBeNull();
    });
  });

  describe("setActiveChannel", () => {
    it("should set active channel", () => {
      useChannelStore.getState().setActiveChannel("ch-1");
      expect(useChannelStore.getState().activeChannelId).toBe("ch-1");
    });

    it("should set active channel to null", () => {
      useChannelStore.setState({ activeChannelId: "ch-1" });
      useChannelStore.getState().setActiveChannel(null);
      expect(useChannelStore.getState().activeChannelId).toBeNull();
    });
  });

  describe("clearError", () => {
    it("should clear the error", () => {
      useChannelStore.setState({ error: "Some error" });

      useChannelStore.getState().clearError();

      expect(useChannelStore.getState().error).toBeNull();
    });
  });
});
