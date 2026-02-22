/**
 * useWebRTC (React Native) — manages WebRTC peer connections for a voice channel.
 *
 * Uses react-native-webrtc instead of browser WebRTC APIs.
 * Remote audio plays automatically through the device speaker when tracks
 * are received via ontrack — no HTMLAudioElement equivalent is needed.
 */
import { useEffect, useRef, useCallback } from "react";
import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  mediaDevices,
  type MediaStream,
} from "react-native-webrtc";
import { gateway } from "../api/websocket";
import type { VoiceParticipant } from "../types";

const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

interface UseWebRTCOptions {
  enabled: boolean;
  myUserId: string;
  participants: VoiceParticipant[];
  /** Peer IDs we should send offers to — set once when we join. */
  initialPeers: string[];
  isMuted: boolean;
  isDeafened: boolean;
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
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map());
  const offeredPeersRef = useRef<Set<string>>(new Set());

  const closePeer = useCallback((peerId: string) => {
    const pc = peersRef.current.get(peerId);
    if (pc) {
      pc.close();
      peersRef.current.delete(peerId);
    }
    remoteStreamsRef.current.delete(peerId);
  }, []);

  const createPeer = useCallback(
    (peerId: string, localStream: MediaStream | null) => {
      if (peersRef.current.has(peerId)) return peersRef.current.get(peerId)!;

      const pc = new RTCPeerConnection(RTC_CONFIG);
      peersRef.current.set(peerId, pc);

      if (localStream) {
        localStream.getAudioTracks().forEach((track) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (pc as any).addTrack(track, localStream);
        });
      }

      // Remote audio plays automatically in react-native-webrtc
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (pc as any).ontrack = (event: { streams: MediaStream[] }) => {
        if (event.streams[0]) {
          remoteStreamsRef.current.set(peerId, event.streams[0]);
          // Apply current deafen state to incoming tracks
          event.streams[0].getAudioTracks().forEach((track) => {
            track.enabled = !isDeafened;
          });
        }
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (pc as any).onicecandidate = (event: any) => {
        if (event.candidate) {
          gateway.sendVoiceSignal(
            peerId,
            "candidate",
            undefined,
            JSON.stringify(event.candidate),
          );
        }
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (pc as any).onconnectionstatechange = () => {
        if (
          pc.connectionState === "failed" ||
          pc.connectionState === "closed"
        ) {
          closePeer(peerId);
        }
      };

      return pc;
    },
    [closePeer, isDeafened],
  );

  // Acquire local audio stream
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    mediaDevices
      .getUserMedia({ audio: true, video: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        localStreamRef.current = stream as MediaStream;
        peersRef.current.forEach((pc) => {
          (stream as MediaStream).getAudioTracks().forEach((track) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (pc as any).addTrack(track, stream);
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
    // onError intentionally omitted — only run on enable/disable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // Mute / unmute local tracks
  useEffect(() => {
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !isMuted;
    });
  }, [isMuted]);

  // Deafen: enable/disable all remote audio tracks
  useEffect(() => {
    remoteStreamsRef.current.forEach((stream) => {
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !isDeafened;
      });
    });
  }, [isDeafened]);

  // Send offers to peers present when we joined
  useEffect(() => {
    if (!enabled || initialPeers.length === 0) return;

    const localStream = localStreamRef.current;

    initialPeers.forEach(async (peerId) => {
      if (peerId === myUserId) return;
      if (offeredPeersRef.current.has(peerId)) return;
      offeredPeersRef.current.add(peerId);

      const pc = createPeer(peerId, localStream);
      try {
        const offer = await pc.createOffer({});
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

  // Clean up all peers on unmount
  useEffect(() => {
    const peers = peersRef.current;
    const offeredPeers = offeredPeersRef.current;
    return () => {
      peers.forEach((_, peerId) => closePeer(peerId));
      offeredPeers.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
