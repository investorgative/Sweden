"""SWEDEN collector — records every pump.fun coin from its launch, for days, from free public RPC.

Stores raw events (not verdicts), so any filter / entry delay / TP / SL can be replayed later:
  data/YYYY-MM-DD/events-HH.jsonl.gz   one JSON list per event: [slot, sig8, <record from pump_events.decode>]
  data/gaps.jsonl                      seconds in which no connection was receiving (coins overlapping a gap
                                       are excluded by the replay)
  data/status.json                     live counters (updated every 30 s)

Only trades of coins whose launch was seen by this collector are stored (that is what the research needs and
keeps the files small). Four overlapping websocket connections are used because the free endpoint drops a
connection every 15-30 s; 4 staggered connections leave almost no gap; events are de-duplicated by transaction signature.

Run:  python3 sweden/collector.py            (Ctrl+C to stop; safe to restart, it continues where it was)
Env:  SWEDEN_WS   comma-separated websocket endpoints (default: api.mainnet-beta.solana.com x4)
      SWEDEN_DATA data directory (default ./data)
"""
import asyncio, collections, gzip, json, os, signal, sys, time

sys.path.insert(0, os.path.dirname(__file__))
import websockets
from pump_events import PUMP, decode, pump_data_lines

ENDPOINTS = [e.strip() for e in os.environ.get(
    "SWEDEN_WS", ",".join(["wss://api.mainnet-beta.solana.com"] * 4)).split(",") if e.strip()]
DATA = os.environ.get("SWEDEN_DATA", os.path.join(os.path.dirname(__file__), "..", "data"))
KEEP_MINT_DAYS = 3                   # keep recording trades of a coin for this long after its launch
SUB = {"jsonrpc": "2.0", "id": 1, "method": "logsSubscribe",
       "params": [{"mentions": [PUMP]}, {"commitment": "confirmed"}]}


def log(*a):
    print(time.strftime("%Y-%m-%d %H:%M:%S"), *a, flush=True)


class Store:
    def __init__(self):
        os.makedirs(DATA, exist_ok=True)
        self.f, self.key, self.last_flush = None, None, 0
        self.mints = {}                                  # mint -> launch ts
        self._load_mints()

    def _load_mints(self):
        p = os.path.join(DATA, "mints.tsv")
        if os.path.exists(p):
            cut = time.time() - KEEP_MINT_DAYS * 86400
            for line in open(p):
                m, ts = line.split()
                if int(ts) >= cut:
                    self.mints[m] = int(ts)
        self.mint_file = open(p, "a")
        log(f"tracking {len(self.mints)} coins from earlier runs")

    def _file(self):
        key = time.strftime("%Y-%m-%d/events-%H", time.gmtime())
        if key != self.key:
            if self.f:
                self.f.close()
            os.makedirs(os.path.join(DATA, key.split("/")[0]), exist_ok=True)
            self.f = gzip.open(os.path.join(DATA, key + ".jsonl.gz"), "at", compresslevel=6)
            self.key = key
        return self.f

    def write(self, slot, sig, rec):
        kind, mint = rec[0], rec[2]
        if kind == "C":
            self.mints[mint] = rec[1]
            self.mint_file.write(f"{mint}\t{rec[1]}\n")
        elif mint not in self.mints:
            return False
        self._file().write(json.dumps([slot, sig[:8]] + rec, separators=(",", ":")) + "\n")
        return True

    def tick(self):
        now = time.time()
        if now - self.last_flush > 5:
            if self.f:
                self.f.flush()
            self.mint_file.flush()
            self.last_flush = now
        if len(self.mints) > 200000 or int(now) % 3600 == 0:
            cut = now - KEEP_MINT_DAYS * 86400
            self.mints = {m: t for m, t in self.mints.items() if t >= cut}

    def close(self):
        if self.f:
            self.f.close()
        self.mint_file.close()


