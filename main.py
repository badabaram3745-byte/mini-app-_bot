import asyncio
import logging
import sys
from collections import defaultdict

import handlers
import extras  # noqa: F401  (additive upgrades, see extras.py)
import pro  # noqa: F401  (subscription, chat archive, admin tools, see pro.py)
import upgrade  # noqa: F401  (test mode, files, admin extras, see upgrade.py)
import more  # noqa: F401  (voice, image refs, any file, settings, payments, support, see more.py)
from config import ADMIN_IDS, BOT_TOKEN
from tg import Bot

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("main")
USER_SLOTS = defaultdict(lambda: asyncio.Semaphore(2))


async def safe_update(bot, update):
    message = update.get("message") or update.get("callback_query", {}).get("message") or {}
    uid = (message.get("from") or {}).get("id") or update.get("callback_query", {}).get("from", {}).get("id")
    if not uid:
        return await handlers.handle_update(bot, update)
    async with USER_SLOTS[uid]:
        return await handlers.handle_update(bot, update)


async def main():
    if not BOT_TOKEN:
        log.error("BOT_TOKEN is not set! Add it in Railway → Variables.")
        sys.exit(1)
    if not ADMIN_IDS:
        log.warning("ADMIN_IDS is empty: nobody can open the admin panel.")
    bot = Bot(BOT_TOKEN)
    me = await bot.api("getMe")
    log.info("Bot @%s started | admins: %s", me.get("username"), ADMIN_IDS)
    await bot.api("deleteWebhook")
    try:
        await bot.api("setMyCommands", commands=[
            {"command": "start", "description": "🏠 منوی اصلی"},
            {"command": "cancel", "description": "❌ لغو"},
        ])
    except Exception:
        pass

    offset = None
    while True:
        try:
            updates = await bot.api("getUpdates", offset=offset, timeout=50,
                                    allowed_updates=["message", "callback_query"])
        except Exception as ex:
            log.warning("getUpdates error: %s", ex)
            await asyncio.sleep(3)
            continue
        for u in updates:
            offset = u["update_id"] + 1
            asyncio.create_task(safe_update(bot, u))


if __name__ == "__main__":
    asyncio.run(main())
