import { useEffect, useState, useCallback } from "react";
import {
  Mic,
  MicOff,
  Headphones,
  HeadphoneOff,
  Volume2,
  PhoneOff,
  Settings,
  X,
  Video,
  VideoOff,
  ScreenShare,
  ScreenShareOff,
  Radio,
} from "lucide-react";
import { useVoiceStore } from "../../stores/voiceStore";
import { useAuthStore } from "../../stores/authStore";
import { useChannelStore } from "../../stores/channelStore";
import {
  useVoiceSettingsStore,
  sensitivityToThreshold,
} from "../../stores/voiceSettingsStore";
import { useWebRTC } from "../../hooks/useWebRTC";
import { useGoLive } from "../../hooks/useGoLive";
import { usePushToTalk } from "../../hooks/usePushToTalk";
import { VideoGrid } from "./VideoGrid";
import { gateway } from "../../api/websocket";
import { api } from "../../api/client";
import type {
  VoiceParticipant,
  VoiceStateUpdateEvent,
  GoLiveQuality,
} from "../../types";
import {
  GoLiveViewer,
  GoLiveBanner,
  GoLiveQualitySelector,
} from "./GoLiveViewer";
import styles from "./VoiceChannel.module.css";

/** Convert a KeyboardEvent.code to a human-readable label. */
function formatKeyCode(code: string): string {
  if (code === "Space") return "Space";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code === "AltLeft" || code === "AltRight") return "Alt";
  if (code === "ControlLeft" || code === "ControlRight") return "Ctrl";
  if (code === "ShiftLeft" || code === "ShiftRight") return "Shift";
  if (code === "MetaLeft" || code === "MetaRight") return "Meta";
  return code;
}

interface AudioDevice {
  deviceId: string;
  label: string;
}

interface VoiceChannelProps {
  channelId: string;
  onBack?: () => void;
}

