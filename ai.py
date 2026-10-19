"""AI provider adapters.

OpenAI-compatible providers are intentionally URL-agnostic: a custom service
may expose its API at the root, under /v1, or behind another path.
"""
import asyncio
import base64
import time
from urllib.parse import quote, urlparse

import httpx

TIMEOUT = httpx.Timeout(240, connect=20)
RETRY_CODES = {429, 500, 502, 503, 504}


class AIError(Exception):
    pass


def _url(p, path):
    return _service_base(p) + path


def _service_base(p):
    """Normalize known token-based gateways without changing saved settings."""
    base = p["base_url"].rstrip("/")
    host = (urlparse(base).hostname or "").lower()
    if "pollinations.ai" in host:
        # api.pollinations.ai/generate is the legacy gateway. The current
        # authenticated API is OpenAI-compatible under gen.pollinations.ai/v1.
        return "https://gen.pollinations.ai/v1"
    return base


def _candidate_urls(p, path):
    """Return the configured endpoint first, then the common /v1 variant.

    This keeps existing providers untouched while allowing token endpoints
    that were copied without the /v1 suffix.
    """
    base = _service_base(p)
    first = base + path
    yield first
    parsed = urlparse(base)
    clean_path = parsed.path.rstrip("/")
    if not clean_path.endswith("/v1") and not clean_path.endswith(path.rstrip("/")):
        v1 = base + "/v1" + path
        if v1 != first:
            yield v1


def _headers(p):
    h = {"Authorization": f"Bearer {p['api_key']}", "Content-Type": "application/json"}
    if p.get("kind") == "runway":
        h["X-Runway-Version"] = "2024-11-06"
    return h


def _err(r):
    try:
        j = r.json()
        e = j.get("error", j) if isinstance(j, dict) else j
        msg = (e.get("message") or e.get("msg") or str(e)) if isinstance(e, dict) else str(e)
    except Exception:
        msg = r.text[:300]
    return AIError(f"HTTP {r.status_code}: {msg}")


async def _request(method, p, path, body=None, raw=False):
    last = None
    for attempt in range(3):
        r = None
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as c:
                for endpoint in _candidate_urls(p, path):
                    r = await c.request(method, endpoint, headers=_headers(p), json=body)
                    if r.status_code != 404:
                        break
        except httpx.HTTPError as e:
            last = AIError(f"خطای اتصال: {type(e).__name__}")
            await asyncio.sleep(2 * (attempt + 1))
            continue
        if r is None:
            last = AIError("پاسخ خالی از سرویس")
            continue
        if r.status_code in RETRY_CODES and attempt < 2:
            last = _err(r)
            await asyncio.sleep(3 * (attempt + 1))
            continue
        if r.status_code >= 400:
            raise _err(r)
        if raw:
            return r.content
        try:
            return r.json()
        except Exception:
            raise AIError("پاسخ نامعتبر از سرویس")
    raise last or AIError("خطای ناشناخته")


async def list_models(p):
    if p.get("kind") in ("runway", "cloudflare"):
        raise AIError("این سرویس فهرست مدل خودکار ندارد؛ Model ID را دستی اضافه کن.")
    j = await _request("GET", p, "/models")
    data = j.get("data", j) if isinstance(j, dict) else j
    ids = []
    for m in data or []:
        mid = m.get("id") if isinstance(m, dict) else m
        if mid:
            ids.append(str(mid))
    return sorted(set(ids))


def _content_text(content):
    if isinstance(content, list):
        return "".join(x.get("text", "") for x in content if isinstance(x, dict))
    return content or ""


async def chat(p, model, messages):
    if p.get("kind") == "cloudflare":
        j = await _request("POST", p, f"/{model.lstrip('/')}", {"messages": messages})
        result = j.get("result", j) if isinstance(j, dict) else j
        text = result.get("response", result.get("text", "")) if isinstance(result, dict) else str(result)
        if text:
            return str(text).strip()
        raise AIError(str(j)[:300])
    j = await _request("POST", p, "/chat/completions", {"model": model, "messages": messages})
    try:
        msg = j["choices"][0]["message"]
    except Exception:
        raise AIError(str(j)[:300])
    text = _content_text(msg.get("content")).strip()
    if not text:
        text = (msg.get("reasoning_content") or "").strip()
    if not text:
        raise AIError("مدل پاسخ خالی برگردوند")
    return text


def _collect_images(j):
    out = []
    for d in (j.get("data") or []):
        if d.get("url"):
            out.append(d["url"])
        elif d.get("b64_json"):
            out.append(base64.b64decode(d["b64_json"]))
    return out


def _data_url_to_bytes(u):
    if u.startswith("data:"):
        return base64.b64decode(u.split(",", 1)[1])
    return u


