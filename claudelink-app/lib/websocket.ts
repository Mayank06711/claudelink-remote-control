/**
 * WebSocket connection manager — handles connection to the relay,
 * auto-reconnect, and message routing.
 */

import type { Envelope, MessageType } from "./protocol";

type MessageHandler = (envelope: Envelope) => void;

interface WSConfig {
  relayURL: string;
  sessionID: string;
  role: "app"; // Phone is always "app" role
  onMessage: MessageHandler;
  onConnect: () => void;
  onDisconnect: () => void;
}

const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000]; // Progressive backoff
const HEARTBEAT_INTERVAL = 30000; // 30 seconds

export class WebSocketManager {
  private ws: WebSocket | null = null;
  private config: WSConfig;
  private reconnectAttempt = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private shouldReconnect = true;

  constructor(config: WSConfig) {
    this.config = config;
  }

  /** Establish WebSocket connection to the relay */
  connect(): void {
    const url = `${this.config.relayURL}/ws?session=${this.config.sessionID}&role=${this.config.role}`;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.startHeartbeat();
      this.config.onConnect();
    };

    this.ws.onmessage = (event) => {
      try {
        const envelope: Envelope = JSON.parse(event.data);
        this.config.onMessage(envelope);
      } catch (err) {
        console.error("Failed to parse WebSocket message:", err);
      }
    };

    this.ws.onclose = () => {
      this.stopHeartbeat();
      this.config.onDisconnect();
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = (err) => {
      console.error("WebSocket error:", err);
    };
  }

  /** Send a message envelope to the relay */
  send(envelope: Envelope): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(envelope));
    } else {
      console.warn("WebSocket not connected, message dropped");
    }
  }

  /** Send a typed message (creates envelope automatically) */
  sendMessage(type: MessageType, payload: string, nonce = ""): void {
    this.send({
      session_id: this.config.sessionID,
      type,
      nonce,
      payload,
      ts: Date.now(),
    });
  }

  /** Cleanly disconnect */
  disconnect(): void {
    this.shouldReconnect = false;
    this.stopHeartbeat();
    this.ws?.close(1000, "user disconnect");
    this.ws = null;
  }

  /** Check if currently connected */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.sendMessage("heartbeat", "");
    }, HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    const delay = RECONNECT_DELAYS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1)];
    this.reconnectAttempt++;

    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})...`);
    setTimeout(() => this.connect(), delay);
  }
}
