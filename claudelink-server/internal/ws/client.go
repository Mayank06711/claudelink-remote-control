// Package ws handles WebSocket connection to the Cloudflare relay server.
package ws

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/claudelink/server/internal/protocol"
	"github.com/gorilla/websocket"
)

const (
	writeTimeout  = 10 * time.Second
	pongTimeout   = 60 * time.Second
	pingInterval  = 30 * time.Second
	maxMsgSize    = 1024 * 1024 // 1MB max message
)

// Client manages the WebSocket connection to the relay.
type Client struct {
	relayURL  string
	sessionID string
	conn      *websocket.Conn
	mu        sync.Mutex

	// Channels
	send    chan []byte
	receive chan *protocol.Envelope
	done    chan struct{}
}

// NewClient creates a new WebSocket client for the relay.
func NewClient(relayURL, sessionID string) *Client {
	return &Client{
		relayURL:  relayURL,
		sessionID: sessionID,
		send:      make(chan []byte, 256),
		receive:   make(chan *protocol.Envelope, 256),
		done:      make(chan struct{}),
	}
}

// Connect establishes the WebSocket connection to the relay.
func (c *Client) Connect(ctx context.Context) error {
	url := fmt.Sprintf("%s/ws?session=%s&role=companion", c.relayURL, c.sessionID)

	conn, _, err := websocket.DefaultDialer.DialContext(ctx, url, nil)
	if err != nil {
		return fmt.Errorf("connect to relay: %w", err)
	}

	conn.SetReadLimit(maxMsgSize)
	c.conn = conn

	// Start read/write pumps
	go c.readPump()
	go c.writePump()

	log.Printf("Connected to relay: %s", c.relayURL)
	return nil
}

// Send queues a message envelope to be sent to the relay.
func (c *Client) Send(env *protocol.Envelope) error {
	data, err := json.Marshal(env)
	if err != nil {
		return fmt.Errorf("marshal envelope: %w", err)
	}

	select {
	case c.send <- data:
		return nil
	default:
		return fmt.Errorf("send buffer full")
	}
}

// Receive returns the channel for incoming messages from the phone.
func (c *Client) Receive() <-chan *protocol.Envelope {
	return c.receive
}

// Done returns a channel that closes when the connection is lost.
func (c *Client) Done() <-chan struct{} {
	return c.done
}

// Close cleanly shuts down the WebSocket connection.
func (c *Client) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	close(c.done)
	if c.conn != nil {
		return c.conn.Close()
	}
	return nil
}

func (c *Client) readPump() {
	defer func() {
		c.Close()
	}()

	c.conn.SetReadDeadline(time.Now().Add(pongTimeout))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongTimeout))
		return nil
	})

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				log.Printf("WebSocket read error: %v", err)
			}
			return
		}

		var env protocol.Envelope
		if err := json.Unmarshal(message, &env); err != nil {
			log.Printf("Invalid message from relay: %v", err)
			continue
		}

		select {
		case c.receive <- &env:
		default:
			log.Printf("Receive buffer full, dropping message")
		}
	}
}

func (c *Client) writePump() {
	ticker := time.NewTicker(pingInterval)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeTimeout))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
				log.Printf("WebSocket write error: %v", err)
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeTimeout))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}

		case <-c.done:
			return
		}
	}
}
