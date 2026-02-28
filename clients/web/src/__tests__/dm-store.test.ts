import { describe, it, expect, vi, beforeEach } from "vitest";
import { useDmStore } from "../stores/dmStore";
import { api } from "../api/client";
import type { DirectMessageChannel, DirectMessage } from "../types";

vi.mock("../api/client", () => ({
  api: {
    listDmChannels: vi.fn(),
    openDmChannel: vi.fn(),
    listDmMessages: vi.fn(),
    sendDmMessage: vi.fn(),
  },
  ApiRequestError: class extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

const mockChannel = (
  overrides: Partial<DirectMessageChannel> = {},
): DirectMessageChannel => ({
  id: "dm-1",
  recipient: {
    id: "user-2",
    username: "bob",
    email: "bob@example.com",
    avatar_url: null,
    status: "online",
    custom_status: null,
    created_at: "2024-01-01T00:00:00Z",
  },
  created_at: "2024-01-01T00:00:00Z",
  last_message_at: null,
  ...overrides,
});

const mockMessage = (
  overrides: Partial<DirectMessage> = {},
): DirectMessage => ({
  id: "msg-1",
  channel_id: "dm-1",
  author_id: "user-1",
  content: "Hello!",
  edited_at: null,
  deleted: false,
  created_at: "2024-01-01T00:00:00Z",
  ...overrides,
});

beforeEach(() => {
  useDmStore.setState({
    channels: [],
    activeDmChannelId: null,
    messagesByChannel: {},
    hasMore: true,
    isLoading: false,
    error: null,
  });
  vi.clearAllMocks();
});

describe("dmStore", () => {
  describe("initial state", () => {
    it("should have empty channels and null active channel", () => {
      const state = useDmStore.getState();
      expect(state.channels).toEqual([]);
      expect(state.activeDmChannelId).toBeNull();
      expect(state.messagesByChannel).toEqual({});
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });
  });

  describe("setChannels", () => {
    it("should replace the channels list", () => {
      const channels = [mockChannel()];
      useDmStore.getState().setChannels(channels);
      expect(useDmStore.getState().channels).toEqual(channels);
    });
  });

  describe("addChannel", () => {
    it("should prepend a new channel", () => {
      const existing = mockChannel({ id: "dm-1" });
      const newer = mockChannel({ id: "dm-2" });
      useDmStore.setState({ channels: [existing] });

      useDmStore.getState().addChannel(newer);

      const channels = useDmStore.getState().channels;
      expect(channels).toHaveLength(2);
      expect(channels[0].id).toBe("dm-2");
    });

    it("should not add a duplicate channel", () => {
      const channel = mockChannel({ id: "dm-1" });
      useDmStore.setState({ channels: [channel] });

      useDmStore.getState().addChannel(channel);

      expect(useDmStore.getState().channels).toHaveLength(1);
    });
  });

  describe("setActiveDmChannel", () => {
    it("should set the active DM channel id", () => {
      useDmStore.getState().setActiveDmChannel("dm-1");
      expect(useDmStore.getState().activeDmChannelId).toBe("dm-1");
    });

    it("should reset hasMore to true when switching channels", () => {
      useDmStore.setState({ hasMore: false });
      useDmStore.getState().setActiveDmChannel("dm-2");
      expect(useDmStore.getState().hasMore).toBe(true);
    });

    it("should accept null to clear the active channel", () => {
      useDmStore.setState({ activeDmChannelId: "dm-1" });
      useDmStore.getState().setActiveDmChannel(null);
      expect(useDmStore.getState().activeDmChannelId).toBeNull();
    });
  });

  describe("fetchChannels", () => {
    it("should fetch and store channels", async () => {
      const channels = [mockChannel()];
      vi.mocked(api.listDmChannels).mockResolvedValueOnce(channels);

      await useDmStore.getState().fetchChannels();

      expect(useDmStore.getState().channels).toEqual(channels);
      expect(useDmStore.getState().error).toBeNull();
    });

    it("should set error on failure", async () => {
      vi.mocked(api.listDmChannels).mockRejectedValueOnce(
        new Error("Network error"),
      );

      await useDmStore.getState().fetchChannels();

      expect(useDmStore.getState().error).toBeTruthy();
    });

    it("should use ApiRequestError message when available", async () => {
      const { ApiRequestError: MockApiRequestError } = await import(
        "../api/client"
      );
      vi.mocked(api.listDmChannels).mockRejectedValueOnce(
        new MockApiRequestError(403, "Forbidden"),
      );

      await useDmStore.getState().fetchChannels();

      expect(useDmStore.getState().error).toBe("Forbidden");
    });
  });

  describe("openOrCreateDm", () => {
    it("should call api and prepend the new channel", async () => {
      const channel = mockChannel({ id: "dm-new" });
      vi.mocked(api.openDmChannel).mockResolvedValueOnce(channel);

      const result = await useDmStore.getState().openOrCreateDm("user-2");

      expect(result).toEqual(channel);
      expect(useDmStore.getState().channels[0]).toEqual(channel);
    });

    it("should not duplicate an existing channel", async () => {
      const channel = mockChannel({ id: "dm-1" });
      useDmStore.setState({ channels: [channel] });
      vi.mocked(api.openDmChannel).mockResolvedValueOnce(channel);

      await useDmStore.getState().openOrCreateDm("user-2");

      expect(useDmStore.getState().channels).toHaveLength(1);
    });
  });

  describe("fetchMessages", () => {
    it("should load messages for a channel and reverse them for display", async () => {
      // Server returns newest-first; store should reverse for display.
      const messages = [
        mockMessage({ id: "msg-2", created_at: "2024-01-02T00:00:00Z" }),
        mockMessage({ id: "msg-1", created_at: "2024-01-01T00:00:00Z" }),
      ];
      vi.mocked(api.listDmMessages).mockResolvedValueOnce(messages);

      await useDmStore.getState().fetchMessages("dm-1");

      const stored = useDmStore.getState().messagesByChannel["dm-1"];
      expect(stored).toHaveLength(2);
      // Reversed: oldest first for display.
      expect(stored[0].id).toBe("msg-1");
      expect(stored[1].id).toBe("msg-2");
    });

    it("should set hasMore false when fewer than 50 messages returned", async () => {
      vi.mocked(api.listDmMessages).mockResolvedValueOnce([mockMessage()]);

      await useDmStore.getState().fetchMessages("dm-1");

      expect(useDmStore.getState().hasMore).toBe(false);
    });

    it("should prepend older messages when before cursor is provided", async () => {
      const older = mockMessage({ id: "old-1" });
      useDmStore.setState({
        messagesByChannel: { "dm-1": [mockMessage({ id: "new-1" })] },
      });
      vi.mocked(api.listDmMessages).mockResolvedValueOnce([older]);

      await useDmStore.getState().fetchMessages("dm-1", "new-1");

      const stored = useDmStore.getState().messagesByChannel["dm-1"];
      expect(stored).toHaveLength(2);
      expect(stored[0].id).toBe("old-1");
    });

    it("should set isLoading false and error on failure", async () => {
      vi.mocked(api.listDmMessages).mockRejectedValueOnce(
        new Error("Network error"),
      );

      await useDmStore.getState().fetchMessages("dm-1");

      expect(useDmStore.getState().isLoading).toBe(false);
      expect(useDmStore.getState().error).toBeTruthy();
    });
  });

  describe("addMessage", () => {
    it("should append a message to the correct channel", () => {
      const message = mockMessage({ channel_id: "dm-1" });
      useDmStore.setState({ messagesByChannel: { "dm-1": [] } });

      useDmStore.getState().addMessage(message);

      expect(useDmStore.getState().messagesByChannel["dm-1"]).toHaveLength(1);
    });

    it("should not add duplicate messages", () => {
      const message = mockMessage({ id: "msg-1" });
      useDmStore.setState({ messagesByChannel: { "dm-1": [message] } });

      useDmStore.getState().addMessage(message);

      expect(useDmStore.getState().messagesByChannel["dm-1"]).toHaveLength(1);
    });

    it("should update last_message_at on the matching channel", () => {
      const channel = mockChannel({ id: "dm-1", last_message_at: null });
      useDmStore.setState({ channels: [channel], messagesByChannel: {} });

      const message = mockMessage({
        channel_id: "dm-1",
        created_at: "2024-06-01T12:00:00Z",
      });
      useDmStore.getState().addMessage(message);

      const updated = useDmStore
        .getState()
        .channels.find((c) => c.id === "dm-1");
      expect(updated?.last_message_at).toBe("2024-06-01T12:00:00Z");
    });
  });

  describe("clearError", () => {
    it("should clear the error field", () => {
      useDmStore.setState({ error: "Something went wrong" });

      useDmStore.getState().clearError();

      expect(useDmStore.getState().error).toBeNull();
    });
  });
});
