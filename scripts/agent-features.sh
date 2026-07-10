#!/usr/bin/env bash

agent_cargo_features() {
  local os
  local features=()
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  case "$os" in
    linux)
      if command -v pkg-config >/dev/null \
        && pkg-config --exists libpipewire-0.3 2>/dev/null; then
        features+=("scap-capture")
      fi
      if command -v pkg-config >/dev/null \
        && pkg-config --exists libavcodec libavutil libswscale 2>/dev/null; then
        features+=("hardware-encode")
      fi
      ;;
    darwin|mingw*|msys*|cygwin*)
      features+=("scap-capture")
      if command -v pkg-config >/dev/null \
        && pkg-config --exists libavcodec libavutil libswscale 2>/dev/null; then
        features+=("hardware-encode")
      fi
      ;;
    *)
      ;;
  esac
  if ((${#features[@]} > 0)); then
    local IFS=,
    printf '%s' "${features[*]}"
  fi
}

agent_cargo_feature_args() {
  local features
  features="$(agent_cargo_features)"
  if [[ -n "$features" ]]; then
    printf -- '--features %s' "$features"
  fi
}
