"""Read-only analytics views (sql/04_phase3_ai_engine.sql).

All four views are WITH (security_invoker = true), so RLS applies to
the calling role (app_user) exactly as for ordinary table queries.
"""

from fastapi import APIRouter, Depends

import db
from deps import Actor, get_actor

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/redeployment-queue")
async def redeployment_queue(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("SELECT * FROM v_redeployment_queue ORDER BY end_date")
    return [dict(r) for r in rows]


@router.get("/agency-funnel")
async def agency_funnel(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("SELECT * FROM v_agency_funnel ORDER BY client_name")
    return [dict(r) for r in rows]


@router.get("/recruiter-capacity")
async def recruiter_capacity(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("SELECT * FROM v_recruiter_capacity ORDER BY full_name")
    return [dict(r) for r in rows]


@router.get("/skill-gap")
async def skill_gap(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("SELECT * FROM v_skill_gap")
    return [dict(r) for r in rows]
