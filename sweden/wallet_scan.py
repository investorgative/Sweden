"""Profile a wallet from free public RPC and test whether copying it would have worked.

For every token the wallet opened *and* closed inside the scanned window:
  * bot return   = its own effective sell price / effective buy price - 1 (fees, tips included)
  * copy return  = price of the first OTHER trader's buy  >= d slots after the bot's first buy,
                   price of the first OTHER trader's sell >= d slots after the bot's first sell,
                   for d in DELAYS (1 slot ~ 0.4 s). Prices are effective prices of real swaps, so the
                   pool fee is inside them. Only swaps >= MIN_REF_SOL are used as reference so that a
                   tiny trade's priority fee does not distort the price.

Usage:  python sweden/wallet_scan.py <wallet> [--max 600] [--trades 40]
Writes results/<wallet>.json and prints a summary.
"""
import argparse, json, os, statistics as st, sys, time
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(__file__))
import rpc
from swaps import swap_of, signers_of, deltas

DELAYS = [1, 2, 5, 25]          # slots after the bot (0.4 s, 0.8 s, 2 s, 10 s)
WINDOW = 60                     # how far after the bot we look for reference trades (slots)
MIN_REF_SOL = 0.2
THREADS = 4
OUT = os.path.join(os.path.dirname(__file__), "..", "results")


def fetch_many(sigs):
    with ThreadPoolExecutor(THREADS) as ex:
        return list(ex.map(rpc.transaction, sigs))


def wallet_history(wallet, max_sigs):
    sigs, before = [], None
    while len(sigs) < max_sigs:
        page = rpc.signatures(wallet, limit=min(1000, max_sigs - len(sigs)), before=before)
        if not page:
            break
        sigs += page
        before = page[-1]["signature"]
    sigs.sort(key=lambda s: s["slot"])
    return sigs


def build_trades(wallet, sigs, txs):
    """Group swaps per mint into round trips (open -> position back to ~0)."""
    pos, open_, trades, cost = {}, {}, [], {"failed_tx": 0, "failed_sol": 0.0, "other_sol": 0.0}
    for s, tx in zip(sigs, txs):
        if tx is None:
            continue
        if tx["meta"].get("err") is not None:
            cost["failed_tx"] += 1
            cost["failed_sol"] += -deltas(tx, wallet)[0]
            continue
        sw = swap_of(tx, wallet)
        if not sw:
            cost["other_sol"] += deltas(tx, wallet)[0]
            continue
        m = sw["mint"]
        if m not in open_:
            if sw["side"] == "sell":          # position opened before our window: ignore
                continue
            open_[m] = {"mint": m, "buy_sol": 0, "buy_tok": 0, "sell_sol": 0, "sell_tok": 0,
                        "first_buy": None, "first_sell": None, "last_sell": None, "n_buys": 0, "n_sells": 0}
            pos[m] = 0.0
        t = open_[m]
        ev = {"sig": s["signature"], "slot": s["slot"], "time": s.get("blockTime")}
        if sw["side"] == "buy":
            t["buy_sol"] += sw["sol"]; t["buy_tok"] += sw["tokens"]; t["n_buys"] += 1
            t["first_buy"] = t["first_buy"] or ev
            pos[m] += sw["tokens"]
        else:
            t["sell_sol"] += sw["sol"]; t["sell_tok"] += sw["tokens"]; t["n_sells"] += 1
            t["first_sell"] = t["first_sell"] or ev
            t["last_sell"] = ev
            pos[m] -= sw["tokens"]
        if pos[m] <= 0.02 * t["buy_tok"] and t["n_sells"]:
            trades.append(open_.pop(m))
    return trades, list(open_.values()), cost


def anchor_after(sigs, slot):
    """A signature of the wallet at least WINDOW slots after `slot` (used as `before` anchor)."""
    for s in sigs:
        if s["slot"] >= slot + WINDOW:
            return s["signature"]
    return None


def reference_prices(mint, wallet, start, anchor, side):
    """First other-trader `side` price at >= start.slot + d for each delay d."""
    if anchor is None:
        return {}
    got, before = [], anchor
    for _ in range(3):                       # at most 3,000 signatures in the window
        page = rpc.signatures(mint, before=before, until=start["sig"])
        if not page:
            break
        got += page
        before = page[-1]["signature"]
        if len(page) < 1000:
            break
    got = sorted((g for g in got if g["err"] is None and g["slot"] > start["slot"]), key=lambda g: g["slot"])
    out, need, fetched = {}, list(DELAYS), 0
    for g in got:
        need = [d for d in need if d not in out]
        if not need or fetched >= 40:
            break
        if g["slot"] < start["slot"] + min(need):
            continue
        tx = rpc.transaction(g["signature"]); fetched += 1
        if tx is None:
            continue
        for who in signers_of(tx)[:1]:
            if who == wallet:
                continue
            sw = swap_of(tx, who)
            if sw and sw["mint"] == mint and sw["side"] == side and sw["sol"] >= MIN_REF_SOL:
                for d in need:
                    if g["slot"] >= start["slot"] + d and d not in out:
                        out[d] = {"price": sw["price"], "slot": g["slot"]}
    return out


