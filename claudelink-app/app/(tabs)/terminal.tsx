/**
 * Chat Screen — shows conversation with Claude Code.
 * User messages on right, Claude responses on left.
 * Tool approval cards shown inline.
 */

import { useRef, useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useStore, type ChatMessage } from "@/lib/store";
import { sendTerminalInput, approveTool, rejectTool } from "@/lib/connection";

export default function ChatScreen() {
  const flatListRef = useRef<FlatList>(null);
  const [inputText, setInputText] = useState("");
  const chatMessages = useStore((s) => s.chatMessages);
  const status = useStore((s) => s.status);
  const pendingApprovals = useStore((s) => s.pendingApprovals);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (chatMessages.length > 0) {
      const timer = setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [chatMessages.length, chatMessages[chatMessages.length - 1]?.content?.length]);

  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text) return;
    sendTerminalInput(text + "\n");
    setInputText("");
  }, [inputText]);

  if (status !== "connected") {
    return (
      <View style={styles.center}>
        <Ionicons name="chatbubbles-outline" size={48} color="#4B5563" />
        <Text style={styles.emptyTitle}>No Active Connection</Text>
        <Text style={styles.emptySubtitle}>
          Pair with your PC first to chat with Claude Code
        </Text>
      </View>
    );
  }

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    switch (item.role) {
      case "user":
        return (
          <View style={styles.userRow}>
            <View style={styles.userBubble}>
              <Text style={styles.userText}>{item.content}</Text>
            </View>
          </View>
        );

      case "assistant":
        return (
          <View style={styles.assistantRow}>
            <View style={styles.assistantBubble}>
              <Text style={styles.assistantText}>{item.content}</Text>
              {!item.done && (
                <Text style={styles.typingIndicator}>...</Text>
              )}
            </View>
          </View>
        );

      case "system":
        return (
          <View style={styles.systemRow}>
            <Text style={styles.systemText}>{item.content}</Text>
          </View>
        );

      case "error":
        return (
          <View style={styles.errorRow}>
            <Ionicons name="alert-circle" size={14} color="#FCA5A5" />
            <Text style={styles.errorText}>{item.content}</Text>
          </View>
        );

      default:
        return null;
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={90}
    >
      {/* Pending approvals */}
      {pendingApprovals.map((approval) => (
        <View key={approval.toolId} style={styles.approvalCard}>
          <View style={styles.approvalHeader}>
            <Ionicons name="shield-checkmark-outline" size={16} color="#F59E0B" />
            <Text style={styles.approvalTitle}>
              {approval.toolName} needs approval
            </Text>
          </View>
          <Text style={styles.approvalInput} numberOfLines={3}>
            {approval.input}
          </Text>
          <View style={styles.approvalActions}>
            <Pressable
              style={[styles.approvalBtn, styles.rejectBtn]}
              onPress={() => rejectTool(approval.toolId)}
            >
              <Text style={styles.rejectText}>Reject</Text>
            </Pressable>
            <Pressable
              style={[styles.approvalBtn, styles.approveBtn]}
              onPress={() => approveTool(approval.toolId)}
            >
              <Text style={styles.approveText}>Approve</Text>
            </Pressable>
          </View>
        </View>
      ))}

      {/* Chat messages */}
      <FlatList
        ref={flatListRef}
        data={chatMessages}
        renderItem={renderMessage}
        keyExtractor={(item) => item.id}
        style={styles.messageList}
        contentContainerStyle={styles.messageListContent}
        onContentSizeChange={() => {
          flatListRef.current?.scrollToEnd({ animated: false });
        }}
      />

      {/* Input bar */}
      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Message Claude..."
          placeholderTextColor="#6B7280"
          returnKeyType="send"
          onSubmitEditing={handleSend}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
        />
        <Pressable style={styles.sendButton} onPress={handleSend}>
          <Ionicons name="send" size={18} color="#D97706" />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0D0D0D" },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
    backgroundColor: "#0D0D0D",
  },
  emptyTitle: { color: "#9CA3AF", fontSize: 18, fontWeight: "600", marginTop: 16 },
  emptySubtitle: { color: "#4B5563", fontSize: 14, textAlign: "center", marginTop: 8 },

  // Message list
  messageList: { flex: 1 },
  messageListContent: { padding: 12, paddingBottom: 8, gap: 8 },

  // User message (right-aligned)
  userRow: { flexDirection: "row", justifyContent: "flex-end" },
  userBubble: {
    backgroundColor: "#78350F",
    borderRadius: 16,
    borderBottomRightRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: "80%",
  },
  userText: { color: "#FDE68A", fontSize: 14, lineHeight: 20 },

  // Assistant message (left-aligned)
  assistantRow: { flexDirection: "row", justifyContent: "flex-start" },
  assistantBubble: {
    backgroundColor: "#1A1A2E",
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: "85%",
  },
  assistantText: { color: "#E5E7EB", fontSize: 14, lineHeight: 20 },
  typingIndicator: {
    color: "#6B7280",
    fontSize: 18,
    lineHeight: 20,
    letterSpacing: 2,
  },

  // System message (centered)
  systemRow: {
    flexDirection: "row",
    justifyContent: "center",
    paddingVertical: 4,
  },
  systemText: {
    color: "#6B7280",
    fontSize: 12,
    fontStyle: "italic",
  },

  // Error message
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#1C0707",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#7F1D1D",
  },
  errorText: { color: "#FCA5A5", fontSize: 13, flex: 1 },

  // Input bar
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    borderTopWidth: 1,
    borderTopColor: "#1F1F1F",
    padding: 8,
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: "#1A1A1A",
    color: "#F5F5F5",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    fontSize: 14,
    maxHeight: 100,
  },
  sendButton: {
    padding: 10,
    marginBottom: 2,
  },

  // Approval cards
  approvalCard: {
    backgroundColor: "#1C1507",
    borderWidth: 1,
    borderColor: "#78350F",
    margin: 8,
    borderRadius: 8,
    padding: 12,
  },
  approvalHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  approvalTitle: { color: "#FDE68A", fontSize: 13, fontWeight: "600" },
  approvalInput: {
    color: "#9CA3AF",
    fontSize: 12,
    marginTop: 8,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  approvalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 12,
  },
  approvalBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6 },
  rejectBtn: { backgroundColor: "#7F1D1D" },
  approveBtn: { backgroundColor: "#14532D" },
  rejectText: { color: "#FCA5A5", fontSize: 13, fontWeight: "600" },
  approveText: { color: "#86EFAC", fontSize: 13, fontWeight: "600" },
});
