#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=dev-env.sh
source "$ROOT/scripts/dev-env.sh"

cd "$ROOT/components/testServer"
export LAN_IP
yarn start:dev
