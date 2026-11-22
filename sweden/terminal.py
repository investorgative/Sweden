"""SWEDEN terminal — a live screen of freshly graduated pump.fun coins for a manual trader.

Shows only coins that graduated to a SOL pool on PumpSwap, are at most MAX_AGE old (default 6 h, as in Fomo's
Graduated tab), pass the on-chain checks at graduation (filter v1 without dev-sell and activity checks, as in
grad_replay.py), are at most MAX_MCAP_USD and have dropped at least SHOW_DD (default 10 %) from their
post-graduation high, so a coin is never shown while it is pumping. Mayhem coins are hidden unless --mayhem (they
graduate into pools of well under 1 SOL, so a normal-size buy cannot get in or out).
Each coin carries the stage of the dip pattern:
  dip      10-30 % below the high
  zone     30-75 % below the high, waiting for a bounce
  bounce   bounced >= 20 % off the low
  entry    pulled back >= 10 % from the bounce high without breaking the low (the entry signal)
  dead     more than 75 % below the high (hidden)
Alerts (browser sound; optional push to a phone via ntfy.sh) when a coin first shows up and when it reaches "entry".

It reads the collector's data files as they are written (no extra connection to the RPC, cannot disturb the
collector); data is at most ~5 s old (the collector flushes every 5 s).

Run:  ./terminal.sh   (terminal on port 8750 + a Cloudflare quick tunnel, so it opens from anywhere over HTTPS)
      or python3 sweden/terminal.py [--port 8750] [--max-mcap-usd 100000] [--show-dd 0.1] ...
Env:  SWEDEN_NTFY_TOPIC   push alerts to https://ntfy.sh/<topic> (install the ntfy app, subscribe to the topic)
      SWEDEN_PASSKEY      the passkey for the page; else the file ./terminal_passkey (generated on first start)

Access: the page holds no data; /api/state needs a token that only the passkey hands out (checked here, on the Pi).
A token is signed with the passkey and valid for TOKEN_DAYS, so restarts keep you logged in and changing the
passkey logs every browser out. Wrong passkeys lock the address out for longer and longer.
"""
import argparse, collections, glob, hashlib, hmac, json, os, queue, secrets, sys, threading, time, urllib.parse
import urllib.request, zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(__file__))
import replay as R
from grad_replay import SKIP, WSOL, sol_usd

HERE = os.path.dirname(os.path.abspath(__file__))
HISTORY_S = 72 * 3600                    # creator history (24 h) and copied names (72 h) need this much data
AXIOM_FILE = os.path.join(R.DATA, "axiom_checks.jsonl")
PREFS_FILE = os.path.join(R.DATA, "terminal_prefs.json")
PASSKEY_FILE = os.path.join(HERE, "..", "terminal_passkey")
TOKEN_DAYS = 30
COPY_MATCHES = 6                         # earlier same-name coins kept per copied coin
AXIOM_FIELDS = ("top10", "dev", "snipers", "insiders", "bundlers", "holders")
LOCKOUT = {5: 60, 6: 300, 7: 900}        # wrong passkeys from one address -> seconds locked (then 1 h each)
GLOBAL_FAILS = 30                        # wrong passkeys per hour from all addresses together -> lock 15 min


def log(*a):
    print(time.strftime("%Y-%m-%d %H:%M:%S"), *a, flush=True)


