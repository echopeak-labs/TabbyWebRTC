#!/usr/bin/env bash
set -euo pipefail

show_help() {
  cat <<EOF
Usage: ./scripts/publish-agent-release.sh <version> <env>

  version  Semver tag (e.g. 1.2.3)
  env      dev | prod

Requires: aws CLI, R2 credentials in environment (R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
          R2_BUCKET, R2_ACCOUNT_ID).

Steps:
  1. Verify packaged installers exist in components/desktop-agent/packaged/
  2. Compute SHA-256 per artifact
  3. Generate manifest.json
  4. Upload artifacts to s3://{bucket}/{env}/{version}/
  5. Upload manifest to s3://{bucket}/{env}/manifest.json

EOF
}

if [[ "${1:-}" == "--help" ]]; then
  show_help
  exit 0
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${1:?Usage: ./scripts/publish-agent-release.sh <version> <env>}"
ENV="${2:?Usage: ./scripts/publish-agent-release.sh <version> <env>}"

if [[ "$ENV" != "dev" && "$ENV" != "prod" ]]; then
  echo "env must be dev or prod" >&2
  exit 1
fi

: "${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID is required}"
: "${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY is required}"
: "${R2_BUCKET:?R2_BUCKET is required}"
: "${R2_ACCOUNT_ID:?R2_ACCOUNT_ID is required}"

PACKAGED="$ROOT/components/desktop-agent/packaged"
if [[ ! -d "$PACKAGED" ]]; then
  echo "packaged directory not found: $PACKAGED" >&2
  exit 1
fi

mapfile -t INSTALLERS < <(find "$PACKAGED" -maxdepth 1 -type f \( -name '*.deb' -o -name '*.pkg' -o -name '*.msi' \) | sort)
if [[ "${#INSTALLERS[@]}" -eq 0 ]]; then
  echo "no installers found in $PACKAGED" >&2
  exit 1
fi

for installer in "${INSTALLERS[@]}"; do
  sha256sum "$installer" | awk '{print $1 "  " FILENAME}' FILENAME="$(basename "$installer")"
done

MANIFEST="$(mktemp)"
trap 'rm -f "$MANIFEST"' EXIT
"$ROOT/scripts/generate-manifest.sh" "$VERSION" "$PACKAGED" > "$MANIFEST"

export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_ENDPOINT_URL="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

for installer in "${INSTALLERS[@]}"; do
  name="$(basename "$installer")"
  aws s3 cp "$installer" "s3://${R2_BUCKET}/${ENV}/${VERSION}/${name}" --endpoint-url "$AWS_ENDPOINT_URL"
done

aws s3 cp "$MANIFEST" "s3://${R2_BUCKET}/${ENV}/manifest.json" --endpoint-url "$AWS_ENDPOINT_URL"

echo "Published ${#INSTALLERS[@]} artifact(s) and manifest to s3://${R2_BUCKET}/${ENV}/"
