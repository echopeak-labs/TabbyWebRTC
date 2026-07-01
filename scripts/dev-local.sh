#!/usr/bin/env bash
set -euo pipefail

show_help() {
  cat <<EOF
Usage: ./scripts/dev-local.sh

Start test server, Vite frontend, and desktop agent for LAN end-to-end testing.

Prerequisites:
  Node.js 22+
  Rust stable toolchain
  components/testServer/.env (copy from components/testServer/.env.example)
  CLERK_PUBLISHABLE_KEY environment variable

EOF
}

if [[ "${1:-}" == "--help" ]]; then
  show_help
  exit 0
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -f "$ROOT/components/testServer/.env" ]]; then
  echo "Missing $ROOT/components/testServer/.env — copy components/testServer/.env.example and edit values." >&2
  exit 1
fi

# shellcheck source=dev-env.sh
source "$ROOT/scripts/dev-env.sh"

echo "Starting TabbyWebRTC local stack (LAN IP: ${LAN_IP})"
echo ""
echo "────────────────────────────────────────────────"
echo "  Viewer (desktop):  ${VIEWER_URL}"
echo "  Viewer (mobile):    ${VIEWER_URL}  (same Wi-Fi)"
echo "  REST API:           ${REST_URL}"
echo "  WebSocket:          ${WS_URL}"
echo "────────────────────────────────────────────────"
echo "Press Ctrl+C to stop all services."
echo ""

exec yarn dev
