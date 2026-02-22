import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation";
import { useAppStore } from "../stores/appStore";

type Props = NativeStackScreenProps<RootStackParamList, "ServerSetup">;

export function ServerSetupScreen(_props: Props) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  const setServerUrl = useAppStore((s) => s.setServerUrl);

  async function handleConnect() {
    setError(null);

    const trimmed = url.trim().replace(/\/$/, "");
    if (!trimmed) {
      setError("Please enter a server URL.");
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      setError("Invalid URL. Example: http://localhost:8080");
      return;
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      setError("URL must use http:// or https://");
      return;
    }

    setIsChecking(true);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      try {
        await fetch(`${trimmed}/api/health`, { signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }
      setServerUrl(trimmed);
    } catch {
      setError("Could not reach the server. Check the URL and try again.");
      setIsChecking(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.card}>
        <View style={styles.logoRow}>
          <View style={styles.logoIcon}>
            <Text style={styles.logoLetter}>T</Text>
          </View>
          <Text style={styles.logoText}>Together</Text>
        </View>

        <Text style={styles.heading}>Connect to a Server</Text>
        <Text style={styles.subtitle}>
          Enter the address of your Together server to get started.
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Text style={styles.label}>Server URL</Text>
        <TextInput
          style={[styles.input, isChecking && styles.inputDisabled]}
          placeholder="http://localhost:8080"
          placeholderTextColor="#72767d"
          value={url}
          onChangeText={setUrl}
          editable={!isChecking}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={handleConnect}
        />

        <TouchableOpacity
          style={[styles.button, isChecking && styles.buttonDisabled]}
          onPress={handleConnect}
          disabled={isChecking}
        >
          {isChecking ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Connect</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a1a2e",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 400,
    backgroundColor: "#2a2a3e",
    borderRadius: 12,
    padding: 24,
  },
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
  },
  logoIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#7289da",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  logoLetter: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
  },
  logoText: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "700",
  },
  heading: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 6,
  },
  subtitle: {
    color: "#b9bbbe",
    fontSize: 14,
    marginBottom: 16,
  },
  error: {
    color: "#f04747",
    fontSize: 13,
    marginBottom: 12,
    backgroundColor: "#3d1a1a",
    padding: 10,
    borderRadius: 6,
  },
  label: {
    color: "#b9bbbe",
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  input: {
    backgroundColor: "#1a1a2e",
    borderWidth: 1,
    borderColor: "#36393f",
    borderRadius: 6,
    color: "#fff",
    fontSize: 16,
    padding: 12,
    marginBottom: 16,
  },
  inputDisabled: {
    opacity: 0.5,
  },
  button: {
    backgroundColor: "#7289da",
    borderRadius: 6,
    padding: 14,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
