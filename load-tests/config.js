// Shared configuration for Together load tests
export const BASE_URL = __ENV.BASE_URL || "http://localhost:8080";
export const WS_URL = __ENV.WS_URL || "ws://localhost:8080/ws";

// Test parameters
export const VU_COUNT = parseInt(__ENV.VU_COUNT || "500");
export const DURATION = __ENV.DURATION || "3m";
export const RAMP_DURATION = __ENV.RAMP_DURATION || "30s";

// Thresholds based on project SLOs from CLAUDE.md:
//   <50ms message delivery latency
//   <200MB server memory at target scale
export const THRESHOLDS = {
  // 95th percentile response times
  "http_req_duration{endpoint:health}": ["p(95)<50"],
  "http_req_duration{endpoint:login}": ["p(95)<500"],
  "http_req_duration{endpoint:messages_list}": ["p(95)<200"],
  "http_req_duration{endpoint:messages_send}": ["p(95)<500"],
  "http_req_duration{endpoint:servers_list}": ["p(95)<200"],
  // Overall
  http_req_failed: ["rate<0.01"], // <1% error rate
  http_req_duration: ["p(99)<2000"], // 99th percentile <2s
};

// Word list for generating realistic message content
export const WORDS = [
  "hey",
  "anyone",
  "online",
  "what",
  "time",
  "is",
  "it",
  "we",
  "should",
  "play",
  "tonight",
  "good",
  "game",
  "last",
  "night",
  "gg",
  "nice",
  "shot",
  "lets",
  "go",
  "team",
  "voice",
  "chat",
  "now",
  "brb",
  "afk",
  "back",
  "ready",
  "queue",
  "up",
  "win",
  "lose",
  "rematch",
  "discord",
  "server",
  "channel",
  "update",
  "check",
  "link",
  "posted",
  "above",
  "seen",
  "this",
];

export function randomMessage() {
  const len = 4 + Math.floor(Math.random() * 8);
  return Array.from(
    { length: len },
    () => WORDS[Math.floor(Math.random() * WORDS.length)],
  ).join(" ");
}

export function randomUsername(suffix) {
  return `loadtest_${suffix}_${Math.random().toString(36).slice(2, 8)}`;
}