class Gate:
    """Passkey login with signed tokens and lockouts."""

    def __init__(self):
        pk = os.environ.get("SWEDEN_PASSKEY", "").strip()
        if not pk and os.path.exists(PASSKEY_FILE):
            pk = open(PASSKEY_FILE).read().strip()
        if len(pk) < 6:
            pk = "".join(secrets.choice("0123456789") for _ in range(8))
            fd = os.open(PASSKEY_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            os.write(fd, (pk + "\n").encode()); os.close(fd)
            log(f"no passkey set (or shorter than 6 characters) - generated one, see {os.path.abspath(PASSKEY_FILE)}")
        self.pk = pk.encode()
        self.key = hashlib.sha256(b"sweden-terminal|" + self.pk).digest()
        self.lock = threading.Lock()
        self.fails = {}                      # ip -> [count, locked until]
        self.recent = collections.deque()    # times of wrong passkeys, all addresses

    def sign(self, exp):
        return hmac.new(self.key, str(exp).encode(), hashlib.sha256).hexdigest()

    def token_ok(self, tok):
        exp, _, sig = (tok or "").partition(".")
        return exp.isdigit() and int(exp) > time.time() and hmac.compare_digest(sig, self.sign(exp))

    def login(self, ip, guess):
        """(http status, response dict)."""
        now = time.time()
        with self.lock:
            while self.recent and self.recent[0] < now - 3600:
                self.recent.popleft()
            f = self.fails.setdefault(ip, [0, 0])
            wait = max(f[1], self.recent[-1] + 900 if len(self.recent) >= GLOBAL_FAILS else 0) - now
            if wait > 0:
                return 429, dict(error="locked", wait=int(wait) + 1)
            if hmac.compare_digest(guess.encode(), self.pk):
                self.fails.pop(ip, None)
                exp = int(now + TOKEN_DAYS * 86400)
                return 200, dict(token=f"{exp}.{self.sign(exp)}")
            f[0] += 1
            self.recent.append(now)
            lock = LOCKOUT.get(f[0], 3600 if f[0] > max(LOCKOUT) else 0)
            f[1] = now + lock
        log(f"wrong passkey from {ip} ({f[0]} in a row)" + (f", locked {lock} s" if lock else ""))
        return 403, dict(error="wrong", wait=lock)


class Tail:
    """Incremental reader of a gzip file that another process keeps appending to (and flushing)."""

    def __init__(self, path):
        self.path, self.off, self.d, self.buf, self.broken = path, 0, zlib.decompressobj(31), b"", False

    def lines(self):
        if self.broken:
            return []
        try:
            size = os.path.getsize(self.path)
        except OSError:
            return []
        if size <= self.off:
            return []
        with open(self.path, "rb") as f:
            f.seek(self.off)
            raw = f.read(size - self.off)
        self.off = size
        out = []
        while raw:
            try:
                out.append(self.d.decompress(raw))
            except zlib.error:
                self.broken = True                  # cut-off member (see repair_gz.py); skip the rest of this file
                break
            if self.d.eof:                          # next gzip member (a later run of the collector)
                raw, self.d = self.d.unused_data, zlib.decompressobj(31)
            else:
                raw = b""
        parts = (self.buf + b"".join(out)).split(b"\n")
        self.buf = parts.pop()
        return parts


class Holders:
    """Live holdings from curve and PumpSwap trades, and the variants of Axiom-style metrics we compare against Axiom
    (Axiom does not publish its definitions). Token transfers are not in the data: a wallet that got its tokens by
    transfer is missed, and one that sent them away still counts (until it would sell)."""

    def __init__(self, launch_slot, devs):
        self.L, self.devs = launch_slot, devs
        self.hold = collections.Counter()
        self.first = {}                              # wallet -> slot of its first curve buy
        self.buyers = collections.defaultdict(set)   # slot -> wallets that bought on the curve in that slot

    def trade(self, slot, user, buy, tok, curve):
        self.hold[user] += tok if buy else -tok
        if buy and curve:
            self.first.setdefault(user, slot)
            self.buyers[slot].add(user)

    def metrics(self):
        held = {w: t for w, t in self.hold.items() if t > 0}
        S, L, first = R.SUPPLY, self.L, self.first

        def share(pred):
            return sum(t for w, t in held.items() if w in first and pred(w, first[w])) / S
        return dict(
            holders=len(held),
            top10=sum(sorted(held.values(), reverse=True)[:10]) / S,
            dev=sum(held.get(d, 0) for d in self.devs) / S,
            bundle_launch=share(lambda w, f: f == L),
            bundle_launch_nodev=share(lambda w, f: f == L and w not in self.devs),
            bundle_2=share(lambda w, f: len(self.buyers[f]) >= 2),
            bundle_4=share(lambda w, f: len(self.buyers[f]) >= 4),
            snipers_1_3=share(lambda w, f: 0 < f - L <= 3),
            snipers_0_10=share(lambda w, f: f - L <= 10 and w not in self.devs),
        )


class Coin:
    def __init__(self, r, prior, copy):
        _, _, _, ts, mint, creator, signer, name, sym, uri, vsol, vtok, quote, flag = r[:14]
        self.mint, self.name, self.sym, self.uri, self.ts, self.slot = mint, name, sym, uri, ts, r[0]
        self.flag, self.quote = flag, quote
        self.c = dict(slot=r[0], creator=creator, signer=signer, vsol0=vsol, vtok0=vtok,
                      prior_launches=prior, copy=copy)
        self.S = R.State(self.c)
        self.H = Holders(r[0], {creator, signer})
        self.feat, self.fails = None, None
        self.grad_ts, self.pool_ok = None, False
        self.pts = {}                               # 5-s bucket -> [slot of close, close, high, low] after graduation
        self.last_slot = 0
        self.peak = 0.0; self.low = self.hi = None; self.mode = "top"; self.stage = "top"
        self.price = None
        self.meta = None
        self.pool = None
        self.copy_of = []                           # (mint, launch ts) of earlier coins with the same name / ticker
        self.seen_visible = False
        self.entries = 0
        self.entry_armed = True                     # an entry alert needs a new low (or top) since the last one
        self.last_trade = None


def chart(c, now, n=90):
    """Price since graduation in n even time steps: [seconds since graduation, close, high, low] (mcap in SOL);
    a step without trades repeats the last close."""
    t0 = c.grad_ts
    w = max(60.0, now - t0) / n
    keys = sorted(c.pts)
    out, close, j = [], None, 0
    for k in range(n):
        end, hi, lo = t0 + (k + 1) * w, None, None
        while j < len(keys) and (keys[j] * 5 < end or k == n - 1):
            _, cl, h, l = c.pts[keys[j]]
            close, hi, lo = cl, h if hi is None else max(hi, h), l if lo is None else min(lo, l)
            j += 1
        if close is not None:
            out.append((round(end - t0), close * 1e6, (hi or close) * 1e6, (lo or close) * 1e6))
    return out


def fetch_json(url):
    return json.load(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0",
                                                                                 "Accept": "application/json"}), timeout=8))


