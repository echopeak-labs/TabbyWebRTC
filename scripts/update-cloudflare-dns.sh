#!/usr/bin/env bash
set -euo pipefail

: "${CLOUDFLARE_API_TOKEN:?}"
: "${CLOUDFLARE_ZONE_ID:?}"
: "${TABBYWEBRTC_CF_DOMAIN:?}"

ROOT_DOMAIN="${ROOT_DOMAIN:-mikewheeler.dev}"
TABBYWEBRTC_DNS_NAME="${TABBYWEBRTC_DNS_NAME:?}"

fqdn_in_zone() {
  local n="$1"
  if [ "$n" = "$ROOT_DOMAIN" ] || [[ "$n" == *."$ROOT_DOMAIN" ]]; then
    printf '%s' "$n"
  else
    printf '%s.%s' "$n" "$ROOT_DOMAIN"
  fi
}

upsert_cname() {
  local record_name="$1"
  local target="$2"
  local fqdn
  fqdn=$(fqdn_in_zone "$record_name")
  local enc
  enc=$(jq -rn --arg x "$fqdn" '$x|@uri')
  local existing
  existing=$(curl -s -X GET \
    "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records?type=CNAME&name=${enc}" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json")
  local record_id
  record_id=$(echo "$existing" | jq -r '.result[0].id // empty')
  local payload
  payload=$(jq -n \
    --arg type "CNAME" \
    --arg name "$fqdn" \
    --arg content "$target" \
    '{type:$type,name:$name,content:$content,ttl:1,proxied:false}')
  local resp
  if [ -n "$record_id" ]; then
    resp=$(curl -s -X PUT \
      "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${record_id}" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "$payload")
  else
    resp=$(curl -s -X POST \
      "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "$payload")
  fi
  echo "$resp" | jq -e '.success == true' >/dev/null || {
    echo "$resp" >&2
    exit 1
  }
}

upsert_cname "$TABBYWEBRTC_DNS_NAME" "$TABBYWEBRTC_CF_DOMAIN"
echo "Updated CNAME $(fqdn_in_zone "$TABBYWEBRTC_DNS_NAME") -> ${TABBYWEBRTC_CF_DOMAIN}"
