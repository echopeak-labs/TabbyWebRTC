#!/usr/bin/env bash
set -euo pipefail

show_help() {
  cat <<EOF
Usage: ./scripts/release.sh <version>

Tag a semantic version and push to origin to trigger the desktop-agent release workflow.

Example:
  ./scripts/release.sh v1.0.0

Prerequisites:
  git with push access to origin

EOF
}

if [[ "${1:-}" == "--help" ]]; then
  show_help
  exit 0
fi

VERSION=${1:?Usage: ./scripts/release.sh <version> e.g. v1.0.0}

git tag -a "$VERSION" -m "Release $VERSION"
git push origin "$VERSION"

echo "Release tag $VERSION pushed. Monitor the 'Build Desktop Agent' workflow for binaries."
