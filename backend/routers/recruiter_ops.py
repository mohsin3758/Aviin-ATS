"""Recruiter Ops: monthly targets, task list, candidate hotlist.

These three tables (recruiter_targets, recruiter_tasks, hotlist) had
real seeded data but no API at all before this — nothing but
seed_data.py ever touched them. Built now as a straightforward
CRUD/list surface, same shape as the rest of the recruiter tooling.
"""
from datetime import date, datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import db
from deps import Actor, get_actor, require_role

targets_router = APIRouter(prefix="/recruiter-targets", tags=["recruiter-targets"])
tasks_router = APIRouter(prefix="/recruiter-tasks", tags=["recruiter-tasks"])
hotlist_router = APIRouter(prefix="/hotlist", tags=["hotlist"])
leave_router = APIRouter(prefix="/recruiter-leave", tags=["recruiter-leave"])


# ── Targets ──────────────────────────────────────────────────
class TargetIn(BaseModel):
    recruiter_id: str
    period_month: int
    period_year: int
    target_submissions: int = 0
    target_interviews: int = 0
    target_placements: int = 0
    target_work_hours: int = 0
    notes: Optional[str] = None


@targets_router.get("")
async def list_targets(recruiter_id: Optional[str] = None, period_year: Optional[int] = None,
                        actor: Actor = Depends(get_actor)):
    conditions = ["t.tenant_id = $1"]
    params: list = [actor.tenant_id]
    if recruiter_id:
        params.append(recruiter_id)
        conditions.append(f"t.recruiter_id = ${len(params)}")
    if period_year:
        params.append(period_year)
        conditions.append(f"t.period_year = ${len(params)}")

    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            f"""SELECT t.*, u.full_name AS recruiter_name,
                       (SELECT COUNT(*) FROM applications a
                        WHERE a.assigned_recruiter_id = t.recruiter_id
                          AND EXTRACT(MONTH FROM a.created_at) = t.period_month
                          AND EXTRACT(YEAR FROM a.created_at) = t.period_year) AS actual_submissions
                FROM recruiter_targets t
                JOIN users u ON u.id = t.recruiter_id
                WHERE {' AND '.join(conditions)}
                ORDER BY t.period_year DESC, t.period_month DESC""",
            *params,
        )
    return [dict(r) for r in rows]


