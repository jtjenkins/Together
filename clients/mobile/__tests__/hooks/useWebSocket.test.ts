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

// These must be prefixed with "mock" to be accessible inside jest.mock() factories
let mockActiveServerId: string | null = null;
let mockActiveChannelId: string | null = "ch-1";

jest.mock("../../src/stores/authStore", () => ({
  useAuthStore: (selector: (s: object) => unknown) =>
    selector({ setUser: mockSetUser }),
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

function emit(event: string, data?: unknown) {
  mockHandlers[event]?.forEach((h) => h(data));
}

function makeMessage(id: string, channelId = "ch-1") {
  return {
    id,
    channel_id: channelId,
    author_id: "u1",
    content: "Hello",
    reply_to: null,
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