def status(c, vis, why, prefs):
    """One word for the radar: rec / watch / waiting (passes, not dipped yet) / filtered / mayhem / dead / hidden."""
    if c.mint in prefs.get("hide"):
        return "hidden"
    if vis:
        return "watch" if c.mint in prefs.get("watch") else "rec"
    if why.startswith("not yet"):
        return "waiting"
    if why.startswith("Mayhem"):
        return "mayhem"
    if why.startswith("dead"):
        return "dead"
    return "filtered"


def short_why(c, why):
    """The hide reason in a few words, with the failing number where we have it."""
    if not why.startswith("filter: "):
        return why.split(" (")[0]
    f, out = c.feat or {}, []
    for r in c.fails or []:
        v = {"bundle": "bundle_pct", "snipers": "sniper_pct", "top10 concentration": "top10_pct",
             "dev holds too much": "dev_pct"}.get(r)
        out.append(f"{r.split()[0]} {f[v]:.0%}" if v and f.get(v) is not None else r)
    return ", ".join(out)


class Prefs:
    """Watchlist and coins hidden by the user, kept on the Pi (data/terminal_prefs.json) so phone and PC share them."""

    def __init__(self):
        try:
            d = json.load(open(PREFS_FILE))
        except (OSError, ValueError):
            d = {}
        self.sets = {k: set(d.get(k, [])) for k in ("watch", "hide")}

    def get(self, k):
        return self.sets[k]

    def change(self, mint, action):
        k, on = {"watch": ("watch", True), "unwatch": ("watch", False),
                 "hide": ("hide", True), "unhide": ("hide", False)}[action]
        (self.sets[k].add if on else self.sets[k].discard)(mint)
        if action == "hide":
            self.sets["watch"].discard(mint)
        tmp = PREFS_FILE + ".tmp"
        with open(tmp, "w") as f:
            json.dump({k: sorted(v) for k, v in self.sets.items()}, f)
        os.replace(tmp, PREFS_FILE)


