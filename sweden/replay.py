"""SWEDEN replay — answers "after the filter approves a coin, how often does it hit +X% before -Y%?"

Reads the collector's raw events, rebuilds every SOL-quoted pump.fun coin trade by trade, runs the filter
on the state at every trade from MIN_AGE to MAX_AGE after launch, and simulates a buy at the first approval.

Realism built in:
  * entry and exit happen LAT slots after the signal (bot latency); all trades in between are applied first,
    so a dump inside that time hits us exactly as it would live;
  * our buy and sell move the curve (constant product), pump.fun fee (fee + creator fee, from the events) on
    both sides, NET_COST SOL per transaction for priority fee / tip;
  * "price" for TP/SL is what selling our tokens would return right now, not the chart price, so a TP of +50%
    means +50% in our pocket after fees.
  * every coin's trades must form an unbroken chain (the curve's token reserve moves by exactly each trade's
    amount); a coin with a missing trade inside its window is excluded, so is one launched too close to the end
    of the data to be complete.
  * normal and Mayhem coins (create flag 1: a fee-free pump.fun agent wallet trades them and moves the curve in
    jumps) are separate games and are replayed separately (--kind). Mayhem results are NOT reliable: other
    traders' fills there deviate -30 % / +40 % (p10 / p90) from the curve formula, so our simulated fills are rough.

Usage:  python3 sweden/replay.py [--kind normal|mayhem] [--size 0.5] [--lat 5] [--min-age 30] [--max-age 180]
                                 [--horizon 7200] [--nofilter] [--set dev_pct=0.05 ...]
                                 [--dip 0.5 --min-peak 1.0 --rebound 0.1]   (buy-the-dip entry)
"""
import argparse, bisect, collections, difflib, glob, gzip, itertools, json, os, re, statistics as st, sys, zlib

NO_CREATOR = "11111111111111111111111111111111"   # pool opened by hand, not by a migration (see pump_events.py)
DATA = os.environ.get("SWEDEN_DATA", os.path.join(os.path.dirname(__file__), "..", "data"))
SUPPLY = 1e15                    # raw token units (1e9 tokens, 6 decimals)
SLOT_S = 0.4

# Filter v1: the user's criteria with first-guess thresholds; v1 replaces "dev has not sold" (v0) with the two
# dev-sell checks below. The data decides the real thresholds later.
FILTER = dict(
    dev_pct=0.05,          # creator wallet(s) hold at most 5 % of supply
    dev_sell_fast_s=1.0,   # dev did not sell within 1 s of launch (launch-slot dump: 99 % of those coins die)
    dev_sold_max=0.99,     # dev sold less than 99 % of what it bought (a partial dev sell is fine: data 19 Nov)
    bundle_pct=0.10,       # wallets that bought in the launch slot hold at most 10 %
    sniper_pct=0.15,       # wallets whose first buy came 1-3 slots after launch hold at most 15 %
    top10_pct=0.30,        # top 10 holders (curve excluded) hold at most 30 %
    min_traders=15,        # at least 15 different wallets traded
    min_buys=20,
    top3_trade_share=0.40, # the 3 most active wallets made at most 40 % of all trades (wash trading)
    same_size_share=0.30,  # at most 30 % of buys have exactly the same SOL size as another buy (volume bots)
    max_prior_launches=2,  # creator launched at most 2 other coins in the previous 24 h (serial deployer)
    copy=False,            # not a copy of an earlier launch in the previous 72 h (same name, or same ticker with a
                           # similar name; a shared ticker alone is not a copy: see copy_matches)
    min_netflow=3.0,       # at least 3 SOL net inflow into the curve
)
TPS = [0.1, 0.2, 0.3, 0.5, 0.75, 1.0, 2.0, 3.0]
SLS = [0.2, 0.3, 0.5]