class Collector:
    def __init__(self):
        self.store = Store()
        self.seen = collections.OrderedDict()
        self.live = {}                                   # conn id -> last message time
        self.c = collections.Counter()
        self.started = time.time()
        self.gap_start = None
        self.last_msg = 0.0
        self.stop = False

    def handle(self, cid, raw):
        self.live[cid] = self.last_msg = time.time()
        self.c["bytes"] += len(raw)
        msg = json.loads(raw)
        if msg.get("method") != "logsNotification":
            return
        res = msg["params"]["result"]
        v = res["value"]
        sig = v["signature"]
        if sig in self.seen:
            self.c["dup"] += 1
            return
        self.seen[sig] = None
        if len(self.seen) > 400000:
            for _ in range(100000):
                self.seen.popitem(last=False)
        self.c["tx"] += 1
        if v["err"] is not None:
            self.c["failed"] += 1
            return
        for payload in pump_data_lines(v["logs"]):
            rec = decode(payload)
            if rec is None:
                continue
            self.c["ev_" + rec[0]] += 1
            if self.store.write(res["context"]["slot"], sig, rec):
                self.c["stored_" + rec[0]] += 1

    async def conn(self, cid, url, delay):
        await asyncio.sleep(delay)
        backoff = 1
        while not self.stop:
            try:
                async with websockets.connect(url, max_size=2 ** 24, ping_interval=20, open_timeout=15) as ws:
                    await ws.send(json.dumps(SUB))
                    await ws.recv()
                    self.c["connects"] += 1
                    backoff = 1
                    async for raw in ws:
                        self.handle(cid, raw)
                        if self.stop:
                            break
            except Exception as e:
                self.c["drops"] += 1
                self.c["drop_" + type(e).__name__] += 1
            self.live.pop(cid, None)
            await asyncio.sleep(backoff)
            backoff = min(30, backoff * 2)

    async def monitor(self):
        while not self.stop:
            try:
                await self._monitor()
            except Exception as e:
                import traceback; log("monitor error:", repr(e)); traceback.print_exc()
                await asyncio.sleep(1)

    async def _monitor(self):
        last_log = last_status = 0
        gaps = open(os.path.join(DATA, "gaps.jsonl"), "a")
        while not self.stop:
            await asyncio.sleep(1)
            now = time.time()
            up = now - self.last_msg < 2 and bool(self.live)
            if not up and self.gap_start is None:
                self.gap_start = int(self.last_msg or now)
            elif up and self.gap_start is not None:
                gaps.write(json.dumps({"from": self.gap_start, "to": int(now)}) + "\n"); gaps.flush()
                self.c["gap_s"] += int(now) - self.gap_start
                self.gap_start = None
            self.store.tick()
            if now - last_status >= 30:
                last_status = now
                st = dict(self.c, uptime_s=int(now - self.started), live_connections=len(self.live),
                          tracked_coins=len(self.store.mints), updated=int(now))
                with open(os.path.join(DATA, "status.json.tmp"), "w") as f:
                    json.dump(st, f, indent=1)
                os.replace(os.path.join(DATA, "status.json.tmp"), os.path.join(DATA, "status.json"))
                if now - last_log >= 60:
                    last_log = now
                    h = max(1e-9, (now - self.started) / 3600)
                    log(f"live {len(self.live)}/{len(ENDPOINTS)} | launches {self.c['stored_C']} "
                        f"({self.c['stored_C'] / h:.0f}/h) | trades stored {self.c['stored_T']} | "
                        f"graduations {self.c['stored_G']} | gaps {self.c['gap_s']} s | drops {self.c['drops']} | "
                        f"{self.c['bytes'] / (now - self.started) / 1024:.0f} KB/s")
        gaps.close()

    async def run(self):
        log(f"SWEDEN collector → {os.path.abspath(DATA)} via {len(ENDPOINTS)} connection(s)")
        tasks = [asyncio.create_task(self.conn(i, u, i * 2)) for i, u in enumerate(ENDPOINTS)]
        tasks.append(asyncio.create_task(self.monitor()))
        loop = asyncio.get_running_loop()
        for s in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(s, lambda: setattr(self, "stop", True))
        while not self.stop:
            await asyncio.sleep(0.5)
        for t in tasks:
            t.cancel()
        self.store.close()
        log("stopped")


if __name__ == "__main__":
    asyncio.run(Collector().run())
