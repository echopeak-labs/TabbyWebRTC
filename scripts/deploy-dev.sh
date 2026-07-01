#!/usr/bin/env bash
set -euo pipefail

show_help() {
  cat <<EOF
Usage: ./scripts/deploy-dev.sh

Deploy the TabbyWebRTCDev CDK stack to AWS (us-east-1).

Prerequisites:
  AWS CLI v2 with deploy credentials
  infra/.env with CLERK_JWKS_URL, TABBYWEBRTC_JWT_SECRET, TURN_SECRET, TURN_URLS, ACM_CERTIFICATE_ARN

Optional DNS update after deploy (set in infra/.env or environment):
  CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID

EOF
}

if [[ "${1:-}" == "--help" ]]; then
  show_help
  exit 0
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export AWS_REGION=us-east-1
export CDK_DEFAULT_REGION=us-east-1

if [[ -f "$ROOT/infra/.env" ]]; then
  set -a
  source "$ROOT/infra/.env"
  set +a
fi

cd "$ROOT/infra"
npm ci
npx cdk deploy TabbyWebRTCDev --require-approval never --context env=dev --outputs-file cdk-outputs.json

CF_DOMAIN=$(jq -r '.TabbyWebRTCDev.FrontendDistributionDomain // empty' cdk-outputs.json)
if [[ -n "${CLOUDFLARE_API_TOKEN:-}" && -n "${CLOUDFLARE_ZONE_ID:-}" && -n "$CF_DOMAIN" ]]; then
  TABBYWEBRTC_DNS_NAME=dev-tabbywebrtc TABBYWEBRTC_CF_DOMAIN="$CF_DOMAIN" \
    bash "$ROOT/scripts/update-cloudflare-dns.sh"
else
  echo ""
  echo "To update Cloudflare DNS for dev-tabbywebrtc.mikewheeler.dev:"
  echo "  TABBYWEBRTC_DNS_NAME=dev-tabbywebrtc TABBYWEBRTC_CF_DOMAIN=${CF_DOMAIN:-<FrontendDistributionDomain>} \\"
  echo "    CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ZONE_ID=... \\"
  echo "    bash scripts/update-cloudflare-dns.sh"
fi
