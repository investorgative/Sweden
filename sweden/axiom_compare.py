"""Which of our metric variants matches what Axiom shows? Reads data/axiom_checks.jsonl (saved from the terminal's
"Axiom" button: Axiom's numbers next to ours at the same moment) and prints, per Axiom field and variant, the typical
gap in percentage points. The variant with the smallest gap (and a bias near 0) is the one to filter on.

Usage:  python3 sweden/axiom_compare.py [--show]   (--show lists every reading)
"""
import json, os, statistics as st, sys

sys.path.insert(0, os.path.dirname(__file__))
import replay as R

CANDIDATES = {
    "top10": ["top10", "grad:top10_pct"],
    "dev": ["dev", "grad:dev_pct"],
    "snipers": ["snipers_1_3", "snipers_0_10", "grad:sniper_pct"],
    "bundlers": ["bundle_launch", "bundle_launch_nodev", "bundle_2", "bundle_4", "grad:bundle_pct"],
    "holders": ["holders"],
    "insiders": [],                     # needs funding / transfer data, not in the collector yet
}


def ours(rec, key):
    v = rec["at_grad"].get(key[5:]) if key.startswith("grad:") else rec["ours"].get(key)
    return None if v is None else v if key == "holders" else v * 100   # Axiom shows percent


def main():
    path = os.path.join(R.DATA, "axiom_checks.jsonl")
    recs = [json.loads(l) for l in open(path) if l.strip()] if os.path.exists(path) else []
    print(f"{len(recs)} Axiom readings in {path}")
    if "--show" in sys.argv:
        for r in recs:
            print(f"  {r['sym'][:12]:12} {r['mint'][:6]}  axiom {r['axiom']}  ours "
                  + " ".join(f"{k}={ours(r, k):.1f}" for k in sum(CANDIDATES.values(), []) if ours(r, k) is not None))
    for field, keys in CANDIDATES.items():
        rows = [r for r in recs if field in r["axiom"]]
        if not rows:
            continue
        print(f"\n{field} ({len(rows)} readings)" + ("" if keys else ": nothing to compare with yet"))
        for k in keys:
            d = [ours(r, k) - r["axiom"][field] for r in rows if ours(r, k) is not None]
            if d:
                print(f"  {k:22} typical gap {st.median(abs(x) for x in d):6.1f}  bias {st.median(d):+6.1f}  "
                      f"within 2 points: {sum(abs(x) <= 2 for x in d)}/{len(d)}")
    if len(recs) < 10:
        print("\nfewer than 10 readings: too few to decide, keep adding them")


if __name__ == "__main__":
    main()
