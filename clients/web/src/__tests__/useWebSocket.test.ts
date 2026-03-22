/**
 * useWebSocket hook tests.
 *
 * This hook wires gateway events to Zustand stores. We verify that when the
 * gateway emits specific events, the correct store actions are called.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

// ─── Capture gateway.on handlers ────────────────────────────────────────────

type Handler = (...args: unknown[]) => void;
const registeredHandlers = new Map<string, Handler>();

vi.mock("../api/websocket", () => ({
  gateway: {
    on: vi.fn((event: string, handler: Handler) => {
      registeredHandlers.set(event, handler);
      return () => {
        registeredHandlers.delete(event);
      };
    }),
  },
}));

// ─── Mock stores ────────────────────────────────────────────────────────────

const mockSetUser = vi.fn();
const mockSetServers = vi.fn();
const mockUpdateMemberPresence = vi.fn();
const mockFetchMembers = vi.fn();
const mockAddMessage = vi.fn();
const mockUpdateMessage = vi.fn();
const mockRemoveMessage = vi.fn();
const mockAddThreadMessage = vi.fn();
const mockUpdateMessagePoll = vi.fn();
const mockSetDmChannels = vi.fn();
const mockAddDmChannel = vi.fn();
const mockAddDmMessage = vi.fn();
const mockSetUnreadCounts = vi.fn();
const mockIncrementUnread = vi.fn();
const mockSetMentionCounts = vi.fn();
const mockIncrementMention = vi.fn();
const mockAddTypingUser = vi.fn();
const mockRemoveMemberLocally = vi.fn();
const mockSetMemberTimeout = vi.fn();
const mockHandleRoleCreate = vi.fn();
const mockHandleRoleUpdate = vi.fn();
const mockHandleRoleDelete = vi.fn();
const mockHandleMemberRoleAdd = vi.fn();
const mockHandleMemberRoleRemove = vi.fn();

let mockActiveServerId: string | null = "s1";
let mockActiveChannelId: string | null = "ch-1";
let mockActiveDmChannelId: string | null = null;

// Store state mocks
const mockAuthStoreState = {
  user: { id: "current-user" },
  setUser: mockSetUser,
};
const mockServerStoreState = {
  servers: [{ id: "s1" }],
  activeServerId: "s1",
  members: [] as Array<{
    user_id: string;
    roles?: Array<{ id: string; name: string; color: string | null }>;
  }>,
  setServers: vi.fn(),
  setActiveServer: vi.fn(),
};

vi.mock("../stores/authStore", () => ({
  useAuthStore: Object.assign(
    (selector: (state: typeof mockAuthStoreState) => unknown) =>
      selector(mockAuthStoreState),
    {
      getState: () => mockAuthStoreState,
    },
  ),
}));

vi.mock("../stores/serverStore", () => ({
  useServerStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        ...mockServerStoreState,
        setServers: mockSetServers,
        updateMemberPresence: mockUpdateMemberPresence,
        fetchMembers: mockFetchMembers,
        get activeServerId() {
          return mockActiveServerId;
        },
        removeMemberLocally: mockRemoveMemberLocally,
        setMemberTimeout: mockSetMemberTimeout,
      }),
    {
      getState: () => mockServerStoreState,
      setState: vi.fn(),
    },
  ),
}));

vi.mock("../stores/messageStore", () => ({
  useMessageStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      addMessage: mockAddMessage,
      updateMessage: mockUpdateMessage,
      removeMessage: mockRemoveMessage,
      addThreadMessage: mockAddThreadMessage,
      updateMessagePoll: mockUpdateMessagePoll,
    }),
}));

vi.mock("../stores/channelStore", () => ({
  useChannelStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      activeChannelId: mockActiveChannelId,
    }),
}));

vi.mock("../stores/dmStore", () => ({
  useDmStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      setChannels: mockSetDmChannels,
      addChannel: mockAddDmChannel,
      addMessage: mockAddDmMessage,
      activeDmChannelId: mockActiveDmChannelId,
    }),
}));

vi.mock("../stores/readStateStore", () => ({
  useReadStateStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      setUnreadCounts: mockSetUnreadCounts,
      incrementUnread: mockIncrementUnread,
      setMentionCounts: mockSetMentionCounts,
      incrementMention: mockIncrementMention,
    }),
}));

vi.mock("../stores/typingStore", () => ({
  useTypingStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      addTypingUser: mockAddTypingUser,
    }),
}));

vi.mock("../stores/customEmojiStore", () => ({
  useCustomEmojiStore: {
    getState: () => ({
      addEmoji: vi.fn(),
      removeEmoji: vi.fn(),
    }),
  },
}));

const mockSetRolesFromReady = vi.fn();
vi.mock("../stores/roleStore", () => ({
  useRoleStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        handleRoleCreate: mockHandleRoleCreate,
        handleRoleUpdate: mockHandleRoleUpdate,
        handleRoleDelete: mockHandleRoleDelete,
        handleMemberRoleAdd: mockHandleMemberRoleAdd,
        handleMemberRoleRemove: mockHandleMemberRoleRemove,
      }),
    {
      getState: () => ({
        setRolesFromReady: mockSetRolesFromReady,
      }),
    },
  ),
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import { useWebSocket } from "../hooks/useWebSocket";

// ─── Helpers ────────────────────────────────────────────────────────────────

function emit(event: string, data: unknown) {
  const handler = registeredHandlers.get(event);
  if (handler) handler(data);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  registeredHandlers.clear();
  mockActiveServerId = "s1";
  mockActiveChannelId = "ch-1";
  mockActiveDmChannelId = null;
  mockServerStoreState.members = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useWebSocket", () => {
  it("should register handlers for all expected events", () => {
    const { unmount } = renderHook(() => useWebSocket());

    const expectedEvents = [
      "READY",
      "MESSAGE_CREATE",
      "MESSAGE_UPDATE",
      "MESSAGE_DELETE",
      "PRESENCE_UPDATE",
      "DM_CHANNEL_CREATE",
      "DM_MESSAGE_CREATE",
      "THREAD_MESSAGE_CREATE",
      "POLL_VOTE",
      "REACTION_ADD",
      "REACTION_REMOVE",
      "TYPING_START",
      "CUSTOM_EMOJI_CREATE",
      "CUSTOM_EMOJI_DELETE",
      "MEMBER_KICK",
      "MEMBER_BAN",
      "MEMBER_TIMEOUT",
      "MEMBER_TIMEOUT_REMOVE",
      "MEMBER_UNBAN",
      "ROLE_CREATE",
      "ROLE_UPDATE",
      "ROLE_DELETE",
      "MEMBER_ROLE_ADD",
      "MEMBER_ROLE_REMOVE",
      "connected",
    ];

    for (const event of expectedEvents) {
      expect(registeredHandlers.has(event)).toBe(true);
    }

    unmount();
  });

  it("READY sets user, servers, dm channels, unread counts, mention counts, and roles", () => {
    renderHook(() => useWebSocket());

    emit("READY", {
      user: { id: "u1", username: "test" },
      servers: [{ id: "s1" }],
      dm_channels: [{ id: "dm-1" }],
      unread_counts: { "ch-1": 3 },
      mention_counts: { "ch-1": 1 },
      server_roles: { s1: [{ id: "r1", name: "Admin" }] },
    });

    expect(mockSetUser).toHaveBeenCalledWith({ id: "u1", username: "test" });
    expect(mockSetServers).toHaveBeenCalledWith([{ id: "s1" }]);
    expect(mockSetDmChannels).toHaveBeenCalledWith([{ id: "dm-1" }]);
    expect(mockSetUnreadCounts).toHaveBeenCalledWith({ "ch-1": 3 });
    expect(mockSetMentionCounts).toHaveBeenCalledWith({ "ch-1": 1 });
    expect(mockSetRolesFromReady).toHaveBeenCalledWith({
      s1: [{ id: "r1", name: "Admin" }],
    });
  });

  it("READY without optional fields does not call optional setters", () => {
    renderHook(() => useWebSocket());

    emit("READY", {
      user: { id: "u1" },
      servers: [],
    });

    expect(mockSetDmChannels).not.toHaveBeenCalled();
    expect(mockSetUnreadCounts).not.toHaveBeenCalled();
    expect(mockSetMentionCounts).not.toHaveBeenCalled();
    expect(mockSetRolesFromReady).not.toHaveBeenCalled();
  });

  it("MESSAGE_CREATE on active channel adds message", () => {
    mockActiveChannelId = "ch-1";
    renderHook(() => useWebSocket());

    emit("MESSAGE_CREATE", {
      id: "msg-1",
      channel_id: "ch-1",
      content: "Hello",
      author_id: "other-user",
      mention_everyone: false,
      mention_user_ids: [],
    });

    expect(mockAddMessage).toHaveBeenCalled();
    expect(mockIncrementUnread).not.toHaveBeenCalled();
  });

  it("MESSAGE_CREATE on different channel increments unread", () => {
    mockActiveChannelId = "ch-1";
    renderHook(() => useWebSocket());

    emit("MESSAGE_CREATE", {
      id: "msg-2",
      channel_id: "ch-2",
      content: "Hello",
      author_id: "other-user",
      mention_everyone: false,
      mention_user_ids: [],
    });

    expect(mockAddMessage).not.toHaveBeenCalled();
    expect(mockIncrementUnread).toHaveBeenCalledWith("ch-2");
  });

  it("MESSAGE_CREATE with mention increments mention count", () => {
    mockActiveChannelId = "ch-1";
    renderHook(() => useWebSocket());

    emit("MESSAGE_CREATE", {
      id: "msg-3",
      channel_id: "ch-2",
      content: "Hey @current-user",
      author_id: "other-user",
      mention_everyone: false,
      mention_user_ids: ["current-user"],
    });

    expect(mockIncrementMention).toHaveBeenCalledWith("ch-2");
  });

  it("MESSAGE_CREATE with mention_everyone increments mention count", () => {
    mockActiveChannelId = "ch-1";
    renderHook(() => useWebSocket());

    emit("MESSAGE_CREATE", {
      id: "msg-4",
      channel_id: "ch-2",
      content: "@everyone",
      author_id: "other-user",
      mention_everyone: true,
      mention_user_ids: [],
    });

    expect(mockIncrementMention).toHaveBeenCalledWith("ch-2");
  });

  it("MESSAGE_CREATE from self does not increment mention", () => {
    mockActiveChannelId = "ch-1";
    renderHook(() => useWebSocket());

    emit("MESSAGE_CREATE", {
      id: "msg-5",
      channel_id: "ch-2",
      content: "My own message",
      author_id: "current-user",
      mention_everyone: true,
      mention_user_ids: ["current-user"],
    });

    expect(mockIncrementMention).not.toHaveBeenCalled();
  });

  it("MESSAGE_UPDATE on active channel updates message", () => {
    mockActiveChannelId = "ch-1";
    renderHook(() => useWebSocket());

    emit("MESSAGE_UPDATE", {
      id: "msg-1",
      channel_id: "ch-1",
      content: "Edited",
    });

    expect(mockUpdateMessage).toHaveBeenCalled();
  });

  it("MESSAGE_UPDATE on different channel is ignored", () => {
    mockActiveChannelId = "ch-1";
    renderHook(() => useWebSocket());

    emit("MESSAGE_UPDATE", {
      id: "msg-1",
      channel_id: "ch-2",
      content: "Edited",
    });

    expect(mockUpdateMessage).not.toHaveBeenCalled();
  });

  it("MESSAGE_DELETE on active channel removes message", () => {
    mockActiveChannelId = "ch-1";
    renderHook(() => useWebSocket());

    emit("MESSAGE_DELETE", { id: "msg-1", channel_id: "ch-1" });

    expect(mockRemoveMessage).toHaveBeenCalled();
  });

  it("MESSAGE_DELETE on different channel is ignored", () => {
    mockActiveChannelId = "ch-1";
    renderHook(() => useWebSocket());

    emit("MESSAGE_DELETE", { id: "msg-1", channel_id: "ch-2" });

    expect(mockRemoveMessage).not.toHaveBeenCalled();
  });

  it("PRESENCE_UPDATE updates member presence", () => {
    renderHook(() => useWebSocket());

    emit("PRESENCE_UPDATE", {
      user_id: "u1",
      status: "online",
      custom_status: "Working",
      activity: "Coding",
    });

    expect(mockUpdateMemberPresence).toHaveBeenCalledWith(
      "u1",
      "online",
      "Working",
      "Coding",
    );
  });

  it("DM_CHANNEL_CREATE adds dm channel", () => {
    renderHook(() => useWebSocket());

    emit("DM_CHANNEL_CREATE", { id: "dm-1" });

    expect(mockAddDmChannel).toHaveBeenCalledWith({ id: "dm-1" });
  });

  it("DM_MESSAGE_CREATE adds dm message and increments unread for inactive DM", () => {
    mockActiveDmChannelId = "dm-other";
    renderHook(() => useWebSocket());

    emit("DM_MESSAGE_CREATE", { id: "dm-msg-1", channel_id: "dm-1" });

    expect(mockAddDmMessage).toHaveBeenCalled();
    expect(mockIncrementUnread).toHaveBeenCalledWith("dm-1");
  });

  it("DM_MESSAGE_CREATE on active DM does not increment unread", () => {
    mockActiveDmChannelId = "dm-1";
    renderHook(() => useWebSocket());

    emit("DM_MESSAGE_CREATE", { id: "dm-msg-1", channel_id: "dm-1" });

    expect(mockAddDmMessage).toHaveBeenCalled();
    expect(mockIncrementUnread).not.toHaveBeenCalled();
  });

  it("THREAD_MESSAGE_CREATE adds thread message", () => {
    renderHook(() => useWebSocket());

    emit("THREAD_MESSAGE_CREATE", { id: "reply-1" });

    expect(mockAddThreadMessage).toHaveBeenCalledWith({ id: "reply-1" });
  });

  it("POLL_VOTE updates message poll", () => {
    renderHook(() => useWebSocket());

    emit("POLL_VOTE", { poll_id: "p1", updated_poll: { id: "p1" } });

    expect(mockUpdateMessagePoll).toHaveBeenCalledWith("p1", { id: "p1" });
  });

  it("TYPING_START adds typing user", () => {
    renderHook(() => useWebSocket());

    emit("TYPING_START", {
      user_id: "u1",
      username: "TestUser",
      channel_id: "ch-1",
    });

    expect(mockAddTypingUser).toHaveBeenCalledWith("u1", "TestUser", "ch-1");
  });

  it("TYPING_START uses 'Unknown' when username is missing", () => {
    renderHook(() => useWebSocket());

    emit("TYPING_START", {
      user_id: "u1",
      username: "",
      channel_id: "ch-1",
    });

    expect(mockAddTypingUser).toHaveBeenCalledWith("u1", "Unknown", "ch-1");
  });

  it("MEMBER_TIMEOUT sets member timeout", () => {
    renderHook(() => useWebSocket());

    emit("MEMBER_TIMEOUT", {
      user_id: "u1",
      expires_at: "2024-01-02T00:00:00Z",
    });

    expect(mockSetMemberTimeout).toHaveBeenCalledWith(
      "u1",
      "2024-01-02T00:00:00Z",
    );
  });

  it("MEMBER_TIMEOUT_REMOVE clears member timeout", () => {
    renderHook(() => useWebSocket());

    emit("MEMBER_TIMEOUT_REMOVE", { user_id: "u1", server_id: "s1" });

    expect(mockSetMemberTimeout).toHaveBeenCalledWith("u1", null);
  });

  it("ROLE_CREATE calls handleRoleCreate", () => {
    renderHook(() => useWebSocket());

    emit("ROLE_CREATE", { id: "r1", name: "Admin" });

    expect(mockHandleRoleCreate).toHaveBeenCalledWith({
      id: "r1",
      name: "Admin",
    });
  });

  it("ROLE_UPDATE calls handleRoleUpdate", () => {
    renderHook(() => useWebSocket());

    emit("ROLE_UPDATE", { id: "r1", name: "Moderator" });

    expect(mockHandleRoleUpdate).toHaveBeenCalledWith({
      id: "r1",
      name: "Moderator",
    });
  });

  it("ROLE_DELETE calls handleRoleDelete", () => {
    renderHook(() => useWebSocket());

    emit("ROLE_DELETE", { server_id: "s1", role_id: "r1" });

    expect(mockHandleRoleDelete).toHaveBeenCalledWith({
      server_id: "s1",
      role_id: "r1",
    });
  });

  it("MEMBER_KICK for current user removes server from list", () => {
    renderHook(() => useWebSocket());

    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    emit("MEMBER_KICK", { user_id: "current-user", server_id: "s1" });

    expect(mockServerStoreState.setServers).toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      "You have been kicked from the server.",
    );

    alertSpy.mockRestore();
  });

  it("MEMBER_KICK for other user removes member locally", () => {
    renderHook(() => useWebSocket());

    emit("MEMBER_KICK", { user_id: "other-user", server_id: "s1" });

    expect(mockRemoveMemberLocally).toHaveBeenCalledWith("other-user");
  });

  it("MEMBER_BAN for current user removes server from list", () => {
    renderHook(() => useWebSocket());

    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    emit("MEMBER_BAN", { user_id: "current-user", server_id: "s1" });

    expect(mockServerStoreState.setServers).toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      "You have been banned from the server.",
    );

    alertSpy.mockRestore();
  });

  it("MEMBER_BAN for other user removes member locally", () => {
    renderHook(() => useWebSocket());

    emit("MEMBER_BAN", { user_id: "other-user", server_id: "s1" });

    expect(mockRemoveMemberLocally).toHaveBeenCalledWith("other-user");
  });

  it("connected event fetches members for active server", () => {
    mockActiveServerId = "s1";
    renderHook(() => useWebSocket());

    emit("connected", undefined);

    expect(mockFetchMembers).toHaveBeenCalledWith("s1");
  });

  it("connected event does not fetch members when no active server", () => {
    mockActiveServerId = null;
    renderHook(() => useWebSocket());

    emit("connected", undefined);

    expect(mockFetchMembers).not.toHaveBeenCalled();
  });

  it("should unsubscribe all handlers on unmount", () => {
    const { unmount } = renderHook(() => useWebSocket());

    expect(registeredHandlers.size).toBeGreaterThan(0);

    unmount();

    expect(registeredHandlers.size).toBe(0);
  });
});
