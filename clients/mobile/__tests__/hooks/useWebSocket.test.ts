import { renderHook, act } from "@testing-library/react-native";
import { useWebSocket } from "../../src/hooks/useWebSocket";

// Capture emitted gateway events so tests can trigger them.
// Must be prefixed with "mock" so Jest allows access inside mock factories.
type HandlerMap = Record<string, Set<(data: unknown) => void>>;
const mockHandlers: HandlerMap = {};

jest.mock("../../src/api/websocket", () => ({
  gateway: {
    on: jest.fn((event: string, handler: (data: unknown) => void) => {
      if (!mockHandlers[event]) mockHandlers[event] = new Set();
      mockHandlers[event].add(handler);
      return () => mockHandlers[event].delete(handler);
    }),
    isConnected: false,
    connect: jest.fn(),
    disconnect: jest.fn(),
    sendPresenceUpdate: jest.fn(),
    sendVoiceSignal: jest.fn(),
  },
}));

const mockSetUser = jest.fn();
const mockSetServers = jest.fn();
const mockUpdateMemberPresence = jest.fn();
const mockFetchMembers = jest.fn().mockResolvedValue(undefined);
const mockAddMessage = jest.fn();
const mockUpdateMessage = jest.fn();
const mockRemoveMessage = jest.fn();
const mockIncrementUnread = jest.fn();
const mockIncrementMention = jest.fn();
const mockSetUnreadCounts = jest.fn();
const mockSetMentionCounts = jest.fn();

// These must be prefixed with "mock" to be accessible inside jest.mock() factories
let mockActiveServerId: string | null = null;
let mockActiveChannelId: string | null = "ch-1";
let mockCurrentUser: { id: string; username?: string } | null = null;

jest.mock("../../src/stores/authStore", () => ({
  useAuthStore: Object.assign(
    (selector: (s: object) => unknown) => selector({ setUser: mockSetUser }),
    { getState: () => ({ user: mockCurrentUser, setUser: mockSetUser }) },
  ),
}));

jest.mock("../../src/stores/serverStore", () => ({
  useServerStore: (selector: (s: object) => unknown) =>
    selector({
      setServers: mockSetServers,
      updateMemberPresence: mockUpdateMemberPresence,
      fetchMembers: mockFetchMembers,
      activeServerId: mockActiveServerId,
    }),
}));

jest.mock("../../src/stores/messageStore", () => ({
  useMessageStore: {
    getState: () => ({
      addMessage: mockAddMessage,
      updateMessage: mockUpdateMessage,
      removeMessage: mockRemoveMessage,
    }),
  },
}));

jest.mock("../../src/stores/channelStore", () => ({
  useChannelStore: {
    getState: () => ({ activeChannelId: mockActiveChannelId }),
  },
}));

jest.mock("../../src/stores/readStateStore", () => ({
  useReadStateStore: {
    getState: () => ({
      incrementUnread: mockIncrementUnread,
      incrementMention: mockIncrementMention,
      setUnreadCounts: mockSetUnreadCounts,
      setMentionCounts: mockSetMentionCounts,
    }),
  },
}));

jest.mock("../../src/stores/dmStore", () => ({
  useDmStore: {
    getState: () => ({
      setDmChannels: jest.fn(),
      addDmChannel: jest.fn(),
      addDmMessage: jest.fn(),
      activeDmChannelId: null,
    }),
  },
}));

function emit(event: string, data?: unknown) {
  mockHandlers[event]?.forEach((h) => h(data));
}

function makeMessage(id: string, channelId = "ch-1", authorId = "u1") {
  return {
    id,
    channel_id: channelId,
    author_id: authorId,
    content: "Hello",
    reply_to: null,
    mention_user_ids: [] as string[],
    mention_everyone: false,
    edited_at: null,
    deleted: false,
    created_at: "2024-01-01",
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(mockHandlers).forEach((k) => delete mockHandlers[k]);
  mockActiveServerId = null;
  mockActiveChannelId = "ch-1";
  mockCurrentUser = null;
});

