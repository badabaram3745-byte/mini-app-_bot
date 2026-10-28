"""Pro upgrades (additive only, nothing in older files is changed or removed).

  * Fetched models: pick the section, the AI folder is chosen automatically
    from the model name; the folder is asked only when the name is unknown.
  * Admin can reveal full API keys.
  * 💎 Subscription shop: 1 / 3 / 12 month plans, card-to-card payment,
    receipt upload, admin approve/reject, automatic activation + expiry
    reminders. Prices, card number, holder, bank, texts are set from the panel.
  * 📚 Past chats in "My account", paged like a book, with continue/delete.
  * Admin → Models: test only the current page, and search models by name.
"""
import asyncio
import contextvars
import logging
import re
import time

import ai
import db
import extras as x
import handlers as h
from tg import TgError, btn, kb

log = logging.getLogger("pro")

PLANS = {"1": ("یک ماهه", 30, "🥉"), "3": ("سه ماهه", 90, "🥈"), "12": ("یک ساله", 365, "🥇")}

PRO_DEFAULTS = {
    "sub_enabled": "1",
    "sub_price_1": "0",
    "sub_price_3": "0",
    "sub_price_12": "0",
    "card_number": "",
    "card_holder": "",
    "card_bank": "",
    "sub_desc": "✨ استفاده نامحدود از همه بخش‌ها\n⚡️ بدون محدودیت روزانه\n🚀 دسترسی به بخش‌های ویژه",
    "sub_only_chat": "0",
    "sub_only_image": "0",
    "sub_only_video": "0",
}
for _k, _v in PRO_DEFAULTS.items():
    db.DEFAULTS.setdefault(_k, _v)

with db._lock:
    db._conn.executescript("""
    CREATE TABLE IF NOT EXISTS subscriptions(
        user_id INTEGER PRIMARY KEY, expires INTEGER, plan TEXT,
        warned INTEGER DEFAULT 0, ended INTEGER DEFAULT 0, updated INTEGER);
    CREATE TABLE IF NOT EXISTS payments(
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, plan TEXT, amount INTEGER,
        status TEXT, kind TEXT, file_id TEXT, note TEXT, created INTEGER,
        decided INTEGER, admin_id INTEGER);
    CREATE INDEX IF NOT EXISTS payments_status ON payments(status);
    CREATE TABLE IF NOT EXISTS chat_logs(
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, conv INTEGER,
        role TEXT, content TEXT, model TEXT, ts INTEGER);
    CREATE INDEX IF NOT EXISTS chat_logs_uc ON chat_logs(user_id, conv);
    """)
    db._conn.commit()

e = h.e

# show() hook: lets a wrapper add buttons/text to the ONE screen an original
# function renders, without touching that function. Context-local, so
# concurrent users never see each other's extra buttons.
_SHOW_HOOK = contextvars.ContextVar("pro_show_hook", default=None)
_base_show = h.show


async def show(bot, chat_id, mid, text, markup=None):
    hook = _SHOW_HOOK.get()
    if hook:
        _SHOW_HOOK.set(None)
        try:
            text, markup = hook(text, markup)
        except Exception:
            log.exception("show hook")
    return await _base_show(bot, chat_id, mid, text, markup)


h.show = show


async def with_hook(hook, fn, *a):
    tok = _SHOW_HOOK.set(hook)
    try:
        return await fn(*a)
    finally:
        _SHOW_HOOK.reset(tok)


