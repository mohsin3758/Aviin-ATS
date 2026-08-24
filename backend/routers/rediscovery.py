"""Candidate rediscovery — recruiter-facing endpoints (2026-08-25). See
services/candidate_rediscovery.py for the actual scan/notify logic; this
router only exposes a recruiter's own notified matches."""
from fastapi import APIRouter, Depends, HTTPException

import db
from deps import Actor, get_actor

router = APIRouter(prefix="/rediscovery", tags=["rediscovery"])


@router.get("/my-matches")
async def my_matches(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT crm.*, c.full_name AS candidate_name, c.email AS candidate_email,
                   r.title AS requisition_title
            FROM candidate_rediscovery_matches crm
            JOIN candidates c ON c.id = crm.candidate_id
            JOIN requisitions r ON r.id = crm.requisition_id
            WHERE crm.tenant_id=$1 AND crm.notified_recruiter_id=$2 AND crm.status <> 'dismissed'
            ORDER BY crm.created_at DESC
        """, actor.tenant_id, actor.user_id)
    return [dict(r) for r in rows]


@router.post("/{match_id}/dismiss")
async def dismiss_match(match_id: str, actor: Actor = Depends(get_actor)):
    # Scoped by notified_recruiter_id, not just tenant_id — avoids the
    # exact "any authenticated user could act on another user's row" bug
    # class already found and fixed once in p28_p32.py's notification
    # mark-read endpoints.
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "UPDATE candidate_rediscovery_matches SET status='dismissed' WHERE id=$1 AND tenant_id=$2 AND notified_recruiter_id=$3 RETURNING id",
            match_id, actor.tenant_id, actor.user_id)
    if not row:
        raise HTTPException(status_code=404, detail="Match not found")
    return {"dismissed": True}


@router.post("/{match_id}/view")
async def view_match(match_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "UPDATE candidate_rediscovery_matches SET status='viewed' WHERE id=$1 AND tenant_id=$2 AND notified_recruiter_id=$3 AND status='new' RETURNING id",
            match_id, actor.tenant_id, actor.user_id)
    return {"viewed": bool(row)}
