"""SWEDEN graduation replay — the manual "freshly graduated dip" strategy, on recorded PumpSwap trades.

Rules (all thresholds are options):
  1. the coin graduated to PumpSwap (SOL pool) and passes the on-chain checks at graduation (filter v1 without the
     dev-sell and activity checks: bundle, snipers, top-10, wash trading, serial deployer, copied name; --nofilter
     switches them off). The meme / socials check of a human trader is not in the data.
  2. after graduation the price falls DD_MIN..DD_MAX (default 30-75 %) from its post-graduation high; deeper than
     DD_MAX means dead, the coin is dropped;
  3. it bounces at least BOUNCE (default 20 %) off the low (the first move up);
  4. it pulls back PULLBACK (default 10 %) from that bounce high without breaking the low -> buy. A break of the
     low makes it the new low (wait for a new bounce); a new high above the old one starts over at step 2;
  5. market cap at the signal at most MAX_MCAP_USD (default 100k); the signal must come within WINDOW after graduation;
  6. exit at TP or SL, 1:1 (+X % / -X % on what selling returns, after fees), or after HORIZON.
Fills: LAT slots after the signal / exit trigger with every trade in between applied first, constant-product pool
using the reserves reported by the swap events (pool base, pool quote + virtual quote), PumpSwap fee from the
events on both sides, our own buy stays in the pool, NET_COST SOL per transaction.

Usage:  python3 sweden/grad_replay.py [--kind normal|mayhem] [--dd-min 0.3 --dd-max 0.75 --bounce 0.2
          --pullback 0.1] [--tp 0.25 0.35 0.5] [--max-mcap-usd 100000] [--sol-usd 140] [--window 7200]
          [--horizon 14400] [--size 0.5] [--lat 5] [--nofilter] [--at 60]   (--at N: baseline, buy N s after graduation)
"""
import argparse, bisect, json, os, statistics as st, sys, urllib.request

sys.path.insert(0, os.path.dirname(__file__))
import replay as R

WSOL = "So11111111111111111111111111111111111111112"
SKIP = {"dev holds too much", "dev sold at launch", "dev sold everything", "too few traders", "too few buys",
        "too little inflow", "no buys"}            # not applied at graduation (dev sells: the trader ignores them)


def sol_usd():
    try:
        u = "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd"
        return float(json.load(urllib.request.urlopen(u, timeout=10))["solana"]["usd"])
    except Exception:
        return None


def pool_path(c):
    """Per swap: slot, pool base reserves and effective quote reserves AFTER the swap, fee."""
    sw = c["sw"]
    out = []
    for k, (slot, _, r) in enumerate(sw):
        if k + 1 < len(sw):                          # events carry pre-trade reserves: the next one's are ours
            nb, nq, nv = sw[k + 1][2][9], sw[k + 1][2][10], sw[k + 1][2][11]
        else:
            buy, base, quote = r[6], r[7], r[8]
            nb = r[9] - base if buy else r[9] + base
            nq, nv = (r[10] + quote if buy else r[10] - quote), r[11]
        out.append((slot, nb, nq + nv, r[12] / 1e4))
    return out


def value(Q, B, q, s_in, fee):
    """SOL (lamports) back for selling our q tokens, our buy (s_in lamports in) still in the pool."""
    Q, B = Q + s_in, B - q
    return Q * q / (B + q) * (1 - fee)


def signal(path, a, mcap_cap_sol, grad_slot):
    """First slot at which the dip / bounce / pullback pattern fires, or None."""
    peak, low, hi, mode = 0.0, None, None, "drop"
    end = grad_slot + int(a.window / R.SLOT_S)
    for slot, B, Q, _ in path:
        if slot > end or B <= 0:
            return None
        p = Q / B
        if p > peak:
            peak, low, hi, mode = p, None, None, "drop"
            continue
        dd = 1 - p / peak
        if dd > a.dd_max:
            return None                              # dead
        if mode == "drop":
            if dd >= a.dd_min:
                low = p if low is None else min(low, p)
                if p >= low * (1 + a.bounce):
                    mode, hi = "bounce", p
            continue
        if p < low:                                  # broke the low: new low, wait for a new bounce
            low, mode = p, "drop"
            continue
        hi = max(hi, p)
        if p <= hi * (1 - a.pullback) and p * 1e6 <= mcap_cap_sol:
            return slot
    return None


