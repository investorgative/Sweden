"""How complete would the live feed be through Helius (free key)? Same method as check_feed.py: listen for --seconds,
then compare with the chain's full list of successful pump.fun transactions in a ~40 s window.

Uses only Helius connections (does not add load on the free endpoint the collector uses), so it can run next to the
collector.  Usage: python3 sweden/feed_test_helius.py [--seconds 120] [--conns 2]
"""
import argparse, asyncio, collections, json, os, sys, time, urllib.request

sys.path.insert(0, os.path.dirname(__file__))
import websockets
from pump_events import PUMP

KEY = open(os.environ.get("SWEDEN_HELIUS_KEY_FILE") or os.path.join(os.path.dirname(__file__), "..", "helius_key")).read().strip()
WS = f"wss://mainnet.helius-rpc.com/?api-key={KEY}"
RPC = f"https://mainnet.helius-rpc.com/?api-key={KEY}"
got = collections.defaultdict(set)
drops = collections.Counter()


def rpc(method, params):
    req = urllib.request.Request(RPC, json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(),
                                 {"content-type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=30))["result"]


async def conn(cid, until):
    await asyncio.sleep(cid * 2)
    while time.time() < until:
        try:
            async with websockets.connect(WS, max_size=2 ** 24, open_timeout=15, ping_interval=20) as ws:
                await ws.send(json.dumps({"jsonrpc": "2.0", "id": 1, "method": "logsSubscribe",
                                          "params": [{"mentions": [PUMP]}, {"commitment": "confirmed"}]}))
                await ws.recv()
                while time.time() < until:
                    raw = await asyncio.wait_for(ws.recv(), 15)
                    i = raw.find('"signature":"')
                    if i >= 0:
                        got[raw[i + 13:raw.find('"', i + 13)]].add(cid)
        except Exception as e:
            drops[cid] += 1
            await asyncio.sleep(0.5)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--seconds", type=int, default=120); ap.add_argument("--conns", type=int, default=2)
    ap.add_argument("--why", action="store_true", help="show what kind of transactions are missing")
    a = ap.parse_args()
    print(f"listening on {a.conns} Helius connection(s) for {a.seconds} s …", flush=True)
    until = time.time() + a.seconds

    async def run():
        await asyncio.gather(*(conn(i, until) for i in range(a.conns)))
    asyncio.run(run())
    head = rpc("getSignaturesForAddress", [PUMP, {"limit": 1}])
    hi = head[0]["slot"] - 40
    lo = hi - 100
    truth, before = {}, None
    for _ in range(200):
        page = rpc("getSignaturesForAddress", [PUMP, {"limit": 1000, **({"before": before} if before else {})}])
        if not page:
            break
        for s in page:
            if lo <= s["slot"] <= hi and s["err"] is None:
                truth[s["signature"]] = s["slot"]
        before = page[-1]["signature"]
        if page[-1]["slot"] < lo:
            break
    print(f"reference: {len(truth)} successful pump.fun transactions in slots {lo}-{hi} (~40 s)")
    for cid in range(a.conns):
        n = sum(1 for s in truth if cid in got.get(s, ()))
        print(f"  connection {cid}: {n / max(1, len(truth)):.1%}  (reconnects {drops[cid]})")
    n = sum(1 for s in truth if s in got)
    print(f"COMBINED HELIUS COVERAGE: {n / max(1, len(truth)):.1%}  (the free feed measured 65-74 % on this Pi / in the sandbox)")
    missing = [sg for sg in truth if sg not in got]
    if missing and "--why" in sys.argv:                  # what kind of transactions are missing?
        import collections as C
        kinds = C.Counter()
        for sg in missing[:25]:
            try:
                tx = rpc("getTransaction", [sg, {"encoding": "json", "maxSupportedTransactionVersion": 1, "commitment": "confirmed"}])
            except KeyError:
                req = urllib.request.Request(RPC, json.dumps({"jsonrpc": "2.0", "id": 1, "method": "getTransaction", "params": [sg, {"maxSupportedTransactionVersion": 0}]}).encode(),
                                             {"content-type": "application/json"})
                print("  getTransaction error:", json.load(urllib.request.urlopen(req, timeout=30)).get("error"))
                break
            time.sleep(0.3)
            logs = (tx or {}).get("meta", {}).get("logMessages") or []
            pump_logs = [l for l in logs if PUMP in l]
            instr = [l.split("Instruction: ")[1] for l in logs if "Instruction: " in l]
            kinds[("pump in logs" if pump_logs else "pump NOT in logs") + " | " + ",".join(sorted(set(instr))[:3])] += 1
        for k, v in kinds.most_common():
            print(f"  missing sample: {v:2d} x {k}")


if __name__ == "__main__":
    main()
