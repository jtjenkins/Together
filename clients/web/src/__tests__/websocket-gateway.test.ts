import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebSocketClient } from "../api/websocket";

// ─── Mock WebSocket ──────────────────────────────────────────────────────────

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  static instances: MockWebSocket[] = [];

  url: string;
  readyState = MockWebSocket.OPEN;
  onopen: ((ev?: Event) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((ev?: Event) => void) | null = null;

  send = vi.fn();
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  /** Simulate the server opening the connection */
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  /** Simulate receiving a message from the server */
  simulateMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  /** Simulate the connection closing */
  simulateClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  /** Simulate a connection error */
  simulateError() {
    this.onerror?.();
  }
}

// Replace global WebSocket
const OriginalWebSocket = globalThis.WebSocket;

beforeEach(() => {
  MockWebSocket.instances = [];
  (globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket =
    MockWebSocket as unknown as typeof WebSocket;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.WebSocket = OriginalWebSocket;
});

function createGateway(): WebSocketClient {
  const gw = new WebSocketClient();
  // Set a server URL so connect() works
  gw.setServerUrl("http://test.local");
  return gw;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("WebSocketClient", () => {
  describe("connection lifecycle", () => {
    it("should connect with the token in the URL", () => {
      const gw = createGateway();
      gw.connect("my-token");

      expect(MockWebSocket.instances.length).toBe(1);
      expect(MockWebSocket.instances[0].url).toContain("token=my-token");
    });

    it("should set isConnected to true on open", () => {
      const gw = createGateway();
      gw.connect("tok");
      const ws = MockWebSocket.instances[0];

      expect(gw.isConnected).toBe(false);
      ws.simulateOpen();
      expect(gw.isConnected).toBe(true);
    });

    it("should emit connected event on open", () => {
      const gw = createGateway();
      const handler = vi.fn();
      gw.on("connected", handler);

      gw.connect("tok");
      MockWebSocket.instances[0].simulateOpen();

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should set isConnected to false on close", () => {
      const gw = createGateway();
      gw.connect("tok");
      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();
      expect(gw.isConnected).toBe(true);

      ws.simulateClose();
      expect(gw.isConnected).toBe(false);
    });

    it("should emit disconnected event on close", () => {
      const gw = createGateway();
      const handler = vi.fn();
      gw.on("disconnected", handler);

      gw.connect("tok");
      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();
      ws.simulateClose();

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should disconnect and clear the token", () => {
      const gw = createGateway();
      gw.connect("tok");
      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();

      gw.disconnect();

      expect(ws.close).toHaveBeenCalled();
      expect(gw.isConnected).toBe(false);
    });

    it("should not connect without a token", () => {
      const gw = createGateway();
      // doConnect is private but connect sets token first
      gw.disconnect();
      // Without calling connect, no WebSocket should be created
      expect(MockWebSocket.instances.length).toBe(0);
    });

    it("should connect using the default wsBase derived from location", () => {
      // In jsdom, resolveWsBase() derives from location.host
      const gw = new WebSocketClient();
      gw.connect("tok");
      // Should create a WebSocket using the location-derived URL
      expect(MockWebSocket.instances.length).toBe(1);
      expect(MockWebSocket.instances[0].url).toContain("token=tok");
    });
  });

  describe("event registration and dispatch", () => {
    it("should dispatch DISPATCH events to registered handlers", () => {
      const gw = createGateway();
      const handler = vi.fn();
      gw.on("MESSAGE_CREATE", handler);

      gw.connect("tok");
      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();

      ws.simulateMessage({
        op: "DISPATCH",
        t: "MESSAGE_CREATE",
        d: { id: "msg-1", content: "hello" },
      });

      expect(handler).toHaveBeenCalledWith({
        id: "msg-1",
        content: "hello",
      });
    });

    it("should support multiple handlers for the same event", () => {
      const gw = createGateway();
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      gw.on("MESSAGE_CREATE", handler1);
      gw.on("MESSAGE_CREATE", handler2);

      gw.connect("tok");
      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();

      ws.simulateMessage({
        op: "DISPATCH",
        t: "MESSAGE_CREATE",
        d: { id: "msg-1" },
      });

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it("should return an unsubscribe function from on()", () => {
      const gw = createGateway();
      const handler = vi.fn();
      const unsub = gw.on("MESSAGE_CREATE", handler);

      gw.connect("tok");
      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();

      // Unsubscribe
      unsub();

      ws.simulateMessage({
        op: "DISPATCH",
        t: "MESSAGE_CREATE",
        d: { id: "msg-1" },
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it("should ignore DISPATCH without t or d", () => {
      const gw = createGateway();
      const handler = vi.fn();
      gw.on("MESSAGE_CREATE", handler);

      gw.connect("tok");
      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();

      // Missing t
      ws.simulateMessage({ op: "DISPATCH", t: null, d: { id: "msg-1" } });
      // Missing d
      ws.simulateMessage({ op: "DISPATCH", t: "MESSAGE_CREATE" });

      expect(handler).not.toHaveBeenCalled();
    });

    it("should ignore messages without op", () => {
      const gw = createGateway();
      const handler = vi.fn();
      gw.on("MESSAGE_CREATE", handler);

      gw.connect("tok");
      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();

      ws.simulateMessage({ t: "MESSAGE_CREATE", d: { id: "1" } });
      expect(handler).not.toHaveBeenCalled();
    });

    it("should handle malformed JSON gracefully", () => {
      const gw = createGateway();
      gw.connect("tok");
      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      // Send raw invalid JSON
      ws.onmessage?.({ data: "not-json{" });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("malformed"),
      );
      warnSpy.mockRestore();
    });

    it("should handle dispatch errors without crashing", () => {
      const gw = createGateway();
      const errorHandler = vi.fn().mockImplementation(() => {
        throw new Error("handler error");
      });
      gw.on("MESSAGE_CREATE", errorHandler);

      gw.connect("tok");
      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();

      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // Should not throw
      ws.simulateMessage({
        op: "DISPATCH",
        t: "MESSAGE_CREATE",
        d: { id: "1" },
      });

      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it("should silently handle HEARTBEAT_ACK", () => {
      const gw = createGateway();
      gw.connect("tok");
      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();

      // Should not throw
      ws.simulateMessage({ op: "HEARTBEAT_ACK", t: null, d: null });
    });

    it("should dispatch PRESENCE_UPDATE events", () => {
      const gw = createGateway();
      const handler = vi.fn();
      gw.on("PRESENCE_UPDATE", handler);

      gw.connect("tok");
      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();

      ws.simulateMessage({
        op: "DISPATCH",
        t: "PRESENCE_UPDATE",
        d: { user_id: "u1", status: "online" },
      });

      expect(handler).toHaveBeenCalledWith({
        user_id: "u1",
        status: "online",
      });
    });

    it("should dispatch VOICE_STATE_UPDATE events", () => {
      const gw = createGateway();
      const handler = vi.fn();
      gw.on("VOICE_STATE_UPDATE", handler);

      gw.connect("tok");
      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();

      ws.simulateMessage({
        op: "DISPATCH",
        t: "VOICE_STATE_UPDATE",
        d: { user_id: "u1", channel_id: "ch-1" },
      });

      expect(handler).toHaveBeenCalledWith({
        user_id: "u1",
        channel_id: "ch-1",
      });
    });
  });

  describe("heartbeat", () => {
    it("should send heartbeat messages at HEARTBEAT_INTERVAL", () => {
      const gw = createGateway();
      gw.connect("tok");
      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();

      // Advance past one heartbeat interval (30s)
      vi.advanceTimersByTime(30000);

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ op: "HEARTBEAT", t: null, d: null }),
      );
    });

    it("should stop heartbeat on disconnect", () => {
      const gw = createGateway();
      gw.connect("tok");
      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();

      gw.disconnect();

      // Clear previous calls
      ws.send.mockClear();

      vi.advanceTimersByTime(60000);

      // No heartbeat should be sent after disconnect
      expect(ws.send).not.toHaveBeenCalled();
    });

    it("should stop heartbeat on close", () => {
      const gw = createGateway();
      gw.connect("tok");
      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();
      ws.simulateClose();

      ws.send.mockClear();
      vi.advanceTimersByTime(60000);
      expect(ws.send).not.toHaveBeenCalled();
    });
  });

  describe("reconnection", () => {
    it("should schedule reconnect on close (exponential backoff)", () => {
      const gw = createGateway();
      gw.connect("tok");
      const ws1 = MockWebSocket.instances[0];
      ws1.simulateOpen();
      ws1.simulateClose();

      // First reconnect: 1s delay
      expect(MockWebSocket.instances.length).toBe(1);
      vi.advanceTimersByTime(1000);
      expect(MockWebSocket.instances.length).toBe(2);
    });

    it("should use exponential backoff for reconnect attempts", () => {
      const gw = createGateway();
      gw.connect("tok");

      // Close #1 → 1s delay
      MockWebSocket.instances[0].simulateOpen();
      MockWebSocket.instances[0].simulateClose();

      vi.advanceTimersByTime(1000);
      expect(MockWebSocket.instances.length).toBe(2);

      // Close #2 → 2s delay
      MockWebSocket.instances[1].simulateClose();
      vi.advanceTimersByTime(1999);
      expect(MockWebSocket.instances.length).toBe(2);
      vi.advanceTimersByTime(1);
      expect(MockWebSocket.instances.length).toBe(3);

      // Close #3 → 4s delay
      MockWebSocket.instances[2].simulateClose();
      vi.advanceTimersByTime(3999);
      expect(MockWebSocket.instances.length).toBe(3);
      vi.advanceTimersByTime(1);
      expect(MockWebSocket.instances.length).toBe(4);
    });

    it("should cap reconnect delay at 30 seconds", () => {
      const gw = createGateway();
      gw.connect("tok");

      // Simulate many close events to increase the delay
      for (let i = 0; i < 10; i++) {
        MockWebSocket.instances[
          MockWebSocket.instances.length - 1
        ].simulateClose();
        vi.advanceTimersByTime(30000);
      }

      // Should have reconnected even with many failures (capped at 30s)
      expect(MockWebSocket.instances.length).toBeGreaterThan(5);
    });

    it("should reset reconnect attempts on successful connection", () => {
      const gw = createGateway();
      gw.connect("tok");

      // Close → reconnect
      MockWebSocket.instances[0].simulateOpen();
      MockWebSocket.instances[0].simulateClose();
      vi.advanceTimersByTime(1000);

      // Second connection opens successfully
      MockWebSocket.instances[1].simulateOpen();

      // Close again → delay should be back to 1s (attempts reset)
      MockWebSocket.instances[1].simulateClose();
      const instancesBefore = MockWebSocket.instances.length;
      vi.advanceTimersByTime(1000);
      expect(MockWebSocket.instances.length).toBe(instancesBefore + 1);
    });

    it("should not reconnect after explicit disconnect", () => {
      const gw = createGateway();
      gw.connect("tok");
      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();

      gw.disconnect();
      // Manually trigger close (which would normally schedule reconnect)
      ws.simulateClose();

      vi.advanceTimersByTime(60000);

      // Only the original WebSocket should exist
      expect(MockWebSocket.instances.length).toBe(1);
    });
  });

  describe("send methods", () => {
    it("sendPresenceUpdate sends correct payload", () => {
      const gw = createGateway();
      gw.connect("tok");
      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();

      gw.sendPresenceUpdate("online", "Working", "Coding");

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({
          op: "PRESENCE_UPDATE",
          t: null,
          d: {
            status: "online",
            custom_status: "Working",
            activity: "Coding",
          },
        }),
      );
    });

    it("sendPresenceUpdate with defaults", () => {
      const gw = createGateway();
      gw.connect("tok");
      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();

      gw.sendPresenceUpdate("idle");

      const payload = JSON.parse(ws.send.mock.calls[0][0]);
      expect(payload.d.custom_status).toBeNull();
      expect(payload.d.activity).toBeNull();
    });

    it("sendVoiceSignal sends offer with sdp", () => {
      const gw = createGateway();
      gw.connect("tok");
      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();

      gw.sendVoiceSignal("u2", "offer", "sdp-data");

      const payload = JSON.parse(ws.send.mock.calls[0][0]);
      expect(payload.op).toBe("VOICE_SIGNAL");
      expect(payload.d.to_user_id).toBe("u2");
      expect(payload.d.type).toBe("offer");
      expect(payload.d.sdp).toBe("sdp-data");
    });

    it("sendVoiceSignal sends candidate", () => {
      const gw = createGateway();
      gw.connect("tok");
      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();

      gw.sendVoiceSignal("u2", "candidate", undefined, "candidate-data");

      const payload = JSON.parse(ws.send.mock.calls[0][0]);
      expect(payload.d.type).toBe("candidate");
      expect(payload.d.candidate).toBe("candidate-data");
    });

    it("sendVoiceSignal includes stream_type when provided", () => {
      const gw = createGateway();
      gw.connect("tok");
      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();

      gw.sendVoiceSignal("u2", "offer", "sdp", undefined, "go_live");

      const payload = JSON.parse(ws.send.mock.calls[0][0]);
      expect(payload.d.stream_type).toBe("go_live");
    });

    it("sendTypingStart sends correct payload", () => {
      const gw = createGateway();
      gw.connect("tok");
      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();

      gw.sendTypingStart("ch-1");

      const payload = JSON.parse(ws.send.mock.calls[0][0]);
      expect(payload.op).toBe("TYPING_START");
      expect(payload.d.channel_id).toBe("ch-1");
    });

    it("should not send when WebSocket is not open", () => {
      const gw = createGateway();
      gw.connect("tok");
      const ws = MockWebSocket.instances[0];
      // Don't call simulateOpen — readyState stays OPEN by default in mock
      // but let's set it to CLOSED
      ws.readyState = MockWebSocket.CLOSED;

      gw.sendPresenceUpdate("online");

      expect(ws.send).not.toHaveBeenCalled();
    });
  });

  describe("setServerUrl", () => {
    it("should derive ws: from http:", () => {
      const gw = new WebSocketClient();
      gw.setServerUrl("http://myserver.com");
      gw.connect("tok");

      expect(MockWebSocket.instances[0].url).toContain("ws://myserver.com/ws");
    });

    it("should derive wss: from https:", () => {
      const gw = new WebSocketClient();
      gw.setServerUrl("https://secure.example.com");
      gw.connect("tok");

      expect(MockWebSocket.instances[0].url).toContain(
        "wss://secure.example.com/ws",
      );
    });

    it("should reconnect if already connected when URL changes", () => {
      const gw = new WebSocketClient();
      gw.setServerUrl("http://old.local");
      gw.connect("tok");
      const ws1 = MockWebSocket.instances[0];
      ws1.simulateOpen();

      expect(ws1.close).not.toHaveBeenCalled();

      gw.setServerUrl("http://new.local");

      // Old connection should be closed
      expect(ws1.close).toHaveBeenCalled();
      // New connection should be created
      expect(MockWebSocket.instances.length).toBe(2);
      expect(MockWebSocket.instances[1].url).toContain("ws://new.local/ws");
    });
  });
});
