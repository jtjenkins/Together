/**
 * useGoLive — manages Go Live broadcast sessions within a voice channel.
 *
 * Architecture:
 * - Broadcaster: calls startBroadcast(quality) which acquires a getDisplayMedia
 *   stream and creates dedicated "go_live" labelled WebRTC peer connections
 *   (separate from the audio voice connections) to each channel participant.
 * - Viewers: receive GO_LIVE_START via WebSocket, then handle incoming
 *   "go_live" VOICE_SIGNAL offers — their video streams are surfaced via
 *   `viewerStream` for rendering in GoLiveViewer.
 *
 * Quality constraints map to getDisplayMedia video constraints:
 *   480p → 854×480 @ 15fps
 *   720p → 1280×720 @ 30fps
 *  1080p → 1920×1080 @ 30fps
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { gateway } from "../api/websocket";
import { api } from "../api/client";
import { getIceServers } from "../utils/iceCache";
import type { GoLiveQuality, GoLiveSession, VoiceParticipant } from "../types";

// ─── Quality presets ──────────────────────────────────────────────────────────

interface QualityConstraints {
  width: number;
  height: number;
  frameRate: number;
}

const QUALITY_MAP: Record<GoLiveQuality, QualityConstraints> = {
  "480p": { width: 854, height: 480, frameRate: 15 },
  "720p": { width: 1280, height: 720, frameRate: 30 },
  "1080p": { width: 1920, height: 1080, frameRate: 30 },
};

// ─── Hook interface ───────────────────────────────────────────────────────────

export interface UseGoLiveOptions {
  /** Whether the user is connected to the voice channel. */
  enabled: boolean;
  /** The voice channel ID. */
  channelId: string;
  /** The current user's ID. */
  myUserId: string;
  /** Current voice channel participants (for peer connection management). */
  participants: VoiceParticipant[];
  /** Called on non-fatal errors (e.g. permission denied). */
  onError?: (message: string) => void;
}

export interface UseGoLiveResult {
  /** Active session info (non-null when someone is live in this channel). */
  activeSession: GoLiveSession | null;
  /** True when the local user is the broadcaster. */
  isBroadcasting: boolean;
  /** Number of viewers (participants minus the broadcaster). */
  viewerCount: number;
  /** Incoming Go Live video stream for viewers to display. */
  viewerStream: MediaStream | null;
  /** Start broadcasting. Acquires getDisplayMedia. */
  startBroadcast: (quality: GoLiveQuality) => Promise<void>;
  /** Stop broadcasting (broadcaster only). */
  stopBroadcast: () => Promise<void>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useGoLive({
  enabled,
  channelId,
  myUserId,
  participants,
  onError,
}: UseGoLiveOptions): UseGoLiveResult {
  const [activeSession, setActiveSession] = useState<GoLiveSession | null>(
    null,
  );
  const [viewerStream, setViewerStream] = useState<MediaStream | null>(null);

  // Map of peerId → RTCPeerConnection for Go Live streams (broadcaster owns these)
  const goLivePeersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  // The local screen capture stream (broadcaster only)
  const displayStreamRef = useRef<MediaStream | null>(null);
  // Peers we already sent go-live offers to
  const offeredGoLivePeersRef = useRef<Set<string>>(new Set());
  // ICE servers fetched once
  const iceServersRef = useRef<RTCIceServer[]>([]);

  const isBroadcasting =
    activeSession?.broadcaster_id === myUserId && !!displayStreamRef.current;

  const viewerCount = activeSession ? Math.max(0, participants.length - 1) : 0;

  // ── ICE servers ─────────────────────────────────────────────

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    getIceServers()
      .then((servers) => {
        if (!cancelled) iceServersRef.current = servers;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  // ── Peer management (broadcaster side) ──────────────────────

  const closeGoLivePeer = useCallback((peerId: string) => {
    const pc = goLivePeersRef.current.get(peerId);
    if (pc) {
      pc.close();
      goLivePeersRef.current.delete(peerId);
    }
    offeredGoLivePeersRef.current.delete(peerId);
  }, []);

  const createGoLivePeer = useCallback(
    (peerId: string, displayStream: MediaStream): RTCPeerConnection => {
      if (goLivePeersRef.current.has(peerId)) {
        return goLivePeersRef.current.get(peerId)!;
      }

      const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
      goLivePeersRef.current.set(peerId, pc);

      // Add video (and optional audio) tracks from the display stream
      displayStream.getTracks().forEach((track) => {
        pc.addTrack(track, displayStream);
      });

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          gateway.sendVoiceSignal(
            peerId,
            "candidate",
            undefined,
            JSON.stringify(event.candidate),
            "go_live",
          );
        }
      };

      pc.onconnectionstatechange = () => {
        if (
          pc.connectionState === "failed" ||
          pc.connectionState === "closed"
        ) {
          closeGoLivePeer(peerId);
        }
      };

      return pc;
    },
    [closeGoLivePeer],
  );

  const sendGoLiveOffer = useCallback(
    async (peerId: string, displayStream: MediaStream) => {
      if (offeredGoLivePeersRef.current.has(peerId)) return;
      offeredGoLivePeersRef.current.add(peerId);

      const pc = createGoLivePeer(peerId, displayStream);
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        gateway.sendVoiceSignal(
          peerId,
          "offer",
          offer.sdp,
          undefined,
          "go_live",
        );
      } catch (err) {
        console.error(`[GoLive] Failed to offer to ${peerId}`, err);
        onError?.("Failed to connect to a viewer");
      }
    },
    [createGoLivePeer, onError],
  );

