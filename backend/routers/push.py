"""Web Push subscription management (Reminder System Phase 2)."""
import logging
import os
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import db
from deps import Actor, get_actor
from services import push_service

log = logging.getLogger(__name__)
router = APIRouter(prefix="/push", tags=["push"])


class PushSubscribeIn(BaseModel):
    endpoint: str
    keys: dict
    user_agent: str | None = None


@router.get("/vapid-public-key")
async def vapid_public_key(actor: Actor = Depends(get_actor)):
    return {"public_key": os.environ.get("VAPID_PUBLIC_KEY", ""), "configured": push_service.is_configured()}


@router.get("/status")
async def push_status(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        count = await conn.fetchval(
            "SELECT COUNT(*) FROM push_subscriptions WHERE tenant_id=$1 AND user_id=$2",
            actor.tenant_id, actor.user_id,
        )
    return {"subscribed": count > 0, "device_count": count}


@router.post("/subscribe")
async def subscribe(body: PushSubscribeIn, actor: Actor = Depends(get_actor)):
    keys = body.keys or {}
    p256dh, auth = keys.get("p256dh"), keys.get("auth")
    if not p256dh or not auth:
        raise HTTPException(400, "Malformed subscription — missing keys")
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute(
            """INSERT INTO push_subscriptions (tenant_id, user_id, endpoint, p256dh, auth, user_agent)
               VALUES ($1,$2,$3,$4,$5,$6)
               ON CONFLICT (tenant_id, endpoint) DO UPDATE
                 SET user_id=EXCLUDED.user_id, p256dh=EXCLUDED.p256dh, auth=EXCLUDED.auth,
                     user_agent=EXCLUDED.user_agent, last_used_at=now()""",
            actor.tenant_id, actor.user_id, body.endpoint, p256dh, auth, body.user_agent,
        )
    return {"ok": True}


@router.post("/unsubscribe")
async def unsubscribe(body: dict, actor: Actor = Depends(get_actor)):
    endpoint = body.get("endpoint")
    if not endpoint:
        raise HTTPException(400, "endpoint required")
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute(
            "DELETE FROM push_subscriptions WHERE tenant_id=$1 AND user_id=$2 AND endpoint=$3",
            actor.tenant_id, actor.user_id, endpoint,
        )
    return {"ok": True}


@router.post("/test")
async def send_test_push(actor: Actor = Depends(get_actor)):
    """Self-service — lets a user confirm their own subscription actually
    delivers, without needing to wait for a real critical escalation."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        subs = await conn.fetch(
            "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE tenant_id=$1 AND user_id=$2",
            actor.tenant_id, actor.user_id,
        )
    if not subs:
        raise HTTPException(404, "No push subscription on file for this device")
    sent = 0
    for s in subs:
        ok = await push_service.send_push(
            {"endpoint": s["endpoint"], "keys": {"p256dh": s["p256dh"], "auth": s["auth"]}},
            "Test notification", "Push notifications are working.", "/reminders",
        )
        if ok:
            sent += 1
    return {"sent": sent, "total": len(subs)}
