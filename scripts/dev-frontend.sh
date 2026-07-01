#!/usr/bin/env bash
set -euo pipefail

show_help() {
  cat <<EOF
Usage: ./scripts/dev-frontend.sh

Start Vite dev server (port 5173) pointed at local backend.

Prerequisites:
  Node.js 22+
  CLERK_PUBLISHABLE_KEY environment variable

EOF
}

if [[ "${1:-}" == "--help" ]]; then
  show_help
  exit 0
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT/components/frontend"
VITE_WS_URL="ws://localhost:3001" \
VITE_REST_URL="http://localhost:3001" \
VITE_CLERK_PUBLISHABLE_KEY="${CLERK_PUBLISHABLE_KEY:-}" \
yarn vite --port 5173
