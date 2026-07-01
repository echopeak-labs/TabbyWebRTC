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

echo "Installing workspace dependencies..."
cd "$ROOT"
yarn install --frozen-lockfile 2>/dev/null || yarn install

echo "Building desktop agent (debug)..."
cargo build --manifest-path "$ROOT/components/desktop-agent/Cargo.toml"

echo "Copying env templates..."
cp "$ROOT/components/frontend/.env.example" "$ROOT/components/frontend/.env.local"
cp "$ROOT/components/infra/.env.example" "$ROOT/components/infra/.env"

if [[ ! -f "$ROOT/components/infra/env.local.json" ]]; then
  cp "$ROOT/scripts/env.local.json.example" "$ROOT/components/infra/env.local.json"
fi

echo "Setup complete. Edit components/frontend/.env.local and components/infra/.env before running dev servers."
