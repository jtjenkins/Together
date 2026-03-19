/**
 * HTTP load test — 500 concurrent users
 *
 * Architecture:
 *   setup()      — registers all VU users upfront (respects rate limiter),
 *                  creates shared server + channels, returns credentials array
 *   default(data) — each VU picks its pre-registered credential by index and
 *                   runs the authenticated workload mix
 *
 * Workload mix (realistic gaming-community usage):
 *   40% read messages
 *   25% browse servers / channels
 *   20% send messages
 *   10% refresh token
 *    5% profile read
 *
 * Run:
 *   k6 run load-tests/test-http.js
 *   k6 run --env VU_COUNT=100 --env DURATION=2m load-tests/test-http.js
 */

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Trend, Rate, Counter } from "k6/metrics";
import {
  BASE_URL,
  VU_COUNT,
  DURATION,
  RAMP_DURATION,
  randomMessage,
} from "./config.js";

// ── Custom metrics ────────────────────────────────────────────────────────────
const msgSendLatency = new Trend("msg_send_latency", true);
const msgListLatency = new Trend("msg_list_latency", true);
const loginLatency = new Trend("login_latency", true);
const errorRate = new Rate("error_rate");
const msgsSent = new Counter("messages_sent");

// ── Test options ──────────────────────────────────────────────────────────────
export const options = {
  setupTimeout: "5m",
  stages: [
    { duration: RAMP_DURATION, target: Math.floor(VU_COUNT * 0.25) },
    { duration: "30s", target: Math.floor(VU_COUNT * 0.75) },
    { duration: "30s", target: VU_COUNT },
    { duration: DURATION, target: VU_COUNT },
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    msg_send_latency: ["p(95)<500", "p(99)<2000"],
    msg_list_latency: ["p(95)<200", "p(99)<500"],
    login_latency: ["p(95)<500", "p(99)<1500"],
    error_rate: ["rate<0.01"],
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(99)<2000"],
  },
  summaryTrendStats: ["min", "med", "avg", "p(90)", "p(95)", "p(99)", "max"],
};

// ── Setup: register all VU users + create shared fixtures ─────────────────────
export function setup() {
  const password = "LoadPass99!";

  // 1. Register admin and create shared server
  const adminUsername = `lt_admin_${Date.now()}`;
  const regRes = http.post(
    `${BASE_URL}/auth/register`,
    JSON.stringify({ username: adminUsername, password }),
    { headers: { "Content-Type": "application/json" } },
  );
  if (regRes.status !== 201) {
    throw new Error(
      `Admin registration failed: ${regRes.status} ${regRes.body}`,
    );
  }
  const adminToken = regRes.json().access_token;
  const adminH = {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
  };

  const srRes = http.post(
    `${BASE_URL}/servers`,
    JSON.stringify({ name: `LT HTTP ${Date.now()}`, is_public: true }),
    adminH,
  );
  if (srRes.status !== 201) {
    throw new Error(`Server creation failed: ${srRes.status}`);
  }
  const serverId = srRes.json().id;

  // Collect all channel IDs
  const chRes = http.get(`${BASE_URL}/servers/${serverId}/channels`, adminH);
  const channelIds = chRes.json().map((c) => c.id);
  for (const name of ["gaming", "voice-text", "off-topic"]) {
    const cr = http.post(
      `${BASE_URL}/servers/${serverId}/channels`,
      JSON.stringify({ name, type: "text" }),
      adminH,
    );
    if (cr.status === 201) channelIds.push(cr.json().id);
  }

  // Seed 50 messages
  for (let i = 0; i < 50; i++) {
    http.post(
      `${BASE_URL}/channels/${channelIds[0]}/messages`,
      JSON.stringify({ content: `Baseline ${i + 1}: ${randomMessage()}` }),
      adminH,
    );
  }

  // 2. Register a credential pool.
  //    Auth rate limit: 2 req/s burst 5 (per IP).
  //    We register CREDENTIAL_POOL users and distribute them across VUs
  //    (multiple VUs share credentials — valid for perf testing, not security testing).
  // Keep pool small: auth rate limit = 2/s burst 5 (per IP in dev).
  // 20 users × server-paced time ≈ 15–20s. VUs share credentials — valid for perf testing.
  const CREDENTIAL_POOL = Math.min(VU_COUNT, 20);
  console.log(
    `Registering ${CREDENTIAL_POOL} credential pool users (pool shared across ${VU_COUNT} VUs)...`,
  );
  const credentials = [];
  for (let i = 0; i < CREDENTIAL_POOL; i++) {
    const username = `lt_u${i}_${Math.random().toString(36).slice(2, 7)}`;
    let token = null;
    let refreshToken = null;
    let attempts = 0;

    while (!token && attempts < 5) {
      const r = http.post(
        `${BASE_URL}/auth/register`,
        JSON.stringify({ username: `${username}_${attempts}`, password }),
        { headers: { "Content-Type": "application/json" } },
      );
      if (r.status === 201) {
        token = r.json().access_token;
        refreshToken = r.json().refresh_token;
        // Join the shared server
        http.post(`${BASE_URL}/servers/${serverId}/join`, null, {
          headers: { Authorization: `Bearer ${token}` },
        });
      } else if (r.status === 429) {
        // Rate limited — back off and retry
        sleep(0.6);
        continue;
      } else {
        console.warn(`Registration failed for VU ${i}: ${r.status}`);
        break;
      }
      attempts++;
    }

    credentials.push({ token, refreshToken });
    // Small pause between registrations to avoid hitting rate limit hard
    sleep(0.6);

    if (i % 50 === 0) {
      console.log(`  ... ${i}/${VU_COUNT} users registered`);
    }
  }

  console.log(
    `Setup complete. ${credentials.filter((c) => c.token).length}/${VU_COUNT} users ready.`,
  );
  console.log(`serverId=${serverId} channelIds=${channelIds.join(",")}`);
  return { credentials, serverId, channelIds };
}

