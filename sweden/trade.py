"""Manual trading from the terminal: one trading wallet per account, swaps through Jupiter (pump.fun curve, PumpSwap and
other pools; no platform fee), signed on the Pi, sent through Helius.

* The wallet's secret is stored encrypted (argon2id + secretbox) with a trading password only the user knows. Trading
  needs an unlock (password); the key then stays in memory for a few hours and is gone after a restart or a lock.
* "Prepared" trades: while a coin page is open, the default buy is quoted and built every few seconds, so a click only
  signs and sends (no 0.5 s quote + build on the click).
* Every order is sent, re-sent every 2 s until it lands (or ~40 s), and checked every 0.5 s; afterwards the transaction
  is read once to record what was really paid and received. About 10 Helius credits per trade.
Nothing trades automatically: only a user's click (or double-click) does.
"""
import base64, json, os, secrets, sqlite3, threading, time, urllib.error, urllib.request

import nacl.exceptions, nacl.pwhash, nacl.secret, nacl.signing

SOL = "So11111111111111111111111111111111111111112"
JUP = "https://lite-api.jup.ag/swap/v1"
ALPH = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
TOKEN_PROGRAMS = ("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")
CLOSE_BATCH = 20              # close-account instructions per transaction
PREP_MAX_AGE = 8.0            # seconds a prepared transaction may be old when it is used
RESEND_S, GIVE_UP_S = 2.0, 45.0


def log(*a):
    print(time.strftime("%Y-%m-%d %H:%M:%S"), "trade:", *a, flush=True)


def b58e(b):
    n = int.from_bytes(b, "big"); s = ""
    while n:
        n, r = divmod(n, 58); s = ALPH[r] + s
    return "1" * (len(b) - len(b.lstrip(b"\0"))) + s


