#!/usr/bin/env bash
set -euo pipefail

show_help() {
  cat <<EOF
Usage: ./scripts/dev-backend.sh

Start local WebSocket signaling via AWS SAM CLI (port 3001).

Prerequisites:
  AWS SAM CLI
  infra/env.local.json (copy from scripts/env.local.json.example)

EOF
}

if [[ "${1:-}" == "--help" ]]; then
  show_help
  exit 0
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INFRA="$ROOT/infra"

command -v sam >/dev/null || { echo "AWS SAM CLI required"; exit 1; }

if [[ ! -f "$INFRA/env.local.json" ]]; then
  echo "Missing $INFRA/env.local.json — copy scripts/env.local.json.example and edit values."
  exit 1
fi

cd "$INFRA"
npm run build

sam local start-api \
  --template-file .aws-sam/build/template.yaml \
  --port 3001 \
  --env-vars env.local.json \
  --warm-containers LAZY