# =============================================================== helpers
def g2j(gy, gm, gd):
    g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
    gy2 = gy + 1 if gm > 2 else gy
    days = (355666 + 365 * gy + (gy2 + 3) // 4 - (gy2 + 99) // 100 + (gy2 + 399) // 400
            + gd + g_d_m[gm - 1])
    jy = -1595 + 33 * (days // 12053)
    days %= 12053
    jy += 4 * (days // 1461)
    days %= 1461
    if days > 365:
        jy += (days - 1) // 365
        days = (days - 1) % 365
    if days < 186:
        jm, jd = 1 + days // 31, 1 + days % 31
    else:
        jm, jd = 7 + (days - 186) // 30, 1 + (days - 186) % 30
    return jy, jm, jd


def jdate(ts, with_time=False):
    import datetime as dt
    d = dt.datetime.fromtimestamp(ts, x._TZ)
    jy, jm, jd = g2j(d.year, d.month, d.day)
    s = f"{jy}/{jm:02d}/{jd:02d}"
    return s + (f" - {d.hour:02d}:{d.minute:02d}" if with_time else "")


def money(v):
    try:
        return f"{int(v):,} تومان"
    except (TypeError, ValueError):
        return "—"


def card_fmt(c):
    d = re.sub(r"\D", "", c or "")
    return " ".join(d[i:i + 4] for i in range(0, len(d), 4)) if d else ""


def plan_price(p):
    try:
        return int(db.get_setting(f"sub_price_{p}") or 0)
    except ValueError:
        return 0


def get_sub(uid):
    return db._q1("SELECT * FROM subscriptions WHERE user_id=?", (uid,))


def is_subscribed(uid):
    s = get_sub(uid)
    return bool(s and s["expires"] > time.time())


def days_left(uid):
    s = get_sub(uid)
    if not s or s["expires"] <= time.time():
        return 0
    return max(1, int((s["expires"] - time.time() + 86399) // 86400))


def grant_sub(uid, days, plan="manual"):
    now = int(time.time())
    s = get_sub(uid)
    base = s["expires"] if s and s["expires"] > now else now
    exp = base + int(days) * 86400
    db._ex("INSERT INTO subscriptions(user_id,expires,plan,warned,ended,updated) VALUES(?,?,?,0,0,?) "
           "ON CONFLICT(user_id) DO UPDATE SET expires=excluded.expires, plan=excluded.plan, "
           "warned=0, ended=0, updated=excluded.updated", (uid, exp, plan, now))
    return exp


def cancel_sub(uid):
    db._ex("UPDATE subscriptions SET expires=?, ended=1 WHERE user_id=?", (int(time.time()) - 1, uid))


def sub_only(sec):
    return db.get_setting(f"sub_only_{sec}") == "1"


def pending_count():
    r = db._q1("SELECT COUNT(*) c FROM payments WHERE status='pending'")
    return r["c"] if r else 0


def admin_ids():
    return list(h.ADMIN_IDS)


USTATE = x.PDict("ustate", str, int)   # user-side waits (receipt upload)

# ======================================================= quota integration
_prev_effective_limit = x.effective_limit


def effective_limit(uid, sec):
    if is_subscribed(uid):
        return 0
    return _prev_effective_limit(uid, sec)


x.effective_limit = effective_limit


def buy_row(label="💎 خرید اشتراک"):
    return [btn(label, "x:sub", "success")]


_prev_run_job = h.run_job


async def run_job(bot, uid, sec, text, photo):
    if sec in h.SECTIONS and sub_only(sec) and not h.is_admin(uid) and not is_subscribed(uid):
        return await bot.send(uid, f"🔒 <b>{h.SECTIONS[sec]}</b> مخصوص مشترکین ویژه است.\n\n"
                                   "💎 با خرید اشتراک، بدون محدودیت استفاده کن.",
                              kb(buy_row(), h.HOME))
    return await _prev_run_job(bot, uid, sec, text, photo)


h.run_job = run_job

_prev_open_section = h.open_section


async def open_section(bot, uid, sec, mid=None, note=""):
    if sec in h.SECTIONS and sub_only(sec) and not h.is_admin(uid) and not is_subscribed(uid):
        h.MODE.pop(uid, None)
        return await h.show(bot, uid, mid, f"🔒 <b>{h.SECTIONS[sec]}</b> مخصوص مشترکین ویژه است.\n\n"
                                           "💎 با خرید اشتراک به این بخش دسترسی پیدا می‌کنی.",
                            kb(buy_row(), h.HOME))
    return await _prev_open_section(bot, uid, sec, mid, note)


h.open_section = open_section

# ============================================================ main menu
_prev_main_kb = h.main_kb


def main_kb(uid):
    k = _prev_main_kb(uid)
    rows = k["inline_keyboard"]
    if db.get_setting("sub_enabled") == "1" or is_subscribed(uid):
        n = days_left(uid)
        label = f"💎 اشتراک ویژه من · {n} روز" if n else "💎 خرید اشتراک ویژه 💎"
        row = [btn(label, "x:sub", "success")]
        pos = len(rows)
        if h.is_admin(uid) and rows and rows[-1] and rows[-1][0].get("callback_data") == "ad:home":
            pos -= 1
        rows.insert(pos, row)
    return k


h.main_kb = main_kb

# ========================================================= subscription UI
async def sub_home(bot, uid, mid=None, note=""):
    USTATE.pop(uid, None)
    s = get_sub(uid)
    txt = f"{note}💎 <b>اشتراک ویژه</b>\n━━━━━━━━━━━━━━\n"
    if s and s["expires"] > time.time():
        txt += (f"✅ وضعیت: <b>فعال</b>\n📅 تا تاریخ: <b>{jdate(s['expires'])}</b>\n"
                f"⏳ باقی‌مونده: <b>{days_left(uid)} روز</b>\n\n🔁 با خرید دوباره، زمانش به اشتراک فعلی اضافه میشه.\n")
    else:
        txt += "⚪️ وضعیت: <b>بدون اشتراک</b>\n"
    txt += f"\n<b>🎁 مزایا:</b>\n{e(db.get_setting('sub_desc'))}\n"
    rows = []
    if db.get_setting("sub_enabled") != "1":
        txt += "\n🚫 فروش اشتراک فعلا بسته است."
    else:
        plans = [(p, plan_price(p)) for p in PLANS if plan_price(p) > 0]
        if not plans or not db.get_setting("card_number"):
            txt += "\n⚠️ فروش هنوز توسط مدیر راه‌اندازی نشده."
            if h.is_admin(uid):
                txt += "\n🛠 از پنل مدیریت ← 💎 اشتراک و پرداخت، قیمت و شماره کارت رو تنظیم کن."
        else:
            txt += "\n👇 <b>پلن موردنظرت رو انتخاب کن:</b>"
            styles = {"1": "primary", "3": "success", "12": "danger"}
            for p, price in plans:
                name, days, icon = PLANS[p]
                per_month = price // max(1, days // 30)
                extra = f" · ماهی {per_month:,}" if p != "1" else ""
                rows.append([btn(f"{icon} {name} · {price:,} تومان{extra}", f"x:subp:{p}", styles[p])])
    rows.append(h.HOME)
    await h.show(bot, uid, mid, txt, kb(*rows))


async def sub_invoice(bot, uid, mid, p):
    if p not in PLANS or plan_price(p) <= 0 or db.get_setting("sub_enabled") != "1":
        return await sub_home(bot, uid, mid)
    name, days, icon = PLANS[p]
    price = plan_price(p)
    card = card_fmt(db.get_setting("card_number"))
    holder = db.get_setting("card_holder")
    bank = db.get_setting("card_bank")
    txt = (f"{icon} <b>اشتراک {name}</b> ({days} روز)\n━━━━━━━━━━━━━━\n"
           f"💰 مبلغ قابل پرداخت: <b>{price:,} تومان</b>\n\n"
           f"💳 شماره کارت:\n<code>{e(card)}</code>\n")
    if holder:
        txt += f"👤 به نام: <b>{e(holder)}</b>\n"
    if bank:
        txt += f"🏦 بانک: {e(bank)}\n"
    txt += ("\n📌 <b>مراحل:</b>\n"
            "1️⃣ مبلغ رو دقیق به کارت بالا واریز کن (روی شماره کارت بزنی کپی میشه).\n"
            "2️⃣ <b>عکس رسید</b> رو همینجا بفرست 📸\n"
            "3️⃣ بعد از تایید مدیر، اشتراکت <b>خودکار فعال</b> میشه ✅")
    USTATE[uid] = {"s": "receipt", "plan": p, "amount": price}
    await h.show(bot, uid, mid, txt, kb([btn("❌ انصراف", "x:subcancel", "danger"), btn("🔙 پلن‌ها", "x:sub")]))


async def receive_receipt(bot, msg, st):
    uid = msg["chat"]["id"]
    p = st.get("plan")
    if p not in PLANS:
        USTATE.pop(uid, None)
        return await sub_home(bot, uid)
    photo = msg.get("photo")
    doc = msg.get("document")
    text = (msg.get("text") or msg.get("caption") or "").strip()
    if photo:
        kind, fid = "photo", photo[-1]["file_id"]
    elif doc:
        kind, fid = "document", doc["file_id"]
    elif text:
        kind, fid = "text", None
    else:
        return await bot.send(uid, "📸 لطفا عکس رسید رو بفرست.", kb([btn("❌ انصراف", "x:subcancel", "danger")]))
    if db._q1("SELECT id FROM payments WHERE user_id=? AND status='pending'", (uid,)):
        USTATE.pop(uid, None)
        return await bot.send(uid, "⏳ یه رسید قبلی ازت در حال بررسیه، لطفا صبر کن تا مدیر بررسی کنه 🙏", kb(h.HOME))
    pay_id = db._ex("INSERT INTO payments(user_id,plan,amount,status,kind,file_id,note,created) "
                    "VALUES(?,?,?,?,?,?,?,?)",
                    (uid, p, int(st.get("amount") or plan_price(p)), "pending", kind, fid, text[:500], int(time.time())))
    USTATE.pop(uid, None)
    await bot.send(uid, f"✅ <b>رسیدت ثبت شد!</b>\n\n🧾 شماره پیگیری: <code>#{pay_id}</code>\n"
                        "⏳ بعد از بررسی مدیر، اشتراکت خودکار فعال میشه و همینجا خبرت می‌کنم.", kb(h.HOME))
    await notify_admins_payment(bot, pay_id)


def pay_caption(pay):
    u = db.get_user(pay["user_id"]) or {"id": pay["user_id"]}
    name, days, icon = PLANS.get(pay["plan"], ("?", 0, "💎"))
    sfa = {"pending": "⏳ در انتظار بررسی", "approved": "✅ تایید شد", "rejected": "❌ رد شد"}
    t = (f"🧾 <b>رسید پرداخت #{pay['id']}</b>\n━━━━━━━━━━━━━━\n{h.user_line(u)}\n"
         f"{icon} پلن: <b>{name}</b> ({days} روز)\n💰 مبلغ: <b>{money(pay['amount'])}</b>\n"
         f"🕒 زمان: {jdate(pay['created'], True)}\n📌 وضعیت: {sfa.get(pay['status'], pay['status'])}")
    if pay.get("note"):
        t += f"\n📝 توضیح کاربر: <i>{e(pay['note'][:300])}</i>"
    if is_subscribed(pay["user_id"]):
        t += f"\n💎 اشتراک فعلی تا {jdate(get_sub(pay['user_id'])['expires'])}"
    return t


def pay_kb(pay):
    if pay["status"] != "pending":
        return kb([btn("🔙 رسیدها", "ad:xpays")])
    return kb([btn("✅ تایید و فعال‌سازی", f"ad:xpok:{pay['id']}", "success"),
               btn("❌ رد رسید", f"ad:xpno:{pay['id']}", "danger")],
              [btn("👤 پروفایل کاربر", f"ad:u:{pay['user_id']}")])


async def send_payment(bot, chat_id, pay):
    cap, markup = pay_caption(pay), pay_kb(pay)
    try:
        if pay["kind"] == "photo":
            return await bot.send_photo(chat_id, pay["file_id"], cap, markup)
        if pay["kind"] == "document":
            return await bot.api("sendDocument", chat_id=chat_id, document=pay["file_id"], caption=cap,
                                 parse_mode="HTML", reply_markup=markup)
    except TgError as ex:
        log.warning("send receipt failed: %s", ex)
    return await bot.send(chat_id, cap, markup)


async def notify_admins_payment(bot, pay_id):
    pay = db._q1("SELECT * FROM payments WHERE id=?", (pay_id,))
    for a in admin_ids():
        try:
            await send_payment(bot, a, pay)
        except Exception:
            log.exception("notify admin failed")


async def decide_payment(bot, admin, mid, pay_id, ok):
    pay = db._q1("SELECT * FROM payments WHERE id=?", (pay_id,))
    if not pay:
        return await bot.send(admin, "⚠️ رسید پیدا نشد.")
    if pay["status"] != "pending":
        return await bot.send(admin, f"ℹ️ رسید #{pay_id} قبلا بررسی شده ({pay['status']}).", kb([btn("🔙 رسیدها", "ad:xpays")]))
    db._ex("UPDATE payments SET status=?, decided=?, admin_id=? WHERE id=?",
           ("approved" if ok else "rejected", int(time.time()), admin, pay_id))
    pay = db._q1("SELECT * FROM payments WHERE id=?", (pay_id,))
    name, days, icon = PLANS.get(pay["plan"], ("?", 30, "💎"))
    if ok:
        exp = grant_sub(pay["user_id"], days, pay["plan"])
        try:
            await bot.send(pay["user_id"], f"🎉 <b>اشتراک ویژه‌ت فعال شد!</b>\n━━━━━━━━━━━━━━\n"
                                           f"{icon} پلن: <b>{name}</b>\n📅 اعتبار تا: <b>{jdate(exp)}</b>\n\n"
                                           "💎 از امکانات ویژه لذت ببر!", h.main_kb(pay["user_id"]))
        except Exception:
            pass
        note = f"✅ رسید #{pay_id} تایید شد و اشتراک تا {jdate(exp)} فعال شد."
    else:
        try:
            await bot.send(pay["user_id"], f"❌ <b>رسید #{pay_id} تایید نشد.</b>\n\n"
                                           "اگه فکر می‌کنی اشتباه شده، دوباره رسید صحیح رو بفرست یا با پشتیبانی در تماس باش.",
                           kb(buy_row("💎 تلاش دوباره"), h.HOME))
        except Exception:
            pass
        note = f"❌ رسید #{pay_id} رد شد و به کاربر اطلاع داده شد."
    if mid:
        try:
            await bot.api("editMessageCaption", chat_id=admin, message_id=mid, caption=pay_caption(pay),
                          parse_mode="HTML", reply_markup=pay_kb(pay))
        except Exception:
            try:
                await bot.edit(admin, mid, pay_caption(pay), pay_kb(pay))
            except Exception:
                pass
    rows = [[btn(f"⏳ رسیدهای در انتظار ({pending_count()})", "ad:xpays", "primary")]]
    if not ok:
        rows.insert(0, [btn("✏️ ارسال دلیل رد برای کاربر", f"ad:xprs:{pay_id}")])
    rows.append([btn("💎 اشتراک و پرداخت", "ad:xsub")])
    await bot.send(admin, note, kb(*rows))


# ============================================================ expiry loop
_LOOP = {"started": False}


async def expiry_loop(bot):
    while True:
        try:
            now = int(time.time())
            for s in db._q("SELECT * FROM subscriptions WHERE warned=0 AND expires>? AND expires<?",
                           (now, now + 86400)):
                db._ex("UPDATE subscriptions SET warned=1 WHERE user_id=?", (s["user_id"],))
                try:
                    await bot.send(s["user_id"], "⏰ <b>اشتراک ویژه‌ت کمتر از ۲۴ ساعت دیگه تموم میشه.</b>\n"
                                                 "برای قطع نشدن، همین الان تمدیدش کن 💎", kb(buy_row("💎 تمدید اشتراک")))
                except Exception:
                    pass
            for s in db._q("SELECT * FROM subscriptions WHERE ended=0 AND expires<=?", (now,)):
                db._ex("UPDATE subscriptions SET ended=1 WHERE user_id=?", (s["user_id"],))
                try:
                    await bot.send(s["user_id"], "⌛️ <b>اشتراک ویژه‌ت تموم شد.</b>\nبرای ادامه استفاده بدون محدودیت، تمدید کن 💎",
                                   kb(buy_row("💎 تمدید اشتراک"), h.HOME))
                except Exception:
                    pass
        except Exception:
            log.exception("expiry loop")
        await asyncio.sleep(1800)


_prev_handle_update = h.handle_update


async def handle_update(bot, upd):
    if not _LOOP["started"]:
        _LOOP["started"] = True
        asyncio.create_task(expiry_loop(bot))
    await _prev_handle_update(bot, upd)


h.handle_update = handle_update

# ============================================================ chat archive
def _conv(uid):
    r = db._q1("SELECT value FROM extra_state WHERE kind='conv' AND key=?", (str(uid),))
    if r:
        try:
            return int(r["value"])
        except ValueError:
            pass
    m = db._q1("SELECT MAX(conv) c FROM chat_logs WHERE user_id=?", (uid,))
    c = (m["c"] or 0) + 1 if m else 1
    x._st_save("conv", str(uid), c)
    return c


def _set_conv(uid, c):
    x._st_save("conv", str(uid), int(c))


def _bump_conv(uid):
    m = db._q1("SELECT MAX(conv) c FROM chat_logs WHERE user_id=?", (uid,))
    cur = _conv(uid)
    _set_conv(uid, max(cur, (m["c"] or 0) if m else 0) + 1)


class HistoryDict(x.PDict):
    def pop(self, k, *default):
        if isinstance(k, int) and dict.get(self, k):
            try:
                _bump_conv(k)
            except Exception:
                log.exception("bump conv")
        return super().pop(k, *default)


h.HISTORY.__class__ = HistoryDict

_prev_do_chat = h.do_chat


async def do_chat(bot, uid, m, text, photo, ph_id):
    before = len(dict.get(h.HISTORY, uid) or [])
    last_before = (dict.get(h.HISTORY, uid) or [None])[-1] if before else None
    await _prev_do_chat(bot, uid, m, text, photo, ph_id)
    hist = dict.get(h.HISTORY, uid) or []
    if len(hist) >= 2 and hist[-1] is not last_before and hist[-1].get("role") == "assistant":
        c = _conv(uid)
        now = int(time.time())
        for item in hist[-2:]:
            content = item.get("content")
            if not isinstance(content, str):
                content = str(content)
            db._ex("INSERT INTO chat_logs(user_id,conv,role,content,model,ts) VALUES(?,?,?,?,?,?)",
                   (uid, c, item.get("role"), content, m.get("title"), now))


h.do_chat = do_chat


def conv_list(uid):
    return db._q("SELECT conv, COUNT(*) n, MIN(ts) t0, MAX(ts) t1, "
                 "(SELECT content FROM chat_logs c2 WHERE c2.user_id=c.user_id AND c2.conv=c.conv "
                 " AND c2.role='user' ORDER BY id LIMIT 1) first, "
                 "(SELECT model FROM chat_logs c3 WHERE c3.user_id=c.user_id AND c3.conv=c.conv "
                 " ORDER BY id DESC LIMIT 1) model "
                 "FROM chat_logs c WHERE user_id=? GROUP BY conv ORDER BY MAX(id) DESC", (uid,))


async def history_list(bot, uid, mid, page=0, note=""):
    convs = conv_list(uid)
    if not convs:
        return await h.show(bot, uid, mid, f"{note}📚 <b>چت‌های قبلی</b>\n\n📭 هنوز گفتگویی ذخیره نشده.\n"
                                           "از بخش 💬 چت شروع کن، همه گفتگوهات اینجا می‌مونن.",
                            kb([btn("💬 شروع چت", "m:chat", "primary")], [btn("🔙 حساب من", "m:me")]))
    per = 6
    pages = max(1, (len(convs) + per - 1) // per)
    page = max(0, min(page, pages - 1))
    cur = _conv(uid)
    rows = []
    for c in convs[page * per:(page + 1) * per]:
        first = re.sub(r"\s+", " ", (c["first"] or "گفتگو").replace("[عکس فرستادم]", "🖼")).strip()[:26]
        mark = "🟢 " if c["conv"] == cur else ""
        rows.append([btn(f"{mark}🗂 {first} · {c['n'] // 2} پیام", f"x:hv:{c['conv']}:0")])
    nav = []
    if page > 0:
        nav.append(btn("⬅️ قبلی", f"x:hl:{page - 1}"))
    nav.append(btn(f"📄 {page + 1}/{pages}", "noop"))
    if page < pages - 1:
        nav.append(btn("بعدی ➡️", f"x:hl:{page + 1}"))
    rows.append(nav)
    rows.append([btn("🔙 حساب من", "m:me"), btn("🏠 منو", "m:home")])
    txt = (f"{note}📚 <b>چت‌های قبلی</b>\n━━━━━━━━━━━━━━\n🗂 تعداد گفتگوها: {len(convs)}\n"
           "🟢 = گفتگوی فعلی\n\nروی هر گفتگو بزن تا مثل کتاب ورقش بزنی 📖")
    await h.show(bot, uid, mid, txt, kb(*rows))


def _book_pages(uid, conv):
    rows = db._q("SELECT role, content, model, ts FROM chat_logs WHERE user_id=? AND conv=? ORDER BY id", (uid, conv))
    pages, i = [], 0
    while i < len(rows):
        q = rows[i] if rows[i]["role"] == "user" else None
        a = None
        if q and i + 1 < len(rows) and rows[i + 1]["role"] == "assistant":
            a = rows[i + 1]
            i += 2
        else:
            a = rows[i] if not q else None
            i += 1
        head = f"🕒 {jdate((q or a)['ts'], True)}" + (f" · 🤖 {e((a or q)['model'])}" if (a or q)['model'] else "")
        qt = (q["content"] if q else "").replace("[عکس فرستادم]", "🖼")
        at = a["content"] if a else ""
        body = (f"👤 <b>تو:</b>\n{e(qt[:1500])}{'…' if len(qt) > 1500 else ''}\n\n" if q else "")
        if not at:
            pages.append(f"{head}\n\n{body}")
            continue
        size = 2600
        parts = [at[j:j + size] for j in range(0, len(at), size)] or [""]
        for n, part in enumerate(parts):
            if n == 0:
                pages.append(f"{head}\n\n{body}🤖 <b>ربات:</b>\n{e(part)}")
            else:
                pages.append(f"{head}\n\n🤖 <b>ربات (ادامه {n + 1}/{len(parts)}):</b>\n{e(part)}")
    return pages


async def history_view(bot, uid, mid, conv, page=0):
    pages = _book_pages(uid, conv)
    if not pages:
        return await history_list(bot, uid, mid, 0, "⚠️ این گفتگو پیدا نشد.\n\n")
    n = len(pages)
    page = max(0, min(page, n - 1))
    nav = []
    if page > 0:
        if n > 3:
            nav.append(btn("⏮", f"x:hv:{conv}:0"))
        nav.append(btn("⬅️ قبلی", f"x:hv:{conv}:{page - 1}"))
    nav.append(btn(f"📖 {page + 1}/{n}", "noop"))
    if page < n - 1:
        nav.append(btn("بعدی ➡️", f"x:hv:{conv}:{page + 1}"))
        if n > 3:
            nav.append(btn("⏭", f"x:hv:{conv}:{n - 1}"))
    rows = [nav,
            [btn("▶️ ادامه همین گفتگو", f"x:hc:{conv}", "success"), btn("🗑 حذف", f"x:hd:{conv}", "danger")],
            [btn("🔙 لیست گفتگوها", "x:hl:0"), btn("🏠 منو", "m:home")]]
    txt = f"📚 <b>گفتگو</b> · صفحه {page + 1} از {n}\n━━━━━━━━━━━━━━\n{pages[page]}"
    await h.show(bot, uid, mid, txt, kb(*rows))


async def history_continue(bot, uid, mid, conv):
    rows = db._q("SELECT role, content FROM chat_logs WHERE user_id=? AND conv=? ORDER BY id DESC LIMIT 40", (uid, conv))
    if not rows:
        return await history_list(bot, uid, mid)
    h.HISTORY.pop(uid, None)
    _set_conv(uid, conv)
    h.HISTORY[uid] = [{"role": r["role"], "content": r["content"]} for r in reversed(rows)]
    return await h.open_section(bot, uid, "chat", mid, note="▶️ گفتگوی قبلی بارگذاری شد، ادامه بده.\n\n")


async def history_delete(bot, uid, mid, conv, sure=False):
    if not sure:
        return await h.show(bot, uid, mid, "🗑 مطمئنی این گفتگو برای همیشه حذف بشه؟",
                            kb([btn("✅ آره حذف کن", f"x:hdy:{conv}", "danger"), btn("❌ نه", f"x:hv:{conv}:0")]))
    db._ex("DELETE FROM chat_logs WHERE user_id=? AND conv=?", (uid, conv))
    if _conv(uid) == conv:
        h.HISTORY.pop(uid, None)
        _bump_conv(uid)
    return await history_list(bot, uid, mid, 0, "🗑 گفتگو حذف شد.\n\n")


_prev_account = h.account


async def account(bot, uid, mid):
    """Same profile as before + one button for past chats."""
    def hook(text, markup):
        if markup and isinstance(markup, dict):
            markup["inline_keyboard"].insert(0, [btn("📚 چت‌های قبلی", "x:hl:0", "primary")])
        return text, markup
    return await with_hook(hook, _prev_account, bot, uid, mid)


h.account = account

# ================================================================== ADMIN
_prev_admin_home = h.admin_home


async def admin_home(bot, uid, mid=None, note=""):
    def hook(text, markup):
        n = pending_count()
        if n:
            text += f"\n\n🧾 <b>{n} رسید پرداخت در انتظار تایید</b>"
        if markup and isinstance(markup, dict):
            rows = markup["inline_keyboard"]
            rows.insert(max(0, len(rows) - 1),
                        [btn(f"💎 اشتراک و پرداخت{f' (⏳ {n})' if n else ''}", "ad:xsub", "success")])
        return text, markup
    return await with_hook(hook, _prev_admin_home, bot, uid, mid, note)


h.admin_home = admin_home

SHOW_KEY = set()


async def prov_view(bot, uid, mid, pid, note=""):
    h.clear_state(uid)
    p = db.get_provider(pid)
    if not p:
        return await h.prov_list(bot, uid, mid, "⚠️ پیدا نشد.\n\n")
    kind = "BytePlus ModelArk (چت + Seedream + Seedance)" if p["kind"] == "byteplus" else "OpenAI-compatible"
    n = sum(1 for s in h.SECTIONS for m in db.list_models(s) if m["provider_id"] == pid)
    shown = (uid, pid) in SHOW_KEY
    key_txt = p["api_key"] if shown else h.mask(p["api_key"])
    txt = (f"{note}🔌 <b>{e(p['name'])}</b>\n\n"
           f"📡 نوع: {kind}\n🌐 آدرس: <code>{e(p['base_url'])}</code>\n🔑 کلید: <code>{e(key_txt)}</code>\n"
           f"🤖 مدل‌ها: {n}\n⚡️ وضعیت: {'🟢 فعال' if p['enabled'] else '🔴 غیرفعال'}")
    if shown:
        txt += "\n\n👁 کلید کامل نمایش داده شده (روش بزنی کپی میشه)."
    markup = kb(
        [btn("🧪 تست اتصال", f"ad:pt:{pid}", "primary"), btn("📥 دریافت لیست مدل‌ها", f"ad:pf:{pid}", "success")],
        [btn("🙈 مخفی کردن کلید" if shown else "👁 نمایش کامل کلید", f"ad:xkey:{pid}")],
        [btn("🔑 تغییر کلید", f"ad:pkey:{pid}"), btn("🌐 تغییر آدرس", f"ad:purl:{pid}")],
        [btn("⏯ غیرفعال کن" if p["enabled"] else "⏯ فعال کن", f"ad:ptg:{pid}"),
         btn("🗑 حذف", f"ad:pdel:{pid}", "danger")],
        [btn("🔙 سرویس‌ها", "ad:prov")],
    )
    await h.show(bot, uid, mid, txt, markup)


h.prov_view = prov_view

_prev_prov_list = h.prov_list


async def prov_list(bot, uid, mid, note=""):
    def hook(text, markup):
        if markup and isinstance(markup, dict) and db.list_providers():
            rows = markup["inline_keyboard"]
            rows.insert(max(0, len(rows) - 1), [btn("🔑 نمایش همه API Key ها", "ad:xkeys")])
        return text, markup
    return await with_hook(hook, _prev_prov_list, bot, uid, mid, note)


h.prov_list = prov_list


async def all_keys(bot, uid, mid):
    provs = db.list_providers()
    lines = ["🔑 <b>همه API Key ها</b>\n━━━━━━━━━━━━━━"]
    for p in provs:
        dot = "🟢" if p["enabled"] else "🔴"
        lines.append(f"{dot} <b>{e(p['name'])}</b>\n🌐 <code>{e(p['base_url'])}</code>\n🔑 <code>{h.mask(p['api_key'])}</code>")
    txt = "\n\n".join(lines) if provs else "هیچ سرویسی ثبت نشده."
    if len(txt) > 3900:
        txt = txt[:3900] + "…"
    await h.show(bot, uid, mid, txt, kb([btn("🔙 سرویس‌ها", "ad:prov")]))


# ------------------------------------------------ fetched models: auto folder
def detect_brand(model_id):
    m = {"model_id": model_id, "title": model_id}
    b = x._orig_brand_for_model(m)
    if not b:
        hay = model_id.lower()
        for name, words in x.EXTRA_ALIASES.items():
            if any(w in hay for w in words):
                b = name
                break
    if not b:
        hay = re.sub(r"[\s_\-.]", "", model_id.lower())
        for name, _ in h.all_brands():
            nn = re.sub(r"[\s_\-.]", "", name.lower())
            if len(nn) >= 3 and nn != re.sub(r"\s", "", x.OTHER_BRAND) and nn in hay:
                b = name
                break
    if not b:
        return None
    for i, (name, icon) in enumerate(h.all_brands()):
        if name == b:
            return i
    return None


def _f_state(uid):
    st = h.STATE.get(uid)
    if st and st["s"] == "f_list":
        return st
    return None


async def fetched_pick_section(bot, uid, mid, i):
    st = _f_state(uid)
    if not st:
        return await h.prov_list(bot, uid, mid)
    model_id = st["d"]["view"][i]
    bi = detect_brand(model_id)
    guess = h.guess_section(model_id)
    rows = [[btn(("👉 " if s == guess else "") + h.SECTIONS[s], f"ad:xfs:{i}:{s}", h.SEC_STYLE[s])] for s in h.SECTIONS]
    rows.append([btn("📁 انتخاب دستی پوشه", f"ad:xfm:{i}")])
    rows.append([btn("🔙 برگشت به لیست", f"ad:fp:{st['d'].get('page', 0)}")])
    if bi is not None:
        name, icon = h.all_brands()[bi]
        folder = f"📁 پوشه خودکار: <b>{icon} {e(name)}</b> (از روی اسم مدل)"
    else:
        folder = "📁 پوشه از روی اسم پیدا نشد؛ بعد از انتخاب بخش ازت می‌پرسم."
    await h.show(bot, uid, mid, f"🏷 <code>{e(model_id)}</code>\n\n{folder}\n\n"
                                "🧩 <b>تو کدوم بخش فعال بشه؟</b>", kb(*rows))


async def fetched_add(bot, uid, mid, i, sec, bi):
    st = _f_state(uid)
    if not st:
        return await h.prov_list(bot, uid, mid)
    model_id = st["d"]["view"][i]
    brands = h.all_brands()
    brand, icon = brands[bi] if 0 <= bi < len(brands) else (None, "🤖")
    pid = st["d"]["pid"]
    if db.model_exists(sec, pid, model_id):
        note = f"ℹ️ <code>{e(model_id)}</code> قبلا تو {h.SECTIONS[sec]} بوده.\n\n"
    else:
        db.add_model(sec, pid, model_id, model_id, brand)
        note = f"✅ <code>{e(model_id)}</code> به {h.SECTIONS[sec]} ← 📁 <b>{icon} {e(brand or '-')}</b> اضافه شد.\n\n"
    return await h.show_fetched(bot, uid, mid, note)


async def fetched_section_chosen(bot, uid, mid, i, sec):
    st = _f_state(uid)
    if not st or sec not in h.SECTIONS:
        return await h.prov_list(bot, uid, mid)
    model_id = st["d"]["view"][i]
    bi = detect_brand(model_id)
    if bi is not None:
        return await fetched_add(bot, uid, mid, i, sec, bi)
    rows = []
    row = []
    for j, (brand, icon) in enumerate(h.all_brands()):
        row.append(btn(f"{icon} {brand}", f"ad:fs:{i}:{sec}:{j}", "primary"))
        if len(row) == 2:
            rows.append(row)
            row = []
    if row:
        rows.append(row)
    rows.append([btn("➕ ساخت پوشه جدید با همین اسم", f"ad:xfn:{i}:{sec}", "success")])
    rows.append([btn("🔙 برگشت", f"ad:fa:{i}")])
    await h.show(bot, uid, mid, f"🏷 <code>{e(model_id)}</code>\n🧩 بخش: {h.SECTIONS[sec]}\n\n"
                                "❓ اسم این مدل تو لیست پوشه‌ها نبود.\n📁 <b>تو کدوم پوشه هوش مصنوعی قرار بگیره؟</b>", kb(*rows))


# ------------------------------------------------ models: page test & search
TEST_RES = {}   # model db id -> (ok, secs)


async def _test_one(m, cache):
    t0 = time.time()
    try:
        if m["section"] == "chat":
            await asyncio.wait_for(ai.chat(h.provider_of(m), m["model_id"],
                                           [{"role": "user", "content": "Reply only: OK"}]), 90)
            ok = True
        else:
            pid = m["provider_id"]
            if pid not in cache:
                try:
                    cache[pid] = set(await asyncio.wait_for(ai.list_models(h.provider_of(m)), 60))
                except Exception:
                    cache[pid] = None
            ids = cache[pid]
            ok = None if ids is None else (m["model_id"] in ids)
    except Exception:
        ok = False
    TEST_RES[m["id"]] = (ok, time.time() - t0)


async def test_models(bot, models):
    cache = {}
    sem = asyncio.Semaphore(4)

    async def one(m):
        async with sem:
            await _test_one(m, cache)

    await asyncio.gather(*(one(m) for m in models))


def _res_mark(m):
    r = TEST_RES.get(m["id"])
    if not r:
        return ""
    return {True: "✅ ", False: "❌ ", None: "❔ "}[r[0]]


async def models_sec(bot, uid, mid, sec, note="", page=0):
    h.clear_state(uid)
    if sec not in h.SECTIONS:
        return await h.models_home(bot, uid, mid)
    rows = []
    models = db.list_models(sec)
    per_page = 8
    pages = max(1, (len(models) + per_page - 1) // per_page)
    page = max(0, min(page, pages - 1))
    for m in models[page * per_page:(page + 1) * per_page]:
        icon = "⭐️" if m["is_default"] else ("🟢" if m["enabled"] and m["p_enabled"] else "🔴")
        rows.append([btn(f"{_res_mark(m)}{icon} {m['title']} · {m['p_name']}", f"ad:mv:{m['id']}")])
    nav = []
    if page > 0:
        nav.append(btn("⬅️ قبلی", f"ad:msp:{sec}:{page - 1}"))
    nav.append(btn(f"📄 {page + 1}/{pages}", "ad:noop"))
    if page < pages - 1:
        nav.append(btn("بعدی ➡️", f"ad:msp:{sec}:{page + 1}"))
    rows.append(nav)
    if models:
        rows.append([btn("🧪 تست همین صفحه", f"ad:xmt:{sec}:{page}", "primary"),
                     btn("🔍 جستجو", f"ad:xms:{sec}", "primary")])
    rows.append([btn("➕ افزودن مدل", f"ad:madd:{sec}", "success")])
    rows.append([btn("🔙 مدل‌ها", "ad:models")])
    txt = f"{note}{h.SECTIONS[sec]} <b>· مدل‌ها</b>\n\n⭐️ پیش‌فرض | 🟢 فعال | 🔴 غیرفعال"
    if any(m["id"] in TEST_RES for m in models):
        txt += "\n🧪 ✅ سالم | ❌ خطا | ❔ نامشخص"
    await h.show(bot, uid, mid, txt, kb(*rows))


h.models_sec = models_sec

SEARCH = {}   # admin uid -> (sec, query)


def search_models(sec, q):
    q = q.lower().strip()
    out = []
    for m in db.list_models(sec):
        hay = f"{m['title']} {m['model_id']} {x.brand_for_model(m) or ''} {m['p_name']}".lower()
        if q in hay:
            out.append(m)
    return out


async def search_results(bot, uid, mid, page=0, note=""):
    sec, q = SEARCH.get(uid, (None, None))
    if not sec:
        return await h.models_home(bot, uid, mid)
    res = search_models(sec, q)
    per = 8
    pages = max(1, (len(res) + per - 1) // per)
    page = max(0, min(page, pages - 1))
    rows = []
    for m in res[page * per:(page + 1) * per]:
        icon = "⭐️" if m["is_default"] else ("🟢" if m["enabled"] and m["p_enabled"] else "🔴")
        rows.append([btn(f"{_res_mark(m)}{icon} {m['title']} · {m['p_name']}", f"ad:mv:{m['id']}")])
    if res:
        nav = []
        if page > 0:
            nav.append(btn("⬅️ قبلی", f"ad:xmr:{page - 1}"))
        nav.append(btn(f"📄 {page + 1}/{pages}", "ad:noop"))
        if page < pages - 1:
            nav.append(btn("بعدی ➡️", f"ad:xmr:{page + 1}"))
        rows.append(nav)
        rows.append([btn("🧪 تست همین صفحه", f"ad:xmrt:{page}", "primary")])
    rows.append([btn("🔍 جستجوی دوباره", f"ad:xms:{sec}"), btn("🔙 برگشت", f"ad:ms:{sec}")])
    txt = (f"{note}🔍 <b>نتیجه جستجو</b> برای «{e(q)}» در {h.SECTIONS[sec]}\n\n"
           + (f"📌 {len(res)} مدل پیدا شد." if res else "😕 چیزی پیدا نشد. یه اسم دیگه امتحان کن (مثلا gpt یا deepseek)."))
    await h.show(bot, uid, mid, txt, kb(*rows))


# ------------------------------------------------ admin subscription panel
async def sub_panel(bot, uid, mid=None, note=""):
    h.clear_state(uid)
    now = int(time.time())
    active = db._q1("SELECT COUNT(*) c FROM subscriptions WHERE expires>?", (now,))["c"]
    rev = db._q1("SELECT COALESCE(SUM(amount),0) s, COUNT(*) c FROM payments WHERE status='approved'")
    month = db._q1("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE status='approved' AND decided>?",
                   (now - 30 * 86400,))["s"]
    n = pending_count()
    on = db.get_setting("sub_enabled") == "1"
    prices = "\n".join(f"{icon} {name}: <b>{money(plan_price(p)) if plan_price(p) else 'غیرفعال'}</b>"
                       for p, (name, d, icon) in PLANS.items())
    locks = " | ".join(f"{h.SEC_ICON[s]} {'🔒' if sub_only(s) else '🔓'}" for s in h.SECTIONS)
    txt = (f"{note}💎 <b>اشتراک و پرداخت</b>\n━━━━━━━━━━━━━━\n"
           f"🛒 فروش: {'✅ باز' if on else '🚫 بسته'}\n\n<b>💰 قیمت‌ها</b>\n{prices}\n\n"
           f"💳 کارت: <code>{e(card_fmt(db.get_setting('card_number')) or 'تنظیم نشده')}</code>\n"
           f"👤 صاحب کارت: {e(db.get_setting('card_holder') or '—')}\n🏦 بانک: {e(db.get_setting('card_bank') or '—')}\n\n"
           f"🔐 بخش‌های فقط مشترکین: {locks}\n\n"
           f"📊 مشترک فعال: <b>{active}</b> | ⏳ رسید در انتظار: <b>{n}</b>\n"
           f"💵 درآمد ۳۰ روز: <b>{money(month)}</b> | کل: <b>{money(rev['s'])}</b> ({rev['c']} خرید)")
    markup = kb(
        [btn(f"⏳ رسیدهای در انتظار ({n})", "ad:xpays", "primary")],
        [btn("🥉 قیمت ۱ ماهه", "ad:xse:sub_price_1"), btn("🥈 قیمت ۳ ماهه", "ad:xse:sub_price_3"),
         btn("🥇 قیمت ۱ ساله", "ad:xse:sub_price_12")],
        [btn("💳 شماره کارت", "ad:xse:card_number", "success"), btn("👤 صاحب کارت", "ad:xse:card_holder"),
         btn("🏦 بانک", "ad:xse:card_bank")],
        [btn("📝 متن مزایا", "ad:xse:sub_desc"), btn("🛒 فروش: " + ("روشن" if on else "خاموش"), "ad:xtg:sub_enabled")],
        [btn(f"{h.SEC_ICON[s]} {'🔒 فقط مشترک' if sub_only(s) else '🔓 آزاد'}", f"ad:xtg:sub_only_{s}")
         for s in h.SECTIONS],
        [btn("👥 مشترکین فعال", "ad:xsubs:0"), btn("🎁 اشتراک دستی", "ad:xgr", "success")],
        [btn("📜 تاریخچه پرداخت‌ها", "ad:xph:0")],
        [btn("🔙 پنل مدیریت", "ad:home")],
    )
    await h.show(bot, uid, mid, txt, markup)


PRO_SET_HELP = {
    "sub_price_1": "🥉 قیمت اشتراک <b>یک ماهه</b> رو به تومان بفرست (فقط عدد، مثلا <code>150000</code>).\n۰ = غیرفعال",
    "sub_price_3": "🥈 قیمت اشتراک <b>سه ماهه</b> رو به تومان بفرست (فقط عدد).\n۰ = غیرفعال",
    "sub_price_12": "🥇 قیمت اشتراک <b>یک ساله</b> رو به تومان بفرست (فقط عدد).\n۰ = غیرفعال",
    "card_number": "💳 شماره کارت ۱۶ رقمی رو بفرست.",
    "card_holder": "👤 اسم صاحب کارت رو بفرست.",
    "card_bank": "🏦 اسم بانک رو بفرست (برای خالی کردن <code>-</code>).",
    "sub_desc": "📝 متن مزایای اشتراک رو بفرست (چند خطی هم میشه).",
}
_FA_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


async def pays_list(bot, uid, mid):
    pays = db._q("SELECT * FROM payments WHERE status='pending' ORDER BY id LIMIT 30")
    rows = []
    for p in pays:
        u = db.get_user(p["user_id"]) or {}
        name = (u.get("first_name") or str(p["user_id"]))[:16]
        rows.append([btn(f"🧾 #{p['id']} · {name} · {PLANS.get(p['plan'], ('?',))[0]} · {p['amount']:,}",
                         f"ad:xpay:{p['id']}")])
    rows.append([btn("🔙 اشتراک و پرداخت", "ad:xsub")])
    txt = "⏳ <b>رسیدهای در انتظار</b>\n\n" + ("روی هر رسید بزن تا عکسش رو ببینی و تایید/رد کنی 👇" if pays else "رسیدی در انتظار نیست 👌")
    await h.show(bot, uid, mid, txt, kb(*rows))


async def pays_history(bot, uid, mid, page=0):
    per = 10
    total = db._q1("SELECT COUNT(*) c FROM payments")["c"]
    pages = max(1, (total + per - 1) // per)
    page = max(0, min(page, pages - 1))
    pays = db._q("SELECT * FROM payments ORDER BY id DESC LIMIT ? OFFSET ?", (per, page * per))
    icon = {"pending": "⏳", "approved": "✅", "rejected": "❌"}
    lines = [f"{icon.get(p['status'], '•')} #{p['id']} · <code>{p['user_id']}</code> · {PLANS.get(p['plan'], ('?',))[0]} · "
             f"{p['amount']:,} · {jdate(p['created'])}" for p in pays]
    nav = []
    if page > 0:
        nav.append(btn("⬅️ قبلی", f"ad:xph:{page - 1}"))
    nav.append(btn(f"📄 {page + 1}/{pages}", "ad:noop"))
    if page < pages - 1:
        nav.append(btn("بعدی ➡️", f"ad:xph:{page + 1}"))
    await h.show(bot, uid, mid, "📜 <b>تاریخچه پرداخت‌ها</b>\n\n" + ("\n".join(lines) or "هنوز پرداختی نیست."),
                 kb(nav, [btn("🔙 اشتراک و پرداخت", "ad:xsub")]))


async def subs_list(bot, uid, mid, page=0):
    now = int(time.time())
    per = 10
    total = db._q1("SELECT COUNT(*) c FROM subscriptions WHERE expires>?", (now,))["c"]
    pages = max(1, (total + per - 1) // per)
    page = max(0, min(page, pages - 1))
    subs = db._q("SELECT * FROM subscriptions WHERE expires>? ORDER BY expires LIMIT ? OFFSET ?", (now, per, page * per))
    rows = []
    for s in subs:
        u = db.get_user(s["user_id"]) or {}
        name = (u.get("first_name") or str(s["user_id"]))[:16]
        left = max(1, int((s["expires"] - now + 86399) // 86400))
        rows.append([btn(f"💎 {name} · {left} روز · تا {jdate(s['expires'])}", f"ad:u:{s['user_id']}")])
    nav = []
    if page > 0:
        nav.append(btn("⬅️ قبلی", f"ad:xsubs:{page - 1}"))
    nav.append(btn(f"📄 {page + 1}/{pages}", "ad:noop"))
    if page < pages - 1:
        nav.append(btn("بعدی ➡️", f"ad:xsubs:{page + 1}"))
    rows.append(nav)
    rows.append([btn("🔙 اشتراک و پرداخت", "ad:xsub")])
    await h.show(bot, uid, mid, f"👥 <b>مشترکین فعال</b> ({total})\n\nروی هر کاربر بزن تا پروفایلش باز بشه.", kb(*rows))


_prev_user_card = h.user_card


async def user_card(bot, uid, mid, target, note=""):
    def hook(text, markup):
        if db.get_user(target) and markup and isinstance(markup, dict):
            s = get_sub(target)
            if s and s["expires"] > time.time():
                text += f"\n💎 اشتراک: فعال تا {jdate(s['expires'])} ({days_left(target)} روز)"
            else:
                text += "\n💎 اشتراک: ندارد"
            rows = markup["inline_keyboard"]
            rows.insert(max(0, len(rows) - 1), [btn("🎁 دادن/تمدید اشتراک", f"ad:xgu:{target}", "success"),
                                                btn("✖️ لغو اشتراک", f"ad:xcu:{target}", "danger")])
        return text, markup
    return await with_hook(hook, _prev_user_card, bot, uid, mid, target, note)


h.user_card = user_card

# --------------------------------------------------------- admin dispatch
_prev_admin_cb = h.admin_cb


async def admin_cb(bot, uid, mid, d):
    parts = d.split(":")
    cmd = parts[0]
    try:
        if cmd == "fa" and len(parts) == 2:
            return await fetched_pick_section(bot, uid, mid, int(parts[1]))
        if cmd == "xfm":
            return await _prev_admin_cb(bot, uid, mid, f"fa:{parts[1]}")
        if cmd == "xfs":
            return await fetched_section_chosen(bot, uid, mid, int(parts[1]), parts[2])
        if cmd == "xfn":
            st = _f_state(uid)
            if not st:
                return await h.prov_list(bot, uid, mid)
            model_id = st["d"]["view"][int(parts[1])]
            h.set_state(uid, "x_newbrand", nb_i=int(parts[1]), nb_sec=parts[2])
            suggest = re.split(r"[-_:/ .]", model_id.split("/")[-1])[0][:20] or model_id[:20]
            return await h.show(bot, uid, mid, f"📁 اسم پوشه جدید رو بفرست.\nپیشنهاد: <code>{e(suggest)}</code>",
                                kb([btn("❌ لغو", f"ad:xfs:{parts[1]}:{parts[2]}", "danger")]))
        if cmd == "xkey":
            pid = int(parts[1])
            SHOW_KEY.symmetric_difference_update({(uid, pid)})
            return await prov_view(bot, uid, mid, pid)
        if cmd == "xkeys":
            return await all_keys(bot, uid, mid)
        if cmd == "xmt":
            sec, page = parts[1], int(parts[2])
            models = db.list_models(sec)[page * 8:(page + 1) * 8]
            await h.show(bot, uid, mid, f"🧪 دارم فقط {len(models)} مدلِ همین صفحه رو تست می‌کنم... ⏳")
            await test_models(bot, models)
            ok = sum(1 for m in models if TEST_RES.get(m["id"], (None,))[0] is True)
            return await models_sec(bot, uid, mid, sec, f"🧪 تست صفحه {page + 1} تموم شد: ✅ {ok} از {len(models)}\n\n", page)
        if cmd == "xms":
            h.set_state(uid, "x_msearch", sec=parts[1])
            return await h.show(bot, uid, mid, "🔍 اسم هوش مصنوعی یا مدل رو بفرست.\nمثال: <code>gpt</code> ، <code>deepseek</code> ، <code>gemma</code>",
                                kb([btn("❌ لغو", f"ad:ms:{parts[1]}", "danger")]))
        if cmd == "xmr":
            return await search_results(bot, uid, mid, int(parts[1]))
        if cmd == "xmrt":
            page = int(parts[1])
            sec, q = SEARCH.get(uid, (None, None))
            if not sec:
                return await h.models_home(bot, uid, mid)
            models = search_models(sec, q)[page * 8:(page + 1) * 8]
            await h.show(bot, uid, mid, f"🧪 دارم {len(models)} مدلِ همین صفحه رو تست می‌کنم... ⏳")
            await test_models(bot, models)
            ok = sum(1 for m in models if TEST_RES.get(m["id"], (None,))[0] is True)
            return await search_results(bot, uid, mid, page, f"🧪 تست تموم شد: ✅ {ok} از {len(models)}\n\n")
        if cmd == "xsub":
            return await sub_panel(bot, uid, mid)
        if cmd == "xse":
            key = parts[1]
            if key not in PRO_SET_HELP:
                return await sub_panel(bot, uid, mid)
            h.set_state(uid, "x_set", key=key)
            cur = db.get_setting(key)
            return await h.show(bot, uid, mid, f"{PRO_SET_HELP[key]}\n\n📌 مقدار فعلی:\n<code>{e(cur[:800] or '-')}</code>",
                                kb([btn("❌ لغو", "ad:xsub", "danger")]))
        if cmd == "xtg":
            key = parts[1]
            if key == "sub_enabled" or key.startswith("sub_only_"):
                db.set_setting(key, "0" if db.get_setting(key) == "1" else "1")
            return await sub_panel(bot, uid, mid, "✅ ذخیره شد.\n\n")
        if cmd == "xpays":
            return await pays_list(bot, uid, mid)
        if cmd == "xpay":
            pay = db._q1("SELECT * FROM payments WHERE id=?", (int(parts[1]),))
            if not pay:
                return await pays_list(bot, uid, mid)
            return await send_payment(bot, uid, pay)
        if cmd in ("xpok", "xpno"):
            return await decide_payment(bot, uid, mid, int(parts[1]), cmd == "xpok")
        if cmd == "xprs":
            h.set_state(uid, "x_reason", pay=int(parts[1]))
            return await bot.send(uid, "✏️ دلیل رد رسید رو بنویس تا برای کاربر ارسال بشه:", kb([btn("❌ لغو", "ad:xsub", "danger")]))
        if cmd == "xph":
            return await pays_history(bot, uid, mid, int(parts[1]))
        if cmd == "xsubs":
            return await subs_list(bot, uid, mid, int(parts[1]))
        if cmd == "xgr":
            h.set_state(uid, "x_grant_user")
            return await h.show(bot, uid, mid, "🎁 آیدی عددی یا یوزرنیم کاربر رو بفرست:", kb([btn("❌ لغو", "ad:xsub", "danger")]))
        if cmd == "xgu":
            h.set_state(uid, "x_grant_days", target=int(parts[1]))
            return await h.show(bot, uid, mid, "🎁 چند روز اشتراک اضافه بشه؟ (مثلا <code>30</code>)",
                                kb([btn("🥉 30", f"ad:xgd:{parts[1]}:30"), btn("🥈 90", f"ad:xgd:{parts[1]}:90"),
                                    btn("🥇 365", f"ad:xgd:{parts[1]}:365")],
                                   [btn("❌ لغو", f"ad:u:{parts[1]}", "danger")]))
        if cmd == "xgd":
            return await _grant_and_report(bot, uid, mid, int(parts[1]), int(parts[2]))
        if cmd == "xcu":
            cancel_sub(int(parts[1]))
            return await h.user_card(bot, uid, mid, int(parts[1]), "✖️ اشتراک لغو شد.\n\n")
    except (ValueError, IndexError):
        return await h.admin_home(bot, uid, mid)
    return await _prev_admin_cb(bot, uid, mid, d)


h.admin_cb = admin_cb


async def _grant_and_report(bot, admin, mid, target, days):
    if not db.get_user(target):
        return await bot.send(admin, "⚠️ کاربر پیدا نشد.")
    exp = grant_sub(target, days, "manual")
    try:
        await bot.send(target, f"🎁 <b>{days} روز اشتراک ویژه به حسابت اضافه شد!</b>\n📅 اعتبار تا: <b>{jdate(exp)}</b>",
                       h.main_kb(target))
    except Exception:
        pass
    return await h.user_card(bot, admin, mid, target, f"🎁 {days} روز اشتراک داده شد (تا {jdate(exp)}).\n\n")


_prev_admin_input = h.admin_input


async def admin_input(bot, msg, st):
    s, d = st["s"], st["d"]
    if not s.startswith("x_"):
        return await _prev_admin_input(bot, msg, st)
    uid = msg["chat"]["id"]
    text = (msg.get("text") or "").strip()
    if not text:
        return await bot.send(uid, "✍️ لطفا متن بفرست.", h.CANCEL)
    if s == "x_msearch":
        SEARCH[uid] = (d.get("sec"), text[:60])
        h.clear_state(uid)
        return await search_results(bot, uid, None, 0)
    if s == "x_newbrand":
        name = text[:40]
        db.add_brand(name, "🤖")
        i, sec = d.get("nb_i"), d.get("nb_sec")
        st["s"] = "f_list"
        bi = next((j for j, (n, _) in enumerate(h.all_brands()) if n == name), None)
        if bi is None or i is None:
            return await h.show_fetched(bot, uid, None, "⚠️ ساخت پوشه ناموفق بود.\n\n")
        return await fetched_add(bot, uid, None, i, sec, bi)
    if s == "x_set":
        key = d.get("key")
        val = "" if text == "-" else text
        if key and key.startswith("sub_price_"):
            v = re.sub(r"[,\s٬،]", "", val.translate(_FA_DIGITS))
            if not v.isdigit():
                return await bot.send(uid, "⚠️ فقط عدد بفرست (مثلا 150000).", kb([btn("❌ لغو", "ad:xsub", "danger")]))
            val = str(int(v))
        if key == "card_number":
            v = re.sub(r"\D", "", val.translate(_FA_DIGITS))
            if len(v) != 16:
                return await bot.send(uid, "⚠️ شماره کارت باید ۱۶ رقم باشه.", kb([btn("❌ لغو", "ad:xsub", "danger")]))
            val = v
        db.set_setting(key, val)
        return await sub_panel(bot, uid, None, "✅ ذخیره شد.\n\n")
    if s == "x_reason":
        pay = db._q1("SELECT * FROM payments WHERE id=?", (d.get("pay"),))
        h.clear_state(uid)
        if pay:
            try:
                await bot.send(pay["user_id"], f"📝 <b>دلیل رد رسید #{pay['id']}:</b>\n{e(text[:800])}",
                               kb(buy_row("💎 تلاش دوباره"), h.HOME))
            except Exception:
                pass
        return await sub_panel(bot, uid, None, "📨 دلیل برای کاربر ارسال شد.\n\n")
    if s == "x_grant_user":
        u = db.find_user(text)
        if not u:
            return await bot.send(uid, "⚠️ کاربر پیدا نشد، دوباره بفرست.", kb([btn("❌ لغو", "ad:xsub", "danger")]))
        h.set_state(uid, "x_grant_days", target=u["id"])
        return await bot.send(uid, f"{h.user_line(u)}\n\n🎁 چند روز اشتراک اضافه بشه؟",
                              kb([btn("🥉 30", f"ad:xgd:{u['id']}:30"), btn("🥈 90", f"ad:xgd:{u['id']}:90"),
                                  btn("🥇 365", f"ad:xgd:{u['id']}:365")],
                                 [btn("❌ لغو", "ad:xsub", "danger")]))
    if s == "x_grant_days":
        v = text.translate(_FA_DIGITS)
        if not v.isdigit() or not (0 < int(v) <= 3650):
            return await bot.send(uid, "⚠️ یه عدد بین 1 تا 3650 بفرست.", kb([btn("❌ لغو", "ad:xsub", "danger")]))
        h.clear_state(uid)
        return await _grant_and_report(bot, uid, None, int(d["target"]), int(v))
    h.clear_state(uid)
    return await h.admin_home(bot, uid)


h.admin_input = admin_input

# ------------------------------------------------------- user dispatchers
_prev_on_message = h.on_message


async def on_message(bot, msg):
    chat = msg.get("chat") or {}
    frm = msg.get("from") or {}
    uid = frm.get("id")
    if chat.get("type") == "private" and uid and USTATE.get(uid):
        text = (msg.get("text") or "").strip()
        if text.startswith("/"):
            USTATE.pop(uid, None)
        else:
            u = await h.ensure_user(bot, frm)
            r = h.deny_reason(u)
            if r:
                USTATE.pop(uid, None)
                return await bot.send(uid, r)
            st = USTATE.get(uid) or {}
            if st.get("s") == "receipt":
                return await receive_receipt(bot, msg, st)
    return await _prev_on_message(bot, msg)


h.on_message = on_message

_prev_on_callback = h.on_callback
USER_X = ("x:sub", "x:subp:", "x:subcancel", "x:hl:", "x:hv:", "x:hc:", "x:hd:", "x:hdy:")


async def on_callback(bot, cq):
    data = cq.get("data") or ""
    if not (data == "x:sub" or data.startswith(USER_X)):
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
    p = data.split(":")
    try:
        if data == "x:sub":
            return await sub_home(bot, uid, mid)
        if data.startswith("x:subp:"):
            return await sub_invoice(bot, uid, mid, p[2])
        if data == "x:subcancel":
            USTATE.pop(uid, None)
            return await sub_home(bot, uid, mid, "❎ خرید لغو شد.\n\n")
        if data.startswith("x:hl:"):
            return await history_list(bot, uid, mid, int(p[2]))
        if data.startswith("x:hv:"):
            return await history_view(bot, uid, mid, int(p[2]), int(p[3]))
        if data.startswith("x:hc:"):
            return await history_continue(bot, uid, mid, int(p[2]))
        if data.startswith("x:hdy:"):
            return await history_delete(bot, uid, mid, int(p[2]), True)
        if data.startswith("x:hd:"):
            return await history_delete(bot, uid, mid, int(p[2]))
    except (ValueError, IndexError):
        return


h.on_callback = on_callback

h.HELP = h.HELP + "\n\n💎 با «خرید اشتراک» از همه بخش‌ها بدون محدودیت استفاده کن.\n📚 گفتگوهای قبلیت تو «👤 حساب من» ذخیره میشن."
x.COMMANDS.insert(-1, {"command": "sub", "description": "💎 خرید اشتراک"})

_prev_on_message2 = h.on_message


async def on_message_sub_cmd(bot, msg):
    text = (msg.get("text") or "").strip().split("@", 1)[0].lower()
    frm = msg.get("from") or {}
    uid = frm.get("id")
    if text == "/sub" and uid and (msg.get("chat") or {}).get("type") == "private" \
            and not (h.STATE.get(uid) and h.is_admin(uid)):
        u = await h.ensure_user(bot, frm)
        r = h.deny_reason(u)
        if r:
            return await bot.send(uid, r)
        if not await x.is_member(bot, uid):
            return await x.ask_join(bot, uid)
        return await sub_home(bot, uid)
    return await _prev_on_message2(bot, msg)


h.on_message = on_message_sub_cmd

log.info("pro loaded")
