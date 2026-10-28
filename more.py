"""More upgrades for the public (user) side (additive only).

No older file is edited. main.py imports this module LAST and it layers new
behaviour on top of handlers / extras / pro / upgrade by wrapping functions:

  1. 🖼 Image to image and image to video: send a photo (with a caption) in the
     image or video section.
  2. 🎙 Voice messages: speech to text (STT), plus a 🔊 button to hear answers (TTS).
  3. ⚙️ "My settings": image ratio, video ratio and length, answer language and a
     personal persona for the bot, per user.
  4. 🧾 "My payments" history, 🎟 discount codes, 🎁 one-time trial subscription,
     💳 optional online payment (Zarinpal).
  5. 📎 Any file type: zip, pdf, docx, xlsx, pptx, odt, tar, code, csv ... are read.
     The AI can send back files and whole zip archives (<zip> block); .docx
     files the AI writes are delivered as real Word files.
  6. 🧪 Test mode accepts photos; albums (several photos or files) are handled
     together instead of only the first item.
  7. ⏰ Quota messages show when the quota resets.
  8. 👍 / 👎 feedback on answers and 🆘 in-bot support tickets with admin reply.
  9. ⛔️ Cancel button on running requests.
 10. 🧪 Test is limited to once per day by default (admin can still change it).
"""
import asyncio
import base64
import contextvars
import datetime as dt
import io
import logging
import os
import re
import tarfile
import time
import zipfile
from html import unescape

import httpx

import ai
import db
import extras as x
import handlers as h
import pro as p
import tg
import upgrade as up
from tg import TgError, btn, kb

log = logging.getLogger("more")
e = h.e

# ================================================================= storage
with db._lock:
    db._conn.executescript("""
    CREATE TABLE IF NOT EXISTS mx_prefs(user_id INTEGER, key TEXT, value TEXT, PRIMARY KEY(user_id, key));
    CREATE TABLE IF NOT EXISTS mx_feedback(
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, model TEXT, vote INTEGER, ts INTEGER);
    CREATE TABLE IF NOT EXISTS mx_reports(
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, text TEXT, file_id TEXT,
        status TEXT DEFAULT 'open', answer TEXT, ts INTEGER);
    CREATE TABLE IF NOT EXISTS mx_codes(
        code TEXT PRIMARY KEY, percent INTEGER, max_uses INTEGER DEFAULT 0, used INTEGER DEFAULT 0, created INTEGER);
    CREATE TABLE IF NOT EXISTS mx_code_uses(code TEXT, user_id INTEGER, ts INTEGER, PRIMARY KEY(code, user_id));
    CREATE TABLE IF NOT EXISTS mx_trials(user_id INTEGER PRIMARY KEY, ts INTEGER);
    CREATE TABLE IF NOT EXISTS mx_zp(
        authority TEXT PRIMARY KEY, user_id INTEGER, plan TEXT, amount INTEGER, code TEXT,
        status TEXT, ref_id TEXT, created INTEGER);
    """)
    db._conn.commit()

for _k, _v in (("stt_model", ""), ("tts_model", ""), ("tts_voice", "alloy"),
               ("trial_days", "0"), ("zp_merchant", os.getenv("ZARINPAL_MERCHANT", "").strip())):
    db.DEFAULTS.setdefault(_k, _v)

# 🧪 test: once a day by default (one-time migration; admin can change it later in "🧪 تنظیم تست")
if db.get_setting("mx_test_once") != "1":
    db.set_setting("test_limit", "1")
    db.set_setting("mx_test_once", "1")

MAX_TG_FILE = 20 * 1024 * 1024        # Telegram bots can download up to 20 MB
TEXT_BUDGET = 28_000
BIN_PREFIX = "[🗂 "
TEXT_EXT = {
    "txt", "md", "csv", "tsv", "json", "jsonl", "xml", "yml", "yaml", "toml", "ini", "cfg", "conf", "env",
    "log", "py", "js", "ts", "jsx", "tsx", "html", "htm", "css", "scss", "java", "kt", "c", "h", "cpp", "hpp",
    "cs", "go", "rs", "php", "rb", "swift", "sh", "bat", "ps1", "sql", "r", "m", "lua", "dart", "vue",
    "svelte", "srt", "vtt", "tex", "properties", "gradle", "dockerfile", "makefile", "gitignore", "rtf",
}

# ================================================================= context
JOB = contextvars.ContextVar("mx_job_uid", default=None)       # uid of the running AI job
EXTRA_IMGS = contextvars.ContextVar("mx_extra_imgs", default=None)   # extra images for chat/test
REF_IMGS = contextvars.ContextVar("mx_ref_imgs", default=None)       # reference images for image/video
_MYHOOK = contextvars.ContextVar("mx_show_hook", default=None)

MSTATE = x.PDict("mx_state", str, int)      # user/admin text waits of this module
RUNNING = {}                                 # uid -> running job task
STOPPED = set()
LASTREF = {}                                 # (uid, sec) -> file_id of last reference photo
LAST_ANSWER = {}                             # uid -> last chat answer (for 🔊)
DISC = {}                                    # uid -> {"plan", "code", "pct", "amount"}
ALB = {}                                     # media_group_id -> [messages]


# ================================================================= helpers
def upref(uid, key, default=""):
    r = db._q1("SELECT value FROM mx_prefs WHERE user_id=? AND key=?", (uid, key))
    return r["value"] if r else default


def set_upref(uid, key, value):
    if value in (None, ""):
        db._ex("DELETE FROM mx_prefs WHERE user_id=? AND key=?", (uid, key))
    else:
        db._ex("INSERT INTO mx_prefs(user_id,key,value) VALUES(?,?,?) "
               "ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value", (uid, key, str(value)))


def mime_of(raw):
    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "image/webp"
    if raw[:3] == b"GIF":
        return "image/gif"
    return "image/jpeg"


def data_url(raw):
    return f"data:{mime_of(raw)};base64,{base64.b64encode(raw).decode()}"


