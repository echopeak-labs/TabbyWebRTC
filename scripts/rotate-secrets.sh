#!/usr/bin/env bash
set -euo pipefail

show_help() {
  cat <<EOF
Usage: ./scripts/rotate-secrets.sh [--env dev|prod]

Generate a new TABBYWEBRTC_JWT_SECRET, update the GitHub repository secret,
and update the AWS Secrets Manager secret used by Lambda (APP_SECRET_ARN).

Prerequisites:
  GitHub CLI (gh) authenticated with admin access to this repo
  AWS CLI configured for the target account
  openssl
  jq

After rotation, redeploy is not required for JWT secret if Lambdas load from
Secrets Manager at cold start; force a new Lambda version/alias refresh if
in-memory caches are sticky.

EOF
}

ENV_NAME="dev"
if [[ "${1:-}" == "--help" ]]; then
  show_help
  exit 0
fi
if [[ "${1:-}" == "--env" ]]; then
  ENV_NAME="${2:-dev}"
fi

command -v gh >/dev/null || { echo "GitHub CLI (gh) required"; exit 1; }
command -v openssl >/dev/null || { echo "openssl required"; exit 1; }
command -v aws >/dev/null || { echo "AWS CLI required"; exit 1; }
command -v jq >/dev/null || { echo "jq required"; exit 1; }

NEW_SECRET=$(openssl rand -base64 32)
SECRET_ID="tabbywebrtc/${ENV_NAME}/app"

gh secret set TABBYWEBRTC_JWT_SECRET --body "$NEW_SECRET"

CURRENT=$(aws secretsmanager get-secret-value --secret-id "$SECRET_ID" --query SecretString --output text)
UPDATED=$(echo "$CURRENT" | jq --arg v "$NEW_SECRET" '.TABBYWEBRTC_JWT_SECRET=$v')
aws secretsmanager put-secret-value --secret-id "$SECRET_ID" --secret-string "$UPDATED" >/dev/null

echo "TABBYWEBRTC_JWT_SECRET rotated in GitHub Secrets and AWS Secrets Manager ($SECRET_ID)."
echo "Redeploy backend if Lambda env still embeds plaintext secrets from an older stack."
