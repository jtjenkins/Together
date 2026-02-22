import { WebSocketClient } from "../../src/api/websocket";

// Minimal WebSocket mock
class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;

  constructor(public url: string) {
    // Simulate async open via setTimeout(0) so fake timers control it
    setTimeout(() => this.onopen?.(), 0);
  }

  send = jest.fn();
  close = jest.fn(() => {
    this.readyState = 3; // CLOSED
    this.onclose?.();
  });
}

(globalThis as unknown as { WebSocket: unknown }).WebSocket = MockWebSocket;

jest.mock("../../src/utils/storage", () => ({
  storage: {
    getItem: jest.fn(() => "https://together.test"),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

/** Advance timers by 1ms — enough to fire setTimeout(0) without triggering
 *  the 30s heartbeat setInterval. */
function flushOpen() {
  jest.advanceTimersByTime(1);
}

function makeClient() {
  return new WebSocketClient();
}

type InternalClient = {
  ws: MockWebSocket | null;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
};

describe("WebSocketClient", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe("on / emit", () => {
    it("fires registered handler with data", () => {
      const client = makeClient();
      const handler = jest.fn();
      client.on("connected", handler);
      client.connect("fake-token");
      flushOpen();
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("returns an unsubscribe function that stops further events", () => {
      const client = makeClient();
      const handler = jest.fn();
      const off = client.on("connected", handler);
      off();
      client.connect("tok");
      flushOpen();
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("connect", () => {
    it("builds a WebSocket URL containing the token", () => {
      const client = makeClient();
      client.setServerUrl("https://together.test");
      client.connect("mytoken");
      const ws = (client as unknown as InternalClient).ws;
      expect(ws?.url).toContain("token=mytoken");
      expect(ws?.url).toMatch(/^wss:\/\//);
    });
  });

  describe("disconnect", () => {
    it("sets isConnected to false", () => {
      const client = makeClient();
      client.connect("tok");
      flushOpen();
      client.disconnect();
      expect(client.isConnected).toBe(false);
    });
  });

  describe("permanently_disconnected", () => {
    it("emits permanently_disconnected when max attempts are exhausted", () => {
      const client = makeClient();
      client.setServerUrl("https://together.test");
      const handler = jest.fn();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).on("permanently_disconnected", handler);

      client.connect("tok");
      flushOpen();

      // Exhaust reconnect attempts directly so we don't need to simulate
      // the full exponential-backoff sequence (1s, 2s, 4s, 8s, 16s).
      const internal = client as unknown as InternalClient;
      internal.reconnectAttempts = internal.maxReconnectAttempts;

      // The next close should hit the "gave up" path and emit the event.
      const ws = internal.ws;
      ws?.close();

      expect(handler).toHaveBeenCalled();
    });
  });

  describe("sendVoiceSignal", () => {
    it("sends a VOICE_SIGNAL message over the WebSocket", () => {
      const client = makeClient();
      client.setServerUrl("https://together.test");
      client.connect("tok");
      flushOpen();

      const ws = (client as unknown as InternalClient).ws;
      client.sendVoiceSignal("user-2", "offer", "sdp-data");

      expect(ws?.send).toHaveBeenCalledWith(
        expect.stringContaining('"VOICE_SIGNAL"'),
      );
      const payload = JSON.parse(
        (ws?.send as jest.Mock).mock.calls[0][0] as string,
      );
      expect(payload.d.to_user_id).toBe("user-2");
      expect(payload.d.type).toBe("offer");
    });
  });

  describe("setServerUrl", () => {
    it("reconnects when a token is already set", () => {
      const client = makeClient();
      client.setServerUrl("https://together.test");
      client.connect("tok");
      flushOpen();

      const firstWs = (client as unknown as InternalClient).ws;
      client.setServerUrl("https://other.test");

      const secondWs = (client as unknown as InternalClient).ws;
      expect(secondWs).not.toBe(firstWs);
      expect(secondWs?.url).toContain("other.test");
    });

    it("does not reconnect when no token is set", () => {
      const client = makeClient();
      client.setServerUrl("https://together.test");
      // No connect() → no token
      client.setServerUrl("https://other.test");
      const ws = (client as unknown as InternalClient).ws;
      expect(ws).toBeNull();
    });
  });
});
