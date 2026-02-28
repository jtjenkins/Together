import React, { useState } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { api } from "../api/client";

interface EventFormModalProps {
  visible: boolean;
  channelId: string;
  prefill: string;
  onSubmit: () => void;
  onClose: () => void;
}

export function EventFormModal({
  visible,
  channelId,
  prefill,
  onSubmit,
  onClose,
}: EventFormModalProps) {
  const [name, setName] = useState(prefill);
  const [description, setDescription] = useState("");
  // Default: tomorrow at noon
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(12, 0, 0, 0);
  const [startsAt, setStartsAt] = useState(tomorrow.toISOString().slice(0, 16)); // "YYYY-MM-DDTHH:MM"
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) {
      Alert.alert("Error", "Event name is required");
      return;
    }
    setIsSubmitting(true);
    try {
      await api.createEvent(channelId, {
        name: name.trim(),
        description: description.trim() || undefined,
        starts_at: new Date(startsAt).toISOString(),
      });
      setName(prefill);
      setDescription("");
      onSubmit();
    } catch {
      Alert.alert("Error", "Failed to create event");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>📅 Schedule Event</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.closeBtn}>✕</Text>
          </TouchableOpacity>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.body}>
          <Text style={styles.label}>Event Name</Text>
          <TextInput
            style={styles.input}
            placeholder="What's the event?"
            placeholderTextColor="#888"
            value={name}
            onChangeText={setName}
            maxLength={200}
            autoFocus
          />
          <Text style={styles.label}>Start Date &amp; Time</Text>
          <TextInput
            style={styles.input}
            placeholder="YYYY-MM-DDTHH:MM"
            placeholderTextColor="#888"
            value={startsAt}
            onChangeText={setStartsAt}
          />
          <Text style={styles.hint}>Format: 2026-03-15T14:00 (24h)</Text>
          <Text style={styles.label}>Description (optional)</Text>
          <TextInput
            style={[styles.input, styles.descInput]}
            placeholder="Describe the event…"
            placeholderTextColor="#888"
            value={description}
            onChangeText={setDescription}
            maxLength={2000}
            multiline
          />
        </ScrollView>
        <View style={styles.footer}>
          <TouchableOpacity onPress={onClose} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleSubmit}
            style={[styles.submitBtn, isSubmitting && styles.submitBtnDisabled]}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.submitText}>Schedule Event</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#1e1f22" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    paddingTop: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#3f4248",
  },
  title: { color: "#fff", fontSize: 17, fontWeight: "600" },
  closeBtn: { color: "#aaa", fontSize: 22 },
  body: { padding: 16, gap: 8 },
  label: {
    color: "#aaa",
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 4,
    textTransform: "uppercase",
  },
  hint: { color: "#666", fontSize: 11, marginBottom: 8, marginTop: -4 },
  input: {
    backgroundColor: "#2b2d31",
    borderRadius: 8,
    padding: 10,
    color: "#fff",
    fontSize: 15,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#3f4248",
  },
  descInput: { height: 80, textAlignVertical: "top" },
  footer: {
    flexDirection: "row",
    padding: 16,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: "#3f4248",
  },
  cancelBtn: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#3f4248",
    alignItems: "center",
  },
  cancelText: { color: "#aaa", fontSize: 15 },
  submitBtn: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#5865f2",
    alignItems: "center",
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitText: { color: "#fff", fontWeight: "600", fontSize: 15 },
});
