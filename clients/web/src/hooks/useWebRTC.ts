/**
 * useWebRTC — manages WebRTC peer connections for a voice channel.
 *
 * Architecture: the user who just joined sends offers to the peers listed in
 * `initialPeers` (set at join time). New joiners send offers to us instead.
 * ICE candidates are forwarded via the VOICE_SIGNAL WebSocket relay.
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

interface UseWebRTCOptions {
  enabled: boolean;
  myUserId: string;
  participants: VoiceParticipant[];
  /** Peer IDs we should send offers to — set once when we join, never updated. */
  initialPeers: string[];
  isMuted: boolean;
  isDeafened: boolean;
  /** Called when a non-fatal error occurs (e.g. mic denied, offer failed). */
  onError?: (message: string) => void;
}

export function useWebRTC({
  enabled,
  myUserId,
  participants,
  initialPeers,
  isMuted,
  isDeafened,
  onError,
}: UseWebRTCOptions) {
  // Map of peerId → RTCPeerConnection
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  // Our local audio stream
  const localStreamRef = useRef<MediaStream | null>(null);
  // Remote audio elements keyed by peerId
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  // Tracks which peers we have already sent an offer to (prevents glare)
  const offeredPeersRef = useRef<Set<string>>(new Set());

  const closePeer = useCallback((peerId: string) => {
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
  }, []);

  const playRemoteStream = useCallback(
    (peerId: string, stream: MediaStream) => {
      let audio = audioElementsRef.current.get(peerId);
      if (!audio) {
        audio = document.createElement("audio");
        audio.autoplay = true;
        document.body.appendChild(audio);
        audioElementsRef.current.set(peerId, audio);
      }
      audio.srcObject = stream;
    },
    [],
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

  // Acquire local audio stream once; retroactively add tracks to existing peers
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    navigator.mediaDevices
      ?.getUserMedia({ audio: true, video: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        localStreamRef.current = stream;
        // Add audio to any peer connections that were created before media was ready
        peersRef.current.forEach((pc) => {
          stream.getAudioTracks().forEach((track) => {
            pc.addTrack(track, stream);
          });
        });
      })
      .catch((err) => {
        console.error("[WebRTC] getUserMedia failed", err);
        onError?.("Microphone unavailable — joining in listen-only mode");
      });

    return () => {
      cancelled = true;
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    };
    // onError intentionally omitted — we only want this to run on enable/disable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

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
    return () => {
      peers.forEach((_, peerId) => closePeer(peerId));
      audioElements.forEach((audio) => {
        audio.srcObject = null;
        audio.remove();
      });
      offeredPeers.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
