"""Additive upgrades for the public (user) side of the bot.

This module does NOT edit or remove anything in the original files. It is
imported once from main.py and layers new behaviour on top of handlers.py:

  1. Models without a known brand are no longer hidden (new folders + "Other").
  2. The AI picker only shows folders that really have models.
  3. Short, index-based callback data (Telegram's 64-byte limit).
  4. Chat memory, active section and last prompt survive restarts (SQLite).
  5. Raw provider errors are shown only to admins; users get a friendly text.
  6. A stuck user can no longer be locked in BUSY forever; job timeout and a
     global concurrency limit for image/video jobs.
  7. Images sent as files (document) are analysed in chat; albums handled.
  8. Daily quota follows local time (BOT_TZ, default Asia/Tehran).
  9. Long answers never break inside a ``` code block.
 10. New commands: /help /me /new /chat /image /video /model /export /invite
 11. Optional forced channel join (FORCE_CHANNEL), support button
     (SUPPORT_USERNAME) and referral bonus quota (REF_BONUS).
"""
import asyncio
import datetime as _dt
import io
import json
import logging
import os
import time

import ai
import db
import handlers as h
from tg import TgError, btn, kb

log = logging.getLogger("extras")

# ----------------------------------------------------------------- settings
FORCE_CHANNEL = os.getenv("FORCE_CHANNEL", "").strip()          # e.g. @mychannel
SUPPORT_USERNAME = os.getenv("SUPPORT_USERNAME", "").strip().lstrip("@")


def _int_env(name, default):
    try:
        return int(os.getenv(name, str(default)).strip())
    except ValueError:
        return default


REF_BONUS = max(0, _int_env("REF_BONUS", 0))        # extra daily uses per invite
MAX_HEAVY_JOBS = max(1, _int_env("MAX_HEAVY_JOBS", 4))   # parallel image/video jobs
MAX_CHAT_JOBS = max(1, _int_env("MAX_CHAT_JOBS", 20))
JOB_TIMEOUT = max(60, _int_env("JOB_TIMEOUT", 1200))      # seconds
BOT_TZ = os.getenv("BOT_TZ", "Asia/Tehran").strip() or "Asia/Tehran"

_SEM = {"heavy": None, "chat": None}
BOT_INFO = {"username": None, "ready": False}

# ----------------------------------------------------------------- storage
with db._lock:
    db._conn.executescript("""
    CREATE TABLE IF NOT EXISTS extra_state(
        kind TEXT, key TEXT, value TEXT, PRIMARY KEY(kind, key));
    CREATE TABLE IF NOT EXISTS referrals(
        user_id INTEGER PRIMARY KEY, inviter INTEGER, ts INTEGER);
    """)
    db._conn.commit()


def _st_save(kind, key, value):
    db._ex("INSERT INTO extra_state(kind,key,value) VALUES(?,?,?) "
           "ON CONFLICT(kind,key) DO UPDATE SET value=excluded.value",
           (kind, key, json.dumps(value, ensure_ascii=False)))


def _st_del(kind, key):
    db._ex("DELETE FROM extra_state WHERE kind=? AND key=?", (kind, key))


def _st_load(kind):
    out = {}
    for r in db._q("SELECT key, value FROM extra_state WHERE kind=?", (kind,)):
        try:
            out[r["key"]] = json.loads(r["value"])
        except Exception:
            pass
    return out


class PDict(dict):
    """dict that mirrors every write to SQLite (survives Redeploy)."""

    def __init__(self, kind, enc, dec):
        super().__init__()
        self._kind, self._enc, self._dec = kind, enc, dec
        for k, v in _st_load(kind).items():
            try:
                super().__setitem__(dec(k), v)
            except Exception:
                pass

    def _save(self, k, v):
        try:
            _st_save(self._kind, self._enc(k), v)
        except Exception:
            log.exception("state save failed")

    def __setitem__(self, k, v):
        super().__setitem__(k, v)
        self._save(k, v)

    def __delitem__(self, k):
        super().__delitem__(k)
        _st_del(self._kind, self._enc(k))

    def pop(self, k, *default):
        if k in self:
            _st_del(self._kind, self._enc(k))
        return super().pop(k, *default)

    def setdefault(self, k, default=None):
        if k not in self:
            self[k] = default
        return super().__getitem__(k)

    def update(self, *a, **kw):
        for k, v in dict(*a, **kw).items():
            self[k] = v

    def clear(self):
        db._ex("DELETE FROM extra_state WHERE kind=?", (self._kind,))
        super().clear()