// ── Main VU loop ──────────────────────────────────────────────────────────────
export default function (data) {
  const { credentials, serverId, channelIds } = data;

  // Each VU gets a stable credential slot (0-indexed, wraps if more VUs than creds)
  const cred = credentials[(__VU - 1) % credentials.length];
  if (!cred || !cred.token) {
    sleep(1);
    return;
  }

  const token = cred.token;
  const authH = {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  };

  const channelId = channelIds[Math.floor(Math.random() * channelIds.length)];
  const roll = Math.random();

  if (roll < 0.4) {
    // 40% — read messages
    group("read_messages", () => {
      const res = http.get(
        `${BASE_URL}/channels/${channelId}/messages?limit=50`,
        { ...authH, tags: { endpoint: "messages_list" } },
      );
      msgListLatency.add(res.timings.duration);
      check(res, { "messages listed": (r) => r.status === 200 });
      errorRate.add(res.status !== 200 ? 1 : 0);
    });
  } else if (roll < 0.65) {
    // 25% — browse servers / channels
    group("browse", () => {
      const sRes = http.get(`${BASE_URL}/servers`, {
        ...authH,
        tags: { endpoint: "servers_list" },
      });
      check(sRes, { "servers listed": (r) => r.status === 200 });
      errorRate.add(sRes.status !== 200 ? 1 : 0);

      if (serverId) {
        const mRes = http.get(`${BASE_URL}/servers/${serverId}/members`, {
          ...authH,
          tags: { endpoint: "members_list" },
        });
        check(mRes, { "members listed": (r) => r.status === 200 });
        errorRate.add(mRes.status !== 200 ? 1 : 0);
      }
    });
  } else if (roll < 0.85) {
    // 20% — send message
    group("send_message", () => {
      const res = http.post(
        `${BASE_URL}/channels/${channelId}/messages`,
        JSON.stringify({ content: randomMessage() }),
        { ...authH, tags: { endpoint: "messages_send" } },
      );
      msgSendLatency.add(res.timings.duration);
      const ok = check(res, { "message sent": (r) => r.status === 201 });
      errorRate.add(!ok ? 1 : 0);
      if (ok) msgsSent.add(1);
    });
  } else if (roll < 0.95) {
    // 10% — refresh token
    group("refresh_token", () => {
      if (!cred.refreshToken) return;
      const res = http.post(
        `${BASE_URL}/auth/refresh`,
        JSON.stringify({ refresh_token: cred.refreshToken }),
        {
          headers: { "Content-Type": "application/json" },
          tags: { endpoint: "refresh" },
        },
      );
      loginLatency.add(res.timings.duration);
      if (check(res, { "token refreshed": (r) => r.status === 200 })) {
        cred.token = res.json().access_token;
        cred.refreshToken = res.json().refresh_token;
      }
      errorRate.add(res.status !== 200 ? 1 : 0);
    });
  } else {
    // 5% — profile
    group("profile", () => {
      const res = http.get(`${BASE_URL}/users/@me`, {
        ...authH,
        tags: { endpoint: "profile" },
      });
      check(res, { "profile ok": (r) => r.status === 200 });
      errorRate.add(res.status !== 200 ? 1 : 0);
    });
  }

  // Think time: 0.5–2s
  sleep(0.5 + Math.random() * 1.5);
}
