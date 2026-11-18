"""Decode pump.fun bonding-curve events from transaction logs.

pump.fun (program 6EF8…) emits Anchor events as "Program data: <base64>" log lines.
Only lines emitted while pump.fun itself is the executing program are decoded.

Price on the curve: price (SOL per token) = (vsol / 1e9) / (vtok / 1e6),
market cap in SOL = vsol / vtok * 1e6 (supply is 1e9 tokens with 6 decimals; start ≈ 28 SOL).
"""
import base64, hashlib, re, struct

PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
_A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
_INV = re.compile(r"Program (\w+) invoke \[\d+\]")
_FIN = re.compile(r"Program (\w+) (success|failed)")


def _disc(name):
    return hashlib.sha256(f"event:{name}".encode()).digest()[:8]


TRADE, CREATE, COMPLETE = _disc("TradeEvent"), _disc("CreateEvent"), _disc("CompleteEvent")


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
    def s(self):
        n = struct.unpack_from("<I", self.b, self.o)[0]
        v = self.b[self.o + 4:self.o + 4 + n].decode("utf8", "replace"); self.o += 4 + n; return v


def pump_data_lines(logs):
    """Yield base64 payloads of 'Program data:' lines emitted by pump.fun itself."""
    st = []
    for l in logs:
        m = _INV.match(l)
        if m:
            st.append(m.group(1)); continue
        if _FIN.match(l):
            if st: st.pop()
            continue
        if st and st[-1] == PUMP and l.startswith("Program data: "):
            yield l[14:]


def decode(payload):
    """Return a compact record (list) or None. Records:
    ["C", ts, mint, creator, signer, name, symbol, uri, vsol, vtok, quote, flag]
    ["T", ts, mint, user, is_buy, sol, tok, vsol, vtok, fee_bps, creator_fee_bps, ix]
    ["G", ts, mint, user]                    (curve complete = graduation)
    `quote` is '' for SOL-quoted coins, else the quote mint (then sol/vsol are not SOL).
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
            flag, quote = 0, ""
            try:
                r.raw(32); flag = r.u8(); q = r.raw(32)
                quote = b58(q) if any(q) else ""
            except Exception:
                pass
            return ["C", ts, mint, creator, user, name, sym, uri, vsol, vtok, quote, flag]
        if d == COMPLETE:
            r = _R(b)
            user, mint, _curve, ts = r.pk(), r.pk(), r.pk(), r.i64()
            return ["G", ts, mint, user]
    except Exception:
        return None
    return None
