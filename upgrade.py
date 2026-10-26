"""Extra features layered on top of the existing bot (additive only).

The other files are not edited. This module wraps a few functions at import time
(main.py imports it last) and adds:

  1. 🧪 Test mode: a button on the main menu. Users chat with the current chat model
     under limits the admin sets (daily count, allowed hours in Tehran time).
  2. 📎 Files: users can send text files and the AI reads them. The AI can send
     files back with a <file name="..."> block, and the bot delivers them.
  3. 🧹 Models: test all models, then delete the ones that failed (❌).
  4. 👥 Admin: list of all users, per-user quota editing, chat folders per user
     with view and download.
  5. 🧪 Admin: test settings panel.
"""
import asyncio
import contextvars
import datetime as dt
import json
import logging
import math
import re

import ai
import db
import extras as x
import handlers as h
import pro as p
from tg import TgError, btn, kb

log = logging.getLogger("upgrade")

PAGE = 10
MAX_UPLOAD = 1_000_000
MAX_DOC_CHARS = 30_000
KNOWN_CMDS = {"/start", "/cancel", "/admin", "/panel", "/help", "/me", "/new", "/chat", "/image",
              "/video", "/model", "/export", "/invite", "/sub", "/test"}

for _k, _v in (("test_enabled", "1"), ("test_limit", "20"), ("test_from", "0"), ("test_to", "24")):
    db.DEFAULTS.setdefault(_k, _v)

TEST_HIST = x.PDict("test_history", str, int)
FILE_SINK = contextvars.ContextVar("up_file_sink", default=None)
_HOOK = contextvars.ContextVar("up_hook", default=None)
FILE_RE = re.compile(r'<file\s+name="([^"\n]{1,120})"\s*>\n?(.*?)</file>', re.S)
FILE_HINT = ("If the user asks for a file, or asks you to put content into a file, put the complete file "
             "content inside this exact block: <file name=\"name.ext\">...content...</file>. "
             "You may write a short normal message outside the block. Use the block only when a file is wanted.")
TSET_HELP = {
    "test_limit": "📏 سهمیه تست روزانه هر کاربر رو بفرست (فقط عدد). ۰ = نامحدود.",
    "test_from": "⏰ ساعت شروع تست رو بفرست (عدد ۰ تا ۲۴، به وقت ایران). مثلا <code>9</code>",
    "test_to": "⏰ ساعت پایان تست رو بفرست (عدد ۰ تا ۲۴، به وقت ایران). مثلا <code>22</code> یا <code>24</code>",
}
SEC_LABEL = {"chat": "💬 چت", "image": "🎨 عکس", "video": "🎬 ویدیو", "test": "🧪 تست"}


# ============================================================ helpers
def _int(key, default=0):
    try:
        return int(db.get_setting(key) or default)
    except ValueError:
        return default


def _digits(text):
    return (text or "").translate(p._FA_DIGITS).strip()


def test_enabled():
    return db.get_setting("test_enabled") == "1"


def window_ok():
    a, b = min(max(_int("test_from", 0), 0), 24), min(max(_int("test_to", 24), 0), 24)
    if a == b:
        return True
    hr = dt.datetime.now(x._TZ).hour
    return a <= hr < b if a < b else (hr >= a or hr < b)


def window_text():
    a, b = min(max(_int("test_from", 0), 0), 24), min(max(_int("test_to", 24), 0), 24)
    if a == b:
        return "همیشه"
    return f"{a:02d}:00 تا {b:02d}:00"


def _ov_key(uid, sec):
    return f"{uid}|{sec}"


def get_override(uid, sec):
    r = db._q1("SELECT value FROM extra_state WHERE kind='uquota' AND key=?", (_ov_key(uid, sec),))
    if not r:
        return None
    try:
        return int(json.loads(r["value"]))
    except Exception:
        return None


def test_limit_for(uid):
    ov = get_override(uid, "test")
    return ov if ov is not None else _int("test_limit", 0)


def add_rows(markup, *rows):
    if markup and isinstance(markup, dict):
        k = markup["inline_keyboard"]
        pos = max(0, len(k) - 1)
        for i, r in enumerate(rows):
            k.insert(pos + i, r)
    return markup


async def precheck(bot, frm):
    uid = frm["id"]
    u = await h.ensure_user(bot, frm)
    r = h.deny_reason(u)
    if r:
        await bot.send(uid, r)
        return False
    if not await x.is_member(bot, uid):
        await x.ask_join(bot, uid)
        return False
    return True


