#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=dev-env.sh
source "$ROOT/scripts/dev-env.sh"
# shellcheck source=agent-features.sh
source "$ROOT/scripts/agent-features.sh"

AGENT_CONFIG_DIR="$ROOT/.local"
AGENT_CONFIG="$AGENT_CONFIG_DIR/agent-dev.toml"
mkdir -p "$AGENT_CONFIG_DIR"

cat >"$AGENT_CONFIG" <<CFG
[agent]
id = "dev-local-agent"
name = "TabbyWebRTC Dev Agent"

[signaling]
url = "${WS_URL}"
api_url = "${REST_URL}"

[capture]
encoder = "auto"
max_fps = 60
hide_cursor = true

[http]
thumbnail_port = 7700
bind = "0.0.0.0"

[input]
enabled = true
allow_remote_power = false

[updates]
enabled = false
base_url = "${REST_URL}"
channel = "dev"

[session_crypto]
required = false
CFG

FEATURES="$(agent_cargo_features)"
cd "$ROOT/components/desktop-agent"
if [[ -n "$FEATURES" ]]; then
  cargo run -p tabbywebrtc-agent --features "$FEATURES" -- --config "$AGENT_CONFIG"
else
  echo "libpipewire-0.3 not found; running without scap-capture (synthetic frames)." >&2
  echo "Install: sudo apt-get install -y libpipewire-0.3-dev libspa-0.2-dev pkg-config" >&2
  cargo run -p tabbywebrtc-agent -- --config "$AGENT_CONFIG"
fi
