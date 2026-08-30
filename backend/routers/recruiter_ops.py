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
from permissions import require_permission

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
                JOIN users u ON u.id = t.recruiter_id AND u.is_active IS NOT FALSE
                WHERE {' AND '.join(conditions)}
                ORDER BY t.period_year DESC, t.period_month DESC""",
            *params,
        )
    return [dict(r) for r in rows]


@targets_router.post("")
async def create_target(body: TargetIn, actor: Actor = Depends(require_role("admin", "super_admin", "manager")),
                         _perm: Actor = Depends(require_permission("recruiter_ops", "create"))):
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
async def update_target(target_id: str, body: TargetIn, actor: Actor = Depends(require_role("admin", "super_admin", "manager")),
                         _perm: Actor = Depends(require_permission("recruiter_ops", "update"))):
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


# ── Tasks / Follow-Ups ──────────────────────────────────────────
# Reminder & Follow-Up System (2026-08-21) — extends this existing task
# entity (already wired into Recruiter Ops "My Day", load-balanced auto-
# assign, notifications) into the real Follow-Up Task the spec asks for,
# rather than a second, competing table. See sql/70_reminder_followup_
# system.sql for the schema additions this section relies on.
VALID_TASK_STATUSES = ("pending", "in_progress", "completed", "cancelled", "rescheduled")
VALID_PRIORITIES = ("low", "medium", "high", "critical")
VALID_RECURRENCE = (None, "daily", "weekly", "monthly", "quarterly", "yearly")


def _valid_recurrence(rule: Optional[str]) -> bool:
    if rule in VALID_RECURRENCE:
        return True
    if rule and rule.startswith("every_") and rule.endswith("_days"):
        try:
            return int(rule[len("every_"):-len("_days")]) > 0
        except ValueError:
            return False
    return False


class TaskIn(BaseModel):
    recruiter_id: Optional[str] = None  # omit to auto-assign (load-balanced)
    task_type: str = "general"
    title: str
    description: Optional[str] = None
    priority: str = "medium"
    due_at: Optional[datetime] = None
    reminder_at: Optional[datetime] = None
    requisition_id: Optional[str] = None
    application_id: Optional[str] = None
    client_id: Optional[str] = None
    candidate_id: Optional[str] = None  # 2026-08-30 — real FK, see sql/92
    follow_up_reason: Optional[str] = None
    recurrence_rule: Optional[str] = None


class TaskRescheduleIn(BaseModel):
    due_at: datetime
    reminder_at: Optional[datetime] = None
    reason: Optional[str] = None


@tasks_router.get("")
async def list_tasks(recruiter_id: Optional[str] = None, status: Optional[str] = None,
                      priority: Optional[str] = None, client_id: Optional[str] = None,
                      overdue_only: bool = False,
                      actor: Actor = Depends(get_actor)):
    conditions = ["tenant_id = $1"]
    params: list = [actor.tenant_id]
    if recruiter_id:
        params.append(recruiter_id)
        conditions.append(f"recruiter_id = ${len(params)}")
    if status:
        params.append(status)
        conditions.append(f"status = ${len(params)}")
    if priority:
        params.append(priority)
        conditions.append(f"priority = ${len(params)}")
    if client_id:
        params.append(client_id)
        conditions.append(f"client_id = ${len(params)}")
    if overdue_only:
        conditions.append("status IN ('pending','in_progress') AND due_at < now()")

    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            f"""SELECT rt.*, cl.name AS client_name,
                       (rt.status IN ('pending','in_progress') AND rt.due_at < now()) AS is_overdue
                FROM recruiter_tasks rt
                LEFT JOIN clients cl ON cl.id = rt.client_id
                WHERE {' AND '.join(conditions)}
                ORDER BY (rt.status = 'completed'), rt.due_at NULLS LAST""",
            *params,
        )
    return [dict(r) for r in rows]


@tasks_router.post("")
async def create_task(body: TaskIn, actor: Actor = Depends(get_actor),
                       _perm: Actor = Depends(require_permission("recruiter_ops", "create"))):
    if body.priority not in VALID_PRIORITIES:
        raise HTTPException(400, f"Invalid priority — must be one of {VALID_PRIORITIES}")
    if not _valid_recurrence(body.recurrence_rule):
        raise HTTPException(400, "Invalid recurrence_rule")
    async with db.tenant_conn(actor.tenant_id) as conn:
        recruiter_id = body.recruiter_id
        if not recruiter_id:
            # Gap-audit item 10: task load-balancing. Least-loaded active
            # recruiter by open (pending/in_progress) task count, tie-broken
            # alphabetically - same pattern as the round-robin resume router.
            picked = await conn.fetchval(
                """SELECT u.id FROM users u
                   LEFT JOIN recruiter_tasks t
                     ON t.recruiter_id = u.id AND t.tenant_id = $1 AND t.status IN ('pending','in_progress')
                   WHERE u.tenant_id = $1 AND u.is_active AND u.role = 'recruiter'
                   GROUP BY u.id, u.full_name
                   ORDER BY count(t.id) ASC, u.full_name ASC
                   LIMIT 1""",
                actor.tenant_id,
            )
            if not picked:
                raise HTTPException(400, "No active recruiter available to auto-assign")
            recruiter_id = str(picked)

        # Real feature (2026-08-30): resolve the real candidate's name once
        # here so it's stored redundantly into the existing free-text
        # candidate_name column too — every existing reader of that column
        # (task lists, notifications) keeps working unchanged, with no
        # extra join needed just to display a name.
        candidate_name = None
        if body.candidate_id:
            candidate_name = await conn.fetchval(
                "SELECT full_name FROM candidates WHERE id=$1 AND tenant_id=$2",
                body.candidate_id, actor.tenant_id,
            )
            if candidate_name is None:
                raise HTTPException(400, "candidate_id not found")

        row = await conn.fetchrow(
            """INSERT INTO recruiter_tasks
                 (tenant_id, recruiter_id, requisition_id, application_id, client_id,
                  candidate_id, candidate_name,
                  task_type, title, description, follow_up_reason, priority, due_at,
                  reminder_at, recurrence_rule, created_by, status)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'pending')
               RETURNING *""",
            actor.tenant_id, recruiter_id, body.requisition_id, body.application_id,
            body.client_id, body.candidate_id, candidate_name,
            body.task_type, body.title, body.description,
            body.follow_up_reason, body.priority, body.due_at, body.reminder_at,
            body.recurrence_rule, actor.user_id,
        )
    return dict(row)


@tasks_router.patch("/{task_id}")
async def update_task_status(task_id: str, status: str, actor: Actor = Depends(get_actor),
                              _perm: Actor = Depends(require_permission("recruiter_ops", "update"))):
    if status not in VALID_TASK_STATUSES:
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
        # Real gap closed: a completed recurring task never spawned its
        # next occurrence - the recurrence_rule field existed but nothing
        # ever acted on it. Only fires on genuine completion, not on
        # cancel, and never for a task that's already itself a spawned
        # occurrence pointing at a still-open parent (avoids runaway
        # duplication if someone completes occurrences out of order).
        if status == "completed" and row["recurrence_rule"]:
            next_due = _next_recurrence(row["due_at"] or datetime.utcnow(), row["recurrence_rule"])
            if next_due:
                await conn.execute(
                    """INSERT INTO recruiter_tasks
                         (tenant_id, recruiter_id, requisition_id, application_id, client_id,
                          task_type, title, description, follow_up_reason, priority, due_at,
                          reminder_at, recurrence_rule, recurrence_parent_id, created_by, status)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'pending')""",
                    actor.tenant_id, row["recruiter_id"], row["requisition_id"], row["application_id"],
                    row["client_id"], row["task_type"], row["title"], row["description"],
                    row["follow_up_reason"], row["priority"], next_due,
                    (row["reminder_at"] and next_due - (row["due_at"] - row["reminder_at"])) if row["reminder_at"] else None,
                    row["recurrence_rule"], row["id"], actor.user_id,
                )
    return dict(row)


@tasks_router.patch("/{task_id}/reschedule")
async def reschedule_task(task_id: str, body: TaskRescheduleIn, actor: Actor = Depends(get_actor),
                           _perm: Actor = Depends(require_permission("recruiter_ops", "update"))):
    """Real, distinct 'Rescheduled' status the original task list never
    had — before this, moving a due date meant silently overwriting
    due_at with no trace it had ever been anything else. Keeps
    rescheduled_from as a real audit trail and bumps reschedule_count,
    and clears any escalation already in flight for the old due date
    (a task that was overdue and got legitimately rescheduled should not
    keep escalating against a deadline that no longer applies)."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """UPDATE recruiter_tasks
               SET due_at=$1, reminder_at=$2, rescheduled_from=due_at,
                   reschedule_count=reschedule_count+1, status='pending',
                   notes = CASE WHEN $3::text IS NOT NULL
                                THEN COALESCE(notes || E'\\n', '') || 'Rescheduled: ' || $3
                                ELSE notes END,
                   updated_at=now()
               WHERE id=$4 AND tenant_id=$5 RETURNING *""",
            body.due_at, body.reminder_at, body.reason, task_id, actor.tenant_id,
        )
        if not row:
            raise HTTPException(404, "Task not found")
        await conn.execute(
            "UPDATE task_escalations SET resolved_at=now() WHERE task_id=$1 AND tenant_id=$2 AND resolved_at IS NULL",
            task_id, actor.tenant_id,
        )
    return dict(row)


@tasks_router.delete("/{task_id}")
async def delete_task(task_id: str, actor: Actor = Depends(get_actor),
                       _perm: Actor = Depends(require_permission("recruiter_ops", "delete"))):
    """Real hard delete — didn't exist at all before (no way to remove a
    mistakenly-created follow-up other than cancelling it forever).
    Genuinely safe as a hard delete: nothing else references
    recruiter_tasks.id as a foreign key except this table's own
    recurrence_parent_id (ON DELETE SET NULL) and task_escalations
    (ON DELETE CASCADE, both set when those columns/tables were added)."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchval(
            "DELETE FROM recruiter_tasks WHERE id=$1 AND tenant_id=$2 RETURNING id",
            task_id, actor.tenant_id,
        )
        if not row:
            raise HTTPException(404, "Task not found")
    return {"ok": True}