def load():
    files = sorted(glob.glob(os.path.join(DATA, "*", "events-*.jsonl.gz")))
    coins, order = {}, 0
    t_min, t_max = None, None
    for f in files:
        try:
            fh = gzip.open(f, "rt")
            for line in fh:
                try:
                    r = json.loads(line)
                except Exception:
                    continue                         # truncated last line of a running file
                slot, kind, ts, mint = r[0], r[2], r[3], r[4]
                t_min = ts if t_min is None else min(t_min, ts)
                t_max = ts if t_max is None else max(t_max, ts)
                order += 1
                if kind == "C":
                    _, _, _, ts, mint, creator, signer, name, sym, uri, vsol, vtok, quote, flag = r[:14]
                    coins[mint] = dict(mint=mint, slot=slot, ts=ts, creator=creator, signer=signer, name=name,
                                       sym=sym, quote=quote, flag=flag, vsol0=vsol, vtok0=vtok, ev=[], grad=None,
                                       pool=None, sw=[])
                elif mint in coins:
                    if kind == "T":
                        coins[mint]["ev"].append((slot, order, r))
                    elif kind == "G":
                        coins[mint]["grad"] = slot
                    elif kind == "P" and r[9] != NO_CREATOR:   # PumpSwap pool created at migration
                        coins[mint]["pool"] = r
                    elif kind == "S":                # PumpSwap swap after graduation
                        coins[mint]["sw"].append((slot, order, r))
        except (EOFError, OSError, zlib.error):
            continue                                 # file still being written / damaged tail
    for c in coins.values():
        chain(c)
        c["sw"].sort(key=lambda e: (e[0], e[1]))
    gaps = []
    gp = os.path.join(DATA, "gaps.jsonl")
    if os.path.exists(gp):
        gaps = [json.loads(l) for l in open(gp) if l.strip()]
    return coins, gaps, t_min, t_max


def chain(c):
    """Order trades by slot and, inside a slot, by the curve's token reserve (each trade moves it by exactly its
    token amount). c["broken"] = slot of the first trade that does not follow from the previous one (a trade is
    missing from the data there), else None."""
    vt, out, c["broken"] = c["vtok0"], [], None
    for slot, grp in itertools.groupby(sorted(c["ev"], key=lambda e: (e[0], e[1])), key=lambda e: e[0]):
        g = list(grp)
        while g:
            k = next((i for i, e in enumerate(g) if (vt - e[2][8] if e[2][6] else vt + e[2][8]) == e[2][10]), None)
            if k is None and c["broken"] is None:
                c["broken"] = slot
            e = g.pop(k or 0)
            out.append(e); vt = e[2][10]
    c["ev"] = out


def norm_name(s):
    """Name without case, spaces and punctuation ("Drink Watta" == "DRINK-WATTA"); emoji-only names stay as they are."""
    s = (s or "").strip().lower()
    return re.sub(r"[^a-z0-9]", "", s) or s


def similar_names(a, b):
    """Normalised names that look like the same meme: equal, one inside the other (>= 4 letters), or nearly the same
    spelling. "bigtittiecoin" vs "bitcoin" is not similar (a shared ticker alone does not make a copy)."""
    if not a or not b:
        return False
    if a == b or (min(len(a), len(b)) >= 4 and (a in b or b in a)):
        return True
    return difflib.SequenceMatcher(None, a, b).ratio() >= 0.8


def copy_matches(index, ts, name, sym, mint=None, window=3 * 86400):
    """Earlier launches (within `window`) this one copies: {mint: (ts, why)}; then adds this launch to `index`
    (("n", name) / ("s", ticker) -> [(ts, mint, name)]). Same name = copy; same ticker = copy only with a similar name."""
    n, s, out = norm_name(name), (sym or "").strip().lower(), {}
    for t, m, _ in index.get(("n", n), ()):
        if 0 <= ts - t < window and m != mint:
            out[m] = (t, "same name")
    for t, m, nn in index.get(("s", s), ()):
        if 0 <= ts - t < window and m != mint and m not in out and similar_names(n, nn):
            out[m] = (t, "same ticker, similar name")
    for k in {("n", n), ("s", s)}:
        index.setdefault(k, []).append((ts, mint, n))
    return out


