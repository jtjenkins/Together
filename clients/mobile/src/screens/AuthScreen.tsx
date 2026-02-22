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
  ScrollView,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation";
import { useAuthStore } from "../stores/authStore";

type Props = NativeStackScreenProps<RootStackParamList, "Auth">;

export function AuthScreen(_props: Props) {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { login, register, error, clearError } = useAuthStore();

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      if (isLogin) {
        await login({ username, password });
      } else {
        await register({ username, email: email || undefined, password });
      }
    } catch {
      // Error shown via store
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleMode = () => {
    setIsLogin(!isLogin);
    clearError();
    setUsername("");
    setEmail("");
    setPassword("");
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
          <View style={styles.logoRow}>
            <View style={styles.logoIcon}>
              <Text style={styles.logoLetter}>T</Text>
            </View>
            <Text style={styles.logoText}>Together</Text>
          </View>

          <Text style={styles.heading}>
            {isLogin ? "Welcome back!" : "Create an account"}
          </Text>
          <Text style={styles.subtitle}>
            {isLogin
              ? "Sign in to continue to Together"
              : "Join your community on Together"}
          </Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Text style={styles.label}>Username</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter your username"
            placeholderTextColor="#72767d"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
          />

          {!isLogin && (
            <>
              <Text style={styles.label}>
                Email <Text style={styles.optional}>(optional)</Text>
              </Text>
              <TextInput
                style={styles.input}
                placeholder="Enter your email"
                placeholderTextColor="#72767d"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                returnKeyType="next"
              />
            </>
          )}

          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter your password"
            placeholderTextColor="#72767d"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            returnKeyType="go"
            onSubmitEditing={handleSubmit}
          />

          <TouchableOpacity
            style={[styles.button, isSubmitting && styles.buttonDisabled]}
            onPress={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>
                {isLogin ? "Sign In" : "Create Account"}
              </Text>
            )}
          </TouchableOpacity>

          <View style={styles.toggleRow}>
            <Text style={styles.toggleText}>
              {isLogin
                ? "Don't have an account? "
                : "Already have an account? "}
            </Text>
            <TouchableOpacity onPress={toggleMode}>
              <Text style={styles.toggleBtn}>
                {isLogin ? "Register" : "Sign In"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a1a2e",
  },
  scroll: {
    flexGrow: 1,
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
    marginBottom: 4,
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
    fontSize: 16,
    padding: 12,
    marginBottom: 14,
  },
  button: {
    backgroundColor: "#7289da",
    borderRadius: 6,
    padding: 14,
    alignItems: "center",
    marginTop: 4,
    marginBottom: 16,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  toggleRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  toggleText: {
    color: "#b9bbbe",
    fontSize: 14,
  },
  toggleBtn: {
    color: "#7289da",
    fontSize: 14,
    fontWeight: "600",
  },
});