  // ── Fetch initial session on mount / channel change ─────────

  useEffect(() => {
    if (!enabled || !channelId) return;

    let cancelled = false;
    api
      .getGoLive(channelId)
      .then((session) => {
        if (!cancelled) setActiveSession(session);
      })
      .catch(() => {
        // 404 = no active session — that's fine
        if (!cancelled) setActiveSession(null);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, channelId]);

  // ── WebSocket events ─────────────────────────────────────────

  useEffect(() => {
    if (!enabled) return;

    const unsubStart = gateway.on("GO_LIVE_START", (event) => {
      if (event.channel_id === channelId) {
        setActiveSession({
          channel_id: event.channel_id,
          broadcaster_id: event.broadcaster_id,
          quality: event.quality,
          started_at: event.started_at,
        });
      }
    });

    const unsubStop = gateway.on("GO_LIVE_STOP", (event) => {
      if (event.channel_id === channelId) {
        setActiveSession(null);
        // If we're the viewer, tear down the incoming video stream
        if (event.broadcaster_id !== myUserId) {
          setViewerStream(null);
        }
      }
    });

    return () => {
      unsubStart();
      unsubStop();
    };
  }, [enabled, channelId, myUserId]);

  // ── Handle incoming Go Live VOICE_SIGNAL offers (viewer side) ─

  useEffect(() => {
    if (!enabled) return;

    const unsub = gateway.on("VOICE_SIGNAL", async (signal) => {
      if (signal.stream_type !== "go_live") return;

      const fromId = signal.from_user_id;
      if (!fromId || fromId === myUserId) return;

      if (signal.type === "offer") {
        // Viewer: create an answer-only peer connection
        const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });

        const remoteStream = new MediaStream();
        pc.ontrack = (event) => {
          event.streams[0]?.getTracks().forEach((track) => {
            remoteStream.addTrack(track);
          });
          setViewerStream(remoteStream);
        };

        pc.onicecandidate = (event) => {
          if (event.candidate) {
            gateway.sendVoiceSignal(
              fromId,
              "candidate",
              undefined,
              JSON.stringify(event.candidate),
              "go_live",
            );
          }
        };

        pc.onconnectionstatechange = () => {
          if (
            pc.connectionState === "failed" ||
            pc.connectionState === "closed"
          ) {
            setViewerStream(null);
          }
        };

        try {
          await pc.setRemoteDescription(
            new RTCSessionDescription({ type: "offer", sdp: signal.sdp }),
          );
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          gateway.sendVoiceSignal(
            fromId,
            "answer",
            answer.sdp,
            undefined,
            "go_live",
          );
        } catch (err) {
          console.error("[GoLive] Failed to answer offer", err);
          onError?.("Failed to receive Go Live stream");
        }
      } else if (signal.type === "answer") {
        const pc = goLivePeersRef.current.get(fromId);
        if (pc?.signalingState === "have-local-offer") {
          try {
            await pc.setRemoteDescription(
              new RTCSessionDescription({ type: "answer", sdp: signal.sdp }),
            );
          } catch (err) {
            console.error("[GoLive] Failed to set answer", err);
          }
        }
      } else if (signal.type === "candidate") {
        const pc = goLivePeersRef.current.get(fromId);
        if (pc) {
          try {
            await pc.addIceCandidate(
              new RTCIceCandidate(JSON.parse(signal.candidate)),
            );
          } catch (err) {
            console.error("[GoLive] Failed to add ICE candidate", err);
          }
        }
      }
    });

    return unsub;
  }, [enabled, myUserId, onError]);

