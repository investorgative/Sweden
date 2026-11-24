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
import argparse, collections, glob, hashlib, hmac, itertools, json, os, queue, re, secrets, sys, threading, time, urllib.parse
import urllib.request, zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(__file__))
import accounts as A
import journal as JN
import memberfeed as MF
import trade as TR
import social as SO
import replay as R
import signals as SG
import wallet as WL
from grad_replay import SKIP, WSOL, sol_usd
from pump_events import decode, pump_data_lines

HERE = os.path.dirname(os.path.abspath(__file__))
HISTORY_S = 72 * 3600                    # creator history (24 h) and copied names (72 h) need this much data
AXIOM_FILE = os.path.join(R.DATA, "axiom_checks.jsonl")
PREFS_FILE = os.path.join(R.DATA, "terminal_prefs.json")
PASSKEY_FILE = os.path.join(HERE, "..", "terminal_passkey")
JOURNAL_DIST = os.path.join(HERE, "..", "journal", "dist")
HELIUS_KEY_FILE = os.environ.get("SWEDEN_HELIUS_KEY_FILE") or os.path.join(HERE, "..", "helius_key")
MAIL_FILE = os.environ.get("SWEDEN_MAIL_FILE") or os.path.join(HERE, "..", "gmail.json")   # tests: SWEDEN_MAIL_FILE=none
TUNNEL_LOG = os.environ.get("SWEDEN_TUNNEL_LOG") or os.path.join(HERE, "..", "logs", "tunnel.log")   # tests: =none
LAST_LINK = os.path.join(R.DATA, "last_link.txt")
TOKEN_DAYS = 30
REPAIR_DAILY = 3000                      # Helius calls (1 credit each) per day for gap repair + linked wallets (user: minimal)
REPAIR_AUTO = 0                          # automatic repair at graduation: off (Helius use kept minimal); the "fix" button repairs
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
        self.trades = []                            # (slot, seq, ts, mcap SOL, SOL lamports, buy, wallet, tokens, pool?, sig8,
                                                    #  SOL reserve, token reserve after the trade)
        self.pool_base0 = None                      # tokens put into the pool at migration (chain check)
        self.repair = None                          # result of the last gap repair
        self.repairing = False
        self.liq_sol = None                         # real SOL in the curve / pool after the latest trade
        self.res = None                             # (SOL lamports, raw tokens) reserves after the latest trade
        self.fee = 0.0125                           # fee share of the latest trade
        self.danger_at = {}                         # user id -> time of the last danger alert (throttle)
        self.track_at = {}                          # (user id, wallet) -> time of the last tracked-wallet alert


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
        self.smart_list, self.smart_set = [], set()
        self.repair_q = queue.Queue()
        self.linked_cache = {}
        self.repair_calls = collections.deque()          # times of Helius calls by the repair (daily budget)
        self._watched = set()
        self.uwallets = {}                               # wallet address -> user id (members' own wallets)
        self.utr = collections.defaultdict(lambda: collections.defaultdict(list))   # uid -> mint -> [trade]
        self.fr_alert_at = {}

    # ---------- data ----------
    def files(self):
        cut = time.time() - HISTORY_S - 3600
        fs = [f for f in glob.glob(os.path.join(R.DATA, "*", "events-*.jsonl.gz")) if os.path.getmtime(f) >= cut]
        return sorted(fs, key=os.path.getmtime)

    def watched(self):
        """Coins on anyone's watchlist: kept (and rebuilt after a restart) beyond the usual window."""
        return set().union(*(u["watch"] for u in self.acc.users().values()))

    def poll(self):
        recent = time.time() - self.a.max_age - 1800
        self._watched = self.watched()
        wb = [m.encode() for m in self._watched]
        for f in self.files():
            t = self.tails.get(f)
            if t is None:
                t = self.tails[f] = Tail(f)
            only_launches = not self.live and os.path.getmtime(f) < recent   # old file: history only
            for line in t.lines():
                if only_launches and b'"C",' not in line and b'"G",' not in line and b'"P",' not in line \
                        and not any(m in line for m in wb):          # old file: launches + watchlist coins only
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
            prior = sum(1 for x in hist if ts - x[0] < 86400)
            hist.append((ts, mint, r[7], r[8]))
            earlier = R.copy_matches(self.names, ts, r[7], r[8], mint, self.graduated)
            if not r[12] and ((not history_only and ts >= time.time() - self.a.max_age - 1800) or mint in self._watched):
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
                c.trades.append((r[0], self.seq, r[3], mc, r[7], r[6], r[5], r[8], False, r[1], r[9], r[10]))
                if r[0] >= c.last_slot:
                    c.liq_sol = (r[9] - c.c["vsol0"]) / 1e9
                    c.res = (r[9], r[10])
                    c.fee = (r[11] + r[12]) / 1e4
                self.check_px(c, mc)
                if not r[6]:
                    self.check_danger(c, r[5], r[8])
                if r[5] in self.acc.tracked_idx:
                    self.check_tracked(c, r[5], r[6], r[7], mc)
                if r[5] in self.uwallets:
                    self.member_trade(c, r[5], r[6], r[7], r[8], mc, r[3], r[1])
        elif kind == "G":
            if c.S is not None:
                c.feat = c.S.features()
                c.S = None                          # free the per-wallet state
            if c.grad_ts is None:
                self.watch_graduated(c)
                if REPAIR_AUTO and self.live and not c.flag and not c.quote:
                    self.repair_q.put(c.mint)                   # check the trade chain, fetch missing trades
            c.grad_ts = r[3]
        elif kind == "P":
            if r[9] == R.NO_CREATOR:                # a pool opened by hand, not the migration (fake graduation)
                return
            c.pool_ok, c.pool = r[6] == WSOL, r[5]
            c.pool_base0 = r[7]
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
                c.trades.append((r[0], self.seq, r[3], Q / B * 1e6, quote, buy, r[5], base, True, r[1], Q, B))
                if r[0] >= c.last_slot:
                    c.liq_sol = (pq + quote if buy else pq - quote) / 1e9
                    c.res = (Q, B)
                    c.fee = r[12] / 1e4
                self.price_update(c, Q / B, r[3], r[0])
                self.check_px(c, Q / B * 1e6)
                if not buy:
                    self.check_danger(c, r[5], base)
                if r[5] in self.acc.tracked_idx:
                    self.check_tracked(c, r[5], buy, quote, Q / B * 1e6)
                if r[5] in self.uwallets:
                    self.member_trade(c, r[5], buy, quote, base, Q / B * 1e6, r[3], r[1])

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
                if self.live:
                    self.signals.add(uid, c, "new", watch_only, self.usd)
                if s["alert_new"]:
                    self.alert(c, uid, "new", f"{c.sym} is {dd:.0%} below its top - check the meme{tag}")
            if vis and st.stage == "entry" and old != "entry" and st.armed:
                st.entries, st.armed = st.entries + 1, False
                if self.live:
                    self.signals.add(uid, c, "entry", watch_only, self.usd)
                if s["alert_entry"]:
                    self.alert(c, uid, "entry", f"{c.sym}: ENTRY - bounced and pulled back {self.mcap_text(c)}{tag}")

    def check_danger(self, c, wallet, tok):
        """A coin someone holds: the dev or a big holder (>= 3 % of supply) just sold at least half of their tokens."""
        if not self.live or c.repairing:
            return
        left = max(0, c.H.hold.get(wallet, 0))
        before = left + tok
        if before <= 0 or tok < 0.5 * before:
            return
        dev = wallet in c.H.devs
        if not dev and before < 0.03 * R.SUPPLY:
            return
        who = "the dev" if dev else f"a holder of {before / R.SUPPLY:.0%}"
        what = "sold everything" if left < 0.01 * before else f"sold {tok / before:.0%} of their tokens"
        for uid, u in self.acc.users().items():
            if not u["settings"].get("alert_danger", True):
                continue
            b = self.wallets.brief(uid).get(c.mint)
            if not b or b["amount"] <= 0 or time.time() - c.danger_at.get(uid, 0) < 300:
                continue
            c.danger_at[uid] = time.time()
            self.alert(c, uid, "danger", f"{c.sym}: {who} {what} (= {tok / R.SUPPLY:.1%} of supply) - you hold this coin")

    def check_tracked(self, c, wallet, buy, lamports, mcap_sol):
        """A wallet someone follows bought or sold this coin (throttled per user, wallet and coin: 2 min)."""
        if not self.live or c.repairing:
            return
        for uid, label in self.acc.tracked_idx.get(wallet, []):
            u = self.acc.users().get(uid)
            if not u or not u["settings"].get("alert_track", True):
                continue
            k = (uid, wallet)
            if time.time() - c.track_at.get(k, 0) < 120:
                continue
            c.track_at[k] = time.time()
            self.alert(c, uid, "track", f"{label} {'bought' if buy else 'sold'} ${c.sym} for ◎{lamports / 1e9:.2f} at mcap {usd_text(mcap_sol * self.usd)}")

    # ---------- friends ----------
    def refresh_uwallets(self):
        with self.wallets.lock:
            rows = self.wallets.db.execute("SELECT uid, address FROM wallets WHERE address IS NOT NULL").fetchall()
        self.uwallets = {a: u for u, a in rows if a}

    def member_trade(self, c, wallet, buy, lamports, tokens, mcap_sol, ts, sig8=""):
        """A member's wallet traded (program-wide feed or the members' own wallet feed). Kept for friends' views;
        alerts friends who asked for it. The same trade from both feeds is counted once (signature + amount)."""
        uid = self.uwallets.get(wallet)
        if uid is None:
            return
        lst = self.utr[uid][c.mint]
        tokens = tokens / 1e6                                # raw units -> tokens (pump.fun coins: 6 decimals)
        if any(x[5] == sig8[:8] and x[1] == bool(buy) and abs(x[3] - tokens) < 1e-9 for x in lst[-30:] if sig8) or \
           any(abs(x[0] - ts) < 1e-6 and x[1] == bool(buy) and abs(x[3] - tokens) < 1e-9 for x in lst[-5:]):
            self.member_added = getattr(self, "member_added", collections.Counter())
            self.member_added["dup_" + ("feed" if sig8 and len(sig8) > 8 else "main")] += 1
            return
        lst.append((ts, bool(buy), lamports / 1e9, tokens, mcap_sol, sig8[:8]))
        self.member_added = getattr(self, "member_added", collections.Counter())
        self.member_added["feed" if sig8 and len(sig8) > 8 else "main"] += 1
        if not self.live or c.repairing or not buy:
            return
        users = self.acc.users()
        for fid in self.social.friends(uid):
            sh = self.social.share(uid, fid)
            if not sh or not sh["share_trades"] or fid not in users:
                continue
            v = self.social.view(fid, uid)
            if not v["alert_buy"]:
                continue
            k = (fid, uid, c.mint)
            if time.time() - self.fr_alert_at.get(k, 0) < 120:
                continue
            self.fr_alert_at[k] = time.time()
            size = f" for ◎{lamports / 1e9:.2f}" if sh["show_capital"] else ""
            self.alert(c, fid, "friend", f"{self.social.name(uid, users, fid)} bought ${c.sym}{size} at mcap {usd_text(mcap_sol * self.usd)}")

    def member_record(self, wallet, slot, sig, rec):
        """A pump.fun / PumpSwap trade of a member's wallet from the members' own feed (memberfeed.py)."""
        with self.lock:
            if rec[0] == "T":
                c = self.coins.get(rec[2])
                if c is None or not rec[8]:
                    return
                self.member_trade(c, wallet, rec[4], rec[5], rec[6], rec[7] / rec[8] * 1e6, rec[1], sig)
            else:
                c = next((x for x in self.coins.values() if x.pool == rec[2]), None)
                if c is None:
                    return
                buy, base, quote, pb, pq, vq = rec[4], rec[5], rec[6], rec[7], rec[8], rec[9]
                B = pb - base if buy else pb + base
                Q = (pq + quote if buy else pq - quote) + vq
                if B > 0 and Q > 0:
                    self.member_trade(c, wallet, buy, quote, base, Q / B * 1e6, rec[1], sig)

    def position(self, uid, mint, mcap_usd=None):
        """A member's position in a coin: from the recorded trades (live feed) and, if known, the wallet balance."""
        tr = self.utr.get(uid, {}).get(mint) or []
        b = self.wallets.brief(uid).get(mint) if uid in self.wallets.live else None
        if not tr and not (b and (b["amount"] > 0 or b["trades"])):
            return None
        bought = sum(x[3] for x in tr if x[1]); sold = sum(x[3] for x in tr if not x[1])
        cost = sum(x[2] for x in tr if x[1]); back = sum(x[2] for x in tr if not x[1])
        entry_sol = (sum(x[4] * x[3] for x in tr if x[1]) / bought) if bought > 0 else None
        if entry_sol is None and b and b.get("entry_mcap_sol"):
            entry_sol = b["entry_mcap_sol"]
        if b is not None and "amount" in b:
            holds = b["amount"] > 0 and (bought == 0 or b["amount"] > bought * 0.02 or bought - sold > bought * 0.02)
            amount = b["amount"]
        else:
            holds, amount = bought > 0 and bought - sold > bought * 0.02, max(0.0, bought - sold)
        entry = entry_sol * self.usd if entry_sol else None
        trades = tr[-60:] or [(ts, k == "buy", sol, None, None) for ts, k, sol in (b or {}).get("trades", [])[-60:]]
        return dict(holds=holds, entry_mcap_usd=entry, pnl=(mcap_usd / entry - 1) if entry and mcap_usd else None,
                    cost_sol=cost, back_sol=back, value_usd=amount * mcap_usd / 1e9 if mcap_usd and holds else None,
                    last=max((x[0] for x in trades), default=None),
                    trades=[(x[0], x[1], x[2], x[4] * self.usd if x[4] else None) for x in trades])

    def friend_views(self, uid):
        """[(fid, share, view)] of friends whose coins this user wants to see."""
        out = []
        for fid in self.social.friends(uid):
            sh = self.social.share(fid, uid)
            if sh and (sh["share_trades"] or sh["share_watch"]) and self.social.view(uid, fid)["on_charts"]:
                out.append((fid, sh))
        return out

    def coin_friends(self, uid, mint, mcap_usd, fv, users, with_trades=False):
        """What the friends do in this coin, as far as each shares it: holds / bought / watching, entry, amounts."""
        out = []
        for fid, sh in fv:
            row = dict(uid=fid)
            if sh["share_trades"]:
                p = self.position(fid, mint, mcap_usd)
                if p:
                    row.update(holds=p["holds"], entry_mcap_usd=p["entry_mcap_usd"], pnl=p["pnl"], last=p["last"],
                               traded=True)
                    if sh["show_capital"]:
                        row.update(cost_sol=p["cost_sol"], back_sol=p["back_sol"], value_usd=p["value_usd"])
                    if with_trades:
                        row["trades"] = [(ts, b, sol if sh["show_capital"] else None, mc) for ts, b, sol, mc in p["trades"]]
            if sh["share_watch"] and mint in (users.get(fid) or {}).get("watch", ()):
                row["watching"] = True
            if len(row) > 1:
                out.append(row)
        return out

    def friends_page(self, uid):
        """Everything for the Friends page: me, friends (what they share with me), requests, feed, journal stats."""
        users, so = self.acc.users(), self.social
        circle = self.journal.circle()
        friends, feed = [], []
        with self.lock:
            coins = {m: (c.sym, c.name, self.mcap_usd(c) if c.price else None) for m, c in self.coins.items()}
        for fid in so.friends(uid):
            if fid not in users:
                continue
            sh, mine, view = so.share(fid, uid), so.share(uid, fid), so.view(uid, fid)
            row = dict(so.card(fid, users, uid), share=sh, mine=mine, view=view, holds=[], watch=[],
                       journal=(circle.get(fid) or (None,))[0])
            if sh["share_trades"]:
                for mint in set(self.utr.get(fid, {})) | set(self.wallets.brief(fid) if fid in self.wallets.live else {}):
                    sym, name, mc = coins.get(mint, (None, None, None))
                    p = self.position(fid, mint, mc)
                    if not p:
                        continue
                    if p["holds"] and sym:
                        h = dict(mint=mint, sym=sym, name=name, pnl=p["pnl"], entry_mcap_usd=p["entry_mcap_usd"], mcap_usd=mc)
                        if sh["show_capital"]:
                            h["value_usd"] = p["value_usd"]
                        row["holds"].append(h)
                    for ts, buy, sol, mcx in p["trades"]:
                        if ts and ts > time.time() - 86400 and sym:
                            feed.append(dict(uid=fid, ts=ts, buy=buy, mint=mint, sym=sym, mcap_usd=mcx,
                                             sol=sol if sh["show_capital"] else None))
            row["n_holds"] = len(row["holds"])
            row["holds"] = sorted(row["holds"], key=lambda h: -(h.get("mcap_usd") or 0))[:24]   # the biggest coins first
            if sh["share_watch"]:
                row["watch"] = [dict(mint=m, sym=coins[m][0]) for m in users[fid]["watch"] if m in coins][:30]
            friends.append(row)
        req_in = [dict(so.card(a, users), ts=ts) for a, b, ts in so.requests if b == uid and a in users]
        req_out = [dict(so.card(b, users), ts=ts) for a, b, ts in so.requests if a == uid and b in users]
        feed.sort(key=lambda x: -x["ts"])
        return dict(me=so.card(uid, users), friends=friends, req_in=req_in, req_out=req_out, feed=feed[:80],
                    defaults=so.defaults(uid), has_wallet=bool(self.wallets.address(uid)),
                    feed_status=dict(getattr(self, "mfeed", None).status if getattr(self, "mfeed", None) else {}, added=dict(getattr(self, "member_added", {})),
                              mb_today=round(self.mfeed.bytes_day[1] / 1e6, 2) if getattr(self, "mfeed", None) else 0))

    def watch_graduated(self, c):
        if not self.live:
            return
        for uid, u in self.acc.users().items():
            if c.mint in u["watch"] and u["settings"].get("alert_grad", True):
                self.alert(c, uid, "grad", f"{c.sym} graduated to PumpSwap (watchlist)")

    def check_px(self, c, mcap_sol):
        """Fire the price / mcap alerts set on this coin (one-shot)."""
        alerts = self.acc.px.get(c.mint)
        if not alerts or not self.live or not self.usd or c.repairing:
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
        if (u["settings"]["alert_watch"] and c.mint in u["watch"] and c.mint not in u["hide"]
                and u["snooze"].get(c.mint, 0) <= time.time() and c.grad_ts is not None
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
        if u["snooze"].get(c.mint, 0) > time.time():
            return False, f"snoozed for {(u['snooze'][c.mint] - time.time()) / 3600:.1f} h more"
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
        if kind in ("new", "entry") and self.acc.quiet(uid):   # quiet hours: the page still shows it, no push
            topic = ""
        if topic:
            threading.Thread(target=self.push, args=(topic, kind, c, text), daemon=True).start()

    def push(self, topic, kind, c, text):
        """Push to the phone (ntfy). The CA is the last line, so it can be copied from the notification; tapping
        opens the coin on Axiom."""
        try:
            req = urllib.request.Request(f"https://ntfy.sh/{urllib.parse.quote(topic)}",
                                         data=(text + ("\n" + c.mint if c else "")).encode(),
                                         headers={"Title": "Sweden: " + {"entry": "ENTRY", "new": "new coin", "px": "price alert",
                                                                          "danger": "DANGER", "grad": "graduated", "track": "tracked wallet", "friend": "friend bought"}.get(kind, kind),
                                                  "Priority": "urgent" if kind == "danger" else "high" if kind in ("entry", "px") else "default",
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

    # ---------- gap repair: the free feed misses trades; fetch them from the chain (Helius) ----------
    @staticmethod
    def chain_gaps(c):
        """Where trades are missing, from the reserves (on the curve the token reserve moves by exactly each trade's
        amount, in the pool the base reserve too): {"curve": [(from slot, to slot), ...], "pool": [...]}."""
        def gaps(trades, start, first_slot):
            prev, prev_slot, out = start, first_slot, []
            for slot, grp in itertools.groupby(sorted(trades, key=lambda x: (x[0], x[1])), key=lambda x: x[0]):
                g = list(grp)
                while g:
                    k = next((i for i, x in enumerate(g) if (prev - x[7] if x[5] else prev + x[7]) == x[11]), None)
                    if k is None:
                        out.append((prev_slot, slot))
                        k = 0
                    prev, prev_slot = g.pop(k)[11], slot
            return out
        curve = [x for x in c.trades if not x[8] and len(x) > 11]
        pool = [x for x in c.trades if x[8] and len(x) > 11]
        return {"curve": gaps(curve, c.c["vtok0"], c.slot) if curve else [],
                "pool": gaps(pool, c.pool_base0, min(x[0] for x in pool)) if pool and c.pool_base0 else []}

    @classmethod
    def chain_breaks(cls, c):
        g = cls.chain_gaps(c)
        return (len(g["curve"]), len(g["pool"]))

    def rebuild_feat(self, c):
        """The on-chain checks again from all curve trades (after recovered ones were added)."""
        S = R.State(c.c)
        for x in sorted((x for x in c.trades if not x[8] and len(x) > 11), key=lambda x: (x[0], x[1])):
            S.apply(x[0], (x[0], x[9], "T", x[2], c.mint, x[6], x[5], x[4], x[7], x[10], x[11], 0, 0, None))
        c.feat = S.features()

    def repair_worker(self):
        while True:
            mint = self.repair_q.get()
            try:
                self.repair(mint, budget=REPAIR_AUTO)
            except Exception as e:
                log(f"repair {mint[:6]}: {e!r}")

    def repair(self, mint, budget=250):
        h = self.wallets.h
        if not h:
            return dict(ok=False, error="no Helius key")
        now = time.time()
        while self.repair_calls and self.repair_calls[0] < now - 86400:
            self.repair_calls.popleft()
        if len(self.repair_calls) > REPAIR_DAILY:
            return dict(ok=False, error="daily Helius budget for repairs used up")
        with self.lock:
            c = self.coins.get(mint)
            if c is None:
                return dict(ok=False, error="coin not tracked")
            have, pool = {x[9] for x in c.trades if len(x) > 9}, c.pool
            gaps = self.chain_gaps(c)
        before_breaks = (len(gaps["curve"]), len(gaps["pool"]))
        if before_breaks == (0, 0):
            c.repair = dict(ts=now, fetched=0, recovered=0, before=before_breaks, after=before_breaks)
            return dict(ok=True, **c.repair)

        def candidates(address, ranges):
            """Signatures of `address` inside the gap ranges that we do not have (newest pages first)."""
            if not ranges or not address:
                return []
            lo = min(r[0] for r in ranges)
            out, before = [], None
            for _ in range(20):
                page = h.rpc("getSignaturesForAddress", [address, {"limit": 1000, **({"before": before} if before else {})}])
                self.repair_calls.append(time.time())
                for x in page:
                    if x["err"] is None and x["signature"][:8] not in have and any(a <= x["slot"] <= b for a, b in ranges):
                        out.append(x)
                if len(page) < 1000 or page[-1]["slot"] < lo:
                    break
                before = page[-1]["signature"]
            return out
        # pool gaps through the pool's own address (nearly every transaction there is a trade), curve gaps through the mint
        missing = candidates(pool, gaps["pool"]) + candidates(mint, gaps["curve"])
        missing = list({x["signature"]: x for x in missing}.values())
        missing.sort(key=lambda x: x["slot"])
        fetched = recovered = 0
        c.repairing = True
        try:
            for x in missing[:budget]:
                tx = h.rpc("getTransaction", [x["signature"], {"encoding": "json", "maxSupportedTransactionVersion": 1,
                                                                 "commitment": "confirmed"}])
                self.repair_calls.append(time.time())
                fetched += 1
                logs = ((tx or {}).get("meta") or {}).get("logMessages") or []
                for payload in pump_data_lines(logs):
                    rec = decode(payload)
                    if not rec or rec[0] not in ("T", "S"):
                        continue
                    if rec[0] == "S":
                        if rec[2] != pool:
                            continue
                        rec = rec[:2] + [mint] + rec[3:]
                    elif rec[2] != mint:
                        continue
                    with self.lock:
                        self.event([x["slot"], x["signature"][:8]] + rec, False)
                    recovered += 1
        finally:
            c.repairing = False
        with self.lock:
            if c.S is None and recovered:
                self.rebuild_feat(c)
            after = self.chain_breaks(c)
        c.repair = dict(ts=time.time(), fetched=fetched, recovered=recovered, before=before_breaks, after=after,
                        left=max(0, len(missing) - budget))
        log(f"repair {c.sym}: gaps {before_breaks} -> {after}, {recovered} trades recovered from {fetched} transactions")
        return dict(ok=True, **c.repair)

    # ---------- linked wallets (a lean bubble map): who funded the top holders? ----------
    def funder(self, h, wallet):
        """(funding wallet, first activity ts, fresh?) of a wallet: the sender of its first SOL. Wallets with a long
        history (> 2,000 transactions) are not traced (too many credits) and come back as (None, None, False)."""
        before, oldest, n = None, None, 0
        for _ in range(2):
            page = h.rpc("getSignaturesForAddress", [wallet, {"limit": 1000, **({"before": before} if before else {})}])
            self.repair_calls.append(time.time())
            if not page:
                break
            n += len(page)
            oldest = page[-1]
            if len(page) < 1000:
                break
            before = page[-1]["signature"]
        else:
            return None, None, False                            # long history: an old, busy wallet
        if not oldest:
            return None, None, False
        tx = h.rpc("getTransaction", [oldest["signature"], {"encoding": "json", "maxSupportedTransactionVersion": 1, "commitment": "confirmed"}])
        self.repair_calls.append(time.time())
        if not tx:
            return None, oldest.get("blockTime"), n < 50
        msg, meta = tx["transaction"]["message"], tx.get("meta") or {}
        la = meta.get("loadedAddresses") or {}
        keys = msg["accountKeys"] + la.get("writable", []) + la.get("readonly", [])
        pre, post = meta.get("preBalances") or [], meta.get("postBalances") or []
        drops = [(post[i] - pre[i], k) for i, k in enumerate(keys) if i < len(pre) and k != wallet]
        src = min(drops)[1] if drops and min(drops)[0] < 0 else (keys[0] if keys and keys[0] != wallet else None)
        first = tx.get("blockTime") or oldest.get("blockTime")
        return src, first, n < 50 or (first and time.time() - first < 86400)

    def linked(self, mint, force=False):
        """Top 20 holders grouped by who funded them; share of fresh wallets. Cached 10 min per coin (~60 credits)."""
        hit = self.linked_cache.get(mint)
        if hit and not force and time.time() - hit[0] < 600:
            return hit[1]
        h = self.wallets.h
        if not h:
            return dict(ok=False, error="no Helius key")
        while self.repair_calls and self.repair_calls[0] < time.time() - 86400:
            self.repair_calls.popleft()
        if len(self.repair_calls) > REPAIR_DAILY:
            return dict(ok=False, error="daily Helius budget used up")
        with self.lock:
            c = self.coins.get(mint)
            if c is None:
                return dict(ok=False, error="coin not tracked")
            held = sorted(((w, t) for w, t in c.H.hold.items() if t > 0), key=lambda x: -x[1])[:20]
            devs = set(c.H.devs)
        rows = []
        for w, t in held:
            try:
                src, first, fresh = self.funder(h, w)
            except Exception:
                src, first, fresh = None, None, False
            rows.append(dict(wallet=w, share=t / R.SUPPLY, funder=src, first=first, fresh=bool(fresh), dev=w in devs))
            time.sleep(0.12)
        groups = {}
        for r in rows:
            if r["funder"]:
                groups.setdefault(r["funder"], []).append(r)
        # a holder that funded other holders belongs to their group too
        for r in rows:
            if r["wallet"] in groups and r not in groups[r["wallet"]]:
                groups[r["wallet"]].append(r)
        clusters = []
        for f, g in groups.items():
            if len(g) < 2:
                continue
            # a funder with a huge history is an exchange / service hot wallet: its users are not "linked"
            try:
                busy = len(h.rpc("getSignaturesForAddress", [f, {"limit": 1000}])) >= 1000
                self.repair_calls.append(time.time())
            except Exception:
                busy = False
            clusters.append(dict(funder=f, wallets=[x["wallet"] for x in g], share=sum(x["share"] for x in g),
                                 dev=any(x["dev"] for x in g) or f in devs, busy=busy))
        clusters.sort(key=lambda x: (x["busy"], -x["share"]))
        out = dict(ok=True, ts=time.time(), holders=rows, clusters=clusters,
                   linked_share=sum(x["share"] for x in clusters if not x["busy"]),
                   fresh_share=sum(r["share"] for r in rows if r["fresh"]), traced=sum(1 for r in rows if r["funder"]))
        self.linked_cache[mint] = (time.time(), out)
        return out

    def journal_worker(self):
        """Every 5 min: keep the market-cap path of each user's closed round trips while the coin is still in memory
        (local data only, no Helius calls)."""
        first = True
        while True:
            time.sleep(60 if first else 300)
            if not self.live:
                continue
            first = False
            for uid in list(self.acc.users()):
                try:
                    if self.wallets.address(uid):
                        rts, _ = self.journal.round_trips(self.wallets, uid, self.usd)
                        self.journal.update_paths(rts[-200:], self.coins, self.lock)
                        self.journal.update_meta(rts, self.wallets)
                except Exception as e:
                    log("journal:", repr(e))

    def journal_circle(self, uid):
        """Friends who share their journal score (opt-in): name, score, level, win rate, streak - never amounts."""
        users, out = self.acc.users(), []
        for u2, (d, ts) in self.journal.circle().items():
            if u2 not in users or (u2 != uid and not self.social.are_friends(uid, u2)):
                continue                                         # friends only
            s = users[u2].get("settings", {})
            name = self.social.name(u2, users, uid)
            prof = self.social.profiles.get(u2) or {}
            out.append(dict(d, name=name[:40], me=u2 == uid, ts=ts, avatar=prof.get("avatar") or "", username=prof.get("username") or ""))
        return out

    def held_mints(self):
        """Coins in any user's wallet: kept in memory like watchlist coins (for the portfolio and the journal)."""
        out = set()
        for lv in list(self.wallets.live.values()):
            out |= set((lv or {}).get("tokens") or {})
        return out

    def smart_worker(self):
        """Every 5 min: the wallets with the most realized profit over the last 24 h across the coins in memory
        (sold in >= 3 coins). Information only - copying such wallets did not work in our tests (speed)."""
        while True:
            time.sleep(30 if not self.smart_list else 300)
            if not self.live:
                continue
            cut = time.time() - 86400
            with self.lock:
                snap = [(list(c.trades), set(c.H.devs), c.mint, c.sym, bool(c.flag)) for c in self.coins.values() if c.trades]
            per, devof = {}, {}
            for trades, devs, mint, sym, mayhem in snap:
                w_coin = {}
                for x in trades:
                    if x[2] < cut:
                        continue
                    a = w_coin.setdefault(x[6], [0.0, 0.0, 0, 0])     # bought SOL, sold SOL, bought tok, sold tok
                    if x[5]:
                        a[0] += x[4] / 1e9; a[2] += x[7]
                    else:
                        a[1] += x[4] / 1e9; a[3] += x[7]
                for w, (b, sd, bt, st_) in w_coin.items():
                    if w in devs:
                        devof.setdefault(w, set()).add(sym)
                    if sd <= 0 or bt <= 0:
                        continue
                    realized = sd - b * min(1.0, st_ / bt)
                    p = per.setdefault(w, dict(wallet=w, pnl=0.0, coins=0, wins=0, volume=0.0, best=None, best_pnl=-1e18, mayhem=0))
                    p["pnl"] += realized; p["coins"] += 1; p["wins"] += realized > 0; p["volume"] += b + sd; p["mayhem"] += mayhem
                    if realized > p["best_pnl"]:
                        p["best"], p["best_pnl"] = sym, realized
            # pump.fun's Mayhem agent (trades nearly only Mayhem coins) is the protocol, not a trader: left out
            top = sorted((p for p in per.values() if p["coins"] >= 3 and p["mayhem"] < 0.8 * p["coins"]), key=lambda p: -p["pnl"])[:50]
            for p in top:
                p["dev_of"] = sorted(devof.get(p["wallet"], []))[:3]
                p["bot"] = p["coins"] >= 100                     # 100+ coins in 24 h: a bot
            self.smart_list, self.smart_set = top, {p["wallet"] for p in top if p["pnl"] > 0}

    def whatif(self, uid, new_settings):
        """Replay settings (saved or not) over the graduates in memory (~6.5 h, plus watchlist coins): when would each
        coin have become recommended / reached the entry signal, and how did it move afterwards (raw mcap, no fees)."""
        s = A.clean_settings(new_settings if isinstance(new_settings, dict) else {}, self.acc.users()[uid]["settings"])
        with self.lock:
            coins = [(c.mint, c.sym, c.ts, c.flag, fails_for(c, s), c.grad_ts, sorted((x for x in c.trades if x[8]), key=lambda x: (x[0], x[1])))
                     for c in self.coins.values() if c.grad_ts and c.pool_ok]
        usd, out = self.usd or 0, []
        for mint, sym, ts0, flag, fails, gts, tr in coins:
            if fails is None or fails or (flag and not s["mayhem"]) or len(tr) < 2:
                continue
            peak, low, hi, mode, stage, new_at, entry_at = 0.0, None, None, "top", "top", None, None
            for i, x in enumerate(tr):
                p = x[3]
                if x[2] - ts0 > s["max_age_h"] * 3600:
                    break
                if p > peak:
                    peak, low, hi, mode = p, None, None, "top"
                dd = 1 - p / peak
                if dd > s["dd_max"]:
                    stage = "dead"
                elif mode in ("top", "drop"):
                    if dd >= s["dd_min"]:
                        low = p if low is None else min(low, p)
                        mode, stage = "drop", "zone"
                        if p >= low * (1 + s["bounce"]):
                            mode, stage, hi = "bounce", "bounce", p
                    else:
                        stage = "dip" if dd >= s["show_dd"] else "top"
                else:
                    if p < low:
                        low, mode, stage = p, "drop", "zone"
                    else:
                        hi = max(hi, p)
                        stage = "entry" if p <= hi * (1 - s["pullback"]) else "bounce"
                ok = stage not in ("top", "dead") and (not usd or p * usd <= s["max_mcap_usd"])
                if ok and new_at is None:
                    new_at = i
                if ok and stage == "entry" and entry_at is None:
                    entry_at = i
                    break
            for kind, at in (("new", new_at), ("entry", entry_at)):
                if at is None:
                    continue
                e, rest = tr[at][3], tr[at + 1:]
                hi_ = max((x[3] for x in rest), default=e)
                lo_ = min((x[3] for x in rest), default=e)
                first = {}
                for x in rest:
                    for lv in SG.LEVELS:
                        k = str(int(lv * 100))
                        if k not in first:
                            if x[3] >= e * (1 + lv):
                                first[k] = ["tp", x[2] - tr[at][2]]
                            elif x[3] <= e * (1 - lv):
                                first[k] = ["sl", x[2] - tr[at][2]]
                out.append(dict(mint=mint, sym=sym, kind=kind, watch_only=0, ts=tr[at][2], mcap_sol=e, sol_usd=usd,
                                max_pct=hi_ / e - 1, min_pct=lo_ / e - 1, last_pct=(rest[-1][3] if rest else e) / e - 1,
                                firsts=first, done=1))
        out.sort(key=lambda r: -r["ts"])
        return dict(signals=out, summary=SG.Signals.summary(out), coins=len(coins), hours=round(self.a.max_age / 3600 + 0.5, 1))

    def daily_text(self, uid):
        """The last 24 h in a few lines: signals and how they did, the wallet's realized profit."""
        rows = self.signals.list(uid, 1)
        summ = self.signals.summary(rows)
        lines = []
        for kind, label in (("new", "Recommended"), ("entry", "Entry signals")):
            s = summ.get(kind)
            if not s:
                continue
            lv = s["levels"]["35"]
            dec = lv["tp"] + lv["sl"]
            lines.append(f"{label}: {s['n']} · median best {s['med_max']:+.0%}, worst {s['med_min']:+.0%}"
                         + (f" · ±35 %: up first {lv['tp']}/{dec}" if dec else ""))
            best = max((r for r in rows if r["kind"] == kind), key=lambda r: r["max_pct"], default=None)
            if best:
                lines.append(f"  best: ${best['sym']} {best['max_pct']:+.0%}")
        if not lines:
            lines.append("No signals in the last 24 h.")
        try:
            w = self.wallets.full(uid)
            if w.get("pnl"):
                s = w["summary"]
                closed = [r for r in w["closed"] if r.get("pnl_sol") is not None and r["last"] and r["last"] >= time.time() - 86400]
                lines.append(f"Wallet: {usd_text(s['total_vis_usd'])} · realized 24 h {w['pnl']['r24h']:+.2f} SOL")
                if closed:
                    b = max(closed, key=lambda r: r["pnl_sol"]); x = min(closed, key=lambda r: r["pnl_sol"])
                    lines.append(f"  best trade {b.get('sym') or b['mint'][:4]} {b['pnl_sol']:+.2f} SOL · worst {x.get('sym') or x['mint'][:4]} {x['pnl_sol']:+.2f} SOL")
        except Exception:
            pass
        return "\n".join(lines)

    def daily_worker(self):
        """At each user's chosen hour (local time), push the daily summary once a day."""
        sent = {}
        while True:
            time.sleep(60)
            for uid, u in list(self.acc.users().items()):
                s = u["settings"]
                if s.get("daily_hour", -1) < 0 or not s.get("ntfy_topic"):
                    continue
                lt = time.gmtime(time.time() + s.get("tz_min", 0) * 60)
                day = time.strftime("%Y-%m-%d", lt)
                if lt.tm_hour != s["daily_hour"] or sent.get(uid) == day:
                    continue
                sent[uid] = day
                try:
                    text = self.daily_text(uid)
                    urllib.request.urlopen(urllib.request.Request(
                        f"https://ntfy.sh/{urllib.parse.quote(s['ntfy_topic'])}", data=text.encode(),
                        headers={"Title": "Sweden: your last 24 h"}), timeout=10).read()
                    log(f"daily summary sent to user {uid}")
                except Exception as e:
                    log("daily summary failed:", repr(e))

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
        last_prune = last_sig = time.time()
        while True:
            time.sleep(2)
            self.poll()
            if time.time() - last_sig > 60:              # follow the recorded signals' outcomes
                last_sig = time.time()
                with self.lock:
                    try:
                        self.signals.update(self.coins)
                    except Exception as e:
                        log("signals:", repr(e))
            if time.time() - last_prune > 600:
                last_prune = time.time()
                with self.lock:
                    cut = time.time() - self.a.max_age - 1800
                    keep = self.watched() | self.held_mints()   # watchlist + held coins stay
                    self.coins = {m: c for m, c in self.coins.items() if c.ts >= cut or m in keep}
                    for k in list(self.creators):
                        self.creators[k] = [x for x in self.creators[k] if x[0] >= time.time() - HISTORY_S]
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
                return dict(base, tab="watch" if c.mint in u["watch"] else "hidden",
                            text="Hidden by you" + (" · on your watchlist" if c.mint in u["watch"] else ""))
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
            if w in self.smart_set:
                out.append("toppnl")
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
            # top traders: per wallet SOL in / out, tokens left (valued at the latest price), profit
            per = {}
            for x in tr:
                p = per.setdefault(x[6], [0.0, 0.0, 0, 0, 0, 0, x[2]])   # bought SOL, sold SOL, bought tok, sold tok, buys, sells, first
                if x[5]:
                    p[0] += x[4] / 1e9; p[2] += x[7]; p[4] += 1
                else:
                    p[1] += x[4] / 1e9; p[3] += x[7]; p[5] += 1
            def exit_sol(t):                                     # what selling t raw tokens now would return
                if not c.res or t <= 0:
                    return 0.0
                Q, B = c.res
                return Q * t / (B + t) / 1e9
            top = []
            for w, (b, sd, bt, st_, nb, ns, first) in per.items():
                left = max(0, c.H.hold.get(w, 0))
                val = exit_sol(left)
                top.append(dict(wallet=w, bought=b, sold=sd, left_sol=val, pnl=sd + val - b, buys=nb, sells=ns, first=first,
                                left_share=left / R.SUPPLY, tags=tags(w)))
            top.sort(key=lambda r: -r["pnl"])
            traders = top[:15] + [r for r in top[-5:] if r not in top[:15]]
            # buy / sell pressure
            def pressure(sec):
                xs = [x for x in tr if x[2] >= now - sec]
                b = sum(x[4] for x in xs if x[5]) / 1e9
                sd = sum(x[4] for x in xs if not x[5]) / 1e9
                return dict(buy=b, sell=sd, net=b - sd, buyers=len({x[6] for x in xs if x[5]}), sellers=len({x[6] for x in xs if not x[5]}))
            press = {k: pressure(v) for k, v in (("1m", 60), ("5m", 300), ("15m", 900))}
            # the dev's other launches in our data (last 72 h)
            devs = []
            for ts_, m2, name2, sym2 in sorted(self.creators.get(c.c["creator"], []), reverse=True):
                if m2 == mint:
                    continue
                c2 = self.coins.get(m2)
                ath = max((x[3] for x in c2.trades), default=None) if c2 and c2.trades else None
                devs.append(dict(mint=m2, name=name2, sym=sym2, age_min=(now - ts_) / 60, graduated=m2 in self.graduated,
                                 ath_usd=ath * usd if ath else None))
            holders = [dict(wallet=w, share=t / R.SUPPLY, tags=tags(w)) for w, t in held[:20]]
        mine = self.mine(self.wallets.brief(uid), mint, info["mcap_usd"], with_trades=True)
        fv = self.friend_views(uid)
        fpos = self.coin_friends(uid, mint, info["mcap_usd"], fv, self.acc.users(), with_trades=True) if fv else []
        lab = self.acc.users()[uid]["tracked"]
        for row in trades + holders + traders:
            if row["wallet"] in lab:
                row["label"] = lab[row["wallet"]]
        info["note"] = self.acc.users()[uid]["notes"].get(mint)
        info["friends"] = [dict(n, name=self.social.name(n["uid"], self.acc.users(), uid))
                           for n in self.acc.shared_notes.get(mint, [])
                           if n["uid"] != uid and self.social.are_friends(uid, n["uid"])]      # shared notes: friends only
        with self.lock:
            c = self.coins.get(mint)
            info["res"] = list(c.res) if c and c.res else None
            info["quality"] = dict(breaks=self.chain_breaks(c), repair=c.repair) if c else None
            info["fee"] = c.fee if c else None
        return dict(info=info, trades=trades, holders=holders, sol_usd=self.usd, traders=traders, pressure=press, dev=devs[:30], mine=mine, fpos=fpos,
                    alerts=[a for a in self.acc.px_list(uid) if a["mint"] == mint])

    def candles(self, mint, tf):
        """OHLC of the market cap (SOL) per `tf` seconds over the coin's whole life (curve and PumpSwap), last 1500."""
        with self.lock:
            c = self.coins.get(mint)
            if c is None:
                return dict(found=False)
            tr = sorted(c.trades, key=lambda x: (x[0], x[1]))
            grad = c.grad_ts
        out, cur, bal, n_hold, holders = [], None, collections.Counter(), 0, []
        for x in tr:
            t = int(x[2] // tf * tf)
            before = bal[x[6]] > 0                               # holder count over time (wallets with tokens)
            bal[x[6]] += x[7] if x[5] else -x[7]
            n_hold += (bal[x[6]] > 0) - before
            if not holders or holders[-1][0] != t:
                holders.append([t, n_hold])
            else:
                holders[-1][1] = n_hold
            if cur is None or t != cur[0]:
                if cur is not None:
                    out.append(cur)
                o = cur[4] if cur is not None else x[3]          # open at the previous close: no gaps between candles
                cur = [t, o, max(o, x[3]), min(o, x[3]), x[3], 0.0]
            cur[2], cur[3], cur[4] = max(cur[2], x[3]), min(cur[3], x[3]), x[3]
            cur[5] += x[4] / 1e9
        if cur is not None:
            out.append(cur)
        return dict(found=True, tf=tf, candles=out[-1500:], holders=holders[-1500:], grad_ts=grad, sol_usd=self.usd)

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

    def mine(self, brief, mint, mcap_usd, with_trades=False):
        """The user's own position in a coin (from the wallet), or None."""
        b = brief.get(mint)
        if not b or (b["amount"] <= 0 and not b["trades"]):
            return None
        entry = b["entry_mcap_sol"] * self.usd if b["entry_mcap_sol"] else None
        out = dict(amount=b["amount"], value_usd=b["amount"] * mcap_usd / 1e9, entry_mcap_usd=entry,
                   pnl=(mcap_usd / entry - 1) if entry and mcap_usd else None)
        if with_trades:
            out["trades"] = b["trades"]
        return out

    def state(self, uid, show_all):
        now = time.time()
        u = self.acc.users()[uid]
        brief = self.wallets.brief(uid)
        s = u["settings"]
        users = self.acc.users()
        fv = self.friend_views(uid)
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
                    live=c.H.metrics(), meta=c.meta or {}, mine=self.mine(brief, c.mint, self.mcap_usd(c)),
                    note=u["notes"].get(c.mint), snoozed=u["snooze"].get(c.mint, 0) > now,
                    smart=sum(1 for w in self.smart_set if c.H.hold.get(w, 0) > 0),
                    friends=self.coin_friends(uid, c.mint, self.mcap_usd(c), fv, users) if fv else []))
            alerts = list(self.alerts[uid])
        self.wallets.touch(uid)
        try:
            stt = json.load(open(os.path.join(R.DATA, "status.json")))
            up = max(1, stt.get("uptime_s") or 1)
            heat = dict(launches_h=stt.get("stored_C", 0) / up * 3600, grads_h=stt.get("stored_G", 0) / up * 3600,
                        hours=up / 3600, live=stt.get("live_connections"))
        except (OSError, ValueError):
            heat = None
        return dict(now=now, live=self.live, sol_usd=self.usd, coins=out, alerts=alerts, all=show_all, counts=counts, heat=heat,
                    wallet=self.wallets.summary(uid),
                    radar=sorted(radar, key=lambda r: r["grad_min"]), email=u["email"], settings=s, tracked=u["tracked"],
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

        def static(self, rel):
            """Files of the built journal app (journal/dist)."""
            base = os.path.realpath(JOURNAL_DIST)
            f = os.path.realpath(os.path.join(base, rel))
            if not f.startswith(base + os.sep) or not os.path.isfile(f):
                return self.send(404, b"not found", "text/plain")
            ext = os.path.splitext(f)[1]
            ctype = {".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
                     ".woff2": "font/woff2", ".woff": "font/woff", ".png": "image/png", ".json": "application/json"}.get(ext, "application/octet-stream")
            body = open(f, "rb").read()
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            # hashed asset names never change; the page itself is always fetched fresh
            self.send_header("Cache-Control", "public, max-age=31536000, immutable" if "/assets/" in f else "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Frame-Options", "DENY")
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

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
            if u.path == "/journal":
                self.send_response(302); self.send_header("Location", "/journal/"); self.end_headers()
                return
            if u.path.startswith("/journal/"):
                return self.static(u.path[len("/journal/"):] or "index.html")
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
            elif u.path == "/api/signals":
                days = min(30, max(1, int(q.get("days", ["7"])[0]) if q.get("days", ["7"])[0].isdigit() else 7))
                rows = t.signals.list(uid, days)
                self.send(200, {"signals": rows[:500], "summary": t.signals.summary(rows), "sol_usd": t.usd})
            elif u.path == "/api/topwallets":
                self.send(200, {"wallets": t.smart_list})
            elif u.path == "/api/journal":
                self.send(200, t.journal.payload(uid, t))
            elif u.path == "/api/trade/status":
                out = t.trader.status(uid, with_balance=q.get("bal") == ["1"])
                out["orders"] = t.trader.orders(uid, int(q.get("n", ["8"])[0]) if q.get("n", ["8"])[0].isdigit() else 8)
                if m and out["wallet"] and q.get("bal") == ["1"]:
                    try:
                        raw, dec = t.trader.balance(uid, m, max_age=15.0)
                        out["token"] = dict(mint=m, raw=raw, amount=raw / 10 ** dec)
                    except Exception as e:
                        out["token_error"] = str(e)[:100]
                self.send(200, out)
            elif u.path == "/api/friends":
                self.send(200, t.friends_page(uid))
            elif u.path == "/api/journal/circle":
                self.send(200, {"circle": t.journal_circle(uid)})
            elif u.path == "/api/wallet":
                t.wallets.touch(uid)
                full = t.wallets.full(uid)
                notes = acc.users()[uid]["notes"]
                for row in full.get("open", []) + full.get("closed", []):
                    if row["mint"] in notes:
                        row["note"] = notes[row["mint"]]
                self.send(200, full)
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
            b = self.body(2_000_000 if p.startswith("/api/journal/") else 100_000 if p.startswith("/api/social/") else 4000)
            if p == "/api/settings":
                st = acc.save_settings(uid, b.get("settings"))
                if {k for k in (b.get("settings") or {}) if k != "cp_layout" and not k.startswith("trade_")}:
                    with t.lock:                         # new dip settings: restart this user's stages quietly
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
            if p == "/api/linked":
                return self.send(200, t.linked(str(b.get("mint", ""))[:64], bool(b.get("force"))))
            if p == "/api/repair":
                return self.send(200, t.repair(str(b.get("mint", ""))[:64], budget=400))
            if p == "/api/whatif":
                return self.send(200, t.whatif(uid, b.get("settings")))
            if p == "/api/daily/preview":
                return self.send(200, {"text": t.daily_text(uid)})
            if p == "/api/track":
                ok = acc.track(uid, str(b.get("wallet", "")), str(b.get("label", "")), bool(b.get("on", True)))
                return self.send(200 if ok else 400, {"ok": ok, "error": None if ok else "not a Solana address (or 100 wallets already)"})
            if p == "/api/snooze":
                try:
                    acc.snooze(uid, str(b["mint"])[:64], float(b.get("hours", 0)))
                    return self.send(200, {"ok": True})
                except (KeyError, TypeError, ValueError):
                    return self.send(400, {"ok": False})
            if p.startswith("/api/trade/"):
                tr, act, st = t.trader, p.rsplit("/", 1)[1], acc.users()[uid]["settings"]
                pw = str(b.get("password", ""))[:200]
                if act in ("create", "import"):
                    pub, err = tr.create(uid, pw) if act == "create" else tr.import_key(uid, str(b.get("secret", ""))[:300], pw)
                    if pub and not t.wallets.address(uid):         # also the portfolio wallet (journal, friends)
                        t.wallets.set_address(uid, pub)
                        t.refresh_uwallets()
                    return self.send(200 if pub else 400, {"ok": bool(pub), "wallet": pub, "error": err})
                if act == "unlock":
                    ok, err = tr.unlock(uid, pw, st.get("trade_lock_h", 8))
                    return self.send(200 if ok else 400, {"ok": ok, "error": err})
                if act == "lock":
                    tr.lock_now(uid)
                    return self.send(200, {"ok": True})
                if act == "export":
                    sec, err = tr.export(uid, pw)
                    return self.send(200 if sec else 400, {"ok": bool(sec), "secret": sec, "error": err})
                if act == "delete":
                    ok, err = tr.delete(uid, pw)
                    return self.send(200 if ok else 400, {"ok": ok, "error": err})
                if act == "reclaimable":                            # empty token accounts and their deposit
                    try:
                        accs = tr.empty_accounts(uid) if tr.pubkey(uid) else []
                        return self.send(200, {"ok": True, "n": len(accs), "sol": sum(l for _, _, l in accs) / 1e9})
                    except Exception as e:
                        return self.send(200, {"ok": False, "error": str(e)[:120]})
                if act == "withdraw":
                    try:
                        out = tr.withdraw(uid, pw, str(b.get("to", ""))[:60], b.get("amount"))
                    except Exception as e:
                        out = dict(ok=False, error=str(e)[:150])
                    return self.send(200 if out.get("ok") else 400, out)
                if act == "reclaim":
                    return self.send(200, tr.reclaim_bg(uid))
                if act == "portfolio":                              # use the trading wallet as the portfolio wallet
                    pub = tr.pubkey(uid)
                    ok = bool(pub) and t.wallets.set_address(uid, pub)
                    t.refresh_uwallets()
                    return self.send(200, {"ok": ok})
                mint = str(b.get("mint", ""))[:64]
                side = b.get("side") if b.get("side") in ("buy", "sell") else None
                try:
                    amount = float(b.get("amount"))
                except (TypeError, ValueError):
                    amount = 0.0
                if not mint or not side or not 0 < amount <= (100 if side == "sell" else 1000):
                    return self.send(400, {"ok": False, "error": "bad order"})
                if act == "prepare":
                    return self.send(200, tr.prepare(uid, mint, side, amount, st))
                if act == "execute":
                    with t.lock:
                        c = t.coins.get(mint)
                        sym = c.sym if c else None
                    sym = sym or (t.wallets.token_info([mint]).get(mint) or (None, None, None))[2] or mint[:4]
                    out = tr.execute(uid, mint, sym, side, amount, st)
                    if out.get("ok"):
                        log(f"TRADE user {uid} {side} {amount:g}{' SOL' if side == 'buy' else ' %'} {sym} {mint} "
                            f"sent in {out['ms']} ms{' (prepared)' if out['prepared'] else ''}")
                    return self.send(200 if out.get("ok") else 400, out)
                return self.send(400, {"ok": False, "error": "bad request"})
            if p.startswith("/api/social/"):
                so, act = t.social, p.rsplit("/", 1)[1]
                fid = b.get("uid")
                fid = int(fid) if isinstance(fid, (int, str)) and str(fid).isdigit() else None
                if act == "profile":
                    ok, err = so.set_profile(uid, **{k: b[k] for k in ("username", "bio", "avatar", "color") if k in b})
                    return self.send(200 if ok else 400, {"ok": ok, "error": err})
                if act == "request":
                    ok, msg = so.request(uid, str(b.get("username", ""))[:40])
                    return self.send(200 if ok else 400, {"ok": ok, "error": None if ok else msg, "result": msg if ok else None})
                if act in ("accept", "decline") and fid is not None:
                    return self.send(200, {"ok": so.answer(uid, fid, act == "accept")})
                if act == "remove" and fid is not None:
                    so.remove(uid, fid)
                    return self.send(200, {"ok": True})
                if act == "prefs" and fid is not None and isinstance(b.get("prefs"), dict):
                    return self.send(200, {"ok": so.set_fprefs(uid, fid, b["prefs"])})
                if act == "defaults" and isinstance(b.get("prefs"), dict):
                    so.set_defaults(uid, b["prefs"])
                    return self.send(200, {"ok": True})
                return self.send(400, {"ok": False, "error": "bad request"})
            if p.startswith("/api/journal/"):
                act = p.rsplit("/", 1)[1]
                tid = str(b.get("tid", ""))[:80]
                data = b.get("data")
                if act in ("note", "manual") and (not tid or (data is not None and not isinstance(data, dict))):
                    return self.send(400, {"error": "bad request"})
                if act == "note":
                    t.journal.set_note(uid, tid, data)
                elif act == "manual":
                    t.journal.set_manual(uid, tid, data)
                elif act == "hide":
                    t.journal.set_hidden(uid, [str(x)[:80] for x in (b.get("tids") or [])][:5000], bool(b.get("on")))
                elif act == "settings" and isinstance(b.get("settings"), dict):
                    t.journal.set_settings(uid, b["settings"])
                elif act == "circle":
                    t.journal.set_circle(uid, data if isinstance(data, dict) else None)
                else:
                    return self.send(400, {"error": "bad request"})
                return self.send(200, {"ok": True})
            if p == "/api/note":
                try:
                    acc.set_note(uid, str(b["mint"])[:64], str(b.get("text", "")), str(b.get("tag", "")), bool(b.get("share")))
                    return self.send(200, {"ok": True})
                except (KeyError, TypeError):
                    return self.send(400, {"ok": False})
            if p == "/api/wallet/set":
                ok = t.wallets.set_address(uid, str(b.get("address", "")))
                t.refresh_uwallets()
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
        alert_new=True, alert_entry=True, alert_watch=True, alert_danger=True, alert_grad=True, alert_track=True, ntfy_topic="", quiet_from=-1, quiet_to=-1, tz_min=0,
        sound="chime", card_view="cards", daily_hour=-1, font_scale=1.0, display_name="",
        bg="#07080c", panel="#0f1117", text="#e9ecf5", accent="#526fff", radar_mode="radar", cp_layout="",
        trade_buy_sol=0.1, trade_presets="0.05,0.1,0.25,0.5", trade_sell_presets="25,50,100", trade_slippage=15.0,
        trade_prio_sol=0.0005, trade_max_sol=1.0, trade_lock_h=8.0, trade_dblclick=True, trade_quickbtn=True)
    acc = A.Accounts(os.path.join(R.DATA, "users.db"), os.path.join(R.DATA, "secret.key"), MAIL_FILE, defaults,
                     prefs_file=PREFS_FILE, owner_topic=os.environ.get("SWEDEN_NTFY_TOPIC", ""))
    t = Terminal(a, acc)
    t.signals = SG.Signals(os.path.join(R.DATA, "signals.db"))
    t.wallets = WL.Wallets(os.path.join(R.DATA, "wallets.db"), HELIUS_KEY_FILE, t.token_price)
    t.wallets.sol_usd = lambda: t.usd
    t.journal = JN.Journal(os.path.join(R.DATA, "journal.db"))
    t.social = SO.Social(os.path.join(R.DATA, "social.db"))
    t.refresh_uwallets()
    kf = os.environ.get("SWEDEN_MEMBERFEED_KEY_FILE") or HELIUS_KEY_FILE
    key = open(kf).read().strip() if os.path.exists(kf) else ""
    t.trader = TR.Trader(os.path.join(R.DATA, "trade.db"), open(HELIUS_KEY_FILE).read().strip() if os.path.exists(HELIUS_KEY_FILE) else "",
                         on_rpc=lambda: t.repair_calls.append(time.time()))
    t.mfeed = MF.MemberFeed(key, lambda: set(t.uwallets), t.member_record, on_rpc=lambda: t.repair_calls.append(time.time()))
    for target in (t.loop, t.meta_worker, t.price_worker, t.link_worker, t.wallets.worker, t.daily_worker, t.smart_worker,
                   t.repair_worker, t.journal_worker):
        threading.Thread(target=target, daemon=True).start()
    t.mfeed.start()
    log(f"SWEDEN terminal on http://0.0.0.0:{a.port}  ({len(acc.users())} account(s), "
        f"mail: {'Gmail' if acc.mailer.cfg else 'not set up - codes go to this log'}, "
        f"wallets: {'Helius' if t.wallets.h else 'no helius_key'})")
    serve(t, a.port)


if __name__ == "__main__":
    main()
