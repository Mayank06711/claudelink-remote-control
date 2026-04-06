#!/bin/bash
# ============================================
# ClaudeLink — Local Dev Launcher
# Starts relay + companion + app on LAN
# Both phone and PC must be on same WiFi
# ============================================

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
RELAY_PORT=8787
EXPO_PORT=8081

# Auto-detect LAN IP
LAN_IP=$(ipconfig 2>/dev/null | grep "IPv4" | grep -v "172\." | head -1 | awk '{print $NF}' | tr -d '\r')
if [ -z "$LAN_IP" ]; then
  LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
fi
if [ -z "$LAN_IP" ]; then
  LAN_IP="127.0.0.1"
fi

RELAY_URL="ws://${LAN_IP}:${RELAY_PORT}"

echo "============================================"
echo "  ClaudeLink Dev Launcher"
echo "============================================"
echo ""
echo "  LAN IP:     $LAN_IP"
echo "  Relay:      $RELAY_URL"
echo "  Expo:       http://${LAN_IP}:${EXPO_PORT}"
echo ""
echo "============================================"
echo ""

# Kill leftover processes on our ports
echo "Cleaning up old processes..."
for port in $RELAY_PORT $EXPO_PORT; do
  pid=$(cmd //c "netstat -ano" 2>/dev/null | grep ":${port} " | grep "LISTENING" | awk '{print $NF}' | head -1 | tr -d '\r')
  if [ -n "$pid" ] && [ "$pid" != "0" ]; then
    echo "  Killing leftover process on port $port (PID: $pid)"
    taskkill //F //PID "$pid" 2>/dev/null || true
    sleep 1
  fi
done
echo ""

# Track PIDs for cleanup
PIDS=""

cleanup() {
  echo ""
  echo "Shutting down all services..."
  for pid in $PIDS; do
    kill "$pid" 2>/dev/null
  done
  # Also kill any child processes
  for port in $RELAY_PORT $EXPO_PORT; do
    pid=$(cmd //c "netstat -ano" 2>/dev/null | grep ":${port} " | grep "LISTENING" | awk '{print $NF}' | head -1 | tr -d '\r')
    if [ -n "$pid" ] && [ "$pid" != "0" ]; then
      taskkill //F //PID "$pid" 2>/dev/null || true
    fi
  done
  # Clean up QR code PNGs
  rm -f "$ROOT_DIR"/claudelink-qr-*.png 2>/dev/null
  echo "Done."
  exit 0
}
trap cleanup INT TERM

# 1. Start Relay
echo "[1/3] Starting relay on port $RELAY_PORT..."
cd "$ROOT_DIR/claudelink-server/relay"
npx wrangler dev --local --port $RELAY_PORT --ip 0.0.0.0 2>&1 | sed 's/^/  [relay] /' &
PIDS="$PIDS $!"
sleep 10

# 2. Start Companion (saves QR as PNG in project root)
echo ""
echo "[2/3] Starting companion..."
cd "$ROOT_DIR/claudelink-server"
export PATH="/c/Program Files/Go/bin:$PATH"
./bin/claudelink-companion.exe --relay "$RELAY_URL" --qr-dir "$ROOT_DIR" --pair-port 8788 2>&1 | sed 's/^/  [companion] /' &
PIDS="$PIDS $!"
sleep 3

# Auto-open the QR code PNG so user can scan it from phone
QR_FILE=$(ls -t "$ROOT_DIR"/claudelink-qr-*.png 2>/dev/null | head -1)
if [ -n "$QR_FILE" ]; then
  echo ""
  echo "  >>> QR code saved: $QR_FILE"
  echo "  >>> Opening it now — scan with ClaudeLink app on your phone"
  echo ""
  # Open with default image viewer (Windows)
  cmd //c start "" "$QR_FILE" 2>/dev/null &
fi

# 3. Start Expo (with --port flag to avoid conflict)
echo ""
echo "[3/3] Starting Expo app..."
echo ""
echo "============================================"
echo "  ON YOUR PHONE:"
echo "  1. Scan Expo QR below with Expo Go"
echo "  2. In the app: tap 'Pair Device'"
echo "  3. Scan the QR PNG (opened on your screen)"
echo "     Relay URL:  $RELAY_URL"
echo "============================================"
echo ""
echo "All services running. Press Ctrl+C to stop."
echo ""
cd "$ROOT_DIR/claudelink-app"
npx expo start --lan --port $EXPO_PORT &
PIDS="$PIDS $!"

# Wait forever until Ctrl+C
wait