def annotate_history(coins):
    """Creator's earlier launches (24 h) and copies of earlier launches (72 h), from launches seen in the data."""
    by_creator, names = collections.defaultdict(list), {}
    for c in sorted(coins.values(), key=lambda c: c["ts"]):
        prev = [t for t in by_creator[c["creator"]] if c["ts"] - t < 86400]
        c["prior_launches"] = len(prev)
        by_creator[c["creator"]].append(c["ts"])
        c["copy"] = bool(copy_matches(names, c["ts"], c["name"], c["sym"], c["mint"]))


class State:
    def __init__(self, c):
        self.c = c
        self.vsol, self.vtok = c["vsol0"], c["vtok0"]
        self.hold = collections.Counter()
        self.first_buy_slot = {}
        self.ntr = collections.Counter()
        self.buy_sizes = collections.Counter()
        self.n_buys = self.n_sells = 0
        self.dev_bought = self.dev_sold_tok = 0
        self.dev_first_sell = None               # slot of the dev's first sell
        self.fee = 0.0125
        self.devs = {c["creator"], c["signer"]}
        self.peak = self.low = c["vsol0"] / c["vtok0"]   # highest price so far / lowest price since the peak

    def apply(self, slot, r):
        _, _, _, ts, mint, user, buy, sol, tok, vsol, vtok, fee_bps, cfee_bps, ix = r
        self.vsol, self.vtok = vsol, vtok
        px = vsol / vtok
        if px > self.peak:
            self.peak = self.low = px
        self.low = min(self.low, px)
        self.fee = max(self.fee, (fee_bps + cfee_bps) / 1e4)
        self.ntr[user] += 1
        if buy:
            self.hold[user] += tok; self.n_buys += 1
            self.first_buy_slot.setdefault(user, slot)
            self.buy_sizes[round(sol / 1e9, 3)] += 1
            if user in self.devs:
                self.dev_bought += tok
        else:
            self.hold[user] -= tok; self.n_sells += 1
            if user in self.devs:
                self.dev_sold_tok += tok
                if self.dev_first_sell is None:
                    self.dev_first_sell = slot

    def features(self):
        L = self.c["slot"]
        held = {w: t for w, t in self.hold.items() if t > 0}
        top10 = sum(sorted(held.values(), reverse=True)[:10])
        trades = sum(self.ntr.values())
        dup = sum(n for n in self.buy_sizes.values() if n > 1)
        return dict(
            dev_pct=sum(held.get(d, 0) for d in self.devs) / SUPPLY,
            dev_sold=self.dev_first_sell is not None,
            dev_sell_s=(self.dev_first_sell - L) * SLOT_S if self.dev_first_sell is not None else None,
            dev_sold_frac=self.dev_sold_tok / self.dev_bought if self.dev_bought else float(self.dev_sold_tok > 0),
            bundle_pct=sum(t for w, t in held.items() if self.first_buy_slot.get(w) == L) / SUPPLY,
            sniper_pct=sum(t for w, t in held.items() if 0 < self.first_buy_slot.get(w, -99) - L <= 3) / SUPPLY,
            top10_pct=top10 / SUPPLY,
            traders=len(self.ntr), buys=self.n_buys, sells=self.n_sells,
            top3_trade_share=sum(n for _, n in self.ntr.most_common(3)) / max(1, trades),
            same_size_share=dup / max(1, self.n_buys),
            prior_launches=self.c["prior_launches"], copy=self.c["copy"],
            netflow=(self.vsol - self.c["vsol0"]) / 1e9,
            mcap_sol=self.vsol / self.vtok * 1e6,
        )


