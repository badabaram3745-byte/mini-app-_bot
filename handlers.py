import asyncio
import base64
import html
import logging
import re
import time
from urllib.parse import urlparse

import httpx

import ai
import db
from config import ADMIN_IDS
from tg import TgError, btn, kb

log = logging.getLogger("bot")

SECTIONS = {"chat": "💬 چت هوش مصنوعی", "image": "🎨 ساخت عکس", "video": "🎬 ساخت ویدیو"}
SEC_ICON = {"chat": "💬", "image": "🎨", "video": "🎬"}
SEC_STYLE = {"chat": "primary", "image": "success", "video": "danger"}

# Friendly names shown in the model picker. They are labels, not fake providers:
# a name becomes usable after the admin connects a matching model/API.
AI_BRANDS = [
    ("Chatgpt", "🤖"),
    ("Claude", "🟠"),
    ("Command", "🟣"),
    ("Gemini", "♊"),
    ("Aya", "🌐"),
    ("ParsiGPT", "🇮🇷"),
    ("DeepSeek", "🐋"),
    ("LLaMA", "🦙"),
    ("NVIDIA", "🟢"),
    ("Ai", "🔵"),
    ("Plugsky", "⚡"),
    ("Qwen3", "🟣"),
    ("Ornith", "🦜"),
    ("Memotron", "🧠"),
    ("Seed", "🌱"),
    ("MiMo", "✨"),
]


def all_brands():
    """Built-in folders plus folders created by the administrator."""
    out = list(AI_BRANDS)
    known = {name for name, _ in out}
    for row in db.list_brands():
        if row["name"] not in known:
            out.append((row["name"], row["icon"]))
    return out

# provider presets: key -> (name, kind, base_url, [(section, model_id, title), ...])
PRESETS = {
    "uno": ("UnoRouter", "openai", "https://api.unorouter.com/v1", [
        ("chat", "gpt-6-luna:free", "⚡️ GPT-6 Luna"),
        ("chat", "deepseek-v4-flash:free", "🐋 DeepSeek V4 Flash"),
        ("chat", "qwen3.6-plus:free", "🟣 Qwen 3.6 Plus"),
        ("chat", "gemma-4-31b-it:free", "🔷 Gemma 4 31B"),
        ("chat", "glm-4.7-flash:free", "🇿 GLM 4.7 Flash"),
        ("chat", "minimax-m2.7:free", "🌊 MiniMax M2.7"),
        ("chat", "nemotron-3-super-120b-a12b:free", "🟩 Nemotron 3 Super 120B"),
        ("chat", "k2-horizon:free", "🌙 K2 Horizon"),
    ]),
    "byteplus": ("BytePlus ModelArk", "byteplus", "https://ark.ap-southeast.bytepluses.com/api/v3", []),
    "openai": ("OpenAI", "openai", "https://api.openai.com/v1", []),
    "openrouter": ("OpenRouter", "openai", "https://openrouter.ai/api/v1", []),
    "gemini": ("Google Gemini", "openai", "https://generativelanguage.googleapis.com/v1beta/openai", []),
    "deepseek": ("DeepSeek", "openai", "https://api.deepseek.com/v1", []),
    "groq": ("Groq", "openai", "https://api.groq.com/openai/v1", []),
    "together": ("Together AI", "openai", "https://api.together.xyz/v1", []),
    "mistral": ("Mistral", "openai", "https://api.mistral.ai/v1", []),
    "xai": ("xAI Grok", "openai", "https://api.x.ai/v1", []),
}

STATE = {}        # uid -> {"s": state, "d": data}   (admin wizards)
MODE = {}         # uid -> active section
HISTORY = {}      # uid -> chat history
BUSY = set()
LAST_PROMPT = {}  # (uid, section) -> prompt


def e(s):
    return html.escape(str(s if s is not None else ""))


def is_admin(uid):
    return uid in ADMIN_IDS


def set_state(uid, s, **d):
    old = STATE.get(uid, {}).get("d", {})
    STATE[uid] = {"s": s, "d": {**old, **d}}


def clear_state(uid):
    STATE.pop(uid, None)


def mask(k):
    return (k[:5] + "••••••" + k[-4:]) if k and len(k) > 12 else "••••"


def guess_section(model_id):
    m = model_id.lower()
    if re.search(r"seedance|video|sora|veo|kling|hailuo|wan2|t2v|i2v", m):
        return "video"
    if re.search(r"seedream|image|dall-e|flux|imagen|sdxl|stable-diffusion|midjourney|t2i", m):
        return "image"
    return "chat"


HOME = [btn("🏠 منوی اصلی", "m:home")]
CANCEL = kb([btn("❌ لغو", "ad:cancel", "danger")])


async def show(bot, chat_id, mid, text, markup=None):
    if mid:
        try:
            return await bot.edit(chat_id, mid, text, markup)
        except TgError:
            pass
    return await bot.send(chat_id, text, markup)


def md_to_html(t):
    parts = re.split(r"```[\w+\-]*\n?(.*?)```", t, flags=re.S)
    out = []
    for i, p in enumerate(parts):
        if i % 2:
            out.append(f"<pre>{html.escape(p.strip())}</pre>")
        else:
            s = html.escape(p)
            s = re.sub(r"`([^`\n]+)`", r"<code>\1</code>", s)
            s = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", s)
            s = re.sub(r"(?m)^#{1,6}\s*(.+)$", r"<b>\1</b>", s)
            out.append(s)
    return "".join(out)


def split_text(t, n=3500):
    chunks = []
    while len(t) > n:
        cut = t.rfind("\n", 0, n)
        if cut < n // 2:
            cut = n
        chunks.append(t[:cut])
        t = t[cut:].lstrip("\n")
    if t:
        chunks.append(t)
    return chunks or [""]


async def send_rich(bot, uid, text, markup=None, edit_mid=None):
    for html_mode in (True, False):
        body = md_to_html(text) if html_mode else text
        try:
            if edit_mid:
                return await bot.edit(uid, edit_mid, body, markup, html=html_mode)
            return await bot.send(uid, body, markup, html=html_mode)
        except TgError:
            continue
    if edit_mid:
        await bot.send(uid, text, markup, html=False)


class KeepAction:
    """keeps 'typing…' / 'uploading…' status alive while a job runs"""
    def __init__(self, bot, uid, action):
        self.bot, self.uid, self.action, self.task = bot, uid, action, None

    async def _loop(self):
        while True:
            await self.bot.action(self.uid, self.action)
            await asyncio.sleep(4.5)

    async def __aenter__(self):
        self.task = asyncio.create_task(self._loop())

    async def __aexit__(self, *a):
        self.task.cancel()


def provider_of(m):
    return {"kind": m["p_kind"], "base_url": m["p_url"], "api_key": m["p_key"]}


def current_model(uid, sec):
    models = db.list_models(sec, enabled_only=True)
    if not models:
        return None
    pref = db.get_pref(uid, sec)
    for m in models:
        if m["id"] == pref:
            return m
    for m in models:
        if m["is_default"]:
            return m
    return models[0]


def brand_for_model(m):
    if m.get("brand"):
        return m["brand"]
    hay = f"{m.get('title', '')} {m.get('model_id', '')}".lower()
    aliases = {
        "Chatgpt": ("chatgpt", "gpt-"),
        "Claude": ("claude",),
        "Command": ("command", "cohere"),
        "Gemini": ("gemini",),
        "Aya": ("aya",),
        "ParsiGPT": ("parsigpt", "parsi"),
        "DeepSeek": ("deepseek",),
        "LLaMA": ("llama", "meta-llama"),
        "NVIDIA": ("nvidia", "nemotron"),
        "Ai": (" ai ", "artificial-intelligence"),
        "Plugsky": ("plugsky",),
        "Qwen3": ("qwen",),
        "Ornith": ("ornith",),
        "Memotron": ("memotron",),
        "Seed": ("seed",),
        "MiMo": ("mimo",),
    }
    for name, words in aliases.items():
        if any(w in hay for w in words):
            return name
    return None


# ======================= users / access =======================
async def ensure_user(bot, frm):
    uid = frm["id"]
    u = db.get_user(uid)
    if not u:
        pending = db.get_setting("approval_required") == "1" and not is_admin(uid)
        db.add_user(uid, frm.get("username"), frm.get("first_name"), "pending" if pending else "active")
        u = db.get_user(uid)
        if pending:
            await notify_admins_pending(bot, u)
    else:
        db.touch_user(uid, frm.get("username"), frm.get("first_name"))
    return u


