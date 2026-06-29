#!/usr/bin/env bash
set -euo pipefail

show_help() {
  cat <<EOF
Usage: ./scripts/dev-local.sh

Start test server, Vite frontend, and desktop agent for LAN end-to-end testing.

Prerequisites:
  Node.js 22+
  Rust stable toolchain
  testServer/.env (copy from testServer/.env.example)
  CLERK_PUBLISHABLE_KEY environment variable

EOF
}

if [[ "${1:-}" == "--help" ]]; then
  show_help
  exit 0
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

detect_lan_ip() {
  if [[ -n "${LAN_IP:-}" ]]; then
    echo "$LAN_IP"
    return
  fi

  local ip
  ip="$(node -e "
    const os = require('os');
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] ?? []) {
        if (net.family === 'IPv4' && !net.internal) {
          process.stdout.write(net.address);
          process.exit(0);
        }
      }
    }
    process.exit(1);
  " 2>/dev/null || true)"

  if [[ -z "$ip" ]]; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi

  if [[ -z "$ip" ]]; then
    echo "Could not detect LAN IP. Set LAN_IP and retry." >&2
    exit 1
  fi

  echo "$ip"
}

LAN_IP="$(detect_lan_ip)"
PORT="${TEST_SERVER_PORT:-3001}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
WS_URL="ws://${LAN_IP}:${PORT}"
REST_URL="http://${LAN_IP}:${PORT}"
VIEWER_URL="http://${LAN_IP}:${FRONTEND_PORT}"

if [[ ! -f "$ROOT/testServer/.env" ]]; then
  echo "Missing $ROOT/testServer/.env — copy testServer/.env.example and edit values." >&2
  exit 1
fi

if [[ ! -d "$ROOT/testServer/node_modules" ]]; then
  echo "Installing testServer dependencies..."
  npm ci --prefix "$ROOT/testServer"
fi

if [[ ! -d "$ROOT/frontend/node_modules" ]]; then
  echo "Installing frontend dependencies..."
  npm ci --prefix "$ROOT/frontend"
fi

PIDS=()

cleanup() {
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}

trap cleanup EXIT INT TERM

echo "Starting TabbyRDP local stack (LAN IP: ${LAN_IP})"
echo ""

(
  cd "$ROOT/testServer"
  export HOST="0.0.0.0"
  export PORT="$PORT"
  export LAN_IP="$LAN_IP"
  npm run start:dev
) &
PIDS+=($!)

(
  cd "$ROOT/frontend"
  VITE_WS_URL="$WS_URL" \
  VITE_REST_URL="$REST_URL" \
  VITE_CLERK_PUBLISHABLE_KEY="${CLERK_PUBLISHABLE_KEY:-}" \
  npx vite --host 0.0.0.0 --port "$FRONTEND_PORT"
) &
PIDS+=($!)

AGENT_CONFIG="$(mktemp /tmp/tabbyrdp-agent-dev-XXXXXX.toml)"
cat >"$AGENT_CONFIG" <<EOF
[agent]
id = "dev-local-agent"
name = "TabbyRDP Dev Agent"

[signaling]
url = "${WS_URL}"

[capture]
encoder = "auto"
max_fps = 60
hide_cursor = true

[http]
thumbnail_port = 7700
bind = "0.0.0.0"
EOF

(
  cd "$ROOT"
  cargo run --manifest-path desktop-agent/Cargo.toml -- --config "$AGENT_CONFIG"
) &
PIDS+=($!)

sleep 2
echo "────────────────────────────────────────────────"
echo "  Viewer (desktop):  ${VIEWER_URL}"
echo "  Viewer (mobile):    ${VIEWER_URL}  (same Wi-Fi)"
echo "  REST API:           ${REST_URL}"
echo "  WebSocket:          ${WS_URL}"
echo "────────────────────────────────────────────────"
echo "Press Ctrl+C to stop all services."
echo ""

wait
