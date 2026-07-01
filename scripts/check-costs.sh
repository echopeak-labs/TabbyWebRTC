#!/usr/bin/env bash
set -euo pipefail

show_help() {
  cat <<EOF
Usage: ./scripts/check-costs.sh

Query AWS Cost Explorer for current-month spend tagged project=tabbywebrtc.

Prerequisites:
  AWS CLI v2 with ce:GetCostAndUsage permission

EOF
}

if [[ "${1:-}" == "--help" ]]; then
  show_help
  exit 0
fi

START=$(date -d "$(date +%Y-%m-01)" +%Y-%m-%d 2>/dev/null || date -v1d +%Y-%m-%d)
END=$(date +%Y-%m-%d)

aws ce get-cost-and-usage \
  --time-period "Start=$START,End=$END" \
  --granularity MONTHLY \
    --metrics UnblendedCost \
  --filter '{"Tags":{"Key":"project","Values":["tabbywebrtc"]}}' \
  --query 'ResultsByTime[0].Total.UnblendedCost' \
  --output table