# ============================================================ show hooks
_prev_show = h.show


async def show(bot, chat_id, mid, text, markup=None):
    hk = _HOOK.get()
    if hk:
        _HOOK.set(None)
        try:
            text, markup = hk(text, markup)
        except Exception:
            log.exception("hook failed")
    return await _prev_show(bot, chat_id, mid, text, markup)


h.show = show


async def hooked(hk, fn, *a):
    tok = _HOOK.set(hk)
    try:
        return await fn(*a)
    finally:
        _HOOK.reset(tok)


# ============================================================ quota override
_prev_eff = x.effective_limit


def effective_limit(uid, sec):
    if sec in h.SECTIONS and not p.is_subscribed(uid):
        ov = get_override(uid, sec)
        if ov is not None:
            return ov
    return _prev_eff(uid, sec)


x.effective_limit = effective_limit

# ============================================================ main menu
_prev_main_kb = h.main_kb


def main_kb(uid):
    k = _prev_main_kb(uid)
    if test_enabled():
        rows = k["inline_keyboard"]
        rows.insert(min(1, len(rows)), [btn("🧪 تست ربات", "x:test", "success")])
    return k


h.main_kb = main_kb

# ============================================================ test mode (user)
async def open_test(bot, uid, mid=None, note=""):
    h.clear_state(uid)
    adm = h.is_admin(uid)
    if not test_enabled() and not adm:
        h.MODE.pop(uid, None)
        return await h.show(bot, uid, mid, f"{note}🧪 تست فعلا خاموشه.", kb(h.HOME))
    m = h.current_model(uid, "chat")
    if not m:
        h.MODE.pop(uid, None)
        return await h.show(bot, uid, mid, f"{note}⚠️ هنوز هیچ مدل چتی فعال نشده.", kb(h.HOME))
    h.MODE[uid] = "test"
    lim = test_limit_for(uid)
    lim_txt = f"\n📏 سهمیه تست امروز: {db.usage_today(uid, 'test')}/{lim}" if lim and not adm else ""
    off = "" if (adm or window_ok()) else "\n⏰ الان خارج از ساعت تسته، بعدا برگرد."
    txt = (f"{note}🧪 <b>حالت تست</b> فعال شد ✅\n\n🤖 مدل: <b>{h.e(m['title'])}</b>{lim_txt}\n"
           f"⏰ ساعت مجاز: {window_text()}{off}\n\n"
           "هر چی می‌خوای بپرس یا یه فایل متنی بفرست، جوابش همینجا میاد ✍️")
    await h.show(bot, uid, mid, txt, kb([btn("🧹 تست جدید", "x:tnew", "danger")], [btn("🏠 منوی اصلی", "m:home")]))


async def send_files(bot, uid, files):
    for name, body in files:
        safe = re.sub(r'[\\/:*?"<>|\r\n]+', "_", name).strip(" .") or "file"
        if "." not in safe:
            safe += ".txt"
        try:
            await bot.api("sendDocument", files={"document": (safe, body.strip("\n").encode("utf-8"))},
                          chat_id=uid, caption=f"📎 {safe}")
        except TgError as ex:
            log.warning("send file failed: %s", ex)
            await bot.send(uid, "⚠️ ارسال فایل ناموفق بود.")


async def _test_core(bot, uid, m, text, ph_id):
    hist = list(TEST_HIST.get(uid) or [])
    n = max(0, _int("history_len", 12))
    messages = [{"role": "system", "content": db.get_setting("system_prompt")}]
    messages += hist[-n:] if n else []
    messages.append({"role": "user", "content": text})
    sink = []
    tok = FILE_SINK.set(sink)
    try:
        async with h.KeepAction(bot, uid, "typing"):
            answer = await asyncio.wait_for(ai.chat(h.provider_of(m), m["model_id"], messages), 300)
    finally:
        FILE_SINK.reset(tok)
    hist += [{"role": "user", "content": text}, {"role": "assistant", "content": answer}]
    TEST_HIST[uid] = hist[-40:]
    markup = kb([btn("🧹 تست جدید", "x:tnew", "danger"), btn("🏠 منو", "m:home")])
    chunks = h.split_text(answer)
    for i, c in enumerate(chunks):
        await h.send_rich(bot, uid, c, markup if i == len(chunks) - 1 else None,
                          edit_mid=ph_id if i == 0 else None)
    await send_files(bot, uid, sink)


