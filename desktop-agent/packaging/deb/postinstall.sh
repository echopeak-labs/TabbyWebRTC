#!/bin/sh
set -e
systemctl daemon-reload
systemctl enable tabbywebrtc-agent.service
systemctl restart tabbywebrtc-agent.service 2>/dev/null || true
