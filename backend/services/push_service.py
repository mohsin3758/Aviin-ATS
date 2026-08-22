"""Web Push (Reminder System Phase 2) — real browser push via the W3C
Push API + VAPID. No external/paid push service needed: Chrome/Firefox/
Edge each run their own built-in push relay (fcm.googleapis.com,
updates.push.services.mozilla.com, etc.) that pywebpush talks to
directly — the VAPID keypair (self-generated, see sql/71_push_
notifications.sql's header comment) just proves this server's identity
to whichever relay a given subscription belongs to. Genuinely zero-token,
zero-cost, no third-party account required — distinct from Google/
Outlook/Teams/Zoom calendar sync, which stays blocked on real OAuth
partner credentials this project doesn't have.
"""
import base64
import json
import logging
import os

logger = logging.getLogger(__name__)

_VAPID_PRIVATE_PEM = None
_configured = None


def is_configured() -> bool:
    global _configured
    if _configured is None:
        _configured = bool(os.environ.get("VAPID_PRIVATE_KEY_PEM_B64")) and bool(os.environ.get("VAPID_PUBLIC_KEY"))
    return _configured


def _private_pem() -> bytes:
    global _VAPID_PRIVATE_PEM
    if _VAPID_PRIVATE_PEM is None:
        b64 = os.environ.get("VAPID_PRIVATE_KEY_PEM_B64", "")
        _VAPID_PRIVATE_PEM = base64.b64decode(b64) if b64 else b""
    return _VAPID_PRIVATE_PEM


async def send_push(subscription: dict, title: str, body: str, url: str = "/reminders") -> bool:
    """Best-effort — never raises. subscription is
    {"endpoint": ..., "keys": {"p256dh": ..., "auth": ...}} exactly as
    the browser's PushSubscription.toJSON() shape, stored verbatim in
    push_subscriptions. Runs pywebpush's blocking HTTP call in a thread
    so it never stalls the event loop (same reasoning already applied to
    other synchronous SDK calls elsewhere in this codebase)."""
    if not is_configured():
        return False
    try:
        import asyncio
        from pywebpush import webpush, WebPushException

        def _send():
            return webpush(
                subscription_info=subscription,
                data=json.dumps({"title": title, "body": body, "url": url}),
                vapid_private_key=_private_pem().decode(),
                vapid_claims={"sub": os.environ.get("VAPID_SUBJECT", "mailto:noreply@aviinjobs.com")},
                ttl=86400,
            )

        await asyncio.to_thread(_send)
        return True
    except Exception as e:
        # WebPushException(410/404) means the subscription is dead (user
        # revoked permission, browser data cleared, etc.) — expected and
        # common, not logged as a real error; anything else gets a warning.
        try:
            from pywebpush import WebPushException
            if isinstance(e, WebPushException) and e.response is not None and e.response.status_code in (404, 410):
                return False
        except Exception:
            pass
        logger.warning(f"Push send failed (non-fatal): {e}")
        return False
