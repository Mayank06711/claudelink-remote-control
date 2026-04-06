/**
 * ClaudeLink Relay — Cloudflare Worker with Durable Objects
 *
 * This is the ONLY TypeScript in the entire project (~120 lines).
 * It's a dumb WebSocket relay — receives encrypted messages from
 * companion (PC) and forwards them to app (phone), and vice versa.
 *
 * It CANNOT read message contents (E2E encrypted with NaCl).
 * It only sees: session_id and message type (for routing).
 */

interface Env {
  SESSIONS: DurableObjectNamespace;
}

// --- Worker entry point ---
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      const sessionId = url.searchParams.get("session");
      const role = url.searchParams.get("role"); // "companion" or "app"

      if (!sessionId || !role) {
        return new Response("Missing session or role param", { status: 400 });
      }

      if (role !== "companion" && role !== "app") {
        return new Response("Role must be 'companion' or 'app'", { status: 400 });
      }

      // Route to the Durable Object for this session
      const id = env.SESSIONS.idFromName(sessionId);
      const stub = env.SESSIONS.get(id);
      return stub.fetch(request);
    }

    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok", version: "0.1.0" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("ClaudeLink Relay", { status: 200 });
  },
};

// --- Durable Object: manages one session's WebSocket pair ---
export class SessionRelay implements DurableObject {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  // Get live socket by role tag — survives hibernation wake-ups
  private getSocket(role: "companion" | "app"): WebSocket | null {
    const sockets = this.state.getWebSockets(role);
    return sockets.length > 0 ? sockets[0] : null;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const role = url.searchParams.get("role")! as "companion" | "app";

    // Close any existing socket for this role — notify it first so it doesn't auto-reconnect
    const existing = this.getSocket(role);
    if (existing) {
      try {
        existing.send(JSON.stringify({
          type: "replaced",
          session_id: "",
          nonce: "",
          payload: "Another device connected as " + role,
          ts: Date.now(),
        }));
        existing.close(1000, "replaced");
      } catch {}
    }

    // Create WebSocket pair
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept with hibernation tag
    this.state.acceptWebSocket(server, [role]);

    return new Response(null, { status: 101, webSocket: client });
  }

  // Called when a WebSocket message is received
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const tags = this.state.getTags(ws);
    const isCompanion = tags.includes("companion");

    // Forward to the other side (always look up fresh via getWebSockets)
    const target = isCompanion ? this.getSocket("app") : this.getSocket("companion");

    if (target) {
      try {
        target.send(message);
      } catch {
        // Target disconnected
      }
    }
  }

  // Called when a WebSocket closes
  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    const tags = this.state.getTags(ws);
    const otherRole = tags.includes("companion") ? "app" : "companion";

    const other = this.getSocket(otherRole);
    if (other) {
      try {
        other.send(JSON.stringify({ type: "disconnect", role: tags[0] }));
      } catch {}
    }
  }

  // Called on WebSocket error
  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    ws.close(1011, "WebSocket error");
  }
}
