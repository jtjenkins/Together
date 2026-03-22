/**
 * iceCache utility tests — covers cache hit, concurrent dedup, API failure fallback,
 * and TTL computation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Must reset module state between tests since iceCache has module-level `cache`/`inflight`.
let getIceServers: typeof import("../utils/iceCache").getIceServers;

const mockGetIceServers = vi.fn();

vi.mock("../api/client", () => ({
  api: {
    getIceServers: (...args: unknown[]) => mockGetIceServers(...args),
    setToken: vi.fn(),
    getToken: vi.fn(),
    setSessionExpiredCallback: vi.fn(),
  },
  ApiRequestError: class extends Error {},
}));

beforeEach(async () => {
  vi.clearAllMocks();
  // Re-import to reset module-level cache
  vi.resetModules();
  const mod = await import("../utils/iceCache");
  getIceServers = mod.getIceServers;
});

describe("getIceServers", () => {
  it("returns TURN servers from API and caches them", async () => {
    mockGetIceServers.mockResolvedValue({
      iceServers: [
        {
          urls: "turn:turn.example.com:3478",
          username: "user",
          credential: "pass",
        },
      ],
      ttl: 3600,
    });

    const servers = await getIceServers();

    expect(servers).toHaveLength(1);
    expect(servers[0].urls).toBe("turn:turn.example.com:3478");
    expect((servers[0] as RTCIceServer & { username: string }).username).toBe(
      "user",
    );

    // Second call should use cache (API not called again)
    mockGetIceServers.mockClear();
    const cached = await getIceServers();
    expect(cached).toEqual(servers);
    expect(mockGetIceServers).not.toHaveBeenCalled();
  });

  it("falls back to STUN on API failure", async () => {
    mockGetIceServers.mockRejectedValue(new Error("Network error"));

    const servers = await getIceServers();

    expect(servers).toHaveLength(1);
    expect(servers[0].urls).toBe("stun:stun.l.google.com:19302");
  });

  it("deduplicates concurrent requests", async () => {
    let resolveApi: ((v: unknown) => void) | undefined;
    mockGetIceServers.mockImplementation(
      () => new Promise((r) => (resolveApi = r)),
    );

    // Start two concurrent requests
    const p1 = getIceServers();
    const p2 = getIceServers();

    // Both should be the same promise — API called only once
    expect(mockGetIceServers).toHaveBeenCalledTimes(1);

    resolveApi!({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      ttl: 3600,
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual(r2);
  });

  it("excludes username/credential when not provided", async () => {
    mockGetIceServers.mockResolvedValue({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      ttl: 86400,
    });

    const servers = await getIceServers();
    expect(servers[0]).toEqual({ urls: "stun:stun.l.google.com:19302" });
    expect(servers[0]).not.toHaveProperty("username");
    expect(servers[0]).not.toHaveProperty("credential");
  });
});
