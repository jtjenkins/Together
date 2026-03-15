/**
 * useWebRTC — manages WebRTC peer connections for a voice channel.
 *
 * Architecture: the user who just joined sends offers to the peers listed in
 * `initialPeers` (set at join time). New joiners send offers to us instead.
 * ICE candidates are forwarded via the VOICE_SIGNAL WebSocket relay.
 *
 * Speaking detection uses the Web Audio API to sample RMS levels every 100 ms
 * for both the local microphone and each incoming remote stream, reporting
 * changes via `onSpeakingChange`.
 *
 * ICE servers are fetched from the backend API, which provides time-limited
 * TURN credentials for NAT traversal (iOS cellular, restrictive firewalls).
 *
 * Note: getUserMedia requires a secure context (HTTPS or localhost).
 * If audio is unavailable the hook calls `onError` and the peer connections
 * are established without local audio (listen-only mode).
 */
import { useEffect, useRef, useCallback } from "react";
import { gateway } from "../api/websocket";
import { api } from "../api/client";
import type { VoiceParticipant } from "../types";

/** Default average frequency amplitude (0–255) above which a user is considered speaking. */
const DEFAULT_SPEAKING_THRESHOLD = 15;

// Cache ICE servers for the TTL duration (24 hours by default)
let iceServersCache: { servers: RTCIceServer[]; expiresAt: number } | null =
  null;

async function getIceServers(): Promise<RTCIceServer[]> {
  // Return cached servers if still valid
  if (iceServersCache && Date.now() < iceServersCache.expiresAt) {
    return iceServersCache.servers;
  }

  try {
    const response = await api.getIceServers();
    // Convert to RTCIceServer format and cache for TTL - 60 seconds buffer
    const servers: RTCIceServer[] = response.iceServers.map((s) => ({
      urls: s.urls,
      username: s.username,
      credential: s.credential,
    }));
    const ttlMs = (response.ttl - 60) * 1000;
    iceServersCache = {
      servers,
      expiresAt: Date.now() + ttlMs,
    };
    return servers;
  } catch (err) {
    console.warn("[WebRTC] Failed to fetch ICE servers, using STUN only", err);
    // Fallback to public STUN servers if API fails
    return [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ];
  }
}

interface UseWebRTCOptions {
  enabled: boolean;
  myUserId: string;
  participants: VoiceParticipant[];
  /** Peer IDs we should send offers to — set once when we join, never updated. */
  initialPeers: string[];
  isMuted: boolean;
  isDeafened: boolean;
  /** deviceId of the preferred audio input; undefined = browser default. */
  micDeviceId?: string | null;
  /** deviceId of the preferred audio output; undefined = browser default. */
  speakerDeviceId?: string | null;
  /** Called when a non-fatal error occurs (e.g. mic denied, offer failed). */
  onError?: (message: string) => void;
  /** Called whenever a participant starts or stops speaking. */
  onSpeakingChange?: (userId: string, isSpeaking: boolean) => void;
  /**
   * RMS amplitude threshold (0–255) for VAD speaking detection.
   * Lower = more sensitive. Defaults to DEFAULT_SPEAKING_THRESHOLD (15).
   * Can be updated between renders without restarting the detector.
   */
  vadThreshold?: number;
  /** When true, mic transmission is gated by isPttActive rather than audio level. */
  pttMode?: boolean;
  /** Whether the PTT key is currently held. Only used when pttMode is true. */
  isPttActive?: boolean;
}

/**
 * Start an AudioContext-based speaking detector for the given stream.
 * `getThreshold` is called each interval so callers can update sensitivity
 * without restarting the detector — just update a ref and pass its getter.
 */
function startSpeakingDetector(
  ctx: AudioContext,
  stream: MediaStream,
  onSpeaking: (speaking: boolean) => void,
  getThreshold: () => number = () => DEFAULT_SPEAKING_THRESHOLD,
): () => void {
  try {
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    let current = false;

    const id = setInterval(() => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((s, v) => s + v, 0) / data.length;
      const speaking = avg > getThreshold();
      if (speaking !== current) {
        current = speaking;
        onSpeaking(speaking);
      }
    }, 100);

    return () => {
      clearInterval(id);
      source.disconnect();
      analyser.disconnect();
    };
  } catch {
    // AudioContext may be unavailable (e.g. in tests or restricted contexts).
    return () => {};
  }
}

