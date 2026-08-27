"""Individual WhatsApp numbers per recruiter/KAE (2026-08-27).

Mirrors user_mail.py's per-user-account shape ("My Email Accounts"), but
for WhatsApp. WAHA requires one real, persistent Chromium/WEBJS session
per connected number - measured live at ~2.26GB RAM per session on this
VPS - so this is a genuinely capped, opt-in feature (whatsapp_session_
config.max_concurrent_personal_sessions), not unlimited self-service.

Automated stage-change/reminder sends are NOT affected by any of this -
they keep using the shared "default" session (backend/routers/
applications.py's _notify_stage_change_bg, the reminder system) exactly
as before, by explicit design decision.
"""

import os
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException

import db
from deps import Actor, get_actor, require_role

router = APIRouter(prefix="/user-whatsapp", tags=["user-whatsapp"])

WAHA_BASE = os.getenv("WAHA_URL", "http://waha:3000")
WAHA_KEY = os.getenv("WAHA_API_KEY", "")


def _waha_headers() -> dict:
    return {"X-Api-Key": WAHA_KEY, "Content-Type": "application/json"}


def _session_name(user_id: str) -> str:
    return f"u_{user_id}"


def _map_waha_status(raw: str) -> str:
    """Real bug fix (found during live verification, not assumed): WAHA's
    actual status strings are STOPPED/STARTING/SCAN_QR_CODE/WORKING/FAILED
    (sometimes CONNECTED) - a naive .lower() against this table's
    stopped/scan_qr/starting/working/failed vocabulary silently failed to
    match SCAN_QR_CODE -> "scan_qr_code" (not "scan_qr") and WORKING would
    have matched by coincidence but CONNECTED wouldn't - both real, live
    sessions showed as "stopped" everywhere despite genuinely running."""
    raw = (raw or "STOPPED").upper()
    if raw in ("WORKING", "CONNECTED"):
        return "working"
    if raw == "SCAN_QR_CODE":
        return "scan_qr"
    if raw == "STARTING":
        return "starting"
    if raw == "FAILED":
        return "failed"
    return "stopped"


async def _waha_status(session: str) -> dict:
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(f"{WAHA_BASE}/api/sessions/{session}", headers=_waha_headers())
        if r.status_code == 200:
            return r.json()
        return {"status": "STOPPED"}


async def _count_active_personal_sessions(tenant_id: str, exclude_user_id: str | None = None) -> int:
    """Real, live count of personal sessions that currently have a real
    running Chromium/WEBJS process behind them - checked against WAHA
    itself, not just DB rows (a DB row can exist for an already-STOPPED
    session that costs zero RAM right now, so counting rows alone would
    over-count and block starts that are actually safe). Counts ANY
    non-stopped status, not just WORKING - confirmed live that even an
    unscanned SCAN_QR_CODE session already costs real RAM (measured
    ~500MB on this VPS), so a pile of never-scanned sessions could
    otherwise silently exceed the real resource budget without ever
    tripping a WORKING-only check."""
    async with db.tenant_conn(tenant_id) as conn:
        rows = await conn.fetch(
            """SELECT user_id, waha_session_name FROM user_whatsapp_accounts
               WHERE tenant_id=$1 AND is_active=TRUE""",
            tenant_id)
    count = 0
    for row in rows:
        if exclude_user_id and str(row["user_id"]) == str(exclude_user_id):
            continue
        info = await _waha_status(row["waha_session_name"])
        if (info.get("status") or "STOPPED") not in ("STOPPED", "FAILED"):
            count += 1
    return count


