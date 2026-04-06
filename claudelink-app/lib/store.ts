/**
 * Global state management using Zustand.
 * Single source of truth for the entire app.
 */

import { create } from "zustand";
import type { SessionInfo, Envelope, MessageType } from "./protocol";
import type { KeyPair } from "./crypto";

export type ConnectionMode = "remote" | "direct"; // remote = PC via relay, direct = BYOK
export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "pairing";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "error";
  content: string;
  timestamp: number;
  done?: boolean; // true when assistant response is fully received
}

interface AppState {
  // Connection
  mode: ConnectionMode;
  status: ConnectionStatus;
  sessionID: string | null;
  relayURL: string | null;

  // Encryption
  keyPair: KeyPair | null;
  peerPublicKey: Uint8Array | null;

  // Sessions (in remote mode, multiple Claude sessions can be active)
  sessions: SessionInfo[];
  activeSessionID: string | null;

  // Chat messages (structured chat UI)
  chatMessages: ChatMessage[];

  // Terminal (raw output for shell fallback mode)
  terminalOutput: string;
  terminalHistory: string[];

  // BYOK mode
  apiKey: string | null;
  directMessages: Array<{ role: "user" | "assistant"; content: string }>;

  // Pending approvals
  pendingApprovals: Array<{
    toolId: string;
    toolName: string;
    input: string;
    timestamp: number;
  }>;

  // Actions
  setMode: (mode: ConnectionMode) => void;
  setStatus: (status: ConnectionStatus) => void;
  setSession: (sessionID: string, relayURL: string) => void;
  setKeyPair: (kp: KeyPair) => void;
  setPeerPublicKey: (key: Uint8Array) => void;

  // Chat actions
  addUserMessage: (content: string) => void;
  addAssistantChunk: (text: string) => void;
  finalizeAssistantMessage: () => void;
  addSystemMessage: (content: string) => void;
  addErrorMessage: (content: string) => void;

  // Legacy terminal
  appendTerminalOutput: (data: string) => void;
  clearTerminal: () => void;

  setApiKey: (key: string | null) => void;
  addDirectMessage: (role: "user" | "assistant", content: string) => void;
  addPendingApproval: (toolId: string, toolName: string, input: string) => void;
  removePendingApproval: (toolId: string) => void;
  updateSessions: (sessions: SessionInfo[]) => void;
  setActiveSession: (id: string) => void;
  reset: () => void;
}

const initialState = {
  mode: "remote" as ConnectionMode,
  status: "disconnected" as ConnectionStatus,
  sessionID: null,
  relayURL: null,
  keyPair: null,
  peerPublicKey: null,
  sessions: [],
  activeSessionID: null,
  chatMessages: [],
  terminalOutput: "",
  terminalHistory: [],
  apiKey: null,
  directMessages: [],
  pendingApprovals: [],
};

export const useStore = create<AppState>((set) => ({
  ...initialState,

  setMode: (mode) => set({ mode }),
  setStatus: (status) => set({ status }),
  setSession: (sessionID, relayURL) => set({ sessionID, relayURL }),
  setKeyPair: (kp) => set({ keyPair: kp }),
  setPeerPublicKey: (key) => set({ peerPublicKey: key }),

  // --- Chat message actions ---

  addUserMessage: (content) =>
    set((state) => ({
      chatMessages: [
        ...state.chatMessages,
        {
          id: `user-${Date.now()}`,
          role: "user",
          content,
          timestamp: Date.now(),
          done: true,
        },
      ],
    })),

  addAssistantChunk: (text) =>
    set((state) => {
      const msgs = [...state.chatMessages];
      const last = msgs[msgs.length - 1];

      if (last && last.role === "assistant" && !last.done) {
        // Append to existing in-progress assistant message
        msgs[msgs.length - 1] = { ...last, content: last.content + text };
      } else {
        // Start new assistant message
        msgs.push({
          id: `asst-${Date.now()}`,
          role: "assistant",
          content: text,
          timestamp: Date.now(),
          done: false,
        });
      }

      return { chatMessages: msgs };
    }),

  finalizeAssistantMessage: () =>
    set((state) => {
      const msgs = [...state.chatMessages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === "assistant" && !last.done) {
        msgs[msgs.length - 1] = { ...last, done: true };
      }
      return { chatMessages: msgs };
    }),

  addSystemMessage: (content) =>
    set((state) => ({
      chatMessages: [
        ...state.chatMessages,
        {
          id: `sys-${Date.now()}`,
          role: "system",
          content,
          timestamp: Date.now(),
          done: true,
        },
      ],
    })),

  addErrorMessage: (content) =>
    set((state) => ({
      chatMessages: [
        ...state.chatMessages,
        {
          id: `err-${Date.now()}`,
          role: "error",
          content,
          timestamp: Date.now(),
          done: true,
        },
      ],
    })),

  // --- Legacy terminal ---

  appendTerminalOutput: (data) =>
    set((state) => ({ terminalOutput: state.terminalOutput + data })),

  clearTerminal: () => set({ terminalOutput: "", terminalHistory: [], chatMessages: [] }),

  setApiKey: (key) => set({ apiKey: key }),

  addDirectMessage: (role, content) =>
    set((state) => ({
      directMessages: [...state.directMessages, { role, content }],
    })),

  addPendingApproval: (toolId, toolName, input) =>
    set((state) => ({
      pendingApprovals: [
        ...state.pendingApprovals,
        { toolId, toolName, input, timestamp: Date.now() },
      ],
    })),

  removePendingApproval: (toolId) =>
    set((state) => ({
      pendingApprovals: state.pendingApprovals.filter((a) => a.toolId !== toolId),
    })),

  updateSessions: (sessions) => set({ sessions }),
  setActiveSession: (id) => set({ activeSessionID: id }),
  reset: () => set(initialState),
}));
