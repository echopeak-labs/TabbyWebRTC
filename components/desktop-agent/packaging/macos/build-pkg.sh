#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:?version required}"
ARCH="${2:?arch required (x86_64 or aarch64)}"
BINARY="${3:?binary path required}"
OUT_DIR="${4:?output directory required}"

PKG_ROOT="$(mktemp -d)"
trap 'rm -rf "$PKG_ROOT"' EXIT

mkdir -p "$PKG_ROOT/usr/local/bin"
cp "$BINARY" "$PKG_ROOT/usr/local/bin/tabbywebrtc-agent"
chmod 755 "$PKG_ROOT/usr/local/bin/tabbywebrtc-agent"

OUT_FILE="$OUT_DIR/tabbywebrtc-agent_${VERSION}_${ARCH}.pkg"
pkgbuild \
  --root "$PKG_ROOT" \
  --identifier com.tabbywebrtc.agent \
  --version "$VERSION" \
  --install-location / \
  "$OUT_FILE"
