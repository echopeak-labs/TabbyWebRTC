#!/usr/bin/env bash
set -euo pipefail

show_help() {
  cat <<EOF
Usage: ./scripts/dev-frontend.sh

Start Vite dev server (port 5173) pointed at local backend.

Prerequisites:
  Node.js 22+
  VITE_* values in components/frontend/.env
  (optional CLERK_PUBLISHABLE_KEY in the environment)

EOF
}

if [[ "${1:-}" == "--help" ]]; then
  show_help
  exit 0
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT/components/frontend"

if [[ -n "${CLERK_PUBLISHABLE_KEY:-}" ]]; then
  export VITE_CLERK_PUBLISHABLE_KEY="$CLERK_PUBLISHABLE_KEY"
elif [[ -z "${VITE_CLERK_PUBLISHABLE_KEY:-}" ]]; then
  unset VITE_CLERK_PUBLISHABLE_KEY
fi

yarn vite --port 5173
