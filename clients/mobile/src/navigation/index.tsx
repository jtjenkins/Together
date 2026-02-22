import React, { useEffect } from "react";
import { ActivityIndicator, View, StyleSheet } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";

import { useAppStore } from "../stores/appStore";
import { useAuthStore } from "../stores/authStore";
import { useWebSocket } from "../hooks/useWebSocket";

import { ServerSetupScreen } from "../screens/ServerSetupScreen";
import { AuthScreen } from "../screens/AuthScreen";
import { ServerListScreen } from "../screens/ServerListScreen";
import { ChannelListScreen } from "../screens/ChannelListScreen";
import { ChatScreen } from "../screens/ChatScreen";
import { VoiceScreen } from "../screens/VoiceScreen";
import { SettingsScreen } from "../screens/SettingsScreen";

// ─── Param Lists ────────────────────────────────────────────────────────────

export type RootStackParamList = {
  ServerSetup: undefined;
  Auth: undefined;
  Main: undefined;
};

export type ServersStackParamList = {
  ServerList: undefined;
  ChannelList: { serverId: string; serverName: string };
  Chat: { channelId: string; channelName: string; serverId: string };
  Voice: { channelId: string; channelName: string; serverId: string };
};

export type MainTabParamList = {
  ServersTab: undefined;
  SettingsTab: undefined;
};

// ─── Stack / Tab Creators ───────────────────────────────────────────────────

const RootStack = createNativeStackNavigator<RootStackParamList>();
const ServersStack = createNativeStackNavigator<ServersStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

// ─── Servers Sub-Stack ──────────────────────────────────────────────────────

function ServersNavigator() {
  return (
    <ServersStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: "#2a2a3e" },
        headerTintColor: "#fff",
        headerTitleStyle: { fontWeight: "600" },
      }}
    >
      <ServersStack.Screen
        name="ServerList"
        component={ServerListScreen}
        options={{ title: "Servers" }}
      />
      <ServersStack.Screen
        name="ChannelList"
        component={ChannelListScreen}
        options={({ route }) => ({ title: route.params.serverName })}
      />
      <ServersStack.Screen
        name="Chat"
        component={ChatScreen}
        options={({ route }) => ({ title: `# ${route.params.channelName}` })}
      />
      <ServersStack.Screen
        name="Voice"
        component={VoiceScreen}
        options={({ route }) => ({ title: `🔊 ${route.params.channelName}` })}
      />
    </ServersStack.Navigator>
  );
}

// ─── Main Tabs ──────────────────────────────────────────────────────────────

function MainTabs() {
  useWebSocket();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: "#1a1a2e", borderTopColor: "#36393f" },
        tabBarActiveTintColor: "#7289da",
        tabBarInactiveTintColor: "#72767d",
      }}
    >
      <Tab.Screen
        name="ServersTab"
        component={ServersNavigator}
        options={{ title: "Servers", tabBarLabel: "Servers" }}
      />
      <Tab.Screen
        name="SettingsTab"
        component={SettingsScreen}
        options={{ title: "Settings", tabBarLabel: "Settings" }}
      />
    </Tab.Navigator>
  );
}

// ─── Root Navigator ─────────────────────────────────────────────────────────

export function RootNavigator() {
  const serverUrl = useAppStore((s) => s.serverUrl);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const restoreSession = useAuthStore((s) => s.restoreSession);

  // Restore session whenever the server URL becomes available
  useEffect(() => {
    if (serverUrl) {
      restoreSession();
    } else {
      useAuthStore.setState({ isLoading: false });
    }
  }, [serverUrl, restoreSession]);

  // Show a loading indicator while the session is being validated
  if (isLoading && serverUrl) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#7289da" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <RootStack.Navigator screenOptions={{ headerShown: false }}>
        {!serverUrl ? (
          <RootStack.Screen name="ServerSetup" component={ServerSetupScreen} />
        ) : !isAuthenticated ? (
          <RootStack.Screen name="Auth" component={AuthScreen} />
        ) : (
          <RootStack.Screen name="Main" component={MainTabs} />
        )}
      </RootStack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: "#1a1a2e",
    alignItems: "center",
    justifyContent: "center",
  },
});