@router.get("/account")
async def get_my_account(actor: Actor = Depends(get_actor)):
    """Get-or-create the caller's own personal WhatsApp account row."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT * FROM user_whatsapp_accounts WHERE tenant_id=$1 AND user_id=$2",
            actor.tenant_id, actor.user_id)
        if not row:
            row = await conn.fetchrow(
                """INSERT INTO user_whatsapp_accounts (user_id, tenant_id, waha_session_name)
                   VALUES ($1,$2,$3)
                   ON CONFLICT (tenant_id, user_id) DO UPDATE SET tenant_id=EXCLUDED.tenant_id
                   RETURNING *""",
                actor.user_id, actor.tenant_id, _session_name(str(actor.user_id)))
    out = dict(row)
    # Live status, not just the cached DB column - the cache can lag a real
    # disconnect (e.g. the user logged out of WhatsApp on their phone).
    live = await _waha_status(out["waha_session_name"])
    out["status"] = _map_waha_status(live.get("status"))
    out["phone_number"] = (live.get("me") or {}).get("id", out.get("phone_number")) or out.get("phone_number")
    return out


@router.get("/config")
async def get_config(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT * FROM whatsapp_session_config WHERE tenant_id=$1", actor.tenant_id)
    active_count = await _count_active_personal_sessions(actor.tenant_id)
    return {
        **(dict(row) if row else {"max_concurrent_personal_sessions": 2}),
        "active_sessions": active_count,
    }


@router.put("/config")
async def update_config(body: dict, actor: Actor = Depends(require_role("admin", "super_admin", "manager"))):
    max_sessions = body.get("max_concurrent_personal_sessions")
    if not isinstance(max_sessions, int) or max_sessions < 0:
        raise HTTPException(400, "max_concurrent_personal_sessions must be a non-negative integer")
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """INSERT INTO whatsapp_session_config (tenant_id, max_concurrent_personal_sessions, updated_by, updated_at)
               VALUES ($1,$2,$3,now())
               ON CONFLICT (tenant_id) DO UPDATE SET
                 max_concurrent_personal_sessions=EXCLUDED.max_concurrent_personal_sessions,
                 updated_by=EXCLUDED.updated_by, updated_at=now()
               RETURNING *""",
            actor.tenant_id, max_sessions, actor.user_id)
    return dict(row)


@router.post("/account/start")
async def start_my_session(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        acct = await conn.fetchrow(
            "SELECT * FROM user_whatsapp_accounts WHERE tenant_id=$1 AND user_id=$2",
            actor.tenant_id, actor.user_id)
        if not acct:
            acct = await conn.fetchrow(
                """INSERT INTO user_whatsapp_accounts (user_id, tenant_id, waha_session_name)
                   VALUES ($1,$2,$3) RETURNING *""",
                actor.user_id, actor.tenant_id, _session_name(str(actor.user_id)))
        cfg = await conn.fetchrow(
            "SELECT max_concurrent_personal_sessions FROM whatsapp_session_config WHERE tenant_id=$1",
            actor.tenant_id)
    session_name = acct["waha_session_name"]

    # Already running - no-op, not a cap violation.
    already = await _waha_status(session_name)
    if already.get("status") in ("WORKING", "CONNECTED", "SCAN_QR_CODE"):
        return {"started": True, "status": already.get("status")}

    max_allowed = (cfg["max_concurrent_personal_sessions"] if cfg else 2)
    active_count = await _count_active_personal_sessions(actor.tenant_id, exclude_user_id=str(actor.user_id))
    if active_count >= max_allowed:
        raise HTTPException(
            409,
            f"This server can only run {max_allowed} personal WhatsApp session(s) at once right now "
            f"({active_count} already active) - each one is a real, ~2GB-RAM browser session. "
            "Ask an admin to free up a slot (Ops Settings > WhatsApp Sessions) or raise the limit.",
        )

    async with httpx.AsyncClient(timeout=15) as client:
        await client.post(f"{WAHA_BASE}/api/sessions", headers=_waha_headers(),
                          json={"name": session_name, "config": {"webhooks": []}})
        await client.post(f"{WAHA_BASE}/api/sessions/{session_name}/start", headers=_waha_headers())

    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute(
            "UPDATE user_whatsapp_accounts SET status='starting', last_status_check_at=now() WHERE id=$1",
            acct["id"])
    return {"started": True, "status": "starting"}


@router.get("/account/qr")
async def get_my_qr(actor: Actor = Depends(get_actor)):
    """WAHA WEBJS's real QR path is /api/{session}/auth/qr (confirmed
    live against this deployment) - NOT /api/sessions/{session}/auth/qr,
    which 404s. Matches the same path phase3.py's admin QR endpoint
    already uses for the shared session."""
    session_name = _session_name(str(actor.user_id))
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"{WAHA_BASE}/api/{session_name}/auth/qr",
                             headers=_waha_headers(), params={"format": "image"})
        if r.status_code != 200:
            raise HTTPException(503, "QR not available yet - session may still be starting")
        import base64 as _b64
        return {"qr_data_url": f"data:image/png;base64,{_b64.b64encode(r.content).decode()}"}


@router.post("/account/stop")
async def stop_my_session(actor: Actor = Depends(get_actor)):
    """Real WAHA stop, not a delete - auth persists in the waha_data
    volume, so a later /start reconnects with no new QR scan. This is
    what makes a small session cap workable for more than N people over
    time: an idle user's session can be freed for someone else, then
    resumed later."""
    session_name = _session_name(str(actor.user_id))
    async with httpx.AsyncClient(timeout=15) as client:
        await client.post(f"{WAHA_BASE}/api/sessions/{session_name}/stop", headers=_waha_headers())
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute(
            "UPDATE user_whatsapp_accounts SET status='stopped', last_status_check_at=now() WHERE tenant_id=$1 AND user_id=$2",
            actor.tenant_id, actor.user_id)
    return {"stopped": True}


@router.delete("/account")
async def disconnect_my_account(actor: Actor = Depends(get_actor)):
    """Full logout - unlike /stop, this discards the saved WhatsApp auth
    (a future connect needs a fresh QR scan)."""
    session_name = _session_name(str(actor.user_id))
    async with httpx.AsyncClient(timeout=15) as client:
        await client.post(f"{WAHA_BASE}/api/sessions/{session_name}/logout", headers=_waha_headers())
        await client.delete(f"{WAHA_BASE}/api/sessions/{session_name}", headers=_waha_headers())
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute(
            """UPDATE user_whatsapp_accounts SET status='stopped', phone_number=NULL,
               connected_at=NULL, last_status_check_at=now() WHERE tenant_id=$1 AND user_id=$2""",
            actor.tenant_id, actor.user_id)
    return {"disconnected": True}


@router.patch("/account/bot-auto-reply")
async def set_bot_auto_reply(body: dict, actor: Actor = Depends(get_actor)):
    enabled = body.get("enabled")
    if not isinstance(enabled, bool):
        raise HTTPException(400, "enabled must be a boolean")
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """UPDATE user_whatsapp_accounts SET bot_auto_reply_enabled=$1
               WHERE tenant_id=$2 AND user_id=$3 RETURNING *""",
            enabled, actor.tenant_id, actor.user_id)
        if not row:
            raise HTTPException(404, "No WhatsApp account on file yet - visit this page once to create it")
    return dict(row)


@router.get("/team-overview")
async def team_overview(actor: Actor = Depends(require_role("admin", "super_admin", "manager"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            """SELECT uwa.*, u.full_name, u.email, u.role
               FROM user_whatsapp_accounts uwa
               JOIN users u ON u.id = uwa.user_id
               WHERE uwa.tenant_id=$1 AND u.is_active IS NOT FALSE
               ORDER BY u.full_name""",
            actor.tenant_id)
        cfg = await conn.fetchrow(
            "SELECT max_concurrent_personal_sessions FROM whatsapp_session_config WHERE tenant_id=$1",
            actor.tenant_id)
    out = []
    active_count = 0
    for row in rows:
        d = dict(row)
        live = await _waha_status(d["waha_session_name"])
        d["status"] = _map_waha_status(live.get("status"))
        # Matches the cap-check's own definition of "active" - any real
        # running session, not just fully-scanned/WORKING ones, since even
        # a not-yet-scanned session already costs real RAM.
        if d["status"] != "stopped":
            active_count += 1
        out.append(d)
    return {
        "accounts": out,
        "active_sessions": active_count,
        "max_concurrent_personal_sessions": (cfg["max_concurrent_personal_sessions"] if cfg else 2),
    }
