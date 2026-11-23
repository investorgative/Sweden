"""SWEDEN terminal wallets: live balance, positions, profit / loss, transactions and an equity curve per user.

Data from Helius (free key in the file helius_key next to terminal.sh): balances by RPC, transaction history by the
enhanced transactions API. Every transaction is turned into the wallet's own balance changes (SOL incl. wrapped SOL,
and each token), so it works the same for pump.fun, PumpSwap, Axiom routes or any other DEX; Helius' own trade labels
are not used (pump.fun trades come back as "UNKNOWN").

Credits (free plan): balances + new-signature check every 30 s while a page of the user is open, every 5 min otherwise;
the history is loaded once (up to MAX_BACKFILL transactions), then only new transactions are parsed.
Positions: average cost from the recorded buys; tokens that arrived by transfer have no cost. Profit in SOL; USD at the
current SOL price. The equity curve is recorded from the moment the wallet is added (snapshots every 5 min); before
that only the cash (SOL) line can be rebuilt from the history.
"""
import json, os, re, sqlite3, threading, time, urllib.request

WSOL = "So11111111111111111111111111111111111111112"
TOKEN_PROGRAMS = ("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")
ADDR_RE = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")
MAX_BACKFILL = 1000
ACTIVE_S, IDLE_S, SNAP_S = 30, 300, 300
DUST_USD = 0.5                                   # positions worth less are listed as dust


def log(*a):
    print(time.strftime("%Y-%m-%d %H:%M:%S"), *a, flush=True)


def http_json(url, body=None, timeout=20):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", "Accept": "application/json",
                                          "User-Agent": "Mozilla/5.0"})
    return json.load(urllib.request.urlopen(req, timeout=timeout))


