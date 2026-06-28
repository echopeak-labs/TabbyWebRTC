#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENT="$ROOT/desktop-agent"

VERSION="$(grep '^package.version' "$AGENT/Cargo.toml" | head -1 | sed 's/.*= "\(.*\)".*/\1/')"
ARCH="$(uname -m)"
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"

case "$OS-$ARCH" in
  linux-x86_64)
    PLATFORM_KEY=linux-x86_64
    TARGET=x86_64-unknown-linux-gnu
    ;;
  linux-aarch64|linux-arm64)
    PLATFORM_KEY=linux-aarch64
    TARGET=aarch64-unknown-linux-gnu
    ;;
  darwin-x86_64)
    PLATFORM_KEY=macos-x86_64
    TARGET=x86_64-apple-darwin
    ;;
  darwin-arm64)
    PLATFORM_KEY=macos-aarch64
    TARGET=aarch64-apple-darwin
    ;;
  *)
    echo "Unsupported host for local packaging: $OS-$ARCH" >&2
    echo "Set PLATFORM_KEY and TARGET manually, then run desktop-agent/packaging/build.sh" >&2
    exit 1
    ;;
esac

cargo build --release --target "$TARGET" --manifest-path "$AGENT/Cargo.toml"

SRC="$AGENT/target/$TARGET/release/tabbyrdp-agent"
DEST="$AGENT/tabbyrdp-agent-$PLATFORM_KEY"
cp "$SRC" "$DEST"

chmod +x "$AGENT/packaging/build.sh" "$AGENT/packaging/macos/build-pkg.sh" "$AGENT/packaging/deb/postinstall.sh"
"$AGENT/packaging/build.sh" "$PLATFORM_KEY" "$VERSION"

echo "Packaged installer in $AGENT/packaged/"
