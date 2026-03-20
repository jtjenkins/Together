import { api } from "../api/client";

/** STUN-only fallback when TURN credentials cannot be fetched. */
const STUN_FALLBACK: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
];

let cache: { servers: RTCIceServer[]; expiresAt: number } | null = null;
let inflight: Promise<RTCIceServer[]> | null = null;

export async function getIceServers(): Promise<RTCIceServer[]> {
  if (cache && Date.now() < cache.expiresAt) {
    return cache.servers;
  }
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await api.getIceServers();
      const servers = res.iceServers.map((s) => ({
        urls: s.urls,
        ...(s.username && { username: s.username }),
        ...(s.credential && { credential: s.credential }),
      }));
      // Subtract 60s from TTL to avoid using expired TURN credentials
      const ttlMs = Math.max((res.ttl || 86400) - 60, 60) * 1000;
      cache = { servers, expiresAt: Date.now() + ttlMs };
      return servers;
    } catch (e) {
      console.warn("Failed to fetch ICE servers, using STUN fallback:", e);
      return STUN_FALLBACK;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