class Helius:
    def __init__(self, key):
        self.key = key
        self.rpc_url = f"https://mainnet.helius-rpc.com/?api-key={key}"

    def rpc(self, method, params):
        d = http_json(self.rpc_url, {"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
        if d.get("error"):
            raise RuntimeError(f"{method}: {d['error']}")
        return d["result"]

    def history(self, address, before=None, limit=100):
        url = f"https://api.helius.xyz/v0/addresses/{address}/transactions?api-key={self.key}&limit={limit}"
        return http_json(url + (f"&before={before}" if before else ""), timeout=30)

    def parse(self, sigs):
        return http_json(f"https://api.helius.xyz/v0/transactions?api-key={self.key}", {"transactions": sigs}, timeout=30)


def deltas(t, me):
    """(SOL change incl. wrapped SOL and fees, {mint: token change}) of wallet `me` in one parsed transaction."""
    sol, tok = 0.0, {}
    for a in t.get("accountData") or []:
        if a.get("account") == me:
            sol += (a.get("nativeBalanceChange") or 0) / 1e9
        for tb in a.get("tokenBalanceChanges") or []:
            if tb.get("userAccount") == me:
                raw = tb.get("rawTokenAmount") or {}
                amt = int(raw.get("tokenAmount") or 0) / 10 ** int(raw.get("decimals") or 0)
                tok[tb["mint"]] = tok.get(tb["mint"], 0.0) + amt
    sol += tok.pop(WSOL, 0.0)
    tok = {m: v for m, v in tok.items() if abs(v) > 0}
    if len(tok) == 1:
        (m, v), = tok.items()
        kind = "transfer in" if v > 0 and abs(sol) < 0.003 else "transfer out" if v < 0 and abs(sol) < 0.003 else \
            "buy" if v > 0 else "sell"
    elif not tok:
        kind = "sol in" if sol > 0 else "sol out" if sol < 0 else "other"
    else:
        kind = "other"
    if t.get("transactionError"):
        kind = "failed"
    return sol, tok, kind


class Wallets:
    def __init__(self, db_path, key_path, price_fn):
        self.price_fn = price_fn                 # mint -> (usd price, name, sym, image) from the terminal, or None
        try:
            self.h = Helius(open(key_path).read().strip())
        except OSError:
            self.h = None
        self.lock = threading.Lock()
        self.db = sqlite3.connect(db_path, check_same_thread=False)
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS wallets (uid INTEGER PRIMARY KEY, address TEXT, added REAL, backfilled INT DEFAULT 0,
                last_sig TEXT);
            CREATE TABLE IF NOT EXISTS wtx (uid INT, sig TEXT, ts REAL, sol REAL, tokens TEXT, kind TEXT, fee REAL,
                PRIMARY KEY (uid, sig));
            CREATE TABLE IF NOT EXISTS snaps (uid INT, ts REAL, total REAL, total_vis REAL, cash REAL, sol_usd REAL);
            CREATE TABLE IF NOT EXISTS whide (uid INT, mint TEXT, PRIMARY KEY (uid, mint));
        """)
        self.live = {}                           # uid -> {"bal": time, "sol": x, "tokens": {mint: amount}, "error": ...}
        self.seen = {}                           # uid -> last time a page of this user asked for data
        self.meta = {}                           # mint -> (time, usd, name, sym, image) from DexScreener
        self.sol_usd = lambda: 0.0

    # ---------- setup ----------
    def address(self, uid):
        with self.lock:
            r = self.db.execute("SELECT address FROM wallets WHERE uid = ?", (uid,)).fetchone()
        return r[0] if r else None

    def set_address(self, uid, address):
        address = (address or "").strip()
        if address and not ADDR_RE.match(address):
            return False
        with self.lock:
            old = self.db.execute("SELECT address FROM wallets WHERE uid = ?", (uid,)).fetchone()
            if old and old[0] == address:
                return True
            for t in ("wallets", "wtx", "snaps"):
                self.db.execute(f"DELETE FROM {t} WHERE uid = ?", (uid,))
            if address:
                self.db.execute("INSERT INTO wallets (uid, address, added) VALUES (?, ?, ?)", (uid, address, time.time()))
            self.db.commit()
        self.live.pop(uid, None)
        return True

    def hide(self, uid, mint, on):
        with self.lock:
            if on:
                self.db.execute("INSERT OR IGNORE INTO whide VALUES (?, ?)", (uid, mint))
            else:
                self.db.execute("DELETE FROM whide WHERE uid = ? AND mint = ?", (uid, mint))
            self.db.commit()

    def touch(self, uid):
        self.seen[uid] = time.time()

    # ---------- prices / names ----------
    def token_info(self, mints):
        """{mint: (usd, name, sym, image)}: the terminal's own data first, else DexScreener (cached 60 s)."""
        out, ask = {}, []
        for m in mints:
            p = self.price_fn(m)
            if p:
                out[m] = p
            elif m in self.meta and time.time() - self.meta[m][0] < 60:
                out[m] = self.meta[m][1:]
            else:
                ask.append(m)
        for i in range(0, len(ask), 30):
            chunk = ask[i:i + 30]
            try:
                pairs = http_json("https://api.dexscreener.com/tokens/v1/solana/" + ",".join(chunk), timeout=10)
            except Exception:
                pairs = []
            best = {}
            for p in pairs or []:
                m = (p.get("baseToken") or {}).get("address")
                if m and ((p.get("liquidity") or {}).get("usd") or 0) >= ((best.get(m) or {}).get("liquidity") or {}).get("usd", -1):
                    best[m] = p
            for m in chunk:
                p = best.get(m) or {}
                bt = p.get("baseToken") or {}
                v = (float(p["priceUsd"]) if p.get("priceUsd") else None, bt.get("name"), bt.get("symbol"),
                     (p.get("info") or {}).get("imageUrl"))
                self.meta[m] = (time.time(),) + v
                out[m] = v
        return out

    # ---------- background ----------
    def worker(self):
        while True:
            time.sleep(5)
            if not self.h:
                continue
            with self.lock:
                rows = self.db.execute("SELECT uid, address, backfilled, last_sig FROM wallets").fetchall()
            for uid, addr, backfilled, last_sig in rows:
                try:
                    if not backfilled:
                        self.backfill(uid, addr)
                        continue
                    lv = self.live.setdefault(uid, {"bal": 0})
                    every = ACTIVE_S if time.time() - self.seen.get(uid, 0) < 120 else IDLE_S
                    if time.time() - lv["bal"] >= every:
                        self.refresh(uid, addr, last_sig)
                except Exception as e:
                    self.live.setdefault(uid, {"bal": 0})["error"] = str(e)[:200]
                    self.live[uid]["bal"] = time.time()          # retry on the next cadence, not every 5 s
                    log(f"wallet {uid}: {e!r}")

    def backfill(self, uid, addr):
        """Load up to MAX_BACKFILL past transactions once (newest first)."""
        before, n, newest = None, 0, None
        while n < MAX_BACKFILL:
            page = self.h.history(addr, before)
            if not page:
                break
            self.store(uid, addr, page)
            newest = newest or page[0]["signature"]
            n += len(page)
            before = page[-1]["signature"]
            if len(page) < 100:
                break
        with self.lock:
            self.db.execute("UPDATE wallets SET backfilled = 1, last_sig = ? WHERE uid = ?", (newest, uid))
            self.db.commit()
        log(f"wallet {uid}: history loaded ({n} transactions)")

    def store(self, uid, addr, txs):
        with self.lock:
            for t in txs:
                sol, tok, kind = deltas(t, addr)
                fee = (t.get("fee") or 0) / 1e9 if t.get("feePayer") == addr else 0.0
                self.db.execute("INSERT OR IGNORE INTO wtx VALUES (?, ?, ?, ?, ?, ?, ?)",
                                (uid, t["signature"], t.get("timestamp") or time.time(), sol, json.dumps(tok), kind, fee))
            self.db.commit()

    def refresh(self, uid, addr, last_sig):
        sol = self.h.rpc("getBalance", [addr])["value"] / 1e9
        tokens = {}
        for prog in TOKEN_PROGRAMS:
            res = self.h.rpc("getTokenAccountsByOwner", [addr, {"programId": prog}, {"encoding": "jsonParsed"}])
            for acc in res["value"]:
                info = acc["account"]["data"]["parsed"]["info"]
                amt = float(info["tokenAmount"]["uiAmount"] or 0)
                if amt > 0:
                    tokens[info["mint"]] = tokens.get(info["mint"], 0) + amt
        sol += tokens.pop(WSOL, 0.0)
        # new transactions since the last one we have
        params = {"limit": 100}
        if last_sig:
            params["until"] = last_sig
        sigs = [s["signature"] for s in self.h.rpc("getSignaturesForAddress", [addr, params])]
        if sigs:
            self.store(uid, addr, self.h.parse(sigs[:100]))
            with self.lock:
                self.db.execute("UPDATE wallets SET last_sig = ? WHERE uid = ?", (sigs[0], uid))
                self.db.commit()
        self.live[uid] = {"bal": time.time(), "sol": sol, "tokens": tokens, "error": None}
        self.snapshot(uid)

    def snapshot(self, uid):
        s = self.summary(uid)
        if s.get("total_usd") is None:
            return
        with self.lock:
            last = self.db.execute("SELECT MAX(ts) FROM snaps WHERE uid = ?", (uid,)).fetchone()[0] or 0
            if time.time() - last >= SNAP_S:
                self.db.execute("INSERT INTO snaps VALUES (?, ?, ?, ?, ?, ?)", (uid, time.time(), s["total_usd"],
                                s["total_vis_usd"], s["cash_sol"], self.sol_usd()))
                self.db.commit()

    # ---------- views ----------
    def hidden(self, uid):
        with self.lock:
            return {r[0] for r in self.db.execute("SELECT mint FROM whide WHERE uid = ?", (uid,))}

    def summary(self, uid):
        """Header numbers (no network calls except cached prices)."""
        addr = self.address(uid)
        if not addr:
            return {"address": None}
        lv = self.live.get(uid) or {}
        if "sol" not in lv:
            return {"address": addr, "loading": True, "error": lv.get("error"), "has_key": bool(self.h)}
        usd = self.sol_usd()
        info = self.token_info(list(lv["tokens"]))
        hid = self.hidden(uid)
        vals = {m: a * (info.get(m, (None,))[0] or 0) for m, a in lv["tokens"].items()}
        cash_usd = lv["sol"] * usd
        return {"address": addr, "loading": False, "cash_sol": lv["sol"], "cash_usd": cash_usd, "sol_usd": usd,
                "total_usd": cash_usd + sum(vals.values()),
                "total_vis_usd": cash_usd + sum(v for m, v in vals.items() if m not in hid),
                "updated": lv["bal"], "error": lv.get("error")}

    def full(self, uid):
        """Everything for the portfolio page."""
        s = self.summary(uid)
        if not s.get("address") or s.get("loading"):
            return {"summary": s}
        lv, usd, hid = self.live[uid], self.sol_usd(), self.hidden(uid)
        with self.lock:
            txs = self.db.execute("SELECT sig, ts, sol, tokens, kind, fee FROM wtx WHERE uid = ? ORDER BY ts", (uid,)).fetchall()
            snaps = self.db.execute("SELECT ts, total, total_vis, cash, sol_usd FROM snaps WHERE uid = ? ORDER BY ts", (uid,)).fetchall()
        # per token: buys / sells from the history
        pos = {}
        for sig, ts, sol, tokens, kind, fee in txs:
            for m, v in json.loads(tokens).items():
                p = pos.setdefault(m, dict(bought=0.0, cost=0.0, sold=0.0, proceeds=0.0, first=ts, last=ts, buys=0, sells=0))
                p["last"] = ts
                if kind == "buy":
                    p["bought"] += v; p["cost"] += -sol; p["buys"] += 1
                elif kind == "sell":
                    p["sold"] += -v; p["proceeds"] += sol; p["sells"] += 1
        mints = set(lv["tokens"]) | set(pos)
        info = self.token_info(list(mints))
        open_, closed = [], []
        for m in mints:
            p = pos.get(m, dict(bought=0.0, cost=0.0, sold=0.0, proceeds=0.0, first=None, last=None, buys=0, sells=0))
            price, name, sym, image = info.get(m, (None, None, None, None))
            held = lv["tokens"].get(m, 0.0)
            avg = p["cost"] / p["bought"] if p["bought"] > 0 else None              # SOL per token
            realized = p["proceeds"] - avg * min(p["sold"], p["bought"]) if avg is not None else None
            row = dict(mint=m, name=name, sym=sym, image=image, hidden=m in hid, buys=p["buys"], sells=p["sells"],
                       first=p["first"], last=p["last"], cost_sol=p["cost"], proceeds_sol=p["proceeds"],
                       realized_sol=realized)
            if held > 0:
                value_usd = held * price if price else None
                cost_open = avg * held if avg is not None else None
                row.update(amount=held, price_usd=price, value_usd=value_usd, cost_open_sol=cost_open,
                           unreal_sol=(value_usd / usd - cost_open) if value_usd is not None and cost_open is not None and usd else None,
                           dust=value_usd is not None and value_usd < DUST_USD)
                open_.append(row)
            elif p["buys"] or p["sells"]:
                # a sell of more than was bought: the buy lies before the loaded history -> no profit figure
                complete = p["bought"] > 0 and p["sold"] <= p["bought"] * 1.02
                row.update(complete=complete, pnl_sol=(p["proceeds"] - p["cost"]) if complete else None,
                           pnl_pct=(p["proceeds"] / p["cost"] - 1) if complete and p["cost"] > 0 else None)
                closed.append(row)
        open_.sort(key=lambda r: (r["hidden"], r.get("dust", False), -(r["value_usd"] or 0)))
        closed.sort(key=lambda r: -(r["last"] or 0))
        now = time.time()
        def realized_since(sec):
            return sum(r["pnl_sol"] for r in closed if r["pnl_sol"] is not None and r["last"] and r["last"] >= now - sec)
        # cash line rebuilt backwards from today's SOL balance; equity from the snapshots (in SOL)
        cash, bal = [], lv["sol"]
        for sig, ts, sol, tokens, kind, fee in reversed(txs):
            cash.append((ts, bal)); bal -= sol
        cash.reverse()
        equity = [(ts, tv / su if su else None) for ts, tot, tv, c, su in snaps]
        tx_rows = []
        for sig, ts, sol, tokens, kind, fee in reversed(txs[-300:]):
            tk = json.loads(tokens)
            m, amt = (next(iter(tk.items())) if len(tk) == 1 else (None, None))
            i = info.get(m, (None, None, None, None)) if m else (None, None, None, None)
            tx_rows.append(dict(sig=sig, ts=ts, kind=kind, sol=sol, fee=fee, mint=m, amount=amt, sym=i[2], name=i[1], ntok=len(tk)))
        unreal = [r["unreal_sol"] for r in open_ if r.get("unreal_sol") is not None and not r["hidden"]]
        return {"summary": s, "open": open_, "closed": closed[:300], "txs": tx_rows, "cash": cash[-2000:], "equity": equity[-5000:],
                "pnl": {"unreal_sol": sum(unreal), "r24h": realized_since(86400), "r7d": realized_since(7 * 86400),
                        "rall": sum(r["pnl_sol"] for r in closed if r["pnl_sol"] is not None),
                        "incomplete": sum(1 for r in closed if r["pnl_sol"] is None)},
                "history_n": len(txs), "max_backfill": MAX_BACKFILL}
