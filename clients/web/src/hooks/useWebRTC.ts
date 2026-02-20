/**
 * useWebRTC — manages WebRTC peer connections for a voice channel.
 *
 * Architecture: the user who just joined sends offers to all existing
 * participants. Existing participants answer. ICE candidates are forwarded
 * via the VOICE_SIGNAL WebSocket relay.
 *
 * Note: getUserMedia requires a secure context (HTTPS or localhost).
 * The hook degrades gracefully when audio is unavailable.
 */
import { useEffect, useRef, useCallback } from "react";
import { gateway } from "../api/websocket";
import type { VoiceSignalData, VoiceParticipant } from "../types";

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
  isInitiator: boolean; // true when we just joined (we send offers)
  isMuted: boolean;
  isDeafened: boolean;
}

export function useWebRTC({
  enabled,
  myUserId,
  participants,
  isInitiator,
  isMuted,
  isDeafened,
}: UseWebRTCOptions) {
  // Map of peerId → RTCPeerConnection
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  // Our local audio stream
  const localStreamRef = useRef<MediaStream | null>(null);
  // Remote audio elements keyed by peerId
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());

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

  // Acquire local audio stream once
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
      })
      .catch(() => {
        // Audio unavailable (no permission, no HTTPS) — voice UI still works
      });

    return () => {
      cancelled = true;
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    };
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

  // When we are the initiator, send offers to existing participants
  useEffect(() => {
    if (!enabled || !isInitiator) return;

    const peers = participants.filter((p) => p.user_id !== myUserId);
    if (peers.length === 0) return;

    const localStream = localStreamRef.current;

    peers.forEach(async (peer) => {
      const pc = createPeer(peer.user_id, localStream);
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        gateway.sendVoiceSignal(peer.user_id, "offer", offer.sdp);
      } catch {
        // Ignore if WebRTC isn't available
      }
    });
  }, [enabled, isInitiator, participants, myUserId, createPeer]);

  // Handle incoming VOICE_SIGNAL events
  useEffect(() => {
    if (!enabled) return;

    const unsub = gateway.on(
      "VOICE_SIGNAL",
      async (signal: VoiceSignalData) => {
        const fromId = signal.from_user_id;
        if (!fromId || fromId === myUserId) return;

        const localStream = localStreamRef.current;

        if (signal.type === "offer" && signal.sdp) {
          const pc = createPeer(fromId, localStream);
          try {
            await pc.setRemoteDescription(
              new RTCSessionDescription({ type: "offer", sdp: signal.sdp }),
            );
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            gateway.sendVoiceSignal(fromId, "answer", answer.sdp);
          } catch {
            // Ignore
          }
        } else if (signal.type === "answer" && signal.sdp) {
          const pc = peersRef.current.get(fromId);
          if (pc?.signalingState === "have-local-offer") {
            await pc
              .setRemoteDescription(
                new RTCSessionDescription({ type: "answer", sdp: signal.sdp }),
              )
              .catch(() => {});
          }
        } else if (signal.type === "candidate" && signal.candidate) {
          const pc = peersRef.current.get(fromId);
          if (pc) {
            await pc
              .addIceCandidate(
                new RTCIceCandidate(JSON.parse(signal.candidate)),
              )
              .catch(() => {});
          }
        }
      },
    );

    return unsub;
  }, [enabled, myUserId, createPeer]);

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
    return () => {
      peersRef.current.forEach((_, peerId) => closePeer(peerId));
      audioElementsRef.current.forEach((audio) => {
        audio.srcObject = null;
        audio.remove();
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
