#!/usr/bin/env bash
# Stops the SWEDEN collector.
tmux kill-session -t Sweden 2>/dev/null && echo "stopped Sweden" || echo "Sweden was not running"
exit 0
