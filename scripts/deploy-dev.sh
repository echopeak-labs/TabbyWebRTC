#!/usr/bin/env bash
set -euo pipefail

show_help() {
  cat <<EOF
Usage: ./scripts/deploy-dev.sh

Deploy the TabbyRDPDev CDK stack to AWS.

Prerequisites:
  AWS CLI v2 with deploy credentials
  infra/.env with CLERK_JWKS_URL, TABBYRDP_JWT_SECRET, TURN_SECRET, TURN_URLS

EOF
}

if [[ "${1:-}" == "--help" ]]; then
  show_help
  exit 0
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "$ROOT/infra/.env" ]]; then
  set -a
  source "$ROOT/infra/.env"
  set +a
fi

cd "$ROOT/infra"
npm ci
npx cdk deploy TabbyRDPDev --require-approval never --context env=dev
