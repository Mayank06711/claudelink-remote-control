/**
 * Shared message protocol — MUST stay in sync with internal/protocol/messages.go
 */

export type MessageType =
  // Connection lifecycle
  | "pair"
  | "pair_ack"
  | "heartbeat"
  | "disconnect"
  | "replaced"
  // Terminal data
  | "term_output"
  | "term_input"
  | "term_resize"
  // Session management
  | "session_start"
  | "session_end"
  | "session_list"
  // Tool calls & approvals
  | "tool_call"
  | "tool_approve"
  | "tool_reject"
  | "tool_result"
  // File operations
  | "diff"
  | "file_op"
  // Status
  | "status"
  | "error";

/** Top-level message wrapper sent over WebSocket. */
export interface Envelope {
  session_id: string;
  type: MessageType;
  nonce: string; // base64 encryption nonce
  payload: string; // base64 encrypted payload
  ts: number; // Unix milliseconds
}

/** Sent during QR code pairing */
export interface PairRequest {
  device_id: string;
  device_name: string;
  public_key: string; // NaCl box public key (base64)
}

/** Terminal output from Claude Code on PC */
export interface TermOutput {
  data: string;
  session_id: string;
}

/** User input from phone to Claude Code */
export interface TermInput {
  data: string;
  session_id: string;
}

/** Terminal resize event */
export interface TermResize {
  rows: number;
  cols: number;
}

/** Claude is requesting a tool use */
export interface ToolCallNotification {
  tool_id: string;
  tool_name: string; // e.g. "Bash", "Edit", "Write"
  input: string; // Tool input summary
  session_id: string;
}

/** File diff for review */
export interface DiffPayload {
  file_path: string;
  old_text: string;
  new_text: string;
  language: string;
}

/** Active Claude Code session info */
export interface SessionInfo {
  id: string;
  started_at: number;
  project: string;
  branch: string;
  status: "active" | "waiting" | "idle";
}

/** QR code pairing data (encoded in QR) */
export interface PairingData {
  s: string; // session_id
  r: string; // relay_url
  k: string; // companion public key (base64)
  v: number; // protocol version
}
