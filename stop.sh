#!/usr/bin/env bash
# Stops the SWEDEN collector cleanly (it closes its data files), then ends the tmux session.
pkill -INT -f "sweden/collector.py" 2>/dev/null
for i in $(seq 1 20); do pgrep -f "python.*sweden/collector.py" >/dev/null || break; sleep 0.5; done
tmux kill-session -t Sweden 2>/dev/null && echo "stopped Sweden" || echo "Sweden was not running"
exit 0
