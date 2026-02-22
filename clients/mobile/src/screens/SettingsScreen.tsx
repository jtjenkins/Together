import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { useAuthStore } from "../stores/authStore";
import { useAppStore } from "../stores/appStore";
import type { UserStatus } from "../types";

const STATUS_OPTIONS: { value: UserStatus; label: string; color: string }[] = [
  { value: "online", label: "Online", color: "#43b581" },
  { value: "away", label: "Away", color: "#faa61a" },
  { value: "dnd", label: "Do Not Disturb", color: "#f04747" },
  { value: "offline", label: "Invisible", color: "#747f8d" },
];

export function SettingsScreen() {
  const user = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const updatePresence = useAuthStore((s) => s.updatePresence);
  const logout = useAuthStore((s) => s.logout);

  const serverUrl = useAppStore((s) => s.serverUrl);
  const clearServerUrl = useAppStore((s) => s.clearServerUrl);
  const setServerUrl = useAppStore((s) => s.setServerUrl);

  const [avatarUrl, setAvatarUrl] = useState(user?.avatar_url ?? "");
  const [status, setStatus] = useState<UserStatus>(user?.status ?? "online");
  const [customStatus, setCustomStatus] = useState(user?.custom_status ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [showUrlEdit, setShowUrlEdit] = useState(false);
  const [newUrl, setNewUrl] = useState(serverUrl ?? "");
  const [isCheckingUrl, setIsCheckingUrl] = useState(false);

  const handleSaveProfile = async () => {
    setIsSubmitting(true);
    setError(null);
    setSuccess(false);
    try {
      await updateProfile({
        avatar_url: avatarUrl.trim() || null,
        custom_status: customStatus.trim() || null,
      });
      if (status !== user?.status) {
        updatePresence(status, customStatus.trim() || null);
      }
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update profile");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChangeServerUrl = async () => {
    const trimmed = newUrl.trim().replace(/\/$/, "");
    if (!trimmed) {
      Alert.alert("Error", "Please enter a server URL.");
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      Alert.alert("Error", "Invalid URL. Example: http://localhost:8080");
      return;
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      Alert.alert("Error", "URL must use http:// or https://");
      return;
    }

    setIsCheckingUrl(true);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      try {
        await fetch(`${trimmed}/api/health`, { signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }
      setServerUrl(trimmed);
      setShowUrlEdit(false);
      Alert.alert("Success", "Server URL updated.");
    } catch {
      Alert.alert(
        "Error",
        "Could not reach the server. Check the URL and try again.",
      );
    } finally {
      setIsCheckingUrl(false);
    }
  };

  const handleLogout = () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: () => logout(),
      },
    ]);
  };

  const handleResetServer = () => {
    Alert.alert(
      "Change Server",
      "This will sign you out and take you back to the server setup screen.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: () => {
            logout();
            clearServerUrl();
          },
        },
      ],
    );
  };

  if (!user) return null;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* Profile section */}
      <Text style={styles.sectionTitle}>Profile</Text>

      <View style={styles.card}>
        <View style={styles.profileHeader}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {user.username.charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.username}>{user.username}</Text>
            <View style={styles.statusRow}>
              <View
                style={[
                  styles.statusDot,
                  {
                    backgroundColor:
                      STATUS_OPTIONS.find((o) => o.value === user.status)
                        ?.color ?? "#747f8d",
                  },
                ]}
              />
              <Text style={styles.statusText}>
                {STATUS_OPTIONS.find((o) => o.value === user.status)?.label ??
                  "Online"}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* Edit profile */}
      <Text style={styles.sectionTitle}>Edit Profile</Text>

      <View style={styles.card}>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {success ? (
          <Text style={styles.successText}>Profile updated!</Text>
        ) : null}

        <Text style={styles.fieldLabel}>Username (read-only)</Text>
        <TextInput
          style={[styles.input, styles.inputDisabled]}
          value={user.username}
          editable={false}
        />

        <Text style={styles.fieldLabel}>
          Avatar URL <Text style={styles.optional}>(optional)</Text>
        </Text>
        <TextInput
          style={styles.input}
          value={avatarUrl}
          onChangeText={setAvatarUrl}
          placeholder="https://example.com/avatar.png"
          placeholderTextColor="#72767d"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />

        <Text style={styles.fieldLabel}>Status</Text>
        <View style={styles.statusOptions}>
          {STATUS_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.value}
              style={[
                styles.statusOption,
                status === opt.value && styles.statusOptionActive,
              ]}
              onPress={() => setStatus(opt.value)}
            >
              <View
                style={[styles.statusDot, { backgroundColor: opt.color }]}
              />
              <Text
                style={[
                  styles.statusOptionText,
                  status === opt.value && styles.statusOptionTextActive,
                ]}
              >
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.fieldLabel}>
          Custom Status <Text style={styles.optional}>(optional)</Text>
        </Text>
        <TextInput
          style={styles.input}
          value={customStatus}
          onChangeText={setCustomStatus}
          placeholder="What are you up to?"
          placeholderTextColor="#72767d"
        />

        <TouchableOpacity
          style={[styles.saveBtn, isSubmitting && styles.saveBtnDisabled]}
          onPress={handleSaveProfile}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveBtnText}>Save Changes</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Server URL section */}
      <Text style={styles.sectionTitle}>Server</Text>

      <View style={styles.card}>
        <Text style={styles.fieldLabel}>Current Server</Text>
        <Text style={styles.serverUrlText} numberOfLines={1}>
          {serverUrl ?? "Not configured"}
        </Text>

        {showUrlEdit ? (
          <View style={styles.urlEditBlock}>
            <TextInput
              style={styles.input}
              value={newUrl}
              onChangeText={setNewUrl}
              placeholder="http://localhost:8080"
              placeholderTextColor="#72767d"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              editable={!isCheckingUrl}
            />
            <View style={styles.urlEditBtns}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => {
                  setShowUrlEdit(false);
                  setNewUrl(serverUrl ?? "");
                }}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.saveBtn,
                  isCheckingUrl && styles.saveBtnDisabled,
                ]}
                onPress={handleChangeServerUrl}
                disabled={isCheckingUrl}
              >
                {isCheckingUrl ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.saveBtnText}>Connect</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => {
              setNewUrl(serverUrl ?? "");
              setShowUrlEdit(true);
            }}
          >
            <Text style={styles.secondaryBtnText}>Change Server URL</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.secondaryBtn, styles.dangerBtn]}
          onPress={handleResetServer}
        >
          <Text style={styles.dangerBtnText}>Reset Server & Sign Out</Text>
        </TouchableOpacity>
      </View>

      {/* Sign out */}
      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
        <Text style={styles.logoutBtnText}>Sign Out</Text>
      </TouchableOpacity>

      <View style={styles.bottomSpacer} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a1a2e",
  },
  content: {
    padding: 16,
  },
  sectionTitle: {
    color: "#72767d",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: 20,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  card: {
    backgroundColor: "#2a2a3e",
    borderRadius: 10,
    padding: 16,
    marginBottom: 4,
  },
  profileHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#7289da",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  avatarText: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "700",
  },
  profileInfo: {
    flex: 1,
  },
  username: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 4,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusText: {
    color: "#b9bbbe",
    fontSize: 13,
  },
  errorText: {
    color: "#f04747",
    fontSize: 13,
    backgroundColor: "#3d1a1a",
    padding: 10,
    borderRadius: 6,
    marginBottom: 12,
  },
  successText: {
    color: "#43b581",
    fontSize: 13,
    backgroundColor: "#1a3d2a",
    padding: 10,
    borderRadius: 6,
    marginBottom: 12,
  },
  fieldLabel: {
    color: "#b9bbbe",
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
    marginTop: 12,
  },
  optional: {
    color: "#72767d",
    textTransform: "none",
    fontWeight: "400",
  },
  input: {
    backgroundColor: "#1a1a2e",
    borderWidth: 1,
    borderColor: "#36393f",
    borderRadius: 6,
    color: "#fff",
    fontSize: 15,
    padding: 12,
    marginBottom: 4,
  },
  inputDisabled: {
    opacity: 0.5,
  },
  statusOptions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 4,
  },
  statusOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: "#1a1a2e",
    borderWidth: 1,
    borderColor: "transparent",
  },
  statusOptionActive: {
    borderColor: "#7289da",
    backgroundColor: "#3a3a5e",
  },
  statusOptionText: {
    color: "#b9bbbe",
    fontSize: 13,
  },
  statusOptionTextActive: {
    color: "#fff",
    fontWeight: "600",
  },
  saveBtn: {
    backgroundColor: "#7289da",
    borderRadius: 6,
    padding: 13,
    alignItems: "center",
    marginTop: 12,
  },
  saveBtnDisabled: {
    opacity: 0.6,
  },
  saveBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  serverUrlText: {
    color: "#b9bbbe",
    fontSize: 14,
    marginBottom: 12,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  urlEditBlock: {
    marginTop: 4,
  },
  urlEditBtns: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 8,
  },
  cancelBtn: {
    padding: 12,
    paddingHorizontal: 16,
  },
  cancelBtnText: {
    color: "#b9bbbe",
    fontSize: 14,
  },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: "#4f545c",
    borderRadius: 6,
    padding: 12,
    alignItems: "center",
    marginTop: 10,
  },
  secondaryBtnText: {
    color: "#b9bbbe",
    fontSize: 14,
  },
  dangerBtn: {
    borderColor: "#f04747",
  },
  dangerBtnText: {
    color: "#f04747",
    fontSize: 14,
  },
  logoutBtn: {
    backgroundColor: "#f04747",
    borderRadius: 6,
    padding: 14,
    alignItems: "center",
    marginTop: 20,
  },
  logoutBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  bottomSpacer: {
    height: 40,
  },
});