class Terminal:
    def __init__(self, a):
        self.a = a
        self.prefs = Prefs()
        self.orig_cache = {}
        self.coins = {}
        self.creators = collections.defaultdict(list)
        self.names = {}
        self.tails = {}
        self.lock = threading.Lock()
        self.alerts = collections.deque(maxlen=200)
        self.alert_id = 0
        self.live = False
        self.usd = sol_usd() or 0.0
        self.meta_q = queue.Queue()
        self.started = time.time()
        self.events = 0

    # ---------- data ----------
    def files(self):
        cut = time.time() - HISTORY_S - 3600
        fs = [f for f in glob.glob(os.path.join(R.DATA, "*", "events-*.jsonl.gz")) if os.path.getmtime(f) >= cut]
        return sorted(fs, key=os.path.getmtime)

    def poll(self):
        recent = time.time() - self.a.max_age - 1800
        for f in self.files():
            t = self.tails.get(f)
            if t is None:
                t = self.tails[f] = Tail(f)
            only_launches = not self.live and os.path.getmtime(f) < recent   # old file: history only
            for line in t.lines():
                if only_launches and b'"C",' not in line:
                    continue
                try:
                    r = json.loads(line)
                except ValueError:
                    continue
                with self.lock:
                    self.event(r, only_launches)

    def event(self, r, history_only):
        self.events += 1
        kind, mint = r[2], r[4]
        if kind == "C":
            ts, creator, name, sym = r[3], r[5], r[7].strip().lower(), r[8].strip().lower()
            hist = self.creators[creator]
            prior = sum(1 for t in hist if ts - t < 86400)
            hist.append(ts)
            keys = {("n", name), ("s", sym)}
            earlier = {m: t for k in keys for t, m in self.names.get(k, ()) if 0 <= ts - t < 3 * 86400 and m != mint}
            for k in keys:
                self.names.setdefault(k, []).append((ts, mint))
            if not history_only and not r[12] and ts >= time.time() - self.a.max_age - 1800:
                self.coins[mint] = Coin(r, prior, bool(earlier))
                e = sorted(earlier.items(), key=lambda x: x[1])         # the earliest ones are the likely originals
                self.coins[mint].copy_of = e if len(e) <= COPY_MATCHES else e[:2] + e[-(COPY_MATCHES - 2):]
            return
        c = self.coins.get(mint)
        if c is None:
            return
        if kind == "T":
            c.H.trade(r[0], r[5], r[6], r[8], True)
            if c.S is not None:
                c.S.apply(r[0], r)
        elif kind == "G":
            if c.S is not None:
                c.feat = c.S.features()
                c.fails = [x for x in R.failed(c.feat, dict(R.FILTER, bundle_pct=self.a.bundle_max)) if x not in SKIP]
                c.S = None                          # free the per-wallet state
            c.grad_ts = r[3]
        elif kind == "P":
            if r[9] == R.NO_CREATOR:                # a pool opened by hand, not the migration (fake graduation)
                return
            c.pool_ok, c.pool = r[6] == WSOL, r[5]
            c.grad_ts = c.grad_ts or r[3]
            if c.S is not None:                     # graduation event missed by the feed: run the checks now
                c.feat = c.S.features()
                c.fails = [x for x in R.failed(c.feat, dict(R.FILTER, bundle_pct=self.a.bundle_max)) if x not in SKIP]
                c.S = None
            if c.pool_ok:
                self.meta_q.put(c)
        elif kind == "S" and c.pool_ok:
            c.H.trade(r[0], r[5], r[6], r[7], False)
            buy, base, quote, pb, pq, vq = r[6], r[7], r[8], r[9], r[10], r[11]
            B = pb - base if buy else pb + base     # event reserves are pre-trade
            Q = (pq + quote if buy else pq - quote) + vq
            if B > 0 and Q > 0:
                self.price_update(c, Q / B, r[3], r[0])

    def price_update(self, c, p, ts, slot):
        a = self.a
        b = c.pts.get(ts // 5)                          # swaps arrive over several connections, not in order
        if b is None:
            c.pts[ts // 5] = [slot, p, p, p]
        else:
            b[2], b[3] = max(b[2], p), min(b[3], p)
            if slot >= b[0]:
                b[0], b[1] = slot, p
        if slot < c.last_slot:                          # older than what we already have: chart only
            return
        c.last_slot, c.price, c.last_trade = slot, p, ts
        if p > c.peak:
            c.peak, c.low, c.hi, c.mode, c.entry_armed = p, None, None, "top", True
        dd = 1 - p / c.peak
        old = c.stage
        if dd > a.dd_max:
            c.stage = "dead"
        elif c.mode in ("top", "drop"):
            if dd >= a.dd_min:
                c.low = p if c.low is None else min(c.low, p)
                c.mode, c.stage = "drop", "zone"
                if p >= c.low * (1 + a.bounce):
                    c.mode, c.stage, c.hi = "bounce", "bounce", p
            else:
                c.stage = "dip" if dd >= a.show_dd else "top"
        else:
            if p < c.low:
                c.low, c.mode, c.stage, c.entry_armed = p, "drop", "zone", True
            else:
                c.hi = max(c.hi, p)
                c.stage = "entry" if p <= c.hi * (1 - a.pullback) else "bounce"
        vis = self.visible(c)[0]
        if vis and not c.seen_visible:
            c.seen_visible = True
            self.alert(c, "new", f"{c.sym} is {dd:.0%} below its top - check the meme")
        if vis and c.stage == "entry" and old != "entry" and c.entry_armed:
            c.entries, c.entry_armed = c.entries + 1, False
            self.alert(c, "entry", f"{c.sym}: ENTRY - bounced and pulled back {self.mcap_text(c)}")

    def mcap_usd(self, c):
        return (c.price or 0) * 1e6 * self.usd

    def mcap_text(self, c):
        m = self.mcap_usd(c)
        return f"(mcap ${m / 1000:.0f}k)" if m else ""

    def visible(self, c):
        """(shown?, reason it is hidden)."""
        if c.grad_ts is None or not c.pool_ok or c.price is None:
            return False, "not graduated"
        if c.mint in self.prefs.get("hide"):
            return False, "hidden by you"
        if c.mint in self.prefs.get("watch"):
            return True, ""
        if time.time() - c.ts > self.a.max_age:
            return False, "older than max age"
        if c.flag and not self.a.mayhem:
            return False, "Mayhem coin (pool of a few SOL, start with --mayhem to show)"
        if c.fails is None:
            return False, "on-chain checks missing"
        if c.fails:
            return False, "filter: " + ", ".join(c.fails)
        if self.usd and self.mcap_usd(c) > self.a.max_mcap_usd:
            return False, "market cap above limit"
        if c.stage == "top":
            return False, "not yet 10 % below its top"
        if c.stage == "dead":
            return False, f"dead (more than {self.a.dd_max:.0%} below its top)"
        return True, ""

    # ---------- alerts ----------
    def alert(self, c, kind, text):
        if not self.live:
            return
        self.alert_id += 1
        self.alerts.append(dict(id=self.alert_id, kind=kind, mint=c.mint, text=text, ts=time.time()))
        log("ALERT", kind, c.mint, text)
        topic = os.environ.get("SWEDEN_NTFY_TOPIC")
        if topic:
            threading.Thread(target=self.push, args=(topic, kind, c, text), daemon=True).start()

    def push(self, topic, kind, c, text):
        """Push to the phone (ntfy). The CA is the last line, so it can be copied from the notification; tapping
        opens the coin on Axiom."""
        try:
            req = urllib.request.Request(f"https://ntfy.sh/{urllib.parse.quote(topic)}",
                                         data=(text + ("\n" + c.mint if c else "")).encode(),
                                         headers={"Title": "Sweden: " + {"entry": "ENTRY", "new": "new coin"}.get(kind, kind),
                                                  "Priority": "high" if kind == "entry" else "default",
                                                  **({"Click": f"https://axiom.trade/meme/{c.pool or c.mint}?chain=sol"} if c else {})})
            urllib.request.urlopen(req, timeout=10).read()
            return True
        except Exception as e:
            log("ntfy failed:", repr(e))
            return False

    def test_push(self):
        """(sent?, message) - a test notification from the page's button."""
        with self.lock:                             # a test alert: every open page flashes and beeps
            self.alert_id += 1
            self.alerts.append(dict(id=self.alert_id, kind="test", mint="", text="Test alert", ts=time.time()))
        topic = os.environ.get("SWEDEN_NTFY_TOPIC")
        if not topic:
            return False, "test alert shown - push is off (start with SWEDEN_NTFY_TOPIC=<topic> ./terminal.sh)"
        ok = self.push(topic, "test", None, "Test from the Sweden terminal - push works")
        return ok, "test alert + push sent - check your phone" if ok else "push failed (see logs/terminal.log)"

    # ---------- background ----------
    def meta_worker(self):
        while True:
            c = self.meta_q.get()
            if c.meta is not None or not c.uri.startswith("http"):
                continue
            try:
                m = json.load(urllib.request.urlopen(urllib.request.Request(
                    c.uri, headers={"User-Agent": "Mozilla/5.0"}), timeout=8))
                ext = m.get("extensions") or {}
                c.meta = {k: (m.get(k) or ext.get(k) or "") for k in ("image", "description", "twitter", "telegram",
                                                                        "website")}
            except Exception:
                c.meta = {}

    def price_worker(self):
        while True:
            time.sleep(300)
            self.usd = sol_usd() or self.usd

    def loop(self):
        log(f"reading the last {HISTORY_S // 3600} h of collector data ...")
        self.poll()
        with self.lock:
            self.live = True
            for c in self.coins.values():         # coins already showing at start: no alert storm
                if self.visible(c)[0]:
                    c.seen_visible = True
        log(f"live: {self.events} events read, {sum(1 for c in self.coins.values() if c.grad_ts)} graduated coins "
            f"in the window, SOL ${self.usd:.0f}")
        last_prune = time.time()
        while True:
            time.sleep(2)
            self.poll()
            if time.time() - last_prune > 600:
                last_prune = time.time()
                with self.lock:
                    cut = time.time() - self.a.max_age - 1800
                    self.coins = {m: c for m, c in self.coins.items() if c.ts >= cut}
                    for k in list(self.creators):
                        self.creators[k] = [t for t in self.creators[k] if t >= time.time() - 86400]
                        if not self.creators[k]:
                            del self.creators[k]
                    cut = time.time() - HISTORY_S
                    self.names = {k: v for k, v in ((k, [x for x in v if x[0] >= cut]) for k, v in self.names.items()) if v}
                    self.tails = {f: t for f, t in self.tails.items() if os.path.exists(f)}

    # ---------- API ----------
    def original(self, mint):
        """Earlier coins with the same name / ticker as a copied coin: mcap, 24 h volume, liquidity (DexScreener, free)
        and a 15-min chart of the biggest one (GeckoTerminal, free). Cached for a minute per coin."""
        hit = self.orig_cache.get(mint)
        if hit and time.time() - hit[0] < 60:
            return hit[1]
        with self.lock:
            c = self.coins.get(mint)
            matches = list(c.copy_of) if c else []
        out = dict(matches=[], chart=[], error=None)
        if not matches:
            return out
        try:
            pairs = fetch_json("https://api.dexscreener.com/tokens/v1/solana/" + ",".join(m for m, _ in matches))
        except Exception as e:
            pairs, out["error"] = [], f"DexScreener not reachable ({e.__class__.__name__})"
        best = {}
        for p in pairs or []:
            m = (p.get("baseToken") or {}).get("address")
            if m and ((p.get("liquidity") or {}).get("usd") or 0) >= ((best.get(m) or {}).get("liquidity") or {}).get("usd", -1):
                best[m] = p
        for m, ts in matches:
            p = best.get(m) or {}
            bt = p.get("baseToken") or {}
            out["matches"].append(dict(mint=m, launched_h=(time.time() - ts) / 3600, name=bt.get("name"),
                                       sym=bt.get("symbol"), mcap=p.get("marketCap"),
                                       vol24=(p.get("volume") or {}).get("h24"), liq=(p.get("liquidity") or {}).get("usd"),
                                       change24=(p.get("priceChange") or {}).get("h24"), pair=p.get("pairAddress"),
                                       dex=p.get("dexId")))
        out["matches"].sort(key=lambda x: -(x["mcap"] or 0))
        top = out["matches"][0]
        if top["pair"]:
            try:
                d = fetch_json(f"https://api.geckoterminal.com/api/v2/networks/solana/pools/{top['pair']}/ohlcv/minute"
                               f"?aggregate=15&limit=288")
                out["chart"] = sorted((r[0], r[4] * 1e9) for r in d["data"]["attributes"]["ohlcv_list"])
            except Exception:
                pass
        self.orig_cache[mint] = (time.time(), out)
        return out

    def axiom_check(self, mint, vals):
        """Store what Axiom shows for a coin next to our live variants at the same moment (data/axiom_checks.jsonl)."""
        with self.lock:
            c = self.coins.get(mint)
            if c is None:
                return False
            rec = dict(ts=time.time(), mint=mint, sym=c.sym, mayhem=bool(c.flag), axiom=vals, ours=c.H.metrics(),
                       at_grad={k: (c.feat or {}).get(k) for k in ("bundle_pct", "sniper_pct", "top10_pct", "dev_pct")},
                       age_min=(time.time() - c.ts) / 60, mcap_usd=self.mcap_usd(c))
        with open(AXIOM_FILE, "a") as f:
            f.write(json.dumps(rec) + "\n")
        log("axiom check saved", c.sym, vals)
        return True

    def state(self, show_all):
        now = time.time()
        out, counts, radar = [], {"filtered": 0, "hidden": 0, "waiting": 0}, []
        with self.lock:
            for c in self.coins.values():
                if c.grad_ts is None or not c.pool_ok or c.price is None:
                    continue
                vis, why = self.visible(c)
                if c.mint in self.prefs.get("hide"):
                    counts["hidden"] += 1
                elif not vis:
                    counts["filtered"] += 1
                    if why.startswith("not yet"):
                        counts["waiting"] += 1
                radar.append(dict(mint=c.mint, sym=c.sym, grad_min=(now - c.grad_ts) / 60, mcap_usd=self.mcap_usd(c),
                                  status=status(c, vis, why, self.prefs), why=short_why(c, why)))
                if not vis and not show_all:
                    continue
                f = c.feat or {}
                out.append(dict(
                    mint=c.mint, pool=c.pool, name=c.name, sym=c.sym, stage=c.stage, visible=vis, hidden=why,
                    watched=c.mint in self.prefs.get("watch"), user_hidden=c.mint in self.prefs.get("hide"),
                    copy_of=len(c.copy_of),
                    mayhem=bool(c.flag), age_min=(now - c.ts) / 60, grad_min=(now - c.grad_ts) / 60,
                    mcap_usd=self.mcap_usd(c), mcap_sol=c.price * 1e6,
                    dd=1 - c.price / c.peak, from_low=(c.price / c.low - 1) if c.low else None,
                    last_trade_s=now - c.last_trade if c.last_trade else None, entries=c.entries,
                    pts=chart(c, now), peak=c.peak * 1e6,
                    low=c.low * 1e6 if c.low else None,
                    checks=dict(top10=f.get("top10_pct"), bundle=f.get("bundle_pct"), snipers=f.get("sniper_pct"),
                                top3_trades=f.get("top3_trade_share"), same_sizes=f.get("same_size_share"),
                                prior=f.get("prior_launches"), copy=f.get("copy"), dev_sold=f.get("dev_sold"),
                                traders=f.get("traders")),
                    live=c.H.metrics(), meta=c.meta or {}))
            alerts = list(self.alerts)
        return dict(now=now, live=self.live, sol_usd=self.usd, coins=out, alerts=alerts, all=show_all, counts=counts,
                    radar=sorted(radar, key=lambda r: r["grad_min"]),
                    settings=dict(max_age_h=self.a.max_age / 3600, max_mcap_usd=self.a.max_mcap_usd, bundle_max=self.a.bundle_max,
                                  top10_max=R.FILTER["top10_pct"], sniper_max=R.FILTER["sniper_pct"],
                                  dev_max=R.FILTER["dev_pct"], prior_max=R.FILTER["max_prior_launches"],
                                  show_dd=self.a.show_dd, dd_min=self.a.dd_min, dd_max=self.a.dd_max,
                                  bounce=self.a.bounce, pullback=self.a.pullback))


def serve(t, port):
    page = os.path.join(HERE, "terminal.html")
    gate = Gate()

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def send(self, code, body, ctype):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.end_headers()
            self.wfile.write(body)

        def ip(self):
            peer = self.client_address[0]
            if peer in ("127.0.0.1", "::1"):           # through the Cloudflare tunnel
                return self.headers.get("CF-Connecting-IP") or peer
            return peer

        def do_GET(self):
            u = urllib.parse.urlparse(self.path)
            if u.path == "/":
                self.send(200, open(page, "rb").read(), "text/html; charset=utf-8")
            elif u.path == "/api/original":
                if not gate.token_ok(self.headers.get("X-Sweden-Token")):
                    return self.send(401, b'{"error":"locked"}', "application/json")
                m = urllib.parse.parse_qs(u.query).get("mint", [""])[0][:64]
                self.send(200, json.dumps(t.original(m)).encode(), "application/json")
            elif u.path == "/api/state":
                if not gate.token_ok(self.headers.get("X-Sweden-Token")):
                    return self.send(401, b'{"error":"locked"}', "application/json")
                show_all = urllib.parse.parse_qs(u.query).get("all") == ["1"]
                self.send(200, json.dumps(t.state(show_all)).encode(), "application/json")
            else:
                self.send(404, b"not found", "text/plain")

        def do_POST(self):
            if self.path not in ("/api/login", "/api/axiom", "/api/prefs", "/api/testpush"):
                return self.send(404, b"not found", "text/plain")
            n = int(self.headers.get("Content-Length") or 0)
            if self.path == "/api/testpush":
                if not gate.token_ok(self.headers.get("X-Sweden-Token")):
                    return self.send(401, b'{"error":"locked"}', "application/json")
                ok, msg = t.test_push()
                return self.send(200, json.dumps(dict(ok=ok, msg=msg)).encode(), "application/json")
            if self.path == "/api/prefs":
                if not gate.token_ok(self.headers.get("X-Sweden-Token")):
                    return self.send(401, b'{"error":"locked"}', "application/json")
                try:
                    b = json.loads(self.rfile.read(min(n, 1000)))
                    with t.lock:
                        t.prefs.change(str(b["mint"])[:64], b["action"])
                    ok = True
                except (ValueError, KeyError, TypeError, AttributeError):
                    ok = False
                return self.send(200 if ok else 400, json.dumps(dict(ok=ok)).encode(), "application/json")
            if self.path == "/api/axiom":
                if not gate.token_ok(self.headers.get("X-Sweden-Token")):
                    return self.send(401, b'{"error":"locked"}', "application/json")
                try:
                    b = json.loads(self.rfile.read(min(n, 4000)))
                    vals = {k: float(v) for k, v in b["values"].items()
                            if k in AXIOM_FIELDS and v not in ("", None)}
                    ok = bool(vals) and t.axiom_check(str(b["mint"]), vals)
                except (ValueError, KeyError, TypeError, AttributeError):
                    ok = False
                return self.send(200 if ok else 400, json.dumps(dict(ok=ok)).encode(), "application/json")
            try:
                guess = str(json.loads(self.rfile.read(min(n, 1000)) or b"{}").get("passkey", ""))
            except (ValueError, AttributeError):
                guess = ""
            code, out = gate.login(self.ip(), guess.strip())
            self.send(code, json.dumps(out).encode(), "application/json")

    ThreadingHTTPServer(("0.0.0.0", port), H).serve_forever()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8750)
    ap.add_argument("--max-age", type=float, default=21600, help="seconds since launch")
    ap.add_argument("--max-mcap-usd", type=float, default=100000)
    ap.add_argument("--show-dd", type=float, default=0.10, help="show a coin once it is this far below its top")
    ap.add_argument("--dd-min", type=float, default=0.30)
    ap.add_argument("--dd-max", type=float, default=0.75)
    ap.add_argument("--bounce", type=float, default=0.20)
    ap.add_argument("--pullback", type=float, default=0.10)
    ap.add_argument("--bundle-max", type=float, default=0.15,
                    help="hide a coin if launch-slot buyers still held more than this share at graduation")
    ap.add_argument("--mayhem", action="store_true", help="also show Mayhem coins (they graduate into tiny pools)")
    a = ap.parse_args()
    t = Terminal(a)
    for target in (t.loop, t.meta_worker, t.price_worker):
        threading.Thread(target=target, daemon=True).start()
    log(f"SWEDEN terminal on http://0.0.0.0:{a.port}  (ntfy push: {'on' if os.environ.get('SWEDEN_NTFY_TOPIC') else 'off'})")
    serve(t, a.port)


if __name__ == "__main__":
    main()
