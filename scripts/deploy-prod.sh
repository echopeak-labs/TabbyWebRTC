#!/usr/bin/env bash
set -euo pipefail

show_help() {
  cat <<EOF
Usage: ./scripts/deploy-prod.sh

Deploy the TabbyRDPProd CDK stack to AWS (requires confirmation).

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

read -r -p "Deploy TabbyRDPProd to AWS production? Type 'yes' to confirm: " CONFIRM
if [[ "$CONFIRM" != "yes" ]]; then
  echo "Aborted."
  exit 1
fi

if [[ -f "$ROOT/infra/.env" ]]; then
  set -a
  source "$ROOT/infra/.env"
  set +a
fi

cd "$ROOT/infra"
npm ci
npx cdk deploy TabbyRDPProd --require-approval never --context env=prod
