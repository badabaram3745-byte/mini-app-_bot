"""SQLite storage: settings, providers (API keys), models, users, usage."""
import os
import sqlite3
import threading
import time

from config import DB_PATH

os.makedirs(os.path.dirname(os.path.abspath(DB_PATH)), exist_ok=True)
_lock = threading.Lock()
_conn = sqlite3.connect(DB_PATH, check_same_thread=False)
_conn.row_factory = sqlite3.Row

DEFAULTS = {
    "welcome": "به ربات هوش مصنوعی خوش اومدی 🤖✨\nچت، ساخت عکس و ساخت ویدیو همه اینجاست.",
    "system_prompt": "You are a smart, accurate and friendly assistant. Always answer in the same language the user writes in. Be precise and don't make things up.",
    "approval_required": "0",
    "maintenance": "0",
    "limit_chat": "0",
    "limit_image": "0",
    "limit_video": "0",
    "history_len": "12",
    "image_size": "auto",
    "video_params": "--duration 5 --resolution 720p",
}

with _lock:
    _conn.executescript("""
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS providers(
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, kind TEXT, base_url TEXT,
        api_key TEXT, enabled INTEGER DEFAULT 1, created INTEGER);
    CREATE TABLE IF NOT EXISTS models(
        id INTEGER PRIMARY KEY AUTOINCREMENT, section TEXT, provider_id INTEGER,
        model_id TEXT, title TEXT, brand TEXT, enabled INTEGER DEFAULT 1, is_default INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS ai_brands(
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, icon TEXT DEFAULT '🤖');
    CREATE TABLE IF NOT EXISTS users(
        id INTEGER PRIMARY KEY, username TEXT, first_name TEXT, status TEXT,
        joined INTEGER, last_seen INTEGER);
    CREATE TABLE IF NOT EXISTS prefs(user_id INTEGER, section TEXT, model INTEGER,
        PRIMARY KEY(user_id, section));
    CREATE TABLE IF NOT EXISTS usage(
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, section TEXT,
        model TEXT, ok INTEGER, day TEXT, ts INTEGER);
    CREATE INDEX IF NOT EXISTS usage_day ON usage(day, user_id, section);
    """)
    cols = {r[1] for r in _conn.execute("PRAGMA table_info(models)").fetchall()}
    if "brand" not in cols:
        _conn.execute("ALTER TABLE models ADD COLUMN brand TEXT")
    _conn.commit()


def _q(sql, args=()):
    with _lock:
        return [dict(r) for r in _conn.execute(sql, args).fetchall()]


def _q1(sql, args=()):
    r = _q(sql, args)
    return r[0] if r else None


def _ex(sql, args=()):
    with _lock:
        cur = _conn.execute(sql, args)
        _conn.commit()
        return cur.lastrowid


def today():
    return time.strftime("%Y-%m-%d")


# ---------- settings ----------
def get_setting(key):
    r = _q1("SELECT value FROM settings WHERE key=?", (key,))
    return r["value"] if r else DEFAULTS.get(key, "")


