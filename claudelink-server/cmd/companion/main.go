// ClaudeLink Companion — runs on your PC alongside Claude Code.
// Captures terminal output, forwards to relay, receives commands from phone.
package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"sync"
	"syscall"
	"time"

	"github.com/claudelink/server/internal/crypto"
	"github.com/claudelink/server/internal/pairing"
	"github.com/claudelink/server/internal/protocol"
	ptycap "github.com/claudelink/server/internal/pty"
	"github.com/claudelink/server/internal/ws"
)

var version = "dev"

func main() {
	relayURL := flag.String("relay", "wss://claudelink-relay.workers.dev", "Relay server WebSocket URL")
	claudeCmd := flag.String("claude", "claude", "Path to Claude Code CLI binary")
	qrDir := flag.String("qr-dir", ".", "Directory to save QR code PNG file")
	pairPort := flag.String("pair-port", "8788", "HTTP port for LAN pairing endpoint")
	showVersion := flag.Bool("version", false, "Show version")
	flag.Parse()

	if *showVersion {
		fmt.Printf("claudelink-companion %s\n", version)
		os.Exit(0)
	}

	log.Printf("ClaudeLink Companion %s starting...", version)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		log.Println("Shutting down...")
		cancel()
	}()

	sessionID := generateSessionID()
	log.Printf("Session ID: %s", sessionID)

	keyPair, err := crypto.GenerateKeyPair()
	if err != nil {
		log.Fatalf("Failed to generate key pair: %v", err)
	}

	qrPNG, err := pairing.GenerateQRCode(sessionID, *relayURL, keyPair.PublicKeyBase64())
	if err != nil {
		log.Fatalf("Failed to generate QR code: %v", err)
	}
	qrFilename := fmt.Sprintf("claudelink-qr-%s.png", time.Now().Format("20060102-150405"))
	qrPath := filepath.Join(*qrDir, qrFilename)
	if err := os.WriteFile(qrPath, qrPNG, 0644); err != nil {
		log.Fatalf("Failed to save QR code: %v", err)
	}
	fmt.Print("\n📱 QR code saved! Scan it with ClaudeLink app to connect:\n")
	fmt.Printf("   File: %s\n", qrPath)
	fmt.Printf("   Session: %s\n\n", sessionID)

	pairingJSON, _ := json.Marshal(pairing.PairingData{
		SessionID: sessionID,
		RelayURL:  *relayURL,
		PublicKey: keyPair.PublicKeyBase64(),
		Version:   1,
	})
	go func() {
		mux := http.NewServeMux()
		mux.HandleFunc("/pair", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Write(pairingJSON)
		})
		addr := "0.0.0.0:" + *pairPort
		log.Printf("Pairing endpoint: http://0.0.0.0:%s/pair", *pairPort)
		http.ListenAndServe(addr, mux)
	}()

	client := ws.NewClient(*relayURL, sessionID)
	if err := client.Connect(ctx); err != nil {
		log.Fatalf("Failed to connect to relay: %v", err)
	}
	defer client.Close()

	log.Println("Waiting for phone to connect...")
	var peerPublicKey *[32]byte

	select {
	case env := <-client.Receive():
		log.Printf("Phone connected (msg type: %s)! Starting Claude Code...", env.Type)
		_ = peerPublicKey
		_ = env
	case <-ctx.Done():
		return
	}

	if runtime.GOOS == "windows" && os.Getenv("CLAUDE_CODE_GIT_BASH_PATH") == "" {
		gitBashCandidates := []string{
			`C:\Program Files\Git\bin\bash.exe`,
			`C:\Program Files (x86)\Git\bin\bash.exe`,
		}
		for _, gb := range gitBashCandidates {
			if _, err := os.Stat(gb); err == nil {
				os.Setenv("CLAUDE_CODE_GIT_BASH_PATH", gb)
				log.Printf("Set CLAUDE_CODE_GIT_BASH_PATH=%s", gb)
				break
			}
		}
	}

	shellCmd := *claudeCmd
	shellArgs := flag.Args()
	isClaudeCLI := false

	if _, err := exec.LookPath(shellCmd); err != nil {
		found := findClaudeCLI()
		if found != "" {
			shellCmd = found
			isClaudeCLI = true
			log.Printf("Found Claude CLI at: %s", found)
		} else {
			if runtime.GOOS == "windows" {
				shellCmd = "cmd.exe"
				shellArgs = []string{}
			} else {
				shellCmd = "/bin/sh"
				shellArgs = []string{}
			}
			log.Printf("Claude CLI not found, falling back to shell: %s", shellCmd)
		}
	} else {
		isClaudeCLI = true
	}

	sendToPhone := func(text string) {
		if text == "" {
			return
		}
		env := &protocol.Envelope{
			SessionID: sessionID,
			Type:      protocol.MsgTypeTermOutput,
			Payload:   text,
			Timestamp: time.Now().UnixMilli(),
		}
		if err := client.Send(env); err != nil {
			log.Printf("Failed to send terminal output: %v", err)
		}
	}

	if isClaudeCLI {
		// ========== Claude CLI mode: single long-running process ==========
		// Uses --input-format stream-json for bidirectional communication.
		// Tool approvals are delegated to the phone via --permission-prompt-tool stdio.
		// Claude sends control_request on stdout, we forward to phone, phone responds,
		// we send control_response back on stdin.
		log.Printf("Claude CLI mode: stream-json bidirectional with tool delegation")

		// CRITICAL: Clear VS Code extension env vars
		for _, key := range []string{
			"CLAUDECODE",
			"CLAUDE_CODE_ENTRYPOINT",
			"CLAUDE_CODE_SSE_PORT",
			"CLAUDE_AGENT_SDK_VERSION",
			"CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING",
		} {
			if v := os.Getenv(key); v != "" {
				log.Printf("Clearing inherited VS Code env: %s=%s", key, v)
				os.Unsetenv(key)
			}
		}

		// Debug log file — saves ALL raw stream-json for inspection
		debugLogPath := "claudelink-stream.log"
		debugLog, _ := os.Create(debugLogPath)
		if debugLog != nil {
			defer debugLog.Close()
			log.Printf("Debug stream log: %s", debugLogPath)
		}

		// ---- Helpers: send structured messages to phone ----

		sendChatMsg := func(role string, content string) {
			if content == "" {
				return
			}
			payload, _ := json.Marshal(map[string]string{
				"role":    role,
				"content": content,
			})
			env := &protocol.Envelope{
				SessionID: sessionID,
				Type:      protocol.MsgTypeTermOutput,
				Payload:   string(payload),
				Timestamp: time.Now().UnixMilli(),
			}
			if err := client.Send(env); err != nil {
				log.Printf("Failed to send chat message: %v", err)
			}
		}

		sendChatDone := func() {
			payload, _ := json.Marshal(map[string]string{"role": "done"})
			env := &protocol.Envelope{
				SessionID: sessionID,
				Type:      protocol.MsgTypeTermOutput,
				Payload:   string(payload),
				Timestamp: time.Now().UnixMilli(),
			}
			client.Send(env)
		}

		sendToolCallToPhone := func(requestID, toolName, input string) {
			payload, _ := json.Marshal(map[string]string{
				"request_id": requestID,
				"tool_name":  toolName,
				"input":      input,
			})
			env := &protocol.Envelope{
				SessionID: sessionID,
				Type:      protocol.MsgTypeToolCall,
				Payload:   string(payload),
				Timestamp: time.Now().UnixMilli(),
			}
			if err := client.Send(env); err != nil {
				log.Printf("Failed to send tool call to phone: %v", err)
			}
		}

		// ---- Pending tool approvals: request_id → response channel ----

		type approvalResponse struct {
			approved bool
		}
		pendingApprovals := make(map[string]chan approvalResponse)
		var approvalMu sync.Mutex

		// ---- Launch single long-running Claude process ----

		args := []string{
			"-p",
			"--input-format", "stream-json",
			"--output-format", "stream-json",
			"--verbose",
			"--permission-prompt-tool", "stdio",
		}

		var lineBuf []byte

		// Stream output handler — parse NDJSON, handle control_request + regular events
		var sess *ptycap.Session

		// Write JSON message to claude's stdin
		sendToStdin := func(msg interface{}) {
			data, err := json.Marshal(msg)
			if err != nil {
				log.Printf("Failed to marshal stdin message: %v", err)
				return
			}
			data = append(data, '\n')
			log.Printf("→ stdin: %s", string(data[:min(len(data), 200)]))
			if debugLog != nil {
				debugLog.Write([]byte("→ STDIN: "))
				debugLog.Write(data)
				debugLog.Sync()
			}
			if err := sess.Write(data); err != nil {
				log.Printf("Failed to write to Claude stdin: %v", err)
			}
		}

		processStreamLine := func(line []byte) {
			// Always write to debug log
			if debugLog != nil {
				debugLog.Write([]byte("← STDOUT: "))
				debugLog.Write(line)
				debugLog.Write([]byte("\n"))
				debugLog.Sync()
			}

			var msg map[string]interface{}
			if json.Unmarshal(line, &msg) != nil {
				sendChatMsg("system", string(line))
				return
			}

			msgType, _ := msg["type"].(string)
			log.Printf("Claude stream event: %s", msgType)

			switch msgType {

			// ---- Tool approval request from Claude ----
			case "control_request":
				request, _ := msg["request"].(map[string]interface{})
				if request == nil {
					return
				}
				subtype, _ := request["subtype"].(string)
				requestID, _ := msg["request_id"].(string)
				log.Printf("  control_request: subtype=%s request_id=%s", subtype, requestID)

				if subtype == "can_use_tool" {
					toolName, _ := request["tool_name"].(string)
					toolUseID, _ := request["tool_use_id"].(string)
					inputJSON, _ := json.Marshal(request["input"])
					inputStr := string(inputJSON)

					// Show truncated input in logs
					logInput := inputStr
					if len(logInput) > 300 {
						logInput = logInput[:300] + "..."
					}
					log.Printf("  tool approval needed: %s (request_id=%s, tool_use_id=%s)\n  input: %s", toolName, requestID, toolUseID, logInput)

					// Notify phone — show approval card
					displayInput := inputStr
					if len(displayInput) > 500 {
						displayInput = displayInput[:500] + "..."
					}
					sendChatMsg("system", fmt.Sprintf("🔒 %s wants to use tool: %s", toolName, displayInput))
					sendToolCallToPhone(requestID, toolName, inputStr)

					// Create channel and wait for phone response in a goroutine
					ch := make(chan approvalResponse, 1)
					approvalMu.Lock()
					pendingApprovals[requestID] = ch
					approvalMu.Unlock()

					go func() {
						defer func() {
							approvalMu.Lock()
							delete(pendingApprovals, requestID)
							approvalMu.Unlock()
						}()

						select {
						case resp := <-ch:
							if resp.approved {
								log.Printf("  tool APPROVED by user: %s (request_id=%s)", toolName, requestID)
								sendChatMsg("system", fmt.Sprintf("✓ Approved: %s", toolName))
								sendToStdin(map[string]interface{}{
									"type": "control_response",
									"response": map[string]interface{}{
										"subtype":    "success",
										"request_id": requestID,
										"response": map[string]interface{}{
											"behavior":  "allow",
											"toolUseID": toolUseID,
										},
									},
								})
							} else {
								log.Printf("  tool REJECTED by user: %s (request_id=%s)", toolName, requestID)
								sendChatMsg("system", fmt.Sprintf("✗ Rejected: %s", toolName))
								sendToStdin(map[string]interface{}{
									"type": "control_response",
									"response": map[string]interface{}{
										"subtype":    "error",
										"request_id": requestID,
										"error":      "User rejected this tool use from ClaudeLink",
									},
								})
							}
						case <-time.After(5 * time.Minute):
							log.Printf("  tool approval TIMED OUT: %s (request_id=%s)", toolName, requestID)
							sendChatMsg("system", fmt.Sprintf("⏱ Timed out: %s (auto-rejected)", toolName))
							sendToStdin(map[string]interface{}{
								"type": "control_response",
								"response": map[string]interface{}{
									"subtype":    "error",
									"request_id": requestID,
									"error":      "Approval timed out (5 minutes)",
								},
							})
						case <-ctx.Done():
							return
						}
					}()
				} else {
					// Other control requests (set_permission_mode, etc.) — auto-respond success
					log.Printf("  auto-responding to control_request subtype=%s", subtype)
					sendToStdin(map[string]interface{}{
						"type": "control_response",
						"response": map[string]interface{}{
							"subtype":    "success",
							"request_id": requestID,
							"response":   map[string]interface{}{},
						},
					})
				}

			// ---- Regular stream events (same as before) ----

			case "assistant":
				message, _ := msg["message"].(map[string]interface{})
				if message == nil {
					return
				}
				content, _ := message["content"].([]interface{})
				for _, c := range content {
					block, _ := c.(map[string]interface{})
					if block == nil {
						continue
					}
					blockType, _ := block["type"].(string)
					switch blockType {
					case "text":
						if t, ok := block["text"].(string); ok && t != "" {
							log.Printf("  assistant text: %d chars", len(t))
							sendChatMsg("assistant", t)
						}
					case "tool_use":
						toolName, _ := block["name"].(string)
						inputJSON, _ := json.Marshal(block["input"])
						inputStr := string(inputJSON)
						if len(inputStr) > 200 {
							inputStr = inputStr[:200] + "..."
						}
						log.Printf("  tool_use: %s", toolName)
						sendChatMsg("system", fmt.Sprintf("Using tool: %s\n%s", toolName, inputStr))
					}
				}

			case "content_block_delta":
				delta, _ := msg["delta"].(map[string]interface{})
				if delta != nil {
					if t, ok := delta["text"].(string); ok && t != "" {
						sendChatMsg("assistant", t)
					}
				}

			case "user":
				message, _ := msg["message"].(map[string]interface{})
				if message == nil {
					return
				}
				content, _ := message["content"].([]interface{})
				for _, c := range content {
					block, _ := c.(map[string]interface{})
					if block == nil {
						continue
					}
					blockType, _ := block["type"].(string)
					if blockType == "tool_result" {
						resultContent, _ := block["content"].(string)
						if resultContent == "" {
							if contentArr, ok := block["content"].([]interface{}); ok {
								for _, cb := range contentArr {
									cbMap, _ := cb.(map[string]interface{})
									if cbMap != nil {
										if t, ok := cbMap["text"].(string); ok {
											resultContent += t
										}
									}
								}
							}
						}
						if len(resultContent) > 0 {
							log.Printf("  tool_result: %d chars", len(resultContent))
							if len(resultContent) > 2000 {
								resultContent = resultContent[:2000] + fmt.Sprintf("\n... (%d chars total)", len(resultContent))
							}
							sendChatMsg("assistant", resultContent)
						}
					}
				}

			case "result":
				if isErr, _ := msg["is_error"].(bool); isErr {
					if errMsg, ok := msg["error"].(string); ok {
						sendChatMsg("error", errMsg)
					}
				}
				sendChatDone()

			case "error":
				errObj, _ := msg["error"].(map[string]interface{})
				if errObj != nil {
					if m, ok := errObj["message"].(string); ok {
						sendChatMsg("error", m)
						return
					}
				}
				sendChatMsg("error", string(line))

			case "system":
				subtype, _ := msg["subtype"].(string)
				log.Printf("Claude system event: %s", subtype)

			case "keep_alive":
				// Ignore keepalive pings

			default:
				log.Printf("Claude event: %s (not forwarded)", msgType)
			}
		}

		streamOutputHandler := func(data []byte) {
			lineBuf = append(lineBuf, data...)
			for {
				idx := bytes.IndexByte(lineBuf, '\n')
				if idx < 0 {
					break
				}
				line := bytes.TrimSpace(lineBuf[:idx])
				lineBuf = lineBuf[idx+1:]
				if len(line) == 0 {
					continue
				}
				processStreamLine(line)
			}
		}

		sess = ptycap.NewSession(shellCmd, args, streamOutputHandler)
		// Do NOT set NoStdin — we need the stdin pipe for sending messages and tool responses
		if err := sess.Start(ctx); err != nil {
			sendChatMsg("error", fmt.Sprintf("Failed to start Claude: %v", err))
			log.Fatalf("Failed to start Claude process: %v", err)
		}
		log.Printf("Claude process started (PID: %d) — single long-running session", sess.PID())

		sendChatMsg("system", "Connected to Claude Code! Tool approvals will appear here.")

		// Send initial greeting prompt via stdin
		sendToStdin(map[string]interface{}{
			"type":    "user_message",
			"content": "You are being accessed remotely via ClaudeLink. Say hello and briefly describe what you can do.",
		})

		// ---- Main event loop: phone messages + process exit ----
		for {
			select {
			case env := <-client.Receive():
				switch env.Type {
				case protocol.MsgTypeTermInput:
					log.Printf("Phone input received: %.100s", env.Payload)
					sendToStdin(map[string]interface{}{
						"type":    "user_message",
						"content": env.Payload,
					})

				case protocol.MsgTypeToolApprove:
					log.Printf("Tool APPROVED from phone: %s", env.Payload)
					approvalMu.Lock()
					if ch, ok := pendingApprovals[env.Payload]; ok {
						ch <- approvalResponse{approved: true}
					} else {
						log.Printf("  WARNING: no pending approval for request_id=%s", env.Payload)
					}
					approvalMu.Unlock()

				case protocol.MsgTypeToolReject:
					log.Printf("Tool REJECTED from phone: %s", env.Payload)
					approvalMu.Lock()
					if ch, ok := pendingApprovals[env.Payload]; ok {
						ch <- approvalResponse{approved: false}
					} else {
						log.Printf("  WARNING: no pending approval for request_id=%s", env.Payload)
					}
					approvalMu.Unlock()

				case protocol.MsgTypeHeartbeat:
				case protocol.MsgTypePair:
					log.Printf("Received re-pair request (already running)")
				case protocol.MsgTypeDisconnect:
					log.Printf("Received disconnect notification")
				default:
					log.Printf("Unhandled message type: %s", env.Type)
				}

			case <-sess.Done():
				log.Println("Claude process exited")
				sendChatMsg("system", "Claude Code process ended. Restart companion to start a new session.")
				return

			case <-ctx.Done():
				sess.Stop()
				return
			}
		}
	}

	// ========== Shell fallback mode ==========
	shellOutputHandler := func(data []byte) {
		sendToPhone(string(data))
	}

	session := ptycap.NewSession(shellCmd, shellArgs, shellOutputHandler)
	if err := session.Start(ctx); err != nil {
		client.Send(&protocol.Envelope{
			SessionID: sessionID,
			Type:      protocol.MsgTypeTermOutput,
			Payload:   fmt.Sprintf("[ERROR] Failed to start process: %v\n", err),
			Timestamp: time.Now().UnixMilli(),
		})
		log.Fatalf("Failed to start process: %v", err)
	}

	log.Printf("Shell started: %s", shellCmd)

	for {
		select {
		case env := <-client.Receive():
			handlePhoneMessage(env, session, keyPair, peerPublicKey)
		case <-session.Done():
			log.Println("Shell process exited")
			client.Send(&protocol.Envelope{
				SessionID: sessionID,
				Type:      protocol.MsgTypeSessionEnd,
				Timestamp: time.Now().UnixMilli(),
			})
			return
		case <-ctx.Done():
			session.Stop()
			return
		}
	}
}

