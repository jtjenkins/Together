/**
 * Voice channel load test — signaling path only
 *
 * Tests the REST signaling endpoints (join/leave/update voice state) under load.
 * Actual WebRTC media (UDP) is out-of-scope for k6; this validates the
 * control-plane under 500-user concurrent access.
 *
 * Measured:
 *   - Voice join latency
 *   - Voice leave latency
 *   - Voice state update latency (mute/unmute)
 *   - Participant list query latency
 *
 * Run:
 *   k6 run load-tests/test-voice.js
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate, Counter } from "k6/metrics";
import {
  BASE_URL,
  VU_COUNT,
  DURATION,
  RAMP_DURATION,
  randomUsername,
} from "./config.js";

// ── Custom metrics ────────────────────────────────────────────────────────────
const voiceJoinLatency = new Trend("voice_join_latency", true);
const voiceLeaveLatency = new Trend("voice_leave_latency", true);
const voiceUpdateLatency = new Trend("voice_update_latency", true);
const voiceListLatency = new Trend("voice_list_latency", true);
const errorRate = new Rate("voice_error_rate");
const voiceJoins = new Counter("voice_joins");

export const options = {
  stages: [
    { duration: RAMP_DURATION, target: Math.floor(VU_COUNT * 0.1) }, // voice rooms smaller
    { duration: "30s", target: Math.floor(VU_COUNT * 0.1) },
    { duration: DURATION, target: Math.floor(VU_COUNT * 0.1) }, // 10% in voice (50 users)
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    voice_join_latency: ["p(95)<300", "p(99)<1000"],
    voice_leave_latency: ["p(95)<200", "p(99)<500"],
    voice_update_latency: ["p(95)<200", "p(99)<500"],
    voice_list_latency: ["p(95)<100", "p(99)<300"],
    voice_error_rate: ["rate<0.02"],
    http_req_failed: ["rate<0.02"],
  },
  summaryTrendStats: ["min", "med", "avg", "p(90)", "p(95)", "p(99)", "max"],
};

const vuState = { token: null, initialized: false };

export function setup() {
  const adminUsername = `lt_voice_admin_${Date.now()}`;
  const password = "LoadTest123!";

  const regRes = http.post(
    `${BASE_URL}/auth/register`,
    JSON.stringify({ username: adminUsername, password }),
    { headers: { "Content-Type": "application/json" } },
  );
  if (regRes.status !== 201)
    throw new Error(`Voice setup failed: ${regRes.status}`);

  const token = regRes.json().access_token;
  const authH = {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  };

  // Create a server with a voice channel
  const srRes = http.post(
    `${BASE_URL}/servers`,
    JSON.stringify({ name: `LT Voice Server ${Date.now()}`, is_public: true }),
    authH,
  );
  const serverId = srRes.json().id;

  const vcRes = http.post(
    `${BASE_URL}/servers/${serverId}/channels`,
    JSON.stringify({ name: "general-voice", type: "voice" }),
    authH,
  );
  if (vcRes.status !== 201)
    throw new Error(
      `Voice channel creation failed: ${vcRes.status} ${vcRes.body}`,
    );
  const voiceChannelId = vcRes.json().id;

  console.log(
    `Voice setup done. serverId=${serverId} voiceChannelId=${voiceChannelId}`,
  );
  return { serverId, voiceChannelId };
}

export default function (data) {
  const { serverId, voiceChannelId } = data;

  if (!vuState.initialized) {
    const username = randomUsername(`v${__VU}`);
    const password = "LoadPass99!";

    const regRes = http.post(
      `${BASE_URL}/auth/register`,
      JSON.stringify({ username, password }),
      { headers: { "Content-Type": "application/json" } },
    );
    if (regRes.status !== 201) {
      errorRate.add(1);
      sleep(2);
      return;
    }

    vuState.token = regRes.json().access_token;
    vuState.initialized = true;

    // Join the server
    http.post(`${BASE_URL}/servers/${serverId}/join`, null, {
      headers: { Authorization: `Bearer ${vuState.token}` },
    });
  }

  const authH = {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${vuState.token}`,
    },
    tags: { endpoint: "voice" },
  };

  // Join voice channel (POST /channels/:id/voice)
  const joinRes = http.post(
    `${BASE_URL}/channels/${voiceChannelId}/voice`,
    JSON.stringify({ muted: false, deafened: false }),
    authH,
  );
  voiceJoinLatency.add(joinRes.timings.duration);
  const joined = check(joinRes, {
    "voice joined": (r) => r.status === 200 || r.status === 201,
  });
  errorRate.add(!joined ? 1 : 0);
  if (joined) voiceJoins.add(1);

  sleep(0.5 + Math.random());

  // List participants (GET /channels/:id/voice)
  const listRes = http.get(
    `${BASE_URL}/channels/${voiceChannelId}/voice`,
    authH,
  );
  voiceListLatency.add(listRes.timings.duration);
  check(listRes, { "participants listed": (r) => r.status === 200 });
  errorRate.add(listRes.status !== 200 ? 1 : 0);

  sleep(0.5);

  // Simulate mute/unmute cycles
  for (let i = 0; i < 3; i++) {
    const muted = i % 2 === 0;
    const updateRes = http.patch(
      `${BASE_URL}/channels/${voiceChannelId}/voice`,
      JSON.stringify({ self_mute: muted, self_deaf: false }),
      authH,
    );
    voiceUpdateLatency.add(updateRes.timings.duration);
    check(updateRes, { "voice state updated": (r) => r.status === 200 });
    errorRate.add(updateRes.status !== 200 ? 1 : 0);
    sleep(1 + Math.random() * 2);
  }

  // Leave voice channel (DELETE /channels/:id/voice)
  const leaveRes = http.del(
    `${BASE_URL}/channels/${voiceChannelId}/voice`,
    null,
    authH,
  );
  voiceLeaveLatency.add(leaveRes.timings.duration);
  check(leaveRes, {
    "voice left": (r) => r.status === 200 || r.status === 204,
  });
  errorRate.add(leaveRes.status !== 200 && leaveRes.status !== 204 ? 1 : 0);

  // Simulate idle time between calls
  sleep(5 + Math.random() * 10);
}