@targets_router.post("")
async def create_target(body: TargetIn, actor: Actor = Depends(require_role("admin", "super_admin", "manager"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """INSERT INTO recruiter_targets
                 (tenant_id, recruiter_id, period_month, period_year, target_submissions,
                  target_interviews, target_placements, target_work_hours, notes, created_by)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
               RETURNING *""",
            actor.tenant_id, body.recruiter_id, body.period_month, body.period_year,
            body.target_submissions, body.target_interviews, body.target_placements,
            body.target_work_hours, body.notes, actor.user_id,
        )
    return dict(row)


@targets_router.patch("/{target_id}")
async def update_target(target_id: str, body: TargetIn, actor: Actor = Depends(require_role("admin", "super_admin", "manager"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """UPDATE recruiter_targets SET
                 target_submissions=$1, target_interviews=$2, target_placements=$3,
                 target_work_hours=$4, notes=$5, updated_at=now()
               WHERE id=$6 AND tenant_id=$7 RETURNING *""",
            body.target_submissions, body.target_interviews, body.target_placements,
            body.target_work_hours, body.notes, target_id, actor.tenant_id,
        )
        if not row:
            raise HTTPException(404, "Target not found")
    return dict(row)


# ── Tasks ────────────────────────────────────────────────────
class TaskIn(BaseModel):
    recruiter_id: str
    task_type: str = "general"
    title: str
    description: Optional[str] = None
    priority: str = "medium"
    due_at: Optional[datetime] = None
    requisition_id: Optional[str] = None
    application_id: Optional[str] = None


@tasks_router.get("")
async def list_tasks(recruiter_id: Optional[str] = None, status: Optional[str] = None,
                      actor: Actor = Depends(get_actor)):
    conditions = ["tenant_id = $1"]
    params: list = [actor.tenant_id]
    if recruiter_id:
        params.append(recruiter_id)
        conditions.append(f"recruiter_id = ${len(params)}")
    if status:
        params.append(status)
        conditions.append(f"status = ${len(params)}")

    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            f"""SELECT * FROM recruiter_tasks WHERE {' AND '.join(conditions)}
                ORDER BY (status = 'completed'), due_at NULLS LAST""",
            *params,
        )
    return [dict(r) for r in rows]


@tasks_router.post("")
async def create_task(body: TaskIn, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """INSERT INTO recruiter_tasks
                 (tenant_id, recruiter_id, requisition_id, application_id, task_type,
                  title, description, priority, due_at, status)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending')
               RETURNING *""",
            actor.tenant_id, body.recruiter_id, body.requisition_id, body.application_id,
            body.task_type, body.title, body.description, body.priority, body.due_at,
        )
    return dict(row)


@tasks_router.patch("/{task_id}")
async def update_task_status(task_id: str, status: str, actor: Actor = Depends(get_actor)):
    if status not in ("pending", "in_progress", "completed", "cancelled"):
        raise HTTPException(400, "Invalid status")
    completed_at_clause = "completed_at = now()" if status == "completed" else "completed_at = NULL"
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            f"""UPDATE recruiter_tasks SET status=$1, {completed_at_clause}, updated_at=now()
                WHERE id=$2 AND tenant_id=$3 RETURNING *""",
            status, task_id, actor.tenant_id,
        )
        if not row:
            raise HTTPException(404, "Task not found")
    return dict(row)


# ── Hotlist ──────────────────────────────────────────────────
class HotlistIn(BaseModel):
    candidate_id: str
    available_from: Optional[date] = None
    reason: Optional[str] = None
    notes: Optional[str] = None


@hotlist_router.get("")
async def list_hotlist(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            """SELECT h.*, c.full_name, c.email, c.phone
               FROM hotlist h JOIN candidates c ON c.id = h.candidate_id
               WHERE h.tenant_id = $1
               ORDER BY h.available_from NULLS LAST, h.created_at DESC""",
            actor.tenant_id,
        )
    return [dict(r) for r in rows]


@hotlist_router.post("")
async def add_to_hotlist(body: HotlistIn, actor: Actor = Depends(get_actor)):
    if body.reason and body.reason not in ("bench", "contract_ending", "other"):
        raise HTTPException(400, "reason must be one of: bench, contract_ending, other")
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """INSERT INTO hotlist (tenant_id, candidate_id, available_from, reason, notes)
               VALUES ($1,$2,$3,$4,$5) RETURNING *""",
            actor.tenant_id, body.candidate_id, body.available_from, body.reason, body.notes,
        )
    return dict(row)


@hotlist_router.delete("/{hotlist_id}")
async def remove_from_hotlist(hotlist_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        result = await conn.execute(
            "DELETE FROM hotlist WHERE id=$1 AND tenant_id=$2", hotlist_id, actor.tenant_id,
        )
        if result == "DELETE 0":
            raise HTTPException(404, "Not found")
    return {"deleted": True}


# ═══════════════════════════════════ Availability / Leave (approved item 09) ═══
class LeaveIn(BaseModel):
    recruiter_id: str
    leave_type: str = "other"
    start_date: date
    end_date: date
    notes: Optional[str] = None


@leave_router.get("")
async def list_leave(recruiter_id: Optional[str] = None, upcoming_only: bool = False, actor: Actor = Depends(get_actor)):
    conditions = ["l.tenant_id=$1"]
    params: list = [actor.tenant_id]
    if recruiter_id:
        params.append(recruiter_id)
        conditions.append(f"l.recruiter_id=${len(params)}")
    if upcoming_only:
        conditions.append("l.end_date >= CURRENT_DATE")
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            f"""SELECT l.*, u.full_name AS recruiter_name FROM recruiter_leave l
                JOIN users u ON u.id = l.recruiter_id
                WHERE {' AND '.join(conditions)} ORDER BY l.start_date DESC""",
            *params,
        )
    return [dict(r) for r in rows]


@leave_router.post("")
async def create_leave(body: LeaveIn, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """INSERT INTO recruiter_leave (tenant_id, recruiter_id, leave_type, start_date, end_date, notes, created_by)
               VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *""",
            actor.tenant_id, body.recruiter_id, body.leave_type, body.start_date, body.end_date,
            body.notes, actor.user_id,
        )
    return dict(row)


@leave_router.delete("/{leave_id}")
async def delete_leave(leave_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        result = await conn.execute(
            "DELETE FROM recruiter_leave WHERE id=$1 AND tenant_id=$2", leave_id, actor.tenant_id,
        )
        if result == "DELETE 0":
            raise HTTPException(404, "Not found")
    return {"deleted": True}