def scan(wallet, max_sigs, max_trades):
    t0 = time.time()
    sigs = wallet_history(wallet, max_sigs)
    print(f"{wallet[:8]}: {len(sigs)} signatures, fetching transactions …", flush=True)
    txs = fetch_many([s["signature"] for s in sigs])
    trades, still_open, cost = build_trades(wallet, sigs, txs)
    span_h = (sigs[-1]["blockTime"] - sigs[0]["blockTime"]) / 3600 if len(sigs) > 1 else 0
    print(f"  {len(trades)} closed trades, {len(still_open)} open, window {span_h:.1f} h; delay test …", flush=True)

    for t in trades[-max_trades:]:
        b = t["buy_sol"] / t["buy_tok"]; s_ = t["sell_sol"] / t["sell_tok"]
        t["bot_ret"] = s_ / b - 1
        t["hold_s"] = (t["first_sell"]["time"] or 0) - (t["first_buy"]["time"] or 0)
        eb = reference_prices(t["mint"], wallet, t["first_buy"], anchor_after(sigs, t["first_buy"]["slot"]), "buy")
        es = reference_prices(t["mint"], wallet, t["first_sell"], anchor_after(sigs, t["first_sell"]["slot"]), "sell")
        t["copy_ret"] = {d: (es[d]["price"] / eb[d]["price"] - 1) if d in eb and d in es else None for d in DELAYS}
    for t in trades[:-max_trades] if len(trades) > max_trades else []:
        t["bot_ret"] = (t["sell_sol"] / t["sell_tok"]) / (t["buy_sol"] / t["buy_tok"]) - 1
        t["hold_s"] = (t["first_sell"]["time"] or 0) - (t["first_buy"]["time"] or 0)

    pnl = sum(t["sell_sol"] - t["buy_sol"] for t in trades)
    res = {"wallet": wallet, "scanned_at": int(time.time()), "n_sigs": len(sigs), "window_h": span_h,
           "first_slot": sigs[0]["slot"] if sigs else None, "last_slot": sigs[-1]["slot"] if sigs else None,
           "closed_trades": len(trades), "open_positions": len(still_open), "realized_pnl_sol": pnl,
           "volume_sol": sum(t["buy_sol"] for t in trades), "costs": cost, "trades": trades,
           "runtime_s": round(time.time() - t0)}
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, f"{wallet}.json"), "w") as f:
        json.dump(res, f, indent=1)
    return res


def summarize(r):
    T = r["trades"]
    print(f"\n=== {r['wallet']}")
    if not T:
        print("  no closed trades in window"); return
    rets = [t["bot_ret"] for t in T]
    holds = [t["hold_s"] for t in T]
    sizes = [t["buy_sol"] for t in T]
    print(f"  window {r['window_h']:.1f} h, {r['n_sigs']} tx, {len(T)} closed trades, "
          f"{r['costs']['failed_tx']} failed tx ({r['costs']['failed_sol']:.3f} SOL)")
    print(f"  realized PnL {r['realized_pnl_sol']:+.3f} SOL on {r['volume_sol']:.2f} SOL bought "
          f"({r['realized_pnl_sol'] / max(r['volume_sol'], 1e-9):+.1%})")
    print(f"  per trade: win {sum(x > 0 for x in rets) / len(rets):.0%}, median {st.median(rets):+.1%}, "
          f"mean {st.mean(rets):+.1%}; size median {st.median(sizes):.3f} SOL; hold median {st.median(holds):.0f} s")
    tested = [t for t in T if "copy_ret" in t]
    for d in DELAYS:
        pairs = [(t["bot_ret"], t["copy_ret"][d]) for t in tested if t["copy_ret"].get(d) is not None]
        if pairs:
            c = [p[1] for p in pairs]; b = [p[0] for p in pairs]
            print(f"  copy +{d:>2} slots ({d * 0.4:>4.1f}s): n={len(c):>3}  bot mean {st.mean(b):+6.1%}  "
                  f"copy mean {st.mean(c):+6.1%}  copy median {st.median(c):+6.1%}  copy win {sum(x > 0 for x in c) / len(c):.0%}")
        else:
            print(f"  copy +{d} slots: no reference trades found")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("wallets", nargs="+")
    ap.add_argument("--max", type=int, default=600, help="signatures to scan per wallet")
    ap.add_argument("--trades", type=int, default=40, help="most recent closed trades to delay-test")
    a = ap.parse_args()
    for w in a.wallets:
        summarize(scan(w, a.max, a.trades))
