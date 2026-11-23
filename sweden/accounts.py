"""SWEDEN terminal accounts: sign-up with email verification, password login, per-user settings and watchlists.

Stored on the Pi in data/users.db (SQLite). Passwords as salted scrypt hashes; email codes (6 digits) only as hashes,
valid 15 min, 5 tries. Login tokens are signed with data/secret.key and carry a password version, so a password reset
logs every device out. Mails go out through Gmail with an app password (file gmail.json next to terminal.sh:
{"address": "<you>@gmail.com", "app_password": "<16 characters from Google>", "sender_name": "Sweden terminal"});
without that file the code is written to the terminal log instead (enough for the owner to sign up first).

The first account that is verified becomes the owner: it takes over the old shared watchlist / hidden coins
(data/terminal_prefs.json) and the ntfy topic the terminal was started with.
"""
import hashlib, hmac, json, os, re, secrets, smtplib, sqlite3, ssl, threading, time
from email.message import EmailMessage

TOKEN_DAYS = 60
CODE_TTL = 900
CODE_TRIES = 5
RESEND_S = 60
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[A-Za-z]{2,}$")
COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
TOPIC_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
RADAR_MODES = ("radar", "pulse", "grid", "off")
SOUNDS = ("chime", "beep", "alarm", "off")
CARD_VIEWS = ("cards", "list")
NOTE_TAGS = ("", "meme", "rug", "watch", "skip")

# per-user settings: name -> (type, min, max)  (strings / colours / choices are checked separately)
NUMERIC = dict(max_age_h=(float, 0.5, 24), max_mcap_usd=(float, 1000, 1e9), bundle_max=(float, 0, 1),
               top10_max=(float, 0, 1), sniper_max=(float, 0, 1), dev_max=(float, 0, 1), prior_max=(int, 0, 100),
               show_dd=(float, 0, 0.9), dd_min=(float, 0.01, 0.95), dd_max=(float, 0.05, 0.99),
               bounce=(float, 0.01, 5), pullback=(float, 0.01, 0.9),
               quiet_from=(int, -1, 23), quiet_to=(int, -1, 23), tz_min=(int, -840, 840), daily_hour=(int, -1, 23))
BOOLS = ("copy_check", "wash_check", "mayhem", "alert_new", "alert_entry", "alert_watch", "alert_danger", "alert_grad")
COLORS = ("bg", "panel", "text", "accent")


def log(*a):
    print(time.strftime("%Y-%m-%d %H:%M:%S"), *a, flush=True)


def hash_pw(pw, salt=None):
    salt = salt or os.urandom(16)
    return salt.hex() + "$" + hashlib.scrypt(pw.encode(), salt=salt, n=2 ** 14, r=8, p=1, dklen=32).hex()


def check_pw(pw, stored):
    try:
        salt, h = stored.split("$")
        return hmac.compare_digest(hash_pw(pw, bytes.fromhex(salt)).split("$")[1], h)
    except ValueError:
        return False


def clean_settings(new, base):
    """Validated copy of `new` on top of `base` (current settings or defaults); unknown keys and bad values are
    dropped, so a bad value keeps the old one."""
    out = dict(base)
    for k, v in (new or {}).items():
        try:
            if k in NUMERIC:
                typ, lo, hi = NUMERIC[k]
                v = typ(v)
                if lo <= v <= hi:
                    out[k] = v
            elif k in BOOLS:
                out[k] = bool(v)
            elif k in COLORS and isinstance(v, str) and COLOR_RE.match(v):
                out[k] = v.lower()
            elif k == "radar_mode" and v in RADAR_MODES:
                out[k] = v
            elif k == "sound" and v in SOUNDS:
                out[k] = v
            elif k == "card_view" and v in CARD_VIEWS:
                out[k] = v
            elif k == "ntfy_topic" and isinstance(v, str) and (v == "" or TOPIC_RE.match(v.strip())):
                out[k] = v.strip()
        except (TypeError, ValueError):
            pass
    if out["dd_max"] <= out["dd_min"]:
        out["dd_max"] = base["dd_max"] if base["dd_max"] > out["dd_min"] else min(0.99, out["dd_min"] + 0.05)
    return out


class Mailer:
    def __init__(self, path):
        try:
            self.cfg = json.load(open(path))
            assert self.cfg.get("address") and self.cfg.get("app_password")
        except (OSError, ValueError, AssertionError):
            self.cfg = None

    def send(self, to, subject, text):
        """True if sent; False = not configured (the caller logs the code) or failed."""
        if not self.cfg:
            return False
        msg = EmailMessage()
        msg["From"] = f'{self.cfg.get("sender_name") or "Sweden terminal"} <{self.cfg["address"]}>'
        msg["To"], msg["Subject"] = to, subject
        msg.set_content(text)
        try:
            with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=ssl.create_default_context(), timeout=20) as smtp:
                smtp.login(self.cfg["address"], self.cfg["app_password"].replace(" ", ""))
                smtp.send_message(msg)
            return True
        except Exception as e:
            log("gmail: mail not sent:", repr(e))
            return False


