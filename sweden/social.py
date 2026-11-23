"""Friends for the Sweden terminal: usernames, profile pictures, friend requests and per-friend sharing settings.

Privacy model (each user decides per friend, defaults in brackets):
  share_trades  [on]   the friend sees my buys / sells, entries and holdings of coins (prices / mcaps, %)
  share_watch   [on]   the friend sees which coins are on my watchlist
  show_capital  [off]  the friend also sees amounts: SOL sizes, value of positions, journal money figures
and what I want to see from a friend:
  on_charts     [on]   their markers / entry lines on charts and their badges on coin cards
  alert_buy     [off]  push / alert when they buy a coin
  nickname      ['']   my name for them
Nothing is shared with users who are not accepted friends.
"""
import base64, json, re, sqlite3, threading, time

USERNAME = re.compile(r"^[a-z0-9_]{3,20}$")
SHARE_DEFAULTS = dict(share_trades=True, share_watch=True, show_capital=False)
VIEW_DEFAULTS = dict(on_charts=True, alert_buy=False, nickname="")
MAX_AVATAR = 60_000           # bytes of the data URL (the page shrinks pictures to 128 px JPEG, ~5-15 kB)


class Social:
    def __init__(self, db_path):
        self.lock = threading.Lock()
        self.db = sqlite3.connect(db_path, check_same_thread=False)
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS profiles (uid INTEGER PRIMARY KEY, username TEXT UNIQUE, bio TEXT DEFAULT '',
                avatar TEXT DEFAULT '', color TEXT DEFAULT '', updated REAL);
            CREATE TABLE IF NOT EXISTS friends (a INT, b INT, status TEXT, created REAL, PRIMARY KEY (a, b));
            CREATE TABLE IF NOT EXISTS fprefs (uid INT, fid INT, data TEXT, PRIMARY KEY (uid, fid));
            CREATE TABLE IF NOT EXISTS sdefaults (uid INTEGER PRIMARY KEY, data TEXT);
        """)
        self.reload()

    # ---------- cache (read on every state / trade) ----------
    def reload(self):
        with self.lock:
            prof = self.db.execute("SELECT uid, username, bio, avatar, color FROM profiles").fetchall()
            fr = self.db.execute("SELECT a, b, status, created FROM friends").fetchall()
            fp = self.db.execute("SELECT uid, fid, data FROM fprefs").fetchall()
            dd = self.db.execute("SELECT uid, data FROM sdefaults").fetchall()
        self.profiles = {u: dict(username=n, bio=b or "", avatar=a or "", color=c or "") for u, n, b, a, c in prof}
        self.by_name = {p["username"]: u for u, p in self.profiles.items() if p["username"]}
        self.requests = [(a, b, ts) for a, b, s, ts in fr if s == "pending"]          # a asked b
        self.pairs = {(a, b) for a, b, s, _ in fr if s == "accepted"} | {(b, a) for a, b, s, _ in fr if s == "accepted"}
        self.fp = {(u, f): json.loads(d) for u, f, d in fp}
        self.defs = {u: json.loads(d) for u, d in dd}

    def friends(self, uid):
        return sorted(f for (u, f) in self.pairs if u == uid)

    def are_friends(self, a, b):
        return (a, b) in self.pairs

    def share(self, owner, viewer):
        """What `owner` shares with `viewer` (None if they are not friends)."""
        if not self.are_friends(owner, viewer):
            return None
        d = dict(SHARE_DEFAULTS, **{k: v for k, v in self.defs.get(owner, {}).items() if k in SHARE_DEFAULTS})
        d.update({k: v for k, v in self.fp.get((owner, viewer), {}).items() if k in SHARE_DEFAULTS})
        return d

    def view(self, uid, fid):
        """How `uid` wants to see friend `fid`."""
        d = dict(VIEW_DEFAULTS, **{k: v for k, v in self.defs.get(uid, {}).items() if k in VIEW_DEFAULTS and k != "nickname"})
        d.update({k: v for k, v in self.fp.get((uid, fid), {}).items() if k in VIEW_DEFAULTS})
        return d

    def defaults(self, uid):
        return dict(SHARE_DEFAULTS, **{k: v for k, v in VIEW_DEFAULTS.items() if k != "nickname"}, **self.defs.get(uid, {}))

    def name(self, uid, users, viewer=None):
        """Nickname (set by the viewer) > display name > username > e-mail name."""
        if viewer is not None:
            nick = self.fp.get((viewer, uid), {}).get("nickname")
            if nick:
                return nick
        u = users.get(uid) or {}
        p = self.profiles.get(uid) or {}
        return (u.get("settings") or {}).get("display_name") or p.get("username") or (u.get("email") or "?").split("@")[0]

    def card(self, uid, users, viewer=None):
        p = self.profiles.get(uid) or {}
        return dict(uid=uid, username=p.get("username") or "", name=self.name(uid, users, viewer), bio=p.get("bio") or "",
                    avatar=p.get("avatar") or "", color=p.get("color") or "")

    # ---------- profile ----------
    def set_profile(self, uid, username=None, bio=None, avatar=None, color=None):
        p = dict(self.profiles.get(uid) or dict(username=None, bio="", avatar="", color=""))
        if username is not None:
            username = str(username).strip().lower().lstrip("@")
            if not USERNAME.match(username):
                return False, "Username: 3-20 characters, a-z, 0-9 and _"
            other = self.by_name.get(username)
            if other is not None and other != uid:
                return False, "This username is taken"
            p["username"] = username
        if bio is not None:
            p["bio"] = str(bio)[:160]
        if color is not None:
            p["color"] = str(color)[:9] if re.match(r"^#[0-9a-fA-F]{6}$", str(color)) else ""
        if avatar is not None:
            a = str(avatar)
            if a and (len(a) > MAX_AVATAR or not re.match(r"^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$", a)):
                return False, "Picture: JPEG / PNG / WebP, small (the page shrinks it)"
            if a:
                try:
                    base64.b64decode(a.split(",", 1)[1], validate=True)
                except ValueError:
                    return False, "Picture could not be read"
            p["avatar"] = a
        with self.lock:
            self.db.execute("INSERT OR REPLACE INTO profiles VALUES (?, ?, ?, ?, ?, ?)",
                            (uid, p["username"], p["bio"], p["avatar"], p["color"], time.time()))
            self.db.commit()
        self.reload()
        return True, None

    # ---------- requests ----------
    def request(self, uid, username):
        if not (self.profiles.get(uid) or {}).get("username"):
            return False, "Choose your own username first (Settings > Profile)"
        fid = self.by_name.get(str(username).strip().lower().lstrip("@"))
        if fid is None:
            return False, "No user with this username"
        if fid == uid:
            return False, "That is you"
        if self.are_friends(uid, fid):
            return False, "Already friends"
        with self.lock:
            back = self.db.execute("SELECT status FROM friends WHERE a = ? AND b = ?", (fid, uid)).fetchone()
            if back:                                         # they already asked me: accept
                self.db.execute("UPDATE friends SET status = 'accepted' WHERE a = ? AND b = ?", (fid, uid))
            else:
                self.db.execute("INSERT OR IGNORE INTO friends VALUES (?, ?, 'pending', ?)", (uid, fid, time.time()))
            self.db.commit()
        self.reload()
        return True, "accepted" if back else "sent"

    def answer(self, uid, fid, accept):
        with self.lock:
            if accept:
                n = self.db.execute("UPDATE friends SET status = 'accepted' WHERE a = ? AND b = ? AND status = 'pending'",
                                    (fid, uid)).rowcount
            else:
                n = self.db.execute("DELETE FROM friends WHERE a = ? AND b = ? AND status = 'pending'", (fid, uid)).rowcount
            self.db.commit()
        self.reload()
        return n > 0

    def remove(self, uid, fid):
        """Unfriend, or withdraw my request."""
        with self.lock:
            self.db.execute("DELETE FROM friends WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)", (uid, fid, fid, uid))
            self.db.execute("DELETE FROM fprefs WHERE (uid = ? AND fid = ?) OR (uid = ? AND fid = ?)", (uid, fid, fid, uid))
            self.db.commit()
        self.reload()

    # ---------- settings ----------
    def set_fprefs(self, uid, fid, data):
        if not self.are_friends(uid, fid):
            return False
        cur = dict(self.fp.get((uid, fid), {}))
        for k in list(SHARE_DEFAULTS) + list(VIEW_DEFAULTS):
            if k in data:
                cur[k] = str(data[k])[:30] if k == "nickname" else bool(data[k])
        with self.lock:
            self.db.execute("INSERT OR REPLACE INTO fprefs VALUES (?, ?, ?)", (uid, fid, json.dumps(cur)))
            self.db.commit()
        self.reload()
        return True

    def set_defaults(self, uid, data):
        cur = {k: bool(data[k]) for k in list(SHARE_DEFAULTS) + ["on_charts", "alert_buy"] if k in data}
        with self.lock:
            self.db.execute("INSERT OR REPLACE INTO sdefaults VALUES (?, ?)", (uid, json.dumps(cur)))
            self.db.commit()
        self.reload()
