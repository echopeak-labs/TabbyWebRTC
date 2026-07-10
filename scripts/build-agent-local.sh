#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=agent-features.sh
source "$ROOT/scripts/agent-features.sh"

FEATURES="$(agent_cargo_features)"
cd "$ROOT/components/desktop-agent"
if [[ -n "$FEATURES" ]]; then
  cargo build --release -p tabbywebrtc-agent --features "$FEATURES"
else
  echo "libpipewire-0.3 not found; building without scap-capture (synthetic frames)." >&2
  echo "Install: sudo apt-get install -y libpipewire-0.3-dev libspa-0.2-dev pkg-config" >&2
  cargo build --release -p tabbywebrtc-agent
fi
