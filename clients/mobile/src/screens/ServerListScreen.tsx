import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  TextInput,
  Modal,
  ActivityIndicator,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { ServersStackParamList } from "../navigation";
import { useServerStore } from "../stores/serverStore";
import type { ServerDto } from "../types";

type Props = NativeStackScreenProps<ServersStackParamList, "ServerList">;

export function ServerListScreen({ navigation }: Props) {
  const {
    servers,
    isLoading,
    error,
    fetchServers,
    createServer,
    joinServer,
    clearError,
  } = useServerStore();
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "join">("create");
  const [inputValue, setInputValue] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  useEffect(() => {
    if (error) {
      Alert.alert("Error", error, [{ text: "OK", onPress: clearError }]);
    }
  }, [error, clearError]);

  const openCreate = () => {
    setModalMode("create");
    setInputValue("");
    setShowModal(true);
  };

  const openJoin = () => {
    setModalMode("join");
    setInputValue("");
    setShowModal(true);
  };

  const handleSubmit = async () => {
    const value = inputValue.trim();
    if (!value) return;
    setSubmitting(true);
    try {
      if (modalMode === "create") {
        await createServer({ name: value });
      } else {
        await joinServer(value);
      }
      setShowModal(false);
    } catch {
      // Error handled by store
    } finally {
      setSubmitting(false);
    }
  };

  const renderItem = ({ item }: { item: ServerDto }) => (
    <TouchableOpacity
      style={styles.serverItem}
      onPress={() =>
        navigation.navigate("ChannelList", {
          serverId: item.id,
          serverName: item.name,
        })
      }
    >
      <View style={styles.serverIcon}>
        <Text style={styles.serverIconText}>
          {item.name.charAt(0).toUpperCase()}
        </Text>
      </View>
      <View style={styles.serverInfo}>
        <Text style={styles.serverName}>{item.name}</Text>
        <Text style={styles.serverMeta}>{item.member_count} members</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {isLoading && servers.length === 0 ? (
        <ActivityIndicator style={styles.loader} size="large" color="#7289da" />
      ) : (
        <FlatList
          data={servers}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.empty}>
              No servers yet. Create or join one!
            </Text>
          }
        />
      )}

      <View style={styles.fab}>
        <TouchableOpacity style={styles.fabBtn} onPress={openCreate}>
          <Text style={styles.fabText}>+ Create</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.fabBtn, styles.fabBtnSecondary]}
          onPress={openJoin}
        >
          <Text style={styles.fabText}>Join</Text>
        </TouchableOpacity>
      </View>

      <Modal
        visible={showModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {modalMode === "create" ? "Create Server" : "Join Server"}
            </Text>
            <Text style={styles.modalLabel}>
              {modalMode === "create" ? "Server Name" : "Server ID"}
            </Text>
            <TextInput
              style={styles.modalInput}
              placeholder={
                modalMode === "create" ? "My Awesome Server" : "Enter server ID"
              }
              placeholderTextColor="#72767d"
              value={inputValue}
              onChangeText={setInputValue}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => setShowModal(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalConfirm,
                  submitting && styles.buttonDisabled,
                ]}
                onPress={handleSubmit}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.modalConfirmText}>
                    {modalMode === "create" ? "Create" : "Join"}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a1a2e",
  },
  list: {
    padding: 16,
    paddingBottom: 100,
  },
  loader: {
    flex: 1,
  },
  empty: {
    color: "#72767d",
    textAlign: "center",
    marginTop: 40,
    fontSize: 15,
  },
  serverItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#2a2a3e",
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  serverIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#7289da",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  serverIconText: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
  },
  serverInfo: {
    flex: 1,
  },
  serverName: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  serverMeta: {
    color: "#72767d",
    fontSize: 13,
    marginTop: 2,
  },
  chevron: {
    color: "#72767d",
    fontSize: 22,
  },
  fab: {
    position: "absolute",
    bottom: 24,
    right: 16,
    flexDirection: "row",
    gap: 10,
  },
  fabBtn: {
    backgroundColor: "#7289da",
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 12,
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  fabBtnSecondary: {
    backgroundColor: "#4f545c",
  },
  fabText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: "#2a2a3e",
    borderRadius: 12,
    padding: 24,
  },
  modalTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 16,
  },
  modalLabel: {
    color: "#b9bbbe",
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    marginBottom: 6,
  },
  modalInput: {
    backgroundColor: "#1a1a2e",
    borderWidth: 1,
    borderColor: "#36393f",
    borderRadius: 6,
    color: "#fff",
    fontSize: 15,
    padding: 12,
    marginBottom: 16,
  },
  modalButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
  },
  modalCancel: {
    padding: 10,
    paddingHorizontal: 16,
  },
  modalCancelText: {
    color: "#b9bbbe",
    fontSize: 15,
  },
  modalConfirm: {
    backgroundColor: "#7289da",
    borderRadius: 6,
    padding: 10,
    paddingHorizontal: 18,
    minWidth: 80,
    alignItems: "center",
  },
  modalConfirmText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
