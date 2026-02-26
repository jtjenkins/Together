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
 * Note: getUserMedia requires a secure context (HTTPS or localhost).
 * If audio is unavailable the hook calls `onError` and the peer connections
 * are established without local audio (listen-only mode).
 */
import { useEffect, useRef, useCallback } from "react";
import { gateway } from "../api/websocket";
import type { VoiceParticipant } from "../types";

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

/** Average frequency amplitude (0-255) above which a user is considered speaking. */
const SPEAKING_THRESHOLD = 15;

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
}

/**
 * Start an AudioContext-based speaking detector for the given stream.
 * Returns a cleanup function that stops the detector and closes the context.
 */
function startSpeakingDetector(
  stream: MediaStream,
  onSpeaking: (speaking: boolean) => void,
): () => void {
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(analyser);
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
    ctx.close();
  };
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

  // Keep mutable refs for callbacks/values used inside stable useCallbacks
  // to avoid stale closures without re-creating the callbacks on every render.
  const speakerDeviceIdRef = useRef(speakerDeviceId);
  speakerDeviceIdRef.current = speakerDeviceId;
  const onSpeakingChangeRef = useRef(onSpeakingChange);
  onSpeakingChangeRef.current = onSpeakingChange;

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
            .catch(() => {});
        }
        document.body.appendChild(audio);
        audioElementsRef.current.set(peerId, audio);
      }
      audio.srcObject = stream;

      // (Re-)start speaking detection for this remote peer.
      stopSpeakingDetector(peerId);
      const stop = startSpeakingDetector(stream, (speaking) => {
        onSpeakingChangeRef.current?.(peerId, speaking);
      });
      speakingStopRef.current.set(peerId, stop);
    },
    [stopSpeakingDetector],
  );

  const createPeer = useCallback(
    (peerId: string, localStream: MediaStream | null) => {
      if (peersRef.current.has(peerId)) return peersRef.current.get(peerId)!;

      const pc = new RTCPeerConnection(RTC_CONFIG);
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
        const stop = startSpeakingDetector(stream, (speaking) => {
          onSpeakingChangeRef.current?.(myUserId, speaking);
        });
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