async def run_test(bot, uid, text):
    adm = h.is_admin(uid)
    if not adm:
        if not test_enabled():
            return await bot.send(uid, "🧪 تست فعلا خاموشه.", kb(h.HOME))
        if not window_ok():
            return await bot.send(uid, f"⏰ تست فقط ساعت {window_text()} (به وقت ایران) فعاله. بعدا دوباره بیا 🙏",
                                  kb(h.HOME))
    if uid in h.BUSY:
        return await bot.send(uid, "⏳ درخواست قبلیت هنوز در حال انجامه، یکم صبر کن.")
    m = h.current_model(uid, "chat")
    if not m:
        return await bot.send(uid, "⚠️ هنوز مدل چتی فعال نشده.", kb(h.HOME))
    lim = test_limit_for(uid)
    if lim and not adm and db.usage_today(uid, "test") >= lim:
        return await bot.send(uid, f"📏 سهمیه تست امروزت ({lim} پیام) تموم شده. فردا دوباره امتحان کن 🙏", kb(h.HOME))
    h.BUSY.add(uid)
    ph_id = None
    try:
        ph = await bot.send(uid, "🧪 در حال فکر کردن... ⏳")
        ph_id = ph["message_id"]
        await _test_core(bot, uid, m, text, ph_id)
        db.log_usage(uid, "test", m["title"], True)
    except ai.AIError as ex:
        db.log_usage(uid, "test", m["title"], False)
        log.warning("test AI error uid=%s: %s", uid, str(ex)[:300])
        if adm:
            msg = f"❌ <b>خطا از سرویس هوش مصنوعی</b>\n🤖 {h.e(m['title'])}\n\n<code>{h.e(str(ex)[:600])}</code>"
        else:
            msg = "❌ <b>متاسفانه الان جواب نگرفتم.</b>\n🔁 یکم دیگه امتحان کن یا مدل رو عوض کن."
        await h.show(bot, uid, ph_id, msg, kb(h.HOME))
    except Exception:
        log.exception("test job failed")
        db.log_usage(uid, "test", m["title"], False)
        await h.show(bot, uid, ph_id, "❌ یه مشکل پیش اومد، لطفا دوباره امتحان کن 🙏", kb(h.HOME))
    finally:
        h.BUSY.discard(uid)


# ============================================================ files (user)
async def read_doc(bot, doc):
    name = doc.get("file_name") or "file"
    if int(doc.get("file_size") or 0) > MAX_UPLOAD:
        return None, name, "⚠️ فایل از ۱ مگابایت بزرگ‌تره. یه فایل کوچیک‌تر بفرست."
    raw = await bot.download_file(doc["file_id"])
    if len(raw) > MAX_UPLOAD:
        return None, name, "⚠️ فایل از ۱ مگابایت بزرگ‌تره. یه فایل کوچیک‌تر بفرست."
    if b"\x00" in raw[:8000]:
        return None, name, ("⚠️ این فایل متنی نیست (احتمالا PDF، Word یا باینری). فعلا فایل‌های متنی "
                            "مثل txt، md، csv، json، py و ... رو می‌خونم.")
    for enc in ("utf-8-sig", "cp1256"):
        try:
            return raw.decode(enc), name, None
        except UnicodeDecodeError:
            continue
    return None, name, "⚠️ نتونستم این فایل رو بخونم."


async def file_message(bot, uid, msg, mode):
    doc = msg["document"]
    txt, name, err = await read_doc(bot, doc)
    if err:
        return await bot.send(uid, err, kb(h.HOME))
    cap = (msg.get("caption") or "").strip() or "این فایل رو بررسی کن و خلاصه‌اش رو بگو."
    body_txt = txt[:MAX_DOC_CHARS].replace("```", "'''")
    body = f"{cap}\n\n📎 فایل «{name}»:\n```\n{body_txt}\n```"
    if len(txt) > MAX_DOC_CHARS:
        body += "\n(فایل خیلی بزرگ بود، فقط قسمت اولش خونده شد)"
    if mode == "test":
        return await run_test(bot, uid, body)
    return await h.run_job(bot, uid, "chat", body, None)


# ============================================================ AI file output
_orig_ai_chat = ai.chat


async def ai_chat(provider, model, messages):
    sink = FILE_SINK.get()
    if sink is None:
        return await _orig_ai_chat(provider, model, messages)
    msgs = [dict(m) for m in messages]
    if msgs and msgs[0].get("role") == "system":
        msgs[0]["content"] = f"{msgs[0].get('content') or ''}\n\n{FILE_HINT}"
    else:
        msgs.insert(0, {"role": "system", "content": FILE_HINT})
    text = await _orig_ai_chat(provider, model, msgs)
    files = FILE_RE.findall(text)
    if files:
        sink.extend(files)
        text = FILE_RE.sub("", text).strip() or "📎 فایلت رو فرستادم 👇"
    return text


