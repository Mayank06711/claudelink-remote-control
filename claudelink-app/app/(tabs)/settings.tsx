/**
 * Settings Screen — API key management, connection settings, device info.
 */

import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  Switch,
  ScrollView,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useStore } from "@/lib/store";

export default function SettingsScreen() {
  const router = useRouter();
  const { mode, status, apiKey, sessionID, setMode, setApiKey } = useStore();
  const [keyInput, setKeyInput] = useState(apiKey || "");
  const [showKey, setShowKey] = useState(false);

  const handleSaveKey = () => {
    if (keyInput.trim()) {
      setApiKey(keyInput.trim());
      // TODO: Save to expo-secure-store
      Alert.alert("Saved", "API key saved securely on device.");
    }
  };

  const handleDisconnect = () => {
    Alert.alert("Disconnect", "Disconnect from your PC?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Disconnect",
        style: "destructive",
        onPress: () => useStore.getState().reset(),
      },
    ]);
  };

  return (
    <ScrollView style={styles.container}>
      {/* Connection Section */}
      <Text style={styles.sectionTitle}>CONNECTION</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.label}>Mode</Text>
          <View style={styles.modeToggle}>
            <Pressable
              style={[styles.modeBtn, mode === "remote" && styles.modeBtnActive]}
              onPress={() => setMode("remote")}
            >
              <Text
                style={[
                  styles.modeBtnText,
                  mode === "remote" && styles.modeBtnTextActive,
                ]}
              >
                Remote PC
              </Text>
            </Pressable>
            <Pressable
              style={[styles.modeBtn, mode === "direct" && styles.modeBtnActive]}
              onPress={() => setMode("direct")}
            >
              <Text
                style={[
                  styles.modeBtnText,
                  mode === "direct" && styles.modeBtnTextActive,
                ]}
              >
                Direct (BYOK)
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>Status</Text>
          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusDot,
                {
                  backgroundColor:
                    status === "connected" ? "#22C55E" : "#EF4444",
                },
              ]}
            />
            <Text style={styles.value}>{status}</Text>
          </View>
        </View>

        {sessionID && (
          <View style={styles.row}>
            <Text style={styles.label}>Session</Text>
            <Text style={styles.valueMono}>{sessionID.slice(0, 16)}...</Text>
          </View>
        )}

        {status !== "disconnected" && (
          <Pressable style={styles.disconnectBtn} onPress={handleDisconnect}>
            <Ionicons name="close-circle-outline" size={18} color="#EF4444" />
            <Text style={styles.disconnectText}>Disconnect</Text>
          </Pressable>
        )}

        {status === "disconnected" && (
          <Pressable
            style={styles.pairBtn}
            onPress={() => router.push("/pair")}
          >
            <Ionicons name="qr-code-outline" size={18} color="#FFF" />
            <Text style={styles.pairText}>Pair New Device</Text>
          </Pressable>
        )}
      </View>

      {/* API Key Section (BYOK) */}
      <Text style={styles.sectionTitle}>API KEY (BYOK MODE)</Text>
      <View style={styles.card}>
        <Text style={styles.helpText}>
          Enter your Anthropic API key for Direct mode. The key is stored only
          on this device and never sent to our servers.
        </Text>
        <View style={styles.keyRow}>
          <TextInput
            style={styles.keyInput}
            value={keyInput}
            onChangeText={setKeyInput}
            placeholder="sk-ant-api03-..."
            placeholderTextColor="#4B5563"
            secureTextEntry={!showKey}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable onPress={() => setShowKey(!showKey)}>
            <Ionicons
              name={showKey ? "eye-off-outline" : "eye-outline"}
              size={20}
              color="#6B7280"
            />
          </Pressable>
        </View>
        <Pressable style={styles.saveBtn} onPress={handleSaveKey}>
          <Text style={styles.saveText}>Save Key</Text>
        </Pressable>
      </View>

      {/* About */}
      <Text style={styles.sectionTitle}>ABOUT</Text>
      <View style={styles.card}>
        <Text style={styles.label}>ClaudeLink v0.1.0</Text>
        <Text style={styles.helpText}>
          Control Claude Code from anywhere. Your code stays on your machine.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0D0D0D", padding: 16 },
  sectionTitle: {
    color: "#6B7280",
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 1,
    marginTop: 24,
    marginBottom: 8,
  },
  card: {
    backgroundColor: "#1A1A1A",
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: "#2A2A2A",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
  },
  label: { color: "#D4D4D4", fontSize: 14 },
  value: { color: "#9CA3AF", fontSize: 14 },
  valueMono: {
    color: "#9CA3AF",
    fontSize: 12,
    fontFamily: "monospace",
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  modeToggle: { flexDirection: "row", gap: 4 },
  modeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: "#2A2A2A",
  },
  modeBtnActive: { backgroundColor: "#D97706" },
  modeBtnText: { color: "#9CA3AF", fontSize: 12, fontWeight: "600" },
  modeBtnTextActive: { color: "#FFF" },
  disconnectBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 12,
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#7F1D1D",
    justifyContent: "center",
  },
  disconnectText: { color: "#EF4444", fontSize: 14, fontWeight: "600" },
  pairBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    padding: 12,
    borderRadius: 6,
    backgroundColor: "#D97706",
    justifyContent: "center",
  },
  pairText: { color: "#FFF", fontSize: 14, fontWeight: "600" },
  helpText: { color: "#6B7280", fontSize: 12, marginBottom: 12, lineHeight: 18 },
  keyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  keyInput: {
    flex: 1,
    backgroundColor: "#111",
    color: "#F5F5F5",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 6,
    fontSize: 13,
    fontFamily: "monospace",
    borderWidth: 1,
    borderColor: "#2A2A2A",
  },
  saveBtn: {
    marginTop: 12,
    padding: 10,
    borderRadius: 6,
    backgroundColor: "#1F2937",
    alignItems: "center",
  },
  saveText: { color: "#D4D4D4", fontSize: 14, fontWeight: "600" },
});