def _enc_tuple(k):
    return f"{k[0]}|{k[1]}"


def _dec_tuple(s):
    a, b = s.split("|", 1)
    return int(a), b


_old_mode, _old_hist, _old_last = dict(h.MODE), dict(h.HISTORY), dict(h.LAST_PROMPT)
h.MODE = PDict("mode", str, int)
h.HISTORY = PDict("history", str, int)
h.LAST_PROMPT = PDict("last_prompt", _enc_tuple, _dec_tuple)
for _src, _dst in ((_old_mode, h.MODE), (_old_hist, h.HISTORY), (_old_last, h.LAST_PROMPT)):
    _dst.update(_src)


def invites_of(uid):
    r = db._q1("SELECT COUNT(*) c FROM referrals WHERE inviter=?", (uid,))
    return r["c"] if r else 0


def add_referral(uid, inviter):
    if not inviter or inviter == uid or not db.get_user(inviter):
        return False
    return db._ex("INSERT OR IGNORE INTO referrals(user_id,inviter,ts) VALUES(?,?,?)",
                  (uid, inviter, int(time.time()))) is not None


def effective_limit(uid, sec):
    base = int(db.get_setting(f"limit_{sec}") or 0)
    if base and REF_BONUS:
        base += invites_of(uid) * REF_BONUS
    return base


# ----------------------------------------------------------- local-time day
def _tz():
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(BOT_TZ)
    except Exception:
        return _dt.timezone(_dt.timedelta(hours=3, minutes=30))


_TZ = _tz()


def today():
    return _dt.datetime.now(_TZ).strftime("%Y-%m-%d")


db.today = today

# ------------------------------------------------------------- AI folders
EXTRA_BRANDS = [
    ("Gemma", "🔷"),
    ("GLM", "🇿"),
    ("MiniMax", "🌊"),
    ("Kimi", "🌙"),
    ("Mistral", "🌪"),
    ("Grok", "✖️"),
    ("Phi", "🔶"),
    ("سایر", "📦"),
]
OTHER_BRAND = "سایر"
_known = {n for n, _ in h.AI_BRANDS}
for _b in EXTRA_BRANDS:
    if _b[0] not in _known:
        h.AI_BRANDS.append(_b)

EXTRA_ALIASES = {
    "Gemma": ("gemma",),
    "GLM": ("glm", "zhipu", "chatglm"),
    "MiniMax": ("minimax", "abab"),
    "Kimi": ("kimi", "moonshot", "k2-", "k2:"),
    "Mistral": ("mistral", "mixtral", "codestral", "ministral", "pixtral"),
    "Grok": ("grok",),
    "Phi": ("phi-", "phi3", "phi4"),
}

_orig_brand_for_model = h.brand_for_model


def brand_for_model(m):
    b = _orig_brand_for_model(m)
    if b:
        return b
    hay = f"{m.get('title', '')} {m.get('model_id', '')}".lower()
    for name, words in EXTRA_ALIASES.items():
        if any(w in hay for w in words):
            return name
    return OTHER_BRAND


h.brand_for_model = brand_for_model


def _brands_with_models(sec):
    models = db.list_models(sec, enabled_only=True)
    used = {brand_for_model(m) for m in models}
    out = []
    for i, (name, icon) in enumerate(h.all_brands()):
        if name in used:
            out.append((i, name, icon))
    names = {n for _, n, _ in out}
    # model brand set by admin to a folder that no longer exists
    for b in sorted(x for x in used if x and x not in names):
        out.append((None, b, "🤖"))
    return out


