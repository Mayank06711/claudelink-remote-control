# ClaudeLink — Master Plan & Architecture

> Control Claude Code from anywhere. Your code stays on your machine.

**Last Updated**: 2026-02-10

---

## WHAT IS CLAUDELINK

ClaudeLink lets you monitor and control Claude Code (running on your PC) from your phone, another laptop, or any browser — in real-time. If your PC is off, switch to BYOK mode and talk to Claude directly using your own API key.

---

## CORE ARCHITECTURE

```
MODE 1: REMOTE PC (primary mode)
═══════════════════════════════════════════════════════════

YOUR PC                       CLOUDFLARE              YOUR PHONE
┌──────────────┐             ┌──────────┐            ┌──────────────┐
│  Claude Code │             │  Worker  │            │  React Native│
│  (VS Code)   │             │  +       │            │  App (Expo)  │
│      ↕       │  WSS ──→   │  Durable │  ←── WSS  │              │
│  Companion   │ (encrypted) │  Object  │ (encrypted)│  3 tabs:     │
│  (Go binary) │             │  (relay) │            │  - Sessions  │
└──────────────┘             │          │            │  - Terminal  │
                             │  FREE    │            │  - Settings  │
                             └──────────┘            └──────────────┘

MODE 2: DIRECT / BYOK (fallback — works without PC)
═══════════════════════════════════════════════════════════

YOUR PHONE                              ANTHROPIC API
┌──────────────┐     Direct HTTPS       ┌──────────────┐
│  React Native│  ──────────────→       │  Claude API  │
│  App (Expo)  │  (user's own key)      │  /v1/messages│
│  BYOK Mode   │  ←──────────────       │  (streaming) │
└──────────────┘     SSE stream         └──────────────┘
```

---

## TECH STACK

| Component | Language/Framework | Why |
|-----------|-------------------|-----|
| **Companion binary** | Go | Single binary, cross-platform, no deps, fast, low memory |
| **Relay server** | TypeScript (Cloudflare Worker) | CF Workers requires JS/TS. Relay is ~150 lines, too simple to matter |
| **Mobile + Web app** | React Native + Expo | One codebase → iOS + Android + Web |
| **Encryption** | NaCl box (Go: nacl/box, JS: tweetnacl) | Same algorithm both sides. Relay can't read content |
| **State management** | Zustand | Lightweight, simple, works with React Native |
| **Real-time** | WebSocket | Native support in Go + React Native + Cloudflare Workers |

---

## REPOS

### 1. `claudelink-server` (Go + relay)

```
claudelink-server/
├── cmd/companion/main.go        ← Entry point for companion binary
├── internal/
│   ├── pty/capture.go           ← Captures Claude Code terminal output
│   ├── ws/client.go             ← WebSocket client (connects to relay)
│   ├── crypto/e2e.go            ← NaCl box encryption
│   ├── protocol/messages.go     ← Shared message types (SYNC WITH app)
│   └── pairing/qr.go           ← QR code generation
├── relay/                       ← The ONLY TypeScript (~150 lines)
│   ├── src/index.ts             ← Cloudflare Worker + Durable Object
│   ├── wrangler.toml            ← Cloudflare config
│   └── package.json
├── go.mod
├── Makefile                     ← Build for windows/mac/linux
└── .gitignore
```

### 2. `claudelink-app` (React Native / Expo)

```
claudelink-app/
├── app/                         ← Expo Router screens
│   ├── _layout.tsx              ← Root layout (dark theme)
│   ├── pair.tsx                 ← QR code scanner (modal)
│   └── (tabs)/
│       ├── _layout.tsx          ← Tab navigator
│       ├── index.tsx            ← Sessions dashboard
│       ├── terminal.tsx         ← Live terminal + approvals
│       └── settings.tsx         ← API key, mode toggle, connection
├── components/                  ← Reusable UI components (TODO)
├── lib/
│   ├── protocol.ts              ← Message types (SYNC WITH Go)
│   ├── crypto.ts                ← NaCl encryption (tweetnacl)
│   ├── websocket.ts             ← WebSocket connection manager
│   ├── claude-api.ts            ← Direct Claude API client (BYOK)
│   └── store.ts                 ← Zustand global state
├── assets/images/
├── app.json                     ← Expo config
├── package.json
├── tsconfig.json
└── .gitignore
```

---

## MESSAGE PROTOCOL

All messages are wrapped in an `Envelope`:

```json
{
  "session_id": "abc123...",
  "type": "term_output",
  "nonce": "<base64>",
  "payload": "<base64 encrypted>",
  "ts": 1707571200000
}
```

### Message Types

| Type | Direction | Description |
|------|-----------|-------------|
| `pair` | Phone → PC | Initial pairing request |
| `pair_ack` | PC → Phone | Pairing confirmed |
| `heartbeat` | Both | Keep-alive |
| `disconnect` | Both | Clean disconnect |
| `term_output` | PC → Phone | Claude Code terminal output |
| `term_input` | Phone → PC | User command to Claude |
| `term_resize` | Phone → PC | Terminal dimensions change |
| `session_start` | PC → Phone | Claude session started |
| `session_end` | PC → Phone | Claude session ended |
| `session_list` | PC → Phone | Active sessions list |
| `tool_call` | PC → Phone | Claude needs tool approval |
| `tool_approve` | Phone → PC | User approves tool |
| `tool_reject` | Phone → PC | User rejects tool |
| `diff` | PC → Phone | File diff for review |
| `status` | PC → Phone | Status update |
| `error` | Both | Error notification |

