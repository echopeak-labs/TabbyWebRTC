#!/usr/bin/env bash

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

export LAN_IP="$(detect_lan_ip)"
export TEST_SERVER_PORT="${TEST_SERVER_PORT:-3001}"
export FRONTEND_PORT="${FRONTEND_PORT:-5173}"
export HOST="0.0.0.0"
export PORT="$TEST_SERVER_PORT"
export WS_URL="ws://${LAN_IP}:${PORT}"
export REST_URL="http://${LAN_IP}:${PORT}"
export VIEWER_URL="http://${LAN_IP}:${FRONTEND_PORT}"