async def pick_model(bot, uid, sec, mid, page=0):
    if sec not in h.SECTIONS:
        return await h.show_main(bot, uid, mid)
    brands = _brands_with_models(sec)
    rows = []
    if not brands:
        rows.append([btn("🔙 بازگشت به بخش", f"m:{sec}")])
        return await h.show(bot, uid, mid,
                            f"{h.SEC_ICON[sec]} <b>هوش مصنوعی را انتخاب کن</b>\n\n"
                            "⚠️ هنوز هیچ مدلی برای این بخش توسط مدیر اضافه نشده.", kb(*rows))
    per_page = 8
    pages = max(1, (len(brands) + per_page - 1) // per_page)
    page = max(0, min(page, pages - 1))
    shown = brands[page * per_page:(page + 1) * per_page]
    for i in range(0, len(shown), 2):
        pair = shown[i:i + 2]
        buttons = []
        for idx, brand, icon in pair:
            data = f"bi:{sec}:{idx}" if idx is not None else f"brand:{sec}:{brand}"
            if len(data.encode()) > 64:
                continue
            buttons.append(btn(f"{icon} {brand}", data, "primary"))
        rows.append(buttons[::-1] if (i // 2) % 2 else buttons)
    if pages > 1:
        nav = []
        if page > 0:
            nav.append(btn("⬅️ قبلی", f"pickp:{sec}:{page - 1}"))
        nav.append(btn(f"📄 {page + 1}/{pages}", "noop"))
        if page < pages - 1:
            nav.append(btn("بعدی ➡️", f"pickp:{sec}:{page + 1}"))
        rows.append(nav)
    rows.append([btn("🔙 بازگشت به بخش", f"m:{sec}")])
    await h.show(bot, uid, mid,
                 f"{h.SEC_ICON[sec]} <b>هوش مصنوعی را انتخاب کن</b>\n\n"
                 "روی نام هر هوش مصنوعی بزن تا همه نسخه‌های همان سرویس را ببینی 👇",
                 kb(*rows))


h.pick_model = pick_model

_orig_brand_models_page = h.brand_models_page


async def brand_models_page(bot, uid, sec, brand, mid, page=0, idx=None):
    if idx is None:
        idx = next((i for i, (n, _) in enumerate(h.all_brands()) if n == brand), None)
    if idx is None or sec not in h.SECTIONS:
        return await _orig_brand_models_page(bot, uid, sec, brand, mid, page)
    models = [m for m in db.list_models(sec, enabled_only=True) if brand_for_model(m) == brand]
    icon = next((i for n, i in h.all_brands() if n == brand), "🤖")
    rows = []
    cur = h.current_model(uid, sec)
    per_page = 8
    pages = max(1, (len(models) + per_page - 1) // per_page)
    page = max(0, min(page, pages - 1))
    shown = models[page * per_page:(page + 1) * per_page]
    for i in range(0, len(shown), 2):
        pair = []
        for m in shown[i:i + 2]:
            mark = "✅ " if cur and cur["id"] == m["id"] else ""
            pair.append(btn(f"{mark}{icon} {m['title']}", f"sel:{m['id']}",
                            "success" if mark else "primary"))
        rows.append(pair[::-1] if ((i // 2) % 2) else pair)
    if pages > 1:
        nav = []
        if page > 0:
            nav.append(btn("⬅️ قبلی", f"bip:{sec}:{idx}:{page - 1}"))
        nav.append(btn(f"📄 {page + 1}/{pages}", "noop"))
        if page < pages - 1:
            nav.append(btn("بعدی ➡️", f"bip:{sec}:{idx}:{page + 1}"))
        rows.append(nav)
    rows.append([btn("🔙 بازگشت به فهرست هوش‌ها", f"pick:{sec}")])
    text = f"{icon} <b>{h.e(brand)}</b>\n\n"
    text += ("نسخه موردنظرت را انتخاب کن 👇" if models
             else "هنوز نسخه‌ای از این هوش مصنوعی برای این بخش توسط مدیر اضافه نشده.")
    await h.show(bot, uid, mid, text, kb(*rows))


h.brand_models_page = brand_models_page

# ---------------------------------------------------------- menus & texts
_orig_main_kb = h.main_kb


def main_kb(uid):
    k = _orig_main_kb(uid)
    rows = k["inline_keyboard"]
    extra = []
    if REF_BONUS:
        extra.append(btn("🎁 دعوت دوستان", "x:invite", "success"))
    if SUPPORT_USERNAME:
        extra.append(btn("🆘 پشتیبانی", url=f"https://t.me/{SUPPORT_USERNAME}"))
    if extra:
        rows.insert(min(3, len(rows)), extra)
    return k


h.main_kb = main_kb

_orig_section_kb = h.section_kb


def section_kb(sec):
    k = _orig_section_kb(sec)
    if sec == "chat":
        rows = k["inline_keyboard"]
        rows.insert(max(0, len(rows) - 1), [btn("📤 خروجی گرفتن از چت", "x:export")])
    return k


h.section_kb = section_kb

h.HELP = h.HELP + (
    "\n\n<b>⌨️ دستورات بیشتر</b>\n"
    "/chat چت | /image عکس | /video ویدیو\n"
    "/model تغییر هوش مصنوعی | /new چت جدید\n"
    "/export فایل متنی گفتگو | /me حساب من | /help راهنما"
    + ("\n/invite لینک دعوت و سهمیه بیشتر 🎁" if REF_BONUS else "")
    + "\n\n📎 عکس رو می‌تونی به صورت فایل هم بفرستی."
)


async def open_section(bot, uid, sec, mid=None, note=""):
    if sec not in h.SECTIONS:
        return await h.show_main(bot, uid, mid)
    h.clear_state(uid)
    h.MODE[uid] = sec
    m = h.current_model(uid, sec)
    if not m:
        txt = f"<b>{h.SECTIONS[sec]}</b>\n\n⚠️ هنوز هیچ مدلی برای این بخش فعال نشده."
        if h.is_admin(uid):
            txt += "\n🛠 از پنل مدیریت ← مدل‌ها، یه مدل اضافه کن."
        return await h.show(bot, uid, mid, txt, h.section_kb(sec))
    lim = effective_limit(uid, sec)
    lim_txt = ""
    if lim and not h.is_admin(uid):
        lim_txt = f"\n📏 سهمیه امروز: {db.usage_today(uid, sec)}/{lim}"
    txt = (f"{note}<b>{h.SECTIONS[sec]}</b> فعال شد ✅\n\n🤖 مدل: <b>{h.e(m['title'])}</b>{lim_txt}\n\n"
           + h.SEC_HINT[sec])
    await h.show(bot, uid, mid, txt, h.section_kb(sec))


h.open_section = open_section


def invite_link(uid):
    if not BOT_INFO["username"]:
        return None
    return f"https://t.me/{BOT_INFO['username']}?start=ref_{uid}"


async def account(bot, uid, mid):
    u = db.get_user(uid)
    if not u:
        return await h.show_main(bot, uid, mid)
    st = db.user_stats(uid)
    role = "👑 مدیر" if h.is_admin(uid) else "👤 کاربر"
    txt = (f"<b>👤 حساب من</b>\n\n🆔 آیدی: <code>{uid}</code>\n🎖 نقش: {role}\n"
           f"📅 عضویت: {time.strftime('%Y-%m-%d', time.localtime(u['joined']))}\n\n"
           f"<b>📊 کل استفاده‌ها</b>\n💬 چت: {st.get('chat', 0)}\n🎨 عکس: {st.get('image', 0)}\n🎬 ویدیو: {st.get('video', 0)}")
    lims = []
    for s in h.SECTIONS:
        lim = effective_limit(uid, s)
        if lim and not h.is_admin(uid):
            lims.append(f"{h.SEC_ICON[s]} {db.usage_today(uid, s)}/{lim}")
    if lims:
        txt += "\n\n<b>📏 سهمیه امروز</b>\n" + "  ".join(lims)
    if REF_BONUS:
        txt += f"\n\n🎁 دعوت‌های موفق: {invites_of(uid)}"
    rows = [h.HOME]
    if REF_BONUS:
        rows.insert(0, [btn("🎁 دعوت دوستان", "x:invite", "success")])
    await h.show(bot, uid, mid, txt, kb(*rows))


h.account = account


async def show_invite(bot, uid, mid=None):
    link = invite_link(uid)
    n = invites_of(uid)
    txt = ("<b>🎁 دعوت دوستان</b>\n\n"
           f"به ازای هر دوستی که با لینک تو وارد ربات بشه، <b>{REF_BONUS}</b> بار به سهمیه روزانه "
           "هر بخش اضافه میشه (اگه سهمیه فعال باشه).\n\n"
           f"👥 دعوت‌های موفق: {n}\n\n")
    txt += f"🔗 لینک تو:\n<code>{h.e(link)}</code>" if link else "⚠️ لینک فعلا آماده نیست، چند لحظه دیگه دوباره بزن."
    await h.show(bot, uid, mid, txt, kb(h.HOME))


# ------------------------------------------------------------ text split
_orig_split_text = h.split_text


def split_text(t, n=3500):
    chunks = _orig_split_text(t, n)
    out, carry = [], ""
    for c in chunks:
        c = carry + c
        carry = ""
        if c.count("```") % 2:
            c += "\n```"
            carry = "```\n"
        out.append(c)
    return out or [""]


h.split_text = split_text

# ------------------------------------------------------------- AI jobs
FRIENDLY_ERR = "❌ <b>متاسفانه الان جواب نگرفتم.</b>\n🤖 {model}\n\n"


async def _run_core(bot, uid, sec, m, text, photo, ph_id):
    if sec == "chat":
        await h.do_chat(bot, uid, m, text, photo, ph_id)
    elif sec == "image":
        await h.do_image(bot, uid, m, text, ph_id)
    else:
        await h.do_video(bot, uid, m, text, ph_id)


def _sem(kind):
    if _SEM[kind] is None:
        _SEM[kind] = asyncio.Semaphore(MAX_HEAVY_JOBS if kind == "heavy" else MAX_CHAT_JOBS)
    return _SEM[kind]


async def run_job(bot, uid, sec, text, photo):
    if sec not in h.SECTIONS:
        return
    if uid in h.BUSY:
        return await bot.send(uid, "⏳ درخواست قبلیت هنوز در حال انجامه، یکم صبر کن.")
    m = h.current_model(uid, sec)
    if not m:
        return await bot.send(uid, "⚠️ هنوز مدلی برای این بخش فعال نشده.", kb(h.HOME))
    lim = effective_limit(uid, sec)
    if lim and not h.is_admin(uid) and db.usage_today(uid, sec) >= lim:
        txt = f"📏 سهمیه امروزت برای {h.SECTIONS[sec]} تموم شده ({lim} بار). فردا دوباره امتحان کن 🙏"
        rows = [h.HOME]
        if REF_BONUS:
            txt += f"\n\n🎁 با دعوت هر دوست، {REF_BONUS} بار به سهمیه‌ات اضافه میشه."
            rows.insert(0, [btn("🎁 دعوت دوستان", "x:invite", "success")])
        return await bot.send(uid, txt, kb(*rows))
    h.BUSY.add(uid)
    ph_id = None
    admin = h.is_admin(uid)
    try:
        sem = _sem("chat" if sec == "chat" else "heavy")
        if sem.locked():
            ph = await bot.send(uid, "🚦 سرور شلوغه، درخواستت تو صف قرار گرفت... ⏳")
        else:
            ph = await bot.send(uid, h.PLACEHOLDER[sec])
        ph_id = ph["message_id"]
        async with sem:
            await asyncio.wait_for(_run_core(bot, uid, sec, m, text, photo, ph_id), JOB_TIMEOUT)
        db.log_usage(uid, sec, m["title"], True)
    except asyncio.TimeoutError:
        db.log_usage(uid, sec, m["title"], False)
        await h.show(bot, uid, ph_id, f"⌛️ <b>زمان پاسخ تموم شد.</b>\n🤖 {h.e(m['title'])}\n\n"
                     "دوباره امتحان کن یا مدل رو عوض کن.",
                     kb([btn("🔄 تغییر مدل", f"pick:{sec}", "primary")], h.HOME))
    except ai.AIError as ex:
        db.log_usage(uid, sec, m["title"], False)
        err = str(ex)
        log.warning("AI error uid=%s model=%s: %s", uid, m["title"], err[:300])
        if admin:
            txt = f"❌ <b>خطا از سرویس هوش مصنوعی</b>\n🤖 {h.e(m['title'])}\n\n<code>{h.e(err[:600])}</code>"
        else:
            txt = FRIENDLY_ERR.format(model=h.e(m["title"]))
        if "401" in err or "403" in err:
            txt += ("\n\n🔑 احتمالا API Key نامعتبره یا مدل فعال نیست." if admin
                    else "🔧 این مدل فعلا در دسترس نیست، یه مدل دیگه انتخاب کن.")
        elif "429" in err:
            txt += "\n\n🚦 محدودیت تعداد درخواست، یکم بعد امتحان کن یا مدل رو عوض کن."
        elif not admin:
            txt += "🔁 یکم دیگه دوباره امتحان کن یا مدل رو عوض کن."
        await h.show(bot, uid, ph_id, txt, kb([btn("🔄 تغییر مدل", f"pick:{sec}", "primary")], h.HOME))
    except Exception as ex:
        log.exception("job failed")
        db.log_usage(uid, sec, m["title"], False)
        txt = (f"❌ خطای غیرمنتظره: <code>{h.e(str(ex)[:300])}</code>" if admin
               else "❌ یه مشکل پیش اومد، لطفا دوباره امتحان کن 🙏")
        try:
            await h.show(bot, uid, ph_id, txt, kb(h.HOME))
        except Exception:
            pass
    finally:
        h.BUSY.discard(uid)


h.run_job = run_job

_orig_do_chat = h.do_chat


async def do_chat(bot, uid, m, text, photo, ph_id):
    try:
        await _orig_do_chat(bot, uid, m, text, photo, ph_id)
    finally:
        hist = dict.get(h.HISTORY, uid)
        if hist is not None:
            h.HISTORY[uid] = hist[-40:]   # persist


h.do_chat = do_chat

_orig_do_image = h.do_image


async def do_image(bot, uid, m, prompt, ph_id):
    h.LAST_PROMPT[(uid, "image")] = prompt
    await _orig_do_image(bot, uid, m, prompt, ph_id)


h.do_image = do_image


async def export_chat(bot, uid):
    hist = h.HISTORY.get(uid) or []
    if not hist:
        return await bot.send(uid, "📭 هنوز گفتگویی برای خروجی گرفتن نداری.", kb(h.HOME))
    lines = []
    for x in hist:
        who = "👤 من" if x.get("role") == "user" else "🤖 ربات"
        c = x.get("content")
        if not isinstance(c, str):
            c = json.dumps(c, ensure_ascii=False)
        lines.append(f"{who}:\n{c}\n")
    data = ("\n".join(lines)).encode("utf-8")
    name = f"chat_{time.strftime('%Y%m%d_%H%M')}.txt"
    try:
        await bot.api("sendDocument", files={"document": (name, io.BytesIO(data).getvalue())},
                      chat_id=uid, caption="📤 خروجی گفتگوی فعلی")
    except TgError as ex:
        log.warning("export failed: %s", ex)
        await bot.send(uid, "⚠️ ارسال فایل ناموفق بود.", kb(h.HOME))


# -------------------------------------------------------- force join
_JOIN_OK = {}   # uid -> ts
_JOIN_WARNED = [False]


async def is_member(bot, uid):
    if not FORCE_CHANNEL or h.is_admin(uid):
        return True
    t = _JOIN_OK.get(uid)
    if t and time.time() - t < 600:
        return True
    try:
        r = await bot.api("getChatMember", chat_id=FORCE_CHANNEL, user_id=uid)
    except Exception as ex:
        if not _JOIN_WARNED[0]:
            _JOIN_WARNED[0] = True
            log.warning("FORCE_CHANNEL check failed (bot must be admin of %s): %s", FORCE_CHANNEL, ex)
        return True
    ok = r.get("status") not in ("left", "kicked") and not (
        r.get("status") == "restricted" and not r.get("is_member", True))
    if ok:
        _JOIN_OK[uid] = time.time()
    return ok


def _channel_url():
    c = FORCE_CHANNEL
    if c.startswith("http"):
        return c
    return f"https://t.me/{c.lstrip('@')}"


async def ask_join(bot, uid, mid=None):
    txt = ("📢 <b>برای استفاده از ربات، اول عضو کانال ما شو.</b>\n\n"
           "بعد از عضویت، دکمه «✅ عضو شدم» رو بزن.")
    markup = kb([btn("📢 عضویت در کانال", url=_channel_url())],
                [btn("✅ عضو شدم", "x:checkjoin", "success")])
    await h.show(bot, uid, mid, txt, markup)


# ------------------------------------------------------------ albums
_ALBUMS = {}   # media_group_id -> ts


def _album_seen(gid):
    now = time.time()
    for k in [k for k, v in _ALBUMS.items() if now - v > 120]:
        _ALBUMS.pop(k, None)
    if gid in _ALBUMS:
        return True
    _ALBUMS[gid] = now
    return False


# --------------------------------------------------------- dispatchers
COMMANDS = [
    {"command": "start", "description": "🏠 منوی اصلی"},
    {"command": "chat", "description": "💬 چت هوش مصنوعی"},
    {"command": "image", "description": "🎨 ساخت عکس"},
    {"command": "video", "description": "🎬 ساخت ویدیو"},
    {"command": "model", "description": "🔄 تغییر هوش مصنوعی"},
    {"command": "new", "description": "🧹 شروع چت جدید"},
    {"command": "export", "description": "📤 خروجی گفتگو"},
    {"command": "me", "description": "👤 حساب من"},
    {"command": "help", "description": "ℹ️ راهنما"},
    {"command": "cancel", "description": "❌ لغو"},
]


async def init(bot):
    if BOT_INFO["ready"]:
        return
    BOT_INFO["ready"] = True
    try:
        me = await bot.api("getMe")
        BOT_INFO["username"] = me.get("username")
    except Exception:
        BOT_INFO["ready"] = False
        return
    cmds = list(COMMANDS)
    if REF_BONUS:
        cmds.insert(-1, {"command": "invite", "description": "🎁 دعوت دوستان"})
    try:
        await bot.api("setMyCommands", commands=cmds)
    except Exception:
        pass


_orig_handle_update = h.handle_update
_orig_on_message = h.on_message
_orig_on_callback = h.on_callback


async def handle_update(bot, upd):
    if not BOT_INFO["ready"]:
        await init(bot)
    await _orig_handle_update(bot, upd)


h.handle_update = handle_update


def _cmd(text):
    if not text.startswith("/"):
        return None, ""
    head, _, rest = text.partition(" ")
    return head.split("@", 1)[0].lower(), rest.strip()


SIMPLE_CMDS = {"/help", "/me", "/new", "/chat", "/image", "/video", "/model", "/export", "/invite"}


async def on_message(bot, msg):
    if (msg.get("chat") or {}).get("type") != "private":
        return
    frm = msg.get("from") or {}
    uid = frm.get("id")
    if not uid:
        return
    text = (msg.get("text") or "").strip()
    cmd, arg = _cmd(text)

    # referral: only for brand-new users
    if cmd == "/start" and arg.startswith("ref_") and not db.get_user(uid):
        u = await h.ensure_user(bot, frm)
        try:
            inviter = int(arg[4:])
        except ValueError:
            inviter = None
        if inviter and add_referral(uid, inviter) and REF_BONUS:
            try:
                await bot.send(inviter, f"🎉 یه دوست با لینک تو وارد شد! +{REF_BONUS} سهمیه روزانه 🎁")
            except Exception:
                pass

    u = await h.ensure_user(bot, frm)
    admin_wizard = h.STATE.get(uid) and h.is_admin(uid)

    if cmd != "/cancel" and not h.deny_reason(u) and not await is_member(bot, uid):
        return await ask_join(bot, uid)

    # images sent as file -> treat as photo (chat only)
    doc = msg.get("document") or {}
    if (not admin_wizard and doc and str(doc.get("mime_type", "")).startswith("image/")
            and int(doc.get("file_size") or 0) <= 10 * 1024 * 1024):
        msg = dict(msg)
        msg["photo"] = [{"file_id": doc["file_id"]}]
        msg.pop("document", None)

    # albums: process only the first item
    gid = msg.get("media_group_id")
    if gid and not admin_wizard and h.MODE.get(uid) == "chat":
        if _album_seen(gid):
            if not _album_seen(f"{gid}:note"):
                await bot.send(uid, "📎 از آلبوم فقط عکس اول تحلیل میشه. بقیه رو جدا بفرست.")
            return

    if cmd in SIMPLE_CMDS and not admin_wizard:
        r = h.deny_reason(u)
        if r:
            return await bot.send(uid, r)
        if cmd == "/help":
            return await bot.send(uid, h.HELP, kb(h.HOME))
        if cmd == "/me":
            return await h.account(bot, uid, None)
        if cmd == "/new":
            h.HISTORY.pop(uid, None)
            return await h.open_section(bot, uid, "chat", None, note="🧹 حافظه چت پاک شد.\n\n")
        if cmd in ("/chat", "/image", "/video"):
            return await h.open_section(bot, uid, cmd[1:], None)
        if cmd == "/model":
            return await h.pick_model(bot, uid, h.MODE.get(uid) or "chat", None, 0)
        if cmd == "/export":
            return await export_chat(bot, uid)
        if cmd == "/invite":
            if REF_BONUS:
                return await show_invite(bot, uid)
            return await bot.send(uid, "ℹ️ سیستم دعوت فعلا فعال نیست.", kb(h.HOME))

    return await _orig_on_message(bot, msg)


h.on_message = on_message


async def on_callback(bot, cq):
    data = cq.get("data") or ""
    uid = cq["from"]["id"]
    if data.startswith("ad:"):
        return await _orig_on_callback(bot, cq)
    mid = (cq.get("message") or {}).get("message_id")
    u = await h.ensure_user(bot, cq["from"])
    r = h.deny_reason(u)
    if r:
        return await bot.answer(cq["id"], r, True)

    if data == "x:checkjoin":
        _JOIN_OK.pop(uid, None)
        if await is_member(bot, uid):
            await bot.answer(cq["id"], "✅ عضویتت تایید شد!")
            return await h.show_main(bot, uid, mid, cq["from"].get("first_name", ""))
        return await bot.answer(cq["id"], "❌ هنوز عضو کانال نشدی.", True)

    if not await is_member(bot, uid):
        await bot.answer(cq["id"])
        return await ask_join(bot, uid, mid)

    try:
        if data.startswith("bi:"):
            await bot.answer(cq["id"])
            _, sec, idx = data.split(":", 2)
            brands = h.all_brands()
            i = int(idx)
            if 0 <= i < len(brands):
                return await brand_models_page(bot, uid, sec, brands[i][0], mid, 0, i)
            return await pick_model(bot, uid, sec, mid, 0)
        if data.startswith("bip:"):
            await bot.answer(cq["id"])
            _, sec, idx, page = data.split(":", 3)
            brands = h.all_brands()
            i = int(idx)
            if 0 <= i < len(brands):
                return await brand_models_page(bot, uid, sec, brands[i][0], mid, int(page), i)
            return await pick_model(bot, uid, sec, mid, 0)
        if data == "x:export":
            await bot.answer(cq["id"])
            return await export_chat(bot, uid)
        if data == "x:invite":
            await bot.answer(cq["id"])
            if REF_BONUS:
                return await show_invite(bot, uid, mid)
            return
        if data.startswith("sel:"):
            m = db.get_model(int(data[4:]))
            if not m or not m["enabled"] or not m["p_enabled"]:
                await bot.answer(cq["id"], "⚠️ این مدل دیگه در دسترس نیست.", True)
                return await pick_model(bot, uid, (m or {}).get("section") or h.MODE.get(uid) or "chat", mid, 0)
    except (ValueError, IndexError):
        return await bot.answer(cq["id"])

    return await _orig_on_callback(bot, cq)


h.on_callback = on_callback

log.info("extras loaded | force_channel=%s support=%s ref_bonus=%s tz=%s",
         FORCE_CHANNEL or "-", SUPPORT_USERNAME or "-", REF_BONUS, BOT_TZ)