async def image(p, model, prompt, size="auto"):
    if "pollinations.ai" in (urlparse(p["base_url"]).hostname or "").lower():
        query = f"?model={quote(model)}"
        return [await _request("GET", p, f"/image/{quote(prompt)}{query}", raw=True)]
    if p.get("kind") == "runway":
        j = await _request("POST", p, "/text_to_image", {
            "promptText": prompt, "ratio": "1024:1024", "model": model})
        return await _runway_result(p, j, "image")
    if p["kind"] == "byteplus":
        body = {"model": model, "prompt": prompt, "response_format": "url", "watermark": False,
                "size": "2K" if size in ("", "auto") else size}
    else:
        body = {"model": model, "prompt": prompt, "n": 1}
        if size not in ("", "auto"):
            body["size"] = size
    try:
        out = _collect_images(await _request("POST", p, "/images/generations", body))
        if out:
            return out
        err = AIError("سرویس هیچ عکسی برنگردوند")
    except AIError as e:
        err = e
    if p["kind"] == "byteplus":
        raise err
    # Fallback: chat-based image models (OpenRouter / Gemini style)
    try:
        j = await _request("POST", p, "/chat/completions", {
            "model": model, "modalities": ["image", "text"],
            "messages": [{"role": "user", "content": prompt}]})
        msg = j["choices"][0]["message"]
        out = []
        for im in msg.get("images") or []:
            u = (im.get("image_url") or {}).get("url") if isinstance(im, dict) else None
            if u:
                out.append(_data_url_to_bytes(u))
        if isinstance(msg.get("content"), list):
            for part in msg["content"]:
                if isinstance(part, dict) and part.get("type") == "image_url":
                    out.append(_data_url_to_bytes(part["image_url"]["url"]))
        if out:
            return out
    except Exception:
        pass
    raise err


async def video(p, model, prompt, params="", progress=None, max_wait=900):
    start = time.time()
    if p.get("kind") == "runway":
        # Runway's image_to_video requires a prompt image. Generate one through
        # the same provider first, then use its returned URI as the keyframe.
        imgs = await image(p, "gen4_image_turbo", prompt)
        image_uri = next((x for x in imgs if isinstance(x, str) and x.startswith("http")), None)
        if not image_uri:
            raise AIError("Runway تصویر مرجع قابل استفاده برای ویدیو برنگرداند")
        j = await _request("POST", p, "/image_to_video", {
            "promptText": prompt, "promptImage": image_uri,
            "ratio": "1280:720", "duration": 2, "outputFormat": "mp4", "model": model})
        return await _runway_result(p, j, "video", progress=progress, max_wait=max_wait)
    if p["kind"] == "byteplus":
        text = (prompt + " " + params).strip() if params else prompt
        j = await _request("POST", p, "/contents/generations/tasks",
                           {"model": model, "content": [{"type": "text", "text": text}]})
        tid = j.get("id")
        if not tid:
            raise AIError(str(j)[:300])
        while time.time() - start < max_wait:
            await asyncio.sleep(6)
            s = await _request("GET", p, f"/contents/generations/tasks/{tid}")
            st = s.get("status", "")
            if progress:
                await progress(st, int(time.time() - start))
            if st == "succeeded":
                url = (s.get("content") or {}).get("video_url")
                if not url:
                    raise AIError("ویدیو ساخته شد ولی لینکش برنگشت")
                return url
            if st in ("failed", "cancelled", "expired"):
                e = s.get("error") or {}
                raise AIError(f"ساخت ویدیو ناموفق: {e.get('message', st) if isinstance(e, dict) else e}")
        raise AIError("زمان ساخت ویدیو طولانی شد (timeout)")
    # OpenAI-compatible /videos API (Sora style)
    j = await _request("POST", p, "/videos", {"model": model, "prompt": prompt})
    vid = j.get("id")
    if not vid:
        raise AIError(str(j)[:300])
    while time.time() - start < max_wait:
        await asyncio.sleep(8)
        s = await _request("GET", p, f"/videos/{vid}")
        st = s.get("status", "")
        if progress:
            await progress(st, int(time.time() - start))
        if st in ("completed", "succeeded"):
            if s.get("url") or s.get("video_url"):
                return s.get("url") or s.get("video_url")
            return await _request("GET", p, f"/videos/{vid}/content", raw=True)
        if st in ("failed", "cancelled", "expired"):
            e = s.get("error") or {}
            raise AIError(f"ساخت ویدیو ناموفق: {e.get('message', st) if isinstance(e, dict) else e}")
    raise AIError("زمان ساخت ویدیو طولانی شد (timeout)")


async def _runway_result(p, task, kind, progress=None, max_wait=900):
    """Poll a native Runway task and return its media URL."""
    tid = task.get("id") if isinstance(task, dict) else None
    if not tid:
        raise AIError(str(task)[:300])
    started = time.time()
    while time.time() - started < max_wait:
        await asyncio.sleep(5)
        s = await _request("GET", p, f"/tasks/{tid}")
        status = str(s.get("status", "")).lower()
        if progress:
            await progress(status, int(time.time() - started))
        if status in ("succeeded", "completed"):
            out = s.get("output") or s.get("outputs") or []
            if isinstance(out, str):
                return out
            if isinstance(out, list) and out:
                return out[0] if kind == "video" else out
            raise AIError("Runway کار تمام شد ولی لینک خروجی برنگشت")
        if status in ("failed", "cancelled", "canceled"):
            raise AIError(f"Runway task ناموفق شد: {s.get('failure', status)}")
    raise AIError("زمان پاسخ Runway طولانی شد (timeout)")
