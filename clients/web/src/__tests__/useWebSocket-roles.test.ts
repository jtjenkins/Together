/**
 * useWebSocket — additional branch coverage for MEMBER_ROLE_ADD / MEMBER_ROLE_REMOVE
 * and other untested event paths (CUSTOM_EMOJI_CREATE/DELETE, MEMBER_UNBAN).
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

const mockAuthStoreState = {
  user: { id: "current-user" },
  setUser: mockSetUser,
};

// Members list for role tests
let mockMembers: Array<{
  user_id: string;
  roles?: Array<{ id: string; name: string; color: string | null }>;
}> = [];

const mockServerStoreState = {
  servers: [{ id: "s1" }],
  activeServerId: "s1",
  get members() {
    return mockMembers;
  },
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

const mockAddEmoji = vi.fn();
const mockRemoveEmoji = vi.fn();
vi.mock("../stores/customEmojiStore", () => ({
  useCustomEmojiStore: {
    getState: () => ({
      addEmoji: mockAddEmoji,
      removeEmoji: mockRemoveEmoji,
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
import { useServerStore } from "../stores/serverStore";

// Grab the setState mock set up in vi.mock
const mockSetState = vi.mocked(
  (useServerStore as unknown as { setState: ReturnType<typeof vi.fn> })
    .setState,
);

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
  mockMembers = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useWebSocket — MEMBER_ROLE_ADD", () => {
  it("adds role to member in serverStore when member exists", () => {
    mockMembers = [{ user_id: "u1", roles: [] }];
    renderHook(() => useWebSocket());

    emit("MEMBER_ROLE_ADD", {
      user_id: "u1",
      role_id: "r1",
      role_name: "Admin",
      role_color: "#ff0000",
      server_id: "s1",
    });

    expect(mockHandleMemberRoleAdd).toHaveBeenCalled();
    expect(mockSetState).toHaveBeenCalled();
    const stateArg = mockSetState.mock.calls[0][0];
    const updatedMember = stateArg.members.find(
      (m: { user_id: string }) => m.user_id === "u1",
    );
    expect(updatedMember.roles).toHaveLength(1);
    expect(updatedMember.roles[0].id).toBe("r1");
    expect(updatedMember.roles[0].name).toBe("Admin");
    expect(updatedMember.roles[0].color).toBe("#ff0000");
  });

  it("does not duplicate role if already present", () => {
    mockMembers = [
      {
        user_id: "u1",
        roles: [{ id: "r1", name: "Admin", color: "#ff0000" }],
      },
    ];
    renderHook(() => useWebSocket());

    emit("MEMBER_ROLE_ADD", {
      user_id: "u1",
      role_id: "r1",
      role_name: "Admin",
      role_color: "#ff0000",
      server_id: "s1",
    });

    expect(mockHandleMemberRoleAdd).toHaveBeenCalled();
    // setState should NOT be called because role already exists
    expect(mockSetState).not.toHaveBeenCalled();
  });

  it("does nothing when member is not found", () => {
    mockMembers = [];
    renderHook(() => useWebSocket());

    emit("MEMBER_ROLE_ADD", {
      user_id: "nonexistent",
      role_id: "r1",
      role_name: "Admin",
      role_color: null,
      server_id: "s1",
    });

    expect(mockHandleMemberRoleAdd).toHaveBeenCalled();
    expect(mockSetState).not.toHaveBeenCalled();
  });
});

describe("useWebSocket — MEMBER_ROLE_REMOVE", () => {
  it("removes role from member in serverStore", () => {
    mockMembers = [
      {
        user_id: "u1",
        roles: [
          { id: "r1", name: "Admin", color: "#ff0000" },
          { id: "r2", name: "Mod", color: null },
        ],
      },
    ];
    renderHook(() => useWebSocket());

    emit("MEMBER_ROLE_REMOVE", {
      user_id: "u1",
      role_id: "r1",
      role_name: "Admin",
      role_color: "#ff0000",
      server_id: "s1",
    });

    expect(mockHandleMemberRoleRemove).toHaveBeenCalled();
    expect(mockSetState).toHaveBeenCalled();
    const stateArg = mockSetState.mock.calls[0][0];
    const updatedMember = stateArg.members.find(
      (m: { user_id: string }) => m.user_id === "u1",
    );
    expect(updatedMember.roles).toHaveLength(1);
    expect(updatedMember.roles[0].id).toBe("r2");
  });

  it("does nothing when member not found", () => {
    mockMembers = [];
    renderHook(() => useWebSocket());

    emit("MEMBER_ROLE_REMOVE", {
      user_id: "nonexistent",
      role_id: "r1",
      role_name: "Admin",
      role_color: null,
      server_id: "s1",
    });

    expect(mockHandleMemberRoleRemove).toHaveBeenCalled();
    expect(mockSetState).not.toHaveBeenCalled();
  });

  it("does nothing when member has no roles array", () => {
    mockMembers = [{ user_id: "u1" }];
    renderHook(() => useWebSocket());

    emit("MEMBER_ROLE_REMOVE", {
      user_id: "u1",
      role_id: "r1",
      role_name: "Admin",
      role_color: null,
      server_id: "s1",
    });

    expect(mockHandleMemberRoleRemove).toHaveBeenCalled();
    // member.roles is undefined so condition fails
    expect(mockSetState).not.toHaveBeenCalled();
  });
});

describe("useWebSocket — CUSTOM_EMOJI events", () => {
  it("CUSTOM_EMOJI_CREATE adds emoji", () => {
    renderHook(() => useWebSocket());

    emit("CUSTOM_EMOJI_CREATE", {
      id: "e1",
      name: "pepe",
      url: "https://cdn.example.com/pepe.png",
      server_id: "s1",
    });

    expect(mockAddEmoji).toHaveBeenCalledWith({
      id: "e1",
      name: "pepe",
      url: "https://cdn.example.com/pepe.png",
      server_id: "s1",
    });
  });

  it("CUSTOM_EMOJI_DELETE removes emoji", () => {
    renderHook(() => useWebSocket());

    emit("CUSTOM_EMOJI_DELETE", { server_id: "s1", emoji_id: "e1" });

    expect(mockRemoveEmoji).toHaveBeenCalledWith("s1", "e1");
  });
});

describe("useWebSocket — MEMBER_UNBAN", () => {
  it("MEMBER_UNBAN does not error (no-op handler)", () => {
    renderHook(() => useWebSocket());
    // Should not throw
    emit("MEMBER_UNBAN", { user_id: "u1", server_id: "s1" });
  });
});

describe("useWebSocket — REACTION events", () => {
  it("REACTION_ADD does not error (no-op handler)", () => {
    renderHook(() => useWebSocket());
    emit("REACTION_ADD", { message_id: "m1", emoji: "thumbsup" });
  });

  it("REACTION_REMOVE does not error (no-op handler)", () => {
    renderHook(() => useWebSocket());
    emit("REACTION_REMOVE", { message_id: "m1", emoji: "thumbsup" });
  });
});
