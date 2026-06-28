#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:?version required}"
ARTIFACTS_DIR="${2:?artifacts directory required}"

if [[ ! -d "$ARTIFACTS_DIR" ]]; then
  echo "artifacts directory not found: $ARTIFACTS_DIR" >&2
  exit 1
fi

mapfile -t INSTALLERS < <(find "$ARTIFACTS_DIR" -type f \( -name '*.deb' -o -name '*.pkg' -o -name '*.msi' \) | sort)

if [[ "${#INSTALLERS[@]}" -eq 0 ]]; then
  echo "no installer artifacts found under $ARTIFACTS_DIR" >&2
  exit 1
fi

platform_for() {
  local file="$1"
  local base
  base="$(basename "$file")"
  case "$base" in
    *_amd64.deb) echo "linux-x86_64" ;;
    *_arm64.deb) echo "linux-aarch64" ;;
    *_x86_64.pkg) echo "macos-x86_64" ;;
    *_aarch64.pkg) echo "macos-aarch64" ;;
    *_x86_64.msi) echo "windows-x86_64" ;;
    *) return 1 ;;
  esac
}

PUBLISHED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

artifact_entries=()
for installer in "${INSTALLERS[@]}"; do
  platform="$(platform_for "$installer")" || continue
  filename="$(basename "$installer")"
  sha256="$(sha256sum "$installer" | awk '{print $1}')"
  size_bytes="$(wc -c < "$installer" | tr -d ' ')"
  artifact_entries+=("$(printf '%s' "$platform|$filename|$sha256|$size_bytes")")
done

if [[ "${#artifact_entries[@]}" -eq 0 ]]; then
  echo "no recognized installer filenames under $ARTIFACTS_DIR" >&2
  exit 1
fi

IFS=$'\n' sorted_entries=($(printf '%s\n' "${artifact_entries[@]}" | sort))
unset IFS

{
  printf '{\n'
  printf '  "schema_version": 1,\n'
  printf '  "version": "%s",\n' "$VERSION"
  printf '  "published_at": "%s",\n' "$PUBLISHED_AT"
  printf '  "artifacts": {\n'
  for i in "${!sorted_entries[@]}"; do
    IFS='|' read -r platform filename sha256 size_bytes <<< "${sorted_entries[$i]}"
    printf '    "%s": {\n' "$platform"
    printf '      "filename": "%s",\n' "$filename"
    printf '      "sha256": "%s",\n' "$sha256"
    printf '      "size_bytes": %s\n' "$size_bytes"
    if [[ "$i" -lt "$((${#sorted_entries[@]} - 1))" ]]; then
      printf '    },\n'
    else
      printf '    }\n'
    fi
  done
  printf '  }\n'
  printf '}\n'
}