ai.chat = ai_chat

_prev_do_chat = h.do_chat


async def do_chat(bot, uid, m, text, photo, ph_id):
    sink = []
    tok = FILE_SINK.set(sink)
    try:
        await _prev_do_chat(bot, uid, m, text, photo, ph_id)
    finally:
        FILE_SINK.reset(tok)
    await send_files(bot, uid, sink)


h.do_chat = do_chat

# ============================================================ messages & callbacks
_prev_on_message = h.on_message


async def on_message(bot, msg):
    chat = msg.get("chat") or {}
    frm = msg.get("from") or {}
    uid = frm.get("id")
    if chat.get("type") != "private" or not uid:
        return await _prev_on_message(bot, msg)
    text = (msg.get("text") or "").strip()
    cmd = text.split(" ", 1)[0].split("@", 1)[0].lower() if text.startswith("/") else ""
    if (h.STATE.get(uid) and h.is_admin(uid)) or p.USTATE.get(uid):
        return await _prev_on_message(bot, msg)
    if cmd == "/test":
        if not await precheck(bot, frm):
            return
        return await open_test(bot, uid, None)
    mode = h.MODE.get(uid)
    if mode not in ("test", "chat"):
        return await _prev_on_message(bot, msg)
    if cmd in KNOWN_CMDS:
        return await _prev_on_message(bot, msg)
    doc = msg.get("document")
    img_doc = bool(doc) and str(doc.get("mime_type", "")).startswith("image/")
    if mode == "chat":
        if not (doc and not img_doc):
            return await _prev_on_message(bot, msg)
        if not await precheck(bot, frm):
            return
        return await file_message(bot, uid, msg, "chat")
    # test mode
    if not await precheck(bot, frm):
        return
    if doc and not img_doc:
        return await file_message(bot, uid, msg, "test")
    if text:
        return await run_test(bot, uid, text)
    return await bot.send(uid, "✍️ متن یا فایل متنی بفرست (تو حالت تست عکس پشتیبانی نمیشه).", kb(h.HOME))


h.on_message = on_message


_prev_on_callback = h.on_callback


async def on_callback(bot, cq):
    data = cq.get("data") or ""
    if data not in ("x:test", "x:tnew"):
        return await _prev_on_callback(bot, cq)
    uid = cq["from"]["id"]
    mid = (cq.get("message") or {}).get("message_id")
    u = await h.ensure_user(bot, cq["from"])
    r = h.deny_reason(u)
    if r:
        return await bot.answer(cq["id"], r, True)
    if not await x.is_member(bot, uid):
        await bot.answer(cq["id"])
        return await x.ask_join(bot, uid, mid)
    await bot.answer(cq["id"])
    if data == "x:tnew":
        TEST_HIST.pop(uid, None)
        return await open_test(bot, uid, mid, "🧹 حافظه تست پاک شد.\n\n")
    return await open_test(bot, uid, mid)


h.on_callback = on_callback

h.HELP = h.HELP + ("\n\n🧪 <b>تست ربات:</b> از منوی اصلی «🧪 تست ربات» رو بزن و آزادانه امتحان کن."
                   "\n📎 فایل متنی هم بفرست، مدل می‌خونه و اگه لازم باشه فایل هم برات می‌فرسته.")
x.COMMANDS.insert(-1, {"command": "test", "description": "🧪 تست ربات"})

# ============================================================ admin: home, stats, users hooks
_prev_admin_home = h.admin_home


def _admin_rows(text, markup):
    add_rows(markup,
             [btn("🧪 تنظیم تست", "ad:ax:tset", "success"), btn("👥 همه کاربران", "ad:ax:ulist:0", "primary")],
             [btn("🗂 چت‌های کاربر", "ad:ax:cfind", "primary")])
    return text, markup


async def admin_home(bot, uid, mid=None, note=""):
    return await hooked(_admin_rows, _prev_admin_home, bot, uid, mid, note)


h.admin_home = admin_home

_prev_stats = h.stats_view


async def stats_view(bot, uid, mid):
    def hk(text, markup):
        add_rows(markup, [btn("👥 همه کاربران", "ad:ax:ulist:0", "primary"),
                          btn("🗂 چت‌های کاربر", "ad:ax:cfind", "primary")])
        return text, markup
    return await hooked(hk, _prev_stats, bot, uid, mid)