def deny_reason(u):
    if is_admin(u["id"]):
        return None
    if u["status"] == "banned":
        return "⛔️ دسترسی شما به ربات مسدود شده."
    if u["status"] == "pending":
        return "⏳ درخواست عضویتت برای مدیر فرستاده شد.\nبه محض تایید، خبرت می‌کنم ✅"
    if db.get_setting("maintenance") == "1":
        return "🚧 ربات در حال به‌روزرسانیه، چند دقیقه دیگه دوباره سر بزن 🙏"
    return None


def user_line(u):
    un = f"@{u['username']}" if u.get("username") else "بدون یوزرنیم"
    return f"👤 {e(u.get('first_name'))} | {e(un)} | <code>{u['id']}</code>"


async def notify_admins_pending(bot, u):
    text = "🆕 <b>کاربر جدید منتظر تایید</b>\n\n" + user_line(u)
    markup = kb([btn("✅ تایید", f"ad:uok:{u['id']}", "success"), btn("❌ رد", f"ad:uno:{u['id']}", "danger")])
    for a in ADMIN_IDS:
        try:
            await bot.send(a, text, markup)
        except Exception:
            pass


# ======================= main menu =======================
def main_kb(uid):
    rows = [
        [btn(SECTIONS["chat"], "m:chat", "primary")],
        [btn(SECTIONS["image"], "m:image", "success"), btn(SECTIONS["video"], "m:video", "danger")],
        [btn("👤 حساب من", "m:me"), btn("ℹ️ راهنما", "m:help")],
    ]
    if is_admin(uid):
        rows.append([btn("🛠 پنل مدیریت", "ad:home", "primary")])
    return kb(*rows)


async def show_main(bot, uid, mid=None, name=""):
    MODE.pop(uid, None)
    clear_state(uid)
    text = (f"👋 سلام <b>{e(name)}</b>\n\n" if name else "") + e(db.get_setting("welcome")) + \
        "\n\n👇 یکی از بخش‌ها رو انتخاب کن:"
    await show(bot, uid, mid, text, main_kb(uid))


def section_kb(sec):
    rows = [[btn("🔄 تغییر هوش مصنوعی", f"pick:{sec}", "primary")]]
    if sec == "chat":
        rows.append([btn("🧹 شروع چت جدید", "m:newchat", "danger")])
    rows.append(HOME)
    return kb(*rows)


SEC_HINT = {
    "chat": "✍️ پیامت رو بفرست (می‌تونی عکس هم با کپشن بفرستی تا تحلیلش کنه).",
    "image": "✍️ توضیح عکسی که می‌خوای رو بنویس.\n💡 مثال: <i>یک گربه فضانورد روی ماه، سبک سینمایی، نور طلایی</i>",
    "video": "✍️ توضیح ویدیویی که می‌خوای رو بنویس.\n💡 مثال: <i>دوربین آرام به سمت یک قلعه در مه حرکت می‌کند، سینمایی</i>\n⏱ ساخت ویدیو چند دقیقه طول می‌کشه.",
}


async def open_section(bot, uid, sec, mid=None, note=""):
    clear_state(uid)
    MODE[uid] = sec
    m = current_model(uid, sec)
    if not m:
        txt = f"{SECTIONS[sec]}\n\n⚠️ هنوز هیچ مدلی برای این بخش فعال نشده."
        if is_admin(uid):
            txt += "\n🛠 از پنل مدیریت ← مدل‌ها، یه مدل اضافه کن."
        return await show(bot, uid, mid, txt, section_kb(sec))
    lim = int(db.get_setting(f"limit_{sec}") or 0)
    lim_txt = ""
    if lim and not is_admin(uid):
        lim_txt = f"\n📏 سهمیه امروز: {db.usage_today(uid, sec)}/{lim}"
    txt = (f"{note}<b>{SECTIONS[sec]}</b> فعال شد ✅\n\n🤖 مدل: <b>{e(m['title'])}</b>{lim_txt}\n\n" + SEC_HINT[sec])
    await show(bot, uid, mid, txt, section_kb(sec))


