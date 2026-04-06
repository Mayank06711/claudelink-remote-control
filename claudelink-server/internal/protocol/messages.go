// Package protocol defines the shared message types between companion, relay, and app.
// These types MUST stay in sync with lib/protocol.ts in claudelink-app.
package protocol

// MessageType identifies the kind of message being sent over WebSocket.
type MessageType string

const (
	// Connection lifecycle
	MsgTypePair       MessageType = "pair"        // Initial device pairing request
	MsgTypePairAck    MessageType = "pair_ack"     // Pairing acknowledged
	MsgTypeHeartbeat  MessageType = "heartbeat"    // Keep-alive ping
	MsgTypeDisconnect MessageType = "disconnect"   // Clean disconnect

	// Terminal data
	MsgTypeTermOutput MessageType = "term_output" // Terminal output from Claude Code
	MsgTypeTermInput  MessageType = "term_input"  // User input from phone to Claude Code
	MsgTypeTermResize MessageType = "term_resize" // Terminal resize event

	// Session management
	MsgTypeSessionStart MessageType = "session_start" // Claude Code session started
	MsgTypeSessionEnd   MessageType = "session_end"   // Claude Code session ended
	MsgTypeSessionList  MessageType = "session_list"   // List of active sessions

	// Tool calls & approvals
	MsgTypeToolCall     MessageType = "tool_call"     // Claude is requesting tool use
	MsgTypeToolApprove  MessageType = "tool_approve"  // User approves tool call
	MsgTypeToolReject   MessageType = "tool_reject"   // User rejects tool call
	MsgTypeToolResult   MessageType = "tool_result"   // Result of tool execution

	// File operations
	MsgTypeDiff    MessageType = "diff"     // File diff for review
	MsgTypeFileOp  MessageType = "file_op"  // File operation notification

	// Status
	MsgTypeStatus MessageType = "status" // General status update
	MsgTypeError  MessageType = "error"  // Error message
)

// Envelope is the top-level message wrapper sent over WebSocket.
// All payloads are E2E encrypted — the relay only sees SessionID and Type.
type Envelope struct {
	SessionID string      `json:"session_id"`          // Links PC <-> Phone
	Type      MessageType `json:"type"`                // Message type (visible to relay for routing)
	Nonce     string      `json:"nonce"`               // Encryption nonce (base64)
	Payload   string      `json:"payload"`             // Encrypted payload (base64)
	Timestamp int64       `json:"ts"`                  // Unix milliseconds
}

// --- Unencrypted payload types (these get encrypted before sending) ---

// PairRequest is sent during QR code pairing.
type PairRequest struct {
	DeviceID   string `json:"device_id"`
	DeviceName string `json:"device_name"`
	PublicKey  string `json:"public_key"` // NaCl box public key (base64)
}

// TermOutput carries terminal data from Claude Code.
type TermOutput struct {
	Data      string `json:"data"`       // Raw terminal output
	SessionID string `json:"session_id"` // Which Claude session
}

// TermInput carries user commands from phone to Claude Code.
type TermInput struct {
	Data      string `json:"data"`       // User input text
	SessionID string `json:"session_id"`
}

// TermResize carries terminal dimension changes.
type TermResize struct {
	Rows uint16 `json:"rows"`
	Cols uint16 `json:"cols"`
}

// ToolCallNotification is sent when Claude requests a tool use.
type ToolCallNotification struct {
	ToolID    string `json:"tool_id"`
	ToolName  string `json:"tool_name"`  // e.g. "Bash", "Edit", "Write"
	Input     string `json:"input"`      // Tool input summary
	SessionID string `json:"session_id"`
}

// DiffPayload carries file change information.
type DiffPayload struct {
	FilePath string `json:"file_path"`
	OldText  string `json:"old_text"`
	NewText  string `json:"new_text"`
	Language string `json:"language"` // File language for syntax highlighting
}

// SessionInfo describes an active Claude Code session.
type SessionInfo struct {
	ID        string `json:"id"`
	StartedAt int64  `json:"started_at"`
	Project   string `json:"project"`   // Project/directory name
	Branch    string `json:"branch"`    // Git branch
	Status    string `json:"status"`    // "active", "waiting", "idle"
}

// StatusUpdate carries general status information.
type StatusUpdate struct {
	State   string `json:"state"`   // "connected", "running", "waiting_approval", "idle"
	Message string `json:"message"` // Human-readable status
}
