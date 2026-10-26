"""Minimal async Telegram Bot API client (supports colored buttons via `style`)."""
import json
import logging

import httpx

log = logging.getLogger("tg")


class TgError(Exception):
    pass


def btn(text, data=None, style=None, url=None):
    """style: 'primary' (blue) | 'success' (green) | 'danger' (red) | None"""
    b = {"text": text}
    if url:
        b["url"] = url
    else:
        b["callback_data"] = data
    if style:
        b["style"] = style
    return b


def kb(*rows):
    return {"inline_keyboard": [r for r in rows if r]}


def _form(v):
    if isinstance(v, (dict, list)):
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, bool):
        return "true" if v else "false"
    return str(v)


class Bot:
    def __init__(self, token):
        self.base = f"https://api.telegram.org/bot{token}/"
        self.file_base = f"https://api.telegram.org/file/bot{token}/"
        self.http = httpx.AsyncClient(timeout=httpx.Timeout(90, connect=20))

    async def api(self, method, files=None, **params):
        params = {k: v for k, v in params.items() if v is not None}
        if files:
            data = {k: _form(v) for k, v in params.items()}
            r = await self.http.post(self.base + method, data=data, files=files, timeout=300)
        else:
            r = await self.http.post(self.base + method, json=params)
        try:
            j = r.json()
        except Exception:
            raise TgError(f"HTTP {r.status_code}")
        if not j.get("ok"):
            raise TgError(j.get("description", "unknown error"))
        return j["result"]

    async def send(self, chat_id, text, markup=None, html=True, **kw):
        return await self.api(
            "sendMessage", chat_id=chat_id, text=text,
            parse_mode="HTML" if html else None, reply_markup=markup,
            link_preview_options={"is_disabled": True}, **kw)

    async def edit(self, chat_id, mid, text, markup=None, html=True):
        try:
            return await self.api(
                "editMessageText", chat_id=chat_id, message_id=mid, text=text,
                parse_mode="HTML" if html else None, reply_markup=markup,
                link_preview_options={"is_disabled": True})
        except TgError as e:
            if "not modified" in str(e):
                return None
            raise

    async def answer(self, cq_id, text=None, alert=False):
        try:
            await self.api("answerCallbackQuery", callback_query_id=cq_id, text=text, show_alert=alert)
        except Exception:
            pass

    async def delete(self, chat_id, mid):
        try:
            await self.api("deleteMessage", chat_id=chat_id, message_id=mid)
        except Exception:
            pass

    async def action(self, chat_id, act="typing"):
        try:
            await self.api("sendChatAction", chat_id=chat_id, action=act)
        except Exception:
            pass

    async def download_file(self, file_id):
        f = await self.api("getFile", file_id=file_id)
        r = await self.http.get(self.file_base + f["file_path"])
        return r.content

    async def send_photo(self, chat_id, photo, caption=None, markup=None):
        if isinstance(photo, bytes):
            return await self.api("sendPhoto", files={"photo": ("image.png", photo)}, chat_id=chat_id,
                                  caption=caption, parse_mode="HTML", reply_markup=markup)
        return await self.api("sendPhoto", chat_id=chat_id, photo=photo, caption=caption,
                              parse_mode="HTML", reply_markup=markup)

    async def send_video(self, chat_id, video, caption=None, markup=None):
        if isinstance(video, bytes):
            return await self.api("sendVideo", files={"video": ("video.mp4", video)}, chat_id=chat_id,
                                  caption=caption, parse_mode="HTML", reply_markup=markup,
                                  supports_streaming=True)
        return await self.api("sendVideo", chat_id=chat_id, video=video, caption=caption,
                              parse_mode="HTML", reply_markup=markup, supports_streaming=True)