def set_setting(key, value):
    _ex("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, str(value)))


# ---------- providers ----------
def list_providers():
    return _q("SELECT p.*, (SELECT COUNT(*) FROM models m WHERE m.provider_id=p.id) AS n_models "
              "FROM providers p ORDER BY p.id")


def get_provider(pid):
    return _q1("SELECT * FROM providers WHERE id=?", (pid,))


def add_provider(name, kind, base_url, api_key):
    return _ex("INSERT INTO providers(name,kind,base_url,api_key,enabled,created) VALUES(?,?,?,?,1,?)",
               (name, kind, base_url.rstrip("/"), api_key, int(time.time())))


def update_provider(pid, **f):
    for k, v in f.items():
        if k in ("name", "kind", "base_url", "api_key", "enabled"):
            _ex(f"UPDATE providers SET {k}=? WHERE id=?", (v, pid))


def delete_provider(pid):
    _ex("DELETE FROM models WHERE provider_id=?", (pid,))
    _ex("DELETE FROM providers WHERE id=?", (pid,))


# ---------- models ----------
_MSEL = ("SELECT m.*, p.name AS p_name, p.kind AS p_kind, p.base_url AS p_url, p.api_key AS p_key, "
         "p.enabled AS p_enabled FROM models m JOIN providers p ON p.id=m.provider_id ")


def list_models(section, enabled_only=False):
    sql = _MSEL + "WHERE m.section=? "
    if enabled_only:
        sql += "AND m.enabled=1 AND p.enabled=1 "
    return _q(sql + "ORDER BY m.is_default DESC, m.id", (section,))


def assigned_model_ids(provider_id):
    """Model IDs already placed in at least one AI folder for this provider."""
    rows = _q("SELECT DISTINCT model_id FROM models WHERE provider_id=?", (provider_id,))
    return {r["model_id"] for r in rows}


def list_brands():
    return _q("SELECT * FROM ai_brands ORDER BY id")


def add_brand(name, icon="🤖"):
    return _ex("INSERT OR IGNORE INTO ai_brands(name,icon) VALUES(?,?)", (name.strip()[:40], icon.strip()[:4] or "🤖"))


def update_model_brand(mid, brand):
    _ex("UPDATE models SET brand=? WHERE id=?", (brand, mid))


def get_model(mid):
    return _q1(_MSEL + "WHERE m.id=?", (mid,))


def model_exists(section, pid, model_id):
    return _q1("SELECT id FROM models WHERE section=? AND provider_id=? AND model_id=?",
               (section, pid, model_id)) is not None


def add_model(section, pid, model_id, title, brand=None):
    has_default = _q1("SELECT id FROM models WHERE section=? AND is_default=1", (section,))
    return _ex("INSERT INTO models(section,provider_id,model_id,title,brand,enabled,is_default) VALUES(?,?,?,?,?,1,?)",
               (section, pid, model_id, title, brand, 0 if has_default else 1))


def update_model(mid, **f):
    for k, v in f.items():
        if k in ("title", "model_id", "brand", "enabled"):
            _ex(f"UPDATE models SET {k}=? WHERE id=?", (v, mid))


def set_default_model(mid):
    m = get_model(mid)
    if m:
        _ex("UPDATE models SET is_default=0 WHERE section=?", (m["section"],))
        _ex("UPDATE models SET is_default=1 WHERE id=?", (mid,))


def delete_model(mid):
    _ex("DELETE FROM models WHERE id=?", (mid,))
    _ex("DELETE FROM prefs WHERE model=?", (mid,))


# ---------- users ----------
def get_user(uid):
    return _q1("SELECT * FROM users WHERE id=?", (uid,))


def add_user(uid, username, first_name, status):
    now = int(time.time())
    _ex("INSERT OR IGNORE INTO users(id,username,first_name,status,joined,last_seen) VALUES(?,?,?,?,?,?)",
        (uid, username, first_name, status, now, now))


def touch_user(uid, username, first_name):
    _ex("UPDATE users SET username=?, first_name=?, last_seen=? WHERE id=?",
        (username, first_name, int(time.time()), uid))


def set_status(uid, status):
    _ex("UPDATE users SET status=? WHERE id=?", (status, uid))


def find_user(q):
    q = q.strip().lstrip("@")
    if q.isdigit():
        return get_user(int(q))
    return _q1("SELECT * FROM users WHERE lower(username)=lower(?)", (q,))


def list_users(status, limit=20):
    return _q("SELECT * FROM users WHERE status=? ORDER BY joined DESC LIMIT ?", (status, limit))


def count_users():
    out = {"total": 0, "active": 0, "pending": 0, "banned": 0}
    for r in _q("SELECT status, COUNT(*) c FROM users GROUP BY status"):
        out[r["status"]] = r["c"]
        out["total"] += r["c"]
    return out


def active_user_ids():
    return [r["id"] for r in _q("SELECT id FROM users WHERE status='active'")]


# ---------- prefs ----------
def get_pref(uid, section):
    r = _q1("SELECT model FROM prefs WHERE user_id=? AND section=?", (uid, section))
    return r["model"] if r else None


def set_pref(uid, section, mid):
    _ex("INSERT INTO prefs(user_id,section,model) VALUES(?,?,?) "
        "ON CONFLICT(user_id,section) DO UPDATE SET model=excluded.model", (uid, section, mid))


# ---------- usage ----------
def log_usage(uid, section, model, ok):
    _ex("INSERT INTO usage(user_id,section,model,ok,day,ts) VALUES(?,?,?,?,?,?)",
        (uid, section, model, 1 if ok else 0, today(), int(time.time())))


def usage_today(uid, section):
    r = _q1("SELECT COUNT(*) c FROM usage WHERE day=? AND user_id=? AND section=? AND ok=1",
            (today(), uid, section))
    return r["c"] if r else 0


def stats():
    t = today()
    by_sec = {r["section"]: r["c"] for r in _q(
        "SELECT section, COUNT(*) c FROM usage WHERE day=? AND ok=1 GROUP BY section", (t,))}
    total = _q1("SELECT COUNT(*) c FROM usage WHERE ok=1")["c"]
    fails = _q1("SELECT COUNT(*) c FROM usage WHERE day=? AND ok=0", (t,))["c"]
    top = _q("SELECT model, COUNT(*) c FROM usage WHERE ok=1 GROUP BY model ORDER BY c DESC LIMIT 5")
    active_today = _q1("SELECT COUNT(DISTINCT user_id) c FROM usage WHERE day=?", (t,))["c"]
    return {"today": by_sec, "total": total, "fails": fails, "top": top, "active_today": active_today}


def user_stats(uid):
    return {r["section"]: r["c"] for r in _q(
        "SELECT section, COUNT(*) c FROM usage WHERE user_id=? AND ok=1 GROUP BY section", (uid,))}
