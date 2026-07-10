#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=dev-env.sh
source "$ROOT/scripts/dev-env.sh"

cd "$ROOT/components/frontend"

export VITE_WS_URL="$WS_URL"
export VITE_REST_URL="$REST_URL"

if [[ -n "${CLERK_PUBLISHABLE_KEY:-}" ]]; then
  export VITE_CLERK_PUBLISHABLE_KEY="$CLERK_PUBLISHABLE_KEY"
elif [[ -z "${VITE_CLERK_PUBLISHABLE_KEY:-}" ]]; then
  unset VITE_CLERK_PUBLISHABLE_KEY
fi

yarn vite --host 0.0.0.0 --port "$FRONTEND_PORT"
