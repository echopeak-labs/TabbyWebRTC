#!/usr/bin/env bash

agent_cargo_features() {
  local os
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  case "$os" in
    linux)
      if command -v pkg-config >/dev/null \
        && pkg-config --exists libpipewire-0.3 2>/dev/null; then
        printf '%s' "scap-capture"
      else
        printf '%s' ""
      fi
      ;;
    darwin|mingw*|msys*|cygwin*)
      printf '%s' "scap-capture"
      ;;
    *)
      printf '%s' ""
      ;;
  esac
}

agent_cargo_feature_args() {
  local features
  features="$(agent_cargo_features)"
  if [[ -n "$features" ]]; then
    printf -- '--features %s' "$features"
  fi
}