h.stats_view = stats_view


def _user_hook(target):
    def hk(text, markup):
        if db.get_user(target):
            add_rows(markup, [btn("✏️ ویرایش سهمیه", f"ad:ax:uq:{target}", "primary"),
                              btn("💬 چت‌ها", f"ad:ax:cl:{target}:0", "success")])
        return text, markup
    return hk


_prev_user_card = h.user_card


async def user_card(bot, uid, mid, target, note=""):
    return await hooked(_user_hook(target), _prev_user_card, bot, uid, mid, target, note)


h.user_card = user_card

# ============================================================ admin: models hook
def broken_models():
    out = []
    for s in h.SECTIONS:
        for m in db.list_models(s):
            r = p.TEST_RES.get(m["id"])
            if r and r[0] is False:
                out.append(m)
    return out


_prev_models_home = h.models_home


async def models_home(bot, uid, mid, note=""):
    def hk(text, markup):
        n = len(broken_models())
        add_rows(markup,
                 [btn("🧪 تست همه مدل‌ها", "ad:ax:testall", "primary")],
                 [btn(f"🧹 حذف مدل‌های خراب ({n})", "ad:ax:delbad", "danger" if n else None)])
        return (note + text if note else text), markup
    return await hooked(hk, _prev_models_home, bot, uid, mid)


h.models_home = models_home


async def testall(bot, uid, mid):
    models = [m for s in h.SECTIONS for m in db.list_models(s)]
    if not models:
        return await models_home(bot, uid, mid, "⚠️ هنوز مدلی نیست.\n\n")
    await h.show(bot, uid, mid, f"🧪 دارم {len(models)} مدل رو تست می‌کنم، چند دقیقه طول می‌کشه... ⏳")

    async def job():
        try:
            await p.test_models(bot, models)
        except Exception:
            log.exception("testall failed")
        ok = sum(1 for m in models if p.TEST_RES.get(m["id"], (None,))[0] is True)
        bad = sum(1 for m in models if p.TEST_RES.get(m["id"], (None,))[0] is False)
        await models_home(bot, uid, mid, f"🧪 تست تموم شد: ✅ {ok} | ❌ {bad} | ❔ {len(models) - ok - bad}\n\n")

    asyncio.create_task(job())


async def delbad_preview(bot, uid, mid):
    bad = broken_models()
    if not bad:
        return await models_home(bot, uid, mid, "👌 مدل خرابی پیدا نشد. اول «🧪 تست همه مدل‌ها» رو بزن.\n\n")
    names = "\n".join(f"{i + 1}. {h.e(m['title'])} · {h.SEC_ICON[m['section']]} {h.e(m['p_name'])}"
                      for i, m in enumerate(bad[:10]))
    more = f"\n… و {len(bad) - 10} مدل دیگه" if len(bad) > 10 else ""
    txt = (f"🧹 <b>{len(bad)} مدل خراب</b> (❌ توی تست):\n\n{names}{more}\n\n"
           "⚠️ این مدل‌ها برای همیشه از ربات حذف میشن. مطمئنی؟")
    markup = kb([btn(f"🗑 آره، {len(bad)} مدل رو حذف کن", "ad:ax:delbadok", "danger")],
                [btn("🔙 مدل‌ها", "ad:models")])
    await h.show(bot, uid, mid, txt, markup)


async def delbad_do(bot, uid, mid):
    bad = broken_models()
    for m in bad:
        db.delete_model(m["id"])
        p.TEST_RES.pop(m["id"], None)
    for s in h.SECTIONS:   # keep every section with a default model
        left = db.list_models(s)
        if left and not any(m["is_default"] for m in left):
            db.set_default_model(left[0]["id"])
    return await models_home(bot, uid, mid, f"🧹 {len(bad)} مدل خراب حذف شد.\n\n")


