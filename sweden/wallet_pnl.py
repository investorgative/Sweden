"""SWEDEN wallet PnL — who actually makes money trading pump.fun curves, from the collector's data.

Uses each wallet's own fills (no simulation), so it also works for Mayhem coins where the replay's fills are rough.
A position the wallet still holds is valued at the coin's last curve price, so wallets that keep dead bags are
not flattered. Per wallet: coins traded, PnL after fees, win rate, typical size, entry age (seconds after launch),
entry market cap, holding time.

Usage:  python3 sweden/wallet_pnl.py [--kind normal|mayhem] [--min-coins 30] [--top 15] [--wallet <address>]
"""
import argparse, collections, glob, gzip, json, os, statistics as st

DATA = os.environ.get("SWEDEN_DATA", os.path.join(os.path.dirname(__file__), "..", "data"))
SLOT_S = 0.4
TX_COST = 0.0015                 # SOL per transaction, assumed (priority fee / tip), as in replay.py


def load(kind):
    coins, pos = {}, {}
    for f in sorted(glob.glob(os.path.join(DATA, "*", "events-*.jsonl.gz"))):
        try:
            for line in gzip.open(f, "rt"):
                try:
                    r = json.loads(line)
                except Exception:
                    continue                         # truncated last line of a running file
                slot, kind_, mint = r[0], r[2], r[4]
                if kind_ == "C":
                    if not r[12] and bool(r[13]) == (kind == "mayhem"):
                        coins[mint] = dict(slot=slot, vsol=r[10], vtok=r[11], fee=0.0125)
                    continue
                if kind_ != "T" or mint not in coins:
                    continue
                _, _, _, ts, _, user, buy, sol, tok, vsol, vtok, fee_bps, cfee_bps, ix = r
                c = coins[mint]
                c["vsol"], c["vtok"] = vsol, vtok
                if fee_bps == 0:                     # fee-free agent wallet (Mayhem) - not a competitor
                    continue
                fee = (fee_bps + cfee_bps) / 1e4
                c["fee"] = fee
                p = pos.get((user, mint))
                if p is None:
                    p = pos[(user, mint)] = dict(cost=0.0, back=0.0, tok=0, n=0, first=slot, last=slot,
                                                 mcap=vsol / vtok * 1e6)
                p["n"] += 1; p["last"] = slot
                if buy:
                    p["cost"] += sol / 1e9 * (1 + fee); p["tok"] += tok
                else:
                    p["back"] += sol / 1e9 * (1 - fee); p["tok"] -= tok
        except (EOFError, OSError):
            continue                                 # file still being written
    return coins, pos


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--kind", choices=["normal", "mayhem"], default="normal")
    ap.add_argument("--min-coins", type=int, default=30)
    ap.add_argument("--min-size", type=float, default=0.05, help="ignore positions with less SOL in than this")
    ap.add_argument("--top", type=int, default=15)
    ap.add_argument("--wallet", help="show this wallet's trades coin by coin")
    a = ap.parse_args()
    coins, pos = load(a.kind)
    W = collections.defaultdict(list)
    for (w, m), p in pos.items():
        if p["cost"] < a.min_size:
            continue
        c = coins[m]
        q = max(p["tok"], 0)                                  # still holding: what selling it on the last curve returns
        held = (c["vsol"] - c["vsol"] * c["vtok"] / (c["vtok"] + q)) / 1e9 * (1 - c["fee"])
        pnl = p["back"] + held - p["cost"] - TX_COST * p["n"]
        W[w].append(dict(mint=m, pnl=pnl, ret=pnl / p["cost"], size=p["cost"], open=p["tok"] > 0,
                         age=(p["first"] - c["slot"]) * SLOT_S, hold=(p["last"] - p["first"]) * SLOT_S, mcap=p["mcap"]))
    allp = [x for v in W.values() for x in v]
    print(f"{a.kind} coins {len(coins)} | positions {len(allp)} | wallets {len(W)} | sum (each held bag valued as if "
          f"sold alone, so it overstates when many hold one coin) "
          f"{sum(x['pnl'] for x in allp):+.1f} SOL | win rate {sum(x['pnl'] > 0 for x in allp) / max(1, len(allp)):.0%}")
    if a.wallet:
        for x in sorted(W.get(a.wallet, []), key=lambda x: x["age"]):
            print(f"  {x['mint'][:10]} size {x['size']:.3f} entry {x['age']:>7.1f} s after launch, mcap {x['mcap']:>6.1f} SOL,"
                  f" hold {x['hold']:>6.0f} s, pnl {x['pnl']:+.3f} SOL ({x['ret']:+.0%}){' OPEN' if x['open'] else ''}")
        return
    act = {w: v for w, v in W.items() if len(v) >= a.min_coins}
    print(f"wallets with >= {a.min_coins} coins: {len(act)}, profitable: {sum(sum(x['pnl'] for x in v) > 0 for v in act.values())}\n")
    print(f"{'wallet':10} {'coins':>5} {'pnl SOL':>8} {'win':>4} {'med ret':>7} {'size':>5} {'entry s':>7} "
          f"{'mcap':>5} {'hold s':>6} {'open':>4}")
    for w, v in sorted(act.items(), key=lambda kv: -sum(x["pnl"] for x in kv[1]))[:a.top]:
        md = lambda k: st.median(x[k] for x in v)
        print(f"{w[:10]} {len(v):>5} {sum(x['pnl'] for x in v):>+8.2f} {sum(x['pnl'] > 0 for x in v) / len(v):>4.0%} "
              f"{md('ret'):>+7.1%} {md('size'):>5.2f} {md('age'):>7.0f} {md('mcap'):>5.0f} {md('hold'):>6.0f} "
              f"{sum(x['open'] for x in v):>4}")


if __name__ == "__main__":
    main()