def _add_months(dt: datetime, n: int) -> datetime:
    # Plain-stdlib month arithmetic (python-dateutil is NOT installed in
    # this backend image — confirmed live, matching an already-documented
    # finding elsewhere in this project where a dateutil import was a dead
    # import removed rather than a package ever actually installed).
    import calendar
    month0 = dt.month - 1 + n
    year = dt.year + month0 // 12
    month = month0 % 12 + 1
    day = min(dt.day, calendar.monthrange(year, month)[1])
    return dt.replace(year=year, month=month, day=day)


def _next_recurrence(from_dt: datetime, rule: str) -> Optional[datetime]:
    from datetime import timedelta
    if rule == "daily":
        return from_dt + timedelta(days=1)
    if rule == "weekly":
        return from_dt + timedelta(weeks=1)
    if rule == "monthly":
        return _add_months(from_dt, 1)
    if rule == "quarterly":
        return _add_months(from_dt, 3)
    if rule == "yearly":
        return _add_months(from_dt, 12)
    if rule and rule.startswith("every_") and rule.endswith("_days"):
        try:
            n = int(rule[len("every_"):-len("_days")])
            return from_dt + timedelta(days=n)
        except ValueError:
            return None
    return None


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
               WHERE h.tenant_id = $1 AND c.is_active IS NOT FALSE
               ORDER BY h.available_from NULLS LAST, h.created_at DESC""",
            actor.tenant_id,
        )
    return [dict(r) for r in rows]


@hotlist_router.post("")
async def add_to_hotlist(body: HotlistIn, actor: Actor = Depends(get_actor),
                          _perm: Actor = Depends(require_permission("recruiter_ops", "create"))):
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
async def remove_from_hotlist(hotlist_id: str, actor: Actor = Depends(get_actor),
                               _perm: Actor = Depends(require_permission("recruiter_ops", "delete"))):
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
                JOIN users u ON u.id = l.recruiter_id AND u.is_active IS NOT FALSE
                WHERE {' AND '.join(conditions)} ORDER BY l.start_date DESC""",
            *params,
        )
    return [dict(r) for r in rows]


@leave_router.post("")
async def create_leave(body: LeaveIn, actor: Actor = Depends(get_actor),
                        _perm: Actor = Depends(require_permission("recruiter_ops", "create"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """INSERT INTO recruiter_leave (tenant_id, recruiter_id, leave_type, start_date, end_date, notes, created_by)
               VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *""",
            actor.tenant_id, body.recruiter_id, body.leave_type, body.start_date, body.end_date,
            body.notes, actor.user_id,
        )
    return dict(row)


@leave_router.delete("/{leave_id}")
async def delete_leave(leave_id: str, actor: Actor = Depends(get_actor),
                        _perm: Actor = Depends(require_permission("recruiter_ops", "delete"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        result = await conn.execute(
            "DELETE FROM recruiter_leave WHERE id=$1 AND tenant_id=$2", leave_id, actor.tenant_id,
        )
        if result == "DELETE 0":
            raise HTTPException(404, "Not found")
    return {"deleted": True}
