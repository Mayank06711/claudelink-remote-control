/**
 * Sessions Dashboard — shows connection status and active Claude Code sessions.
 */

import { View, Text, StyleSheet, FlatList, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useStore } from "@/lib/store";
import { disconnect } from "@/lib/connection";

export default function SessionsScreen() {
  const router = useRouter();
  const status = useStore((s) => s.status);
  const sessions = useStore((s) => s.sessions);
  const mode = useStore((s) => s.mode);
  const pendingApprovals = useStore((s) => s.pendingApprovals);
  const sessionID = useStore((s) => s.sessionID);
  const chatMessages = useStore((s) => s.chatMessages);

  // Not connected — show pair button
  if (status === "disconnected") {
    return (
      <View style={styles.center}>
        <Ionicons name="link-outline" size={64} color="#6B7280" />
        <Text style={styles.title}>Not Connected</Text>
        <Text style={styles.subtitle}>
          Connect to your PC to monitor Claude Code remotely
        </Text>
        <Pressable
          style={styles.pairButton}
          onPress={() => router.push("/pair")}
        >
          <Ionicons name="qr-code-outline" size={20} color="#FFF" />
          <Text style={styles.pairButtonText}>Pair Device</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Pending approvals banner */}
      {pendingApprovals.length > 0 && (
        <Pressable
          style={styles.approvalBanner}
          onPress={() => router.push("/(tabs)/terminal" as never)}
        >
          <Ionicons name="alert-circle" size={20} color="#F59E0B" />
          <Text style={styles.approvalText}>
            {pendingApprovals.length} pending approval
            {pendingApprovals.length > 1 ? "s" : ""}
          </Text>
          <Ionicons name="chevron-forward" size={16} color="#F59E0B" />
        </Pressable>
      )}

      {/* Connection status card */}
      <View style={styles.statusCard}>
        <View style={styles.statusHeader}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: status === "connected" ? "#22C55E" : "#F59E0B" },
            ]}
          />
          <Text style={styles.statusTitle}>
            {status === "connected" ? "Connected" : "Connecting..."}
          </Text>
          <Text style={styles.modeTag}>
            {mode === "remote" ? "Remote PC" : "Direct"}
          </Text>
        </View>

        {sessionID && (
          <Text style={styles.sessionIDText}>
            Session: {sessionID.slice(0, 16)}...
          </Text>
        )}

        {/* Quick chat preview */}
        {chatMessages.length > 0 && (
          <Pressable
            style={styles.previewBox}
            onPress={() => router.push("/(tabs)/terminal" as never)}
          >
            <Text style={styles.previewText} numberOfLines={3}>
              {chatMessages[chatMessages.length - 1]?.content?.slice(-200)}
            </Text>
            <Text style={styles.previewHint}>Tap to open chat</Text>
          </Pressable>
        )}

        <Pressable style={styles.disconnectBtn} onPress={disconnect}>
          <Ionicons name="close-circle-outline" size={16} color="#EF4444" />
          <Text style={styles.disconnectText}>Disconnect</Text>
        </Pressable>
      </View>

      {/* Sessions list */}
      {sessions.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>ACTIVE SESSIONS</Text>
          <FlatList
            data={sessions}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <Pressable
                style={styles.sessionCard}
                onPress={() => {
                  useStore.getState().setActiveSession(item.id);
                  router.push("/(tabs)/terminal" as never);
                }}
              >
                <View style={styles.sessionHeader}>
                  <Ionicons
                    name={
                      item.status === "active"
                        ? "code-slash"
                        : item.status === "waiting"
                        ? "hourglass-outline"
                        : "pause-circle-outline"
                    }
                    size={20}
                    color={
                      item.status === "active" ? "#22C55E"
                        : item.status === "waiting" ? "#F59E0B"
                        : "#6B7280"
                    }
                  />
                  <Text style={styles.sessionProject}>{item.project}</Text>
                </View>
                <Text style={styles.sessionBranch}>{item.branch}</Text>
              </Pressable>
            )}
          />
        </>
      )}

      {/* Open terminal button */}
      <Pressable
        style={styles.terminalBtn}
        onPress={() => router.push("/(tabs)/terminal" as never)}
      >
        <Ionicons name="chatbubbles-outline" size={20} color="#FFF" />
        <Text style={styles.terminalBtnText}>Open Chat</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0D0D0D" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 32 },
  title: { color: "#F5F5F5", fontSize: 20, fontWeight: "700", marginTop: 16 },
  subtitle: { color: "#6B7280", fontSize: 14, marginTop: 8, textAlign: "center" },
  pairButton: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#D97706", paddingHorizontal: 24, paddingVertical: 12,
    borderRadius: 8, marginTop: 24,
  },
  pairButtonText: { color: "#FFF", fontSize: 16, fontWeight: "600" },

  approvalBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#78350F", padding: 12,
    marginHorizontal: 16, marginTop: 12, borderRadius: 8,
  },
  approvalText: { color: "#FDE68A", fontSize: 14, fontWeight: "600", flex: 1 },

  statusCard: {
    backgroundColor: "#1A1A1A", margin: 16, padding: 16, borderRadius: 8,
    borderWidth: 1, borderColor: "#2A2A2A",
  },
  statusHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusTitle: { color: "#F5F5F5", fontSize: 16, fontWeight: "600", flex: 1 },
  modeTag: {
    color: "#D97706", fontSize: 11, fontWeight: "600",
    backgroundColor: "#78350F", paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 4, overflow: "hidden", textTransform: "uppercase",
  },
  sessionIDText: {
    color: "#6B7280", fontSize: 11, marginTop: 8,
    fontFamily: "monospace",
  },

  previewBox: {
    backgroundColor: "#111", borderRadius: 6, padding: 10, marginTop: 12,
    borderWidth: 1, borderColor: "#1F1F1F",
  },
  previewText: {
    color: "#9CA3AF", fontSize: 11, fontFamily: "monospace", lineHeight: 16,
  },
  previewHint: {
    color: "#D97706", fontSize: 11, marginTop: 6, textAlign: "right",
  },

  disconnectBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, marginTop: 12, paddingVertical: 8,
  },
  disconnectText: { color: "#EF4444", fontSize: 13 },

  sectionTitle: {
    color: "#6B7280", fontSize: 11, fontWeight: "600", letterSpacing: 1,
    marginHorizontal: 16, marginTop: 8, marginBottom: 8,
  },
  sessionCard: {
    backgroundColor: "#1A1A1A", marginHorizontal: 16, marginBottom: 8,
    padding: 16, borderRadius: 8, borderWidth: 1, borderColor: "#2A2A2A",
  },
  sessionHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  sessionProject: { color: "#F5F5F5", fontSize: 16, fontWeight: "600" },
  sessionBranch: { color: "#9CA3AF", fontSize: 12, marginTop: 4, marginLeft: 28 },

  terminalBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, backgroundColor: "#1A1A1A", margin: 16, padding: 14,
    borderRadius: 8, borderWidth: 1, borderColor: "#2A2A2A",
  },
  terminalBtnText: { color: "#F5F5F5", fontSize: 15, fontWeight: "600" },
});
