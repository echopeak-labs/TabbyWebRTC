#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=dev-env.sh
source "$ROOT/scripts/dev-env.sh"

AGENT_CONFIG="$(mktemp /tmp/tabbywebrtc-agent-dev-XXXXXX.toml)"
trap 'rm -f "$AGENT_CONFIG"' EXIT INT TERM

cat >"$AGENT_CONFIG" <<EOF
[agent]
id = "dev-local-agent"
name = "TabbyWebRTC Dev Agent"

[signaling]
url = "${WS_URL}"

[capture]
encoder = "auto"
max_fps = 60
hide_cursor = true

[http]
thumbnail_port = 7700
bind = "0.0.0.0"
EOF

cd "$ROOT/components/desktop-agent"
cargo run -- --config "$AGENT_CONFIG"
