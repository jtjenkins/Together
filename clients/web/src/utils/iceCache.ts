import { api } from "../api/client";

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
      cache = { servers, expiresAt: Date.now() + (res.ttl || 86400) * 1000 };
      return servers;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
