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
Env:  SWEDEN_NTFY_TOPIC   ntfy topic of the owner account (taken over by the first account that signs up)
      SWEDEN_PASSKEY      the passkey for the page; else the file ./terminal_passkey (generated on first start)

Accounts (accounts.py): after the passkey every user logs in or signs up (email code + password). Filter, dip pattern,
watchlist / hidden coins, alerts (own ntfy topic) and style are per user; the command-line options are the defaults
for new accounts (and the owner's settings, which match the research replay). The new link after a restart is pushed
to every user's ntfy topic.

Access: the page holds no data; /api/state needs a token that only the passkey hands out (checked here, on the Pi).
A token is signed with the passkey and valid for TOKEN_DAYS, so restarts keep you logged in and changing the
passkey logs every browser out. Wrong passkeys lock the address out for longer and longer.
"""
import argparse, collections, glob, hashlib, hmac, json, os, queue, re, secrets, sys, threading, time, urllib.parse
import urllib.request, zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(__file__))
import accounts as A
import replay as R
import wallet as WL
from grad_replay import SKIP, WSOL, sol_usd

HERE = os.path.dirname(os.path.abspath(__file__))
HISTORY_S = 72 * 3600                    # creator history (24 h) and copied names (72 h) need this much data
AXIOM_FILE = os.path.join(R.DATA, "axiom_checks.jsonl")
PREFS_FILE = os.path.join(R.DATA, "terminal_prefs.json")
PASSKEY_FILE = os.path.join(HERE, "..", "terminal_passkey")
HELIUS_KEY_FILE = os.environ.get("SWEDEN_HELIUS_KEY_FILE") or os.path.join(HERE, "..", "helius_key")
MAIL_FILE = os.environ.get("SWEDEN_MAIL_FILE") or os.path.join(HERE, "..", "gmail.json")   # tests: SWEDEN_MAIL_FILE=none
TUNNEL_LOG = os.environ.get("SWEDEN_TUNNEL_LOG") or os.path.join(HERE, "..", "logs", "tunnel.log")   # tests: =none
LAST_LINK = os.path.join(R.DATA, "last_link.txt")
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


class Stage:
    """One user's view of a coin's dip pattern (the dip settings are per user)."""
    __slots__ = ("low", "hi", "mode", "stage", "armed", "seen", "entries", "fresh")

    def __init__(self, fresh):
        self.low = self.hi = None
        self.mode, self.stage = "top", "top"
        self.armed = True                           # an entry alert needs a new low (or top) since the last one
        self.seen = False                           # the "new coin" alert was sent (or the coin was already shown)
        self.entries = 0
        self.fresh = fresh                          # created while live: first update only sets `seen`, no alert


class Coin:
    def __init__(self, r, prior, copy):
        _, _, _, ts, mint, creator, signer, name, sym, uri, vsol, vtok, quote, flag = r[:14]
        self.mint, self.name, self.sym, self.uri, self.ts, self.slot = mint, name, sym, uri, ts, r[0]
        self.flag, self.quote = flag, quote
        self.c = dict(slot=r[0], creator=creator, signer=signer, vsol0=vsol, vtok0=vtok,
                      prior_launches=prior, copy=copy)
        self.S = R.State(self.c)
        self.H = Holders(r[0], {creator, signer})
        self.feat = None                            # on-chain checks at graduation (None = not run yet)
        self.grad_ts, self.pool_ok = None, False
        self.pts = {}                               # 5-s bucket -> [slot of close, close, high, low] after graduation
        self.last_slot = 0
        self.peak = 0.0
        self.ust = {}                               # user id -> Stage
        self.price = None
        self.meta = None
        self.pool = None
        self.copy_of = []                           # (mint, launch ts, why) of earlier graduated coins it copies
        self.last_trade = None
        self.trades = []                            # (slot, seq, ts, mcap SOL, SOL lamports, buy, wallet, tokens, pool?)
        self.liq_sol = None                         # real SOL in the curve / pool after the latest trade


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


def usd_text(x):
    return f"${x / 1e6:.2f}M" if x >= 1e6 else f"${x / 1e3:.1f}K" if x >= 1e3 else f"${x:.0f}"


def fetch_json(url):
    return json.load(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0",
                                                                                 "Accept": "application/json"}), timeout=8))


def fails_for(c, s):
    """Failed on-chain checks under one user's settings (None = checks not run yet)."""
    if c.feat is None:
        return None
    F = dict(R.FILTER, bundle_pct=s["bundle_max"], top10_pct=s["top10_max"], sniper_pct=s["sniper_max"],
             dev_pct=s["dev_max"], max_prior_launches=s["prior_max"])
    off = set(SKIP)
    if not s["copy_check"]:
        off.add("copy of earlier coin")
    if not s["wash_check"]:
        off |= {"wash: top3 wallets", "wash: same sizes"}
    return [x for x in R.failed(c.feat, F) if x not in off]


def status(c, vis, why, u):
    """One word for the radar: rec / watch / waiting (passes, not dipped yet) / filtered / mayhem / dead / hidden."""
    if c.mint in u["hide"]:
        return "hidden"
    if c.mint in u["watch"]:
        return "watch"
    if vis:
        return "rec"
    if why.startswith("not yet"):
        return "waiting"
    if why.startswith("Mayhem"):
        return "mayhem"
    if why.startswith("dead"):
        return "dead"
    return "filtered"


def short_why(c, why, fails):
    """The hide reason in a few words, with the failing number where we have it."""
    if not why.startswith("filter: "):
        return why.split(" (")[0]
    f, out = c.feat or {}, []
    for r in fails or []:
        v = {"bundle": "bundle_pct", "snipers": "sniper_pct", "top10 concentration": "top10_pct",
             "dev holds too much": "dev_pct"}.get(r)
        if r == "copy of earlier coin" and c.copy_of:
            r = f"copy ({c.copy_of[0][2]})"
        out.append(f"{r.split()[0]} {f[v]:.0%}" if v and f.get(v) is not None else r)
    return ", ".join(out)


class Terminal:
    def __init__(self, a, acc):
        self.a = a
        self.acc = acc
        self.orig_cache = {}
        self.coins = {}
        self.creators = collections.defaultdict(list)
        self.names = {}
        self.graduated = {}                     # mint -> graduation ts, every coin in the data
        self.tails = {}
        self.lock = threading.Lock()
        self.alerts = collections.defaultdict(lambda: collections.deque(maxlen=200))   # user id -> alerts
        self.alert_id = 0
        self.live = False
        self.usd = sol_usd() or 0.0
        self.meta_q = queue.Queue()
        self.started = time.time()
        self.events = 0
        self.seq = 0

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
                if only_launches and b'"C",' not in line and b'"G",' not in line and b'"P",' not in line:
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
            ts, creator = r[3], r[5]
            hist = self.creators[creator]
            prior = sum(1 for t in hist if ts - t < 86400)
            hist.append(ts)
            earlier = R.copy_matches(self.names, ts, r[7], r[8], mint, self.graduated)
            if not history_only and not r[12] and ts >= time.time() - self.a.max_age - 1800:
                self.coins[mint] = Coin(r, prior, bool(earlier))
                e = sorted(((m, t, why) for m, (t, why) in earlier.items()), key=lambda x: x[1])  # earliest = likely originals
                self.coins[mint].copy_of = e if len(e) <= COPY_MATCHES else e[:2] + e[-(COPY_MATCHES - 2):]
            return
        if kind == "G" or (kind == "P" and r[9] != R.NO_CREATOR):
            self.graduated.setdefault(mint, r[3])   # for the copy check (only copies of graduated coins count)
        c = self.coins.get(mint)
        if c is None:
            return
        if kind == "T":
            c.H.trade(r[0], r[5], r[6], r[8], True)
            if c.S is not None:
                c.S.apply(r[0], r)
            if r[10] > 0:
                self.seq += 1
                mc = r[9] / r[10] * 1e6                 # reserves after the trade -> mcap in SOL
                c.trades.append((r[0], self.seq, r[3], mc, r[7], r[6], r[5], r[8], False))
                if r[0] >= c.last_slot:
                    c.liq_sol = (r[9] - c.c["vsol0"]) / 1e9
                self.check_px(c, mc)
        elif kind == "G":
            if c.S is not None:
                c.feat = c.S.features()
                c.S = None                          # free the per-wallet state
            c.grad_ts = r[3]
        elif kind == "P":
            if r[9] == R.NO_CREATOR:                # a pool opened by hand, not the migration (fake graduation)
                return
            c.pool_ok, c.pool = r[6] == WSOL, r[5]
            c.grad_ts = c.grad_ts or r[3]
            if c.S is not None:                     # graduation event missed by the feed: run the checks now
                c.feat = c.S.features()
                c.S = None
            if c.pool_ok:
                self.meta_q.put(c)
        elif kind == "S" and c.pool_ok:
            c.H.trade(r[0], r[5], r[6], r[7], False)
            buy, base, quote, pb, pq, vq = r[6], r[7], r[8], r[9], r[10], r[11]
            B = pb - base if buy else pb + base     # event reserves are pre-trade
            Q = (pq + quote if buy else pq - quote) + vq
            if B > 0 and Q > 0:
                self.seq += 1
                c.trades.append((r[0], self.seq, r[3], Q / B * 1e6, quote, buy, r[5], base, True))
                if r[0] >= c.last_slot:
                    c.liq_sol = (pq + quote if buy else pq - quote) / 1e9
                self.price_update(c, Q / B, r[3], r[0])
                self.check_px(c, Q / B * 1e6)

    def price_update(self, c, p, ts, slot):
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
        new_top = p > c.peak
        if new_top:
            c.peak = p
        dd = 1 - p / c.peak
        for uid, u in self.acc.users().items():
            s = u["settings"]
            st = c.ust.get(uid)
            if st is None:
                st = c.ust[uid] = Stage(fresh=self.live)
            if new_top:
                st.low, st.hi, st.mode, st.armed = None, None, "top", True
            old = st.stage
            if dd > s["dd_max"]:
                st.stage = "dead"
            elif st.mode in ("top", "drop"):
                if dd >= s["dd_min"]:
                    st.low = p if st.low is None else min(st.low, p)
                    st.mode, st.stage = "drop", "zone"
                    if p >= st.low * (1 + s["bounce"]):
                        st.mode, st.stage, st.hi = "bounce", "bounce", p
                else:
                    st.stage = "dip" if dd >= s["show_dd"] else "top"
            else:
                if p < st.low:
                    st.low, st.mode, st.stage, st.armed = p, "drop", "zone", True
                else:
                    st.hi = max(st.hi, p)
                    st.stage = "entry" if p <= st.hi * (1 - s["pullback"]) else "bounce"
            vis, watch_only = self.alertable(c, uid)
            if st.fresh:                                # account / settings new while live: no alert storm
                st.seen, st.fresh = vis, False
                continue
            tag = " (watchlist, outside your filter)" if watch_only else ""
            if vis and not st.seen:
                st.seen = True
                if s["alert_new"]:
                    self.alert(c, uid, "new", f"{c.sym} is {dd:.0%} below its top - check the meme{tag}")
            if vis and st.stage == "entry" and old != "entry" and st.armed:
                st.entries, st.armed = st.entries + 1, False
                if s["alert_entry"]:
                    self.alert(c, uid, "entry", f"{c.sym}: ENTRY - bounced and pulled back {self.mcap_text(c)}{tag}")

    def check_px(self, c, mcap_sol):
        """Fire the price / mcap alerts set on this coin (one-shot)."""
        alerts = self.acc.px.get(c.mint)
        if not alerts or not self.live or not self.usd:
            return
        mc = mcap_sol * self.usd
        for a in list(alerts):
            v = mc if a["kind"] == "mcap" else mc / 1e9
            if (a["op"] == ">=" and v >= a["value"]) or (a["op"] == "<=" and v <= a["value"]):
                if a["uid"] not in self.acc.users():
                    continue
                self.acc.px_delete(a["uid"], a["id"])
                what = f"mcap {'above' if a['op'] == '>=' else 'below'} {usd_text(a['value'])}" if a["kind"] == "mcap" else \
                    f"price {'above' if a['op'] == '>=' else 'below'} ${a['value']:.10g}"
                self.alert(c, a["uid"], "px", f"{c.sym}: {what} (mcap now {usd_text(mc)})")

    def mcap_usd(self, c):
        return (c.price or 0) * 1e6 * self.usd

    def mcap_text(self, c):
        m = self.mcap_usd(c)
        return f"(mcap ${m / 1000:.0f}k)" if m else ""

    def alertable(self, c, uid):
        """(alerts on?, only because it is on the watchlist?): recommended coins, and watchlist coins outside the filter
        when the user switched that on (still not near the top, not dead, not hidden)."""
        if self.visible(c, uid)[0]:
            return True, False
        u = self.acc.users()[uid]
        st = c.ust.get(uid)
        if (u["settings"]["alert_watch"] and c.mint in u["watch"] and c.mint not in u["hide"] and c.grad_ts is not None
                and c.pool_ok and c.price is not None and st is not None and st.stage not in ("top", "dead")):
            return True, True
        return False, False

    def visible(self, c, uid):
        """(shown?, reason it is hidden) for one user."""
        u = self.acc.users().get(uid)
        if u is None:
            return False, "no account"
        s = u["settings"]
        if c.grad_ts is None or not c.pool_ok or c.price is None:
            return False, "not graduated"
        if c.mint in u["hide"]:
            return False, "hidden by you"
        if time.time() - c.ts > s["max_age_h"] * 3600:
            return False, "older than max age"
        if c.flag and not s["mayhem"]:
            return False, "Mayhem coin (pool of a few SOL, can be switched on in the settings)"
        fails = fails_for(c, s)
        if fails is None:
            return False, "on-chain checks missing"
        if fails:
            return False, "filter: " + ", ".join(fails)
        if self.usd and self.mcap_usd(c) > s["max_mcap_usd"]:
            return False, "market cap above limit"
        stage = c.ust[uid].stage if uid in c.ust else "top"
        if stage == "top":
            return False, f"not yet {s['show_dd']:.0%} below its top"
        if stage == "dead":
            return False, f"dead (more than {s['dd_max']:.0%} below its top)"
        return True, ""

    # ---------- alerts ----------
    def alert(self, c, uid, kind, text):
        if not self.live:
            return
        self.alert_id += 1
        self.alerts[uid].append(dict(id=self.alert_id, kind=kind, mint=c.mint, text=text, ts=time.time()))
        log("ALERT", f"user {uid}", kind, c.mint, text)
        topic = self.acc.users()[uid]["settings"]["ntfy_topic"]
        if topic:
            threading.Thread(target=self.push, args=(topic, kind, c, text), daemon=True).start()

    def push(self, topic, kind, c, text):
        """Push to the phone (ntfy). The CA is the last line, so it can be copied from the notification; tapping
        opens the coin on Axiom."""
        try:
            req = urllib.request.Request(f"https://ntfy.sh/{urllib.parse.quote(topic)}",
                                         data=(text + ("\n" + c.mint if c else "")).encode(),
                                         headers={"Title": "Sweden: " + {"entry": "ENTRY", "new": "new coin",
                                                                          "px": "price alert"}.get(kind, kind),
                                                  "Priority": "high" if kind in ("entry", "px") else "default",
                                                  **({"Click": f"https://axiom.trade/meme/{c.pool or c.mint}?chain=sol"} if c else {})})
            urllib.request.urlopen(req, timeout=10).read()
            return True
        except Exception as e:
            log("ntfy failed:", repr(e))
            return False

    def test_push(self, uid):
        """(sent?, message) - a test alert for one user: their open pages flash, their phone gets a push."""
        with self.lock:
            self.alert_id += 1
            self.alerts[uid].append(dict(id=self.alert_id, kind="test", mint="", text="Test alert", ts=time.time()))
        topic = self.acc.users()[uid]["settings"]["ntfy_topic"]
        if not topic:
            return False, "test alert shown - no ntfy topic set (Settings > Alerts)"
        ok = self.push(topic, "test", None, "Test from the Sweden terminal - push works")
        return ok, "test alert + push sent - check your phone" if ok else "push failed (see logs/terminal.log)"

    def link_worker(self):
        """The Cloudflare link changes on every tunnel start: push a new one to every user's ntfy topic."""
        env_topic = os.environ.get("SWEDEN_NTFY_TOPIC", "")
        while True:
            try:
                urls = re.findall(r"https://[a-z0-9-]+\.trycloudflare\.com", open(TUNNEL_LOG, errors="ignore").read())
                last = open(LAST_LINK).read().strip() if os.path.exists(LAST_LINK) else ""
                if urls and urls[-1] != last:
                    url = urls[-1]
                    topics = {u["settings"]["ntfy_topic"] for u in self.acc.users().values()} | {env_topic}
                    for tp in sorted(x for x in topics if x):
                        try:
                            urllib.request.urlopen(urllib.request.Request(
                                f"https://ntfy.sh/{urllib.parse.quote(tp)}", data=f"New link: {url}".encode(),
                                headers={"Title": "Sweden terminal started", "Click": url}), timeout=10).read()
                        except Exception as e:
                            log("ntfy (link) failed:", repr(e))
                    open(LAST_LINK, "w").write(url)
                    log("new link pushed:", url)
            except OSError:
                pass
            time.sleep(20)

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
                for uid in self.acc.users():
                    if uid in c.ust and self.alertable(c, uid)[0]:
                        c.ust[uid].seen = True
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
                    self.graduated = {m: t for m, t in self.graduated.items() if t >= cut}
                    self.tails = {f: t for f, t in self.tails.items() if os.path.exists(f)}

    # ---------- API ----------
    def token_price(self, mint):
        """(USD per token, name, symbol, image) for the wallet page, from the coin's latest trade; None if unknown."""
        with self.lock:
            c = self.coins.get(mint)
            if c is None or not c.trades or not self.usd:
                return None
            mc = max(c.trades, key=lambda x: (x[0], x[1]))[3]          # mcap in SOL after the newest trade
            return (mc * self.usd / 1e9, c.name, c.sym, (c.meta or {}).get("image"))

    def lookup(self, mint, uid):
        """Where a pasted CA stands: which tab shows it and why, or why it is not shown at all."""
        now = time.time()
        with self.lock:
            c = self.coins.get(mint)
            if c is None:
                return dict(found=False, text="Not among the pump.fun launches of the last "
                            f"{(self.a.max_age + 1800) / 3600:.1f} h (older, launched elsewhere, or missed by the feed)")
            base = dict(found=True, mint=mint, sym=c.sym, name=c.name, pool=c.pool, age_min=(now - c.ts) / 60)
            if c.grad_ts is None or not c.pool_ok or c.price is None:
                st = c.S
                mc = st.vsol / st.vtok * 1e6 * self.usd if st is not None and st.vtok else None
                return dict(base, tab=None, text="Still on the bonding curve (not graduated)"
                            + (f" · mcap {usd_text(mc)}" if mc else ""))
            u = self.acc.users()[uid]
            vis, why = self.visible(c, uid)
            stage = c.ust[uid].stage if uid in c.ust else "top"
            if c.mint in u["hide"]:
                return dict(base, tab="hidden", text="Hidden by you")
            st_txt = {"entry": "ENTRY", "bounce": "bounce", "zone": "in the zone", "dip": "dip"}.get(stage, stage)
            if c.mint in u["watch"]:
                return dict(base, tab="watch", text="On your watchlist · " + (f"recommended · {st_txt}" if vis else
                            "not recommended: " + short_why(c, why, fails_for(c, u["settings"]))))
            if vis:
                return dict(base, tab="all", text="Recommended · " + st_txt)
            return dict(base, tab="filtered", text="Filtered out: " + short_why(c, why, fails_for(c, u["settings"])))

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
            pairs = fetch_json("https://api.dexscreener.com/tokens/v1/solana/" + ",".join(m for m, _, _ in matches))
        except Exception as e:
            pairs, out["error"] = [], f"DexScreener not reachable ({e.__class__.__name__})"
        best = {}
        for p in pairs or []:
            m = (p.get("baseToken") or {}).get("address")
            if m and ((p.get("liquidity") or {}).get("usd") or 0) >= ((best.get(m) or {}).get("liquidity") or {}).get("usd", -1):
                best[m] = p
        for m, ts, why in matches:
            p = best.get(m) or {}
            bt = p.get("baseToken") or {}
            out["matches"].append(dict(mint=m, why=why, launched_h=(time.time() - ts) / 3600, name=bt.get("name"),
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

    def wallet_tags(self, c, top10):
        H = c.H
        def tags(w):
            out = []
            if w in H.devs:
                out.append("dev")
            f = H.first.get(w)
            if f == H.L:
                out.append("bundler")
            elif f is not None and 0 < f - H.L <= 3:
                out.append("sniper")
            if w in top10:
                out.append("top10")
            return out
        return tags

    def detail(self, mint, uid):
        """Everything for the coin page: info, latest trades with wallet tags, top holders, this user's alerts."""
        now = time.time()
        with self.lock:
            c = self.coins.get(mint)
            if c is None:
                return dict(found=False)
            held = sorted(((w, t) for w, t in c.H.hold.items() if t > 0), key=lambda x: -x[1])
            top10 = {w for w, _ in held[:10]}
            tags = self.wallet_tags(c, top10)
            tr = sorted(c.trades, key=lambda x: (x[0], x[1]))
            usd = self.usd
            def window(sec):
                xs = [x for x in tr if x[2] >= now - sec]
                return dict(vol=sum(x[4] for x in xs) / 1e9 * usd, buys=sum(1 for x in xs if x[5]),
                            sells=sum(1 for x in xs if not x[5]), makers=len({x[6] for x in xs}))
            last_mc = tr[-1][3] if tr else c.c["vsol0"] / c.c["vtok0"] * 1e6
            f = c.feat or {}
            u = self.acc.users()[uid]
            vis, why = self.visible(c, uid)
            st = c.ust.get(uid)
            info = dict(
                found=True, mint=mint, name=c.name, sym=c.sym, pool=c.pool, creator=c.c["creator"], meta=c.meta or {},
                age_min=(now - c.ts) / 60, graduated=c.grad_ts is not None and c.pool_ok,
                grad_min=(now - c.grad_ts) / 60 if c.grad_ts else None, mayhem=bool(c.flag),
                mcap_usd=last_mc * usd, ath_usd=max((x[3] for x in tr), default=last_mc) * usd,
                liq_usd=(c.liq_sol or 0) * usd * (2 if c.pool_ok else 1), liq_sol=c.liq_sol,
                w5m=window(300), w1h=window(3600), w6h=window(21600), trades_total=len(tr),
                live=c.H.metrics(), copy_of=len(c.copy_of), stage=st.stage if st else "top", visible=vis, hidden=why,
                watched=mint in u["watch"], user_hidden=mint in u["hide"],
                checks=dict(top10=f.get("top10_pct"), bundle=f.get("bundle_pct"), snipers=f.get("sniper_pct"),
                            prior=f.get("prior_launches"), dev_sold=f.get("dev_sold"), traders=f.get("traders"),
                            top3_trades=f.get("top3_trade_share"), same_sizes=f.get("same_size_share")))
            trades = [dict(ts=x[2], buy=x[5], sol=x[4] / 1e9, usd=x[4] / 1e9 * usd, tokens=x[7], mcap_usd=x[3] * usd,
                           wallet=x[6], pool=x[8], tags=tags(x[6])) for x in reversed(tr[-100:])]
            holders = [dict(wallet=w, share=t / R.SUPPLY, tags=tags(w)) for w, t in held[:20]]
        return dict(info=info, trades=trades, holders=holders, sol_usd=self.usd,
                    alerts=[a for a in self.acc.px_list(uid) if a["mint"] == mint])

    def candles(self, mint, tf):
        """OHLC of the market cap (SOL) per `tf` seconds over the coin's whole life (curve and PumpSwap), last 1500."""
        with self.lock:
            c = self.coins.get(mint)
            if c is None:
                return dict(found=False)
            tr = sorted(c.trades, key=lambda x: (x[0], x[1]))
            grad = c.grad_ts
        out, cur = [], None
        for x in tr:
            t = int(x[2] // tf * tf)
            if cur is None or t != cur[0]:
                if cur is not None:
                    out.append(cur)
                o = cur[4] if cur is not None else x[3]          # open at the previous close: no gaps between candles
                cur = [t, o, max(o, x[3]), min(o, x[3]), x[3], 0.0]
            cur[2], cur[3], cur[4] = max(cur[2], x[3]), min(cur[3], x[3]), x[3]
            cur[5] += x[4] / 1e9
        if cur is not None:
            out.append(cur)
        return dict(found=True, tf=tf, candles=out[-1500:], grad_ts=grad, sol_usd=self.usd)

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

    def state(self, uid, show_all):
        now = time.time()
        u = self.acc.users()[uid]
        s = u["settings"]
        out, counts, radar = [], {"filtered": 0, "hidden": 0, "waiting": 0}, []
        with self.lock:
            for c in self.coins.values():
                if c.grad_ts is None or not c.pool_ok or c.price is None:
                    continue
                vis, why = self.visible(c, uid)
                fails = fails_for(c, s)
                st = c.ust.get(uid)
                if c.mint in u["hide"]:
                    counts["hidden"] += 1
                elif not vis:
                    counts["filtered"] += 1
                    if why.startswith("not yet"):
                        counts["waiting"] += 1
                radar.append(dict(mint=c.mint, sym=c.sym, grad_min=(now - c.grad_ts) / 60, mcap_usd=self.mcap_usd(c),
                                  status=status(c, vis, why, u), why=short_why(c, why, fails)))
                if not vis and not show_all and c.mint not in u["watch"]:
                    continue
                f = c.feat or {}
                low = st.low if st else None
                out.append(dict(
                    mint=c.mint, pool=c.pool, name=c.name, sym=c.sym, stage=st.stage if st else "top", visible=vis,
                    hidden=why, watched=c.mint in u["watch"], user_hidden=c.mint in u["hide"],
                    copy_of=len(c.copy_of),
                    mayhem=bool(c.flag), age_min=(now - c.ts) / 60, grad_min=(now - c.grad_ts) / 60,
                    mcap_usd=self.mcap_usd(c), mcap_sol=c.price * 1e6,
                    dd=1 - c.price / c.peak, from_low=(c.price / low - 1) if low else None,
                    last_trade_s=now - c.last_trade if c.last_trade else None, entries=st.entries if st else 0,
                    pts=chart(c, now), peak=c.peak * 1e6, low=low * 1e6 if low else None,
                    checks=dict(top10=f.get("top10_pct"), bundle=f.get("bundle_pct"), snipers=f.get("sniper_pct"),
                                top3_trades=f.get("top3_trade_share"), same_sizes=f.get("same_size_share"),
                                prior=f.get("prior_launches"), copy=f.get("copy"), dev_sold=f.get("dev_sold"),
                                traders=f.get("traders")),
                    live=c.H.metrics(), meta=c.meta or {}))
            alerts = list(self.alerts[uid])
        self.wallets.touch(uid)
        return dict(now=now, live=self.live, sol_usd=self.usd, coins=out, alerts=alerts, all=show_all, counts=counts,
                    wallet=self.wallets.summary(uid),
                    radar=sorted(radar, key=lambda r: r["grad_min"]), email=u["email"], settings=s,
                    defaults=self.acc.defaults)


def serve(t, port):
    page = os.path.join(HERE, "terminal.html")
    gate = Gate()
    acc = t.acc

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def send(self, code, body, ctype="application/json"):
            if not isinstance(body, bytes):
                body = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):   # the browser closed the page / connection meanwhile
                pass

        def ip(self):
            peer = self.client_address[0]
            if peer in ("127.0.0.1", "::1"):           # through the Cloudflare tunnel
                return self.headers.get("CF-Connecting-IP") or peer
            return peer

        def auth(self, user=True):
            """Passkey token (and with `user` a login token); False = already answered with 401."""
            if not gate.token_ok(self.headers.get("X-Sweden-Token")):
                self.send(401, {"error": "locked"})
                return False
            if not user:
                return True
            uid = acc.user_from_token(self.headers.get("X-Sweden-User"))
            if uid is None or uid not in acc.users():
                self.send(401, {"error": "login"})
                return False
            return uid

        def body(self, limit=4000):
            n = int(self.headers.get("Content-Length") or 0)
            try:
                b = json.loads(self.rfile.read(min(n, limit)) or b"{}")
                return b if isinstance(b, dict) else {}
            except ValueError:
                return {}

        def do_GET(self):
            u = urllib.parse.urlparse(self.path)
            q = urllib.parse.parse_qs(u.query)
            if u.path == "/":
                return self.send(200, open(page, "rb").read(), "text/html; charset=utf-8")
            if not u.path.startswith("/api/"):
                return self.send(404, b"not found", "text/plain")
            uid = self.auth()
            if uid is False:
                return
            m = q.get("mint", [""])[0][:64]
            if u.path == "/api/coin":
                self.send(200, t.lookup(m, uid))
            elif u.path == "/api/original":
                self.send(200, t.original(m))
            elif u.path == "/api/state":
                self.send(200, t.state(uid, q.get("all") == ["1"]))
            elif u.path == "/api/detail":
                self.send(200, t.detail(m, uid))
            elif u.path == "/api/candles":
                tf = q.get("tf", ["60"])[0]
                self.send(200, t.candles(m, int(tf)) if tf in ("1", "5", "15", "60", "300", "900", "3600")
                          else {"error": "bad timeframe"})
            elif u.path == "/api/pxalerts":
                self.send(200, {"alerts": acc.px_list(uid)})
            elif u.path == "/api/wallet":
                t.wallets.touch(uid)
                self.send(200, t.wallets.full(uid))
            else:
                self.send(404, {"error": "not found"})

        def do_POST(self):
            p = self.path
            if p == "/api/login":                      # the shared passkey
                code, out = gate.login(self.ip(), str(self.body(1000).get("passkey", "")).strip())
                return self.send(code, out)
            if p.startswith("/api/account/"):            # sign-up / login / codes: passkey only
                if not self.auth(user=False):
                    return
                b, ip = self.body(), self.ip()
                act = p.rsplit("/", 1)[1]
                if act == "signup":
                    code, out = acc.signup(ip, b.get("email"), b.get("password"))
                elif act == "verify":
                    code, out = acc.verify(ip, b.get("email"), b.get("code"))
                elif act == "login":
                    code, out = acc.login(ip, b.get("email"), b.get("password"))
                elif act == "forgot":
                    code, out = acc.forgot(ip, b.get("email"))
                elif act == "reset":
                    code, out = acc.reset(ip, b.get("email"), b.get("code"), b.get("password"))
                else:
                    code, out = 404, {"error": "not found"}
                return self.send(code, out)
            uid = self.auth()
            if uid is False:
                return
            b = self.body()
            if p == "/api/settings":
                st = acc.save_settings(uid, b.get("settings"))
                with t.lock:                             # new dip settings: restart this user's stages quietly
                    for c in t.coins.values():
                        c.ust.pop(uid, None)
                return self.send(200, {"ok": True, "settings": st})
            if p == "/api/pxalerts":
                try:
                    m = str(b["mint"])[:64]
                    with t.lock:
                        c = t.coins.get(m)
                        sym = c.sym if c else str(b.get("sym", "?"))
                    aid = acc.px_add(uid, m, sym, b.get("kind", "mcap"), b.get("op"), float(b["value"]))
                    return self.send(200 if aid else 400, {"ok": bool(aid), "id": aid, "alerts": acc.px_list(uid)})
                except (KeyError, TypeError, ValueError):
                    return self.send(400, {"ok": False})
            if p == "/api/pxalerts/delete":
                try:
                    acc.px_delete(uid, int(b["id"]))
                    return self.send(200, {"ok": True, "alerts": acc.px_list(uid)})
                except (KeyError, TypeError, ValueError):
                    return self.send(400, {"ok": False})
            if p == "/api/wallet/set":
                ok = t.wallets.set_address(uid, str(b.get("address", "")))
                return self.send(200 if ok else 400, {"ok": ok, "error": None if ok else "that is not a Solana address"})
            if p == "/api/wallet/hide":
                try:
                    t.wallets.hide(uid, str(b["mint"])[:64], bool(b.get("hide")))
                    return self.send(200, {"ok": True})
                except (KeyError, TypeError):
                    return self.send(400, {"ok": False})
            if p == "/api/testpush":
                ok, msg = t.test_push(uid)
                return self.send(200, {"ok": ok, "msg": msg})
            if p == "/api/prefs":
                try:
                    acc.change_pref(uid, str(b["mint"])[:64], b["action"])
                    return self.send(200, {"ok": True})
                except (KeyError, TypeError):
                    return self.send(400, {"ok": False})
            if p == "/api/axiom":
                try:
                    vals = {k: float(v) for k, v in b["values"].items() if k in AXIOM_FIELDS and v not in ("", None)}
                    ok = bool(vals) and t.axiom_check(str(b["mint"]), vals)
                except (ValueError, KeyError, TypeError, AttributeError):
                    ok = False
                return self.send(200 if ok else 400, {"ok": ok})
            self.send(404, {"error": "not found"})

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
    defaults = dict(              # new accounts start here; the owner's settings = the research replay's filter
        max_age_h=a.max_age / 3600, max_mcap_usd=a.max_mcap_usd, bundle_max=a.bundle_max,
        top10_max=R.FILTER["top10_pct"], sniper_max=R.FILTER["sniper_pct"], dev_max=R.FILTER["dev_pct"],
        prior_max=R.FILTER["max_prior_launches"], copy_check=True, wash_check=True, mayhem=a.mayhem,
        show_dd=a.show_dd, dd_min=a.dd_min, dd_max=a.dd_max, bounce=a.bounce, pullback=a.pullback,
        alert_new=True, alert_entry=True, alert_watch=True, ntfy_topic="",
        bg="#07080c", panel="#0f1117", text="#e9ecf5", accent="#526fff", radar_mode="radar")
    acc = A.Accounts(os.path.join(R.DATA, "users.db"), os.path.join(R.DATA, "secret.key"), MAIL_FILE, defaults,
                     prefs_file=PREFS_FILE, owner_topic=os.environ.get("SWEDEN_NTFY_TOPIC", ""))
    t = Terminal(a, acc)
    t.wallets = WL.Wallets(os.path.join(R.DATA, "wallets.db"), HELIUS_KEY_FILE, t.token_price)
    t.wallets.sol_usd = lambda: t.usd
    for target in (t.loop, t.meta_worker, t.price_worker, t.link_worker, t.wallets.worker):
        threading.Thread(target=target, daemon=True).start()
    log(f"SWEDEN terminal on http://0.0.0.0:{a.port}  ({len(acc.users())} account(s), "
        f"mail: {'Gmail' if acc.mailer.cfg else 'not set up - codes go to this log'}, "
        f"wallets: {'Helius' if t.wallets.h else 'no helius_key'})")
    serve(t, a.port)


if __name__ == "__main__":
    main()
