#!/usr/bin/env bash
# Shows what the collector has gathered so far.
cd "$(dirname "$0")"
PY=./venv/bin/python; [ -x "$PY" ] || PY=python3
tmux has-session -t =Sweden 2>/dev/null && echo "collector: RUNNING" || echo "collector: NOT running (./start.sh)"
"$PY" - <<'PY'
import json, os, time
p = "data/status.json"
if not os.path.exists(p):
    print("no status yet"); raise SystemExit
s = json.load(open(p))
age = time.time() - s["updated"]
print(f"last update {age:.0f} s ago | uptime {s['uptime_s'] / 3600:.1f} h | connections live {s['live_connections']}")
print(f"launches recorded {s.get('stored_C', 0)} | trades {s.get('stored_T', 0)} | graduations {s.get('stored_G', 0)}")
print(f"PumpSwap: pools {s.get('stored_P', 0)} | swaps {s.get('stored_S', 0)} | connections live {s.get('live_swap_connections', 0)} | gaps {s.get('gap_swap_s', 0)} s")
print(f"gaps {s.get('gap_s', 0)} s | reconnects {s.get('drops', 0)}")
PY
du -sh data 2>/dev/null | awk '{print "data on disk: "$1}'