  // ── When new participants join, broadcaster sends them an offer ─

  useEffect(() => {
    const stream = displayStreamRef.current;
    if (!stream || !isBroadcasting) return;

    participants.forEach((p) => {
      if (p.user_id === myUserId) return;
      if (offeredGoLivePeersRef.current.has(p.user_id)) return;
      sendGoLiveOffer(p.user_id, stream);
    });
  }, [participants, isBroadcasting, myUserId, sendGoLiveOffer]);

  // ── Public actions ───────────────────────────────────────────

  const startBroadcast = useCallback(
    async (quality: GoLiveQuality) => {
      const constraints = QUALITY_MAP[quality];

      let displayStream: MediaStream;
      try {
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: { ideal: constraints.width },
            height: { ideal: constraints.height },
            frameRate: { ideal: constraints.frameRate },
          },
          audio: false,
        });
      } catch (err) {
        console.error("[GoLive] getDisplayMedia failed", err);
        onError?.("Screen capture permission was denied");
        return;
      }

      // If the user dismisses the OS picker, stop immediately
      displayStream.getVideoTracks()[0]?.addEventListener("ended", () => {
        stopBroadcast();
      });

      displayStreamRef.current = displayStream;

      // Register with the server first (enforces single-broadcaster)
      try {
        const session = await api.startGoLive(channelId, { quality });
        setActiveSession(session);
      } catch (err) {
        displayStream.getTracks().forEach((t) => t.stop());
        displayStreamRef.current = null;
        const msg =
          err instanceof Error ? err.message : "Failed to start Go Live";
        onError?.(msg);
        return;
      }

      // Send offers to all current participants
      participants.forEach((p) => {
        if (p.user_id === myUserId) return;
        sendGoLiveOffer(p.user_id, displayStream);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [channelId, myUserId, participants, sendGoLiveOffer, onError],
  );

  const stopBroadcast = useCallback(async () => {
    displayStreamRef.current?.getTracks().forEach((t) => t.stop());
    displayStreamRef.current = null;

    goLivePeersRef.current.forEach((pc) => pc.close());
    goLivePeersRef.current.clear();
    offeredGoLivePeersRef.current.clear();

    setActiveSession(null);

    try {
      await api.stopGoLive(channelId);
    } catch (err) {
      // Best-effort — the stream is already torn down locally
      console.warn("[GoLive] stopGoLive API call failed", err);
    }
  }, [channelId]);

  // ── Cleanup on unmount or disable ───────────────────────────

  useEffect(() => {
    if (enabled) return;
    if (displayStreamRef.current) {
      displayStreamRef.current.getTracks().forEach((t) => t.stop());
      displayStreamRef.current = null;
    }
    goLivePeersRef.current.forEach((pc) => pc.close());
    goLivePeersRef.current.clear();
    offeredGoLivePeersRef.current.clear();
    setViewerStream(null);
  }, [enabled]);

  useEffect(() => {
    const displayStream = displayStreamRef;
    const goLivePeers = goLivePeersRef;
    return () => {
      displayStream.current?.getTracks().forEach((t) => t.stop());
      goLivePeers.current.forEach((pc) => pc.close());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    activeSession,
    isBroadcasting,
    viewerCount,
    viewerStream,
    startBroadcast,
    stopBroadcast,
  };
}