def trade(path, sig_slot, a, tp, sl):
    slots = [x[0] for x in path]
    es = sig_slot + a.lat
    j = max(0, bisect.bisect_left(slots, es) - 1)    # state at our fill
    _, B, Q, fee = path[j]
    s_in = a.size * 1e9 * (1 - fee)
    q = B - B * Q / (Q + s_in)
    cost = 2 * a.net_cost
    ret = lambda k: (value(path[k][2], path[k][1], q, s_in, path[k][3]) / 1e9 - cost) / a.size - 1
    end = es + int(a.horizon / R.SLOT_S)
    for k in range(j + 1, len(path)):
        if slots[k] > end:
            return ret(k - 1), "time"
        r = ret(k)
        if r >= tp or r <= -sl:
            f = max(k, bisect.bisect_left(slots, slots[k] + a.lat) - 1)
            return ret(f), "tp" if r >= tp else "sl"
    return ret(len(path) - 1), "end"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--kind", choices=["normal", "mayhem"], default="normal")
    ap.add_argument("--dd-min", type=float, default=0.30)
    ap.add_argument("--dd-max", type=float, default=0.75)
    ap.add_argument("--bounce", type=float, default=0.20)
    ap.add_argument("--pullback", type=float, default=0.10)
    ap.add_argument("--tp", type=float, nargs="+", default=[0.25, 0.35, 0.5], help="TP = SL (1:1)")
    ap.add_argument("--max-mcap-usd", type=float, default=100000)
    ap.add_argument("--sol-usd", type=float, help="SOL price in USD (default: CoinGecko now)")
    ap.add_argument("--window", type=float, default=7200, help="signal must come within this many s of graduation")
    ap.add_argument("--horizon", type=float, default=14400, help="max hold in seconds")
    ap.add_argument("--size", type=float, default=0.5)
    ap.add_argument("--lat", type=int, default=5)
    ap.add_argument("--net-cost", type=float, default=0.0015)
    ap.add_argument("--nofilter", action="store_true")
    ap.add_argument("--at", type=float, help="baseline: buy this many seconds after graduation, no pattern")
    a = ap.parse_args()
    usd = a.sol_usd or sol_usd()
    if not usd:
        sys.exit("could not fetch the SOL price - pass --sol-usd")
    cap_sol = a.max_mcap_usd / usd

    coins, _, t0, t1 = R.load()
    R.annotate_history(coins)
    gp = os.path.join(R.DATA, "gaps_swap.jsonl")
    gaps = [json.loads(l) for l in open(gp) if l.strip()] if os.path.exists(gp) else []
    excl, cands = {}, []
    def x(k): excl[k] = excl.get(k, 0) + 1
    for c in coins.values():
        p = c["pool"]
        if not c["grad"] or p is None:
            continue
        if p[6] != WSOL:
            x("pool not quoted in SOL"); continue
        if bool(c["flag"]) != (a.kind == "mayhem"):
            x("other kind (normal / mayhem)"); continue
        g_ts = p[3]
        if g_ts + a.window + a.horizon > t1:
            x("too recent (window + horizon not complete)"); continue
        if any(g["from"] <= g_ts + a.window + a.horizon and g["to"] >= g_ts - 5 for g in gaps):
            x("PumpSwap collector gap"); continue
        if not c["sw"]:
            x("no swaps"); continue
        if not a.nofilter:
            S = R.State(c)
            for e in c["ev"]:
                S.apply(e[0], e[2])
            bad = [r for r in R.failed(S.features(), R.FILTER) if r not in SKIP]
            if bad:
                for r in bad:
                    x("filter: " + r)
                continue
        cands.append(c)
    n_grad = sum(1 for c in coins.values() if c["grad"] and c["pool"] is not None)
    print(f"data {(t1 - t0) / 3600:.1f} h | graduations with PumpSwap data {n_grad} | usable {len(cands)} | "
          f"excluded (a coin can count twice under filter) {excl}")
    mode = (f"baseline: buy {a.at:.0f} s after graduation" if a.at is not None else
            f"dip {a.dd_min:.0%}-{a.dd_max:.0%} from the post-graduation high, bounce {a.bounce:.0%}, "
            f"pullback {a.pullback:.0%}, mcap <= ${a.max_mcap_usd:,.0f} ({cap_sol:.0f} SOL at ${usd:.0f})")
    print(f"{a.kind} coins | {mode} | filter {'off' if a.nofilter else 'on'} | size {a.size} SOL | "
          f"latency {a.lat} slots | window {a.window / 3600:.1f} h | horizon {a.horizon / 3600:.1f} h")

    sigs = []
    for c in cands:
        path = pool_path(c)
        g = c["pool"][0]
        s = g + int(a.at / R.SLOT_S) if a.at is not None else signal(path, a, cap_sol, g)
        if s is not None and s + a.lat < path[-1][0]:
            sigs.append((c, path, s))
    print(f"signals: {len(sigs)} of {len(cands)} coins"
          + (f" | median signal {st.median((s - c['pool'][0]) * R.SLOT_S for c, _, s in sigs) / 60:.0f} min after "
             f"graduation, median mcap ${st.median(p[bisect.bisect_left([x[0] for x in p], s) - 1][2] / p[bisect.bisect_left([x[0] for x in p], s) - 1][1] * 1e6 for _, p, s in sigs) * usd:,.0f}"
             if sigs else ""))
    if not sigs:
        return
    mid = st.median(c["ts"] for c, _, _ in sigs)
    print(f"\n{'TP / SL':>9} {'n':>5} {'win':>5} {'avg':>7} {'median':>7} {'total SOL':>10} | "
          f"{'1st half avg':>12} {'2nd half avg':>12}  exits")
    for tp in a.tp:
        res = [(c["ts"] < mid,) + trade(p, s, a, tp, tp) for c, p, s in sigs]
        r = [x[1] for x in res]
        h1 = [x[1] for x in res if x[0]]; h2 = [x[1] for x in res if not x[0]]
        ex = {}
        for x in res:
            ex[x[2]] = ex.get(x[2], 0) + 1
        print(f"+{tp:.0%}/-{tp:.0%} {len(r):>5} {sum(v > 0 for v in r) / len(r):>5.0%} {st.mean(r):>+7.1%} "
              f"{st.median(r):>+7.1%} {sum(r) * a.size:>+10.2f} | {st.mean(h1) if h1 else 0:>+12.1%} "
              f"{st.mean(h2) if h2 else 0:>+12.1%}  {ex}")


if __name__ == "__main__":
    main()