describe("useWebSocket", () => {
  it("MESSAGE_CREATE adds message when channel_id matches active channel", () => {
    renderHook(() => useWebSocket());
    const msg = makeMessage("1", "ch-1");

    act(() => {
      emit("MESSAGE_CREATE", msg);
    });

    expect(mockAddMessage).toHaveBeenCalledWith(msg);
  });

  it("MESSAGE_CREATE does NOT add message for a different channel", () => {
    renderHook(() => useWebSocket());
    const msg = makeMessage("2", "ch-other");

    act(() => {
      emit("MESSAGE_CREATE", msg);
    });

    expect(mockAddMessage).not.toHaveBeenCalled();
    expect(mockIncrementUnread).toHaveBeenCalledWith("ch-other");
  });

  it("MESSAGE_CREATE to non-active channel with mention_everyone calls incrementMention", () => {
    mockCurrentUser = { id: "u-viewer" };
    renderHook(() => useWebSocket());
    const msg = {
      ...makeMessage("3", "ch-other", "u-sender"),
      mention_everyone: true,
    };

    act(() => {
      emit("MESSAGE_CREATE", msg);
    });

    expect(mockIncrementMention).toHaveBeenCalledWith("ch-other");
  });

  it("MESSAGE_CREATE with mention_everyone from self does NOT call incrementMention", () => {
    mockCurrentUser = { id: "u1" };
    renderHook(() => useWebSocket());
    const msg = {
      ...makeMessage("4", "ch-other", "u1"),
      mention_everyone: true,
    };

    act(() => {
      emit("MESSAGE_CREATE", msg);
    });

    expect(mockIncrementMention).not.toHaveBeenCalled();
    expect(mockIncrementUnread).toHaveBeenCalledWith("ch-other");
  });

  it("MESSAGE_CREATE to non-active channel with user in mention_user_ids calls incrementMention", () => {
    mockCurrentUser = { id: "u-viewer" };
    renderHook(() => useWebSocket());
    const msg = {
      ...makeMessage("5", "ch-other", "u-sender"),
      mention_user_ids: ["u-viewer"],
    };

    act(() => {
      emit("MESSAGE_CREATE", msg);
    });

    expect(mockIncrementMention).toHaveBeenCalledWith("ch-other");
  });

  it("MESSAGE_CREATE to non-active channel without mention does not call incrementMention", () => {
    mockCurrentUser = { id: "u-viewer" };
    renderHook(() => useWebSocket());
    const msg = makeMessage("6", "ch-other", "u-sender");

    act(() => {
      emit("MESSAGE_CREATE", msg);
    });

    expect(mockIncrementMention).not.toHaveBeenCalled();
  });

  it("MESSAGE_DELETE removes message when channel_id matches active channel", () => {
    renderHook(() => useWebSocket());
    const event = { id: "1", channel_id: "ch-1" };

    act(() => {
      emit("MESSAGE_DELETE", event);
    });

    expect(mockRemoveMessage).toHaveBeenCalledWith(event);
  });

  it("PRESENCE_UPDATE calls updateMemberPresence", () => {
    renderHook(() => useWebSocket());
    const event = { user_id: "u1", status: "away", custom_status: "coding" };

    act(() => {
      emit("PRESENCE_UPDATE", event);
    });

    expect(mockUpdateMemberPresence).toHaveBeenCalledWith(
      "u1",
      "away",
      "coding",
    );
  });

  it("READY event calls setMentionCounts with mention_counts payload", () => {
    renderHook(() => useWebSocket());
    const data = {
      user: { id: "u1" },
      servers: [],
      dm_channels: [],
      unread_counts: [],
      mention_counts: [{ channel_id: "ch-1", count: 3 }],
    };

    act(() => {
      emit("READY", data);
    });

    expect(mockSetMentionCounts).toHaveBeenCalledWith([
      { channel_id: "ch-1", count: 3 },
    ]);
  });

  it("connected event triggers fetchMembers when activeServerId is set", () => {
    mockActiveServerId = "srv-1";
    renderHook(() => useWebSocket());

    act(() => {
      emit("connected");
    });

    expect(mockFetchMembers).toHaveBeenCalledWith("srv-1");
  });

  it("cleanup unsubscribes all gateway handlers on unmount", () => {
    const { unmount } = renderHook(() => useWebSocket());

    const countBefore = Object.values(mockHandlers).reduce(
      (sum, set) => sum + set.size,
      0,
    );
    expect(countBefore).toBeGreaterThan(0);

    unmount();

    const countAfter = Object.values(mockHandlers).reduce(
      (sum, set) => sum + set.size,
      0,
    );
    expect(countAfter).toBe(0);
  });
});
