"""Reminder & Follow-Up Management System (2026-08-21).

Sits alongside recruiter_ops.py's tasks_router (the real Follow-Up Task
entity, extended from the existing recruiter_tasks table — see
sql/70_reminder_followup_system.sql). This file holds the genuinely new
pieces: the cross-cutting Reminder Dashboard, document expiry tracking,
and the two tenant-tunable config surfaces (escalation grace periods,
interview reminder lead times).
"""
from datetime import date, datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import db
from deps import Actor, get_actor
from permissions import require_permission

dashboard_router = APIRouter(prefix="/reminders", tags=["reminders"])
doc_expiry_router = APIRouter(prefix="/document-expiry", tags=["document-expiry"])
escalation_config_router = APIRouter(prefix="/escalation-config", tags=["escalation-config"])
interview_reminder_config_router = APIRouter(prefix="/interview-reminder-config", tags=["interview-reminder-config"])


# ── Reminder Dashboard ──────────────────────────────────────────────────
@dashboard_router.get("/dashboard")
async def reminder_dashboard(team_view: bool = False, actor: Actor = Depends(get_actor)):
    """Today's Reminders / Upcoming / Overdue / Critical Follow-Ups /
    Pending Interviews / Expiring Documents / Recruiter Action Items in
    one call. `team_view=true` (admin/manager/KAE/KAM only — a plain
    recruiter always sees their own) drops the recruiter_id filter."""
    is_manager_role = actor.role in ("admin", "manager", "kae", "kam", "sales_manager", "hr_manager") or actor.role is None
    scope_team = team_view and is_manager_role

    async with db.tenant_conn(actor.tenant_id) as conn:
        task_cond = "" if scope_team else "AND rt.recruiter_id = $2"
        params = [actor.tenant_id] if scope_team else [actor.tenant_id, actor.user_id]

        due_today = await conn.fetch(
            f"""SELECT rt.*, cl.name AS client_name FROM recruiter_tasks rt
                LEFT JOIN clients cl ON cl.id = rt.client_id
                WHERE rt.tenant_id=$1 {task_cond} AND rt.status IN ('pending','in_progress')
                  AND rt.due_at::date = CURRENT_DATE
                ORDER BY rt.due_at""", *params)
        due_this_week = await conn.fetch(
            f"""SELECT rt.*, cl.name AS client_name FROM recruiter_tasks rt
                LEFT JOIN clients cl ON cl.id = rt.client_id
                WHERE rt.tenant_id=$1 {task_cond} AND rt.status IN ('pending','in_progress')
                  AND rt.due_at > CURRENT_DATE AND rt.due_at <= CURRENT_DATE + INTERVAL '7 days'
                ORDER BY rt.due_at""", *params)
        overdue = await conn.fetch(
            f"""SELECT rt.*, cl.name AS client_name FROM recruiter_tasks rt
                LEFT JOIN clients cl ON cl.id = rt.client_id
                WHERE rt.tenant_id=$1 {task_cond} AND rt.status IN ('pending','in_progress')
                  AND rt.due_at < now()
                ORDER BY rt.due_at""", *params)
        critical = await conn.fetch(
            f"""SELECT rt.*, cl.name AS client_name FROM recruiter_tasks rt
                LEFT JOIN clients cl ON cl.id = rt.client_id
                WHERE rt.tenant_id=$1 {task_cond} AND rt.status IN ('pending','in_progress')
                  AND rt.priority = 'critical'
                ORDER BY rt.due_at NULLS LAST""", *params)

        interview_cond = "" if scope_team else "AND i.interviewer_id = $2"
        upcoming_interviews = await conn.fetch(
            f"""SELECT i.id, i.interview_type, i.scheduled_at, i.mode, i.meeting_link,
                       c.full_name AS candidate_name
                FROM interview_schedules i
                LEFT JOIN candidates c ON c.id = i.candidate_id
                WHERE i.tenant_id=$1 {interview_cond} AND i.status='scheduled'
                  AND i.scheduled_at BETWEEN now() AND now() + INTERVAL '48 hours'
                ORDER BY i.scheduled_at""", *params)

        expiring_documents = await conn.fetch(
            """SELECT d.id, d.document_type, d.document_name, d.expires_at,
                      c.full_name AS candidate_name,
                      (d.expires_at - CURRENT_DATE) AS days_left
               FROM document_expiry_tracking d
               LEFT JOIN candidates c ON c.id = d.candidate_id
               WHERE d.tenant_id=$1 AND d.status='active'
                 AND d.expires_at <= CURRENT_DATE + INTERVAL '30 days'
               ORDER BY d.expires_at""", actor.tenant_id)

    return {
        "scope": "team" if scope_team else "personal",
        "due_today": [dict(r) for r in due_today],
        "due_this_week": [dict(r) for r in due_this_week],
        "overdue": [dict(r) for r in overdue],
        "critical": [dict(r) for r in critical],
        "upcoming_interviews": [dict(r) for r in upcoming_interviews],
        "expiring_documents": [dict(r) for r in expiring_documents],
        "counts": {
            "due_today": len(due_today), "due_this_week": len(due_this_week),
            "overdue": len(overdue), "critical": len(critical),
            "upcoming_interviews": len(upcoming_interviews),
            "expiring_documents": len(expiring_documents),
        },
    }