export function VoiceChannel({ channelId, onBack }: VoiceChannelProps) {
  const user = useAuthStore((s) => s.user);
  const channels = useChannelStore((s) => s.channels);
  const connectedChannelId = useVoiceStore((s) => s.connectedChannelId);
  const isMuted = useVoiceStore((s) => s.isMuted);
  const isDeafened = useVoiceStore((s) => s.isDeafened);
  const isConnecting = useVoiceStore((s) => s.isConnecting);
  const isCameraOn = useVoiceStore((s) => s.isCameraOn);
  const isScreenSharing = useVoiceStore((s) => s.isScreenSharing);
  const voiceError = useVoiceStore((s) => s.error);
  const clearVoiceError = useVoiceStore((s) => s.clearError);
  const join = useVoiceStore((s) => s.join);
  const leave = useVoiceStore((s) => s.leave);
  const toggleMute = useVoiceStore((s) => s.toggleMute);
  const toggleDeafen = useVoiceStore((s) => s.toggleDeafen);
  const toggleCamera = useVoiceStore((s) => s.toggleCamera);
  const toggleScreen = useVoiceStore((s) => s.toggleScreen);

  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
  // Peer IDs to send WebRTC offers to — captured once at join time
  const [initialPeers, setInitialPeers] = useState<string[]>([]);
  const [rtcError, setRtcError] = useState<string | null>(null);

  // Speaking state: set of user IDs currently transmitting audio
  const [speakingUsers, setSpeakingUsers] = useState<Set<string>>(new Set());

  // Go Live state
  const [showQualityPicker, setShowQualityPicker] = useState(false);
  const [showViewer, setShowViewer] = useState(false);
  const [goLiveError, setGoLiveError] = useState<string | null>(null);

  // Audio device selection
  const [micDeviceId, setMicDeviceId] = useState<string | null>(null);
  const [speakerDeviceId, setSpeakerDeviceId] = useState<string | null>(null);
  const [micDevices, setMicDevices] = useState<AudioDevice[]>([]);
  const [speakerDevices, setSpeakerDevices] = useState<AudioDevice[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [cameraDeviceId, setCameraDeviceId] = useState<string | null>(null);
  const [cameraDevices, setCameraDevices] = useState<AudioDevice[]>([]);
  const [streamVersion, setStreamVersion] = useState(0);

  // Voice activity / push-to-talk settings
  const voiceMode = useVoiceSettingsStore((s) => s.mode);
  const vadSensitivity = useVoiceSettingsStore((s) => s.vadSensitivity);
  const pttKey = useVoiceSettingsStore((s) => s.pttKey);
  const setVoiceMode = useVoiceSettingsStore((s) => s.setMode);
  const setVadSensitivity = useVoiceSettingsStore((s) => s.setVadSensitivity);
  const setPttKey = useVoiceSettingsStore((s) => s.setPttKey);

  // PTT active state — true while the PTT key is held
  const [isPttActive, setIsPttActive] = useState(false);
  // Key capture mode — true while waiting for the user to press a new PTT key
  const [capturingKey, setCapturingKey] = useState(false);

  const channel = channels.find((c) => c.id === channelId);
  const isConnected = connectedChannelId === channelId;

  const handleSpeakingChange = useCallback(
    (userId: string, isSpeaking: boolean) => {
      setSpeakingUsers((prev) => {
        const next = new Set(prev);
        if (isSpeaking) next.add(userId);
        else next.delete(userId);
        return next;
      });
    },
    [],
  );

  const enumerateDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices?.enumerateDevices();
      if (!devices) return;
      setMicDevices(
        devices
          .filter((d) => d.kind === "audioinput")
          .map((d, i) => ({
            deviceId: d.deviceId,
            label: d.label || `Microphone ${i + 1}`,
          })),
      );
      setSpeakerDevices(
        devices
          .filter((d) => d.kind === "audiooutput")
          .map((d, i) => ({
            deviceId: d.deviceId,
            label: d.label || `Speaker ${i + 1}`,
          })),
      );
      setCameraDevices(
        devices
          .filter((d) => d.kind === "videoinput")
          .map((d, i) => ({
            deviceId: d.deviceId,
            label: d.label || `Camera ${i + 1}`,
          })),
      );
    } catch (err) {
      console.warn("[VoiceChannel] enumerateDevices failed", err);
    }
  }, []);

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
                      self_video: event.self_video,
                      self_screen: event.self_screen,
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
                joined_at: event.joined_at ?? new Date().toISOString(),
                self_mute: event.self_mute,
                self_deaf: event.self_deaf,
                self_video: event.self_video,
                self_screen: event.self_screen,
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
      await enumerateDevices();
    } catch (err) {
      // voiceError from store covers store action failures
      console.error("[VoiceChannel] handleJoin failed", err);
    }
  };

  const handleLeave = async () => {
    try {
      await leave();
    } catch (err) {
      console.error("[VoiceChannel] leave failed", err);
    }
    setInitialPeers([]);
    setSpeakingUsers(new Set());
    await fetchParticipants();
  };

  const handleToggleMute = async () => {
    if (!isConnected) return;
    try {
      await toggleMute();
    } catch (err) {
      console.error("[VoiceChannel] toggleMute failed", err);
      setRtcError("Failed to sync mute state — try again");
    }
  };

  const handleToggleDeafen = async () => {
    if (!isConnected) return;
    try {
      await toggleDeafen();
    } catch (err) {
      console.error("[VoiceChannel] toggleDeafen failed", err);
      setRtcError("Failed to sync deafen state — try again");
    }
  };

  // Push-to-talk key listener — browser-scoped (only fires when tab is focused).
  // Disabled while capturing a new key binding to prevent accidental transmission.
  usePushToTalk({
    enabled: isConnected && voiceMode === "ptt" && !capturingKey,
    pttKey,
    onPress: () => setIsPttActive(true),
    onRelease: () => setIsPttActive(false),
  });

  // Key-capture mode: intercept the next keydown to set a new PTT key.
  useEffect(() => {
    if (!capturingKey) return;
    const capture = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.code === "Escape") {
        setCapturingKey(false);
        return;
      }
      setPttKey(e.code);
      setCapturingKey(false);
    };
    window.addEventListener("keydown", capture, { once: true });
    return () => window.removeEventListener("keydown", capture);
  }, [capturingKey, setPttKey]);

  const handleRemoteStreamsChange = useCallback(() => {
    setStreamVersion((v) => v + 1);
  }, []);

  const handleToggleCamera = useCallback(async () => {
    try {
      await toggleCamera();
    } catch (err) {
      console.error("[VoiceChannel] toggleCamera failed", err);
      setRtcError("Failed to sync camera state — try again");
    }
  }, [toggleCamera]);

  const handleToggleScreen = useCallback(async () => {
    try {
      await toggleScreen();
    } catch (err) {
      console.error("[VoiceChannel] toggleScreen failed", err);
      setRtcError("Failed to sync screen share state — try again");
    }
  }, [toggleScreen]);

  // WebRTC audio — works on localhost and HTTPS; degrades gracefully otherwise
  const { getRemoteVideoStreams, localVideoStreamRef, localScreenStreamRef } =
    useWebRTC({
      enabled: isConnected,
      myUserId: user?.id ?? "",
      participants,
      initialPeers,
      isMuted,
      isDeafened,
      micDeviceId,
      speakerDeviceId,
      isCameraOn,
      isScreenSharing,
      cameraDeviceId,
      onError: setRtcError,
      onSpeakingChange: handleSpeakingChange,
      vadThreshold: sensitivityToThreshold(vadSensitivity),
      pttMode: voiceMode === "ptt",
      isPttActive,
      onRemoteStreamsChange: handleRemoteStreamsChange,
      onLocalStreamsChange: handleRemoteStreamsChange,
    });

  const {
    activeSession: goLiveSession,
    isBroadcasting,
    viewerCount,
    viewerStream,
    startBroadcast,
    stopBroadcast,
  } = useGoLive({
    enabled: isConnected,
    channelId,
    myUserId: user?.id ?? "",
    participants,
    onError: setGoLiveError,
  });

  const handleStartGoLive = async (quality: GoLiveQuality) => {
    setShowQualityPicker(false);
    await startBroadcast(quality);
  };

  const handleStopGoLive = async () => {
    await stopBroadcast();
    setShowViewer(false);
  };

  // Broadcaster name for the banner/viewer header
  const broadcasterName =
    participants.find((p) => p.user_id === goLiveSession?.broadcaster_id)
      ?.username ??
    goLiveSession?.broadcaster_id?.slice(0, 8) ??
    "Someone";

  const activeError = voiceError ?? rtcError ?? goLiveError;

  return (
    <div className={styles.voiceChannel}>
      {/* Go Live fullscreen viewer */}
      {showViewer && viewerStream && goLiveSession && (
        <GoLiveViewer
          stream={viewerStream}
          session={goLiveSession}
          broadcasterName={broadcasterName}
          viewerCount={viewerCount}
          onClose={() => setShowViewer(false)}
        />
      )}

      <div className={styles.header}>
        {onBack && (
          <button
            className={styles.backBtn}
            onClick={onBack}
            aria-label="Back to channels"
          >
            ←
          </button>
        )}
        <Volume2 size={18} className={styles.headerIcon} />
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
            aria-label="Dismiss error"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <div className={styles.body}>
        {isConnected && (
          <VideoGrid
            getRemoteStreams={getRemoteVideoStreams}
            streamVersion={streamVersion}
            localCameraStream={localVideoStreamRef.current}
            localScreenStream={localScreenStreamRef.current}
            localUserId={user?.id ?? ""}
            localUsername={user?.username ?? ""}
          />
        )}
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
                  <div
                    className={`${styles.participantAvatar} ${speakingUsers.has(p.user_id) ? styles.speaking : ""}`}
                  >
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
                        <MicOff size={14} />
                      </span>
                    )}
                    {(p.self_deaf || p.server_deaf) && (
                      <span
                        className={styles.stateIcon}
                        title={p.server_deaf ? "Server deafened" : "Deafened"}
                      >
                        <HeadphoneOff size={14} />
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
                  aria-label={isMuted ? "Unmute" : "Mute"}
                >
                  {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
                </button>
                <button
                  className={`${styles.controlBtn} ${isDeafened ? styles.controlActive : ""}`}
                  onClick={handleToggleDeafen}
                  title={isDeafened ? "Undeafen" : "Deafen"}
                  aria-label={isDeafened ? "Undeafen" : "Deafen"}
                >
                  {isDeafened ? (
                    <HeadphoneOff size={20} />
                  ) : (
                    <Headphones size={20} />
                  )}
                </button>
                <button
                  className={`${styles.controlBtn} ${isCameraOn ? styles.controlActive : ""}`}
                  onClick={handleToggleCamera}
                  title={isCameraOn ? "Turn off camera" : "Turn on camera"}
                  aria-label={isCameraOn ? "Turn off camera" : "Turn on camera"}
                >
                  {isCameraOn ? <VideoOff size={20} /> : <Video size={20} />}
                </button>
                <button
                  className={`${styles.controlBtn} ${isScreenSharing ? styles.controlActive : ""}`}
                  onClick={handleToggleScreen}
                  title={
                    isScreenSharing ? "Stop sharing screen" : "Share screen"
                  }
                  aria-label={
                    isScreenSharing ? "Stop sharing screen" : "Share screen"
                  }
                >
                  {isScreenSharing ? (
                    <ScreenShareOff size={20} />
                  ) : (
                    <ScreenShare size={20} />
                  )}
                </button>
                {/* Go Live button — broadcaster toggles; others not shown */}
                {!goLiveSession || isBroadcasting ? (
                  <button
                    className={`${styles.controlBtn} ${isBroadcasting ? styles.goLiveActive : ""}`}
                    onClick={
                      isBroadcasting
                        ? handleStopGoLive
                        : () => setShowQualityPicker(true)
                    }
                    title={isBroadcasting ? "End Go Live" : "Go Live"}
                    aria-label={isBroadcasting ? "End Go Live" : "Go Live"}
                  >
                    <Radio size={20} />
                  </button>
                ) : null}
                <button
                  className={`${styles.controlBtn} ${showSettings ? styles.controlActive : ""}`}
                  onClick={() => {
                    setShowSettings((v) => !v);
                    if (!showSettings) enumerateDevices();
                  }}
                  title="Audio Settings"
                  aria-label="Audio settings"
                >
                  <Settings size={20} />
                </button>
                <button
                  className={`${styles.controlBtn} ${styles.leaveBtn}`}
                  onClick={handleLeave}
                  title="Disconnect from voice"
                  aria-label="Disconnect from voice"
                >
                  <PhoneOff size={20} />
                </button>
              </div>

              {showSettings && (
                <div className={styles.deviceSettings}>
                  {/* ── Voice mode ── */}
                  <div className={styles.deviceRow}>
                    <label className={styles.deviceLabel}>Input Mode</label>
                    <div className={styles.voiceModeRow}>
                      <button
                        className={`${styles.voiceModeBtn} ${voiceMode === "vad" ? styles.voiceModeBtnActive : ""}`}
                        onClick={() => setVoiceMode("vad")}
                      >
                        Voice Activity
                      </button>
                      <button
                        className={`${styles.voiceModeBtn} ${voiceMode === "ptt" ? styles.voiceModeBtnActive : ""}`}
                        onClick={() => setVoiceMode("ptt")}
                      >
                        Push to Talk
                      </button>
                    </div>
                  </div>

                  {/* ── VAD sensitivity (only in VAD mode) ── */}
                  {voiceMode === "vad" && (
                    <div className={styles.deviceRow}>
                      <div className={styles.sensitivityHeader}>
                        <label className={styles.deviceLabel}>
                          Sensitivity
                        </label>
                        <span className={styles.sensitivityValue}>
                          {vadSensitivity}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={vadSensitivity}
                        onChange={(e) =>
                          setVadSensitivity(Number(e.target.value))
                        }
                        className={styles.sensitivitySlider}
                        aria-label="VAD sensitivity"
                      />
                    </div>
                  )}

                  {/* ── PTT key binding (only in PTT mode) ── */}
                  {voiceMode === "ptt" && (
                    <div className={styles.deviceRow}>
                      <label className={styles.deviceLabel}>
                        Push to Talk Key
                      </label>
                      <div className={styles.pttKeyRow}>
                        <span
                          className={`${styles.pttKeyDisplay} ${capturingKey ? styles.pttKeyCapturing : ""}`}
                        >
                          {capturingKey
                            ? "Press any key…"
                            : formatKeyCode(pttKey)}
                        </span>
                        <button
                          className={styles.pttChangeBtn}
                          onClick={() => setCapturingKey((v) => !v)}
                        >
                          {capturingKey ? "Cancel" : "Change"}
                        </button>
                      </div>
                      <p className={styles.pttHint}>
                        Works when browser tab is focused.
                      </p>
                    </div>
                  )}

                  {/* ── Microphone device ── */}
                  <div className={styles.deviceRow}>
                    <label className={styles.deviceLabel}>Microphone</label>
                    <select
                      className={styles.deviceSelect}
                      value={micDeviceId ?? ""}
                      onChange={(e) => setMicDeviceId(e.target.value || null)}
                    >
                      <option value="">Default</option>
                      {micDevices.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* ── Speaker device ── */}
                  <div className={styles.deviceRow}>
                    <label className={styles.deviceLabel}>Speaker</label>
                    <select
                      className={styles.deviceSelect}
                      value={speakerDeviceId ?? ""}
                      onChange={(e) =>
                        setSpeakerDeviceId(e.target.value || null)
                      }
                    >
                      <option value="">Default</option>
                      {speakerDevices.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.deviceRow}>
                    <label className={styles.deviceLabel}>Camera</label>
                    <select
                      className={styles.deviceSelect}
                      value={cameraDeviceId ?? ""}
                      onChange={(e) =>
                        setCameraDeviceId(e.target.value || null)
                      }
                    >
                      <option value="">Default</option>
                      {cameraDevices.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {/* Quality picker overlay */}
              {showQualityPicker && (
                <GoLiveQualitySelector
                  onSelect={handleStartGoLive}
                  onCancel={() => setShowQualityPicker(false)}
                />
              )}

              {/* Go Live banner for viewers (someone else is live) */}
              {goLiveSession && !isBroadcasting && (
                <GoLiveBanner
                  session={goLiveSession}
                  broadcasterName={broadcasterName}
                  viewerCount={viewerCount}
                  onWatch={() => setShowViewer(true)}
                />
              )}

              {/* PTT active indicator shown outside the settings panel */}
              {voiceMode === "ptt" && (
                <div
                  className={`${styles.pttIndicator} ${isPttActive ? styles.pttIndicatorActive : ""}`}
                  aria-live="polite"
                  aria-label={
                    isPttActive
                      ? "Transmitting"
                      : `PTT: ${formatKeyCode(pttKey)}`
                  }
                >
                  <span className={styles.pttDot} />
                  {isPttActive
                    ? "Transmitting"
                    : `PTT: ${formatKeyCode(pttKey)}`}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