class Accounts:
    def __init__(self, db_path, secret_path, mail_cfg, defaults, prefs_file=None, owner_topic=""):
        self.defaults, self.prefs_file, self.owner_topic = defaults, prefs_file, owner_topic
        self.mailer = Mailer(mail_cfg)
        self.lock = threading.Lock()
        self.db = sqlite3.connect(db_path, check_same_thread=False)
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT UNIQUE, pw TEXT, verified INT DEFAULT 0,
                created REAL, settings TEXT DEFAULT '{}', pwver INT DEFAULT 1);
            CREATE TABLE IF NOT EXISTS codes (email TEXT, purpose TEXT, code TEXT, expires REAL, tries INT, sent REAL,
                PRIMARY KEY (email, purpose));
            CREATE TABLE IF NOT EXISTS prefs (uid INT, mint TEXT, kind TEXT, PRIMARY KEY (uid, mint, kind));
            CREATE TABLE IF NOT EXISTS notes (uid INT, mint TEXT, text TEXT, tag TEXT, ts REAL, PRIMARY KEY (uid, mint));
            CREATE TABLE IF NOT EXISTS pxalerts (id INTEGER PRIMARY KEY, uid INT, mint TEXT, sym TEXT, kind TEXT, op TEXT,
                value REAL, created REAL);
        """)
        if not os.path.exists(secret_path):
            fd = os.open(secret_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            os.write(fd, secrets.token_bytes(32)); os.close(fd)
        self.key = open(secret_path, "rb").read()
        self.ip_hits = {}                        # ip -> recent account requests (login / sign-up / codes)
        self.cache = {}                          # uid -> settings, prefs (refreshed on change)
        self.reload()

    # ---------- cache for the hot path (alerts, state) ----------
    def reload(self):
        with self.lock:
            users = self.db.execute("SELECT id, email, settings FROM users WHERE verified = 1").fetchall()
            prefs = self.db.execute("SELECT uid, mint, kind FROM prefs").fetchall()
        cache = {}
        for uid, email, st in users:
            cache[uid] = dict(email=email, settings=clean_settings(json.loads(st or "{}"), self.defaults),
                              watch=set(), hide=set())
        for uid, mint, kind in prefs:
            if uid in cache and kind in ("watch", "hide"):
                cache[uid][kind].add(mint)
        self.cache = cache
        with self.lock:
            rows = self.db.execute("SELECT id, uid, mint, sym, kind, op, value, created FROM pxalerts").fetchall()
        px = {}
        for r in rows:
            px.setdefault(r[2], []).append(dict(zip(("id", "uid", "mint", "sym", "kind", "op", "value", "created"), r)))
        self.px = px                             # mint -> active price / mcap alerts (one-shot: deleted when fired)
        with self.lock:
            nrows = self.db.execute("SELECT uid, mint, text, tag, ts FROM notes").fetchall()
        for uid, mint, text, tag, ts in nrows:
            if uid in cache:
                cache[uid].setdefault("notes", {})[mint] = {"text": text, "tag": tag, "ts": ts}
        for u in cache.values():
            u.setdefault("notes", {})

    def users(self):
        return self.cache

    # ---------- tokens ----------
    def _sign(self, msg):
        return hmac.new(self.key, msg.encode(), hashlib.sha256).hexdigest()

    def _token(self, uid, pwver):
        msg = f"{uid}.{int(time.time() + TOKEN_DAYS * 86400)}.{pwver}"
        return msg + "." + self._sign(msg)

    def user_from_token(self, tok):
        try:
            uid, exp, pwver, sig = (tok or "").split(".")
            if not hmac.compare_digest(sig, self._sign(f"{uid}.{exp}.{pwver}")) or int(exp) < time.time():
                return None
            with self.lock:
                row = self.db.execute("SELECT pwver FROM users WHERE id = ? AND verified = 1", (int(uid),)).fetchone()
            return int(uid) if row and row[0] == int(pwver) else None
        except (ValueError, TypeError):
            return None

    # ---------- limits ----------
    def _limited(self, ip, n=20, per=3600):
        now = time.time()
        hits = [t for t in self.ip_hits.get(ip, []) if t > now - per]
        hits.append(now)
        self.ip_hits[ip] = hits
        return len(hits) > n

    # ---------- codes ----------
    def _send_code(self, email, purpose):
        now = time.time()
        with self.lock:
            row = self.db.execute("SELECT sent FROM codes WHERE email = ? AND purpose = ?", (email, purpose)).fetchone()
            if row and now - row[0] < RESEND_S:
                return dict(ok=False, error=f"wait {int(RESEND_S - (now - row[0])) + 1} s before asking for a new code")
            code = f"{secrets.randbelow(10 ** 6):06d}"
            self.db.execute("REPLACE INTO codes VALUES (?, ?, ?, ?, 0, ?)",
                            (email, purpose, hashlib.sha256(code.encode()).hexdigest(), now + CODE_TTL, now))
            self.db.commit()
        what = "confirm your email" if purpose == "verify" else "set a new password"
        sent = self.mailer.send(email, f"Sweden terminal code: {code}",
                                f"Your code to {what}: {code}\n\nIt is valid for 15 minutes. If you did not ask for it, "
                                f"ignore this mail.")
        if not sent:
            log(f"ACCOUNT CODE for {email} ({purpose}): {code}   (Gmail not set up or failed - see gmail.json)")
        return dict(ok=True, mailed=sent)

    def _check_code(self, email, purpose, code):
        now = time.time()
        with self.lock:
            row = self.db.execute("SELECT code, expires, tries FROM codes WHERE email = ? AND purpose = ?",
                                  (email, purpose)).fetchone()
            if not row or row[1] < now:
                return "expired"
            if row[2] >= CODE_TRIES:
                return "too many tries - ask for a new code"
            ok = hmac.compare_digest(row[0], hashlib.sha256(str(code).strip().encode()).hexdigest())
            if ok:
                self.db.execute("DELETE FROM codes WHERE email = ? AND purpose = ?", (email, purpose))
            else:
                self.db.execute("UPDATE codes SET tries = tries + 1 WHERE email = ? AND purpose = ?", (email, purpose))
            self.db.commit()
        return None if ok else "wrong code"

    # ---------- account actions: (http status, response) ----------
    def signup(self, ip, email, pw):
        email = (email or "").strip().lower()
        if self._limited(ip):
            return 429, dict(error="too many requests - try again later")
        if not EMAIL_RE.match(email):
            return 400, dict(error="that is not an email address")
        if len(pw or "") < 8:
            return 400, dict(error="the password needs at least 8 characters")
        with self.lock:
            row = self.db.execute("SELECT verified FROM users WHERE email = ?", (email,)).fetchone()
            if row and row[0]:
                return 409, dict(error="this email already has an account - log in")
            if row:
                self.db.execute("UPDATE users SET pw = ? WHERE email = ?", (hash_pw(pw), email))
            else:
                self.db.execute("INSERT INTO users (email, pw, created) VALUES (?, ?, ?)", (email, hash_pw(pw), time.time()))
            self.db.commit()
        r = self._send_code(email, "verify")
        return (200 if r["ok"] else 429), dict(r, step="verify")

    def verify(self, ip, email, code):
        email = (email or "").strip().lower()
        if self._limited(ip, 40):
            return 429, dict(error="too many requests - try again later")
        err = self._check_code(email, "verify", code)
        if err:
            return 400, dict(error=err)
        with self.lock:
            first = self.db.execute("SELECT COUNT(*) FROM users WHERE verified = 1").fetchone()[0] == 0
            self.db.execute("UPDATE users SET verified = 1 WHERE email = ?", (email,))
            uid, pwver = self.db.execute("SELECT id, pwver FROM users WHERE email = ?", (email,)).fetchone()
            if first:
                self._adopt_owner(uid)
            self.db.commit()
        self.reload()
        log(f"account verified: {email}" + (" (owner)" if first else ""))
        return 200, dict(token=self._token(uid, pwver))

    def _adopt_owner(self, uid):
        """First account: take over the old shared watchlist / hidden coins and the start-up ntfy topic."""
        st = dict(self.defaults, ntfy_topic=self.owner_topic or "")
        self.db.execute("UPDATE users SET settings = ? WHERE id = ?", (json.dumps(st), uid))
        try:
            d = json.load(open(self.prefs_file))
            for kind in ("watch", "hide"):
                for m in d.get(kind, []):
                    self.db.execute("INSERT OR IGNORE INTO prefs VALUES (?, ?, ?)", (uid, m, kind))
            os.replace(self.prefs_file, self.prefs_file + ".migrated")
        except (OSError, ValueError, TypeError):
            pass

    def login(self, ip, email, pw):
        email = (email or "").strip().lower()
        if self._limited(ip):
            return 429, dict(error="too many requests - try again later")
        with self.lock:
            row = self.db.execute("SELECT id, pw, verified, pwver FROM users WHERE email = ?", (email,)).fetchone()
        if not row or not check_pw(pw or "", row[1]):
            return 403, dict(error="wrong email or password")
        if not row[2]:
            r = self._send_code(email, "verify")
            return 200, dict(r, step="verify")
        return 200, dict(token=self._token(row[0], row[3]))

    def forgot(self, ip, email):
        email = (email or "").strip().lower()
        if self._limited(ip):
            return 429, dict(error="too many requests - try again later")
        with self.lock:
            row = self.db.execute("SELECT verified FROM users WHERE email = ?", (email,)).fetchone()
        if row and row[0]:
            r = self._send_code(email, "reset")
            if not r["ok"]:
                return 429, r
        return 200, dict(ok=True, step="reset")      # same answer whether or not the account exists

    def reset(self, ip, email, code, pw):
        email = (email or "").strip().lower()
        if self._limited(ip, 40):
            return 429, dict(error="too many requests - try again later")
        if len(pw or "") < 8:
            return 400, dict(error="the password needs at least 8 characters")
        err = self._check_code(email, "reset", code)
        if err:
            return 400, dict(error=err)
        with self.lock:
            self.db.execute("UPDATE users SET pw = ?, pwver = pwver + 1 WHERE email = ?", (hash_pw(pw), email))
            uid, pwver = self.db.execute("SELECT id, pwver FROM users WHERE email = ?", (email,)).fetchone()
            self.db.commit()
        return 200, dict(token=self._token(uid, pwver))

    # ---------- settings and prefs ----------
    def save_settings(self, uid, new):
        st = clean_settings(new if isinstance(new, dict) else {}, self.cache[uid]["settings"])
        with self.lock:
            self.db.execute("UPDATE users SET settings = ? WHERE id = ?", (json.dumps(st), uid))
            self.db.commit()
        self.reload()
        return st

    def change_pref(self, uid, mint, action):
        kind, on = {"watch": ("watch", True), "unwatch": ("watch", False),
                    "hide": ("hide", True), "unhide": ("hide", False)}[action]
        with self.lock:
            if on:
                self.db.execute("INSERT OR IGNORE INTO prefs VALUES (?, ?, ?)", (uid, mint, kind))
                if kind == "hide":
                    self.db.execute("DELETE FROM prefs WHERE uid = ? AND mint = ? AND kind = 'watch'", (uid, mint))
            else:
                self.db.execute("DELETE FROM prefs WHERE uid = ? AND mint = ? AND kind = ?", (uid, mint, kind))
            self.db.commit()
        self.reload()

    # ---------- price / mcap alerts (one-shot) ----------
    def px_list(self, uid):
        return sorted((a for v in self.px.values() for a in v if a["uid"] == uid), key=lambda a: -a["created"])

    def px_add(self, uid, mint, sym, kind, op, value):
        if kind not in ("mcap", "price") or op not in (">=", "<=") or not (value > 0):
            return None
        if len(self.px_list(uid)) >= 50:
            return None
        with self.lock:
            cur = self.db.execute("INSERT INTO pxalerts (uid, mint, sym, kind, op, value, created) VALUES (?, ?, ?, ?, ?, ?, ?)",
                                  (uid, mint, sym[:32], kind, op, float(value), time.time()))
            self.db.commit()
        self.reload()
        return cur.lastrowid

    def px_delete(self, uid, aid):
        with self.lock:
            self.db.execute("DELETE FROM pxalerts WHERE id = ? AND uid = ?", (aid, uid))
            self.db.commit()
        self.reload()

    # ---------- notes / tags per coin ----------
    def set_note(self, uid, mint, text, tag):
        text, tag = (text or "").strip()[:500], tag if tag in NOTE_TAGS else ""
        with self.lock:
            if text or tag:
                self.db.execute("REPLACE INTO notes VALUES (?, ?, ?, ?, ?)", (uid, mint, text, tag, time.time()))
            else:
                self.db.execute("DELETE FROM notes WHERE uid = ? AND mint = ?", (uid, mint))
            self.db.commit()
        self.reload()

    def quiet(self, uid, now=None):
        """True inside the user's quiet hours (no new / entry pushes)."""
        s = self.cache[uid]["settings"]
        a, b = s.get("quiet_from", -1), s.get("quiet_to", -1)
        if a < 0 or b < 0 or a == b:
            return False
        h = time.gmtime((now or time.time()) + s.get("tz_min", 0) * 60).tm_hour
        return a <= h < b if a < b else (h >= a or h < b)
