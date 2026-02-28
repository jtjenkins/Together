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

interface PollFormModalProps {
  visible: boolean;
  channelId: string;
  prefill: string;
  onSubmit: () => void;
  onClose: () => void;
}

export function PollFormModal({
  visible,
  channelId,
  prefill,
  onSubmit,
  onClose,
}: PollFormModalProps) {
  const [question, setQuestion] = useState(prefill);
  const [options, setOptions] = useState(["", ""]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const updateOption = (i: number, val: string) =>
    setOptions((o) => o.map((v, idx) => (idx === i ? val : v)));
  const addOption = () => {
    if (options.length < 10) setOptions((o) => [...o, ""]);
  };
  const removeOption = (i: number) => {
    if (options.length > 2) setOptions((o) => o.filter((_, idx) => idx !== i));
  };

  const handleSubmit = async () => {
    const validOptions = options.map((o) => o.trim()).filter(Boolean);
    if (!question.trim()) {
      Alert.alert("Error", "Question is required");
      return;
    }
    if (validOptions.length < 2) {
      Alert.alert("Error", "At least 2 options required");
      return;
    }
    setIsSubmitting(true);
    try {
      await api.createPoll(channelId, {
        question: question.trim(),
        options: validOptions,
      });
      setQuestion(prefill);
      setOptions(["", ""]);
      onSubmit();
    } catch {
      Alert.alert("Error", "Failed to create poll");
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
          <Text style={styles.title}>📊 Create Poll</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.closeBtn}>✕</Text>
          </TouchableOpacity>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.body}>
          <Text style={styles.label}>Question</Text>
          <TextInput
            style={styles.input}
            placeholder="What's your question?"
            placeholderTextColor="#888"
            value={question}
            onChangeText={setQuestion}
            maxLength={500}
            autoFocus
          />
          <Text style={styles.label}>Options</Text>
          {options.map((opt, i) => (
            <View key={i} style={styles.optionRow}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder={`Option ${i + 1}`}
                placeholderTextColor="#888"
                value={opt}
                onChangeText={(v) => updateOption(i, v)}
                maxLength={200}
              />
              {options.length > 2 && (
                <TouchableOpacity
                  onPress={() => removeOption(i)}
                  style={styles.removeBtn}
                >
                  <Text style={styles.removeBtnText}>✕</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
          {options.length < 10 && (
            <TouchableOpacity onPress={addOption} style={styles.addBtn}>
              <Text style={styles.addBtnText}>+ Add Option</Text>
            </TouchableOpacity>
          )}
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
              <Text style={styles.submitText}>Create Poll</Text>
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
  optionRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  removeBtn: { padding: 8 },
  removeBtnText: { color: "#888", fontSize: 18 },
  addBtn: { padding: 8 },
  addBtnText: { color: "#5865f2", fontSize: 14 },
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
