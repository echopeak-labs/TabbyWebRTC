#!/usr/bin/env bash
set -euo pipefail

PLATFORM_KEY="${1:?platform_key required}"
VERSION="${2:?version required}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PACKAGED="$ROOT/packaged"
STAGING="$ROOT/packaging/staging"

mkdir -p "$PACKAGED"
rm -rf "$STAGING"
mkdir -p "$STAGING"

case "$PLATFORM_KEY" in
  linux-x86_64)
    BIN="$ROOT/tabbyrdp-agent-linux-x86_64"
    DEB_ARCH=amd64
  ;;
  linux-aarch64)
    BIN="$ROOT/tabbyrdp-agent-linux-aarch64"
    DEB_ARCH=arm64
  ;;
  macos-x86_64)
    BIN="$ROOT/tabbyrdp-agent-macos-x86_64"
    PKG_ARCH=x86_64
  ;;
  macos-aarch64)
    BIN="$ROOT/tabbyrdp-agent-macos-aarch64"
    PKG_ARCH=aarch64
  ;;
  windows-x86_64)
    BIN="$ROOT/tabbyrdp-agent-windows-x86_64.exe"
    MSI_ARCH=x86_64
  ;;
  *)
    echo "unknown platform_key: $PLATFORM_KEY" >&2
    exit 1
  ;;
esac

if [[ ! -f "$BIN" ]]; then
  echo "binary not found: $BIN" >&2
  exit 1
fi

case "$PLATFORM_KEY" in
  linux-*)
    cp "$BIN" "$STAGING/tabbyrdp-agent"
    chmod 755 "$STAGING/tabbyrdp-agent"
    cp "$ROOT/packaging/deb/tabbyrdp-agent.service" "$STAGING/tabbyrdp-agent.service"
    cp "$ROOT/packaging/deb/postinstall.sh" "$STAGING/postinstall.sh"
    chmod 755 "$STAGING/postinstall.sh"
    export VERSION DEB_ARCH
    envsubst < "$ROOT/packaging/deb/nfpm.yaml" > "$STAGING/nfpm.yaml"
    sed -i 's|packaging/deb/postinstall.sh|./postinstall.sh|' "$STAGING/nfpm.yaml"
    (
      cd "$STAGING"
      nfpm pkg --packager deb --config nfpm.yaml --target "$PACKAGED"
    )
    built="$(ls -1 "$PACKAGED"/tabbyrdp-agent_"${VERSION}"_"${DEB_ARCH}".deb 2>/dev/null | head -1)"
    if [[ -z "$built" ]]; then
      built="$(ls -1 "$PACKAGED"/*.deb | head -1)"
      mv "$built" "$PACKAGED/tabbyrdp-agent_${VERSION}_${DEB_ARCH}.deb"
    fi
  ;;
  macos-*)
    "$ROOT/packaging/macos/build-pkg.sh" "$VERSION" "$PKG_ARCH" "$BIN" "$PACKAGED"
  ;;
  windows-x86_64)
    WIX_DIR="$STAGING/wix"
    mkdir -p "$WIX_DIR"
    cp "$ROOT/packaging/wix/main.wxs" "$WIX_DIR/main.wxs"
    MSI_OUT="$PACKAGED/tabbyrdp-agent_${VERSION}_${MSI_ARCH}.msi"
    WIX_VERSION="${VERSION}.0"
    if [[ "$WIX_VERSION" =~ ^([0-9]+\.[0-9]+\.[0-9]+)\.[0-9]+$ ]]; then
      :
    elif [[ "$WIX_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      WIX_VERSION="${WIX_VERSION}.0"
    else
      WIX_VERSION="0.0.1.0"
    fi
    candle -nologo -arch x64 \
      -dVersion="$WIX_VERSION" \
      -dAgentBinary="$BIN" \
      -out "$WIX_DIR/main.wixobj" \
      "$WIX_DIR/main.wxs"
    light -nologo \
      -out "$MSI_OUT" \
      "$WIX_DIR/main.wixobj"
  ;;
esac

rm -rf "$STAGING"
