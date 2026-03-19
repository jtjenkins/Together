/**
 * WebSocket load test — 500 concurrent persistent connections
 *
 * Simulates the real-time layer:
 *   - Each VU opens a persistent WebSocket connection
 *   - Sends IDENTIFY after connect
 *   - Periodically sends typing_start / typing_stop events
 *   - Measures connection establishment time and message round-trip latency
 *   - Tracks connection drops and reconnects
 *
 * Run:
 *   k6 run load-tests/test-websocket.js
 */

import http from "k6/http";
import ws from "k6/ws";
import { check, sleep } from "k6";
import { Trend, Rate, Counter, Gauge } from "k6/metrics";
import {
  BASE_URL,
  WS_URL,
  VU_COUNT,
  DURATION,
  RAMP_DURATION,
  randomMessage,
  randomUsername,
} from "./config.js";

// ── Custom metrics ────────────────────────────────────────────────────────────
const wsConnectTime = new Trend("ws_connect_time", true);
const wsMessageLag = new Trend("ws_message_lag", true);
const wsErrors = new Counter("ws_errors");
const wsReconnects = new Counter("ws_reconnects");
const activeConns = new Gauge("ws_active_connections");
const typingEvents = new Counter("ws_typing_events_sent");

export const options = {
  stages: [
    { duration: RAMP_DURATION, target: Math.floor(VU_COUNT * 0.25) },
    { duration: "30s", target: Math.floor(VU_COUNT * 0.75) },
    { duration: "30s", target: VU_COUNT },
    { duration: DURATION, target: VU_COUNT },
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    ws_connect_time: ["p(95)<1000", "p(99)<3000"],
    ws_message_lag: ["p(95)<100", "p(99)<500"],
    ws_errors: ["count<50"],
    http_req_failed: ["rate<0.01"],
  },
  summaryTrendStats: ["min", "med", "avg", "p(90)", "p(95)", "p(99)", "max"],
};

// ── Per-VU state ──────────────────────────────────────────────────────────────
const vuState = {
  token: null,
  channelId: null,
  serverId: null,
  initialized: false,
};

export function setup() {
  const adminUsername = `lt_ws_admin_${Date.now()}`;
  const password = "LoadTest123!";

  const regRes = http.post(
    `${BASE_URL}/auth/register`,
    JSON.stringify({ username: adminUsername, password }),
    { headers: { "Content-Type": "application/json" } },
  );
  if (regRes.status !== 201) {
    throw new Error(`Setup failed: ${regRes.status} ${regRes.body}`);
  }

  const token = regRes.json().access_token;
  const authH = {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  };

  const srRes = http.post(
    `${BASE_URL}/servers`,
    JSON.stringify({ name: `LT WS Server ${Date.now()}`, is_public: true }),
    authH,
  );
  const serverId = srRes.json().id;
  // Create a text channel (servers may start empty)
  const chCreate = http.post(
    `${BASE_URL}/servers/${serverId}/channels`,
    JSON.stringify({ name: "general", type: "text" }),
    authH,
  );
  if (chCreate.status !== 201) {
    throw new Error(
      `Channel creation failed: ${chCreate.status} ${chCreate.body}`,
    );
  }
  const channelId = chCreate.json().id;

  console.log(`WS setup done. serverId=${serverId} channelId=${channelId}`);
  return { serverId, channelId };
}

export default function (data) {
  const { serverId, channelId } = data;

  // One-time VU registration
  if (!vuState.initialized) {
    const username = randomUsername(__VU);
    const password = "LoadPass99!";

    const regRes = http.post(
      `${BASE_URL}/auth/register`,
      JSON.stringify({ username, password }),
      { headers: { "Content-Type": "application/json" } },
    );

    if (regRes.status !== 201 && regRes.status !== 409) {
      wsErrors.add(1);
      sleep(2);
      return;
    }

    // If 409 (conflict from prior run), try login
    let token;
    if (regRes.status === 201) {
      token = regRes.json().access_token;
    } else {
      const loginRes = http.post(
        `${BASE_URL}/auth/login`,
        JSON.stringify({ username, password }),
        { headers: { "Content-Type": "application/json" } },
      );
      if (loginRes.status !== 200) {
        wsErrors.add(1);
        sleep(2);
        return;
      }
      token = loginRes.json().access_token;
    }

    // Join server
    http.post(`${BASE_URL}/servers/${serverId}/join`, null, {
      headers: { Authorization: `Bearer ${token}` },
    });

    vuState.token = token;
    vuState.channelId = channelId;
    vuState.serverId = serverId;
    vuState.initialized = true;
  }

  if (!vuState.token) {
    sleep(1);
    return;
  }

  const connStart = Date.now();
  let identified = false;
  let pingsSent = 0;
  let lastPingSentAt = 0;

  const response = ws.connect(
    `${WS_URL}?token=${vuState.token}`,
    { tags: { endpoint: "websocket" } },
    function (socket) {
      wsConnectTime.add(Date.now() - connStart);
      activeConns.add(1);

      socket.on("open", () => {
        // Send IDENTIFY
        socket.send(
          JSON.stringify({
            op: "IDENTIFY",
            d: { token: vuState.token },
          }),
        );
      });

      socket.on("message", (rawMsg) => {
        let msg;
        try {
          msg = JSON.parse(rawMsg);
        } catch (_) {
          return;
        }

        if (msg.op === "HELLO") {
          // Server sends heartbeat interval
          const interval = (msg.d && msg.d.heartbeat_interval) || 30000;
          socket.setInterval(() => {
            socket.send(JSON.stringify({ op: "HEARTBEAT" }));
            lastPingSentAt = Date.now();
            pingsSent++;
          }, interval);
        }

        if (msg.op === "READY") {
          identified = true;
        }

        if (msg.op === "HEARTBEAT_ACK" && lastPingSentAt > 0) {
          wsMessageLag.add(Date.now() - lastPingSentAt);
          lastPingSentAt = 0;
        }
      });

      socket.on("error", (e) => {
        wsErrors.add(1);
      });

      socket.on("close", () => {
        activeConns.add(-1);
      });

      // Simulate typing events every 10–20s
      socket.setInterval(
        () => {
          if (!identified) return;
          // typing_start
          socket.send(
            JSON.stringify({
              op: "DISPATCH",
              t: "TYPING_START",
              d: { channel_id: vuState.channelId },
            }),
          );
          typingEvents.add(1);

          // typing_stop after 3s
          socket.setTimeout(() => {
            socket.send(
              JSON.stringify({
                op: "DISPATCH",
                t: "TYPING_STOP",
                d: { channel_id: vuState.channelId },
              }),
            );
            typingEvents.add(1);
          }, 3000);
        },
        10000 + Math.random() * 10000,
      );

      // Hold connection for the test duration
      const holdMs = parseDurationMs(DURATION) + 60000;
      socket.setTimeout(() => {
        socket.close();
      }, holdMs);
    },
  );

  check(response, { "ws connected": (r) => r && r.status === 101 });

  // Brief pause before potential reconnect
  sleep(1 + Math.random() * 2);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseDurationMs(d) {
  const m = d.match(/^(\d+)(s|m|h)$/);
  if (!m) return 180000;
  const n = parseInt(m[1]);
  switch (m[2]) {
    case "s":
      return n * 1000;
    case "m":
      return n * 60 * 1000;
    case "h":
      return n * 3600 * 1000;
    default:
      return 180000;
  }
}