func handlePhoneMessage(env *protocol.Envelope, session *ptycap.Session, kp *crypto.KeyPair, peerKey *[32]byte) {
	switch env.Type {
	case protocol.MsgTypeTermInput:
		if err := session.Write([]byte(env.Payload)); err != nil {
			log.Printf("Failed to write to shell: %v", err)
		}
	case protocol.MsgTypeToolApprove:
		session.Write([]byte("y\n"))
	case protocol.MsgTypeToolReject:
		session.Write([]byte("n\n"))
	case protocol.MsgTypeHeartbeat:
	case protocol.MsgTypePair:
		log.Printf("Received re-pair request")
	case protocol.MsgTypeDisconnect:
		log.Printf("Disconnect notification")
	default:
		log.Printf("Unknown msg type: %s", env.Type)
	}
}

func generateSessionID() string {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		log.Fatalf("Failed to generate session ID: %v", err)
	}
	return hex.EncodeToString(bytes)
}

func findClaudeCLI() string {
	home, _ := os.UserHomeDir()
	if home == "" {
		return ""
	}

	extDir := filepath.Join(home, ".vscode", "extensions")
	matches, _ := filepath.Glob(filepath.Join(extDir, "anthropic.claude-code-*"))
	for _, m := range matches {
		candidates := []string{
			filepath.Join(m, "resources", "native-binary", "claude.exe"),
			filepath.Join(m, "resources", "native-binary", "claude"),
			filepath.Join(m, "claude.exe"),
			filepath.Join(m, "claude"),
		}
		for _, c := range candidates {
			if _, err := os.Stat(c); err == nil {
				return c
			}
		}
	}

	if p, err := exec.LookPath("claude"); err == nil {
		return p
	}

	return ""
}

func marshalPayload(v interface{}) string {
	data, err := json.Marshal(v)
	if err != nil {
		log.Printf("Failed to marshal payload: %v", err)
		return "{}"
	}
	return string(data)
}
