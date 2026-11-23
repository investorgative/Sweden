"""SWEDEN terminal signal tracker: a live forward test of the recommendations.

Every time a coin becomes recommended for a user ("new") or reaches the entry signal ("entry"), the moment is recorded
with the market cap at that time (whether or not the user has that alert switched on). Afterwards the outcome is
measured from the coin's trades: highest and lowest market cap after the signal, the latest one, and for +-25 / 35 /
50 % whether the gain or the loss came first. Raw market-cap moves: no fees, no slippage, no latency - a trade at the
signal would do worse. Outcomes are followed for HORIZON_S (or as long as the terminal still tracks the coin).
Stored in data/signals.db.
"""
import json, sqlite3, threading, time

HORIZON_S = 24 * 3600
LEVELS = (0.25, 0.35, 0.5)


class Signals:
    def __init__(self, db_path):
        self.lock = threading.Lock()
        self.db = sqlite3.connect(db_path, check_same_thread=False)
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS signals (id INTEGER PRIMARY KEY, uid INT, mint TEXT, sym TEXT, name TEXT, kind TEXT,
                watch_only INT, ts REAL, slot INT, mcap_sol REAL, sol_usd REAL, max_sol REAL, max_ts REAL, min_sol REAL,
                min_ts REAL, last_sol REAL, last_ts REAL, firsts TEXT DEFAULT '{}', done INT DEFAULT 0);
            CREATE INDEX IF NOT EXISTS signals_uid ON signals (uid, ts);
        """)

    def add(self, uid, c, kind, watch_only, sol_usd):
        mc = c.price * 1e6
        with self.lock:
            self.db.execute("INSERT INTO signals (uid, mint, sym, name, kind, watch_only, ts, slot, mcap_sol, sol_usd, max_sol, "
                            "max_ts, min_sol, min_ts, last_sol, last_ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                            (uid, c.mint, c.sym, c.name, kind, int(watch_only), time.time(), c.last_slot, mc, sol_usd,
                             mc, time.time(), mc, time.time(), mc, time.time()))
            self.db.commit()

    def update(self, coins):
        """Follow every open signal on the coin's trades (called about once a minute, under the terminal's lock)."""
        now = time.time()
        with self.lock:
            rows = self.db.execute("SELECT id, mint, ts, slot, mcap_sol, firsts FROM signals WHERE done = 0").fetchall()
        changes = []
        for sid, mint, ts, slot, entry, firsts in rows:
            c = coins.get(mint)
            if c is None:                                 # no longer tracked: the outcome stays as it is
                changes.append((sid, None))
                continue
            hi, lo, hi_t, lo_t, last, last_t = entry, entry, ts, ts, entry, ts
            first = json.loads(firsts or "{}")
            for t in sorted((x for x in c.trades if x[0] >= slot and x[2] <= ts + HORIZON_S), key=lambda x: (x[0], x[1])):
                mc = t[3]
                if mc > hi:
                    hi, hi_t = mc, t[2]
                if mc < lo:
                    lo, lo_t = mc, t[2]
                last, last_t = mc, t[2]
                for x in LEVELS:
                    k = f"{int(x * 100)}"
                    if k not in first:
                        if mc >= entry * (1 + x):
                            first[k] = ["tp", t[2] - ts]
                        elif mc <= entry * (1 - x):
                            first[k] = ["sl", t[2] - ts]
            changes.append((sid, (hi, hi_t, lo, lo_t, last, last_t, json.dumps(first), int(now - ts > HORIZON_S))))
        with self.lock:
            for sid, v in changes:
                if v is None:
                    self.db.execute("UPDATE signals SET done = 1 WHERE id = ?", (sid,))
                else:
                    self.db.execute("UPDATE signals SET max_sol = ?, max_ts = ?, min_sol = ?, min_ts = ?, last_sol = ?, "
                                    "last_ts = ?, firsts = ?, done = ? WHERE id = ?", v + (sid,))
            self.db.commit()

    def list(self, uid, days=7):
        cols = ("id", "mint", "sym", "name", "kind", "watch_only", "ts", "mcap_sol", "sol_usd", "max_sol", "max_ts", "min_sol",
                "min_ts", "last_sol", "last_ts", "firsts", "done")
        with self.lock:
            rows = self.db.execute(f"SELECT {', '.join(cols)} FROM signals WHERE uid = ? AND ts >= ? ORDER BY ts DESC",
                                   (uid, time.time() - days * 86400)).fetchall()
        out = []
        for r in rows:
            d = dict(zip(cols, r))
            d["firsts"] = json.loads(d["firsts"] or "{}")
            e = d["mcap_sol"]
            d.update(max_pct=d["max_sol"] / e - 1, min_pct=d["min_sol"] / e - 1, last_pct=d["last_sol"] / e - 1)
            out.append(d)
        return out

    @staticmethod
    def summary(rows):
        """Per kind: count, median best / worst move, and per level how often the gain came before the loss."""
        out = {}
        for kind in ("new", "entry"):
            rs = [r for r in rows if r["kind"] == kind and not r["watch_only"]]
            if not rs:
                continue
            med = lambda xs: sorted(xs)[len(xs) // 2] if xs else None
            lv = {}
            for x in LEVELS:
                k = f"{int(x * 100)}"
                dec = [r["firsts"][k][0] for r in rs if k in r["firsts"]]
                lv[k] = dict(tp=dec.count("tp"), sl=dec.count("sl"), open=len(rs) - len(dec))
            out[kind] = dict(n=len(rs), med_max=med([r["max_pct"] for r in rs]), med_min=med([r["min_pct"] for r in rs]),
                             med_last=med([r["last_pct"] for r in rs]), levels=lv)
        return out