def failed(f, F):
    """Names of the criteria a feature set fails."""
    out = []
    if f["dev_pct"] > F["dev_pct"]: out.append("dev holds too much")
    if f["dev_sell_s"] is not None and f["dev_sell_s"] < F["dev_sell_fast_s"]: out.append("dev sold at launch")
    if f["dev_sold_frac"] >= F["dev_sold_max"]: out.append("dev sold everything")
    if f["bundle_pct"] > F["bundle_pct"]: out.append("bundle")
    if f["sniper_pct"] > F["sniper_pct"]: out.append("snipers")
    if f["top10_pct"] > F["top10_pct"]: out.append("top10 concentration")
    if f["traders"] < F["min_traders"]: out.append("too few traders")
    if f["buys"] < F["min_buys"]: out.append("too few buys")
    if f["top3_trade_share"] > F["top3_trade_share"]: out.append("wash: top3 wallets")
    if f["same_size_share"] > F["same_size_share"]: out.append("wash: same sizes")
    if f["prior_launches"] > F["max_prior_launches"]: out.append("serial deployer")
    if f["copy"] and not F["copy"]: out.append("copy of earlier coin")
    if f["netflow"] < F["min_netflow"]: out.append("too little inflow")
    return out


def passes(f, F):
    return (f["dev_pct"] <= F["dev_pct"]
            and (f["dev_sell_s"] is None or f["dev_sell_s"] >= F["dev_sell_fast_s"])
            and f["dev_sold_frac"] < F["dev_sold_max"]
            and f["bundle_pct"] <= F["bundle_pct"] and f["sniper_pct"] <= F["sniper_pct"]
            and f["top10_pct"] <= F["top10_pct"] and f["traders"] >= F["min_traders"]
            and f["buys"] >= F["min_buys"] and f["top3_trade_share"] <= F["top3_trade_share"]
            and f["same_size_share"] <= F["same_size_share"]
            and f["prior_launches"] <= F["max_prior_launches"] and (F["copy"] or not f["copy"])
            and f["netflow"] >= F["min_netflow"])


def dip_ok(S, c, a):
    """Buy-the-dip signal: the coin first rose MIN_PEAK above its launch price, then fell DIP from that peak,
    and (if REBOUND > 0) has since bounced REBOUND off its low."""
    px = S.vsol / S.vtok
    if S.peak < c["vsol0"] / c["vtok0"] * (1 + a.min_peak) or S.low > S.peak * (1 - a.dip):
        return False
    return px >= S.low * (1 + a.rebound) if a.rebound > 0 else px <= S.peak * (1 - a.dip)


def buy_tokens(vsol, vtok, sol, fee):
    s = sol * 1e9 * (1 - fee)
    return vtok - vsol * vtok / (vsol + s)


def sell_value(vsol, vtok, q, fee, size, cost, s_in):
    """Our buy (s_in lamports in, q tokens out) is still in the curve: shift the event reserves by it."""
    vsol, vtok = vsol + s_in, vtok - q
    out = (vsol - vsol * vtok / (vtok + q)) / 1e9 * (1 - fee)
    return out - cost, (out - cost) / size - 1          # (SOL back after our own costs, return on size)


