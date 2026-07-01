#!/usr/bin/env bash
set -euo pipefail

show_help() {
  cat <<EOF
Usage: ./scripts/rotate-secrets.sh

Generate a new TABBYWEBRTC_JWT_SECRET and update the GitHub repository secret.

Prerequisites:
  GitHub CLI (gh) authenticated with admin access to this repo
  openssl

After rotation, redeploy the backend stack for Lambda to pick up the new secret.

EOF
}

if [[ "${1:-}" == "--help" ]]; then
  show_help
  exit 0
fi

command -v gh >/dev/null || { echo "GitHub CLI (gh) required"; exit 1; }
command -v openssl >/dev/null || { echo "openssl required"; exit 1; }

NEW_SECRET=$(openssl rand -base64 32)

gh secret set TABBYWEBRTC_JWT_SECRET --body "$NEW_SECRET"

echo "TABBYWEBRTC_JWT_SECRET rotated in GitHub Secrets."
echo "Redeploy backend (merge to main or run deploy-prod) for the change to take effect."
