import type {
  GatewayMessage,
  GatewayOp,
  ReadyEvent,
  Message,
  PresenceUpdateEvent,
  MessageDeleteEvent,
  VoiceStateUpdateEvent,
  VoiceSignalData,
  DmChannelCreateEvent,
  DmMessageCreateEvent,
  ReactionAddEvent,
  ReactionRemoveEvent,
} from "../types";
import { storage } from "../utils/storage";
import { SERVER_URL_KEY } from "../utils/platform";

type EventHandler<T = unknown> = (data: T) => void;

interface EventHandlers {
  READY: EventHandler<ReadyEvent>;
  MESSAGE_CREATE: EventHandler<Message>;
  MESSAGE_UPDATE: EventHandler<Message>;
  MESSAGE_DELETE: EventHandler<MessageDeleteEvent>;
  PRESENCE_UPDATE: EventHandler<PresenceUpdateEvent>;
  VOICE_STATE_UPDATE: EventHandler<VoiceStateUpdateEvent>;
  VOICE_SIGNAL: EventHandler<VoiceSignalData>;
  DM_CHANNEL_CREATE: EventHandler<DmChannelCreateEvent>;
  DM_MESSAGE_CREATE: EventHandler<DmMessageCreateEvent>;
  REACTION_ADD: EventHandler<ReactionAddEvent>;
  REACTION_REMOVE: EventHandler<ReactionRemoveEvent>;
  THREAD_MESSAGE_CREATE: EventHandler<Message>;
  connected: EventHandler<void>;
  disconnected: EventHandler<void>;
  permanently_disconnected: EventHandler<void>;
}

type EventName = keyof EventHandlers;

function resolveWsBase(): string {
  const saved = storage.getItem(SERVER_URL_KEY);
  if (saved) {
    try {
      const url = new URL(saved);
      const wsScheme = url.protocol === "https:" ? "wss:" : "ws:";
      return `${wsScheme}//${url.host}/ws`;
    } catch {
      console.warn(
        `[Gateway] Stored ${SERVER_URL_KEY} "${saved}" is not a valid URL; discarding.`,
      );
      storage.removeItem(SERVER_URL_KEY);
      return "";
    }
  }
  return "";
}

const HEARTBEAT_INTERVAL = 30000;

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private token: string | null = null;
  private handlers: Partial<Record<EventName, Set<EventHandler<never>>>> = {};
  private _isConnected = false;
  private wsBase: string = resolveWsBase();

  get isConnected(): boolean {
    return this._isConnected;
  }

  on<K extends EventName>(event: K, handler: EventHandlers[K]): () => void {
    if (!this.handlers[event]) {
      this.handlers[event] = new Set();
    }
    this.handlers[event]!.add(handler as EventHandler<never>);
    return () => {
      this.handlers[event]?.delete(handler as EventHandler<never>);
    };
  }

  private emit<K extends EventName>(
    event: K,
    data?: Parameters<EventHandlers[K]>[0],
  ) {
    this.handlers[event]?.forEach((handler) => {
      (handler as EventHandler)(data);
    });
  }

  setServerUrl(url: string): void {
    const parsed = new URL(url);
    const wsScheme = parsed.protocol === "https:" ? "wss:" : "ws:";
    this.wsBase = `${wsScheme}//${parsed.host}/ws`;
    if (this.token) {
      this.cleanup();
      this.doConnect();
    }
  }

  connect(token: string) {
    this.token = token;
    this.reconnectAttempts = 0;
    this.doConnect();
  }

  disconnect() {
    this.token = null;
    // Set reconnect counter to max to prevent scheduleReconnect() from retrying after intentional close.
    this.reconnectAttempts = this.maxReconnectAttempts;
    this.cleanup();
  }

  sendPresenceUpdate(status: string, customStatus: string | null = null) {
    this.send({
      op: "PRESENCE_UPDATE" as GatewayOp,
      t: null,
      d: { status, custom_status: customStatus },
    });
  }

  sendVoiceSignal(
    toUserId: string,
    type: "offer" | "answer" | "candidate",
    sdp?: string,
    candidate?: string,
  ) {
    this.send({
      op: "VOICE_SIGNAL" as GatewayOp,
      t: null,
      d: { to_user_id: toUserId, type, sdp, candidate },
    });
  }

  private doConnect() {
    if (!this.token) return;
    if (!this.wsBase) {
      console.error(
        "[Gateway] Cannot connect: no server URL configured. Call setServerUrl() before connect().",
      );
      return;
    }

    this.cleanup();

    const url = `${this.wsBase}?token=${encodeURIComponent(this.token)}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this._isConnected = true;
      this.reconnectAttempts = 0;
      this.startHeartbeat();
      this.emit("connected");
    };

    this.ws.onmessage = (event) => {
      let msg: GatewayMessage;
      try {
        msg = JSON.parse(event.data as string) as GatewayMessage;
      } catch {
        console.warn("[Gateway] Received malformed message, ignoring");
        return;
      }
      try {
        this.handleMessage(msg);
      } catch (err) {
        console.error("[Gateway] Error dispatching message", err);
      }
    };

    this.ws.onclose = () => {
      this._isConnected = false;
      this.stopHeartbeat();
      this.emit("disconnected");
      this.scheduleReconnect();
    };

    this.ws.onerror = (event) => {
      console.error("[Gateway] WebSocket error", event);
    };
  }

  private handleMessage(msg: GatewayMessage) {
    switch (msg.op) {
      case "DISPATCH":
        if (msg.t && msg.d) {
          this.emit(msg.t as EventName, msg.d as never);
        }
        break;
      case "HEARTBEAT_ACK":
        break;
    }
  }

  private send(msg: GatewayMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({ op: "HEARTBEAT" as GatewayOp, t: null, d: null });
    }, HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts || !this.token) {
      if (this.token) {
        console.error(
          `[Gateway] Connection lost — gave up after ${this.maxReconnectAttempts} reconnect attempts`,
        );
        this.emit("permanently_disconnected");
      }
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.doConnect();
    }, delay);
  }

  private cleanup() {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      if (
        this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING
      ) {
        this.ws.close();
      }
      this.ws = null;
    }
    this._isConnected = false;
  }
}

export const gateway = new WebSocketClient();
