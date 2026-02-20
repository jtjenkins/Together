import { useEffect, useState, useCallback } from "react";
import { useVoiceStore } from "../../stores/voiceStore";
import { useAuthStore } from "../../stores/authStore";
import { useChannelStore } from "../../stores/channelStore";
import { useWebRTC } from "../../hooks/useWebRTC";
import { gateway } from "../../api/websocket";
import { api } from "../../api/client";
import type { VoiceParticipant, VoiceStateUpdateEvent } from "../../types";
import styles from "./VoiceChannel.module.css";

interface VoiceChannelProps {
  channelId: string;
}

export function VoiceChannel({ channelId }: VoiceChannelProps) {
  const user = useAuthStore((s) => s.user);
  const channels = useChannelStore((s) => s.channels);
  const connectedChannelId = useVoiceStore((s) => s.connectedChannelId);
  const isMuted = useVoiceStore((s) => s.isMuted);
  const isDeafened = useVoiceStore((s) => s.isDeafened);
  const isConnecting = useVoiceStore((s) => s.isConnecting);
  const voiceError = useVoiceStore((s) => s.error);
  const clearVoiceError = useVoiceStore((s) => s.clearError);
  const join = useVoiceStore((s) => s.join);
  const leave = useVoiceStore((s) => s.leave);
  const toggleMute = useVoiceStore((s) => s.toggleMute);
  const toggleDeafen = useVoiceStore((s) => s.toggleDeafen);

  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
  // Peer IDs to send WebRTC offers to — captured once at join time
  const [initialPeers, setInitialPeers] = useState<string[]>([]);
  const [rtcError, setRtcError] = useState<string | null>(null);

  const channel = channels.find((c) => c.id === channelId);
  const isConnected = connectedChannelId === channelId;

  const fetchParticipants = useCallback(async () => {
    try {
      const list = await api.listVoiceParticipants(channelId);
      setParticipants(list);
    } catch (err) {
      console.warn("[VoiceChannel] Failed to fetch participants", err);
    }
  }, [channelId]);

  // Fetch participants on mount and on channel change
  useEffect(() => {
    fetchParticipants();
  }, [fetchParticipants]);

  // Subscribe to VOICE_STATE_UPDATE to keep participant list live
  useEffect(() => {
    const unsub = gateway.on(
      "VOICE_STATE_UPDATE",
      (event: VoiceStateUpdateEvent) => {
        if (event.channel_id === channelId) {
          // User joined or changed state in our channel
          setParticipants((prev) => {
            const exists = prev.some((p) => p.user_id === event.user_id);
            if (exists) {
              // Update mute/deaf state from the event — no REST needed
              return prev.map((p) =>
                p.user_id === event.user_id
                  ? {
                      ...p,
                      self_mute: event.self_mute,
                      self_deaf: event.self_deaf,
                      server_mute: event.server_mute,
                      server_deaf: event.server_deaf,
                    }
                  : p,
              );
            }
            // New participant — add from event data
            return [
              ...prev,
              {
                user_id: event.user_id,
                username: event.username,
                channel_id: event.channel_id,
                avatar_url: null,
                status: "online" as const,
                nickname: null,
                joined_at: event.joined_at ?? new Date().toISOString(),
                self_mute: event.self_mute,
                self_deaf: event.self_deaf,
                server_mute: event.server_mute,
                server_deaf: event.server_deaf,
              },
            ];
          });
        } else {
          // User left or moved to another channel — remove from our list
          setParticipants((prev) =>
            prev.filter((p) => p.user_id !== event.user_id),
          );
        }
      },
    );
    return unsub;
  }, [channelId]);

  const handleJoin = async () => {
    clearVoiceError();
    setRtcError(null);
    try {
      await join(channelId);
      const list = await api.listVoiceParticipants(channelId);
      setParticipants(list);
      // Capture the peers present at join time — we send offers to them
      setInitialPeers(
        list.filter((p) => p.user_id !== user?.id).map((p) => p.user_id),
      );
    } catch {
      // Error displayed via voiceError from store
    }
  };

  const handleLeave = async () => {
    await leave();
    setInitialPeers([]);
    await fetchParticipants();
  };

  const handleToggleMute = async () => {
    if (!isConnected) return;
    try {
      await toggleMute();
    } catch (err) {
      console.error("[VoiceChannel] toggleMute failed", err);
    }
  };

  const handleToggleDeafen = async () => {
    if (!isConnected) return;
    try {
      await toggleDeafen();
    } catch (err) {
      console.error("[VoiceChannel] toggleDeafen failed", err);
    }
  };

  // WebRTC audio — works on localhost and HTTPS; degrades gracefully otherwise
  useWebRTC({
    enabled: isConnected,
    myUserId: user?.id ?? "",
    participants,
    initialPeers,
    isMuted,
    isDeafened,
    onError: setRtcError,
  });

  const activeError = voiceError ?? rtcError;

  return (
    <div className={styles.voiceChannel}>
      <div className={styles.header}>
        <span className={styles.headerIcon}>🔊</span>
        <h2 className={styles.channelName}>{channel?.name ?? "Voice"}</h2>
      </div>

      {activeError && (
        <div className={styles.errorBanner}>
          {activeError}
          <button
            className={styles.errorDismiss}
            onClick={() => {
              clearVoiceError();
              setRtcError(null);
            }}
          >
            ✕
          </button>
        </div>
      )}

      <div className={styles.body}>
        <section className={styles.participantsSection}>
          <h3 className={styles.sectionTitle}>
            Participants &mdash; {participants.length}
          </h3>

          {participants.length === 0 ? (
            <p className={styles.emptyText}>No one is here yet</p>
          ) : (
            <ul className={styles.participantList}>
              {participants.map((p) => (
                <li key={p.user_id} className={styles.participant}>
                  <div className={styles.participantAvatar}>
                    {(p.username || "?").charAt(0).toUpperCase()}
                  </div>
                  <span
                    className={`${styles.participantName} ${p.user_id === user?.id ? styles.self : ""}`}
                  >
                    {p.username || p.user_id}
                    {p.user_id === user?.id && " (you)"}
                  </span>
                  <div className={styles.participantIcons}>
                    {(p.self_mute || p.server_mute) && (
                      <span
                        className={styles.stateIcon}
                        title={p.server_mute ? "Server muted" : "Muted"}
                      >
                        🔇
                      </span>
                    )}
                    {(p.self_deaf || p.server_deaf) && (
                      <span
                        className={styles.stateIcon}
                        title={p.server_deaf ? "Server deafened" : "Deafened"}
                      >
                        🔕
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={styles.controls}>
          {!isConnected ? (
            <button
              className={styles.joinBtn}
              onClick={handleJoin}
              disabled={isConnecting}
            >
              {isConnecting ? "Joining…" : "Join Voice"}
            </button>
          ) : (
            <div className={styles.connectedControls}>
              <div className={styles.voiceIndicator}>
                <span className={styles.indicatorDot} />
                Voice Connected
              </div>
              <div className={styles.controlBtns}>
                <button
                  className={`${styles.controlBtn} ${isMuted ? styles.controlActive : ""}`}
                  onClick={handleToggleMute}
                  title={isMuted ? "Unmute" : "Mute"}
                >
                  {isMuted ? "🔇" : "🎤"}
                </button>
                <button
                  className={`${styles.controlBtn} ${isDeafened ? styles.controlActive : ""}`}
                  onClick={handleToggleDeafen}
                  title={isDeafened ? "Undeafen" : "Deafen"}
                >
                  {isDeafened ? "🔕" : "🎧"}
                </button>
                <button
                  className={`${styles.controlBtn} ${styles.leaveBtn}`}
                  onClick={handleLeave}
                  title="Disconnect from voice"
                >
                  📞
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
