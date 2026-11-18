"""Turn a parsed Solana transaction into per-owner SOL and token changes.

SOL change = lamport change of the owner's system account + change of its wrapped-SOL token accounts.
It includes network fee, priority fee and tips when the owner pays them, so prices derived from it
are *effective* prices (what the trader really paid / received).
"""
WSOL = "So11111111111111111111111111111111111111112"


def keys_of(tx):
    return [k["pubkey"] if isinstance(k, dict) else k for k in tx["transaction"]["message"]["accountKeys"]]


def signers_of(tx):
    ks = tx["transaction"]["message"]["accountKeys"]
    return [k["pubkey"] for k in ks if isinstance(k, dict) and k.get("signer")]


def deltas(tx, owner):
    """Return (sol_delta, {mint: token_delta}) for `owner`."""
    meta = tx["meta"]
    keys = keys_of(tx)
    sol = 0.0
    if owner in keys:
        i = keys.index(owner)
        sol += (meta["postBalances"][i] - meta["preBalances"][i]) / 1e9
    tok = {}
    for side, sign in (("preTokenBalances", -1), ("postTokenBalances", 1)):
        for b in meta.get(side) or []:
            if b.get("owner") != owner:
                continue
            amt = float(b["uiTokenAmount"].get("uiAmount") or 0)
            tok[b["mint"]] = tok.get(b["mint"], 0.0) + sign * amt
    w = tok.pop(WSOL, 0.0)
    sol += w
    return sol, {m: v for m, v in tok.items() if abs(v) > 0}


def swap_of(tx, owner):
    """Classify the owner's activity in tx as a buy or sell of one token, else None.
    Returns dict(side, mint, sol, tokens, price) with sol>0 (spent or received) and price in SOL/token."""
    if tx is None or tx["meta"].get("err") is not None:
        return None
    sol, tok = deltas(tx, owner)
    if len(tok) != 1:
        return None
    mint, t = next(iter(tok.items()))
    if t > 0 and sol < 0:
        return {"side": "buy", "mint": mint, "sol": -sol, "tokens": t, "price": -sol / t}
    if t < 0 and sol > 0:
        return {"side": "sell", "mint": mint, "sol": sol, "tokens": -t, "price": sol / -t}
    return None