# ============================================================ admin: test settings
async def tset_panel(bot, uid, mid=None, note=""):
    h.clear_state(uid)
    en = test_enabled()
    lim = _int("test_limit", 0)
    txt = (f"{note}🧪 <b>تنظیم تست</b>\n━━━━━━━━━━━━━━\n"
           f"🔘 وضعیت: {'✅ روشن' if en else '⬜️ خاموش'}\n"
           f"📏 سهمیه هر کاربر: <b>{lim if lim else 'نامحدود'}</b> پیام در روز\n"
           f"⏰ ساعت مجاز: <b>{window_text()}</b> (به وقت ایران)\n\n"
           "کاربرها با «🧪 تست ربات» توی منوی اصلی وارد میشن. مدیرها محدودیت ندارن.\n"
           "سهمیه شخصی هر کاربر رو از «👥 همه کاربران ← ✏️ ویرایش سهمیه» عوض کن.")
    markup = kb(
        [btn("🔴 خاموشش کن" if en else "🟢 روشنش کن", "ad:ax:ttg", "danger" if en else "success")],
        [btn("📏 سهمیه روزانه", "ad:ax:tse:test_limit", "primary")],
        [btn("⏰ ساعت شروع", "ad:ax:tse:test_from", "primary"), btn("⏰ ساعت پایان", "ad:ax:tse:test_to", "primary")],
        [btn("🔙 پنل مدیریت", "ad:home")],
    )
    await h.show(bot, uid, mid, txt, markup)


# ============================================================ admin: users & chats
async def users_list(bot, uid, mid, page=0):
    total = db._q1("SELECT COUNT(*) c FROM users")["c"]
    pages = max(1, math.ceil(total / PAGE))
    page = max(0, min(page, pages - 1))
    sfa = {"active": "🟢", "pending": "⏳", "banned": "🚫"}
    rows = [[btn(f"{sfa.get(u['status'], '•')} {(u.get('first_name') or str(u['id']))[:18]} · {u['id']}",
                 f"ad:u:{u['id']}")]
            for u in db._q("SELECT * FROM users ORDER BY joined DESC LIMIT ? OFFSET ?", (PAGE, page * PAGE))]
    nav = []
    if page > 0:
        nav.append(btn("⬅️ قبلی", f"ad:ax:ulist:{page - 1}"))
    nav.append(btn(f"📄 {page + 1}/{pages}", "ad:noop"))
    if page < pages - 1:
        nav.append(btn("بعدی ➡️", f"ad:ax:ulist:{page + 1}"))
    rows.append(nav)
    rows.append([btn("🔙 پنل مدیریت", "ad:home")])
    await h.show(bot, uid, mid, f"👥 <b>همه کاربران</b> ({total})\n\nروی هر کاربر بزن تا پروفایل و ویرایشش باز بشه 👇",
                 kb(*rows))


async def quota_panel(bot, uid, mid, target, note=""):
    h.clear_state(uid)
    u = db.get_user(target)
    if not u:
        return await h.users_home(bot, uid, mid, "⚠️ کاربر پیدا نشد.\n\n")
    lines, rows = [], []
    for s, lab in SEC_LABEL.items():
        ov = get_override(target, s)
        base = _int("test_limit", 0) if s == "test" else _int(f"limit_{s}", 0)
        if ov is None:
            cur = f"پیش‌فرض ({base if base else 'نامحدود'})"
        elif ov == 0:
            cur = "نامحدود"
        else:
            cur = str(ov)
        lines.append(f"{lab}: <b>{cur}</b>")
        rows.append([btn(f"✏️ {lab}", f"ad:ax:uqs:{target}:{s}", "primary")])
    rows.append([btn("🔙 کاربر", f"ad:u:{target}")])
    txt = (f"{note}✏️ <b>ویرایش سهمیه</b>\n{h.user_line(u)}\n\n" + "\n".join(lines) +
           "\n\n۰ = نامحدود | - = برگشت به پیش‌فرض")
    await h.show(bot, uid, mid, txt, kb(*rows))


async def convs_list(bot, uid, mid, target, page=0):
    u = db.get_user(target)
    if not u:
        return await h.users_home(bot, uid, mid, "⚠️ کاربر پیدا نشد.\n\n")
    convs = p.conv_list(target)
    head = f"💬 <b>چت‌های {h.e(u.get('first_name') or str(target))}</b> ({target})\n━━━━━━━━━━━━━━\n"
    if not convs:
        return await h.show(bot, uid, mid, head + "📭 این کاربر هنوز چتی نداره.",
                            kb([btn("🔙 کاربر", f"ad:u:{target}")]))
    per = 6
    pages = max(1, math.ceil(len(convs) / per))
    page = max(0, min(page, pages - 1))
    rows = []
    for c in convs[page * per:(page + 1) * per]:
        first = re.sub(r"\s+", " ", (c["first"] or "گفتگو").replace("[عکس فرستادم]", "🖼")).strip()[:26]
        rows.append([btn(f"🗂 {first} · {max(1, c['n'] // 2)} پیام", f"ad:ax:cv:{target}:{c['conv']}:0")])
    nav = []
    if page > 0:
        nav.append(btn("⬅️ قبلی", f"ad:ax:cl:{target}:{page - 1}"))
    nav.append(btn(f"📄 {page + 1}/{pages}", "ad:noop"))
    if page < pages - 1:
        nav.append(btn("بعدی ➡️", f"ad:ax:cl:{target}:{page + 1}"))
    rows.append(nav)
    rows.append([btn("📦 دانلود همه گفتگوها", f"ad:ax:cda:{target}", "success")])
    rows.append([btn("🔙 کاربر", f"ad:u:{target}")])
    await h.show(bot, uid, mid, head + f"🗂 تعداد گفتگو: <b>{len(convs)}</b>\nروی هر گفتگو بزن تا بازش کنی یا دانلودش کنی 👇",
                 kb(*rows))


