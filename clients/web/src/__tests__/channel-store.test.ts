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
});
