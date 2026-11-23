"""A small live feed for the members' own wallets: one logsSubscribe ("mentions": wallet) per wallet, so friends'
trades are seen even when the program-wide feed drops them (it misses about a quarter of all transactions).

Helius bills a websocket by data volume (2 credits per 0.1 MB); a member's transactions are a few kB each, so a few
active wallets cost a few dozen credits a day. A daily volume cap (DAILY_MB) stops the feed if something goes wrong.
After a reconnect the wallets' last transactions are fetched once (getSignaturesForAddress + getTransaction, 1 credit
each, at most CATCHUP per wallet). Without a Helius key it does not run: the free public endpoint refuses extra
connections from the Pi (the collector already uses it) and must not be loaded further.
"""
import asyncio, json, threading, time, urllib.request

import websockets

from pump_events import decode, pump_data_lines

DAILY_MB = 25            # about 500 credits a day at most, all wallets together
WALLET_MB = 6            # one wallet (a bot-like member: ~18 kB per transaction) is dropped for the day above this
CATCHUP = 15             # transactions per wallet fetched after a reconnect


def log(*a):
    print(time.strftime("%Y-%m-%d %H:%M:%S"), "memberfeed:", *a, flush=True)


class MemberFeed:
    def __init__(self, key, wallets_fn, on_record, on_rpc=None):
        """wallets_fn() -> set of wallet addresses; on_record(wallet, slot, signature, rec) for each decoded T / S record
        of that wallet (called from the feed's thread)."""
        self.key, self.wallets_fn, self.on_record, self.on_rpc = key, wallets_fn, on_record, on_rpc
        self.ws_url = f"wss://mainnet.helius-rpc.com/?api-key={key}"
        self.rpc_url = f"https://mainnet.helius-rpc.com/?api-key={key}"
        self.last_sig = {}                   # wallet -> newest signature seen (for the catch-up)
        self.bytes_day = (time.strftime("%Y-%m-%d"), 0)
        self.wbytes = {}                     # wallet -> bytes today (reset with bytes_day)
        self.status = dict(connected=False, wallets=0, events=0, reconnects=0, paused=False)

    def start(self):
        if not self.key:
            log("no Helius key - members' wallet feed off")
            return
        threading.Thread(target=lambda: asyncio.run(self.run()), daemon=True).start()

    # ---------- helpers ----------
    def count(self, n):
        day, b = self.bytes_day
        today = time.strftime("%Y-%m-%d")
        if day != today:
            self.wbytes = {}
        self.bytes_day = (today, (b if day == today else 0) + n)
        return self.bytes_day[1] > DAILY_MB * 1e6

    def rpc(self, method, params):
        req = urllib.request.Request(self.rpc_url, json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(),
                                     {"content-type": "application/json"})
        if self.on_rpc:
            self.on_rpc()
        return json.load(urllib.request.urlopen(req, timeout=30)).get("result")

    def handle(self, wallet, slot, sig, logs):
        self.last_sig.setdefault(wallet, sig)
        for payload in pump_data_lines(logs or []):
            rec = decode(payload)
            if rec and rec[0] in ("T", "S") and rec[3] == wallet:
                self.status["events"] += 1
                try:
                    self.on_record(wallet, slot, sig, rec)
                except Exception as e:
                    log("record:", repr(e))

    def catch_up(self, wallets):
        """Transactions of the wallets since the newest one seen before the connection dropped (Helius only)."""
        if not self.rpc_url:
            return
        for w in wallets:
            until = self.last_sig.get(w)
            if not until:
                continue
            try:
                page = self.rpc("getSignaturesForAddress", [w, {"limit": CATCHUP, "until": until}]) or []
                for x in reversed(page):
                    if x.get("err"):
                        continue
                    tx = self.rpc("getTransaction", [x["signature"], {"encoding": "json", "maxSupportedTransactionVersion": 1,
                                                                      "commitment": "confirmed"}])
                    self.handle(w, x["slot"], x["signature"], ((tx or {}).get("meta") or {}).get("logMessages"))
                    time.sleep(0.12)
                if page:
                    self.last_sig[w] = page[0]["signature"]
                    log(f"caught up {len(page)} transaction(s) of {w[:6]}…")
            except Exception as e:
                log("catch-up:", repr(e))

    # ---------- the connection ----------
    async def run(self):
        backoff = 2
        while True:
            self.count(0)                                     # new day: reset the per-wallet counters
            wallets = sorted(w for w in self.wallets_fn() if self.wbytes.get(w, 0) < WALLET_MB * 1e6)
            self.status["wallets"] = len(wallets)
            if not wallets:
                await asyncio.sleep(30)
                continue
            if self.count(0):
                self.status["paused"] = True
                await asyncio.sleep(600)
                continue
            self.status["paused"] = False
            try:
                async with websockets.connect(self.ws_url, max_size=2 ** 22, open_timeout=15, ping_interval=30) as ws:
                    subs = {}
                    for i, w in enumerate(wallets):
                        await ws.send(json.dumps({"jsonrpc": "2.0", "id": 100 + i, "method": "logsSubscribe",
                                                  "params": [{"mentions": [w]}, {"commitment": "confirmed"}]}))
                    while len(subs) < len(wallets):
                        m = json.loads(await asyncio.wait_for(ws.recv(), 15))
                        if "result" in m and isinstance(m.get("id"), int):
                            subs[m["result"]] = wallets[m["id"] - 100]
                    self.status["connected"] = True
                    backoff = 2
                    await asyncio.get_running_loop().run_in_executor(None, self.catch_up, wallets)
                    checked = time.time()
                    while True:
                        try:
                            raw = await asyncio.wait_for(ws.recv(), 30)
                        except asyncio.TimeoutError:
                            raw = None
                        if raw:
                            if self.count(len(raw)):
                                log(f"daily volume cap ({DAILY_MB} MB) reached - paused until tomorrow")
                                break
                            m = json.loads(raw)
                            p = (m.get("params") or {})
                            v = ((p.get("result") or {}).get("value")) or {}
                            w = subs.get(p.get("subscription"))
                            if w:
                                self.wbytes[w] = self.wbytes.get(w, 0) + len(raw)
                                if self.wbytes[w] >= WALLET_MB * 1e6:
                                    log(f"{w[:6]}… over {WALLET_MB} MB today (bot-like) - dropped from the feed until tomorrow")
                                    break
                            if w and not v.get("err"):
                                slot = ((p.get("result") or {}).get("context") or {}).get("slot", 0)
                                self.last_sig[w] = v.get("signature") or self.last_sig.get(w)
                                self.handle(w, slot, v.get("signature") or "", v.get("logs"))
                        if time.time() - checked > 30:                # members added / removed a wallet
                            checked = time.time()
                            if sorted(w for w in self.wallets_fn() if self.wbytes.get(w, 0) < WALLET_MB * 1e6) != wallets:
                                break
            except Exception as e:
                log("connection:", repr(e)[:160])
            self.status["connected"] = False
            self.status["reconnects"] += 1
            await asyncio.sleep(backoff)
            backoff = min(60, backoff * 2)
