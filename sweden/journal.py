"""Trading journal for the Sweden terminal (the "Journal" app under /journal/).

Round trips are built from the wallet history the terminal already has (wallets.db, no extra Helius calls): a trade
opens with the first buy of a coin while nothing is held and closes when (almost) everything is sold. The market-cap
path of the coin from entry to exit (and one hour after the exit) comes from the recorded pump.fun trades while the
coin is still in the terminal's memory; it is computed in the background and kept for good (journal.db).

The user's own annotations (setup, tags, mistakes, emotion, rating, plan kept, notes), manual trades, journal
settings and the opt-in "trading circle" stats of friends are stored here per account.
"""
import json, sqlite3, threading, time

from wallet import USDC, classify
DUST = 0.02             # a position counts as closed when less than 2 % of the tokens are left
SUPPLY = 1e9            # pump.fun coins: 1 billion tokens -> mcap = price per token x 1e9
PATH_N = 48             # points of the stored entry -> exit path
AFTER_S = 3600          # how long after the exit the "after you sold" move is followed


class Journal:
    def __init__(self, db_path):
        self.lock = threading.Lock()
        self.db = sqlite3.connect(db_path, check_same_thread=False)
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS jnotes (uid INT, tid TEXT, data TEXT, ts REAL, PRIMARY KEY (uid, tid));
            CREATE TABLE IF NOT EXISTS jmanual (uid INT, tid TEXT, data TEXT, ts REAL, PRIMARY KEY (uid, tid));
            CREATE TABLE IF NOT EXISTS jhide (uid INT, tid TEXT, PRIMARY KEY (uid, tid));
            CREATE TABLE IF NOT EXISTS jsettings (uid INTEGER PRIMARY KEY, data TEXT);
            CREATE TABLE IF NOT EXISTS jpath (mint TEXT, t0 REAL, t1 REAL, data TEXT, final INT, PRIMARY KEY (mint, t0, t1));
            CREATE TABLE IF NOT EXISTS jcircle (uid INTEGER PRIMARY KEY, data TEXT, ts REAL);
            CREATE TABLE IF NOT EXISTS jmeta (mint TEXT PRIMARY KEY, name TEXT, sym TEXT, image TEXT, ts REAL);
        """)

    # ---------- round trips from the wallet history ----------
    @staticmethod
    def round_trips(wallets, uid, sol_usd):
        """Closed round trips of one user, oldest first. A trade paid in USDC counts at today's SOL price."""
        with wallets.lock:
            rows = wallets.db.execute("SELECT sig, ts, sol, tokens, kind, fee FROM wtx WHERE uid = ? ORDER BY ts",
                                      (uid,)).fetchall()
        cur, out = {}, []
        for sig, ts, sol, tokens, kind, fee in rows:
            tok = json.loads(tokens)
            kind = classify(sol, tok, kind == "failed")
            if kind == "failed":
                continue
            cash = sol + (tok.get(USDC, 0.0) / sol_usd if sol_usd else 0.0)
            cash_usd = sol * sol_usd + tok.get(USDC, 0.0)          # USDC exact, SOL at today's price
            for m, v in tok.items():
                if m == USDC:
                    continue
                p = cur.get(m)
                if p is None:
                    if kind != "buy" or v <= 0:
                        continue                         # a sell / transfer of tokens bought before the history
                    p = cur[m] = dict(mint=m, t0=ts, bought=0.0, cost=0.0, sold=0.0, proceeds=0.0, cost_usd=0.0, proceeds_usd=0.0, held=0.0, peak=0.0,
                                      buys=0, sells=0, fees=0.0, transfer=False, sig=sig[:16])
                p["held"] += v
                p["peak"] = max(p["peak"], p["held"])
                p["fees"] += fee or 0.0
                if kind == "buy":
                    p["bought"] += v; p["cost"] += -cash; p["cost_usd"] += -cash_usd; p["buys"] += 1
                elif kind == "sell":
                    p["sold"] += -v; p["proceeds"] += cash; p["proceeds_usd"] += cash_usd; p["sells"] += 1
                elif v < 0:
                    p["transfer"] = True                 # tokens sent away: counted as sold for nothing
                if p["held"] <= p["peak"] * DUST:
                    p["t1"] = ts
                    out.append(p)
                    del cur[m]
        res = []
        for p in out:
            if p["bought"] <= 0 or p["cost"] <= 0:
                continue
            res.append(dict(tid=f"{p['mint'][:12]}-{int(p['t0'])}", mint=p["mint"], t0=p["t0"], t1=p["t1"],
                            cost_sol=p["cost"], proceeds_sol=p["proceeds"], pnl_sol=p["proceeds"] - p["cost"],
                            cost_usd=p["cost_usd"], pnl_usd=p["proceeds_usd"] - p["cost_usd"],
                            tokens=p["bought"], sold=p["sold"], buys=p["buys"], sells=p["sells"],
                            fees_sol=p["fees"], transferred=p["transfer"],
                            entry_mc=p["cost"] / p["bought"] * SUPPLY,
                            exit_mc=(p["proceeds"] / p["sold"] * SUPPLY) if p["sold"] > 0 else 0.0))
        return res, list(cur.values())

    # ---------- the market-cap path (from the terminal's recorded trades) ----------
    def path_of(self, coin, rt, now):
        """(dict, final?) for a round trip from the coin's recorded trades; None if the coin has no trades."""
        tr = sorted(coin.trades, key=lambda x: (x[0], x[1]))
        if not tr:
            return None
        t0, t1, e = rt["t0"], rt["t1"], rt["entry_mc"]
        inside = [x[3] for x in tr if t0 - 2 <= x[2] <= t1 + 2]
        after = [x[3] for x in tr if t1 < x[2] <= t1 + AFTER_S]
        if not inside:
            inside = [x[3] for x in tr if x[2] <= t1][-1:] or [tr[0][3]]
        step = max(1, len(inside) // PATH_N)
        pts = [inside[i] / e - 1 for i in range(0, len(inside), step)][:PATH_N]
        pts.append(rt["exit_mc"] / e - 1 if rt["exit_mc"] else inside[-1] / e - 1)
        ex = rt["exit_mc"] or inside[-1]
        d = dict(path=[round(v, 4) for v in pts], mae=min(0.0, min(inside) / e - 1), mfe=max(0.0, max(inside) / e - 1),
                 after_hi=(max(after) / ex - 1) if after else None, after_lo=(min(after) / ex - 1) if after else None,
                 launch_ts=coin.ts, grad_ts=coin.grad_ts, name=coin.name, sym=coin.sym,
                 stage="graduated" if coin.grad_ts and coin.grad_ts <= t0 else "curve")
        return d, now - t1 > AFTER_S + 120

    def update_paths(self, rts, coins, lock):
        """Compute and keep the paths of round trips whose coin is still in memory (called in the background)."""
        now = time.time()
        with self.lock:
            done = {(m, t0, t1) for m, t0, t1 in self.db.execute("SELECT mint, t0, t1 FROM jpath WHERE final = 1")}
        todo = [rt for rt in rts if (rt["mint"], rt["t0"], rt["t1"]) not in done]
        for rt in todo:
            with lock:
                c = coins.get(rt["mint"])
                r = self.path_of(c, rt, now) if c is not None else None
            if r:
                with self.lock:
                    self.db.execute("INSERT OR REPLACE INTO jpath VALUES (?, ?, ?, ?, ?)",
                                    (rt["mint"], rt["t0"], rt["t1"], json.dumps(r[0]), int(r[1])))
                    self.db.commit()

    def update_meta(self, rts, wallets):
        """Name / ticker / image of traded coins (terminal data, else DexScreener - free, no Helius), kept for good."""
        with self.lock:
            have = {m for (m,) in self.db.execute("SELECT mint FROM jmeta WHERE sym IS NOT NULL OR ts > ?", (time.time() - 86400,))}
        todo = list({r["mint"] for r in rts} - have)[:150]
        if not todo:
            return
        info = wallets.token_info(todo, fetch=True)
        with self.lock:
            for m in todo:
                _, name, sym, image = info.get(m, (None, None, None, None))
                self.db.execute("INSERT OR REPLACE INTO jmeta VALUES (?, ?, ?, ?, ?)", (m, name, sym, image, time.time()))
            self.db.commit()

    def meta(self):
        with self.lock:
            return {m: (n, s, i) for m, n, s, i in self.db.execute("SELECT mint, name, sym, image FROM jmeta")}

    def paths(self):
        with self.lock:
            return {(m, t0, t1): json.loads(d) for m, t0, t1, d in self.db.execute("SELECT mint, t0, t1, data FROM jpath")}

    # ---------- per-user data ----------
    def user_data(self, uid):
        with self.lock:
            notes = {t: json.loads(d) for t, d in self.db.execute("SELECT tid, data FROM jnotes WHERE uid = ?", (uid,))}
            manual = [json.loads(d) for (d,) in self.db.execute("SELECT data FROM jmanual WHERE uid = ? ORDER BY ts", (uid,))]
            hidden = [t for (t,) in self.db.execute("SELECT tid FROM jhide WHERE uid = ?", (uid,))]
            row = self.db.execute("SELECT data FROM jsettings WHERE uid = ?", (uid,)).fetchone()
        return notes, manual, hidden, json.loads(row[0]) if row else {}

    def set_note(self, uid, tid, data):
        with self.lock:
            if data:
                self.db.execute("INSERT OR REPLACE INTO jnotes VALUES (?, ?, ?, ?)", (uid, tid, json.dumps(data), time.time()))
            else:
                self.db.execute("DELETE FROM jnotes WHERE uid = ? AND tid = ?", (uid, tid))
            self.db.commit()

    def set_manual(self, uid, tid, data):
        with self.lock:
            if data:
                self.db.execute("INSERT OR REPLACE INTO jmanual VALUES (?, ?, ?, ?)", (uid, tid, json.dumps(data), time.time()))
            else:
                self.db.execute("DELETE FROM jmanual WHERE uid = ? AND tid = ?", (uid, tid))
                self.db.execute("DELETE FROM jnotes WHERE uid = ? AND tid = ?", (uid, tid))
            self.db.commit()

    def set_hidden(self, uid, tids, on):
        with self.lock:
            for tid in tids:
                if on:
                    self.db.execute("INSERT OR IGNORE INTO jhide VALUES (?, ?)", (uid, tid))
                else:
                    self.db.execute("DELETE FROM jhide WHERE uid = ? AND tid = ?", (uid, tid))
            self.db.commit()

    def set_settings(self, uid, data):
        with self.lock:
            self.db.execute("INSERT OR REPLACE INTO jsettings VALUES (?, ?)", (uid, json.dumps(data)))
            self.db.commit()

    # ---------- trading circle (opt-in: score, level, win rate; never amounts) ----------
    def set_circle(self, uid, data):
        with self.lock:
            if data:
                self.db.execute("INSERT OR REPLACE INTO jcircle VALUES (?, ?, ?)", (uid, json.dumps(data), time.time()))
            else:
                self.db.execute("DELETE FROM jcircle WHERE uid = ?", (uid,))
            self.db.commit()

    def circle(self):
        with self.lock:
            return {uid: (json.loads(d), ts) for uid, d, ts in self.db.execute("SELECT uid, data, ts FROM jcircle")}

    # ---------- everything for the app ----------
    def payload(self, uid, t):
        """Round trips + the coin information Sweden has about each of them + the user's journal data."""
        rts, open_ = self.round_trips(t.wallets, uid, t.usd)
        self.update_paths(rts[-20:], t.coins, t.lock)          # trades closed in the last minutes
        paths = self.paths()
        sigs = {}
        with t.signals.lock:
            for mint, kind, ts in t.signals.db.execute("SELECT mint, kind, ts FROM signals WHERE uid = ?", (uid,)):
                sigs.setdefault(mint, []).append((kind, ts))
        u = t.acc.users().get(uid, {})
        notes = u.get("notes", {})
        watch = u.get("watch", set())
        info = t.wallets.token_info(list({r["mint"] for r in rts}))
        meta = self.meta()
        trades = []
        for r in rts:
            p = paths.get((r["mint"], r["t0"], r["t1"])) or {}
            i = info.get(r["mint"]) or (None,) + meta.get(r["mint"], (None, None, None))
            s = sorted(k for k, ts in sigs.get(r["mint"], []) if ts <= r["t0"] + 30)
            r.update(sym=p.get("sym") or i[2] or r["mint"][:4], name=p.get("name") or i[1], image=i[3],
                     path=p.get("path"), mae=p.get("mae"), mfe=p.get("mfe"), after_hi=p.get("after_hi"),
                     after_lo=p.get("after_lo"), stage=p.get("stage"),
                     age_s=(r["t0"] - p["launch_ts"]) if p.get("launch_ts") else None,
                     signal="entry" if "entry" in s else "recommended" if "new" in s else None,
                     coin_note=notes.get(r["mint"]), starred=r["mint"] in watch)
            trades.append(r)
        jn, manual, hidden, settings = self.user_data(uid)
        return dict(ok=True, address=t.wallets.address(uid), trades=trades, open=len(open_), notes=jn, manual=manual,
                    hidden=hidden, settings=settings, sol_usd=t.usd,
                    me=u.get("settings", {}).get("display_name") or (u.get("email") or "").split("@")[0])