def _conv_rows(target, conv=None):
    if conv is None:
        return db._q("SELECT conv, role, content, model, ts FROM chat_logs WHERE user_id=? ORDER BY conv, id",
                     (target,))
    return db._q("SELECT conv, role, content, model, ts FROM chat_logs WHERE user_id=? AND conv=? ORDER BY id",
                 (target, conv))


async def conv_view(bot, uid, mid, target, conv, page=0):
    rows = _conv_rows(target, conv)
    blocks = []
    for r in rows:
        who = "👤 کاربر" if r["role"] == "user" else "🤖 ربات"
        content = r["content"] or ""
        parts = [content[i:i + 600] for i in range(0, len(content), 600)] or [""]
        for k, part in enumerate(parts):
            blocks.append((r, who if k == 0 else f"{who} (ادامه)", part))
    if not blocks:
        return await convs_list(bot, uid, mid, target, 0)
    n = len(blocks)
    page = max(0, min(page, n - 1))
    r, who, part = blocks[page]
    nav = []
    if page > 0:
        nav.append(btn("⬅️ قبلی", f"ad:ax:cv:{target}:{conv}:{page - 1}"))
    nav.append(btn(f"📖 {page + 1}/{n}", "ad:noop"))
    if page < n - 1:
        nav.append(btn("بعدی ➡️", f"ad:ax:cv:{target}:{conv}:{page + 1}"))
    markup = kb(nav,
                [btn("📥 دانلود این گفتگو", f"ad:ax:cd:{target}:{conv}", "success")],
                [btn("🔙 چت‌ها", f"ad:ax:cl:{target}:0"), btn("👤 کاربر", f"ad:u:{target}")])
    txt = (f"🗂 <b>گفتگو #{conv}</b> · کاربر {target}\n━━━━━━━━━━━━━━\n"
           f"🕒 {p.jdate(r['ts'], True)} · 🤖 {h.e(r['model'] or '-')}\n\n"
           f"<b>{who}:</b>\n{h.e(part)}")
    await h.show(bot, uid, mid, txt, markup)


def _as_text(rows):
    out, cur = [], None
    for r in rows:
        if r["conv"] != cur:
            cur = r["conv"]
            out.append(f"\n==================== گفتگو #{cur} ====================\n")
        who = "کاربر" if r["role"] == "user" else "ربات"
        out.append(f"[{p.jdate(r['ts'], True)}] {who} ({r['model'] or '-'}):\n{r['content'] or ''}\n")
    return "\n".join(out)


async def send_text_file(bot, uid, name, text, caption):
    try:
        await bot.api("sendDocument", files={"document": (name, text.encode("utf-8"))},
                      chat_id=uid, caption=caption[:1000])
    except TgError as ex:
        log.warning("admin export failed: %s", ex)
        await bot.send(uid, "⚠️ ارسال فایل ناموفق بود.")


async def conv_download(bot, uid, target, conv):
    rows = _conv_rows(target, conv)
    if not rows:
        return await bot.send(uid, "📭 این گفتگو خالیه.")
    await send_text_file(bot, uid, f"chat_{target}_{conv}.txt", _as_text(rows),
                         f"🗂 گفتگو #{conv} کاربر {target}")


async def all_download(bot, uid, target):
    rows = _conv_rows(target)
    if not rows:
        return await bot.send(uid, "📭 این کاربر هنوز چتی نداره.")
    await send_text_file(bot, uid, f"all_chats_{target}.txt", _as_text(rows), f"📦 همه گفتگوهای کاربر {target}")


