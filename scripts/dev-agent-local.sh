#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=dev-env.sh
source "$ROOT/scripts/dev-env.sh"
# shellcheck source=agent-features.sh
source "$ROOT/scripts/agent-features.sh"

if [[ -e /dev/uinput && ! -w /dev/uinput ]]; then
  if getent group input >/dev/null \
    && id -nG "$USER" 2>/dev/null | tr ' ' '\n' | grep -qx input \
    && ! id -nG | tr ' ' '\n' | grep -qx input; then
    echo "WARNING: /dev/uinput not writable in this session." >&2
    echo "  You are in the input group, but this desktop session started before that." >&2
    echo "  Log out of the desktop session and back in, then restart the agent." >&2
    echo "  Do not use 'sg input' — it breaks the PipeWire portal (black screen)." >&2
  else
    echo "WARNING: /dev/uinput is not writable; remote mouse/keyboard will be disabled." >&2
    echo "  Fix: sudo usermod -aG input \"\$USER\" && log out/in" >&2
  fi
fi

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
max_fps = 30
max_width = 0
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