export function useWebRTC({
  enabled,
  myUserId,
  participants,
  initialPeers,
  isMuted,
  isDeafened,
  micDeviceId,
  speakerDeviceId,
  onError,
  onSpeakingChange,
  vadThreshold,
  pttMode = false,
  isPttActive = false,
}: UseWebRTCOptions) {
  // Map of peerId → RTCPeerConnection
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  // Our local audio stream
  const localStreamRef = useRef<MediaStream | null>(null);
  // Remote audio elements keyed by peerId
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  // Tracks which peers we have already sent an offer to (prevents glare)
  const offeredPeersRef = useRef<Set<string>>(new Set());
  // Speaking detector cleanup functions keyed by userId
  const speakingStopRef = useRef<Map<string, () => void>>(new Map());
  // Cached ICE servers (fetched once when enabled)
  const iceServersRef = useRef<RTCIceServer[]>([]);

  // Shared AudioContext for all speaking detectors — Chrome limits concurrent
  // AudioContexts to ~6, so one context must serve the whole call.
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Keep mutable refs for callbacks/values used inside stable useCallbacks
  // to avoid stale closures without re-creating the callbacks on every render.
  const speakerDeviceIdRef = useRef(speakerDeviceId);
  speakerDeviceIdRef.current = speakerDeviceId;
  const onSpeakingChangeRef = useRef(onSpeakingChange);
  onSpeakingChangeRef.current = onSpeakingChange;
  const isMutedRef = useRef(isMuted);
  isMutedRef.current = isMuted;
  const vadThresholdRef = useRef(vadThreshold ?? DEFAULT_SPEAKING_THRESHOLD);
  vadThresholdRef.current = vadThreshold ?? DEFAULT_SPEAKING_THRESHOLD;
  const pttModeRef = useRef(pttMode);
  pttModeRef.current = pttMode;
  const isPttActiveRef = useRef(isPttActive);
  isPttActiveRef.current = isPttActive;

  const stopSpeakingDetector = useCallback((userId: string) => {
    speakingStopRef.current.get(userId)?.();
    speakingStopRef.current.delete(userId);
  }, []);

  const closePeer = useCallback(
    (peerId: string) => {
      const pc = peersRef.current.get(peerId);
      if (pc) {
        pc.close();
        peersRef.current.delete(peerId);
      }
      const audio = audioElementsRef.current.get(peerId);
      if (audio) {
        audio.srcObject = null;
        audio.remove();
        audioElementsRef.current.delete(peerId);
      }
      stopSpeakingDetector(peerId);
      onSpeakingChangeRef.current?.(peerId, false);
    },
    [stopSpeakingDetector],
  );

  const playRemoteStream = useCallback(
    (peerId: string, stream: MediaStream) => {
      let audio = audioElementsRef.current.get(peerId);
      if (!audio) {
        audio = document.createElement("audio");
        audio.autoplay = true;
        const sinkId = speakerDeviceIdRef.current;
        if (sinkId && "setSinkId" in audio) {
          (audio as HTMLAudioElement & { setSinkId(id: string): Promise<void> })
            .setSinkId(sinkId)
            .catch((err: unknown) => {
              console.warn("[WebRTC] setSinkId failed for peer", peerId, err);
            });
        }
        document.body.appendChild(audio);
        audioElementsRef.current.set(peerId, audio);
      }
      audio.srcObject = stream;

      // (Re-)start speaking detection for this remote peer.
      stopSpeakingDetector(peerId);
      try {
        audioCtxRef.current ??= new AudioContext();
      } catch {
        // AudioContext unavailable — skip speaking detection for this peer.
        return;
      }
      const stop = startSpeakingDetector(
        audioCtxRef.current,
        stream,
        (speaking) => {
          onSpeakingChangeRef.current?.(peerId, speaking);
        },
      );
      speakingStopRef.current.set(peerId, stop);
    },
    [stopSpeakingDetector],
  );

  const createPeer = useCallback(
    (peerId: string, localStream: MediaStream | null): RTCPeerConnection => {
      if (peersRef.current.has(peerId)) return peersRef.current.get(peerId)!;

      const pc = new RTCPeerConnection({
        iceServers: iceServersRef.current,
      });
      peersRef.current.set(peerId, pc);

      // Add local audio tracks
      if (localStream) {
        localStream.getAudioTracks().forEach((track) => {
          pc.addTrack(track, localStream);
        });
      }

      // Play remote audio when tracks arrive
      const remoteStream = new MediaStream();
      pc.ontrack = (event) => {
        event.streams[0]?.getAudioTracks().forEach((track) => {
          remoteStream.addTrack(track);
        });
        playRemoteStream(peerId, remoteStream);
      };

      // Forward ICE candidates via signaling
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          gateway.sendVoiceSignal(
            peerId,
            "candidate",
            undefined,
            JSON.stringify(event.candidate),
          );
        }
      };

      pc.onconnectionstatechange = () => {
        if (
          pc.connectionState === "failed" ||
          pc.connectionState === "closed"
        ) {
          closePeer(peerId);
        }
      };

      return pc;
    },
    [playRemoteStream, closePeer],
  );

  // Fetch ICE servers once when enabled
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    getIceServers()
      .then((servers) => {
        if (!cancelled) {
          iceServersRef.current = servers;
        }
      })
      .catch((err) => {
        console.warn("[WebRTC] Failed to fetch ICE servers", err);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  // Acquire local audio stream; re-runs when enabled or mic device changes.
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const constraints: MediaStreamConstraints = {
      audio: micDeviceId ? { deviceId: { exact: micDeviceId } } : true,
      video: false,
    };

    navigator.mediaDevices
      ?.getUserMedia(constraints)
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        // If re-acquiring (device change), replace tracks on existing peers.
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach((t) => t.stop());
          peersRef.current.forEach((pc) => {
            const sender = pc
              .getSenders()
              .find((s) => s.track?.kind === "audio");
            const [track] = stream.getAudioTracks();
            if (sender && track) sender.replaceTrack(track);
            else if (track) pc.addTrack(track, stream);
          });
        }

        localStreamRef.current = stream;

        // Start speaking detection for the local user.
        stopSpeakingDetector(myUserId);
        try {
          audioCtxRef.current ??= new AudioContext();
        } catch {
          // AudioContext unavailable — skip local speaking detection.
          return;
        }
        const stop = startSpeakingDetector(
          audioCtxRef.current,
          stream,
          (speaking) => {
            // In PTT mode local speaking is driven by key state, not audio level.
            if (pttModeRef.current) return;
            // Never report local user as speaking while muted.
            if (isMutedRef.current && speaking) return;
            onSpeakingChangeRef.current?.(myUserId, speaking);
          },
          () => vadThresholdRef.current,
        );
        speakingStopRef.current.set(myUserId, stop);
      })
      .catch((err) => {
        console.error("[WebRTC] getUserMedia failed", err);
        onError?.("Microphone unavailable — joining in listen-only mode");
      });

    return () => {
      cancelled = true;
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      stopSpeakingDetector(myUserId);
      onSpeakingChangeRef.current?.(myUserId, false);
    };
    // micDeviceId intentionally in deps — changing device re-acquires the stream.
    // onError and myUserId are stable across re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, micDeviceId]);

  // Enable/disable local mic track.
  // In VAD mode: track is enabled whenever not muted.
  // In PTT mode: track is enabled only while the PTT key is held (and not muted).
  useEffect(() => {
    const micEnabled = pttMode ? isPttActive && !isMuted : !isMuted;
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = micEnabled;
    });
  }, [isMuted, pttMode, isPttActive]);

  // In PTT mode, derive local speaking indicator from key state rather than
  // audio level (the audio-based detector skips local reporting in PTT mode).
  const myUserIdRef = useRef(myUserId);
  myUserIdRef.current = myUserId;
  useEffect(() => {
    if (!pttMode) return;
    const speaking = isPttActive && !isMuted;
    onSpeakingChangeRef.current?.(myUserIdRef.current, speaking);
  }, [pttMode, isPttActive, isMuted]);

  // Deafen: mute all remote audio elements
  useEffect(() => {
    audioElementsRef.current.forEach((audio) => {
      audio.muted = isDeafened;
    });
  }, [isDeafened]);

  // Apply speaker device change to all existing audio elements
  useEffect(() => {
    if (!speakerDeviceId) return;
    audioElementsRef.current.forEach((audio) => {
      if ("setSinkId" in audio) {
        (audio as HTMLAudioElement & { setSinkId(id: string): Promise<void> })
          .setSinkId(speakerDeviceId)
          .catch((err: Error) => {
            console.warn("[WebRTC] setSinkId failed", err);
          });
      }
    });
  }, [speakerDeviceId]);

  // Send offers to the peers that were present when we joined
  useEffect(() => {
    if (!enabled || initialPeers.length === 0) return;

    const localStream = localStreamRef.current;

    initialPeers.forEach(async (peerId) => {
      if (peerId === myUserId) return;
      if (offeredPeersRef.current.has(peerId)) return;
      offeredPeersRef.current.add(peerId);

      const pc = createPeer(peerId, localStream);
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        gateway.sendVoiceSignal(peerId, "offer", offer.sdp);
      } catch (err) {
        console.error(`[WebRTC] Failed to create offer for ${peerId}`, err);
        onError?.("Failed to establish voice connection with a peer");
      }
    });
  }, [enabled, initialPeers, myUserId, createPeer, onError]);

  // Handle incoming VOICE_SIGNAL events
  useEffect(() => {
    if (!enabled) return;

    const unsub = gateway.on("VOICE_SIGNAL", async (signal) => {
      const fromId = signal.from_user_id;
      if (!fromId || fromId === myUserId) return;

      const localStream = localStreamRef.current;

      if (signal.type === "offer") {
        const pc = createPeer(fromId, localStream);
        try {
          await pc.setRemoteDescription(
            new RTCSessionDescription({ type: "offer", sdp: signal.sdp }),
          );
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          gateway.sendVoiceSignal(fromId, "answer", answer.sdp);
        } catch (err) {
          console.error(`[WebRTC] Failed to answer offer from ${fromId}`, err);
          onError?.("Failed to answer voice connection request");
        }
      } else if (signal.type === "answer") {
        const pc = peersRef.current.get(fromId);
        if (pc?.signalingState === "have-local-offer") {
          try {
            await pc.setRemoteDescription(
              new RTCSessionDescription({ type: "answer", sdp: signal.sdp }),
            );
          } catch (err) {
            console.error(
              `[WebRTC] Failed to set remote answer from ${fromId}`,
              err,
            );
            onError?.("Failed to establish voice connection with a peer");
          }
        }
      } else if (signal.type === "candidate") {
        const pc = peersRef.current.get(fromId);
        if (pc) {
          try {
            await pc.addIceCandidate(
              new RTCIceCandidate(JSON.parse(signal.candidate)),
            );
          } catch (err) {
            console.error(
              `[WebRTC] Failed to add ICE candidate from ${fromId}`,
              err,
            );
          }
        }
      }
    });

    return unsub;
  }, [enabled, myUserId, createPeer, onError]);

  // Close peers that have left the channel
  useEffect(() => {
    const currentPeerIds = new Set(participants.map((p) => p.user_id));
    peersRef.current.forEach((_, peerId) => {
      if (!currentPeerIds.has(peerId)) {
        closePeer(peerId);
      }
    });
  }, [participants, closePeer]);

  // Clean up all peers on unmount; reset offered-peers set
  useEffect(() => {
    const peers = peersRef.current;
    const audioElements = audioElementsRef.current;
    const offeredPeers = offeredPeersRef.current;
    const speakingStop = speakingStopRef.current;
    return () => {
      peers.forEach((_, peerId) => closePeer(peerId));
      audioElements.forEach((audio) => {
        audio.srcObject = null;
        audio.remove();
      });
      offeredPeers.clear();
      speakingStop.forEach((stop) => stop());
      speakingStop.clear();
      // Close the shared AudioContext now that all detectors have been torn down.
      audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