def b58d(s):
    n = 0
    for ch in s:
        n = n * 58 + ALPH.index(ch)
    raw = n.to_bytes((n.bit_length() + 7) // 8, "big") if n else b""
    return b"\0" * (len(s) - len(s.lstrip("1"))) + raw


def http_json(url, body=None, timeout=10):
    req = urllib.request.Request(url, json.dumps(body).encode() if body is not None else None,
                                 {"Content-Type": "application/json"} if body is not None else {})
    return json.load(urllib.request.urlopen(req, timeout=timeout))


def sign_tx(raw, sk):
    """Sign a serialized (versioned or legacy) transaction as its first signer (the fee payer)."""
    n, i, shift = 0, 0, 0
    while True:                                          # compact-u16: number of signatures
        x = raw[i]; i += 1; n |= (x & 0x7F) << shift; shift += 7
        if x < 0x80:
            break
    msg = raw[i + 64 * n:]
    sig = sk.sign(msg).signature
    return raw[:i] + sig + raw[i + 64:], b58e(sig)


def shortvec(n):
    out = b""
    while True:
        x = n & 0x7F; n >>= 7
        if n:
            out += bytes([x | 0x80])
        else:
            return out + bytes([x])


def close_tx(owner, accounts, blockhash):
    """Unsigned legacy transaction closing empty token accounts [(account, token program)]; the deposit (rent) goes
    back to the owner. CloseAccount = instruction 9 of both token programs: accounts [account, destination, owner]."""
    progs = sorted({p for _, p in accounts})
    keys = [owner] + [a for a, _ in accounts] + progs
    header = bytes([1, 0, len(progs)])                   # 1 signer (writable), 0 read-only signers, programs read-only
    ixs = b"".join(bytes([keys.index(p)]) + shortvec(3) + bytes([keys.index(a), 0, 0]) + shortvec(1) + bytes([9])
                   for a, p in accounts)
    msg = header + shortvec(len(keys)) + b"".join(b58d(k).rjust(32, b"\0") for k in keys) + b58d(blockhash).rjust(32, b"\0") \
        + shortvec(len(accounts)) + ixs
    return shortvec(1) + bytes(64) + msg


SYSTEM = "11111111111111111111111111111111"
RENT_MIN = 890880             # lamports: a wallet must keep 0 or at least this much (rent exemption)
BASE_FEE = 5000


def transfer_tx(owner, to, lamports, blockhash):
    """Unsigned legacy transaction: System Program transfer (instruction 2) of `lamports` from owner to `to`."""
    keys = [owner, to, SYSTEM]
    header = bytes([1, 0, 1])
    ix = bytes([2]) + shortvec(2) + bytes([0, 1]) + shortvec(12) + (2).to_bytes(4, "little") + int(lamports).to_bytes(8, "little")
    msg = header + shortvec(3) + b"".join(b58d(k).rjust(32, b"\0") for k in keys) + b58d(blockhash).rjust(32, b"\0") + shortvec(1) + ix
    return shortvec(1) + bytes(64) + msg


def parse_secret(text):
    """Seed (32 bytes) from a base58 secret key (64 or 32 bytes) or a JSON byte array (solana-keygen)."""
    t = (text or "").strip()
    try:
        b = bytes(json.loads(t)) if t.startswith("[") else b58d(t)
    except (ValueError, TypeError):
        return None
    if len(b) == 64:
        sk = nacl.signing.SigningKey(b[:32])
        return b[:32] if bytes(sk.verify_key) == b[32:] else None
    return b if len(b) == 32 else None


class Trader:
    def __init__(self, db_path, helius_key, on_rpc=None):
        self.rpc_url = f"https://mainnet.helius-rpc.com/?api-key={helius_key}" if helius_key else None
        self.on_rpc = on_rpc
        self.lock = threading.Lock()
        self.db = sqlite3.connect(db_path, check_same_thread=False)
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS tkeys (uid INTEGER PRIMARY KEY, pubkey TEXT, salt BLOB, box BLOB, created REAL);
            CREATE TABLE IF NOT EXISTS torders (id INTEGER PRIMARY KEY, uid INT, ts REAL, mint TEXT, sym TEXT, side TEXT,
                amount REAL, sig TEXT, status TEXT, error TEXT, sol REAL, tokens REAL, ms INT, prepared INT);
        """)
        self.unlocked = {}            # uid -> (SigningKey, until)
        self.fails = {}               # uid -> [times of wrong passwords]
        self.prepared = {}            # uid -> dict(key, quote, tx, ts)
        self.balances = {}            # (uid, mint or SOL) -> (ts, raw amount, decimals)
        self.jup_wait = 0.0           # Jupiter rate limit back-off until
        self.reclaims = {}            # uid -> state of the last "reclaim" run

    # ---------- keys ----------
    def pubkey(self, uid):
        with self.lock:
            r = self.db.execute("SELECT pubkey FROM tkeys WHERE uid = ?", (uid,)).fetchone()
        return r[0] if r else None

    @staticmethod
    def _box(password, salt):
        key = nacl.pwhash.argon2id.kdf(32, password.encode(), salt, opslimit=nacl.pwhash.argon2id.OPSLIMIT_INTERACTIVE,
                                       memlimit=nacl.pwhash.argon2id.MEMLIMIT_INTERACTIVE)
        return nacl.secret.SecretBox(key)

    def store(self, uid, seed, password):
        if len(password or "") < 8:
            return None, "Trading password: at least 8 characters"
        if self.pubkey(uid):
            return None, "This account already has a trading wallet (delete it first)"
        salt = secrets.token_bytes(nacl.pwhash.argon2id.SALTBYTES)
        box = self._box(password, salt).encrypt(seed)
        pub = b58e(bytes(nacl.signing.SigningKey(seed).verify_key))
        with self.lock:
            self.db.execute("INSERT INTO tkeys VALUES (?, ?, ?, ?, ?)", (uid, pub, salt, bytes(box), time.time()))
            self.db.commit()
        return pub, None

    def create(self, uid, password):
        return self.store(uid, secrets.token_bytes(32), password)

    def import_key(self, uid, secret, password):
        seed = parse_secret(secret)
        if seed is None:
            return None, "That is not a Solana secret key (base58 or [..] array)"
        return self.store(uid, seed, password)

    def _open(self, uid, password):
        t = [x for x in self.fails.get(uid, []) if x > time.time() - 900]
        if len(t) >= 6:
            return None, "Too many wrong passwords - wait 15 minutes"
        with self.lock:
            r = self.db.execute("SELECT salt, box FROM tkeys WHERE uid = ?", (uid,)).fetchone()
        if not r:
            return None, "No trading wallet yet"
        try:
            seed = self._box(password or "", r[0]).decrypt(r[1])
        except nacl.exceptions.CryptoError:
            self.fails[uid] = t + [time.time()]
            return None, "Wrong trading password"
        self.fails.pop(uid, None)
        return seed, None

    def unlock(self, uid, password, hours):
        seed, err = self._open(uid, password)
        if err:
            return False, err
        self.unlocked[uid] = (nacl.signing.SigningKey(seed), time.time() + max(0.25, min(24.0, float(hours))) * 3600)
        return True, None

    def lock_now(self, uid):
        self.unlocked.pop(uid, None)
        self.prepared.pop(uid, None)

    def export(self, uid, password):
        seed, err = self._open(uid, password)
        if err:
            return None, err
        sk = nacl.signing.SigningKey(seed)
        return b58e(seed + bytes(sk.verify_key)), None          # the 64-byte form wallets like Phantom import

    def delete(self, uid, password):
        seed, err = self._open(uid, password)
        if err:
            return False, err
        with self.lock:
            self.db.execute("DELETE FROM tkeys WHERE uid = ?", (uid,))
            self.db.commit()
        self.lock_now(uid)
        return True, None

    def key(self, uid):
        k = self.unlocked.get(uid)
        if k and k[1] > time.time():
            return k[0]
        self.unlocked.pop(uid, None)
        return None

    # ---------- chain ----------
    def rpc(self, method, params):
        if not self.rpc_url:
            raise RuntimeError("no Helius key on the Pi")
        if self.on_rpc:
            self.on_rpc()
        d = http_json(self.rpc_url, {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, timeout=10)
        if d.get("error"):
            raise RuntimeError(d["error"].get("message", str(d["error"]))[:200])
        return d["result"]

    def balance(self, uid, mint=None, max_age=10.0):
        """(raw amount, decimals) of SOL (mint None) or a token in the trading wallet, cached max_age seconds."""
        k = (uid, mint or SOL)
        hit = self.balances.get(k)
        if hit and time.time() - hit[0] < max_age:
            return hit[1], hit[2]
        owner = self.pubkey(uid)
        if mint is None:
            v, d = self.rpc("getBalance", [owner, {"commitment": "confirmed"}])["value"], 9
        else:
            accs = self.rpc("getTokenAccountsByOwner", [owner, {"mint": mint}, {"encoding": "jsonParsed", "commitment": "confirmed"}])["value"]
            v, d = 0, 6
            for a in accs:
                ta = a["account"]["data"]["parsed"]["info"]["tokenAmount"]
                v += int(ta["amount"]); d = ta["decimals"]
        self.balances[k] = (time.time(), v, d)
        return v, d

    # ---------- building ----------
    def build(self, uid, mint, side, amount, st):
        """(quote, unsigned tx bytes) for a buy of `amount` SOL or a sell of `amount` % of the holding."""
        if time.time() < self.jup_wait:
            raise RuntimeError("Jupiter is rate-limiting - try again in a moment")
        slip = int(max(1, min(50, st.get("trade_slippage", 15))) * 100)
        if side == "buy":
            inp, out, raw = SOL, mint, int(round(amount * 1e9))
        else:
            bal, _ = self.balance(uid, mint, max_age=4.0)
            raw = bal if amount >= 100 else int(bal * amount / 100)
            inp, out = mint, SOL
        if raw <= 0:
            raise RuntimeError("nothing to sell" if side == "sell" else "amount is 0")
        try:
            q = http_json(f"{JUP}/quote?inputMint={inp}&outputMint={out}&amount={raw}&slippageBps={slip}"
                          f"&restrictIntermediateTokens=true", timeout=8)
            s = http_json(f"{JUP}/swap", {"quoteResponse": q, "userPublicKey": self.pubkey(uid), "wrapAndUnwrapSol": True,
                                          "dynamicComputeUnitLimit": True,
                                          "prioritizationFeeLamports": int(max(0, min(0.05, st.get("trade_prio_sol", 0.0005))) * 1e9)},
                          timeout=8)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                self.jup_wait = time.time() + 5
                raise RuntimeError("Jupiter is rate-limiting - try again in a moment")
            msg = e.read()[:200].decode("utf8", "replace")
            raise RuntimeError("no route for this coin" if "route" in msg.lower() or "TOKEN_NOT_TRADABLE" in msg else f"Jupiter: {msg}")
        if s.get("simulationError"):
            err = s["simulationError"]
            msg = (err.get("error") if isinstance(err, dict) else str(err)) or ""
            if "prior credit" in msg or "insufficient" in msg.lower():
                raise RuntimeError("not enough SOL in the trading wallet (amount + fees)")
            raise RuntimeError("would fail: " + msg[:120])
        return q, base64.b64decode(s["swapTransaction"])

    def summary(self, q, side):
        out, inp = int(q["outAmount"]), int(q["inAmount"])
        return dict(side=side, in_amount=inp, out_amount=out, min_out=int(q.get("otherAmountThreshold") or 0),
                    impact=float(q.get("priceImpactPct") or 0), route=[x["swapInfo"]["label"] for x in q.get("routePlan", [])])

    def prepare(self, uid, mint, side, amount, st):
        """Quote and build ahead; a click with the same coin / side / amount within PREP_MAX_AGE only signs and sends."""
        if not self.key(uid):
            return dict(ok=False, error="locked")
        key = (mint, side, round(float(amount), 6))
        p = self.prepared.get(uid)
        if p and p["key"] == key and time.time() - p["ts"] < 3.0:
            return dict(ok=True, quote=p["sum"], age=time.time() - p["ts"])
        try:
            q, tx = self.build(uid, mint, side, float(amount), st)
        except Exception as e:
            return dict(ok=False, error=str(e)[:160])
        self.prepared[uid] = dict(key=key, tx=tx, sum=self.summary(q, side), ts=time.time())
        return dict(ok=True, quote=self.prepared[uid]["sum"], age=0)

    # ---------- executing ----------
    def execute(self, uid, mint, sym, side, amount, st):
        sk = self.key(uid)
        if not sk:
            return dict(ok=False, error="Trading is locked - unlock it first")
        amount = float(amount)
        if side == "buy" and amount > float(st.get("trade_max_sol", 1.0)) + 1e-9:
            return dict(ok=False, error=f"Above your limit of ◎{st.get('trade_max_sol', 1.0)} per click (Settings > Trading)")
        if side not in ("buy", "sell") or amount <= 0:
            return dict(ok=False, error="bad order")
        t0 = time.time()
        p = self.prepared.get(uid)
        key = (mint, side, round(amount, 6))
        used = bool(p and p["key"] == key and time.time() - p["ts"] < PREP_MAX_AGE)
        try:
            if used:
                tx, summ = p["tx"], p["sum"]
                self.prepared.pop(uid, None)                  # one use only
            else:
                q, tx = self.build(uid, mint, side, amount, st)
                summ = self.summary(q, side)
            signed, sig = sign_tx(tx, sk)
            self.rpc("sendTransaction", [base64.b64encode(signed).decode(), {"encoding": "base64", "skipPreflight": True,
                                                                              "maxRetries": 0}])
        except Exception as e:
            return dict(ok=False, error=str(e)[:200])
        ms = int((time.time() - t0) * 1000)
        with self.lock:
            cur = self.db.execute("INSERT INTO torders (uid, ts, mint, sym, side, amount, sig, status, ms, prepared) "
                                  "VALUES (?, ?, ?, ?, ?, ?, ?, 'sent', ?, ?)", (uid, time.time(), mint, sym, side, amount, sig, ms, int(used)))
            oid = cur.lastrowid
            self.db.commit()
        threading.Thread(target=self.follow, args=(oid, uid, mint, signed, sig, side == "sell" and amount >= 100), daemon=True).start()
        return dict(ok=True, id=oid, sig=sig, ms=ms, prepared=used, quote=summ)

    def follow(self, oid, uid, mint, signed, sig, close_after=False):
        """Re-send until the transaction lands, then record the real amounts."""
        b64 = base64.b64encode(signed).decode()
        t0 = last_send = time.time()
        status, err = "sent", None
        while time.time() - t0 < GIVE_UP_S:
            time.sleep(0.5)
            try:
                v = self.rpc("getSignatureStatuses", [[sig]])["value"][0]
            except Exception:
                v = None
            if v and v.get("confirmationStatus") in ("confirmed", "finalized"):
                status, err = ("failed", self.error_text(v["err"])) if v.get("err") else ("confirmed", None)
                break
            if time.time() - last_send >= RESEND_S:
                last_send = time.time()
                try:
                    self.rpc("sendTransaction", [b64, {"encoding": "base64", "skipPreflight": True, "maxRetries": 0}])
                except Exception as e:
                    if "blockhash" in str(e).lower():
                        status, err = "failed", "expired before it landed"
                        break
        else:
            status, err = "failed", "did not land in time (network busy - try a higher priority fee)"
        sol = tok = None
        if status == "confirmed":
            try:
                sol, tok = self.amounts(sig, self.pubkey(uid), mint)
            except Exception:
                pass
        for k in [k for k in self.balances if k[0] == uid]:
            self.balances.pop(k, None)                        # balances changed
        with self.lock:
            self.db.execute("UPDATE torders SET status = ?, error = ?, sol = ?, tokens = ? WHERE id = ?", (status, err, sol, tok, oid))
            self.db.commit()
        log(f"order {oid} user {uid}: {status}{' - ' + err if err else ''}")
        if status == "confirmed" and close_after:                # sold everything: get the account deposit back
            try:
                r = self.reclaim(uid, mint)
                if r.get("closed"):
                    log(f"user {uid}: closed {r['closed']} empty token account(s), ◎{r['sol']:.4f} back")
            except Exception as e:
                log("close after sell:", repr(e))

    @staticmethod
    def error_text(e):
        s = json.dumps(e)
        if '"Custom": 6001' in s or '"Custom": 6002' in s or '"Custom": 6003' in s or '"Custom": 6004' in s:
            return "slippage - the price moved more than your slippage setting"
        if "InsufficientFunds" in s or '"Custom": 1' in s:
            return "not enough SOL (amount + fees)"
        return "failed on chain: " + s[:120]

    def amounts(self, sig, owner, mint):
        """(SOL change incl. fees, token change) of the owner in a confirmed transaction."""
        tx = self.rpc("getTransaction", [sig, {"encoding": "json", "maxSupportedTransactionVersion": 1, "commitment": "confirmed"}])
        meta, msg = tx["meta"], tx["transaction"]["message"]
        keys = msg["accountKeys"] + (meta.get("loadedAddresses") or {}).get("writable", []) + (meta.get("loadedAddresses") or {}).get("readonly", [])
        i = keys.index(owner)
        sol = (meta["postBalances"][i] - meta["preBalances"][i]) / 1e9
        def tok(bals):
            return sum(float(b["uiTokenAmount"]["uiAmount"] or 0) for b in bals or [] if b.get("owner") == owner and b.get("mint") == mint)
        wsol = lambda bals: sum(float(b["uiTokenAmount"]["uiAmount"] or 0) for b in bals or [] if b.get("owner") == owner and b.get("mint") == SOL)
        return sol + wsol(meta.get("postTokenBalances")) - wsol(meta.get("preTokenBalances")), tok(meta.get("postTokenBalances")) - tok(meta.get("preTokenBalances"))

    def empty_accounts(self, uid, mint=None):
        """[(account, program, lamports)] of the wallet's token accounts with a zero balance."""
        owner = self.pubkey(uid)
        found = []
        filters = [{"mint": mint}] if mint else [{"programId": p} for p in TOKEN_PROGRAMS]
        for f in filters:
            for a in self.rpc("getTokenAccountsByOwner", [owner, f, {"encoding": "jsonParsed", "commitment": "confirmed"}])["value"]:
                info = a["account"]["data"]["parsed"]["info"]
                if int(info["tokenAmount"]["amount"]) == 0 and info.get("state") != "frozen":
                    found.append((a["pubkey"], a["account"]["owner"], a["account"]["lamports"]))
        return found

    def reclaim(self, uid, mint=None):
        """Close the wallet's empty token accounts (all, or those of one coin) in batches; returns closed / SOL back."""
        sk = self.key(uid)
        if not sk:
            return dict(ok=False, error="Trading is locked - unlock it first")
        accs = self.empty_accounts(uid, mint)
        if not accs:
            return dict(ok=True, closed=0, sol=0.0)
        owner, closed, back = self.pubkey(uid), 0, 0
        for i in range(0, len(accs), CLOSE_BATCH):
            chunk = accs[i:i + CLOSE_BATCH]
            bh = self.rpc("getLatestBlockhash", [{"commitment": "confirmed"}])["value"]["blockhash"]
            signed, sig = sign_tx(close_tx(owner, [(a, p) for a, p, _ in chunk], bh), sk)
            b64 = base64.b64encode(signed).decode()
            self.rpc("sendTransaction", [b64, {"encoding": "base64", "skipPreflight": True, "maxRetries": 0}])
            ok = False
            for k in range(40):                                  # up to ~20 s
                time.sleep(0.5)
                v = self.rpc("getSignatureStatuses", [[sig]])["value"][0]
                if v and v.get("confirmationStatus") in ("confirmed", "finalized"):
                    ok = not v.get("err")
                    break
                if k % 4 == 3:
                    self.rpc("sendTransaction", [b64, {"encoding": "base64", "skipPreflight": True, "maxRetries": 0}])
            if ok:
                closed += len(chunk); back += sum(l for _, _, l in chunk)
        for k in [k for k in self.balances if k[0] == uid]:
            self.balances.pop(k, None)
        return dict(ok=True, closed=closed, sol=back / 1e9, failed=len(accs) - closed)

    def reclaim_bg(self, uid):
        """Start closing all empty token accounts in the background; the result shows in status()."""
        if (self.reclaims.get(uid) or {}).get("running"):
            return dict(ok=True, running=True)
        if not self.key(uid):
            return dict(ok=False, error="Trading is locked - unlock it first")
        self.reclaims[uid] = dict(running=True, ts=time.time())

        def run():
            try:
                r = self.reclaim(uid)
            except Exception as e:
                r = dict(ok=False, error=str(e)[:150])
            self.reclaims[uid] = dict(r, running=False, ts=time.time())
            log(f"user {uid}: reclaim {r}")
        threading.Thread(target=run, daemon=True).start()
        return dict(ok=True, running=True)

    def withdraw(self, uid, password, to, amount):
        """Send SOL to another address. Needs the trading password every time (not only an unlocked session).
        amount: SOL, or "max" (everything minus the network fee)."""
        seed, err = self._open(uid, password)
        if err:
            return dict(ok=False, error=err)
        to = (to or "").strip()
        try:
            raw = b58d(to)
        except ValueError:
            raw = b""
        owner = self.pubkey(uid)
        if len(raw) != 32 or to == owner:
            return dict(ok=False, error="That is not a valid Solana address" if to != owner else "That is the trading wallet itself")
        bal = self.rpc("getBalance", [owner, {"commitment": "confirmed"}])["value"]
        if str(amount).lower() == "max":
            lam = bal - BASE_FEE
        else:
            try:
                lam = int(round(float(amount) * 1e9))
            except (TypeError, ValueError):
                return dict(ok=False, error="bad amount")
        left = bal - lam - BASE_FEE
        if lam <= 0 or left < 0:
            return dict(ok=False, error=f"not enough SOL (the wallet has ◎{bal / 1e9:.6f}, the fee is ◎0.000005)")
        if 0 < left < RENT_MIN:
            return dict(ok=False, error=f"leave at least ◎{RENT_MIN / 1e9:.6f} in the wallet or use Max (a wallet must keep 0 or that minimum)")
        to_bal = self.rpc("getBalance", [to, {"commitment": "confirmed"}])["value"]
        if to_bal == 0 and lam < RENT_MIN:
            return dict(ok=False, error=f"an empty address needs at least ◎{RENT_MIN / 1e9:.6f}")
        sk = nacl.signing.SigningKey(seed)
        bh = self.rpc("getLatestBlockhash", [{"commitment": "confirmed"}])["value"]["blockhash"]
        signed, sig = sign_tx(transfer_tx(owner, to, lam, bh), sk)
        b64 = base64.b64encode(signed).decode()
        self.rpc("sendTransaction", [b64, {"encoding": "base64", "skipPreflight": False, "maxRetries": 0}])
        status, err = "sent", None
        for k in range(60):                                      # up to ~30 s
            time.sleep(0.5)
            v = self.rpc("getSignatureStatuses", [[sig]])["value"][0]
            if v and v.get("confirmationStatus") in ("confirmed", "finalized"):
                status, err = ("failed", self.error_text(v["err"])) if v.get("err") else ("confirmed", None)
                break
            if k % 4 == 3:
                self.rpc("sendTransaction", [b64, {"encoding": "base64", "skipPreflight": True, "maxRetries": 0}])
        with self.lock:
            self.db.execute("INSERT INTO torders (uid, ts, mint, sym, side, amount, sig, status, error, sol, ms, prepared) "
                            "VALUES (?, ?, ?, 'SOL', 'withdraw', ?, ?, ?, ?, ?, 0, 0)", (uid, time.time(), to, lam / 1e9, sig, status, err, -lam / 1e9))
            self.db.commit()
        self.balances.pop((uid, SOL), None)
        log(f"user {uid}: withdraw ◎{lam / 1e9:.6f} to {to[:6]}… {status}")
        return dict(ok=status == "confirmed", sig=sig, sol=lam / 1e9, status=status,
                    error=err or (None if status == "confirmed" else "not confirmed within 30 s - check the transaction"))

    def orders(self, uid, n=30):
        with self.lock:
            rows = self.db.execute("SELECT id, ts, mint, sym, side, amount, sig, status, error, sol, tokens, ms, prepared FROM torders "
                                   "WHERE uid = ? ORDER BY id DESC LIMIT ?", (uid, n)).fetchall()
        return [dict(zip(("id", "ts", "mint", "sym", "side", "amount", "sig", "status", "error", "sol", "tokens", "ms", "prepared"), r)) for r in rows]

    def status(self, uid, with_balance=False):
        pub = self.pubkey(uid)
        k = self.unlocked.get(uid)
        out = dict(wallet=pub, unlocked=bool(k and k[1] > time.time()), until=k[1] if k else None, rpc=bool(self.rpc_url),
                   reclaim=self.reclaims.get(uid))
        if pub and with_balance:
            try:
                out["sol"] = self.balance(uid, None, max_age=15.0)[0] / 1e9
            except Exception as e:
                out["sol_error"] = str(e)[:100]
        return out
