/**
 * Pair Screen — three modes:
 * 1. Quick Connect — fetch pairing data from companion HTTP endpoint (most reliable)
 * 2. QR Code scanner — scan QR from companion (camera)
 * 3. Manual entry — type session ID + relay URL
 */

import { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  Platform,
  Alert,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useStore } from "@/lib/store";
import { generateKeyPair, parsePublicKey } from "@/lib/crypto";
import { connectToCompanion } from "@/lib/connection";
import type { PairingData } from "@/lib/protocol";

type Mode = "quick" | "scan" | "manual";

export default function PairScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("quick");
  const [scanned, setScanned] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [loading, setLoading] = useState(false);
  const [debugText, setDebugText] = useState("");
  const status = useStore((s) => s.status);

  // Auto-request camera permission when switching to scan mode
  useEffect(() => {
    if (mode === "scan" && !permission?.granted) {
      requestPermission();
    }
  }, [mode]);

  // Manual entry fields
  const [sessionID, setSessionID] = useState("");
  const [relayURL, setRelayURL] = useState("ws://192.168.31.125:8787");
  const [companionIP, setCompanionIP] = useState("192.168.31.125");

  /** Connect using pairing data (shared by all modes) */
  const doPair = (pairing: PairingData) => {
    // Generate our key pair
    const keyPair = generateKeyPair();
    const store = useStore.getState();
    store.setKeyPair(keyPair);

    // Try to parse peer key (optional for MVP)
    if (pairing.k) {
      try {
        const peerKey = parsePublicKey(pairing.k);
        store.setPeerPublicKey(peerKey);
      } catch {
        // Skip E2E for now
      }
    }

    connectToCompanion(pairing);
    router.back();
  };

  /** Quick Connect — fetch from companion HTTP endpoint */
  const handleQuickConnect = async () => {
    setLoading(true);
    setDebugText("");
    const url = `http://${companionIP}:8788/pair`;
    try {
      const resp = await fetch(url);
      const text = await resp.text();
      setDebugText(`Response: ${text.substring(0, 200)}`);
      const pairing: PairingData = JSON.parse(text);

      if (!pairing.s || !pairing.r) {
        throw new Error("Missing session or relay in response");
      }

      doPair(pairing);
    } catch (err: any) {
      setDebugText(`Error: ${err?.message}\nURL: ${url}`);
      Alert.alert("Connection Failed", `Could not reach companion at ${url}\n\n${err?.message}`);
    } finally {
      setLoading(false);
    }
  };

  /** QR scan handler */
  const handlePairingData = (data: string) => {
    if (scanned) return;
    setScanned(true);
    setDebugText(`Scanned: ${data.substring(0, 100)}`);

    try {
      const pairing: PairingData = JSON.parse(data.trim());
      if (!pairing.s || !pairing.r) {
        throw new Error(`Missing fields: s=${pairing.s}, r=${pairing.r}`);
      }
      doPair(pairing);
    } catch (err: any) {
      const preview = data.length > 80 ? data.substring(0, 80) + "..." : data;
      Alert.alert("QR Error", `${err?.message}\n\nData: ${preview}`);
      setScanned(false);
    }
  };

  /** Manual connect */
  const handleManualConnect = () => {
    const sid = sessionID.trim();
    const url = relayURL.trim();
    if (!sid) { Alert.alert("Missing", "Enter the session ID."); return; }
    if (!url || !url.startsWith("ws")) { Alert.alert("Missing", "Enter a valid relay URL."); return; }

    doPair({ s: sid, r: url, k: "", v: 1 });
  };

  // Show connecting state
  if (status === "connecting") {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#D97706" />
        <Text style={styles.connectingText}>Connecting to companion...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ flexGrow: 1 }}>
      {/* Mode toggle */}
      <View style={styles.modeToggle}>
        {(["quick", "scan", "manual"] as Mode[]).map((m) => (
          <Pressable
            key={m}
            style={[styles.modeBtn, mode === m && styles.modeBtnActive]}
            onPress={() => setMode(m)}
          >
            <Ionicons
              name={m === "quick" ? "flash-outline" : m === "scan" ? "qr-code-outline" : "create-outline"}
              size={14}
              color={mode === m ? "#FFF" : "#9CA3AF"}
            />
            <Text style={[styles.modeBtnText, mode === m && styles.modeBtnTextActive]}>
              {m === "quick" ? "Quick" : m === "scan" ? "QR Scan" : "Manual"}
            </Text>
          </Pressable>
        ))}
      </View>

      {mode === "quick" && (
        /* ======== QUICK CONNECT MODE ======== */
        <View style={styles.quickArea}>
          <Ionicons name="flash" size={48} color="#D97706" style={{ alignSelf: "center" }} />
          <Text style={styles.quickTitle}>Quick Connect</Text>
          <Text style={styles.quickHelp}>
            Your phone and PC must be on the same WiFi.{"\n"}
            The companion is running on your PC — tap Connect to pair instantly.
          </Text>

          <Text style={styles.label}>Companion PC IP</Text>
          <TextInput
            style={styles.input}
            value={companionIP}
            onChangeText={setCompanionIP}
            placeholder="192.168.1.x"
            placeholderTextColor="#4B5563"
            autoCapitalize="none"
            keyboardType="numeric"
          />

          <Pressable
            style={[styles.connectBtn, loading && { opacity: 0.6 }]}
            onPress={handleQuickConnect}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Ionicons name="flash" size={18} color="#FFF" />
            )}
            <Text style={styles.connectBtnText}>
              {loading ? "Connecting..." : "Connect"}
            </Text>
          </Pressable>

          {debugText ? (
            <Text style={styles.debugText}>{debugText}</Text>
          ) : null}
        </View>
      )}

      {mode === "scan" && (
        /* ======== QR SCANNER MODE ======== */
        <View style={styles.scanArea}>
          {permission?.granted ? (
            <CameraView
              style={styles.camera}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={scanned ? undefined : (result) => {
                if (result.data) handlePairingData(result.data);
              }}
            />
          ) : (
            <View style={styles.cameraPlaceholder}>
              <Ionicons name="camera-outline" size={48} color="#6B7280" />
              <Text style={styles.placeholderText}>Camera permission needed</Text>
              <Pressable style={styles.permBtn} onPress={requestPermission}>
                <Text style={styles.permBtnText}>Grant Permission</Text>
              </Pressable>
            </View>
          )}

          <View style={styles.frame} pointerEvents="none">
            <View style={[styles.corner, styles.topLeft]} />
            <View style={[styles.corner, styles.topRight]} />
            <View style={[styles.corner, styles.bottomLeft]} />
            <View style={[styles.corner, styles.bottomRight]} />
          </View>

          {scanned && (
            <Pressable style={styles.rescanBtn} onPress={() => setScanned(false)}>
              <Text style={styles.rescanText}>Tap to scan again</Text>
            </Pressable>
          )}

          {debugText ? (
            <Text style={[styles.debugText, { position: "absolute", bottom: 60 }]}>{debugText}</Text>
          ) : null}
        </View>
      )}

      {mode === "manual" && (
        /* ======== MANUAL ENTRY MODE ======== */
        <View style={styles.manualArea}>
          <Text style={styles.manualTitle}>Connect Manually</Text>
          <Text style={styles.manualHelp}>
            Copy the session ID and relay URL from your PC terminal
          </Text>

          <Text style={styles.label}>Session ID</Text>
          <TextInput
            style={styles.input}
            value={sessionID}
            onChangeText={setSessionID}
            placeholder="e.g. 0d5178337070a13f97879e1b0f55018d"
            placeholderTextColor="#4B5563"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={styles.label}>Relay URL</Text>
          <TextInput
            style={styles.input}
            value={relayURL}
            onChangeText={setRelayURL}
            placeholder="ws://192.168.1.x:8787"
            placeholderTextColor="#4B5563"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />

          <Pressable style={styles.connectBtn} onPress={handleManualConnect}>
            <Ionicons name="link-outline" size={18} color="#FFF" />
            <Text style={styles.connectBtnText}>Connect</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0D0D0D" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: 16, backgroundColor: "#0D0D0D" },
  connectingText: { color: "#D97706", fontSize: 16 },

  modeToggle: {
    flexDirection: "row", margin: 16, backgroundColor: "#1A1A1A",
    borderRadius: 8, padding: 4,
  },
  modeBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 4, paddingVertical: 10, borderRadius: 6,
  },
  modeBtnActive: { backgroundColor: "#D97706" },
  modeBtnText: { color: "#9CA3AF", fontSize: 13, fontWeight: "600" },
  modeBtnTextActive: { color: "#FFF" },

  // Quick connect
  quickArea: { flex: 1, padding: 16, gap: 8 },
  quickTitle: { color: "#F5F5F5", fontSize: 20, fontWeight: "700", textAlign: "center" },
  quickHelp: { color: "#6B7280", fontSize: 13, textAlign: "center", marginBottom: 12, lineHeight: 20 },

  // QR Scanner
  scanArea: { flex: 1, justifyContent: "center", alignItems: "center", position: "relative" },
  camera: { width: 280, height: 280, borderRadius: 12, overflow: "hidden" },
  cameraPlaceholder: {
    width: 280, height: 280, backgroundColor: "#1A1A1A", borderRadius: 12,
    justifyContent: "center", alignItems: "center", gap: 12,
  },
  placeholderText: { color: "#6B7280", fontSize: 14 },
  permBtn: { backgroundColor: "#D97706", paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6 },
  permBtnText: { color: "#FFF", fontSize: 14, fontWeight: "600" },
  frame: { position: "absolute", width: 240, height: 240 },
  corner: { position: "absolute", width: 24, height: 24, borderColor: "#D97706" },
  topLeft: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 },
  topRight: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 },
  bottomLeft: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 },
  bottomRight: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3 },
  rescanBtn: {
    position: "absolute", bottom: 20, backgroundColor: "#D97706",
    paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8,
  },
  rescanText: { color: "#FFF", fontSize: 14, fontWeight: "600" },

  // Manual entry
  manualArea: { flex: 1, padding: 16 },
  manualTitle: { color: "#F5F5F5", fontSize: 18, fontWeight: "700", marginBottom: 4 },
  manualHelp: { color: "#6B7280", fontSize: 13, marginBottom: 20 },

  // Shared
  label: { color: "#9CA3AF", fontSize: 12, fontWeight: "600", marginBottom: 6, marginTop: 12 },
  input: {
    backgroundColor: "#1A1A1A", color: "#F5F5F5", paddingHorizontal: 12, paddingVertical: 12,
    borderRadius: 8, fontSize: 14, borderWidth: 1, borderColor: "#2A2A2A",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  connectBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "#D97706", padding: 14, borderRadius: 8, marginTop: 24,
  },
  connectBtnText: { color: "#FFF", fontSize: 16, fontWeight: "600" },
  debugText: {
    color: "#9CA3AF", fontSize: 10, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    marginTop: 12, padding: 8, backgroundColor: "#111", borderRadius: 4,
  },
});
