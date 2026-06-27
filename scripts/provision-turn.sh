#!/usr/bin/env bash
set -euo pipefail

show_help() {
  cat <<EOF
Usage: ./scripts/provision-turn.sh

Provision CoTURN on a Hetzner VPS via SSH.

Required environment variables:
  TARGET_IP    VPS public IP
  TURN_SECRET  static auth secret for coturn

Optional:
  TURN_DOMAIN  realm (default: turn.tabbyrdp.com)

Prerequisites:
  SSH access to root@TARGET_IP

EOF
}

if [[ "${1:-}" == "--help" ]]; then
  show_help
  exit 0
fi

TARGET_IP=${TARGET_IP:?Must set TARGET_IP}
TURN_SECRET=${TURN_SECRET:?Must set TURN_SECRET}
TURN_DOMAIN=${TURN_DOMAIN:-turn.tabbyrdp.com}

ssh root@"$TARGET_IP" bash -s << REMOTE
set -euo pipefail
apt-get update -qq
apt-get install -y coturn certbot

cat > /etc/turnserver.conf << CONF
listening-port=3478
tls-listening-port=5349
fingerprint
use-auth-secret
static-auth-secret=${TURN_SECRET}
realm=${TURN_DOMAIN}
total-quota=200
max-bps=1000000
log-file=/var/log/coturn/turnserver.log
no-stdout-log
no-multicast-peers
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
CONF

systemctl enable coturn
systemctl restart coturn
echo "CoTURN provisioned successfully"
REMOTE