@dashboard_router.get("/reports")
async def reminder_reports(days: int = 30, actor: Actor = Depends(get_actor),
                            _perm: Actor = Depends(require_permission("reminders", "read"))):
    """Follow-Up Completion Rate / Overdue Tasks / Team Productivity /
    Reminder Response Time — plain SQL aggregates, zero-token."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        summary = await conn.fetchrow(
            """SELECT
                 count(*) AS total,
                 count(*) FILTER (WHERE status='completed') AS completed,
                 count(*) FILTER (WHERE status IN ('pending','in_progress') AND due_at < now()) AS overdue,
                 count(*) FILTER (WHERE status='cancelled') AS cancelled,
                 round(avg(EXTRACT(EPOCH FROM (completed_at - created_at)) / 3600)
                       FILTER (WHERE status='completed' AND completed_at IS NOT NULL), 1) AS avg_response_hours
               FROM recruiter_tasks
               WHERE tenant_id=$1 AND created_at >= now() - ($2::text || ' days')::interval""",
            actor.tenant_id, str(days))
        # REAL BUG FIX (2026-08-24): no u.is_active filter at all -- every
        # deactivated/QA-test recruiter who ever had a task stayed in this
        # report forever, indistinguishable from real active recruiters.
        # Same "missing is_active on a joined users table" class documented
        # repeatedly elsewhere in this project (Team Leaderboard, Incentives
        # scorecard list, KPI export, owner_json subquery, etc.).
        by_recruiter = await conn.fetch(
            """SELECT u.full_name, u.id AS recruiter_id,
                      count(*) AS total,
                      count(*) FILTER (WHERE t.status='completed') AS completed,
                      count(*) FILTER (WHERE t.status IN ('pending','in_progress') AND t.due_at < now()) AS overdue
               FROM recruiter_tasks t
               JOIN users u ON u.id = t.recruiter_id AND u.is_active IS NOT FALSE
               WHERE t.tenant_id=$1 AND t.created_at >= now() - ($2::text || ' days')::interval
               GROUP BY u.id, u.full_name ORDER BY total DESC""",
            actor.tenant_id, str(days))
    total = summary["total"] or 0
    completion_rate = round((summary["completed"] or 0) / total * 100, 1) if total else 0.0
    return {
        "period_days": days,
        "total_tasks": total,
        "completed": summary["completed"] or 0,
        "overdue": summary["overdue"] or 0,
        "cancelled": summary["cancelled"] or 0,
        "completion_rate_pct": completion_rate,
        "avg_response_hours": float(summary["avg_response_hours"]) if summary["avg_response_hours"] is not None else None,
        "by_recruiter": [dict(r) for r in by_recruiter],
    }


# ── Document Expiry Tracking ────────────────────────────────────────────
class DocExpiryIn(BaseModel):
    candidate_id: Optional[str] = None
    document_type: str
    document_name: str
    expires_at: date
    reference_table: Optional[str] = None
    reference_id: Optional[str] = None
    notes: Optional[str] = None


VALID_DOC_TYPES = ("nda", "contract", "visa", "certification", "offer_letter", "kyc")


@doc_expiry_router.get("")
async def list_document_expiry(status: Optional[str] = None, document_type: Optional[str] = None,
                                actor: Actor = Depends(get_actor)):
    conditions = ["d.tenant_id = $1"]
    params: list = [actor.tenant_id]
    if status:
        params.append(status); conditions.append(f"d.status = ${len(params)}")
    if document_type:
        params.append(document_type); conditions.append(f"d.document_type = ${len(params)}")
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            f"""SELECT d.*, c.full_name AS candidate_name,
                       (d.expires_at - CURRENT_DATE) AS days_left
                FROM document_expiry_tracking d
                LEFT JOIN candidates c ON c.id = d.candidate_id
                WHERE {' AND '.join(conditions)}
                ORDER BY d.expires_at""", *params)
    return [dict(r) for r in rows]


@doc_expiry_router.post("")
async def create_document_expiry(body: DocExpiryIn, actor: Actor = Depends(get_actor),
                                  _perm: Actor = Depends(require_permission("reminders", "create"))):
    if body.document_type not in VALID_DOC_TYPES:
        raise HTTPException(400, f"Invalid document_type — must be one of {VALID_DOC_TYPES}")
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """INSERT INTO document_expiry_tracking
                 (tenant_id, candidate_id, document_type, document_name, expires_at,
                  reference_table, reference_id, notes, created_by)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *""",
            actor.tenant_id, body.candidate_id, body.document_type, body.document_name,
            body.expires_at, body.reference_table, body.reference_id, body.notes, actor.user_id,
        )
    return dict(row)


@doc_expiry_router.patch("/{doc_id}")
async def update_document_expiry_status(doc_id: str, status: str, actor: Actor = Depends(get_actor),
                                         _perm: Actor = Depends(require_permission("reminders", "update"))):
    if status not in ("active", "expired", "renewed", "cancelled"):
        raise HTTPException(400, "Invalid status")
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "UPDATE document_expiry_tracking SET status=$1, updated_at=now() WHERE id=$2 AND tenant_id=$3 RETURNING *",
            status, doc_id, actor.tenant_id)
        if not row:
            raise HTTPException(404, "Not found")
    return dict(row)


@doc_expiry_router.delete("/{doc_id}")
async def delete_document_expiry(doc_id: str, actor: Actor = Depends(get_actor),
                                  _perm: Actor = Depends(require_permission("reminders", "delete"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchval(
            "DELETE FROM document_expiry_tracking WHERE id=$1 AND tenant_id=$2 RETURNING id",
            doc_id, actor.tenant_id)
        if not row:
            raise HTTPException(404, "Not found")
    return {"ok": True}


# ── Escalation Config ────────────────────────────────────────────────────
class EscalationConfigIn(BaseModel):
    tier1_grace_hours: int
    tier2_grace_hours: int
    tier3_grace_hours: int
    tier4_grace_hours: int
    critical_multiplier: float


@escalation_config_router.get("")
async def get_escalation_config(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("SELECT * FROM escalation_config WHERE tenant_id=$1", actor.tenant_id)
        if not row:
            row = await conn.fetchrow(
                "INSERT INTO escalation_config (tenant_id) VALUES ($1) RETURNING *", actor.tenant_id)
    return dict(row)


@escalation_config_router.put("")
async def update_escalation_config(body: EscalationConfigIn, actor: Actor = Depends(get_actor),
                                    _perm: Actor = Depends(require_permission("reminders", "update"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """INSERT INTO escalation_config (tenant_id, tier1_grace_hours, tier2_grace_hours,
                   tier3_grace_hours, tier4_grace_hours, critical_multiplier, updated_at)
               VALUES ($1,$2,$3,$4,$5,$6,now())
               ON CONFLICT (tenant_id) DO UPDATE SET
                 tier1_grace_hours=EXCLUDED.tier1_grace_hours, tier2_grace_hours=EXCLUDED.tier2_grace_hours,
                 tier3_grace_hours=EXCLUDED.tier3_grace_hours, tier4_grace_hours=EXCLUDED.tier4_grace_hours,
                 critical_multiplier=EXCLUDED.critical_multiplier, updated_at=now()
               RETURNING *""",
            actor.tenant_id, body.tier1_grace_hours, body.tier2_grace_hours,
            body.tier3_grace_hours, body.tier4_grace_hours, body.critical_multiplier,
        )
    return dict(row)


# ── Interview Reminder Config ────────────────────────────────────────────
class InterviewReminderConfigIn(BaseModel):
    lead_times_hours: list[float]


@interview_reminder_config_router.get("")
async def get_interview_reminder_config(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("SELECT * FROM interview_reminder_config WHERE tenant_id=$1", actor.tenant_id)
        if not row:
            row = await conn.fetchrow(
                "INSERT INTO interview_reminder_config (tenant_id) VALUES ($1) RETURNING *", actor.tenant_id)
    return dict(row)


@interview_reminder_config_router.put("")
async def update_interview_reminder_config(body: InterviewReminderConfigIn, actor: Actor = Depends(get_actor),
                                            _perm: Actor = Depends(require_permission("reminders", "update"))):
    if not body.lead_times_hours or any(h <= 0 for h in body.lead_times_hours):
        raise HTTPException(400, "lead_times_hours must be a non-empty list of positive hour values")
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """INSERT INTO interview_reminder_config (tenant_id, lead_times_hours, updated_at)
               VALUES ($1,$2,now())
               ON CONFLICT (tenant_id) DO UPDATE SET lead_times_hours=EXCLUDED.lead_times_hours, updated_at=now()
               RETURNING *""",
            actor.tenant_id, body.lead_times_hours,
        )
    return dict(row)
