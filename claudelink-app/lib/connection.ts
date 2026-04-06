/**
 * Connection manager — wires WebSocketManager to the Zustand store.
 * This is the glue between networking and UI.
 */

import { WebSocketManager } from "./websocket";
import { useStore } from "./store";
import { encrypt, decrypt } from "./crypto";
import type { Envelope, PairingData, ToolCallNotification } from "./protocol";

let wsManager: WebSocketManager | null = null;

/** Connect to companion via relay after scanning QR code */
export function connectToCompanion(pairing: PairingData): void {
  const store = useStore.getState();

  // Disconnect existing connection if any
  if (wsManager) {
    wsManager.disconnect();
  }

  store.setSession(pairing.s, pairing.r);
  store.setStatus("connecting");

  wsManager = new WebSocketManager({
    relayURL: pairing.r,
    sessionID: pairing.s,
    role: "app",

    onConnect: () => {
      store.setStatus("connected");

      // Always send pairing request so companion unblocks
      const pairPayload = JSON.stringify({
        device_id: `app-${Date.now()}`,
        device_name: "ClaudeLink Mobile",
        public_key: store.keyPair
          ? Array.from(store.keyPair.publicKey).map((b) => b.toString(16).padStart(2, "0")).join("")
          : "",
      });

      wsManager?.sendMessage("pair", pairPayload);
    },

    onMessage: (envelope: Envelope) => {
      handleMessage(envelope);
    },

    onDisconnect: () => {
      store.setStatus("disconnected");
    },
  });

  wsManager.connect();
}

/** Handle incoming messages from companion */
function handleMessage(env: Envelope): void {
  const store = useStore.getState();

  switch (env.type) {
    case "term_output":
      // Try to parse as structured chat message from companion
      try {
        const data = JSON.parse(env.payload);
        if (data.role === "assistant") {
          store.addAssistantChunk(data.content);
        } else if (data.role === "done") {
          store.finalizeAssistantMessage();
        } else if (data.role === "system") {
          store.addSystemMessage(data.content);
        } else if (data.role === "error") {
          store.addErrorMessage(data.content);
        } else {
          // Unknown structured message — show as system
          store.addSystemMessage(data.content || env.payload);
        }
      } catch {
        // Not JSON — raw text from shell fallback mode
        store.appendTerminalOutput(env.payload);
      }
      break;

    case "tool_call":
      try {
        const tc = JSON.parse(env.payload);
        // Use request_id as the key for approve/reject (matches companion's pendingApprovals map)
        store.addPendingApproval(
          tc.request_id || tc.tool_id,
          tc.tool_name,
          tc.input
        );
      } catch {
        store.addPendingApproval(env.ts.toString(), "Tool", env.payload);
      }
      break;

    case "session_start":
      try {
        const session = JSON.parse(env.payload);
        store.updateSessions([...store.sessions, session]);
      } catch {}
      break;

    case "session_end":
      store.updateSessions(
        store.sessions.filter((s) => s.id !== env.session_id)
      );
      break;

    case "session_list":
      try {
        const sessions = JSON.parse(env.payload);
        store.updateSessions(sessions);
      } catch {}
      break;

    case "status":
      // Could update a status indicator
      break;

    case "pair_ack":
      store.setStatus("connected");
      break;

    case "disconnect":
      store.setStatus("disconnected");
      break;

    case "replaced":
      // Another device took our slot — stop reconnecting to avoid loop
      console.log("Connection replaced by another device");
      store.setStatus("disconnected");
      wsManager?.disconnect();
      break;

    case "error":
      console.error("Companion error:", env.payload);
      break;

    default:
      console.log("Unhandled message type:", env.type);
  }
}

/** Send text input to companion (types into Claude Code terminal) */
export function sendTerminalInput(text: string): void {
  const store = useStore.getState();
  // Add user message to chat immediately (optimistic display)
  const cleanText = text.replace(/\n$/, "");
  if (cleanText) {
    store.addUserMessage(cleanText);
  }
  wsManager?.send({
    session_id: store.sessionID || "",
    type: "term_input",
    nonce: "",
    payload: text,
    ts: Date.now(),
  });
}

/** Approve a tool call */
export function approveTool(toolId: string): void {
  const store = useStore.getState();
  wsManager?.send({
    session_id: store.sessionID || "",
    type: "tool_approve",
    nonce: "",
    payload: toolId,
    ts: Date.now(),
  });
  store.removePendingApproval(toolId);
}

/** Reject a tool call */
export function rejectTool(toolId: string): void {
  const store = useStore.getState();
  wsManager?.send({
    session_id: store.sessionID || "",
    type: "tool_reject",
    nonce: "",
    payload: toolId,
    ts: Date.now(),
  });
  store.removePendingApproval(toolId);
}

/** Disconnect from companion */
export function disconnect(): void {
  wsManager?.disconnect();
  wsManager = null;
  useStore.getState().reset();
}

/** Get connection status */
export function isConnected(): boolean {
  return wsManager?.isConnected() ?? false;
}
