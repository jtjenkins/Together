import React, { useEffect, useState } from "react";
import { View, StyleSheet, Alert } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { initStorage } from "./utils/storage";
import { initAppStore } from "./stores/appStore";
import { RootNavigator } from "./navigation";

export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    initStorage()
      .then(() => {
        initAppStore();
        setReady(true);
      })
      .catch((err) => {
        console.error("[App] Storage init failed", err);
        Alert.alert(
          "Startup Error",
          "Failed to initialize storage. The app may not work correctly.",
        );
        setReady(true);
      });
  }, []);

  if (!ready) {
    return <View style={styles.splash} />;
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <RootNavigator />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: "#1a1a2e",
  },
});
