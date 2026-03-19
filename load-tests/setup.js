/**
 * Setup script: provisions shared test fixtures used by all load tests.
 *
 * Creates:
 *   - 1 admin user (owner of the test server)
 *   - 1 shared server with 3 text channels (general, gaming, off-topic)
 *   - Returns fixture data that k6 passes to the default function via __ENV
 *
 * Run once before the main load tests via: k6 run setup.js
 * Or import the setup() function in test scripts directly.
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { BASE_URL } from "./config.js";

export const options = {
  vus: 1,
  iterations: 1,
};

export default function () {
  const fixtures = setupFixtures();
  console.log("=== FIXTURES ===");
  console.log(JSON.stringify(fixtures, null, 2));
}

export function setupFixtures() {
  const adminUsername = `lt_admin_${Date.now()}`;
  const adminPassword = "LoadTest123!";

  // Register admin user
  const regRes = http.post(
    `${BASE_URL}/auth/register`,
    JSON.stringify({ username: adminUsername, password: adminPassword }),
    {
      headers: { "Content-Type": "application/json" },
      tags: { endpoint: "register" },
    },
  );
  check(regRes, { "admin registered": (r) => r.status === 201 });
  if (regRes.status !== 201) {
    throw new Error(
      `Admin registration failed: ${regRes.status} ${regRes.body}`,
    );
  }

  const authData = regRes.json();
  const token = authData.access_token;
  const authHeaders = {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  };

  // Create test server
  const serverRes = http.post(
    `${BASE_URL}/servers`,
    JSON.stringify({ name: `LoadTest Server ${Date.now()}`, is_public: true }),
    { ...authHeaders, tags: { endpoint: "create_server" } },
  );
  check(serverRes, { "server created": (r) => r.status === 201 });
  if (serverRes.status !== 201) {
    throw new Error(
      `Server creation failed: ${serverRes.status} ${serverRes.body}`,
    );
  }

  const server = serverRes.json();
  const serverId = server.id;

  // List channels (server auto-creates a general channel)
  const chRes = http.get(`${BASE_URL}/servers/${serverId}/channels`, {
    ...authHeaders,
    tags: { endpoint: "list_channels" },
  });
  check(chRes, { "channels listed": (r) => r.status === 200 });
  const channels = chRes.json();

  // Create additional text channels
  const extraChannels = ["gaming", "off-topic"];
  const channelIds = channels.map((c) => c.id);

  for (const name of extraChannels) {
    const cr = http.post(
      `${BASE_URL}/servers/${serverId}/channels`,
      JSON.stringify({ name, type: "text" }),
      { ...authHeaders, tags: { endpoint: "create_channel" } },
    );
    check(cr, { [`channel ${name} created`]: (r) => r.status === 201 });
    if (cr.status === 201) channelIds.push(cr.json().id);
  }

  // Seed some baseline messages so list queries have data to page through
  for (let i = 0; i < 20; i++) {
    http.post(
      `${BASE_URL}/channels/${channelIds[0]}/messages`,
      JSON.stringify({ content: `Seed message ${i + 1} — load test baseline` }),
      { ...authHeaders, tags: { endpoint: "seed_message" } },
    );
  }

  sleep(0.5);

  return {
    serverId,
    channelIds,
    adminUsername,
    adminPassword,
    adminToken: token,
  };
}