def simulate(c, a, F):
    """Return dict with approval features and the return path after entry, or None if never approved."""
    S = State(c)
    ev = c["ev"]
    L = c["slot"]
    lo, hi = L + int(a.min_age / SLOT_S), L + int(a.max_age / SLOT_S)
    flt = (lambda f: True) if a.nofilter else (lambda f: passes(f, F))
    ok = flt if a.dip is None else (lambda f: dip_ok(S, c, a) and flt(f))
    grad_slot = c["grad"]
    i = 0
    while i < len(ev) and ev[i][0] < lo:                 # everything before the window opens
        S.apply(ev[i][0], ev[i][2]); i += 1
    if grad_slot and grad_slot < lo:
        return None
    approve_slot, feat = None, None
    if S.n_buys:
        f = S.features()
        if ok(f):
            approve_slot, feat = lo, f
    while approve_slot is None and i < len(ev) and ev[i][0] <= hi:
        if grad_slot and ev[i][0] >= grad_slot:
            return None
        S.apply(ev[i][0], ev[i][2]); i += 1
        f = S.features()
        if ok(f):
            approve_slot, feat = ev[i - 1][0], f
    if approve_slot is None:
        if not S.n_buys:
            return {"rejected": ["no buys"]}
        why = [] if a.nofilter else failed(S.features(), F)
        return {"rejected": why or ["no dip signal"]}
    entry_slot = approve_slot + a.lat
    while i < len(ev) and ev[i][0] < entry_slot:
        S.apply(ev[i][0], ev[i][2]); i += 1
    if c["grad"] and c["grad"] < entry_slot:
        return None
    cost = a.net_cost
    q = buy_tokens(S.vsol, S.vtok, a.size, S.fee)
    s_in = a.size * 1e9 * (1 - S.fee)
    entry = dict(slot=entry_slot, mcap=S.vsol / S.vtok * 1e6, age_s=(entry_slot - L) * SLOT_S)
    path_s, path_r = [], []
    end = entry_slot + int(a.horizon / SLOT_S)
    v, r0 = sell_value(S.vsol, S.vtok, q, S.fee, a.size, 2 * cost, s_in)
    path_s.append(entry_slot); path_r.append(r0)
    grad = False
    while i < len(ev) and ev[i][0] <= end:
        if c["grad"] and ev[i][0] > c["grad"]:
            grad = True; break
        S.apply(ev[i][0], ev[i][2]); i += 1
        path_s.append(ev[i - 1][0]); path_r.append(sell_value(S.vsol, S.vtok, q, S.fee, a.size, 2 * cost, s_in)[1])
    if c["grad"] and c["grad"] <= end:
        grad = True
    return dict(feat=feat, entry=entry, s=path_s, r=path_r, grad=grad)


def exit_return(p, tp, sl, lat):
    """First TP/SL trigger, filled LAT slots later at the state then. Else last value in the horizon."""
    s, r = p["s"], p["r"]
    for k in range(1, len(r)):
        if r[k] >= tp or r[k] <= -sl:
            j = bisect.bisect_left(s, s[k] + lat) - 1
            j = max(j, k)
            return r[j], ("tp" if r[k] >= tp else "sl")
    return r[-1], ("grad" if p["grad"] else "time")