# ============================================================ admin dispatch
async def _admin_dispatch(bot, uid, mid, a):
    cmd = a[0]
    if cmd == "tset":
        return await tset_panel(bot, uid, mid)
    if cmd == "ttg":
        db.set_setting("test_enabled", "0" if test_enabled() else "1")
        return await tset_panel(bot, uid, mid, "✅ ذخیره شد.\n\n")
    if cmd == "tse":
        key = a[1]
        if key not in TSET_HELP:
            return await tset_panel(bot, uid, mid)
        h.set_state(uid, "t_set", key=key)
        return await h.show(bot, uid, mid, f"{TSET_HELP[key]}\n\n📌 مقدار فعلی: <code>{h.e(db.get_setting(key))}</code>",
                            h.CANCEL)
    if cmd == "ulist":
        return await users_list(bot, uid, mid, int(a[1]))
    if cmd == "uq":
        return await quota_panel(bot, uid, mid, int(a[1]))
    if cmd == "uqs":
        h.set_state(uid, "u_quota", target=int(a[1]), sec=a[2])
        return await h.show(bot, uid, mid,
                            f"✏️ سهمیه {SEC_LABEL.get(a[2], a[2])} این کاربر رو بفرست.\n"
                            "۰ = نامحدود | - = برگشت به پیش‌فرض",
                            kb([btn("❌ لغو", f"ad:ax:uq:{a[1]}", "danger")]))
    if cmd == "cfind":
        h.set_state(uid, "c_find")
        return await h.show(bot, uid, mid, "🔍 آیدی عددی یا یوزرنیم کاربر رو بفرست تا چت‌هاش رو نشونت بدم.", h.CANCEL)
    if cmd == "cl":
        return await convs_list(bot, uid, mid, int(a[1]), int(a[2]))
    if cmd == "cv":
        return await conv_view(bot, uid, mid, int(a[1]), int(a[2]), int(a[3]))
    if cmd == "cd":
        return await conv_download(bot, uid, int(a[1]), int(a[2]))
    if cmd == "cda":
        return await all_download(bot, uid, int(a[1]))
    if cmd == "testall":
        return await testall(bot, uid, mid)
    if cmd == "delbad":
        return await delbad_preview(bot, uid, mid)
    if cmd == "delbadok":
        return await delbad_do(bot, uid, mid)
    return await h.admin_home(bot, uid, mid)


_prev_admin_cb = h.admin_cb


async def admin_cb(bot, uid, mid, d):
    parts = d.split(":")
    if parts[0] != "ax":
        return await _prev_admin_cb(bot, uid, mid, d)
    try:
        return await _admin_dispatch(bot, uid, mid, parts[1:])
    except (ValueError, IndexError):
        return await h.admin_home(bot, uid, mid)


h.admin_cb = admin_cb

_prev_admin_input = h.admin_input


async def admin_input(bot, msg, st):
    s, d = st["s"], st["d"]
    if s not in ("t_set", "u_quota", "c_find"):
        return await _prev_admin_input(bot, msg, st)
    uid = msg["chat"]["id"]
    text = (msg.get("text") or "").strip()
    if not text:
        return await bot.send(uid, "✍️ لطفا متن بفرست.", h.CANCEL)

    if s == "c_find":
        u = db.find_user(text)
        if not u:
            return await bot.send(uid, "⚠️ پیدا نشد، دوباره بفرست یا لغو کن.", h.CANCEL)
        h.clear_state(uid)
        return await convs_list(bot, uid, None, u["id"], 0)

    raw = _digits(text)
    if s == "t_set":
        key = d.get("key")
        maxv = 100000 if key == "test_limit" else 24
        if not raw.isdigit() or int(raw) > maxv:
            return await bot.send(uid, f"⚠️ یه عدد بین ۰ تا {maxv} بفرست.", h.CANCEL)
        db.set_setting(key, str(int(raw)))
        return await tset_panel(bot, uid, None, "✅ ذخیره شد.\n\n")

    # u_quota
    target, sec = int(d["target"]), d["sec"]
    key = _ov_key(target, sec)
    if raw == "-":
        x._st_del("uquota", key)
        note = "♻️ برگشت به پیش‌فرض.\n\n"
    elif raw.isdigit() and int(raw) <= 100000:
        x._st_save("uquota", key, int(raw))
        note = "✅ ذخیره شد.\n\n"
    else:
        return await bot.send(uid, "⚠️ یه عدد بفرست (۰ = نامحدود) یا - برای برگشت به پیش‌فرض.",
                              kb([btn("❌ لغو", f"ad:ax:uq:{target}", "danger")]))
    return await quota_panel(bot, uid, None, target, note)


h.admin_input = admin_input

log.info("upgrade loaded")
