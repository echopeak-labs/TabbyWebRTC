#!/usr/bin/env bash
set -euo pipefail

show_help() {
  cat <<EOF
Usage: ./scripts/setup-dev.sh

One-time local dev environment setup.

Prerequisites:
  Node.js 22+
  Rust stable toolchain
  AWS CLI v2

EOF
}

if [[ "${1:-}" == "--help" ]]; then
  show_help
  exit 0
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

command -v node >/dev/null || { echo "Node.js 22+ required"; exit 1; }
command -v cargo >/dev/null || { echo "Rust stable toolchain required"; exit 1; }
command -v aws >/dev/null || { echo "AWS CLI v2 required"; exit 1; }

echo "Installing frontend deps..."
npm ci --prefix "$ROOT/frontend"

echo "Installing infra deps..."
npm ci --prefix "$ROOT/infra"

echo "Building desktop agent (debug)..."
cargo build --manifest-path "$ROOT/desktop-agent/Cargo.toml"

echo "Copying env templates..."
cp "$ROOT/frontend/.env.example" "$ROOT/frontend/.env.local"
cp "$ROOT/infra/.env.example" "$ROOT/infra/.env"

if [[ ! -f "$ROOT/infra/env.local.json" ]]; then
  cp "$ROOT/scripts/env.local.json.example" "$ROOT/infra/env.local.json"
fi

echo "Setup complete. Edit frontend/.env.local and infra/.env before running dev servers."