def hit_first(p, x, y):
    for v in p["r"][1:]:
        if v >= x:
            return True
        if v <= -y:
            return False
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", type=float, default=0.5, help="SOL per trade")
    ap.add_argument("--lat", type=int, default=5, help="slots between signal and fill (5 ≈ 2 s)")
    ap.add_argument("--net-cost", type=float, default=0.0015, help="SOL per transaction (priority fee + tip)")
    ap.add_argument("--min-age", type=float, default=30)
    ap.add_argument("--max-age", type=float, default=180)
    ap.add_argument("--horizon", type=float, default=7200, help="max hold in seconds")
    ap.add_argument("--nofilter", action="store_true", help="buy every coin at min-age (baseline)")
    ap.add_argument("--set", nargs="*", default=[], help="override filter values, e.g. dev_pct=0.1")
    ap.add_argument("--kind", choices=["normal", "mayhem"], default="normal",
                    help="normal coins, or Mayhem coins (agent-traded, simulated fills unreliable)")
    ap.add_argument("--dip", type=float, help="buy the dip: enter once the price fell this fraction from its peak")
    ap.add_argument("--min-peak", type=float, default=0.0, help="with --dip: peak must be this far above launch price")
    ap.add_argument("--rebound", type=float, default=0.0, help="with --dip: wait until price bounced this far off the low")
    a = ap.parse_args()
    F = dict(FILTER)
    for kv in a.set:
        k, v = kv.split("=")
        F[k] = (v.lower() == "true") if isinstance(F[k], bool) else type(F[k])(v)

    coins, gaps, t0, t1 = load()
    if not coins:
        print("no data yet"); return
    annotate_history(coins)
    need = a.max_age + a.horizon + 60
    usable, excl = [], collections.Counter()
    for c in coins.values():
        if c["quote"]:
            excl["quoted in another token"] += 1; continue
        if bool(c["flag"]) != (a.kind == "mayhem"):
            excl["other kind (normal / mayhem)"] += 1; continue
        if c["ts"] + need > t1:
            excl["too recent (window not complete)"] += 1; continue
        if c["broken"] is not None and c["broken"] <= c["slot"] + need / SLOT_S:
            excl["trade missing from the data"] += 1; continue
        usable.append(c)
    sol = [c for c in coins.values() if not c["quote"]]
    print(f"data completeness: {sum(c['broken'] is None for c in sol) / max(1, len(sol)):.0%} of SOL coins have an "
          f"unbroken trade chain (needs to be high, see check_feed.py)")
    print(f"data {((t1 - t0) / 3600):.1f} h | launches {len(coins)} | usable {len(usable)} | excluded {dict(excl)}")
    mode = 'filter v1' if not a.nofilter else 'NO FILTER' if a.dip is not None else \
        'NO FILTER (buy every coin at ' + str(a.min_age) + ' s)'
    if a.dip is not None:
        mode += f" + dip {a.dip:.0%} from a peak >= +{a.min_peak:.0%}" + (f", rebound {a.rebound:.0%}" if a.rebound else "")
    print(f"{a.kind} coins | mode: {mode} | "
          f"size {a.size} SOL | latency {a.lat} slots ({a.lat * SLOT_S:.1f} s) | horizon {a.horizon / 60:.0f} min")
    if a.kind == "mayhem":
        print("WARNING: Mayhem fills are rough (the agent moves the curve in jumps) - treat results as indicative only")
    sims = [simulate(c, a, F) for c in usable]
    res = [p for p in sims if p and "rejected" not in p]
    why = collections.Counter(r for p in sims if p and "rejected" in p for r in p["rejected"])
    if why:
        print("rejections (a coin can fail several):", ", ".join(f"{k} {v}" for k, v in why.most_common()))
    print(f"approved: {len(res)} of {len(usable)} ({len(res) / max(1, len(usable)):.1%}); "
          f"graduated later: {sum(p['grad'] for p in res)}")
    if not res:
        return
    ages = [p["entry"]["age_s"] for p in res]; mc = [p["entry"]["mcap"] for p in res]
    print(f"entry age median {st.median(ages):.0f} s, entry market cap median {st.median(mc):.0f} SOL")

    print("\nHow often is +X% reached before -Y%?  (after fees, our size, our latency)")
    print("        " + "".join(f"{'+' + str(int(x * 100)) + '%':>8}" for x in TPS))
    for y in SLS:
        row = []
        for x in TPS:
            h = [hit_first(p, x, y) for p in res]
            row.append(sum(v is True for v in h) / len(h))
        print(f"-{int(y * 100):>2}% SL " + "".join(f"{v:>8.0%}" for v in row))

    print("\nFixed TP / SL (exit filled after latency):")
    print(f"{'TP':>6} {'SL':>5} {'n':>5} {'win':>5} {'avg':>7} {'median':>7} {'total SOL':>10}  exits")
    for y in SLS:
        for x in TPS:
            out = [exit_return(p, x, y, a.lat) for p in res]
            rets = [o[0] for o in out]
            why = collections.Counter(o[1] for o in out)
            print(f"+{int(x * 100):>4}% -{int(y * 100):>2}% {len(rets):>5} {sum(v > 0 for v in rets) / len(rets):>5.0%} "
                  f"{st.mean(rets):>+7.1%} {st.median(rets):>+7.1%} {sum(rets) * a.size:>+10.2f}  {dict(why)}")


if __name__ == "__main__":
    main()
