"""WAHA session health — real, automated recovery for a session stuck
waiting on a QR scan (2026-09-08).

Real incident this closes: 3 WhatsApp sessions (2 shared company numbers,
1 personal connection attempt) sat in SCAN_QR_CODE for days — each one
keeps a full, persistent headless Chromium process alive the whole time
it exists, regardless of whether anyone's actually connected — driving
this VPS's hypervisor CPU-steal into the 90%+ range and exhausting
Hostinger's burst-CPU reset budget. Found and fixed manually once; this
is the durable, automated version so it can't silently recur.

Deliberately conservative: never touches a WORKING session, requires a
real grace period (default 45 min — long enough for someone to actually
find their phone and scan, short enough that an abandoned attempt
doesn't cost days of CPU) before acting, and always leaves a real trace
— a DB row, a log line, and (for a personal session) a real in-app
notification to the account holder — never a silent kill.
"""
import os
import logging
import httpx
import db

logger = logging.getLogger("waha_health")

WAHA_BASE = "http://waha:3000"
WAHA_KEY = os.getenv("WAHA_API_KEY", "aviinATS2026secure")
# Real, tunable via env — not a full settings-UI knob, since this is an
# ops/infra safety valve, not a business policy a tenant admin needs to
# configure per-tenant (WAHA itself is one shared, VPS-wide service).
STUCK_GRACE_MINUTES = int(os.getenv("WAHA_STUCK_GRACE_MINUTES", "45"))
_HEADERS = {"X-Api-Key": WAHA_KEY, "Content-Type": "application/json"}
_NOT_YET_CONNECTED = {"SCAN_QR_CODE", "STARTING", "FAILED"}


async def check_and_recover_stuck_sessions() -> dict:
    """Lists every real WAHA session, tracks how long each one has been in
    a not-yet-connected state, and auto-stops any that have been stuck
    past the grace period. Returns a summary dict (also used by the
    permanent test suite to assert real, observable behavior)."""
    result: dict = {"checked": 0, "stopped": [], "errors": []}
    try:
        async with httpx.AsyncClient(timeout=15) as cli:
            r = await cli.get(f"{WAHA_BASE}/api/sessions", headers=_HEADERS)
            r.raise_for_status()
            sessions = r.json()
    except Exception as ex:
        result["errors"].append(f"could not list WAHA sessions: {ex}")
        logger.warning(f"[waha_health] could not reach WAHA: {ex}")
        return result

    async with db.system_conn() as conn:
        for s in sessions:
            name = s.get("name")
            status = (s.get("status") or "").upper()
            if not name:
                continue
            result["checked"] += 1

            if status == "WORKING" or status == "STOPPED":
                # Real, connected (nothing to reclaim) or already inactive
                # (already reclaimed) — either way, clear any stale
                # "stuck since" tracking so a later disconnect starts a
                # fresh grace period, not an inherited old one.
                await conn.execute(
                    """INSERT INTO waha_session_health (session_name, last_status, last_checked_at)
                       VALUES ($1,$2,now())
                       ON CONFLICT (session_name) DO UPDATE
                         SET first_seen_stuck_at=NULL, last_status=$2, last_checked_at=now()""",
                    name, status)
                continue

            if status not in _NOT_YET_CONNECTED:
                # An unrecognized/transitional status — track it but don't
                # act on it; a real, evolving WAHA status vocabulary
                # shouldn't silently get treated as "stuck" without review.
                await conn.execute(
                    """INSERT INTO waha_session_health (session_name, last_status, last_checked_at)
                       VALUES ($1,$2,now())
                       ON CONFLICT (session_name) DO UPDATE SET last_status=$2, last_checked_at=now()""",
                    name, status)
                continue

            row = await conn.fetchrow(
                "SELECT first_seen_stuck_at, auto_stopped_at FROM waha_session_health WHERE session_name=$1",
                name)
            if not row or row["first_seen_stuck_at"] is None:
                await conn.execute(
                    """INSERT INTO waha_session_health (session_name, first_seen_stuck_at, last_status, last_checked_at)
                       VALUES ($1, now(), $2, now())
                       ON CONFLICT (session_name) DO UPDATE
                         SET first_seen_stuck_at=now(), last_status=$2, last_checked_at=now()""",
                    name, status)
                continue

            stuck_minutes = await conn.fetchval(
                "SELECT EXTRACT(EPOCH FROM (now() - $1))/60.0", row["first_seen_stuck_at"])
            recently_stopped = row["auto_stopped_at"] and await conn.fetchval(
                "SELECT now() - $1 < interval '1 hour'", row["auto_stopped_at"])

            if stuck_minutes is not None and stuck_minutes >= STUCK_GRACE_MINUTES and not recently_stopped:
                try:
                    async with httpx.AsyncClient(timeout=15) as cli:
                        await cli.post(f"{WAHA_BASE}/api/sessions/{name}/stop", headers=_HEADERS)
                    await conn.execute(
                        """UPDATE waha_session_health
                           SET auto_stopped_at=now(), last_status='STOPPED', last_checked_at=now()
                           WHERE session_name=$1""", name)
                    result["stopped"].append({"session": name, "stuck_minutes": round(stuck_minutes)})
                    logger.warning(
                        f"[waha_health] auto-stopped '{name}' — stuck in {status} for "
                        f"{round(stuck_minutes)} min (>= {STUCK_GRACE_MINUTES} min grace)")
                    # If this is a real personal connection (u_<user_id>),
                    # reflect it in the account's own status and tell the
                    # real owner what happened — never leave this silent.
                    acct = await conn.fetchrow(
                        "SELECT * FROM get_whatsapp_account_by_session($1)", name)
                    if acct and acct["tenant_id"]:
                        # Real bug caught before deploy, not after — reusing
                        # the same $2 (a UUID) both as a UUID column value
                        # AND cast to ::text for resource_id in one prepared
                        # statement is exactly the AmbiguousParameterError
                        # class this project has hit repeatedly elsewhere;
                        # resolving the string form in Python first, as its
                        # own separate parameter, avoids it structurally.
                        user_id_str = str(acct["user_id"])
                        async with db.tenant_conn(str(acct["tenant_id"])) as tconn:
                            await tconn.execute(
                                "UPDATE user_whatsapp_accounts SET status='stopped' WHERE waha_session_name=$1",
                                name)
                            await tconn.execute(
                                """INSERT INTO notifications
                                     (tenant_id,user_id,recipient_user_id,title,body,type,resource,resource_id,channel)
                                   VALUES ($1,$2,$2,$3,$4,'info','user_whatsapp_account',$5,'inapp')""",
                                acct["tenant_id"], acct["user_id"],
                                "WhatsApp connection timed out",
                                f"Your WhatsApp connection attempt wasn't completed within "
                                f"{STUCK_GRACE_MINUTES} minutes and was automatically stopped to save "
                                "resources. Reconnect anytime from Settings > My WhatsApp Account.",
                                user_id_str)
                except Exception as ex:
                    result["errors"].append(f"{name}: {ex}")
                    logger.error(f"[waha_health] failed to auto-stop '{name}': {ex}")
            else:
                await conn.execute(
                    "UPDATE waha_session_health SET last_status=$2, last_checked_at=now() WHERE session_name=$1",
                    name, status)

    if result["stopped"] or result["errors"]:
        logger.info(f"[waha_health] check complete: {result}")
    return result
