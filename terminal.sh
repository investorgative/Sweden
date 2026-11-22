#!/usr/bin/env bash
# Starts (or restarts) the SWEDEN terminal (port 8750) and a Cloudflare quick tunnel to it, in tmux session
# "SwedenTerminal". The tunnel gives an https://….trycloudflare.com link that opens from anywhere; it changes on every
# restart (shown at the end of this script and in logs/tunnel.log). The page asks for a passkey: set your own with
#   echo '<your passkey>' > terminal_passkey && chmod 600 terminal_passkey && ./terminal.sh
# (at least 6 characters; without one, the first start generates 8 digits into that file).
# Push alerts to your phone: SWEDEN_NTFY_TOPIC=<secret topic> ./terminal.sh   (ntfy app, subscribe to that topic)
cd "$(dirname "$0")"
DIR="$(pwd)"
PY="$DIR/venv/bin/python"
[ -x "$PY" ] || { echo "venv missing - run ./setup.sh first"; exit 1; }
mkdir -p "$DIR/logs"
tmux kill-session -t =SwedenTerminal 2>/dev/null
: > logs/tunnel.log
tmux new-session -d -s SwedenTerminal "cd '$DIR' && while true; do SWEDEN_NTFY_TOPIC='${SWEDEN_NTFY_TOPIC:-}' '$PY' -u sweden/terminal.py $* 2>&1 | tee -a logs/terminal.log; echo 'terminal exited - restarting in 10s'; sleep 10; done"
tmux new-window -t SwedenTerminal "cd '$DIR' && while true; do cloudflared tunnel --no-autoupdate --url http://localhost:8750 2>&1 | tee -a logs/tunnel.log; sleep 10; done"
for i in $(seq 1 30); do
  URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' logs/tunnel.log | tail -1)
  [ -n "$URL" ] && break; sleep 1
done
echo "terminal: http://$(hostname -I | awk '{print $1}'):8750 (home network)   ${URL:-tunnel link not ready yet - see logs/tunnel.log}"
echo "passkey: in $DIR/terminal_passkey (cat it on the Pi)"
echo "stop: tmux kill-session -t SwedenTerminal"
