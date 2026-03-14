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

/** Average frequency amplitude (0-255) above which a user is considered speaking. */
const SPEAKING_THRESHOLD = 15;

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

export interface RemoteStreams {
  camera?: MediaStream;
  screen?: MediaStream;
  username: string;
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
  isCameraOn: boolean;
  isScreenSharing: boolean;
  cameraDeviceId?: string | null;
  /** Called when a non-fatal error occurs (e.g. mic denied, offer failed). */
  onError?: (message: string) => void;
  /** Called whenever a participant starts or stops speaking. */
  onSpeakingChange?: (userId: string, isSpeaking: boolean) => void;
  onRemoteStreamsChange?: () => void;
  /** Called when a local camera or screen stream is acquired or released. */
  onLocalStreamsChange?: () => void;
}

/**
 * Start an AudioContext-based speaking detector for the given stream.
 * Accepts a shared AudioContext so callers can reuse a single context across
 * multiple detectors (Chrome limits concurrent AudioContexts to ~6).
 * Returns a cleanup function that disconnects the analyser and clears the
 * interval — it does NOT close the AudioContext (the caller owns that).
 */
function startSpeakingDetector(
  ctx: AudioContext,
  stream: MediaStream,
  onSpeaking: (speaking: boolean) => void,
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
      const speaking = avg > SPEAKING_THRESHOLD;
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
  } catch (err) {
    console.warn("[WebRTC] speaking detector setup failed", err);
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
  isCameraOn,
  isScreenSharing,
  cameraDeviceId,
  onError,
  onSpeakingChange,
  onRemoteStreamsChange,
  onLocalStreamsChange,
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

  const localVideoStreamRef = useRef<MediaStream | null>(null);
  const localScreenStreamRef = useRef<MediaStream | null>(null);
  const remoteVideoStreamsRef = useRef<Map<string, RemoteStreams>>(new Map());
  // Tracks which RTCRtpSender corresponds to the screen track per peer connection
  const screenSendersRef = useRef<Map<RTCPeerConnection, RTCRtpSender>>(
    new Map(),
  );
  // Tracks which RTCRtpSender corresponds to the camera track per peer connection
  const cameraSendersRef = useRef<Map<RTCPeerConnection, RTCRtpSender>>(
    new Map(),
  );
  // Tracks which peers have completed their initial offer/answer handshake.
  // onnegotiationneeded is only processed for peers in this set — otherwise
  // the initial offer (sent explicitly in the "Send offers" effect) races with
  // the negotiationneeded-triggered offer.
  const initialNegotiationDoneRef = useRef<Set<string>>(new Set());

  // Keep mutable refs for callbacks/values used inside stable useCallbacks
  // to avoid stale closures without re-creating the callbacks on every render.
  const speakerDeviceIdRef = useRef(speakerDeviceId);
  speakerDeviceIdRef.current = speakerDeviceId;
  const onSpeakingChangeRef = useRef(onSpeakingChange);
  onSpeakingChangeRef.current = onSpeakingChange;
  const isMutedRef = useRef(isMuted);
  isMutedRef.current = isMuted;
  const onRemoteStreamsChangeRef = useRef(onRemoteStreamsChange);
  onRemoteStreamsChangeRef.current = onRemoteStreamsChange;
  const onLocalStreamsChangeRef = useRef(onLocalStreamsChange);
  onLocalStreamsChangeRef.current = onLocalStreamsChange;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const stopSpeakingDetector = useCallback((userId: string) => {
    speakingStopRef.current.get(userId)?.();
    speakingStopRef.current.delete(userId);
  }, []);

  const getRemoteVideoStreams = useCallback(
    () => remoteVideoStreamsRef.current,
    [],
  );

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
      remoteVideoStreamsRef.current.delete(peerId);
      onRemoteStreamsChangeRef.current?.();
      if (pc) {
        screenSendersRef.current.delete(pc);
        cameraSendersRef.current.delete(pc);
      }
      initialNegotiationDoneRef.current.delete(peerId);
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

      // Add existing camera track if active
      if (localVideoStreamRef.current) {
        const [videoTrack] = localVideoStreamRef.current.getVideoTracks();
        if (videoTrack) {
          videoTrack.contentHint = "motion";
          const cameraSender = pc.addTrack(
            videoTrack,
            localVideoStreamRef.current,
          );
          cameraSendersRef.current.set(pc, cameraSender);
        }
      }

      // Add existing screen track if active
      if (localScreenStreamRef.current) {
        const [screenTrack] = localScreenStreamRef.current.getVideoTracks();
        if (screenTrack) {
          screenTrack.contentHint = "detail";
          const sender = pc.addTrack(screenTrack, localScreenStreamRef.current);
          screenSendersRef.current.set(pc, sender);
        }
      }

      // Play remote audio/video when tracks arrive
      const remoteStream = new MediaStream();
      pc.ontrack = (event) => {
        if (event.track.kind === "audio") {
          // ── Audio path (unchanged) ──────────────────────────────
          event.streams[0]?.getAudioTracks().forEach((track) => {
            remoteStream.addTrack(track);
          });
          playRemoteStream(peerId, remoteStream);
        } else if (event.track.kind === "video") {
          // ── Video path ──────────────────────────────────────────
          // contentHint encodes role: "motion" = camera, "detail" = screen
          // Note: contentHint is set by the sender before addTrack. It is a hint to
          // the encoder, not a guaranteed metadata channel — Safari may not preserve
          // it across the peer connection. When absent (""), the track defaults to
          // camera. A more robust approach for future work is to use separate
          // RTCPeerConnection per media type or SDP msid stream identifiers.
          const isScreen = event.track.contentHint === "detail";
          const existing = remoteVideoStreamsRef.current.get(peerId) ?? {
            username:
              participants.find((p) => p.user_id === peerId)?.username ??
              peerId,
          };
          const stream = event.streams[0] ?? new MediaStream([event.track]);
          const updated: RemoteStreams = isScreen
            ? { ...existing, screen: stream }
            : { ...existing, camera: stream };
          remoteVideoStreamsRef.current.set(peerId, updated);
          onRemoteStreamsChangeRef.current?.();
        }
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

      // Handle SDP renegotiation triggered by addTrack / removeTrack after the
      // initial offer/answer exchange (e.g. camera or screen share toggled mid-call).
      // We guard against the initial onnegotiationneeded event (which fires when
      // tracks are first added in createPeer) by checking initialNegotiationDoneRef —
      // the initial offer is sent explicitly in the "Send offers" effect instead.
      pc.onnegotiationneeded = async () => {
        if (!initialNegotiationDoneRef.current.has(peerId)) return;
        if (pc.signalingState !== "stable") return;
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          gateway.sendVoiceSignal(peerId, "offer", offer.sdp);
        } catch (err) {
          console.error(`[WebRTC] renegotiation failed for ${peerId}`, err);
          onErrorRef.current?.("Failed to renegotiate voice connection");
        }
      };

      return pc;
    },
    [playRemoteStream, closePeer, participants],
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
            if (sender && track) {
              sender.replaceTrack(track).catch((err: unknown) => {
                console.error("[WebRTC] audio replaceTrack failed", err);
                onError?.("Failed to switch microphone");
              });
            } else if (track) {
              pc.addTrack(track, stream);
            }
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
            // Never report local user as speaking while muted.
            if (isMutedRef.current) {
              if (speaking) return;
            }
            onSpeakingChangeRef.current?.(myUserId, speaking);
          },
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

  // Acquire / release local camera stream
  useEffect(() => {
    if (!enabled || !isCameraOn) {
      if (localVideoStreamRef.current) {
        localVideoStreamRef.current.getTracks().forEach((t) => t.stop());
        localVideoStreamRef.current = null;
        onLocalStreamsChangeRef.current?.();
        peersRef.current.forEach((pc) => {
          const sender = cameraSendersRef.current.get(pc);
          if (sender) {
            pc.removeTrack(sender);
            cameraSendersRef.current.delete(pc);
          }
        });
      }
      return;
    }

    let cancelled = false;
    const constraints: MediaStreamConstraints = {
      video: cameraDeviceId ? { deviceId: { exact: cameraDeviceId } } : true,
      audio: false,
    };

    navigator.mediaDevices
      ?.getUserMedia(constraints)
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        localVideoStreamRef.current = stream;
        onLocalStreamsChangeRef.current?.();
        const [track] = stream.getVideoTracks();
        if (!track) return;

        track.contentHint = "motion";
        peersRef.current.forEach((pc) => {
          const sender = pc.addTrack(track, stream);
          cameraSendersRef.current.set(pc, sender);
        });
      })
      .catch((err) => {
        console.error("[WebRTC] camera getUserMedia failed", err);
        onError?.("Camera unavailable");
        // Roll back the optimistic isCameraOn: true set by toggleCamera() in the
        // store. Without this the camera button stays active with no stream flowing.
        import("../stores/voiceStore").then(({ useVoiceStore }) => {
          if (useVoiceStore.getState().isCameraOn) {
            useVoiceStore
              .getState()
              .toggleCamera()
              .catch(() => {});
          }
        });
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, isCameraOn]);

  // Hot-swap camera device while camera is active
  useEffect(() => {
    if (!enabled || !isCameraOn || !localVideoStreamRef.current) return;

    let cancelled = false;
    const constraints: MediaStreamConstraints = {
      video: cameraDeviceId ? { deviceId: { exact: cameraDeviceId } } : true,
      audio: false,
    };

    navigator.mediaDevices
      ?.getUserMedia(constraints)
      .then((newStream) => {
        if (cancelled) {
          newStream.getTracks().forEach((t) => t.stop());
          return;
        }
        localVideoStreamRef.current?.getTracks().forEach((t) => t.stop());
        localVideoStreamRef.current = newStream;
        const [newTrack] = newStream.getVideoTracks();
        if (!newTrack) return;

        peersRef.current.forEach((pc) => {
          // Use cameraSendersRef to find the correct sender — getSenders().find()
          // is ambiguous when screen share is also active (two video senders).
          const sender = cameraSendersRef.current.get(pc);
          if (sender) {
            sender.replaceTrack(newTrack).catch((err: unknown) => {
              console.error("[WebRTC] camera replaceTrack failed", err);
              onError?.("Failed to switch camera device");
            });
          }
        });
      })
      .catch((err) => {
        console.error("[WebRTC] camera device change failed", err);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, cameraDeviceId]);

  // Acquire / release screen share stream
  useEffect(() => {
    if (!enabled || !isScreenSharing) {
      if (localScreenStreamRef.current) {
        localScreenStreamRef.current.getTracks().forEach((t) => t.stop());
        localScreenStreamRef.current = null;
        onLocalStreamsChangeRef.current?.();
        peersRef.current.forEach((pc) => {
          const sender = screenSendersRef.current.get(pc);
          if (sender) {
            pc.removeTrack(sender);
            screenSendersRef.current.delete(pc);
          }
        });
      }
      return;
    }

    let cancelled = false;

    (
      navigator.mediaDevices as MediaDevices & {
        getDisplayMedia?: (
          c: DisplayMediaStreamOptions,
        ) => Promise<MediaStream>;
      }
    )
      .getDisplayMedia?.({ video: true, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        localScreenStreamRef.current = stream;
        onLocalStreamsChangeRef.current?.();
        const [track] = stream.getVideoTracks();
        if (!track) return;

        track.contentHint = "detail";
        track.addEventListener("ended", () => {
          import("../stores/voiceStore").then(({ useVoiceStore }) => {
            if (useVoiceStore.getState().isScreenSharing) {
              useVoiceStore
                .getState()
                .toggleScreen()
                .catch((err: unknown) => {
                  console.error(
                    "[WebRTC] failed to sync screen share stop to server",
                    err,
                  );
                });
            }
          });
        });

        peersRef.current.forEach((pc) => {
          const sender = pc.addTrack(track, stream);
          screenSendersRef.current.set(pc, sender);
        });
      })
      .catch((err: unknown) => {
        console.error("[WebRTC] getDisplayMedia failed", err);
        const name = (err as { name?: string }).name;
        if (name === "NotSupportedError") {
          onError?.("Screen sharing is not supported on this device");
        }
        // NotAllowedError = user cancelled picker — no error message needed
        import("../stores/voiceStore").then(({ useVoiceStore }) => {
          if (useVoiceStore.getState().isScreenSharing) {
            useVoiceStore
              .getState()
              .toggleScreen()
              .catch((revertErr: unknown) => {
                console.error(
                  "[WebRTC] failed to revert screen share state after getDisplayMedia failure",
                  revertErr,
                );
              });
          }
        });
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, isScreenSharing]);

  // Mute / unmute local tracks
  useEffect(() => {
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !isMuted;
    });
  }, [isMuted]);

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
          // Mark initial negotiation done so onnegotiationneeded handles future
          // renegotiations (e.g. camera / screen share added after join).
          initialNegotiationDoneRef.current.add(fromId);
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
            // Initial handshake complete — onnegotiationneeded will handle
            // subsequent renegotiations for this peer.
            initialNegotiationDoneRef.current.add(fromId);
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
    const remoteVideoStreams = remoteVideoStreamsRef.current;
    const initialNegotiationDone = initialNegotiationDoneRef.current;
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
      localVideoStreamRef.current?.getTracks().forEach((t) => t.stop());
      localVideoStreamRef.current = null;
      localScreenStreamRef.current?.getTracks().forEach((t) => t.stop());
      localScreenStreamRef.current = null;
      remoteVideoStreams.clear();
      initialNegotiationDone.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    getRemoteVideoStreams,
    localVideoStreamRef,
    localScreenStreamRef,
  };
}
