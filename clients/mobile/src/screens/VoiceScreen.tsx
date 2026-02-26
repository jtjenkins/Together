import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { ServersStackParamList } from "../navigation";
import { useVoiceStore } from "../stores/voiceStore";
import { useAuthStore } from "../stores/authStore";
import { useWebRTC } from "../hooks/useWebRTC";
import { gateway } from "../api/websocket";
import { api } from "../api/client";
import type { VoiceParticipant, VoiceStateUpdateEvent } from "../types";

type Props = NativeStackScreenProps<ServersStackParamList, "Voice">;

export function VoiceScreen({ route, navigation }: Props) {
  const { channelId } = route.params;

  const user = useAuthStore((s) => s.user);
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
  const [initialPeers, setInitialPeers] = useState<string[]>([]);
  const [rtcError, setRtcError] = useState<string | null>(null);

  const isConnected = connectedChannelId === channelId;

  const isConnectedRef = useRef(false);
  useEffect(() => {
    isConnectedRef.current = isConnected;
  }, [isConnected]);

  const fetchParticipants = useCallback(async () => {
    try {
      const list = await api.listVoiceParticipants(channelId);
      setParticipants(list);
    } catch (err) {
      console.warn("[VoiceScreen] Failed to fetch participants", err);
      setRtcError("Could not load participants.");
    }
  }, [channelId]);

  useEffect(() => {
    fetchParticipants();
  }, [fetchParticipants]);

  // Keep participant list up-to-date via WebSocket events
  useEffect(() => {
    const unsub = gateway.on(
      "VOICE_STATE_UPDATE",
      (event: VoiceStateUpdateEvent) => {
        if (event.channel_id === channelId) {
          setParticipants((prev) => {
            const exists = prev.some((p) => p.user_id === event.user_id);
            if (exists) {
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
          setParticipants((prev) =>
            prev.filter((p) => p.user_id !== event.user_id),
          );
        }
      },
    );
    return unsub;
  }, [channelId]);

  // Disconnect when navigating away
  useEffect(() => {
    return () => {
      if (isConnectedRef.current) leave().catch(() => {});
    };
  }, [leave]);

  useWebRTC({
    enabled: isConnected,
    myUserId: user?.id ?? "",
    participants,
    initialPeers,
    isMuted,
    isDeafened,
    onError: setRtcError,
  });

  const handleJoin = async () => {
    clearVoiceError();
    setRtcError(null);

    // Request microphone permission on Android (iOS prompts automatically)
    if (Platform.OS === "android") {
      const { PermissionsAndroid } = require("react-native");
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        {
          title: "Microphone Permission",
          message: "Together needs microphone access to join voice channels.",
          buttonPositive: "Grant",
          buttonNegative: "Deny",
        },
      );
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        Alert.alert(
          "Permission Required",
          "Microphone access is required to join voice channels.",
        );
        return;
      }
    }

    try {
      await join(channelId);
    } catch {
      // Error shown via voiceError from store
      return;
    }
    try {
      const list = await api.listVoiceParticipants(channelId);
      setParticipants(list);
      setInitialPeers(
        list.filter((p) => p.user_id !== user?.id).map((p) => p.user_id),
      );
    } catch {
      setRtcError("Joined voice, but could not load participants.");
    }
  };

  const handleLeave = async () => {
    try {
      await leave();
      setInitialPeers([]);
      await fetchParticipants();
    } catch (err) {
      console.error("[VoiceScreen] handleLeave error", err);
    } finally {
      navigation.goBack();
    }
  };

  const handleToggleMute = async () => {
    if (!isConnected) return;
    try {
      await toggleMute();
    } catch (err) {
      console.error("[VoiceScreen] toggleMute failed", err);
      setRtcError(
        err instanceof Error ? err.message : "Failed to update mute state",
      );
    }
  };

  const handleToggleDeafen = async () => {
    if (!isConnected) return;
    try {
      await toggleDeafen();
    } catch (err) {
      console.error("[VoiceScreen] toggleDeafen failed", err);
      setRtcError(
        err instanceof Error ? err.message : "Failed to update deafen state",
      );
    }
  };

  const activeError = voiceError ?? rtcError;

  const renderParticipant = ({ item }: { item: VoiceParticipant }) => {
    const isSelf = item.user_id === user?.id;
    const muted = item.self_mute || item.server_mute;
    const deafened = item.self_deaf || item.server_deaf;

    return (
      <View style={styles.participant}>
        <View
          style={[
            styles.participantAvatar,
            isSelf && styles.participantAvatarSelf,
          ]}
        >
          <Text style={styles.participantAvatarText}>
            {(item.username || "?").charAt(0).toUpperCase()}
          </Text>
        </View>
        <Text
          style={[styles.participantName, isSelf && styles.participantNameSelf]}
        >
          {item.username || item.user_id}
          {isSelf ? " (you)" : ""}
        </Text>
        <View style={styles.participantIcons}>
          {muted && <Feather name="mic-off" size={16} color="#72767d" />}
          {deafened && <Feather name="volume-x" size={16} color="#72767d" />}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {activeError && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{activeError}</Text>
          <TouchableOpacity
            onPress={() => {
              clearVoiceError();
              setRtcError(null);
            }}
            style={{ paddingLeft: 12 }}
          >
            <Feather name="x" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.participantsSection}>
        <Text style={styles.sectionTitle}>
          Participants — {participants.length}
        </Text>

        <FlatList
          data={participants}
          keyExtractor={(item) => item.user_id}
          renderItem={renderParticipant}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No one is here yet</Text>
          }
          contentContainerStyle={styles.participantList}
        />
      </View>

      <View style={styles.controls}>
        {!isConnected ? (
          <TouchableOpacity
            style={[styles.joinBtn, isConnecting && styles.joinBtnDisabled]}
            onPress={handleJoin}
            disabled={isConnecting}
          >
            {isConnecting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.joinBtnText}>Join Voice</Text>
            )}
          </TouchableOpacity>
        ) : (
          <View style={styles.connectedControls}>
            <View style={styles.connectedIndicator}>
              <View style={styles.indicatorDot} />
              <Text style={styles.connectedText}>Voice Connected</Text>
            </View>
            <View style={styles.controlBtns}>
              <TouchableOpacity
                style={[styles.controlBtn, isMuted && styles.controlBtnActive]}
                onPress={handleToggleMute}
              >
                {isMuted ? (
                  <Feather
                    name="mic-off"
                    size={24}
                    color="#dcddde"
                    style={styles.controlBtnIcon}
                  />
                ) : (
                  <Feather
                    name="mic"
                    size={24}
                    color="#dcddde"
                    style={styles.controlBtnIcon}
                  />
                )}
                <Text style={styles.controlBtnLabel}>
                  {isMuted ? "Unmute" : "Mute"}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.controlBtn,
                  isDeafened && styles.controlBtnActive,
                ]}
                onPress={handleToggleDeafen}
              >
                {isDeafened ? (
                  <Feather
                    name="volume-x"
                    size={24}
                    color="#dcddde"
                    style={styles.controlBtnIcon}
                  />
                ) : (
                  <Feather
                    name="headphones"
                    size={24}
                    color="#dcddde"
                    style={styles.controlBtnIcon}
                  />
                )}
                <Text style={styles.controlBtnLabel}>
                  {isDeafened ? "Undeafen" : "Deafen"}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.controlBtn, styles.controlBtnLeave]}
                onPress={handleLeave}
              >
                <Feather
                  name="phone-off"
                  size={24}
                  color="#dcddde"
                  style={styles.controlBtnIcon}
                />
                <Text style={styles.controlBtnLabel}>Leave</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a1a2e",
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#f04747",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  errorText: {
    color: "#fff",
    fontSize: 14,
    flex: 1,
  },
  participantsSection: {
    flex: 1,
    paddingTop: 16,
  },
  sectionTitle: {
    color: "#72767d",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  participantList: {
    paddingHorizontal: 16,
  },
  participant: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderRadius: 6,
  },
  participantAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#4f545c",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  participantAvatarSelf: {
    backgroundColor: "#7289da",
  },
  participantAvatarText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  participantName: {
    color: "#dcddde",
    fontSize: 15,
    flex: 1,
  },
  participantNameSelf: {
    color: "#fff",
    fontWeight: "600",
  },
  participantIcons: {
    flexDirection: "row",
    gap: 4,
  },
  emptyText: {
    color: "#72767d",
    fontSize: 14,
    textAlign: "center",
    marginTop: 24,
  },
  controls: {
    padding: 24,
    borderTopWidth: 1,
    borderTopColor: "#2a2a3e",
  },
  joinBtn: {
    backgroundColor: "#43b581",
    borderRadius: 8,
    padding: 16,
    alignItems: "center",
  },
  joinBtnDisabled: {
    opacity: 0.6,
  },
  joinBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  connectedControls: {
    gap: 16,
  },
  connectedIndicator: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  indicatorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#43b581",
  },
  connectedText: {
    color: "#43b581",
    fontSize: 14,
    fontWeight: "600",
  },
  controlBtns: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 16,
  },
  controlBtn: {
    alignItems: "center",
    backgroundColor: "#2a2a3e",
    borderRadius: 12,
    padding: 14,
    minWidth: 80,
  },
  controlBtnActive: {
    backgroundColor: "#f04747",
  },
  controlBtnLeave: {
    backgroundColor: "#f04747",
  },
  controlBtnIcon: {
    marginBottom: 4,
  },
  controlBtnLabel: {
    color: "#dcddde",
    fontSize: 12,
  },
});
