#!/usr/bin/env bash
# Starts the SWEDEN collector in tmux session "Sweden". It restarts itself if it crashes.
cd "$(dirname "$0")"
DIR="$(pwd)"
PY="$DIR/venv/bin/python"
[ -x "$PY" ] || { echo "venv missing - run ./setup.sh first"; exit 1; }
mkdir -p "$DIR/logs"
if ! tmux has-session -t Sweden 2>/dev/null; then
  tmux new-session -d -s Sweden "cd '$DIR' && while true; do '$PY' -u sweden/collector.py 2>&1 | tee -a logs/collector.log; echo 'collector exited - restarting in 10s'; sleep 10; done"
  echo "started tmux session Sweden (collector). Watch it: tmux attach -t Sweden  (leave: Ctrl+B, then D)"
else
  echo "tmux session Sweden already running"
fi