def reset_in():
    now = dt.datetime.now(x._TZ)
    nxt = (now + dt.timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    secs = int((nxt - now).total_seconds())
    hh, mm = secs // 3600, (secs % 3600) // 60
    return f"{hh} ساعت و {mm} دقیقه" if hh else f"{mm} دقیقه"


def provider_setting(key):
    """'pid|model' setting -> (provider dict, model) or (None, None)."""
    v = db.get_setting(key) or ""
    if "|" not in v:
        return None, None
    pid, model = v.split("|", 1)
    try:
        prov = db.get_provider(int(pid))
    except ValueError:
        return None, None
    if not prov or not model.strip():
        return None, None
    return dict(prov), model.strip()


def _audio_mime(name):
    ext = (name.rsplit(".", 1)[-1] if "." in name else "").lower()
    return {
        "ogg": "audio/ogg", "oga": "audio/ogg", "opus": "audio/ogg",
        "mp3": "audio/mpeg", "m4a": "audio/mp4", "mp4": "audio/mp4",
        "wav": "audio/wav", "webm": "audio/webm",
    }.get(ext, "application/octet-stream")


async def _multipart(prov, path, data, files, raw=False):
    hdr = {"Authorization": f"Bearer {prov['api_key']}"}
    r = None
    try:
        async with httpx.AsyncClient(timeout=ai.TIMEOUT, follow_redirects=True) as c:
            for url in ai._candidate_urls(prov, path):
                r = await c.post(url, headers=hdr, data=data, files=files)
                if r.status_code != 404:
                    break
    except httpx.HTTPError as ex:
        raise ai.AIError(f"خطای اتصال: {type(ex).__name__}")
    if r is None:
        raise ai.AIError("پاسخ خالی از سرویس")
    if r.status_code >= 400:
        raise ai._err(r)
    if raw:
        return r.content
    try:
        return r.json()
    except Exception:
        raise ai.AIError("پاسخ نامعتبر از سرویس")


def _set_flag(params, flag, value):
    params = re.sub(rf"\s*{re.escape(flag)}\s+\S+", "", params or "").strip()
    return f"{params} {flag} {value}".strip()


async def hooked(hk, fn, *a):
    tok = _MYHOOK.set(hk)
    try:
        return await fn(*a)
    finally:
        _MYHOOK.reset(tok)


def insert_before_last(markup, *rows):
    if markup and isinstance(markup, dict):
        k = markup["inline_keyboard"]
        pos = max(0, len(k) - 1)
        for i, r in enumerate(rows):
            k.insert(pos + i, r)
    return markup


def stop_kb():
    return kb([btn("⛔️ لغو درخواست", "mx:stop", "danger")])


# ================================================================= show hook (outermost)
_prev_show = h.show


async def show(bot, chat_id, mid, text, markup=None):
    hk = _MYHOOK.get()
    if hk:
        _MYHOOK.set(None)
        try:
            text, markup = hk(text, markup)
        except Exception:
            log.exception("more hook")
    return await _prev_show(bot, chat_id, mid, text, markup)


h.show = show

# ================================================================= Bot.send / edit patches
PLACEHOLDERS = set(h.PLACEHOLDER.values()) | {"🧪 در حال فکر کردن... ⏳",
                                              "🚦 سرور شلوغه، درخواستت تو صف قرار گرفت... ⏳"}
_orig_send = tg.Bot.send
_orig_edit = tg.Bot.edit


async def _send(self, chat_id, text, markup=None, html=True, **kw):
    if isinstance(text, str):
        if "سهمیه" in text and "تموم شده" in text:
            text += f"\n\n⏰ سهمیه‌ات <b>{reset_in()}</b> دیگه ریست میشه." if html else \
                f"\n\n⏰ سهمیه‌ات {reset_in()} دیگه ریست میشه."
        elif markup is None and text in PLACEHOLDERS and chat_id in RUNNING:
            markup = stop_kb()
    return await _orig_send(self, chat_id, text, markup, html, **kw)


async def _edit(self, chat_id, mid, text, markup=None, html=True):
    if markup is None and isinstance(text, str) and text.startswith("🎬 <b>در حال ساخت ویدیو") \
            and chat_id in RUNNING:
        markup = stop_kb()
    return await _orig_edit(self, chat_id, mid, text, markup, html)


tg.Bot.send = _send
tg.Bot.edit = _edit

# ================================================================= AI layer
LANG_TXT = {"fa": "Always answer in Persian (Farsi).", "en": "Always answer in English.",
            "ar": "Always answer in Arabic.", "tr": "Always answer in Turkish."}
ZIP_HINT = ("If the user wants several files together or asks for a zip/archive, wrap the <file> blocks "
            "inside one block like <zip name=\"name.zip\"> <file name=\"a.txt\">...</file> ... </zip>. "
            "For Word documents use a .docx file name with plain text paragraphs.")

_prev_ai_chat = ai.chat


async def ai_chat(provider, model, messages):
    uid = JOB.get()
    extra = EXTRA_IMGS.get()
    add = []
    if uid:
        per = upref(uid, "persona")
        if per:
            add.append(f"User-defined persona/instructions for you: {per}")
        lang = upref(uid, "lang")
        if lang in LANG_TXT:
            add.append(LANG_TXT[lang])
    if up.FILE_SINK.get() is not None:
        add.append(ZIP_HINT)
    msgs = messages
    if add or extra:
        msgs = [dict(m) for m in messages]
        if add:
            if msgs and msgs[0].get("role") == "system":
                msgs[0]["content"] = f"{msgs[0].get('content') or ''}\n\n" + "\n".join(add)
            else:
                msgs.insert(0, {"role": "system", "content": "\n".join(add)})
        if extra:
            for i in range(len(msgs) - 1, -1, -1):
                if msgs[i].get("role") == "user":
                    c = msgs[i].get("content")
                    parts = list(c) if isinstance(c, list) else [{"type": "text", "text": c or ""}]
                    for raw in extra[:10]:
                        parts.append({"type": "image_url", "image_url": {"url": data_url(raw)}})
                    msgs[i]["content"] = parts
                    break
    ans = await _prev_ai_chat(provider, model, msgs)
    if uid and isinstance(ans, str):
        LAST_ANSWER[uid] = ans
    return ans


ai.chat = ai_chat

# <zip> blocks -> one binary file for upgrade's <file> pipeline
ZIP_RE = re.compile(r'<zip\s+name="([^"\n]{1,120})"\s*>(.*?)</zip>', re.S)
BIN_MARK = "@@MXB64@@"
_inner_chat = up._orig_ai_chat


def _zip_bytes(files):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        used = set()
        for name, body in files:
            n = re.sub(r'[\\:*?"<>|\r\n]+', "_", name).strip(" ./") or "file.txt"
            while n in used:
                n = "_" + n
            used.add(n)
            if body.startswith(BIN_MARK):
                z.writestr(n, base64.b64decode(body[len(BIN_MARK):]))
            elif n.lower().endswith(".docx"):
                z.writestr(n, make_docx(body))
            else:
                z.writestr(n, body.strip("\n"))
    return buf.getvalue()


def _zip_sub(mo):
    name = mo.group(1) if mo.group(1).lower().endswith(".zip") else mo.group(1) + ".zip"
    files = up.FILE_RE.findall(mo.group(2))
    if not files:
        return mo.group(0)
    return f'<file name="{name}">{BIN_MARK}{base64.b64encode(_zip_bytes(files)).decode()}</file>'


async def _chat_zip(provider, model, messages):
    text = await _inner_chat(provider, model, messages)
    if isinstance(text, str) and up.FILE_SINK.get() is not None and "<zip" in text:
        text = ZIP_RE.sub(_zip_sub, text)
    return text


up._orig_ai_chat = _chat_zip

# ---------------------------------------------------------------- image
IMG_SIZES = {
    "byteplus": {"1:1": "2048x2048", "16:9": "2560x1440", "9:16": "1440x2560", "4:3": "2304x1728", "3:4": "1728x2304"},
    "other": {"1:1": "1024x1024", "16:9": "1536x1024", "9:16": "1024x1536", "4:3": "1536x1024", "3:4": "1024x1536"},
}
RUNWAY_RATIO = {"1:1": "1024:1024", "16:9": "1920:1080", "9:16": "1080:1920", "4:3": "1360:768", "3:4": "768:1360"}

_prev_ai_image = ai.image


def _user_size(prov, size):
    uid = JOB.get()
    r = upref(uid, "img_ratio") if uid else ""
    if not r or r == "auto":
        return size
    return IMG_SIZES["byteplus" if prov.get("kind") == "byteplus" else "other"].get(r, size)


async def image_edit(prov, model, prompt, refs, size):
    kind = prov.get("kind")
    urls = [data_url(r) for r in refs[:10]]
    if kind == "byteplus":
        body = {"model": model, "prompt": prompt, "response_format": "url", "watermark": False,
                "size": "2K" if size in ("", "auto", None) else size,
                "image": urls[0] if len(urls) == 1 else urls}
        if len(urls) > 1:
            body["sequential_image_generation"] = "disabled"
        out = ai._collect_images(await ai._request("POST", prov, "/images/generations", body))
        if out:
            return out
        raise ai.AIError("سرویس هیچ عکسی برنگردوند")
    if kind == "runway":
        r = upref(JOB.get(), "img_ratio") if JOB.get() else ""
        j = await ai._request("POST", prov, "/text_to_image", {
            "promptText": f"@ref {prompt}", "ratio": RUNWAY_RATIO.get(r, "1024:1024"), "model": model,
            "referenceImages": [{"uri": urls[0], "tag": "ref"}]})
        return await ai._runway_result(prov, j, "image")
    err = None
    # 1) OpenAI-style /images/edits (multipart)
    try:
        data = {"model": model, "prompt": prompt}
        if size not in ("", "auto", None):
            data["size"] = size
        files = [("image[]" if len(refs) > 1 else "image", (f"img{i}.png", raw, mime_of(raw)))
                 for i, raw in enumerate(refs[:10])]
        out = ai._collect_images(await _multipart(prov, "/images/edits", data, files))
        if out:
            return out
    except Exception as ex:
        err = ex
    # 2) chat-based image models (Gemini / OpenRouter style)
    try:
        content = [{"type": "text", "text": prompt}] + [{"type": "image_url", "image_url": {"url": u}} for u in urls]
        j = await ai._request("POST", prov, "/chat/completions", {
            "model": model, "modalities": ["image", "text"], "messages": [{"role": "user", "content": content}]})
        msg = j["choices"][0]["message"]
        out = []
        for im in msg.get("images") or []:
            u = (im.get("image_url") or {}).get("url") if isinstance(im, dict) else None
            if u:
                out.append(ai._data_url_to_bytes(u))
        if isinstance(msg.get("content"), list):
            for part in msg["content"]:
                if isinstance(part, dict) and part.get("type") == "image_url":
                    out.append(ai._data_url_to_bytes(part["image_url"]["url"]))
        if out:
            return out
    except Exception as ex:
        err = err or ex
    raise ai.AIError(f"این مدل از ساخت عکس با عکس مرجع پشتیبانی نمی‌کنه ({str(err)[:200] if err else '-'})")


async def ai_image(prov, model, prompt, size="auto"):
    size = _user_size(prov, size)
    refs = REF_IMGS.get()
    if refs:
        return await image_edit(prov, model, prompt, refs, size)
    return await _prev_ai_image(prov, model, prompt, size)


ai.image = ai_image

# ---------------------------------------------------------------- video
_prev_ai_video = ai.video


async def _poll_videos(prov, vid, progress, max_wait, start):
    while time.time() - start < max_wait:
        await asyncio.sleep(8)
        s = await ai._request("GET", prov, f"/videos/{vid}")
        st = s.get("status", "")
        if progress:
            await progress(st, int(time.time() - start))
        if st in ("completed", "succeeded"):
            if s.get("url") or s.get("video_url"):
                return s.get("url") or s.get("video_url")
            return await ai._request("GET", prov, f"/videos/{vid}/content", raw=True)
        if st in ("failed", "cancelled", "expired"):
            er = s.get("error") or {}
            raise ai.AIError(f"ساخت ویدیو ناموفق: {er.get('message', st) if isinstance(er, dict) else er}")
    raise ai.AIError("زمان ساخت ویدیو طولانی شد (timeout)")


async def video_from_image(prov, model, prompt, params, ref, progress, max_wait):
    start = time.time()
    kind = prov.get("kind")
    uid = JOB.get()
    ratio = upref(uid, "vid_ratio") if uid else ""
    dur = upref(uid, "vid_dur") if uid else ""
    if kind == "byteplus":
        text = (prompt + " " + params).strip() if params else prompt
        j = await ai._request("POST", prov, "/contents/generations/tasks", {"model": model, "content": [
            {"type": "text", "text": text}, {"type": "image_url", "image_url": {"url": data_url(ref)}}]})
        tid = j.get("id")
        if not tid:
            raise ai.AIError(str(j)[:300])
        while time.time() - start < max_wait:
            await asyncio.sleep(6)
            s = await ai._request("GET", prov, f"/contents/generations/tasks/{tid}")
            st = s.get("status", "")
            if progress:
                await progress(st, int(time.time() - start))
            if st == "succeeded":
                url = (s.get("content") or {}).get("video_url")
                if not url:
                    raise ai.AIError("ویدیو ساخته شد ولی لینکش برنگشت")
                return url
            if st in ("failed", "cancelled", "expired"):
                er = s.get("error") or {}
                raise ai.AIError(f"ساخت ویدیو ناموفق: {er.get('message', st) if isinstance(er, dict) else er}")
        raise ai.AIError("زمان ساخت ویدیو طولانی شد (timeout)")
    if kind == "runway":
        rr = {"9:16": "720:1280", "1:1": "960:960"}.get(ratio, "1280:720")
        j = await ai._request("POST", prov, "/image_to_video", {
            "promptText": prompt, "promptImage": data_url(ref), "ratio": rr,
            "duration": int(dur) if dur.isdigit() else 5, "model": model})
        return await ai._runway_result(prov, j, "video", progress=progress, max_wait=max_wait)
    # OpenAI-compatible /videos with input_reference
    data = {"model": model, "prompt": prompt}
    if dur.isdigit():
        data["seconds"] = dur
    j = await _multipart(prov, "/videos", data, {"input_reference": ("ref.jpg", ref, mime_of(ref))})
    vid = j.get("id")
    if not vid:
        raise ai.AIError(str(j)[:300])
    return await _poll_videos(prov, vid, progress, max_wait, start)


async def ai_video(prov, model, prompt, params="", progress=None, max_wait=900):
    uid = JOB.get()
    if uid and prov.get("kind") == "byteplus":
        r, d = upref(uid, "vid_ratio"), upref(uid, "vid_dur")
        if r and r != "auto":
            params = _set_flag(params, "--ratio", r)
        if d and d != "auto":
            params = _set_flag(params, "--duration", d)
    refs = REF_IMGS.get()
    if refs:
        return await video_from_image(prov, model, prompt, params, refs[0], progress, max_wait)
    return await _prev_ai_video(prov, model, prompt, params, progress, max_wait)


ai.video = ai_video

# ================================================================= jobs (context + cancel)
_prev_run_job = h.run_job


async def run_job(bot, uid, sec, text, photo):
    me = asyncio.current_task()
    own = uid not in h.BUSY
    if own:
        RUNNING[uid] = me
    tok = JOB.set(uid)
    try:
        return await _prev_run_job(bot, uid, sec, text, photo)
    except asyncio.CancelledError:
        if uid in STOPPED:
            STOPPED.discard(uid)
            return
        raise
    finally:
        JOB.reset(tok)
        if own and RUNNING.get(uid) is me:
            RUNNING.pop(uid, None)


h.run_job = run_job

_prev_run_test = up.run_test


async def run_test(bot, uid, text):
    me = asyncio.current_task()
    own = uid not in h.BUSY
    if own:
        RUNNING[uid] = me
    tok = JOB.set(uid)
    try:
        return await _prev_run_test(bot, uid, text)
    except asyncio.CancelledError:
        if uid in STOPPED:
            STOPPED.discard(uid)
            return
        raise
    finally:
        JOB.reset(tok)
        if own and RUNNING.get(uid) is me:
            RUNNING.pop(uid, None)


up.run_test = run_test

# ================================================================= image/video with a photo
SEC_DEFAULT = {"image": "این عکس رو با کیفیت بالاتر، جذاب‌تر و حرفه‌ای‌تر بازسازی کن.",
               "video": "این عکس رو به یک ویدیوی زنده و سینمایی تبدیل کن، با حرکت طبیعی."}
_prev_section_input = h.section_input


async def section_input(bot, msg, sec):
    uid = msg["chat"]["id"]
    photo = msg.get("photo")
    if sec in ("image", "video") and photo:
        text = (msg.get("caption") or msg.get("text") or "").strip() or SEC_DEFAULT[sec]
        fid = photo[-1]["file_id"]
        try:
            raw = await bot.download_file(fid)
        except Exception:
            return await bot.send(uid, "⚠️ نتونستم عکس رو دریافت کنم، دوباره بفرست.")
        LASTREF[(uid, sec)] = fid
        tok = REF_IMGS.set([raw])
        try:
            return await h.run_job(bot, uid, sec, text, None)
        finally:
            REF_IMGS.reset(tok)
    if sec in ("image", "video"):
        LASTREF.pop((uid, sec), None)
    return await _prev_section_input(bot, msg, sec)


h.section_input = section_input

h.SEC_HINT["image"] = h.SEC_HINT["image"] + "\n🖼 می‌تونی یه عکس هم با کپشن بفرستی تا از روش عکس جدید بسازم."
h.SEC_HINT["video"] = h.SEC_HINT["video"] + "\n🖼 یه عکس با کپشن بفرست تا متحرکش کنم (عکس به ویدیو)."

# ================================================================= files: read any type
def _xml_text(xml, para_tag):
    xml = re.sub(rf"</{para_tag}>", "\n", xml)
    xml = re.sub(r"<w:tab/>|<a:tab/>", "\t", xml)
    return unescape(re.sub(r"<[^>]+>", "", xml))


def _docx(z):
    return _xml_text(z.read("word/document.xml").decode("utf-8", "ignore"), "w:p")


def _pptx(z):
    out = []
    names = sorted((n for n in z.namelist() if re.match(r"ppt/slides/slide\d+\.xml$", n)),
                   key=lambda n: int(re.findall(r"\d+", n)[-1]))
    for i, n in enumerate(names, 1):
        out.append(f"--- اسلاید {i} ---\n" + _xml_text(z.read(n).decode("utf-8", "ignore"), "a:p"))
    return "\n".join(out)


def _xlsx(z):
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        xml = z.read("xl/sharedStrings.xml").decode("utf-8", "ignore")
        for si in re.findall(r"<si>(.*?)</si>", xml, re.S):
            shared.append(unescape("".join(re.findall(r"<t[^>]*>(.*?)</t>", si, re.S))))
    out = []
    sheets = sorted(n for n in z.namelist() if re.match(r"xl/worksheets/sheet\d+\.xml$", n))
    for n in sheets:
        out.append(f"--- {n.split('/')[-1]} ---")
        xml = z.read(n).decode("utf-8", "ignore")
        for row in re.findall(r"<row[^>]*>(.*?)</row>", xml, re.S):
            cells = []
            for attrs, inner in re.findall(r"<c([^>]*)>(.*?)</c>", row, re.S):
                v = re.search(r"<v>(.*?)</v>", inner, re.S)
                t = re.search(r"<t[^>]*>(.*?)</t>", inner, re.S)
                val = v.group(1) if v else (t.group(1) if t else "")
                if 't="s"' in attrs and val.isdigit() and int(val) < len(shared):
                    val = shared[int(val)]
                cells.append(unescape(val))
            out.append(" | ".join(cells))
            if sum(len(o) for o in out) > TEXT_BUDGET:
                return "\n".join(out)
    return "\n".join(out)


def _odf(z):
    return _xml_text(z.read("content.xml").decode("utf-8", "ignore"), "text:p")


def _pdf(raw):
    try:
        from pypdf import PdfReader
    except Exception:
        return None
    try:
        r = PdfReader(io.BytesIO(raw))
        out = []
        for i, pg in enumerate(r.pages, 1):
            out.append(f"--- صفحه {i} ---\n{pg.extract_text() or ''}")
            if sum(len(o) for o in out) > TEXT_BUDGET:
                break
        return "\n".join(out)
    except Exception as ex:
        return f"(خواندن PDF ناموفق بود: {ex})"


def _decode(raw):
    if b"\x00" in raw[:8000]:
        return None
    for enc in ("utf-8-sig", "cp1256", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return None


def _size(n):
    return f"{n / 1024 / 1024:.1f} MB" if n >= 1024 * 1024 else f"{max(1, n // 1024)} KB"


def extract(name, raw, depth=0):
    """Return readable text for (almost) any file."""
    ext = name.lower().rsplit(".", 1)[-1] if "." in name else name.lower()
    try:
        if raw[:4] == b"%PDF" or ext == "pdf":
            t = _pdf(raw)
            return t if t is not None else "(PDF هست ولی کتابخونه pypdf نصب نیست. requirements.txt رو چک کن.)"
        if zipfile.is_zipfile(io.BytesIO(raw)):
            z = zipfile.ZipFile(io.BytesIO(raw))
            names = z.namelist()
            if ext == "docx" or "word/document.xml" in names:
                return _docx(z)
            if ext == "pptx" or any(n.startswith("ppt/slides/") for n in names):
                return _pptx(z)
            if ext == "xlsx" or "xl/workbook.xml" in names:
                return _xlsx(z)
            if ext in ("odt", "ods", "odp") and "content.xml" in names:
                return _odf(z)
            return _archive_zip(z, depth)
        if ext in ("tar", "gz", "tgz", "bz2", "xz") or name.lower().endswith((".tar.gz", ".tar.bz2", ".tar.xz")):
            try:
                return _archive_tar(tarfile.open(fileobj=io.BytesIO(raw)), depth)
            except tarfile.TarError:
                pass
        t = _decode(raw)
        if t is not None and (ext in TEXT_EXT or len(t) > 0):
            return t
    except Exception as ex:
        log.warning("extract %s failed: %s", name, ex)
    kind = {"rar": "آرشیو RAR", "7z": "آرشیو 7z", "exe": "برنامه ویندوز", "apk": "برنامه اندروید",
            "mp3": "فایل صوتی", "wav": "فایل صوتی", "mp4": "فایل ویدیویی", "mkv": "فایل ویدیویی",
            "doc": "Word قدیمی", "xls": "Excel قدیمی", "ppt": "PowerPoint قدیمی"}.get(ext, "فایل باینری")
    return (f"{BIN_PREFIX}{kind} «{name}»، حجم {_size(len(raw))}. محتوای این نوع فایل به صورت متن قابل خوندن نیست؛ "
            "فقط مشخصاتش در دسترسه.]")


def _archive_zip(z, depth):
    infos = [i for i in z.infolist() if not i.is_dir()]
    lines = [f"📦 آرشیو zip با {len(infos)} فایل:"]
    for i in infos[:300]:
        lines.append(f"• {i.filename} ({_size(i.file_size)})")
    if len(infos) > 300:
        lines.append(f"... و {len(infos) - 300} فایل دیگه")
    budget = TEXT_BUDGET
    for i in infos:
        if budget <= 0:
            lines.append("\n(بقیه فایل‌ها به خاطر حجم خونده نشدن)")
            break
        if i.file_size > 3 * 1024 * 1024 or (i.flag_bits & 0x1):
            continue
        try:
            data = z.read(i)
        except Exception:
            continue
        t = extract(i.filename, data, depth + 1) if depth < 1 else _decode(data)
        if not t or t.startswith(BIN_PREFIX):
            continue
        t = t[:budget]
        budget -= len(t)
        lines.append(f"\n===== {i.filename} =====\n{t}")
    return "\n".join(lines)


def _archive_tar(tf, depth):
    members = [m for m in tf.getmembers() if m.isfile()]
    lines = [f"📦 آرشیو tar با {len(members)} فایل:"] + [f"• {m.name} ({_size(m.size)})" for m in members[:300]]
    budget = TEXT_BUDGET
    for m in members:
        if budget <= 0 or m.size > 3 * 1024 * 1024:
            continue
        f = tf.extractfile(m)
        if not f:
            continue
        data = f.read()
        t = extract(m.name, data, depth + 1) if depth < 1 else _decode(data)
        if not t or t.startswith(BIN_PREFIX):
            continue
        t = t[:budget]
        budget -= len(t)
        lines.append(f"\n===== {m.name} =====\n{t}")
    return "\n".join(lines)


async def read_doc(bot, doc):
    name = doc.get("file_name") or "file"
    if int(doc.get("file_size") or 0) > MAX_TG_FILE:
        return None, name, "⚠️ تلگرام به ربات اجازه نمیده فایل بزرگ‌تر از ۲۰ مگابایت رو دانلود کنه. یه فایل کوچیک‌تر بفرست."
    try:
        raw = await bot.download_file(doc["file_id"])
    except Exception:
        return None, name, "⚠️ دانلود فایل ناموفق بود، دوباره بفرست."
    txt = await asyncio.to_thread(extract, name, raw)
    return txt or f"[فایل «{name}» خالیه]", name, None


up.read_doc = read_doc
up.MAX_UPLOAD = MAX_TG_FILE

# ================================================================= files: send any type back
def make_docx(text):
    def esc(s):
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    paras = "".join(
        f'<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve">{esc(line)}</w:t></w:r></w:p>'
        for line in text.strip("\n").split("\n"))
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                   '<Default Extension="xml" ContentType="application/xml"/>'
                   '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
        z.writestr("_rels/.rels",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
        z.writestr("word/document.xml",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                   f"<w:body>{paras}</w:body></w:document>")
    return buf.getvalue()


async def send_files(bot, uid, files):
    sent = []
    for name, body in files:
        safe = re.sub(r'[\\/:*?"<>|\r\n]+', "_", name).strip(" .") or "file"
        if "." not in safe:
            safe += ".txt"
        if body.startswith(BIN_MARK):
            try:
                data = base64.b64decode(body[len(BIN_MARK):])
            except Exception:
                data = body.encode("utf-8")
        elif safe.lower().endswith(".docx"):
            data = make_docx(body)
        else:
            data = body.strip("\n").encode("utf-8")
        try:
            await bot.api("sendDocument", files={"document": (safe, data)}, chat_id=uid, caption=f"📎 {safe}")
            sent.append((safe, body))
        except TgError as ex:
            log.warning("send file failed: %s", ex)
            await bot.send(uid, f"⚠️ ارسال فایل «{h.e(safe)}» ناموفق بود.")
    if len(sent) >= 3 and not any(n.lower().endswith(".zip") for n, _ in sent):
        try:
            await bot.api("sendDocument", files={"document": ("all_files.zip", _zip_bytes(sent))},
                          chat_id=uid, caption="📦 همه فایل‌ها یکجا (zip)")
        except TgError:
            pass


up.send_files = send_files

# ================================================================= feedback + 🔊 on answers
_prev_send_rich = h.send_rich


def _is_answer_kb(markup):
    try:
        datas = {b.get("callback_data") for r in markup["inline_keyboard"] for b in r}
    except Exception:
        return False
    return "m:newchat" in datas or "x:tnew" in datas


async def send_rich(bot, uid, text, markup=None, edit_mid=None):
    if markup and _is_answer_kb(markup):
        markup = {"inline_keyboard": [list(r) for r in markup["inline_keyboard"]]}
        markup["inline_keyboard"].insert(0, [btn("👍", "mx:fb:1"), btn("👎", "mx:fb:0"),
                                             btn("🔊 بخونش", "mx:tts")])
    return await _prev_send_rich(bot, uid, text, markup, edit_mid)


h.send_rich = send_rich

# ================================================================= voice (STT / TTS)
async def transcribe(raw, fname):
    """Transcribe through the first configured provider that supports audio."""
    last = None
    for prov, model in voice_candidates("stt"):
        try:
            j = await _multipart(
                prov, "/audio/transcriptions", {"model": model},
                {"file": (fname, raw, _audio_mime(fname))})
            text = (j.get("text") or "").strip() if isinstance(j, dict) else str(j).strip()
            if text:
                return text
        except Exception as ex:
            last = ex
            log.warning("stt provider %s skipped: %s", prov.get("name"), ex)
    if last:
        raise last
    return None


async def speak(text):
    last = None
    for prov, model in voice_candidates("tts"):
        try:
            audio = await ai._request("POST", prov, "/audio/speech", {
                "model": model, "input": text[:4000],
                "voice": db.get_setting("tts_voice") or "alloy",
                "response_format": "opus"}, raw=True)
            if audio:
                return audio
        except Exception as ex:
            last = ex
            log.warning("tts provider %s skipped: %s", prov.get("name"), ex)
    if last:
        raise last
    return None


def voice_candidates(kind):
    """Automatic STT/TTS providers, while keeping old settings compatible."""
    key = "stt_model" if kind == "stt" else "tts_model"
    explicit, explicit_model = provider_setting(key)
    rows = []
    if explicit:
        rows.append((explicit, explicit_model))
    defaults = {
        "stt": {"openai": "whisper-1", "groq": "whisper-large-v3"},
        "tts": {"openai": "tts-1", "openai_compatible": "tts-1"},
    }
    providers = db.list_providers()
    def score(p):
        k = (p.get("kind") or "").lower()
        n = (p.get("name") or "").lower()
        if kind == "stt" and ("groq" in k or "groq" in n):
            return 0
        if "openai" in k or "openai" in n:
            return 1
        return 2
    for p in sorted(providers, key=score):
        if not p.get("enabled") or not p.get("api_key"):
            continue
        if explicit and int(p["id"]) == int(explicit["id"]):
            continue
        k = (p.get("kind") or "").lower()
        model = defaults.get(kind, {}).get(k)
        if not model:
            model = "whisper-1" if kind == "stt" else "tts-1"
        rows.append((dict(p), model))
    return rows


async def voice_message(bot, msg, uid):
    media = msg.get("voice") or msg.get("audio") or msg.get("video_note")
    if not voice_candidates("stt"):
        return await bot.send(uid, "🎙 هیچ سرویس فعالی برای تبدیل ویس به متن پیدا نشد.", kb(h.HOME))
    if int(media.get("file_size") or 0) > MAX_TG_FILE:
        return await bot.send(uid, "⚠️ فایل صوتی از ۲۰ مگابایت بزرگ‌تره.")
    ph = await bot.send(uid, "🎙 دارم ویست رو گوش میدم... ⏳")
    try:
        raw = await bot.download_file(media["file_id"])
        fname = media.get("file_name") or ("voice.ogg" if msg.get("voice") else
                                           "note.mp4" if msg.get("video_note") else "audio.mp3")
        text = await transcribe(raw, fname)
    except Exception as ex:
        log.warning("stt failed: %s", ex)
        err = f"\n<code>{h.e(str(ex)[:300])}</code>" if h.is_admin(uid) else ""
        return await h.show(bot, uid, ph["message_id"], "❌ نتونستم ویس رو به متن تبدیل کنم." + err, kb(h.HOME))
    if not text:
        return await h.show(bot, uid, ph["message_id"], "🤔 چیزی تو ویس نشنیدم، دوباره بفرست.", kb(h.HOME))
    await h.show(bot, uid, ph["message_id"], f"🎙 <b>متن ویس:</b>\n<i>{h.e(text[:3500])}</i>")
    if h.MODE.get(uid) not in ("chat", "image", "video", "test"):
        h.MODE[uid] = "chat"
    fake = {k: v for k, v in msg.items() if k not in ("voice", "audio", "video_note", "caption")}
    fake["text"] = text
    return await h.on_message(bot, fake)


# ================================================================= albums
async def album_add(bot, msg, uid):
    gid = msg["media_group_id"]
    if gid in ALB:
        ALB[gid].append(msg)
        return
    ALB[gid] = [msg]
    await asyncio.sleep(1.8)
    msgs = ALB.pop(gid, [msg])
    await album_flush(bot, uid, msgs)


async def album_flush(bot, uid, msgs):
    frm = msgs[0].get("from") or {}
    if not await up.precheck(bot, frm):
        return
    caption = next(((m.get("caption") or "").strip() for m in msgs if (m.get("caption") or "").strip()), "")
    photo_ids, docs = [], []
    for m in msgs:
        if m.get("photo"):
            photo_ids.append(m["photo"][-1]["file_id"])
        elif m.get("document"):
            d = m["document"]
            if str(d.get("mime_type", "")).startswith("image/") and int(d.get("file_size") or 0) <= 10 * 1024 * 1024:
                photo_ids.append(d["file_id"])
            else:
                docs.append(d)
    images = []
    for fid in photo_ids[:10]:
        try:
            images.append(await bot.download_file(fid))
        except Exception:
            pass
    mode = h.MODE.get(uid)
    if mode in ("image", "video") and images and not docs:
        LASTREF.pop((uid, mode), None)
        tok = REF_IMGS.set(images)
        try:
            return await h.run_job(bot, uid, mode, caption or SEC_DEFAULT[mode], None)
        finally:
            REF_IMGS.reset(tok)
    body = caption
    if docs:
        parts, budget = [], up.MAX_DOC_CHARS
        for d in docs:
            txt, name, err = await read_doc(bot, d)
            if err:
                parts.append(f"📎 فایل «{name}»: {err}")
                continue
            t = (txt or "")[:max(1000, budget)].replace("```", "'''")
            budget -= len(t)
            parts.append(f"📎 فایل «{name}»:\n```\n{t}\n```")
        body = (caption or "این فایل‌ها رو بررسی کن و خلاصه‌شون رو بگو.") + "\n\n" + "\n\n".join(parts)
    tok = EXTRA_IMGS.set(images or None)
    try:
        if mode == "test":
            return await up.run_test(bot, uid, body or "این عکس‌ها رو با دقت توضیح بده.")
        if mode != "chat":
            h.MODE[uid] = "chat"
        return await h.run_job(bot, uid, "chat", body or "این عکس‌ها رو با دقت توضیح بده.", None)
    finally:
        EXTRA_IMGS.reset(tok)


# ================================================================= user screens
IMG_R = ["auto", "1:1", "16:9", "9:16", "4:3", "3:4"]
VID_R = ["auto", "16:9", "9:16", "1:1"]
VID_D = ["auto", "5", "10"]
LANGS = {"auto": "🌐 خودکار", "fa": "🇮🇷 فارسی", "en": "🇬🇧 English", "ar": "🇸🇦 العربية", "tr": "🇹🇷 Türkçe"}
CYCLE = {"img_ratio": IMG_R, "vid_ratio": VID_R, "vid_dur": VID_D, "lang": list(LANGS)}


def _lbl(v):
    return "خودکار" if v in ("", "auto") else v


async def settings_view(bot, uid, mid=None, note=""):
    ir, vr = upref(uid, "img_ratio", "auto"), upref(uid, "vid_ratio", "auto")
    vd, lang = upref(uid, "vid_dur", "auto"), upref(uid, "lang", "auto")
    per = upref(uid, "persona")
    txt = (f"{note}⚙️ <b>تنظیمات من</b>\n━━━━━━━━━━━━━━\n"
           f"🖼 نسبت عکس: <b>{_lbl(ir)}</b>\n🎬 نسبت ویدیو: <b>{_lbl(vr)}</b>\n"
           f"⏱ مدت ویدیو: <b>{_lbl(vd)}{'' if vd in ('', 'auto') else ' ثانیه'}</b>\n"
           f"🌐 زبان جواب‌ها: <b>{LANGS.get(lang, LANGS['auto'])}</b>\n"
           f"🎭 شخصیت ربات: {('<i>' + h.e(per[:200]) + '</i>') if per else 'پیش‌فرض'}\n\n"
           "👇 روی هر دکمه بزن تا عوض بشه. (بعضی مدل‌ها همه نسبت‌ها رو پشتیبانی نمی‌کنن)")
    rows = [
        [btn(f"🖼 نسبت عکس: {_lbl(ir)}", "mx:cy:img_ratio", "primary")],
        [btn(f"🎬 نسبت ویدیو: {_lbl(vr)}", "mx:cy:vid_ratio", "primary"),
         btn(f"⏱ مدت: {_lbl(vd)}", "mx:cy:vid_dur", "primary")],
        [btn(f"🌐 زبان: {LANGS.get(lang, LANGS['auto'])}", "mx:cy:lang", "success")],
        [btn("🎭 تنظیم شخصیت ربات", "mx:per", "success")] +
        ([btn("🗑 حذف شخصیت", "mx:perx", "danger")] if per else []),
        h.HOME,
    ]
    await h.show(bot, uid, mid, txt, kb(*rows))


PST = {"pending": "⏳ در انتظار بررسی", "approved": "✅ تایید شد", "rejected": "❌ رد شد"}


async def payments_view(bot, uid, mid=None):
    rows = db._q("SELECT * FROM payments WHERE user_id=? ORDER BY id DESC LIMIT 15", (uid,))
    txt = "🧾 <b>پرداخت‌های من</b>\n━━━━━━━━━━━━━━\n"
    if not rows:
        txt += "📭 هنوز پرداختی ثبت نکردی."
    for r in rows:
        name = p.PLANS.get(r["plan"], ("?", 0, "💎"))[0]
        how = {"zarinpal": "💳 آنلاین", "trial": "🎁 آزمایشی", "code": "🎟 کد"}.get(r.get("kind"), "🧾 کارت به کارت")
        txt += (f"\n<b>#{r['id']}</b> · {name} · {p.money(r['amount'])}\n"
                f"   {PST.get(r['status'], r['status'])} · {how} · {p.jdate(r['created'], True)}\n")
    s = p.get_sub(uid)
    if s and s["expires"] > time.time():
        txt += f"\n💎 اشتراک فعال تا <b>{p.jdate(s['expires'])}</b> ({p.days_left(uid)} روز)"
    await h.show(bot, uid, mid, txt, kb([btn("💎 اشتراک", "x:sub", "success")], h.HOME))


def trial_ok(uid):
    raw = str(db.get_setting("trial_days") or "0").strip()
    days = int(raw) if raw.isdigit() else 0
    if days <= 0 or h.is_admin(uid):
        return 0
    if db._q1("SELECT 1 FROM mx_trials WHERE user_id=?", (uid,)) or p.get_sub(uid):
        return 0
    return days


async def claim_trial(bot, uid, mid):
    days = trial_ok(uid)
    if not days:
        return await p.sub_home(bot, uid, mid, "ℹ️ اشتراک آزمایشی برای تو در دسترس نیست.\n\n")
    db._ex("INSERT OR IGNORE INTO mx_trials(user_id,ts) VALUES(?,?)", (uid, int(time.time())))
    exp = p.grant_sub(uid, days, "trial")
    db._ex("INSERT INTO payments(user_id,plan,amount,status,kind,file_id,note,created,decided) VALUES(?,?,?,?,?,?,?,?,?)",
           (uid, "trial", 0, "approved", "trial", None, f"{days} days", int(time.time()), int(time.time())))
    await p.sub_home(bot, uid, mid, f"🎉 اشتراک آزمایشی {days} روزه‌ت فعال شد! تا {p.jdate(exp)}\n\n")


async def report_start(bot, uid, mid=None):
    MSTATE[uid] = {"s": "report"}
    await h.show(bot, uid, mid, "🆘 <b>گزارش مشکل / پیام به پشتیبانی</b>\n\n"
                                "مشکلت یا پیامت رو بنویس (می‌تونی عکس با کپشن هم بفرستی) 👇",
                 kb([btn("❌ انصراف", "mx:cancel", "danger")]))


# ================================================================= discount codes
def check_code(uid, code):
    c = db._q1("SELECT * FROM mx_codes WHERE code=?", (code.upper(),))
    if not c:
        return None, "❌ این کد تخفیف وجود نداره."
    if c["max_uses"] and c["used"] >= c["max_uses"]:
        return None, "⌛️ ظرفیت این کد تموم شده."
    if db._q1("SELECT 1 FROM mx_code_uses WHERE code=? AND user_id=?", (c["code"], uid)):
        return None, "ℹ️ قبلا از این کد استفاده کردی."
    return c, None


def use_code(uid, code):
    if not code:
        return
    db._ex("INSERT OR IGNORE INTO mx_code_uses(code,user_id,ts) VALUES(?,?,?)", (code, uid, int(time.time())))
    db._ex("UPDATE mx_codes SET used=used+1 WHERE code=?", (code,))


def zp_merchant():
    return (db.get_setting("zp_merchant") or "").strip()


_prev_sub_home = p.sub_home


async def sub_home(bot, uid, mid=None, note=""):
    def hk(text, markup):
        rows = []
        d = trial_ok(uid)
        if d:
            rows.append([btn(f"🎁 دریافت اشتراک آزمایشی {d} روزه", "mx:trial", "success")])
        rows.append([btn("🧾 پرداخت‌های من", "mx:pays")])
        insert_before_last(markup, *rows)
        return text, markup
    return await hooked(hk, _prev_sub_home, bot, uid, mid, note)


p.sub_home = sub_home

_prev_sub_invoice = p.sub_invoice


async def sub_invoice(bot, uid, mid, plan):
    d = DISC.get(uid)
    d = d if d and d.get("plan") == plan else None
    price = p.plan_price(plan) if plan in p.PLANS else 0

    def hk(text, markup):
        if d:
            text = text.replace(f"<b>{price:,} تومان</b>",
                                f"<s>{price:,}</s> <b>{d['amount']:,} تومان</b>\n🎟 کد تخفیف <code>{h.e(d['code'])}</code> ({d['pct']}٪) اعمال شد")
        if markup and isinstance(markup, dict):
            k = markup["inline_keyboard"]
            if zp_merchant():
                k.insert(0, [btn("💳 پرداخت آنلاین (زرین‌پال)", f"mx:zp:{plan}", "success")])
            if not d:
                k.insert(len(k) - 1, [btn("🎟 کد تخفیف دارم", f"mx:code:{plan}", "primary")])
        return text, markup
    res = await hooked(hk, _prev_sub_invoice, bot, uid, mid, plan)
    st = p.USTATE.get(uid)
    if d and st and st.get("s") == "receipt":
        st = dict(st)
        st["amount"] = d["amount"]
        p.USTATE[uid] = st
    return res


p.sub_invoice = sub_invoice

_prev_receive_receipt = p.receive_receipt


async def receive_receipt(bot, msg, st):
    uid = msg["chat"]["id"]
    before = (db._q1("SELECT MAX(id) m FROM payments") or {}).get("m") or 0
    res = await _prev_receive_receipt(bot, msg, st)
    d = DISC.get(uid)
    if d and db._q1("SELECT id FROM payments WHERE user_id=? AND id>?", (uid, before)):
        use_code(uid, d["code"])
        DISC.pop(uid, None)
    return res


p.receive_receipt = receive_receipt

# ================================================================= zarinpal
ZP = "https://payment.zarinpal.com/pg/v4/payment/"


async def _zp(path, body):
    async with httpx.AsyncClient(timeout=40) as c:
        r = await c.post(ZP + path, json=body, headers={"Accept": "application/json"})
    try:
        return r.json()
    except Exception:
        return {"errors": {"message": f"HTTP {r.status_code}"}}


def _zp_err(j):
    er = j.get("errors")
    if isinstance(er, dict):
        return er.get("message") or str(er)
    return str(er or j)[:200]


async def zp_start(bot, uid, mid, plan):
    if plan not in p.PLANS or p.plan_price(plan) <= 0 or not zp_merchant():
        return await p.sub_home(bot, uid, mid)
    name, days, icon = p.PLANS[plan]
    d = DISC.get(uid) if (DISC.get(uid) or {}).get("plan") == plan else None
    amount = d["amount"] if d else p.plan_price(plan)
    cb = f"https://t.me/{x.BOT_INFO['username']}" if x.BOT_INFO.get("username") else "https://t.me"
    j = await _zp("request.json", {"merchant_id": zp_merchant(), "amount": amount, "currency": "IRT",
                                   "callback_url": cb, "description": f"اشتراک {name} - کاربر {uid}"})
    data = j.get("data") or {}
    auth = data.get("authority") if isinstance(data, dict) else None
    if not auth or data.get("code") != 100:
        log.warning("zarinpal request failed: %s", j)
        msg = "⚠️ اتصال به درگاه ناموفق بود، یکم دیگه امتحان کن یا کارت به کارت پرداخت کن."
        if h.is_admin(uid):
            msg += f"\n<code>{h.e(_zp_err(j))}</code>"
        return await h.show(bot, uid, mid, msg, kb([btn("🔙 پلن‌ها", "x:sub")], h.HOME))
    db._ex("INSERT OR REPLACE INTO mx_zp(authority,user_id,plan,amount,code,status,created) VALUES(?,?,?,?,?,?,?)",
           (auth, uid, plan, amount, d["code"] if d else None, "pending", int(time.time())))
    p.USTATE.pop(uid, None)
    await h.show(bot, uid, mid,
                 f"💳 <b>پرداخت آنلاین</b>\n━━━━━━━━━━━━━━\n{icon} اشتراک {name}\n💰 مبلغ: <b>{amount:,} تومان</b>\n\n"
                 "1️⃣ روی «رفتن به درگاه» بزن و پرداخت کن.\n2️⃣ بعد برگرد و «پرداخت کردم» رو بزن تا خودکار فعال بشه ✅",
                 kb([btn("💳 رفتن به درگاه", url=f"https://payment.zarinpal.com/pg/StartPay/{auth}")],
                    [btn("✅ پرداخت کردم، بررسی کن", f"mx:zpv:{auth}", "success")],
                    [btn("🔙 پلن‌ها", "x:sub")]))


async def zp_verify(bot, uid, mid, auth):
    row = db._q1("SELECT * FROM mx_zp WHERE authority=? AND user_id=?", (auth, uid))
    if not row:
        return await p.sub_home(bot, uid, mid)
    if row["status"] == "paid":
        return await p.sub_home(bot, uid, mid, "✅ این پرداخت قبلا تایید و اشتراکت فعال شده.\n\n")
    j = await _zp("verify.json", {"merchant_id": zp_merchant(), "amount": row["amount"], "authority": auth})
    data = j.get("data") or {}
    code = data.get("code") if isinstance(data, dict) else None
    if code not in (100, 101):
        return await bot.send(uid, "⏳ پرداختت هنوز تایید نشده. اگه پرداخت کردی چند لحظه بعد دوباره «پرداخت کردم» رو بزن.\n"
                                   "اگه پول کم شده و تایید نشد، با پشتیبانی در تماس باش 🙏",
                              kb([btn("✅ بررسی دوباره", f"mx:zpv:{auth}", "success")], [btn("🆘 پشتیبانی", "mx:rep")]))
    ref = str(data.get("ref_id") or "")
    with db._lock:
        cur = db._conn.execute("UPDATE mx_zp SET status='paid', ref_id=? WHERE authority=? AND status!='paid'", (ref, auth))
        db._conn.commit()
        changed = cur.rowcount
    if not changed:
        return await p.sub_home(bot, uid, mid, "✅ این پرداخت قبلا تایید شده.\n\n")
    name, days, icon = p.PLANS.get(row["plan"], ("?", 30, "💎"))
    exp = p.grant_sub(uid, days, row["plan"])
    pid = db._ex("INSERT INTO payments(user_id,plan,amount,status,kind,file_id,note,created,decided) VALUES(?,?,?,?,?,?,?,?,?)",
                 (uid, row["plan"], row["amount"], "approved", "zarinpal", None, f"zarinpal ref {ref}",
                  row["created"], int(time.time())))
    use_code(uid, row.get("code"))
    DISC.pop(uid, None)
    await bot.send(uid, f"🎉 <b>پرداخت موفق بود و اشتراکت فعال شد!</b>\n━━━━━━━━━━━━━━\n{icon} پلن: <b>{name}</b>\n"
                        f"📅 تا: <b>{p.jdate(exp)}</b>\n🧾 کد پیگیری: <code>{h.e(ref)}</code>", h.main_kb(uid))
    u = db.get_user(uid) or {"id": uid}
    for a in p.admin_ids():
        try:
            await bot.send(a, f"💳 <b>پرداخت آنلاین موفق #{pid}</b>\n{h.user_line(u)}\n{icon} {name} · {row['amount']:,} تومان\n"
                              f"🧾 ref: <code>{h.e(ref)}</code>")
        except Exception:
            pass


# ================================================================= main menu / account / help
_prev_main_kb = h.main_kb


def main_kb(uid):
    k = _prev_main_kb(uid)
    rows = k["inline_keyboard"]
    pos = len(rows)
    if rows and rows[-1] and rows[-1][0].get("callback_data") == "ad:home":
        pos -= 1
    rows.insert(pos, [btn("⚙️ تنظیمات من", "mx:set"), btn("🆘 گزارش مشکل", "mx:rep")])
    return k


h.main_kb = main_kb

_prev_account = h.account


async def account(bot, uid, mid):
    def hk(text, markup):
        if "سهمیه امروز" in text:
            text += f"\n⏰ ریست سهمیه: {reset_in()} دیگه"
        if markup and isinstance(markup, dict):
            markup["inline_keyboard"].insert(0, [btn("🧾 پرداخت‌های من", "mx:pays"), btn("⚙️ تنظیمات من", "mx:set")])
        return text, markup
    return await hooked(hk, _prev_account, bot, uid, mid)


h.account = account

h.HELP = h.HELP + (
    "\n\n<b>🆕 امکانات تازه</b>\n"
    "🖼 تو «ساخت عکس» یه عکس با کپشن بفرست تا از روش عکس جدید بسازم.\n"
    "🎬 تو «ساخت ویدیو» عکس بفرست تا متحرکش کنم.\n"
    "🎙 ویس بفرست، به متن تبدیل میشه. با «🔊 بخونش» جواب رو بشنو.\n"
    "📎 هر فایلی بفرست (zip، pdf، word، excel، کد و ...)، می‌خونمش. فایل و zip هم برات می‌سازم.\n"
    "🖼 چندتا عکس یا فایل با هم (آلبوم) هم قبوله.\n"
    "⚙️ /settings نسبت عکس و ویدیو، زبان جواب و شخصیت ربات\n"
    "🆘 /support گزارش مشکل به پشتیبانی\n"
    "⛔️ وسط انجام درخواست می‌تونی «لغو درخواست» رو بزنی."
)
for _c in ({"command": "settings", "description": "⚙️ تنظیمات من"},
           {"command": "support", "description": "🆘 گزارش مشکل"}):
    x.COMMANDS.insert(-1, _c)
up.KNOWN_CMDS.update({"/settings", "/support"})

# ================================================================= admin panel
def _onoff(key):
    candidates = voice_candidates("stt" if key == "stt_model" else "tts")
    if not candidates:
        return "❌ هیچ سرویس فعالی"
    names = ", ".join(h.e(p["name"]) for p, _ in candidates[:3])
    return f"✅ خودکار · <code>{names}</code>"


async def nx_home(bot, uid, mid=None, note=""):
    MSTATE.pop(uid, None)
    fb = db._q1("SELECT SUM(vote=1) up, SUM(vote=0) dn FROM mx_feedback") or {}
    reps = (db._q1("SELECT COUNT(*) c FROM mx_reports WHERE status='open'") or {}).get("c", 0)
    codes = (db._q1("SELECT COUNT(*) c FROM mx_codes") or {}).get("c", 0)
    zp = zp_merchant()
    txt = (f"{note}🧩 <b>امکانات جدید</b>\n━━━━━━━━━━━━━━\n"
           f"🎙 ویس به متن: {_onoff('stt_model')}\n🔊 متن به ویس: {_onoff('tts_model')}\n"
           "⚡ سرویس‌ها خودکار امتحان می‌شوند و اگر یکی پشتیبانی نکند، بعدی استفاده می‌شود.\n"
           f"🗣 صدای TTS: <code>{h.e(db.get_setting('tts_voice'))}</code>\n"
           f"🎁 اشتراک آزمایشی: {db.get_setting('trial_days') or 0} روز (۰ = خاموش)\n"
           f"💳 زرین‌پال: {'✅ ' + h.mask(zp) if zp else '❌ خاموش'}\n"
           f"🎟 کدهای تخفیف: {codes}\n🆘 گزارش‌های باز: {reps}\n"
           f"👍 {fb.get('up') or 0} · 👎 {fb.get('dn') or 0}")
    await h.show(bot, uid, mid, txt, kb(
        [btn("🗣 صدای TTS", "ad:nx:set:tts_voice"), btn("🎁 روزهای آزمایشی", "ad:nx:set:trial_days")],
        [btn("💳 مرچنت زرین‌پال", "ad:nx:set:zp_merchant"), btn("🎟 کدهای تخفیف", "ad:nx:codes", "success")],
        [btn(f"🆘 گزارش‌ها ({reps})", "ad:nx:reps", "danger"), btn("👍 بازخوردها", "ad:nx:fbs")],
        [btn("🔙 پنل مدیریت", "ad:home")]))


SET_HELP = {
    "tts_voice": "🗣 اسم صدا رو بفرست (مثلا <code>alloy</code>، <code>nova</code>، <code>shimmer</code>، <code>echo</code>).",
    "trial_days": "🎁 تعداد روزهای اشتراک آزمایشی (هر کاربر فقط یک بار) رو بفرست. ۰ = خاموش.",
    "zp_merchant": "💳 مرچنت کد زرین‌پال رو بفرست. برای خاموش کردن: <code>-</code>",
}


async def nx_codes(bot, uid, mid=None, note=""):
    MSTATE.pop(uid, None)
    rows = db._q("SELECT * FROM mx_codes ORDER BY created DESC LIMIT 30")
    txt = f"{note}🎟 <b>کدهای تخفیف</b>\n━━━━━━━━━━━━━━\n"
    btns = []
    for c in rows:
        cap = f"{c['used']}/{c['max_uses']}" if c["max_uses"] else f"{c['used']}/∞"
        txt += f"• <code>{h.e(c['code'])}</code> · {c['percent']}٪ · استفاده: {cap}\n"
        btns.append([btn(f"🗑 {c['code']}", f"ad:nx:cdel:{c['code']}", "danger")])
    if not rows:
        txt += "📭 هنوز کدی نساختی."
    await h.show(bot, uid, mid, txt, kb([btn("➕ ساخت کد", "ad:nx:cadd", "success")], *btns, [btn("🔙", "ad:nx:home")]))


async def nx_reps(bot, uid, mid=None):
    rows = db._q("SELECT * FROM mx_reports WHERE status='open' ORDER BY id DESC LIMIT 15")
    txt = "🆘 <b>گزارش‌های باز</b>\n━━━━━━━━━━━━━━\n"
    btns = []
    for r in rows:
        txt += f"\n<b>#{r['id']}</b> · <code>{r['user_id']}</code> · {p.jdate(r['ts'], True)}\n{h.e((r['text'] or '')[:200])}\n"
        btns.append([btn(f"✍️ پاسخ #{r['id']}", f"ad:nx:rr:{r['id']}", "primary"),
                     btn("✅ بستن", f"ad:nx:rc:{r['id']}", "success")])
    if not rows:
        txt += "🎉 گزارش بازی نیست."
    await h.show(bot, uid, mid, txt, kb(*btns, [btn("🔙", "ad:nx:home")]))


async def nx_fbs(bot, uid, mid=None):
    rows = db._q("SELECT model, SUM(vote=1) up, SUM(vote=0) dn FROM mx_feedback GROUP BY model "
                 "ORDER BY dn DESC, up DESC LIMIT 20")
    txt = "👍 <b>بازخورد کاربرها روی مدل‌ها</b>\n━━━━━━━━━━━━━━\n"
    for r in rows:
        txt += f"🤖 {h.e(r['model'] or '?')}: 👍 {r['up'] or 0} · 👎 {r['dn'] or 0}\n"
    if not rows:
        txt += "📭 هنوز بازخوردی نیومده."
    await h.show(bot, uid, mid, txt, kb([btn("🔙", "ad:nx:home")]))


async def nx_dispatch(bot, uid, mid, a):
    cmd = a[0] if a else "home"
    if cmd == "home":
        return await nx_home(bot, uid, mid)
    if cmd == "pv":
        kind = a[1]
        provs = db.list_providers()
        rows = [[btn(f"🔌 {pv['name']}", f"ad:nx:pp:{kind}:{pv['id']}", "primary")] for pv in provs[:20]]
        rows.append([btn("🚫 خاموش کردن", f"ad:nx:poff:{kind}", "danger"), btn("🔙", "ad:nx:home")])
        title = "🎙 ویس به متن" if kind == "stt" else "🔊 متن به ویس"
        return await h.show(bot, uid, mid, f"{title}\n\nسرویسی که این قابلیت رو داره انتخاب کن (مثلا OpenAI، Groq، ...):",
                            kb(*rows))
    if cmd == "pp":
        MSTATE[uid] = {"s": "pmodel", "kind": a[1], "pid": int(a[2])}
        ex = "<code>whisper-1</code> / <code>gpt-4o-mini-transcribe</code> / <code>whisper-large-v3</code>" \
            if a[1] == "stt" else "<code>tts-1</code> / <code>gpt-4o-mini-tts</code>"
        return await h.show(bot, uid, mid, f"✍️ Model ID رو بفرست.\nمثال: {ex}", kb([btn("❌ لغو", "ad:nx:home", "danger")]))
    if cmd == "poff":
        db.set_setting(f"{a[1]}_model", "")
        return await nx_home(bot, uid, mid, "✅ خاموش شد.\n\n")
    if cmd == "set" and a[1] in SET_HELP:
        MSTATE[uid] = {"s": "aset", "key": a[1]}
        return await h.show(bot, uid, mid, f"{SET_HELP[a[1]]}\n\n📌 مقدار فعلی: <code>{h.e(db.get_setting(a[1]))}</code>",
                            kb([btn("❌ لغو", "ad:nx:home", "danger")]))
    if cmd == "codes":
        return await nx_codes(bot, uid, mid)
    if cmd == "cadd":
        MSTATE[uid] = {"s": "cadd"}
        return await h.show(bot, uid, mid, "🎟 کد رو این شکلی بفرست:\n<code>کد درصد تعداد</code>\n\n"
                                           "مثال: <code>YALDA 30 100</code> (۳۰٪ تخفیف، ۱۰۰ نفر)\n"
                                           "تعداد ۰ = نامحدود | درصد ۱۰۰ = رایگان",
                            kb([btn("❌ لغو", "ad:nx:codes", "danger")]))
    if cmd == "cdel":
        db._ex("DELETE FROM mx_codes WHERE code=?", (a[1],))
        return await nx_codes(bot, uid, mid, "🗑 حذف شد.\n\n")
    if cmd == "reps":
        return await nx_reps(bot, uid, mid)
    if cmd == "rr":
        MSTATE[uid] = {"s": "reply", "rid": int(a[1])}
        return await bot.send(uid, f"✍️ پاسخت به گزارش #{a[1]} رو بنویس:", kb([btn("❌ لغو", "ad:nx:reps", "danger")]))
    if cmd == "rc":
        db._ex("UPDATE mx_reports SET status='closed' WHERE id=?", (int(a[1]),))
        return await nx_reps(bot, uid, mid)
    if cmd == "fbs":
        return await nx_fbs(bot, uid, mid)
    return await nx_home(bot, uid, mid)


_prev_admin_cb = h.admin_cb


async def admin_cb(bot, uid, mid, d):
    parts = d.split(":")
    if parts[0] != "nx":
        if d in ("home", "cancel"):
            MSTATE.pop(uid, None)
        return await _prev_admin_cb(bot, uid, mid, d)
    try:
        return await nx_dispatch(bot, uid, mid, parts[1:])
    except (ValueError, IndexError):
        return await nx_home(bot, uid, mid)


h.admin_cb = admin_cb

_prev_admin_home = h.admin_home


async def admin_home(bot, uid, mid=None, note=""):
    def hk(text, markup):
        n = (db._q1("SELECT COUNT(*) c FROM mx_reports WHERE status='open'") or {}).get("c", 0)
        insert_before_last(markup, [btn(f"🧩 امکانات جدید{f' (🆘 {n})' if n else ''}", "ad:nx:home", "success")])
        return text, markup
    return await hooked(hk, _prev_admin_home, bot, uid, mid, note)


h.admin_home = admin_home


# ================================================================= text waits (user + admin)
async def mstate_input(bot, msg, st):
    uid = msg["chat"]["id"]
    text = (msg.get("text") or msg.get("caption") or "").strip()
    s = st.get("s")
    adm = h.is_admin(uid)
    if s in ("pmodel", "aset", "cadd", "reply") and not adm:
        MSTATE.pop(uid, None)
        return await h.show_main(bot, uid)
    if s == "report":
        photo = msg.get("photo")
        if not text and not photo:
            return await bot.send(uid, "✍️ لطفا متن مشکلت رو بنویس.")
        MSTATE.pop(uid, None)
        rid = db._ex("INSERT INTO mx_reports(user_id,text,file_id,status,ts) VALUES(?,?,?,?,?)",
                     (uid, text[:3000], photo[-1]["file_id"] if photo else None, "open", int(time.time())))
        await bot.send(uid, f"✅ پیامت ثبت شد (شماره <code>#{rid}</code>). جواب پشتیبانی همینجا برات میاد 🙏", kb(h.HOME))
        u = db.get_user(uid) or {"id": uid}
        cap = f"🆘 <b>گزارش جدید #{rid}</b>\n{h.user_line(u)}\n\n{h.e(text[:3000])}"
        rk = kb([btn("✍️ پاسخ", f"ad:nx:rr:{rid}", "primary"), btn("✅ بستن", f"ad:nx:rc:{rid}", "success")])
        for a in p.admin_ids():
            try:
                if photo:
                    await bot.send_photo(a, photo[-1]["file_id"], cap[:1000], rk)
                else:
                    await bot.send(a, cap, rk)
            except Exception:
                pass
        return
    if s == "persona":
        if not text:
            return await bot.send(uid, "✍️ متن بفرست.")
        MSTATE.pop(uid, None)
        set_upref(uid, "persona", text[:500])
        return await settings_view(bot, uid, None, "✅ شخصیت ربات ذخیره شد.\n\n")
    if s == "code":
        MSTATE.pop(uid, None)
        plan = st.get("plan")
        c, err = check_code(uid, text)
        if err:
            return await bot.send(uid, err, kb([btn("🎟 دوباره", f"mx:code:{plan}"), btn("🔙 فاکتور", f"x:subp:{plan}")]))
        price = p.plan_price(plan)
        new = max(0, price * (100 - int(c["percent"])) // 100)
        if new <= 0:
            name, days, icon = p.PLANS[plan]
            exp = p.grant_sub(uid, days, plan)
            use_code(uid, c["code"])
            p.USTATE.pop(uid, None)
            db._ex("INSERT INTO payments(user_id,plan,amount,status,kind,file_id,note,created,decided) VALUES(?,?,?,?,?,?,?,?,?)",
                   (uid, plan, 0, "approved", "code", None, f"code {c['code']}", int(time.time()), int(time.time())))
            return await bot.send(uid, f"🎉 با کد تخفیف، اشتراک {name} رایگان فعال شد! تا {p.jdate(exp)}", h.main_kb(uid))
        DISC[uid] = {"plan": plan, "code": c["code"], "pct": int(c["percent"]), "amount": new}
        return await p.sub_invoice(bot, uid, None, plan)
    if s == "pmodel":
        MSTATE.pop(uid, None)
        if text == "-" or not text:
            db.set_setting(f"{st['kind']}_model", "")
        else:
            db.set_setting(f"{st['kind']}_model", f"{st['pid']}|{text[:120]}")
        return await nx_home(bot, uid, None, "✅ ذخیره شد.\n\n")
    if s == "aset":
        key = st.get("key")
        if key == "trial_days" and not text.isdigit():
            return await bot.send(uid, "⚠️ فقط عدد بفرست.")
        MSTATE.pop(uid, None)
        db.set_setting(key, "" if text == "-" else text[:120])
        return await nx_home(bot, uid, None, "✅ ذخیره شد.\n\n")
    if s == "cadd":
        parts = text.split()
        if len(parts) < 2 or not parts[1].isdigit() or not (1 <= int(parts[1]) <= 100) \
                or (len(parts) > 2 and not parts[2].isdigit()):
            return await bot.send(uid, "⚠️ فرمت درست: <code>کد درصد تعداد</code> مثلا <code>OFF20 20 50</code>")
        MSTATE.pop(uid, None)
        db._ex("INSERT OR REPLACE INTO mx_codes(code,percent,max_uses,used,created) VALUES(?,?,?,0,?)",
               (parts[0].upper()[:32], int(parts[1]), int(parts[2]) if len(parts) > 2 else 0, int(time.time())))
        return await nx_codes(bot, uid, None, "✅ کد ساخته شد.\n\n")
    if s == "reply":
        if not text:
            return await bot.send(uid, "✍️ متن پاسخ رو بفرست.")
        MSTATE.pop(uid, None)
        r = db._q1("SELECT * FROM mx_reports WHERE id=?", (st["rid"],))
        if not r:
            return await bot.send(uid, "⚠️ گزارش پیدا نشد.")
        db._ex("UPDATE mx_reports SET status='closed', answer=? WHERE id=?", (text[:3000], r["id"]))
        try:
            await bot.send(r["user_id"], f"📩 <b>پاسخ پشتیبانی</b> (گزارش #{r['id']})\n━━━━━━━━━━━━━━\n{h.e(text)}",
                           kb([btn("🆘 پیام دوباره", "mx:rep")], h.HOME))
            note = "✅ پاسخ برای کاربر ارسال شد."
        except Exception:
            note = "⚠️ ارسال ناموفق بود (شاید کاربر ربات رو بلاک کرده)."
        return await bot.send(uid, note, kb([btn("🆘 گزارش‌ها", "ad:nx:reps")]))
    MSTATE.pop(uid, None)


# ================================================================= message dispatch
_prev_on_message = h.on_message


async def on_message(bot, msg):
    chat = msg.get("chat") or {}
    frm = msg.get("from") or {}
    uid = frm.get("id")
    if chat.get("type") != "private" or not uid:
        return await _prev_on_message(bot, msg)
    text = (msg.get("text") or "").strip()
    cmd = text.split(" ", 1)[0].split("@", 1)[0].lower() if text.startswith("/") else ""

    st = MSTATE.get(uid)
    if st:
        if cmd:
            MSTATE.pop(uid, None)
        else:
            u = await h.ensure_user(bot, frm)
            if h.deny_reason(u) and not h.is_admin(uid):
                MSTATE.pop(uid, None)
                return await bot.send(uid, h.deny_reason(u))
            return await mstate_input(bot, msg, st)

    if (h.STATE.get(uid) and h.is_admin(uid)) or p.USTATE.get(uid):
        return await _prev_on_message(bot, msg)

    if cmd in ("/settings", "/support"):
        if not await up.precheck(bot, frm):
            return
        return await (settings_view(bot, uid) if cmd == "/settings" else report_start(bot, uid))

    if msg.get("voice") or msg.get("audio") or msg.get("video_note"):
        if not await up.precheck(bot, frm):
            return
        return await voice_message(bot, msg, uid)

    doc = msg.get("document") or {}
    img_doc = bool(doc) and str(doc.get("mime_type", "")).startswith("image/")

    if msg.get("media_group_id") and (msg.get("photo") or doc):
        return await album_add(bot, msg, uid)

    mode = h.MODE.get(uid)
    if mode == "test" and (msg.get("photo") or img_doc):
        if not await up.precheck(bot, frm):
            return
        fid = msg["photo"][-1]["file_id"] if msg.get("photo") else doc["file_id"]
        try:
            raw = await bot.download_file(fid)
        except Exception:
            return await bot.send(uid, "⚠️ نتونستم عکس رو دریافت کنم.")
        tok = EXTRA_IMGS.set([raw])
        try:
            return await up.run_test(bot, uid, (msg.get("caption") or "").strip() or "این عکس رو با دقت توضیح بده.")
        finally:
            EXTRA_IMGS.reset(tok)

    if doc and not img_doc and mode not in ("chat", "test"):
        if not await up.precheck(bot, frm):
            return
        h.MODE[uid] = "chat"
        if mode in ("image", "video"):
            await bot.send(uid, "📎 فایل رو تو بخش 💬 چت بررسی می‌کنم.")
        return await up.file_message(bot, uid, msg, "chat")

    return await _prev_on_message(bot, msg)


h.on_message = on_message

# ================================================================= callback dispatch
_prev_on_callback = h.on_callback


async def on_callback(bot, cq):
    data = cq.get("data") or ""
    uid = cq["from"]["id"]
    mid = (cq.get("message") or {}).get("message_id")

    if data in ("rg:image", "rg:video"):
        sec = data[3:]
        fid = LASTREF.get((uid, sec))
        if fid:
            try:
                raw = await bot.download_file(fid)
            except Exception:
                raw = None
            if raw:
                tok = REF_IMGS.set([raw])
                try:
                    return await _prev_on_callback(bot, cq)
                finally:
                    REF_IMGS.reset(tok)
        return await _prev_on_callback(bot, cq)

    if not data.startswith("mx:"):
        return await _prev_on_callback(bot, cq)

    u = await h.ensure_user(bot, cq["from"])
    r = h.deny_reason(u)
    if r:
        return await bot.answer(cq["id"], r, True)
    if not await x.is_member(bot, uid):
        await bot.answer(cq["id"])
        return await x.ask_join(bot, uid, mid)
    a = data.split(":")[1:]
    cmd = a[0] if a else ""
    try:
        if cmd == "stop":
            t = RUNNING.get(uid)
            if t and not t.done():
                STOPPED.add(uid)
                t.cancel()
                await bot.answer(cq["id"], "⛔️ لغو شد")
                try:
                    await h.show(bot, uid, mid, "⛔️ درخواست لغو شد.", kb(h.HOME))
                except Exception:
                    pass
                return
            return await bot.answer(cq["id"], "ℹ️ درخواستی در حال انجام نیست.")
        if cmd == "fb":
            vote = 1 if a[1] == "1" else 0
            m = h.current_model(uid, "chat")
            db._ex("INSERT INTO mx_feedback(user_id,model,vote,ts) VALUES(?,?,?,?)",
                   (uid, (m or {}).get("title"), vote, int(time.time())))
            await bot.answer(cq["id"], "🙏 ممنون از بازخوردت!" if vote else "🙏 ممنون، بهترش می‌کنیم.")
            mk = (cq.get("message") or {}).get("reply_markup")
            if mk:
                rows = [row for row in mk.get("inline_keyboard", [])
                        if not any((b.get("callback_data") or "").startswith("mx:fb:") for b in row)]
                rows.insert(0, [btn("🔊 بخونش", "mx:tts")])
                try:
                    await bot.api("editMessageReplyMarkup", chat_id=uid, message_id=mid,
                                  reply_markup={"inline_keyboard": rows})
                except Exception:
                    pass
            return
        if cmd == "tts":
            if not provider_setting("tts_model")[0]:
                return await bot.answer(cq["id"], "🔊 خوندن جواب هنوز توسط مدیر فعال نشده.", True)
            await bot.answer(cq["id"], "🔊 دارم آماده‌ش می‌کنم...")
            text = (cq.get("message") or {}).get("text") or LAST_ANSWER.get(uid) or ""
            if not text.strip():
                return
            try:
                async with h.KeepAction(bot, uid, "record_voice"):
                    audio = await speak(text)
                await bot.api("sendVoice", files={"voice": ("answer.ogg", audio, "audio/ogg")},
                              chat_id=uid, reply_to_message_id=mid)
            except Exception as ex:
                log.warning("tts failed: %s", ex)
                await bot.send(uid, "❌ تبدیل جواب به صدا ناموفق بود." +
                               (f"\n<code>{h.e(str(ex)[:300])}</code>" if h.is_admin(uid) else ""))
            return
        await bot.answer(cq["id"])
        if cmd == "set":
            return await settings_view(bot, uid, mid)
        if cmd == "cy" and a[1] in CYCLE:
            opts = CYCLE[a[1]]
            cur = upref(uid, a[1], "auto")
            nxt = opts[(opts.index(cur) + 1) % len(opts)] if cur in opts else opts[1]
            set_upref(uid, a[1], "" if nxt == "auto" else nxt)
            return await settings_view(bot, uid, mid)
        if cmd == "per":
            MSTATE[uid] = {"s": "persona"}
            return await h.show(bot, uid, mid, "🎭 بنویس ربات چطور باهات حرف بزنه یا چی رو همیشه رعایت کنه.\n"
                                               "💡 مثال: <i>خودمونی و کوتاه جواب بده، مثل یه معلم برنامه‌نویسی</i>",
                                kb([btn("❌ انصراف", "mx:set", "danger")]))
        if cmd == "perx":
            set_upref(uid, "persona", "")
            return await settings_view(bot, uid, mid, "🗑 شخصیت حذف شد.\n\n")
        if cmd == "rep":
            return await report_start(bot, uid, mid)
        if cmd == "cancel":
            MSTATE.pop(uid, None)
            return await h.show_main(bot, uid, mid, cq["from"].get("first_name", ""))
        if cmd == "pays":
            return await payments_view(bot, uid, mid)
        if cmd == "trial":
            return await claim_trial(bot, uid, mid)
        if cmd == "code":
            MSTATE[uid] = {"s": "code", "plan": a[1]}
            return await h.show(bot, uid, mid, "🎟 کد تخفیفت رو بفرست:", kb([btn("❌ انصراف", f"x:subp:{a[1]}", "danger")]))
        if cmd == "zp":
            return await zp_start(bot, uid, mid, a[1])
        if cmd == "zpv":
            return await zp_verify(bot, uid, mid, a[1])
    except (ValueError, IndexError):
        return
    return await h.show_main(bot, uid, mid, cq["from"].get("first_name", ""))


h.on_callback = on_callback

log.info("more loaded | stt=%s tts=%s zarinpal=%s",
         bool(provider_setting("stt_model")[0]), bool(provider_setting("tts_model")[0]), bool(zp_merchant()))
