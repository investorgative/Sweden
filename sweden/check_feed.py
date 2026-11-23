"""Measures how complete the free live feed is on THIS machine (run it on the Pi before collecting for days).

Listens to the same feed as the collector for --seconds, then fetches the real list of pump.fun transactions for a
40-second window from the chain and prints which share of successful transactions the feed delivered.
The collector is only useful if the combined coverage is close to 100 %. Stop the collector while this runs.

Usage:  python3 sweden/check_feed.py [--seconds 90]
"""
import argparse, asyncio, collections, json, os, sys, time

sys.path.insert(0, os.path.dirname(__file__))
import websockets
import rpc
from collector import ENDPOINTS
from pump_events import PUMP

SUB = {"jsonrpc": "2.0", "id": 1, "method": "logsSubscribe", "params": [{"mentions": [PUMP]}, {"commitment": "confirmed"}]}

got = collections.defaultdict(set)
drops = collections.Counter()


async def conn(cid, url, until):
    await asyncio.sleep(cid * 2)
    while time.time() < until:
        try:
            async with websockets.connect(url, max_size=2 ** 24, open_timeout=15) as ws:
                await ws.send(json.dumps(SUB)); await ws.recv()
                while time.time() < until:
                    raw = await asyncio.wait_for(ws.recv(), 10)
                    i = raw.find('"signature":"')
                    if i >= 0:
                        got[raw[i + 13:raw.find('"', i + 13)]].add(cid)
        except Exception:
            drops[cid] += 1
            await asyncio.sleep(0.5)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--seconds", type=int, default=90)
    a = ap.parse_args()
    print(f"listening on {len(ENDPOINTS)} connection(s) for {a.seconds} s …", flush=True)
    until = time.time() + a.seconds

    async def run():
        await asyncio.gather(*(conn(i, u, until) for i, u in enumerate(ENDPOINTS)))
    asyncio.run(run())
    head = rpc.signatures(PUMP, limit=1)
    if not head:
        print("could not reach RPC for the check"); return
    hi = head[0]["slot"] - 40                     # stay away from the newest, still-arriving slots
    lo = hi - 100
    truth, before = {}, None
    for _ in range(150):
        page = rpc.signatures(PUMP, before=before)
        if not page:
            break
        for s in page:
            if lo <= s["slot"] <= hi and s["err"] is None:
                truth[s["signature"]] = s["slot"]
        before = page[-1]["signature"]
        if page[-1]["slot"] < lo:
            break
    if not truth:
        print("no reference transactions found (window too old?) — run again"); return
    print(f"reference: {len(truth)} successful pump.fun transactions in slots {lo}-{hi} (~40 s)")
    for cid in range(len(ENDPOINTS)):
        n = sum(1 for s in truth if cid in got.get(s, ()))
        print(f"  connection {cid}: {n / len(truth):.1%}  (reconnects {drops[cid]})")
    n = sum(1 for s in truth if s in got)
    print(f"COMBINED COVERAGE: {n / len(truth):.1%}  → "
          + ("good, start the collector" if n / len(truth) >= 0.98 else
             "too low: results would be unreliable. Send me this output."))


if __name__ == "__main__":
    main()