async def pick_model(bot, uid, sec, mid, page=0):
    rows = []
    # Two-column zig-zag layout: compact on phones, with every requested AI
    # always visible even before the admin connects a model.
    brands = all_brands()
    per_page = 8
    pages = max(1, (len(brands) + per_page - 1) // per_page)
    page = max(0, min(page, pages - 1))
    shown = brands[page * per_page:(page + 1) * per_page]
    for i in range(0, len(shown), 2):
        pair = shown[i:i + 2]
        buttons = [btn(f"{icon} {brand}", f"brand:{sec}:{brand}", "primary")
                   for brand, icon in pair]
        rows.append(buttons[::-1] if (i // 2) % 2 else buttons)
    nav = []
    if page > 0:
        nav.append(btn("⬅️ قبلی", f"pickp:{sec}:{page - 1}"))
    nav.append(btn(f"📄 {page + 1}/{pages}", "noop"))
    if page < pages - 1:
        nav.append(btn("بعدی ➡️", f"pickp:{sec}:{page + 1}"))
    rows.append(nav)
    rows.append([btn("🔙 برگشت", f"m:{sec}")])
    await show(bot, uid, mid,
               f"{SEC_ICON[sec]} <b>هوش مصنوعی را انتخاب کن</b>\n\n"
               "روی نام هر هوش مصنوعی بزن تا همه نسخه‌های همان سرویس را ببینی 👇",
               kb(*rows))


async def brand_models(bot, uid, sec, brand, mid):
    return await brand_models_page(bot, uid, sec, brand, mid, 0)


async def brand_models_page(bot, uid, sec, brand, mid, page=0):
    models = [m for m in db.list_models(sec, enabled_only=True)
              if brand_for_model(m) == brand]
    icon = next((i for n, i in all_brands() if n == brand), "🤖")
    rows = []
    cur = current_model(uid, sec)
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
    nav = []
    if page > 0:
        nav.append(btn("⬅️ قبلی", f"brandp:{sec}:{brand}:{page - 1}"))
    nav.append(btn(f"📄 {page + 1}/{pages}", "noop"))
    if page < pages - 1:
        nav.append(btn("بعدی ➡️", f"brandp:{sec}:{brand}:{page + 1}"))
    if nav:
        rows.append(nav)
    rows.append([btn("🔙 برگشت به هوش‌های مصنوعی", f"pick:{sec}")])
    text = f"{icon} <b>{e(brand)}</b>\n\n"
    if models:
        text += "نسخه موردنظرت را انتخاب کن 👇"
    else:
        text += "هنوز نسخه‌ای از این هوش مصنوعی برای این بخش توسط مدیر اضافه نشده."
    await show(bot, uid, mid, text, kb(*rows))


async def account(bot, uid, mid):
    u = db.get_user(uid)
    st = db.user_stats(uid)
    role = "👑 مدیر" if is_admin(uid) else "👤 کاربر"
    txt = (f"<b>👤 حساب من</b>\n\n🆔 آیدی: <code>{uid}</code>\n🎖 نقش: {role}\n"
           f"📅 عضویت: {time.strftime('%Y-%m-%d', time.localtime(u['joined']))}\n\n"
           f"📊 <b>کل استفاده‌ها</b>\n💬 چت: {st.get('chat', 0)}\n🎨 عکس: {st.get('image', 0)}\n🎬 ویدیو: {st.get('video', 0)}")
    lims = []
    for s in SECTIONS:
        lim = int(db.get_setting(f"limit_{s}") or 0)
        if lim and not is_admin(uid):
            lims.append(f"{SEC_ICON[s]} {db.usage_today(uid, s)}/{lim}")
    if lims:
        txt += "\n\n📏 <b>سهمیه امروز</b>\n" + "  ".join(lims)
    await show(bot, uid, mid, txt, kb(HOME))


HELP = ("<b>ℹ️ راهنما</b>\n\n"
        "💬 <b>چت:</b> سوالت رو بپرس، ربات حافظه گفتگو داره. با «🧹 شروع چت جدید» حافظه پاک میشه.\n"
        "🖼 تو بخش چت می‌تونی عکس بفرستی تا مدل تحلیلش کنه (اگه مدل پشتیبانی کنه).\n\n"
        "🎨 <b>ساخت عکس:</b> توضیح عکس رو بنویس، هرچی دقیق‌تر بهتر.\n\n"
        "🎬 <b>ساخت ویدیو:</b> توضیح صحنه رو بنویس و چند دقیقه صبر کن.\n\n"
        "🔄 تو هر بخش می‌تونی مدل رو عوض کنی.\n"
        "⌨️ دستورات: /start منوی اصلی | /cancel لغو")


# ======================= dispatch =======================
async def handle_update(bot, upd):
    try:
        if "message" in upd:
            await on_message(bot, upd["message"])
        elif "callback_query" in upd:
            await on_callback(bot, upd["callback_query"])
    except Exception:
        log.exception("update failed")


async def on_message(bot, msg):
    if (msg.get("chat") or {}).get("type") != "private":
        return
    frm = msg.get("from") or {}
    uid = frm.get("id")
    if not uid:
        return
    u = await ensure_user(bot, frm)
    text = (msg.get("text") or "").strip()

    if text.startswith("/start"):
        r = deny_reason(u)
        return await (bot.send(uid, r) if r else show_main(bot, uid, name=frm.get("first_name", "")))
    if text in ("/admin", "/panel") and is_admin(uid):
        clear_state(uid)
        MODE.pop(uid, None)
        return await admin_home(bot, uid)
    if text == "/cancel":
        clear_state(uid)
        return await bot.send(uid, "❎ لغو شد.", kb(HOME))

    r = deny_reason(u)
    if r:
        return await bot.send(uid, r)
    st = STATE.get(uid)
    if st and is_admin(uid):
        return await admin_input(bot, msg, st)
    sec = MODE.get(uid)
    if sec:
        return await section_input(bot, msg, sec)
    await show_main(bot, uid, name=frm.get("first_name", ""))


async def on_callback(bot, cq):
    uid = cq["from"]["id"]
    data = cq.get("data") or ""
    mid = (cq.get("message") or {}).get("message_id")
    u = await ensure_user(bot, cq["from"])

    if data.startswith("ad:"):
        if not is_admin(uid):
            return await bot.answer(cq["id"], "⛔️ فقط مدیر", True)
        await bot.answer(cq["id"])
        return await admin_cb(bot, uid, mid, data[3:])

    r = deny_reason(u)
    if r:
        return await bot.answer(cq["id"], r, True)
    await bot.answer(cq["id"])

    if data == "m:home":
        return await show_main(bot, uid, mid, cq["from"].get("first_name", ""))
    if data in ("m:chat", "m:image", "m:video"):
        return await pick_model(bot, uid, data[2:], mid, 0)
    if data == "m:me":
        return await account(bot, uid, mid)
    if data == "m:help":
        return await show(bot, uid, mid, HELP, kb(HOME))
    if data == "noop":
        return
    if data == "m:newchat":
        HISTORY.pop(uid, None)
        return await open_section(bot, uid, "chat", mid, note="🧹 حافظه چت پاک شد.\n\n")
    if data.startswith("pick:"):
        return await pick_model(bot, uid, data[5:], mid, 0)
    if data.startswith("pickp:"):
        _, sec, page = data.split(":", 2)
        return await pick_model(bot, uid, sec, mid, int(page))
    if data.startswith("brandp:"):
        _, sec, brand, page = data.split(":", 3)
        return await brand_models_page(bot, uid, sec, brand, mid, int(page))
    if data.startswith("brand:"):
        _, sec, brand = data.split(":", 2)
        return await brand_models(bot, uid, sec, brand, mid)
    if data.startswith("sel:"):
        m = db.get_model(int(data[4:]))
        if m:
            db.set_pref(uid, m["section"], m["id"])
            if m["section"] == "chat":
                HISTORY.pop(uid, None)
            return await open_section(bot, uid, m["section"], mid, note=f"✅ مدل به <b>{e(m['title'])}</b> تغییر کرد.\n\n")
    if data.startswith("rg:"):
        sec = data[3:]
        p = LAST_PROMPT.get((uid, sec))
        if not p:
            return await bot.send(uid, "⚠️ پرامپت قبلی پیدا نشد، دوباره بنویس.")
        MODE[uid] = sec
        return await run_job(bot, uid, sec, p, None)


# ======================= AI jobs =======================
async def section_input(bot, msg, sec):
    uid = msg["chat"]["id"]
    text = (msg.get("text") or msg.get("caption") or "").strip()
    photo = msg.get("photo")
    if sec == "chat" and not text and not photo:
        return await bot.send(uid, "✍️ فقط متن یا عکس بفرست.")
    if sec != "chat" and not text:
        return await bot.send(uid, "✍️ لطفا توضیح متنی بفرست.")
    await run_job(bot, uid, sec, text, photo if sec == "chat" else None)


PLACEHOLDER = {"chat": "🤔 در حال فکر کردن...", "image": "🎨 در حال ساخت عکس... ⏳", "video": "🎬 درخواست ساخت ویدیو ثبت شد... ⏳"}


async def run_job(bot, uid, sec, text, photo):
    if uid in BUSY:
        return await bot.send(uid, "⏳ درخواست قبلیت هنوز در حال انجامه، یکم صبر کن.")
    m = current_model(uid, sec)
    if not m:
        return await bot.send(uid, "⚠️ هنوز مدلی برای این بخش فعال نشده.", kb(HOME))
    lim = int(db.get_setting(f"limit_{sec}") or 0)
    if lim and not is_admin(uid) and db.usage_today(uid, sec) >= lim:
        return await bot.send(uid, f"📏 سهمیه امروزت برای {SECTIONS[sec]} تموم شده ({lim} بار). فردا دوباره امتحان کن 🙏", kb(HOME))
    BUSY.add(uid)
    ph = await bot.send(uid, PLACEHOLDER[sec])
    ph_id = ph["message_id"]
    try:
        if sec == "chat":
            await do_chat(bot, uid, m, text, photo, ph_id)
        elif sec == "image":
            await do_image(bot, uid, m, text, ph_id)
        else:
            await do_video(bot, uid, m, text, ph_id)
        db.log_usage(uid, sec, m["title"], True)
    except ai.AIError as ex:
        db.log_usage(uid, sec, m["title"], False)
        err = str(ex)
        txt = f"❌ <b>خطا از سرویس هوش مصنوعی</b>\n🤖 {e(m['title'])}\n\n<code>{e(err[:600])}</code>"
        if "401" in err or "403" in err:
            txt += "\n\n🔑 احتمالا API Key نامعتبره یا مدل فعال نیست."
        elif "429" in err:
            txt += "\n\n🚦 محدودیت تعداد درخواست، یکم بعد امتحان کن یا مدل رو عوض کن."
        await show(bot, uid, ph_id, txt, kb([btn("🔄 تغییر مدل", f"pick:{sec}", "primary")], HOME))
    except Exception as ex:
        log.exception("job failed")
        db.log_usage(uid, sec, m["title"], False)
        await show(bot, uid, ph_id, f"❌ خطای غیرمنتظره: <code>{e(str(ex)[:300])}</code>", kb(HOME))
    finally:
        BUSY.discard(uid)


async def do_chat(bot, uid, m, text, photo, ph_id):
    hist = HISTORY.setdefault(uid, [])
    n = max(0, int(db.get_setting("history_len") or 12))
    content = text
    if photo:
        raw = await bot.download_file(photo[-1]["file_id"])
        b64 = base64.b64encode(raw).decode()
        content = [{"type": "text", "text": text or "این عکس رو با دقت توضیح بده."},
                   {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}}]
    messages = [{"role": "system", "content": db.get_setting("system_prompt")}]
    messages += hist[-n:] if n else []
    messages.append({"role": "user", "content": content})
    async with KeepAction(bot, uid, "typing"):
        answer = await ai.chat(provider_of(m), m["model_id"], messages)
    hist.append({"role": "user", "content": text if not photo else f"[عکس فرستادم] {text}"})
    hist.append({"role": "assistant", "content": answer})
    del hist[:-40]
    markup = kb([btn("🔄 مدل", "pick:chat"), btn("🧹 چت جدید", "m:newchat", "danger"), btn("🏠 منو", "m:home")])
    chunks = split_text(answer)
    for i, c in enumerate(chunks):
        last = i == len(chunks) - 1
        await send_rich(bot, uid, c, markup if last else None, edit_mid=ph_id if i == 0 else None)


async def _fetch(url):
    async with httpx.AsyncClient(timeout=120, follow_redirects=True) as c:
        r = await c.get(url)
        r.raise_for_status()
        return r.content


async def send_media_safe(bot, uid, kind, media, caption, markup):
    sender = bot.send_photo if kind == "photo" else bot.send_video
    try:
        return await sender(uid, media, caption, markup)
    except TgError:
        if isinstance(media, bytes):
            raise
    try:
        return await sender(uid, await _fetch(media), caption, markup)
    except Exception:
        await bot.send(uid, f"{caption}\n\n🔗 <a href=\"{e(media)}\">دانلود فایل</a>", markup)


async def do_image(bot, uid, m, prompt, ph_id):
    async with KeepAction(bot, uid, "upload_photo"):
        imgs = await ai.image(provider_of(m), m["model_id"], prompt, db.get_setting("image_size"))
        LAST_PROMPT[(uid, "image")] = prompt
        cap = f"🎨 <b>{e(prompt[:300])}</b>\n🤖 {e(m['title'])}"
        markup = kb([btn("🔁 دوباره بساز", "rg:image", "success"), btn("🔄 مدل", "pick:image")], HOME)
        for img in imgs:
            await send_media_safe(bot, uid, "photo", img, cap, markup)
    await bot.delete(uid, ph_id)


async def do_video(bot, uid, m, prompt, ph_id):
    last_edit = [0.0]
    st_fa = {"queued": "در صف ⏳", "running": "در حال ساخت 🎞", "in_progress": "در حال ساخت 🎞",
             "processing": "در حال ساخت 🎞", "succeeded": "تموم شد ✅", "completed": "تموم شد ✅"}

    async def progress(st, secs):
        if time.time() - last_edit[0] < 12:
            return
        last_edit[0] = time.time()
        try:
            await bot.edit(uid, ph_id, f"🎬 <b>در حال ساخت ویدیو...</b>\n\n📊 وضعیت: {st_fa.get(st, e(st))}\n⏱ زمان: {secs} ثانیه\n🤖 {e(m['title'])}")
        except Exception:
            pass

    LAST_PROMPT[(uid, "video")] = prompt
    vid = await ai.video(provider_of(m), m["model_id"], prompt, db.get_setting("video_params"), progress)
    cap = f"🎬 <b>{e(prompt[:300])}</b>\n🤖 {e(m['title'])}"
    markup = kb([btn("🔁 دوباره بساز", "rg:video", "success"), btn("🔄 مدل", "pick:video")], HOME)
    async with KeepAction(bot, uid, "upload_video"):
        await send_media_safe(bot, uid, "video", vid, cap, markup)
    await bot.delete(uid, ph_id)


# ======================= ADMIN PANEL =======================
async def admin_home(bot, uid, mid=None, note=""):
    clear_state(uid)
    MODE.pop(uid, None)
    c = db.count_users()
    s = db.stats()
    provs = db.list_providers()
    n_models = sum(len(db.list_models(x, True)) for x in SECTIONS)
    txt = (f"{note}🛠 <b>پنل مدیریت</b>\n\n"
           f"👥 کاربران: {c['total']} (⏳ {c['pending']} در انتظار)\n"
           f"🔌 سرویس‌ها: {len(provs)} | 🤖 مدل فعال: {n_models}\n"
           f"📊 امروز: 💬 {s['today'].get('chat', 0)} | 🎨 {s['today'].get('image', 0)} | 🎬 {s['today'].get('video', 0)}")
    if db.get_setting("maintenance") == "1":
        txt += "\n\n🚧 <b>حالت تعمیر روشنه</b> (کاربرا نمی‌تونن استفاده کنن)"
    markup = kb(
        [btn("🔌 سرویس‌ها و API Key", "ad:prov", "primary"), btn("🤖 مدل‌ها", "ad:models", "primary")],
        [btn("👥 کاربران", "ad:users", "success"), btn("⚙️ تنظیمات", "ad:set", "success")],
        [btn("📢 پیام همگانی", "ad:bc"), btn("📊 آمار", "ad:stats")],
        HOME,
    )
    await show(bot, uid, mid, txt, markup)


# ---------- providers ----------
async def prov_list(bot, uid, mid, note=""):
    clear_state(uid)
    rows = []
    for p in db.list_providers():
        dot = "🟢" if p["enabled"] else "🔴"
        rows.append([btn(f"{dot} {p['name']} ({p['n_models']} مدل)", f"ad:pv:{p['id']}")])
    rows.append([btn("➕ افزودن سرویس جدید", "ad:padd", "success")])
    rows.append([btn("🔙 پنل مدیریت", "ad:home")])
    txt = f"{note}🔌 <b>سرویس‌ها (Providers)</b>\n\nهر سرویس = یک آدرس API + یک کلید.\nبعد مدل‌هاش رو به بخش‌های چت/عکس/ویدیو اضافه می‌کنی."
    await show(bot, uid, mid, txt, kb(*rows))


async def prov_view(bot, uid, mid, pid, note=""):
    clear_state(uid)
    p = db.get_provider(pid)
    if not p:
        return await prov_list(bot, uid, mid, "⚠️ پیدا نشد.\n\n")
    kind = "BytePlus ModelArk (چت + Seedream + Seedance)" if p["kind"] == "byteplus" else "OpenAI-compatible"
    n = sum(1 for s in SECTIONS for m in db.list_models(s) if m["provider_id"] == pid)
    txt = (f"{note}🔌 <b>{e(p['name'])}</b>\n\n"
           f"📡 نوع: {kind}\n🌐 آدرس: <code>{e(p['base_url'])}</code>\n🔑 کلید: <code>{e(mask(p['api_key']))}</code>\n"
           f"🤖 مدل‌ها: {n}\n⚡️ وضعیت: {'🟢 فعال' if p['enabled'] else '🔴 غیرفعال'}")
    markup = kb(
        [btn("🧪 تست اتصال", f"ad:pt:{pid}", "primary"), btn("📥 دریافت لیست مدل‌ها", f"ad:pf:{pid}", "success")],
        [btn("🔑 تغییر کلید", f"ad:pkey:{pid}"), btn("🌐 تغییر آدرس", f"ad:purl:{pid}")],
        [btn("⏯ غیرفعال کن" if p["enabled"] else "⏯ فعال کن", f"ad:ptg:{pid}"),
         btn("🗑 حذف", f"ad:pdel:{pid}", "danger")],
        [btn("🔙 سرویس‌ها", "ad:prov")],
    )
    await show(bot, uid, mid, txt, markup)


def fetched_kb(d):
    view, page = d["view"], d.get("page", 0)
    per = 8
    pages = max(1, (len(view) + per - 1) // per)
    page = min(page, pages - 1)
    rows = []
    assigned = db.assigned_model_ids(d["pid"])
    for i in range(page * per, min(len(view), (page + 1) * per)):
        mid_ = view[i]
        ok = i in d.get("tested", set())
        bad = i in d.get("failed", set())
        mark = "✅ " if ok else ("❌ " if bad else "")
        folder_mark = "📌 " if mid_ in assigned else ""
        rows.append([btn(f"{folder_mark}{mark}{SEC_ICON[guess_section(mid_)]} {mid_[:50]}", f"ad:fa:{i}")])
        rows.append([btn("🧪 تست مدل" if not ok else "✅ تست موفق", f"ad:ft:{i}",
                         "success" if ok else "primary")])
    nav = []
    if page > 0:
        nav.append(btn("⬅️ قبلی", f"ad:fp:{page - 1}"))
    nav.append(btn(f"📄 {page + 1}/{pages}", "ad:noop"))
    if page < pages - 1:
        nav.append(btn("بعدی ➡️", f"ad:fp:{page + 1}"))
    rows.append(nav)
    rows.append([btn("🧪 تست همین صفحه", "ad:fpage", "primary"),
                 btn("🧪 تست همه مدل‌ها", "ad:fall", "success")])
    rows.append([btn("🔙 برگشت به سرویس", f"ad:pv:{d['pid']}")])
    return kb(*rows)


async def show_fetched(bot, uid, mid, note=""):
    d = STATE[uid]["d"]
    flt = d.get("filter")
    txt = (f"{note}📥 <b>مدل‌های موجود</b> ({len(d['view'])} مورد{' | 🔍 ' + e(flt) if flt else ''})\n\n"
           "روی هر مدل بزن تا به یه بخش اضافه بشه.\n🔍 برای جستجو، اسم مدل رو تایپ کن و بفرست (مثلا <code>free</code> یا <code>seedream</code>).\n\n"
           "📌 داخل پوشه هوش مصنوعی | 💬 چت | 🎨 عکس | 🎬 ویدیو (حدس خودکار)")
    await show(bot, uid, mid, txt, fetched_kb(d))


# ---------- models ----------
async def models_home(bot, uid, mid):
    clear_state(uid)
    rows = [[btn(f"{SECTIONS[s]} ({len(db.list_models(s))})", f"ad:ms:{s}", SEC_STYLE[s])] for s in SECTIONS]
    rows.append([btn("➕ ساخت دکمه هوش مصنوعی", "ad:badd", "success")])
    rows.append([btn("🔙 پنل مدیریت", "ad:home")])
    await show(bot, uid, mid, "🤖 <b>مدیریت مدل‌ها</b>\n\nبخش رو انتخاب کن:", kb(*rows))


async def models_sec(bot, uid, mid, sec, note="", page=0):
    clear_state(uid)
    rows = []
    models = db.list_models(sec)
    per_page = 8
    pages = max(1, (len(models) + per_page - 1) // per_page)
    page = max(0, min(page, pages - 1))
    for m in models[page * per_page:(page + 1) * per_page]:
        icon = "⭐️" if m["is_default"] else ("🟢" if m["enabled"] and m["p_enabled"] else "🔴")
        rows.append([btn(f"{icon} {m['title']} · {m['p_name']}", f"ad:mv:{m['id']}")])
    nav = []
    if page > 0:
        nav.append(btn("⬅️ قبلی", f"ad:msp:{sec}:{page - 1}"))
    nav.append(btn(f"📄 {page + 1}/{pages}", "ad:noop"))
    if page < pages - 1:
        nav.append(btn("بعدی ➡️", f"ad:msp:{sec}:{page + 1}"))
    rows.append(nav)
    rows.append([btn("➕ افزودن مدل", f"ad:madd:{sec}", "success")])
    rows.append([btn("🔙 مدل‌ها", "ad:models")])
    txt = f"{note}{SECTIONS[sec]} <b>· مدل‌ها</b>\n\n⭐️ پیش‌فرض | 🟢 فعال | 🔴 غیرفعال"
    await show(bot, uid, mid, txt, kb(*rows))


async def model_view(bot, uid, mid, model_id, note=""):
    clear_state(uid)
    m = db.get_model(model_id)
    if not m:
        return await models_home(bot, uid, mid)
    txt = (f"{note}🤖 <b>{e(m['title'])}</b>\n\n🧩 بخش: {SECTIONS[m['section']]}\n🔌 سرویس: {e(m['p_name'])}\n"
           f"🏷 Model ID: <code>{e(m['model_id'])}</code>\n⭐️ پیش‌فرض: {'بله' if m['is_default'] else 'خیر'}\n"
           f"⚡️ وضعیت: {'🟢 فعال' if m['enabled'] else '🔴 غیرفعال'}")
    rows = [[btn("⭐️ پیش‌فرض کن", f"ad:mdef:{model_id}", "success"),
             btn("⏯ غیرفعال کن" if m["enabled"] else "⏯ فعال کن", f"ad:mtg:{model_id}")],
            [btn("✏️ تغییر نام", f"ad:mren:{model_id}"), btn("🏷 تغییر Model ID", f"ad:mmid:{model_id}")]]
    rows.append([btn("📁 انتقال به پوشه هوش مصنوعی", f"ad:mf:{model_id}")])
    if m["section"] == "chat":
        rows.append([btn("🧪 تست مدل", f"ad:mtest:{model_id}", "primary")])
    rows.append([btn("🗑 حذف", f"ad:mdel:{model_id}", "danger")])
    rows.append([btn("🔙 برگشت", f"ad:ms:{m['section']}")])
    await show(bot, uid, mid, txt, kb(*rows))


# ---------- users / settings / stats ----------
async def users_home(bot, uid, mid, note=""):
    clear_state(uid)
    c = db.count_users()
    txt = (f"{note}👥 <b>کاربران</b>\n\n📌 کل: {c['total']}\n🟢 فعال: {c['active']}\n⏳ در انتظار: {c['pending']}\n🚫 مسدود: {c['banned']}\n\n"
           f"🔐 تایید دستی: {'روشن ✅' if db.get_setting('approval_required') == '1' else 'خاموش'}")
    markup = kb([btn(f"⏳ در انتظار تایید ({c['pending']})", "ad:upend", "primary")],
                [btn("🔍 جستجوی کاربر", "ad:ufind"), btn(f"🚫 مسدودها ({c['banned']})", "ad:ubanned")],
                [btn("🔙 پنل مدیریت", "ad:home")])
    await show(bot, uid, mid, txt, markup)


async def user_card(bot, uid, mid, target, note=""):
    clear_state(uid)
    u = db.get_user(target)
    if not u:
        return await users_home(bot, uid, mid, "⚠️ کاربر پیدا نشد.\n\n")
    st = db.user_stats(target)
    sfa = {"active": "🟢 فعال", "pending": "⏳ در انتظار", "banned": "🚫 مسدود"}
    txt = (f"{note}{user_line(u)}\n\n⚡️ وضعیت: {sfa.get(u['status'], u['status'])}\n"
           f"📅 عضویت: {time.strftime('%Y-%m-%d', time.localtime(u['joined']))}\n"
           f"📊 💬 {st.get('chat', 0)} | 🎨 {st.get('image', 0)} | 🎬 {st.get('video', 0)}")
    markup = kb([btn("✅ فعال/تایید", f"ad:uok:{target}", "success"), btn("🚫 مسدود", f"ad:uban:{target}", "danger")],
                [btn("🔙 کاربران", "ad:users")])
    await show(bot, uid, mid, txt, markup)


def onoff(k):
    return "✅ روشن" if db.get_setting(k) == "1" else "⬜️ خاموش"


async def settings_home(bot, uid, mid, note=""):
    clear_state(uid)
    lims = " | ".join(f"{SEC_ICON[s]} {db.get_setting('limit_' + s) or 0}" for s in SECTIONS)
    sp = db.get_setting("system_prompt")
    txt = (f"{note}⚙️ <b>تنظیمات</b>\n\n🔐 تایید دستی کاربران: {onoff('approval_required')}\n"
           f"🚧 حالت تعمیر: {onoff('maintenance')}\n📏 سهمیه روزانه (۰=نامحدود): {lims}\n"
           f"🧾 حافظه چت: {db.get_setting('history_len')} پیام\n🖼 سایز عکس: <code>{e(db.get_setting('image_size'))}</code>\n"
           f"🎞 پارامتر ویدیو: <code>{e(db.get_setting('video_params') or '-')}</code>\n\n"
           f"🧠 پرامپت سیستم:\n<i>{e(sp[:300])}{'…' if len(sp) > 300 else ''}</i>")
    markup = kb(
        [btn("🔐 تایید دستی کاربران", "ad:st:approval_required", "primary"), btn("🚧 حالت تعمیر", "ad:st:maintenance", "danger")],
        [btn("🧠 پرامپت سیستم", "ad:se:system_prompt"), btn("👋 پیام خوش‌آمد", "ad:se:welcome")],
        [btn("📏 سهمیه 💬", "ad:se:limit_chat"), btn("📏 سهمیه 🎨", "ad:se:limit_image"), btn("📏 سهمیه 🎬", "ad:se:limit_video")],
        [btn("🧾 حافظه چت", "ad:se:history_len"), btn("🖼 سایز عکس", "ad:se:image_size"), btn("🎞 پارامتر ویدیو", "ad:se:video_params")],
        [btn("🔙 پنل مدیریت", "ad:home")],
    )
    await show(bot, uid, mid, txt, markup)


SET_HELP = {
    "system_prompt": "🧠 پرامپت سیستم جدید رو بفرست (شخصیت و رفتار ربات تو چت).",
    "welcome": "👋 متن خوش‌آمد جدید رو بفرست.",
    "limit_chat": "📏 تعداد مجاز چت روزانه هر کاربر رو بفرست (۰ = نامحدود).",
    "limit_image": "📏 تعداد مجاز ساخت عکس روزانه هر کاربر رو بفرست (۰ = نامحدود).",
    "limit_video": "📏 تعداد مجاز ساخت ویدیو روزانه هر کاربر رو بفرست (۰ = نامحدود).",
    "history_len": "🧾 چند پیام آخر تو حافظه چت بمونه؟ (پیشنهاد: 12)",
    "image_size": "🖼 سایز عکس رو بفرست.\n• <code>auto</code> = خودکار\n• BytePlus: <code>1K</code> / <code>2K</code> / <code>4K</code> یا <code>2048x2048</code>\n• OpenAI: <code>1024x1024</code> / <code>1536x1024</code>",
    "video_params": "🎞 پارامترهای ویدیو BytePlus Seedance رو بفرست.\nمثال: <code>--duration 5 --resolution 720p --ratio 16:9</code>\nبرای خالی کردن: <code>-</code>",
}
NUMERIC = {"limit_chat", "limit_image", "limit_video", "history_len"}


async def stats_view(bot, uid, mid):
    s = db.stats()
    c = db.count_users()
    top = "\n".join(f"  {i + 1}. {e(t['model'])}: {t['c']}" for i, t in enumerate(s["top"])) or "  —"
    txt = (f"📊 <b>آمار</b>\n\n👥 کاربران: {c['total']} | فعال امروز: {s['active_today']}\n\n"
           f"📅 <b>امروز</b>\n💬 چت: {s['today'].get('chat', 0)}\n🎨 عکس: {s['today'].get('image', 0)}\n🎬 ویدیو: {s['today'].get('video', 0)}\n❌ خطاها: {s['fails']}\n\n"
           f"📈 کل درخواست‌های موفق: {s['total']}\n\n🏆 <b>پرکاربردترین مدل‌ها</b>\n{top}")
    await show(bot, uid, mid, txt, kb([btn("🔄 بروزرسانی", "ad:stats"), btn("🔙 پنل مدیریت", "ad:home")]))


async def do_broadcast(bot, admin, from_chat, msg_id):
    ids = db.active_user_ids()
    ok = fail = 0
    for t in ids:
        try:
            await bot.api("copyMessage", chat_id=t, from_chat_id=from_chat, message_id=msg_id)
            ok += 1
        except Exception:
            fail += 1
        await asyncio.sleep(0.05)
    await bot.send(admin, f"📢 ارسال همگانی تموم شد\n✅ موفق: {ok}\n❌ ناموفق: {fail}", kb([btn("🔙 پنل مدیریت", "ad:home")]))


# ---------- admin callbacks ----------
async def admin_cb(bot, uid, mid, d):
    parts = d.split(":")
    cmd = parts[0]
    arg = parts[1] if len(parts) > 1 else None

    if cmd in ("home", "cancel"):
        return await admin_home(bot, uid, mid)
    if cmd == "noop":
        return

    # providers
    if cmd == "prov":
        return await prov_list(bot, uid, mid)
    if cmd == "padd":
        rows, row = [], []
        for k, (name, *_r) in PRESETS.items():
            row.append(btn(("⭐️ " if k in ("uno", "byteplus") else "") + name, f"ad:pp:{k}"))
            if len(row) == 2:
                rows.append(row)
                row = []
        if row:
            rows.append(row)
        rows.append([btn("🛠 سرویس دلخواه (Custom)", "ad:pp:custom", "primary")])
        rows.append([btn("🔙 برگشت", "ad:prov")])
        return await show(bot, uid, mid, "➕ <b>افزودن سرویس</b>\n\nیکی از سرویس‌های آماده رو انتخاب کن یا Custom بزن.\nهر سرویسی که API سازگار با OpenAI داشته باشه با Custom وصل میشه.", kb(*rows))
    if cmd == "pp":
        clear_state(uid)
        if arg == "custom":
            set_state(uid, "p_name")
            return await show(bot, uid, mid, "🏷 اسم سرویس رو بفرست (مثلا: <code>My AI</code>)", CANCEL)
        name, kind, url, _ = PRESETS[arg]
        set_state(uid, "p_key", name=name, kind=kind, url=url, preset=arg)
        extra = ""
        if arg == "byteplus":
            extra = "\n\n📍 کلید رو از کنسول BytePlus ← ModelArk ← API Keys بردار.\n⚠️ مدل‌ها رو هم تو بخش Model activation فعال کن."
        if arg == "uno":
            extra = "\n\n📍 کلید رو از unorouter.com ← Tokens بردار.\n🎁 چندتا مدل رایگان خودکار به بخش چت اضافه میشه."
        return await show(bot, uid, mid, f"🔑 <b>{e(name)}</b>\n\nAPI Key رو بفرست 👇\n(پیامت بلافاصله پاک میشه که امن بمونه 🔒){extra}", CANCEL)
    if cmd == "pk":
        st = STATE.get(uid)
        if not st:
            return await prov_list(bot, uid, mid)
        set_state(uid, "p_key", kind=arg)
        return await show(bot, uid, mid, "🔑 حالا API Key رو بفرست 👇 (پیامت پاک میشه 🔒)", CANCEL)
    if cmd == "pv":
        return await prov_view(bot, uid, mid, int(arg))
    if cmd == "ptg":
        p = db.get_provider(int(arg))
        db.update_provider(int(arg), enabled=0 if p["enabled"] else 1)
        return await prov_view(bot, uid, mid, int(arg))
    if cmd == "pdel":
        p = db.get_provider(int(arg))
        return await show(bot, uid, mid, f"🗑 مطمئنی <b>{e(p['name'])}</b> و همه مدل‌هاش حذف بشن؟",
                          kb([btn("✅ آره حذف کن", f"ad:pdely:{arg}", "danger"), btn("❌ نه", f"ad:pv:{arg}")]))
    if cmd == "pdely":
        db.delete_provider(int(arg))
        return await prov_list(bot, uid, mid, "🗑 حذف شد.\n\n")
    if cmd == "pkey":
        set_state(uid, "pkey_edit", pid=int(arg))
        return await show(bot, uid, mid, "🔑 API Key جدید رو بفرست (پیامت پاک میشه 🔒)", CANCEL)
    if cmd == "purl":
        set_state(uid, "purl_edit", pid=int(arg))
        return await show(bot, uid, mid, "🌐 آدرس جدید (Base URL) رو بفرست.\nمثال: <code>https://api.unorouter.com/v1</code>", CANCEL)
    if cmd == "pt":
        p = db.get_provider(int(arg))
        await show(bot, uid, mid, "🧪 در حال تست اتصال...")
        try:
            ids = await ai.list_models(p)
            note = f"✅ <b>اتصال برقراره!</b> {len(ids)} مدل در دسترسه.\n\n"
        except ai.AIError as ex:
            note = f"❌ <b>تست ناموفق</b>\n<code>{e(str(ex)[:400])}</code>\n\n"
            if "404" in str(ex):
                note += "ℹ️ این سرویس لیست مدل نمیده؛ مدل رو دستی اضافه کن و با «🧪 تست مدل» چک کن.\n\n"
        return await prov_view(bot, uid, mid, int(arg), note)
    if cmd == "pf":
        p = db.get_provider(int(arg))
        await show(bot, uid, mid, "📥 در حال دریافت لیست مدل‌ها...")
        try:
            ids = await ai.list_models(p)
        except ai.AIError as ex:
            return await prov_view(bot, uid, mid, int(arg),
                                   f"❌ لیست مدل دریافت نشد:\n<code>{e(str(ex)[:300])}</code>\n➕ از بخش «🤖 مدل‌ها» دستی اضافه کن.\n\n")
        if not ids:
            return await prov_view(bot, uid, mid, int(arg), "⚠️ لیست خالی بود.\n\n")
        clear_state(uid)
        set_state(uid, "f_list", pid=int(arg), all=ids, view=ids, page=0, filter=None, tested=set())
        return await show_fetched(bot, uid, mid)
    if cmd == "fp":
        if not STATE.get(uid) or STATE[uid]["s"] != "f_list":
            return await prov_list(bot, uid, mid)
        STATE[uid]["d"]["page"] = int(arg)
        return await show_fetched(bot, uid, mid)
    if cmd == "fa":
        st = STATE.get(uid)
        if not st or st["s"] != "f_list":
            return await prov_list(bot, uid, mid)
        model_id = st["d"]["view"][int(arg)]
        rows = [[btn(f"{icon} {brand}", f"ad:fb:{arg}:{i}", "primary")]
                for i, (brand, icon) in enumerate(all_brands())]
        rows.append([btn("🔙 برگشت به لیست", f"ad:fp:{st['d'].get('page', 0)}")])
        return await show(bot, uid, mid, f"🏷 <code>{e(model_id)}</code>\n\n"
                                         "این مدل زیر کدوم دکمه هوش مصنوعی قرار بگیره؟", kb(*rows))
    if cmd == "fb":
        st = STATE.get(uid)
        if not st or st["s"] != "f_list":
            return await prov_list(bot, uid, mid)
        model_id = st["d"]["view"][int(arg)]
        brand_i = int(parts[2])
        rows = [[btn(("👉 " if s == guess_section(model_id) else "") + SECTIONS[s],
                     f"ad:fs:{arg}:{s}:{brand_i}", SEC_STYLE[s])] for s in SECTIONS]
        rows.append([btn("🔙 انتخاب هوش مصنوعی", f"ad:fa:{arg}")])
        return await show(bot, uid, mid, f"🏷 <code>{e(model_id)}</code>\n\n"
                                         f"هوش مصنوعی: <b>{e(all_brands()[brand_i][0])}</b>\n\n"
                                         "مدل در کدوم بخش هم فعال بشه؟", kb(*rows))
    if cmd == "ft":
        st = STATE.get(uid)
        if not st or st["s"] != "f_list":
            return await prov_list(bot, uid, mid)
        i = int(arg)
        model_id = st["d"]["view"][i]
        p = db.get_provider(st["d"]["pid"])
        await show(bot, uid, mid, f"🧪 در حال تست <code>{e(model_id)}</code>...")
        try:
            # Safe smoke test: it checks the model through the provider's
            # OpenAI-compatible chat endpoint and does not generate media.
            await ai.chat(p, model_id, [{"role": "user", "content": "Reply only: OK"}])
            st["d"].setdefault("tested", set()).add(i)
            note = f"✅ <b>مدل سالم است</b>\n<code>{e(model_id)}</code>\n\n"
        except Exception as ex:
            note = f"❌ <b>تست ناموفق</b>\n<code>{e(str(ex)[:300])}</code>\n\n"
            st["d"].setdefault("failed", set()).add(i)
        return await show_fetched(bot, uid, mid, note)
    if cmd == "fpage":
        st = STATE.get(uid)
        if not st or st["s"] != "f_list":
            return await prov_list(bot, uid, mid)
        d = st["d"]
        p = db.get_provider(d["pid"])
        page = d.get("page", 0)
        per = 8
        start = page * per
        page_indices = range(start, min(len(d["view"]), start + per))
        await show(bot, uid, mid, "🧪 دارم مدل‌های همین صفحه رو تست می‌کنم، چند لحظه صبر کن...")
        for i in page_indices:
            model_id = d["view"][i]
            try:
                await ai.chat(p, model_id, [{"role": "user", "content": "Reply only: OK"}])
                d.setdefault("tested", set()).add(i)
                d.setdefault("failed", set()).discard(i)
            except Exception:
                d.setdefault("failed", set()).add(i)
        return await show_fetched(bot, uid, mid, "✅ تست مدل‌های همین صفحه تمام شد.\n\n")
    if cmd == "fall":
        st = STATE.get(uid)
        if not st or st["s"] != "f_list":
            return await prov_list(bot, uid, mid)
        p = db.get_provider(st["d"]["pid"])
        await show(bot, uid, mid, "🧪 دارم همه مدل‌ها رو تست می‌کنم، چند لحظه صبر کن...")
        for i, model_id in enumerate(st["d"]["view"]):
            try:
                await ai.chat(p, model_id, [{"role": "user", "content": "Reply only: OK"}])
                st["d"].setdefault("tested", set()).add(i)
                st["d"].setdefault("failed", set()).discard(i)
            except Exception:
                st["d"].setdefault("failed", set()).add(i)
        return await show_fetched(bot, uid, mid, "✅ تست همه مدل‌ها تمام شد.\n\n")
    if cmd == "fs":
        st = STATE.get(uid)
        if not st or st["s"] != "f_list":
            return await prov_list(bot, uid, mid)
        model_id = st["d"]["view"][int(arg)]
        sec = parts[2]
        brand = all_brands()[int(parts[3])][0] if len(parts) > 3 else guess_section(model_id)
        if db.model_exists(sec, st["d"]["pid"], model_id):
            note = f"ℹ️ <code>{e(model_id)}</code> قبلا تو {SECTIONS[sec]} بوده.\n\n"
        else:
            db.add_model(sec, st["d"]["pid"], model_id, model_id, brand)
            note = f"✅ <code>{e(model_id)}</code> به {SECTIONS[sec]} اضافه شد.\n\n"
        return await show_fetched(bot, uid, mid, note)

    # models
    if cmd == "models":
        return await models_home(bot, uid, mid)
    if cmd == "ms":
        return await models_sec(bot, uid, mid, arg)
    if cmd == "msp":
        return await models_sec(bot, uid, mid, parts[1], page=int(parts[2]))
    if cmd == "badd":
        set_state(uid, "brand_name")
        return await show(bot, uid, mid, "🏷 اسم دکمه هوش مصنوعی جدید رو بفرست.\nمثال: <code>My AI</code>", CANCEL)
    if cmd == "mf":
        m = db.get_model(int(arg))
        if not m:
            return await models_home(bot, uid, mid)
        rows = []
        for i, (brand, icon) in enumerate(all_brands()):
            rows.append([btn(f"{icon} {brand}", f"ad:mfv:{m['id']}:{i}", "primary")])
        rows.append([btn("🔙 برگشت", f"ad:mv:{m['id']}")])
        return await show(bot, uid, mid, "📁 مدل به کدوم پوشه منتقل بشه؟\n\nبا انتقال، از پوشه قبلی حذف میشه.", kb(*rows))
    if cmd == "mfv":
        m = db.get_model(int(arg))
        brand = all_brands()[int(parts[2])][0]
        db.update_model_brand(m["id"], brand)
        return await model_view(bot, uid, mid, m["id"], f"✅ مدل به پوشه <b>{e(brand)}</b> منتقل شد.\n\n")
    if cmd == "madd":
        provs = db.list_providers()
        if not provs:
            return await show(bot, uid, mid, "⚠️ اول باید یه سرویس (API Key) اضافه کنی.",
                              kb([btn("➕ افزودن سرویس", "ad:padd", "success")], [btn("🔙 برگشت", f"ad:ms:{arg}")]))
        rows = [[btn(f"{icon} {brand}", f"ad:mb:{arg}:{i}", SEC_STYLE[arg])]
                for i, (brand, icon) in enumerate(all_brands())]
        rows.append([btn("🔙 برگشت", f"ad:ms:{arg}")])
        return await show(bot, uid, mid,
                          f"{SECTIONS[arg]}\n\nاول اسم هوش مصنوعی را انتخاب کن، بعد سرویس و Model ID را می‌گیریم:",
                          kb(*rows))
    if cmd == "mb":
        sec, brand_i = arg, int(parts[2])
        brand, icon = all_brands()[brand_i]
        rows = [[btn(f"🔌 {p['name']}", f"ad:mp:{sec}:{p['id']}:{brand_i}")] for p in db.list_providers()]
        rows.append([btn("🔙 انتخاب هوش مصنوعی", f"ad:madd:{sec}")])
        return await show(bot, uid, mid, f"{icon} <b>{e(brand)}</b>\n\nمدل از کدوم سرویسه؟", kb(*rows))
    if cmd == "mp":
        sec, pid = arg, int(parts[2])
        brand_i = int(parts[3]) if len(parts) > 3 else None
        brand = all_brands()[brand_i][0] if brand_i is not None else None
        set_state(uid, "m_id", sec=sec, pid=pid, brand=brand)
        ex = {"chat": "deepseek-v4-flash:free", "image": "seedream-4-0-250828", "video": "seedance-1-0-pro-250528"}[sec]
        return await show(bot, uid, mid, f"🏷 <b>Model ID</b> مربوط به {e(brand or 'این مدل')} رو دقیق بفرست.\n"
                                         f"مثال: <code>{ex}</code>\n\n"
                                         "💡 تو BytePlus می‌تونی Endpoint ID (مثل <code>ep-2025...</code>) هم بدی.", CANCEL)
    if cmd == "mv":
        return await model_view(bot, uid, mid, int(arg))
    if cmd == "mdef":
        db.set_default_model(int(arg))
        return await model_view(bot, uid, mid, int(arg), "⭐️ پیش‌فرض شد.\n\n")
    if cmd == "mtg":
        m = db.get_model(int(arg))
        db.update_model(int(arg), enabled=0 if m["enabled"] else 1)
        return await model_view(bot, uid, mid, int(arg))
    if cmd == "mren":
        set_state(uid, "m_ren", id=int(arg))
        return await show(bot, uid, mid, "✏️ اسم نمایشی جدید رو بفرست (ایموجی هم می‌تونی بذاری 😎)", CANCEL)
    if cmd == "mmid":
        set_state(uid, "m_mid", id=int(arg))
        return await show(bot, uid, mid, "🏷 Model ID جدید رو بفرست.", CANCEL)
    if cmd == "mdel":
        m = db.get_model(int(arg))
        db.delete_model(int(arg))
        return await models_sec(bot, uid, mid, m["section"], "🗑 حذف شد.\n\n")
    if cmd == "mtest":
        m = db.get_model(int(arg))
        await show(bot, uid, mid, "🧪 در حال تست مدل...")
        t0 = time.time()
        try:
            r = await ai.chat(provider_of(m), m["model_id"], [{"role": "user", "content": "سلام! خیلی کوتاه خودت رو معرفی کن."}])
            note = f"✅ <b>مدل کار می‌کنه</b> ({time.time() - t0:.1f}s)\n<i>{e(r[:300])}</i>\n\n"
        except ai.AIError as ex:
            note = f"❌ <b>تست ناموفق</b>\n<code>{e(str(ex)[:400])}</code>\n\n"
        return await model_view(bot, uid, mid, int(arg), note)

    # users
    if cmd == "users":
        return await users_home(bot, uid, mid)
    if cmd in ("upend", "ubanned"):
        status = "pending" if cmd == "upend" else "banned"
        rows = []
        for u in db.list_users(status, 25):
            label = (u.get("first_name") or str(u["id"]))[:20]
            if status == "pending":
                rows.append([btn(f"✅ {label}", f"ad:uok:{u['id']}", "success"), btn("❌ رد", f"ad:uno:{u['id']}", "danger")])
            else:
                rows.append([btn(f"🔓 آزاد کردن {label}", f"ad:uok:{u['id']}", "success")])
        rows.append([btn("🔙 کاربران", "ad:users")])
        title = "⏳ <b>در انتظار تایید</b>" if status == "pending" else "🚫 <b>کاربران مسدود</b>"
        return await show(bot, uid, mid, title + ("" if len(rows) > 1 else "\n\nکسی نیست 👌"), kb(*rows))
    if cmd == "ufind":
        set_state(uid, "u_find")
        return await show(bot, uid, mid, "🔍 آیدی عددی یا یوزرنیم کاربر رو بفرست.", CANCEL)
    if cmd == "u":
        return await user_card(bot, uid, mid, int(arg))
    if cmd in ("uok", "uno", "uban"):
        target = int(arg)
        u = db.get_user(target)
        if not u:
            return await users_home(bot, uid, mid, "⚠️ کاربر پیدا نشد.\n\n")
        if cmd == "uok":
            db.set_status(target, "active")
            try:
                await bot.send(target, "🎉 حسابت تایید شد! خوش اومدی ✅", main_kb(target))
            except Exception:
                pass
            note = "✅ کاربر فعال شد.\n\n"
        else:
            db.set_status(target, "banned")
            note = "🚫 کاربر رد/مسدود شد.\n\n"
        return await user_card(bot, uid, mid, target, note)

    # settings
    if cmd == "set":
        return await settings_home(bot, uid, mid)
    if cmd == "st":
        db.set_setting(arg, "0" if db.get_setting(arg) == "1" else "1")
        return await settings_home(bot, uid, mid, "✅ ذخیره شد.\n\n")
    if cmd == "se":
        set_state(uid, "set_val", key=arg)
        cur = db.get_setting(arg)
        return await show(bot, uid, mid, f"{SET_HELP[arg]}\n\n📌 مقدار فعلی:\n<code>{e(cur[:800])}</code>", CANCEL)

    # broadcast / stats
    if cmd == "bc":
        set_state(uid, "bc")
        return await show(bot, uid, mid, f"📢 پیامی که می‌خوای برای همه ({len(db.active_user_ids())} کاربر فعال) بره رو بفرست.\nمتن، عکس، ویدیو، هر چی.", CANCEL)
    if cmd == "bcy":
        st = STATE.get(uid)
        if not st or st["s"] != "bc_confirm":
            return await admin_home(bot, uid, mid)
        clear_state(uid)
        asyncio.create_task(do_broadcast(bot, uid, uid, st["d"]["msg_id"]))
        return await show(bot, uid, mid, "🚀 ارسال همگانی شروع شد... آخرش گزارش می‌دم.")
    if cmd == "stats":
        return await stats_view(bot, uid, mid)
    return await admin_home(bot, uid, mid)


# ---------- admin text input (wizards) ----------
async def admin_input(bot, msg, st):
    uid = msg["chat"]["id"]
    text = (msg.get("text") or "").strip()
    s, d = st["s"], st["d"]

    if s == "bc":
        set_state(uid, "bc_confirm", msg_id=msg["message_id"])
        n = len(db.active_user_ids())
        return await bot.send(uid, f"📢 این پیام برای <b>{n}</b> کاربر ارسال بشه؟",
                              kb([btn("✅ ارسال کن", "ad:bcy", "success"), btn("❌ لغو", "ad:cancel", "danger")]))
    if not text:
        return await bot.send(uid, "✍️ لطفا متن بفرست.", CANCEL)

    if s == "f_list":
        q = text.lower()
        d["filter"] = text
        d["view"] = [x for x in d["all"] if q in x.lower()] or d["all"]
        d["page"] = 0
        note = "" if any(q in x.lower() for x in d["all"]) else "⚠️ چیزی پیدا نشد، کل لیست رو نشون میدم.\n\n"
        if note:
            d["filter"] = None
        return await show_fetched(bot, uid, None, note)

    if s == "p_name":
        set_state(uid, "p_url", name=text[:40])
        return await bot.send(uid, "🌐 Base URL رو بفرست.\nمثال: <code>https://api.example.com/v1</code>", CANCEL)
    if s == "brand_name":
        name = text[:40]
        if not name:
            return await bot.send(uid, "⚠️ اسم خالیه، دوباره بفرست.", CANCEL)
        db.add_brand(name, "🤖")
        clear_state(uid)
        return await models_home(bot, uid, None)
    if s == "p_url":
        parsed = urlparse(text.strip())
        host = (parsed.hostname or "").lower()
        if parsed.scheme not in {"http", "https"} or not host:
            return await bot.send(uid, "⚠️ لینک Base URL معتبر HTTP/HTTPS بفرست؛ مثل https://api.example.com یا https://api.example.com/v1", CANCEL)
        set_state(uid, "p_kind", url=text)
        return await bot.send(uid, "📡 نوع API؟", kb(
            [btn("🔵 OpenAI-compatible (هر Base URL و توکن)", "ad:pk:openai", "primary")],
            [btn("🟣 BytePlus ModelArk", "ad:pk:byteplus")],
            [btn("❌ لغو", "ad:cancel", "danger")]))
    if s == "p_key":
        await bot.delete(uid, msg["message_id"])
        pid = db.add_provider(d["name"], d.get("kind", "openai"), d["url"], text)
        added = 0
        if d.get("preset") in PRESETS:
            for sec, model_id, title in PRESETS[d["preset"]][3]:
                if not db.model_exists(sec, pid, model_id):
                    db.add_model(sec, pid, model_id, title)
                    added += 1
        clear_state(uid)
        note = f"✅ سرویس <b>{e(d['name'])}</b> اضافه شد 🔒 (پیام کلید پاک شد)\n"
        if added:
            note += f"🎁 {added} مدل رایگان به بخش چت اضافه شد.\n"
        note += "\n👇 حالا «🧪 تست اتصال» یا «📥 دریافت لیست مدل‌ها» رو بزن.\n\n"
        return await prov_view(bot, uid, None, pid, note)
    if s == "pkey_edit":
        await bot.delete(uid, msg["message_id"])
        db.update_provider(d["pid"], api_key=text)
        return await prov_view(bot, uid, None, d["pid"], "🔑 کلید عوض شد 🔒\n\n")
    if s == "purl_edit":
        parsed = urlparse(text.strip())
        if parsed.scheme != "https" or not parsed.hostname:
            return await bot.send(uid, "⚠️ فقط Base URL معتبر HTTPS بفرست.", CANCEL)
        db.update_provider(d["pid"], base_url=text.rstrip("/"))
        return await prov_view(bot, uid, None, d["pid"], "🌐 آدرس عوض شد.\n\n")
    if s == "m_id":
        set_state(uid, "m_title", model_id=text)
        brand_icon = next((icon for name, icon in all_brands() if name == d.get("brand")), "🤖")
        default_title = f"{brand_icon} {d.get('brand')}" if d.get("brand") else text
        return await bot.send(uid, f"✏️ اسم نمایشی مدل رو بفرست (پیشنهاد: <code>{e(default_title)}</code>)\n"
                                   f"یا <code>-</code> بفرست تا اسم پیشنهادی ثبت بشه.", CANCEL)
    if s == "m_title":
        title = (f"{next((icon for name, icon in all_brands() if name == d.get('brand')), '🤖')} {d['brand']}"
                  if text == "-" and d.get("brand") else (d["model_id"] if text == "-" else text[:60]))
        mid_ = db.add_model(d["sec"], d["pid"], d["model_id"], title, d.get("brand"))
        return await model_view(bot, uid, None, mid_, "✅ مدل اضافه شد.\n\n")
    if s == "m_ren":
        db.update_model(d["id"], title=text[:60])
        return await model_view(bot, uid, None, d["id"], "✏️ اسم عوض شد.\n\n")
    if s == "m_mid":
        db.update_model(d["id"], model_id=text)
        return await model_view(bot, uid, None, d["id"], "🏷 Model ID عوض شد.\n\n")
    if s == "u_find":
        u = db.find_user(text)
        if not u:
            return await bot.send(uid, "⚠️ پیدا نشد، دوباره بفرست یا لغو کن.", CANCEL)
        return await user_card(bot, uid, None, u["id"])
    if s == "set_val":
        key = d["key"]
        val = "" if text == "-" else text
        if key in NUMERIC and not val.isdigit():
            return await bot.send(uid, "⚠️ فقط عدد بفرست (مثلا 0 یا 10).", CANCEL)
        db.set_setting(key, val)
        return await settings_home(bot, uid, None, "✅ ذخیره شد.\n\n")
    clear_state(uid)
    await admin_home(bot, uid)
