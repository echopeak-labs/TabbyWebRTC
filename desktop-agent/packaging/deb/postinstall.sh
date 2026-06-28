#!/bin/sh
set -e
systemctl daemon-reload
systemctl enable tabbyrdp-agent.service
systemctl restart tabbyrdp-agent.service 2>/dev/null || true
