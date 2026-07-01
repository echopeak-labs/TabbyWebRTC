#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=dev-env.sh
source "$ROOT/scripts/dev-env.sh"

cd "$ROOT/components/frontend"
VITE_WS_URL="$WS_URL" \
VITE_REST_URL="$REST_URL" \
VITE_CLERK_PUBLISHABLE_KEY="${CLERK_PUBLISHABLE_KEY:-}" \
yarn vite --host 0.0.0.0 --port "$FRONTEND_PORT"
