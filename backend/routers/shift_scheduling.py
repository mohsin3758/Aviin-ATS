"""Internal shift scheduling for FinStack's own recruiters/staff (Time
Champ gap-analysis, 2026-08-11) — distinct from `requisitions.shift_type`,
which describes the client JOB's shift, not FinStack's own staff roster.
Template-based shift assignment per user/date + a swap-request workflow.
"""
from datetime import date, time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import db
from deps import Actor, get_actor, require_role

router = APIRouter(prefix="/shift-scheduling", tags=["shift-scheduling"])


# ─── Templates ──────────────────────────────────────────────────────────────

class TemplateIn(BaseModel):
    name: str
    start_time: str
    end_time: str
    color: str = "#2563eb"


@router.get("/templates")
async def list_templates(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            "SELECT * FROM shift_templates WHERE tenant_id=$1 ORDER BY is_active DESC, name",
            actor.tenant_id)
    return [dict(r) for r in rows]


@router.post("/templates")
async def create_template(body: TemplateIn, actor: Actor = Depends(require_role("admin", "manager"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """INSERT INTO shift_templates (tenant_id, name, start_time, end_time, color, created_by)
               VALUES ($1,$2,$3,$4,$5,$6) RETURNING *""",
            actor.tenant_id, body.name, time.fromisoformat(body.start_time), time.fromisoformat(body.end_time),
            body.color, actor.user_id)
    return dict(row)


@router.delete("/templates/{template_id}")
async def deactivate_template(template_id: str, actor: Actor = Depends(require_role("admin", "manager"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "UPDATE shift_templates SET is_active=FALSE WHERE id=$1 AND tenant_id=$2 RETURNING id",
            template_id, actor.tenant_id)
    if not row:
        raise HTTPException(404, "Template not found")
    return {"deactivated": True}


# ─── Shift assignment ───────────────────────────────────────────────────────

class ShiftIn(BaseModel):
    user_id: str
    template_id: Optional[str] = None
    shift_date: str
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    notes: Optional[str] = None


@router.get("/shifts")
async def list_shifts(
    user_id: Optional[str] = None, date_from: Optional[str] = None, date_to: Optional[str] = None,
    actor: Actor = Depends(get_actor),
):
    async with db.tenant_conn(actor.tenant_id) as conn:
        # REAL BUG FIX (2026-08-24): no u.is_active filter -- a real,
        # live shift calendar should never show deactivated/QA-test staff.
        q = """SELECT s.*, u.full_name AS user_name, t.name AS template_name, t.color AS template_color
               FROM staff_shifts s JOIN users u ON u.id=s.user_id AND u.is_active IS NOT FALSE
               LEFT JOIN shift_templates t ON t.id=s.template_id
               WHERE s.tenant_id=$1"""
        params = [actor.tenant_id]
        if user_id:
            params.append(user_id); q += f" AND s.user_id=${len(params)}"
        if date_from:
            params.append(date.fromisoformat(date_from)); q += f" AND s.shift_date>=${len(params)}"
        if date_to:
            params.append(date.fromisoformat(date_to)); q += f" AND s.shift_date<=${len(params)}"
        q += " ORDER BY s.shift_date, u.full_name"
        rows = await conn.fetch(q, *params)
    return [dict(r) for r in rows]


@router.get("/my-shifts")
async def my_shifts(date_from: Optional[str] = None, date_to: Optional[str] = None, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        q = """SELECT s.*, t.name AS template_name, t.color AS template_color
               FROM staff_shifts s LEFT JOIN shift_templates t ON t.id=s.template_id
               WHERE s.tenant_id=$1 AND s.user_id=$2"""
        params = [actor.tenant_id, actor.user_id]
        if date_from:
            params.append(date.fromisoformat(date_from)); q += f" AND s.shift_date>=${len(params)}"
        if date_to:
            params.append(date.fromisoformat(date_to)); q += f" AND s.shift_date<=${len(params)}"
        q += " ORDER BY s.shift_date"
        rows = await conn.fetch(q, *params)
    return [dict(r) for r in rows]


@router.post("/shifts")
async def assign_shift(body: ShiftIn, actor: Actor = Depends(require_role("admin", "manager"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        user = await conn.fetchrow("SELECT id FROM users WHERE id=$1 AND tenant_id=$2", body.user_id, actor.tenant_id)
        if not user:
            raise HTTPException(404, "User not found")
        # asyncpg needs real date/time objects for DATE/TIME columns, not
        # plain strings — same bug class documented repeatedly elsewhere
        # in this codebase (erp.py, interview scheduling, etc.).
        start_t = time.fromisoformat(body.start_time) if body.start_time else None
        end_t = time.fromisoformat(body.end_time) if body.end_time else None
        if body.template_id:
            tmpl = await conn.fetchrow("SELECT start_time, end_time FROM shift_templates WHERE id=$1 AND tenant_id=$2",
                                        body.template_id, actor.tenant_id)
            if not tmpl:
                raise HTTPException(404, "Template not found")
            start_t = start_t or tmpl["start_time"]
            end_t = end_t or tmpl["end_time"]
        if not start_t or not end_t:
            raise HTTPException(400, "start_time/end_time required when no template_id is given")
        row = await conn.fetchrow(
            """INSERT INTO staff_shifts (tenant_id, user_id, template_id, shift_date, start_time, end_time, notes, created_by)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
               ON CONFLICT (tenant_id, user_id, shift_date) DO UPDATE SET
                 template_id=$3, start_time=$5, end_time=$6, notes=$7
               RETURNING *""",
            actor.tenant_id, body.user_id, body.template_id, date.fromisoformat(body.shift_date),
            start_t, end_t, body.notes, actor.user_id)
    return dict(row)


@router.delete("/shifts/{shift_id}")
async def delete_shift(shift_id: str, actor: Actor = Depends(require_role("admin", "manager"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("DELETE FROM staff_shifts WHERE id=$1 AND tenant_id=$2 RETURNING id", shift_id, actor.tenant_id)
    if not row:
        raise HTTPException(404, "Shift not found")
    return {"deleted": True}


# ─── Swap requests ──────────────────────────────────────────────────────────

class SwapRequestIn(BaseModel):
    shift_id: str
    target_user_id: Optional[str] = None
    reason: Optional[str] = None


@router.get("/swap-requests")
async def list_swap_requests(status: Optional[str] = None, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        # REAL BUG FIX (2026-08-24): no is_active filter on either side --
        # a real, actionable swap-request list should never show deactivated/
        # QA-test staff among the requests needing a real decision.
        q = """SELECT r.*, s.shift_date, s.start_time, s.end_time, u1.full_name AS requested_by_name,
                      u2.full_name AS target_user_name
               FROM shift_swap_requests r
               JOIN staff_shifts s ON s.id=r.shift_id
               JOIN users u1 ON u1.id=r.requested_by AND u1.is_active IS NOT FALSE
               LEFT JOIN users u2 ON u2.id=r.target_user_id AND u2.is_active IS NOT FALSE
               WHERE r.tenant_id=$1"""
        params = [actor.tenant_id]
        if status:
            params.append(status); q += f" AND r.status=${len(params)}"
        q += " ORDER BY r.created_at DESC"
        rows = await conn.fetch(q, *params)
    return [dict(r) for r in rows]


@router.post("/swap-requests")
async def create_swap_request(body: SwapRequestIn, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        shift = await conn.fetchrow("SELECT id, user_id FROM staff_shifts WHERE id=$1 AND tenant_id=$2", body.shift_id, actor.tenant_id)
        if not shift:
            raise HTTPException(404, "Shift not found")
        if str(shift["user_id"]) != str(actor.user_id) and actor.role not in ("admin", "manager"):
            raise HTTPException(403, "You can only request a swap on your own shift")
        row = await conn.fetchrow(
            """INSERT INTO shift_swap_requests (tenant_id, shift_id, requested_by, target_user_id, reason)
               VALUES ($1,$2,$3,$4,$5) RETURNING *""",
            actor.tenant_id, body.shift_id, actor.user_id, body.target_user_id, body.reason)
    return dict(row)


class SwapReviewIn(BaseModel):
    note: Optional[str] = None


@router.post("/swap-requests/{request_id}/approve")
async def approve_swap(request_id: str, body: SwapReviewIn, actor: Actor = Depends(require_role("admin", "manager"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        req = await conn.fetchrow("SELECT * FROM shift_swap_requests WHERE id=$1 AND tenant_id=$2", request_id, actor.tenant_id)
        if not req:
            raise HTTPException(404, "Swap request not found")
        if req["status"] != "pending":
            raise HTTPException(400, f"Request already {req['status']}")
        async with conn.transaction():
            await conn.execute(
                "UPDATE shift_swap_requests SET status='approved', reviewed_by=$1, reviewed_at=now(), review_note=$2 WHERE id=$3",
                actor.user_id, body.note, request_id)
            if req["target_user_id"]:
                await conn.execute("UPDATE staff_shifts SET user_id=$1, status='swapped' WHERE id=$2", req["target_user_id"], req["shift_id"])
        row = await conn.fetchrow("SELECT * FROM shift_swap_requests WHERE id=$1", request_id)
    return dict(row)


@router.post("/swap-requests/{request_id}/reject")
async def reject_swap(request_id: str, body: SwapReviewIn, actor: Actor = Depends(require_role("admin", "manager"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """UPDATE shift_swap_requests SET status='rejected', reviewed_by=$1, reviewed_at=now(), review_note=$2
               WHERE id=$3 AND tenant_id=$4 AND status='pending' RETURNING *""",
            actor.user_id, body.note, request_id, actor.tenant_id)
    if not row:
        raise HTTPException(404, "Pending swap request not found")
    return dict(row)