---

## E2E ENCRYPTION FLOW

```
1. PC generates NaCl key pair → displays QR code containing:
   { session_id, relay_url, public_key }

2. Phone scans QR → generates its own NaCl key pair

3. Phone sends "pair" message with its public key (this one is unencrypted)

4. Both sides now have each other's public keys

5. All subsequent messages: payload = NaCl.box(plaintext, nonce, peerPubKey, myPrivKey)

6. Relay CANNOT decrypt — it only sees session_id and message type
```

---

## CLOUDFLARE FREE TIER LIMITS

| Resource | Free Limit | Our Usage (50 users) |
|----------|-----------|---------------------|
| Worker requests/day | 100,000 | ~5,000 |
| Durable Object requests/day | 100,000 | ~2,500 (WebSocket 20:1 ratio) |
| Effective WebSocket msgs/day | 2,000,000 | ~50,000 |
| DO compute (GB-s/day) | 13,000 | Minimal |
| Storage | 5 GB | ~0 (relay stores nothing) |

**Verdict**: Free tier handles up to ~500 daily active users comfortably.

---

## PAIRING FLOW (User Experience)

```
1. User installs companion on PC:
   → Downloads single binary (5MB)
   → Runs: ./claudelink-companion

2. Terminal shows QR code + session ID

3. User opens ClaudeLink app on phone:
   → Taps "Pair Device"
   → Scans QR code
   → Devices connected (E2E encrypted)

4. User starts Claude Code in VS Code as normal:
   → Phone shows live terminal feed
   → Push notification: "Claude Code session active"

5. User walks away:
   → Phone shows everything Claude does
   → Notification: "Claude needs approval for file edit"
   → Tap Approve/Reject from phone

6. PC is off? Switch to Direct (BYOK) mode:
   → Uses own API key
   → Full Claude experience from phone
```

---

## MVP ROADMAP

### Phase 1: Core Connection (Week 1-2)
- [ ] Companion binary: start, capture dummy output, connect to relay
- [ ] Relay: deploy to Cloudflare, test WebSocket pairing
- [ ] App: QR scanner, connect to relay, display terminal output
- [ ] E2E encryption working end-to-end
- [ ] Test: PC → Relay → Phone message flow

### Phase 2: Claude Integration (Week 2-3)
- [ ] Companion: actual PTY capture of Claude Code CLI
- [ ] Companion: detect tool call requests, send to phone
- [ ] App: approval/rejection flow for tool calls
- [ ] App: send text commands back to Claude
- [ ] Handle reconnection gracefully

### Phase 3: BYOK Mode (Week 3-4)
- [ ] App: Claude API client with streaming
- [ ] App: secure API key storage (expo-secure-store)
- [ ] App: mode toggle between Remote and Direct
- [ ] App: conversation history in direct mode

### Phase 4: Polish & Ship (Week 4-5)
- [ ] Push notifications (agent needs attention, task complete)
- [ ] Multi-session support (multiple Claude instances)
- [ ] Diff viewer component
- [ ] Error handling, edge cases, offline behavior
- [ ] App Store / Play Store submission
- [ ] Landing page

### Phase 5: Differentiate (Week 5+)
- [ ] Multi-agent dashboard
- [ ] API cost tracking per session
- [ ] Smart notifications ("Claude is stuck on X")
- [ ] Team features (share sessions)
- [ ] Cross-platform companion (Windows installer, Mac .app, Linux package)

---

## KEY DECISIONS LOG

| Decision | Choice | Reasoning |
|----------|--------|-----------|
| Companion language | Go | Single binary, cross-platform, fast, low memory |
| Relay language | TypeScript | Cloudflare Workers requires JS/TS. Relay is trivial (~150 lines) |
| Relay hosting | Cloudflare Workers (free) | $0/mo, 2M WebSocket msgs/day free, global edge |
| Mobile framework | React Native + Expo | One codebase for iOS + Android + Web |
| Encryption | NaCl box | Same lib in Go and JS, proven, fast |
| State management | Zustand | Lightweight, simple, no boilerplate |
| Repos | 2 (server + app) | Clean separation, different build pipelines |
| Risk mitigation | BYOK mode | Works even if Anthropic changes rules. API = their business model |

---

## COMPETITIVE ADVANTAGES

| What others lack | Our advantage |
|-----------------|---------------|
| Happy, Kibbler = iOS only | iOS + Android + Web from day 1 |
| Most tools = CLI wrapper | BYOK fallback — works without PC |
| Open-source = no polish | Real product: QR pairing, notifications, dark UI |
| No cost tracking | API spend monitoring per session |
| Single-agent only | Multi-session dashboard |
| No encryption (most) | E2E encrypted — relay can't read anything |

---

## FILES THAT MUST STAY IN SYNC

When modifying the message protocol, update BOTH:
1. `claudelink-server/internal/protocol/messages.go`
2. `claudelink-app/lib/protocol.ts`

When modifying encryption:
1. `claudelink-server/internal/crypto/e2e.go`
2. `claudelink-app/lib/crypto.ts`

---

## MARKET CONTEXT

- Full market research saved in: `MARKET_RESEARCH_REPORT.md`
- AI coding market: $4-7B (2025), growing 15-27% CAGR
- 10+ competitors exist but fragmented, no winner, most iOS-only
- Strong developer demand (viral HN posts, blog posts)
- Anthropic has Claude Code Web + iOS but limited compared to dedicated apps
