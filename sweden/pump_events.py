"""Decode pump.fun bonding-curve and PumpSwap (pump.fun AMM) events from transaction logs.

pump.fun (program 6EF8…) and PumpSwap (pAMM…) emit Anchor events as "Program data: <base64>" log lines.
Only lines emitted while that program itself is the executing program are decoded.
Layouts follow the official IDLs (github.com/pump-fun/pump-public-docs, idl/pump.json and idl/pump_amm.json).

Price on the curve: price (SOL per token) = (vsol / 1e9) / (vtok / 1e6),
market cap in SOL = vsol / vtok * 1e6 (supply is 1e9 tokens with 6 decimals; start ≈ 28 SOL).
"""
import base64, hashlib, re, struct

PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
AMM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"     # PumpSwap, where coins trade after graduation
WSOL = "So11111111111111111111111111111111111111112"
NO_CREATOR = "11111111111111111111111111111111"   # coin creator of a PumpSwap pool that was not made by a pump.fun
                                                  # migration (anyone can open a pool for any token)
_A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
_INV = re.compile(r"Program (\w+) invoke \[\d+\]")
_FIN = re.compile(r"Program (\w+) (success|failed)")


def _disc(name):
    return hashlib.sha256(f"event:{name}".encode()).digest()[:8]


TRADE, CREATE, COMPLETE = _disc("TradeEvent"), _disc("CreateEvent"), _disc("CompleteEvent")
SWAP_BUY, SWAP_SELL, POOL = _disc("BuyEvent"), _disc("SellEvent"), _disc("CreatePoolEvent")


def b58(b):
    n = int.from_bytes(b, "big"); s = ""
    while n:
        n, r = divmod(n, 58); s = _A[r] + s
    return "1" * (len(b) - len(b.lstrip(b"\0"))) + s


class _R:
    def __init__(self, b): self.b, self.o = b, 8
    def pk(self): v = b58(self.b[self.o:self.o + 32]); self.o += 32; return v
    def raw(self, n): v = self.b[self.o:self.o + n]; self.o += n; return v
    def u64(self): v = struct.unpack_from("<Q", self.b, self.o)[0]; self.o += 8; return v
    def i64(self): v = struct.unpack_from("<q", self.b, self.o)[0]; self.o += 8; return v
    def u8(self): v = self.b[self.o]; self.o += 1; return v
    def u16(self): v = struct.unpack_from("<H", self.b, self.o)[0]; self.o += 2; return v
    def i128(self): v = int.from_bytes(self.b[self.o:self.o + 16], "little", signed=True); self.o += 16; return v
    def s(self):
        n = struct.unpack_from("<I", self.b, self.o)[0]
        v = self.b[self.o + 4:self.o + 4 + n].decode("utf8", "replace"); self.o += 4 + n; return v


def pump_data_lines(logs, programs=(PUMP, AMM)):
    """Yield base64 payloads of 'Program data:' lines emitted by pump.fun or PumpSwap itself."""
    st = []
    for l in logs:
        m = _INV.match(l)
        if m:
            st.append(m.group(1)); continue
        if _FIN.match(l):
            if st: st.pop()
            continue
        if st and st[-1] in programs and l.startswith("Program data: "):
            yield l[14:]


def decode(payload):
    """Return a compact record (list) or None. Records:
    ["C", ts, mint, creator, signer, name, symbol, uri, vsol, vtok, quote, flag]
    ["T", ts, mint, user, is_buy, sol, tok, vsol, vtok, fee_bps, creator_fee_bps, ix]
    ["G", ts, mint, user]                    (curve complete = graduation)
    `quote` is '' for SOL-quoted coins, else the quote mint (then sol/vsol are not SOL). `flag` is is_mayhem_mode.
    PumpSwap (after graduation):
    ["P", ts, mint, pool, quote_mint, base, quote, coin_creator, mayhem]      pool created (migration)
    ["S", ts, pool, user, is_buy, base, quote, pool_base, pool_quote, vquote, fee_bps, ix]
        base / quote: tokens bought or sold and the quote (SOL) the user paid or received, fees included;
        pool_base / pool_quote / vquote: pool reserves and virtual quote reserves as reported by the event;
        fee_bps: lp + protocol + creator fee. The collector replaces `pool` by the coin's mint.
    """
    try:
        b = base64.b64decode(payload)
    except Exception:
        return None
    d = b[:8]
    try:
        if d == TRADE:
            r = _R(b)
            mint, sol, tok, buy, user, ts = r.pk(), r.u64(), r.u64(), r.u8(), r.pk(), r.i64()
            vsol, vtok, _rsol, _rtok = r.u64(), r.u64(), r.u64(), r.u64()
            r.raw(32); fee_bps = r.u64(); r.u64(); r.raw(32); cfee_bps = r.u64(); r.u64()
            ix = ""
            try:
                r.raw(1 + 32); ix = r.s()
            except Exception:
                pass
            return ["T", ts, mint, user, bool(buy), sol, tok, vsol, vtok, fee_bps, cfee_bps, ix]
        if d == CREATE:
            r = _R(b)
            name, sym, uri = r.s(), r.s(), r.s()
            mint, _curve, user, creator, ts = r.pk(), r.pk(), r.pk(), r.pk(), r.i64()
            vtok, vsol, _rtok, _supply = r.u64(), r.u64(), r.u64(), r.u64()
            flag, quote, cashback = 0, "", 0
            try:
                r.raw(32); flag = r.u8(); cashback = r.u8(); q = r.raw(32)
                quote = b58(q) if any(q) and b58(q) != WSOL else ""
            except Exception:
                pass
            return ["C", ts, mint, creator, user, name, sym, uri, vsol, vtok, quote, flag, cashback]
        if d == COMPLETE:
            r = _R(b)
            user, mint, _curve, ts = r.pk(), r.pk(), r.pk(), r.i64()
            return ["G", ts, mint, user]
        if d == POOL:
            r = _R(b)
            ts, _idx, _creator, mint, qmint = r.i64(), r.u16(), r.pk(), r.pk(), r.pk()
            r.raw(2); r.u64(); r.u64()
            pbase, pquote = r.u64(), r.u64()
            r.u64(); r.u64(); r.u64(); r.u8()
            pool = r.pk(); r.raw(32 * 3); cc = r.pk(); mayhem = r.u8()
            return ["P", ts, mint, pool, qmint, pbase, pquote, cc, mayhem]
        if d in (SWAP_BUY, SWAP_SELL):
            buy = d == SWAP_BUY
            r = _R(b)
            ts, base = r.i64(), r.u64()
            r.u64(); r.u64(); r.u64()
            pbase, pquote = r.u64(), r.u64()
            r.u64(); lp_bps = r.u64(); r.u64(); pr_bps = r.u64(); r.u64(); r.u64()
            quote = r.u64()                          # buy: user_quote_amount_in, sell: user_quote_amount_out
            pool, user = r.pk(), r.pk(); r.raw(32 * 4); r.pk()
            cc_bps = r.u64(); r.u64()
            ix, vq = "", 0
            try:
                if buy:
                    r.raw(1 + 8 * 4); r.u64(); ix = r.s()
                r.raw(8 * 4); vq = r.i128()              # cashback bps / amount, buyback bps / amount, vquote
            except Exception:
                pass
            return ["S", ts, pool, user, buy, base, quote, pbase, pquote, vq, lp_bps + pr_bps + cc_bps, ix]
    except Exception:
        return None
    return None
