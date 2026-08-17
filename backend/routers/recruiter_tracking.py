"""Recruiter presence + activity tracking.

Heartbeat writes users.last_seen_at (an existing column that was never
wired to anything). Presence buckets recruiters into online (<5 min),
away (<30 min), offline (>=30 min or never seen) from that timestamp.
Activity surfaces each recruiter's own recent audit_log entries.
"""
from fastapi import APIRouter, Depends

import db
from deps import Actor, get_actor

router = APIRouter(prefix="/recruiter-tracking", tags=["recruiter-tracking"])

RECRUITER_ROLES = ("recruiter", "lead_recruiter", "delivery", "kae", "kae_manager")


@router.post("/heartbeat")
async def heartbeat(actor: Actor = Depends(get_actor)):
    if not actor.user_id:
        return {"status": "skipped"}
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute(
            "UPDATE users SET last_seen_at = now() WHERE id = $1 AND tenant_id = $2",
            actor.user_id, actor.tenant_id,
        )
    return {"status": "ok"}


@router.get("/presence")
async def get_presence(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            """SELECT id, full_name, role, last_seen_at,
                      CASE
                        WHEN last_seen_at IS NULL THEN 'offline'
                        WHEN now() - last_seen_at < interval '5 minutes' THEN 'online'
                        WHEN now() - last_seen_at < interval '30 minutes' THEN 'away'
                        ELSE 'offline'
                      END AS presence
               FROM users
               WHERE tenant_id = $1 AND is_active = true AND role = ANY($2)
               ORDER BY last_seen_at DESC NULLS LAST""",
            actor.tenant_id, list(RECRUITER_ROLES),
        )
    recruiters = [dict(r) for r in rows]
    return {
        "recruiters": recruiters,
        "online": sum(1 for r in recruiters if r["presence"] == "online"),
        "away": sum(1 for r in recruiters if r["presence"] == "away"),
        "offline": sum(1 for r in recruiters if r["presence"] == "offline"),
    }


@router.get("/activity")
async def get_activity(recruiter_id: str | None = None, limit: int = 50, actor: Actor = Depends(get_actor)):
    conditions = ["a.tenant_id = $1", "u.role = ANY($2)"]
    params: list = [actor.tenant_id, list(RECRUITER_ROLES)]
    if recruiter_id:
        params.append(recruiter_id)
        conditions.append(f"a.actor_user_id = ${len(params)}")
    params.append(limit)

    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            f"""SELECT a.id, a.actor_user_id, u.full_name AS actor_name, a.action,
                       a.entity_type, a.entity_id, a.created_at
                FROM audit_log a
                JOIN users u ON u.id = a.actor_user_id AND u.is_active IS NOT FALSE
                WHERE {' AND '.join(conditions)}
                ORDER BY a.created_at DESC
                LIMIT ${len(params)}""",
            *params,
        )
    return {"activity": [dict(r) for r in rows]}
