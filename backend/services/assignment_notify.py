"""Shared assignment-notification + kickoff-task logic (2026-08-24).

Both POST /assignments (manual, assignments.py) and
POST /requisitions/{id}/assign (auto, requisitions.py) create a brand-new
active assignment the same way — this is the ONE place both call so a
newly-assigned recruiter reliably gets notified and a kickoff task,
regardless of which path assigned them. Reused by nothing else — a
reassignment already has its own real audit trail (do_reassign()) and
gets the same treatment via _notify_and_task_on_reassign below, called
from assignments.py's /reassign endpoint.

Biggest confirmed real gap from the research pass: a recruiter previously
found out they'd been assigned only by noticing it themselves — this
closes that, in-app only for v1 (matching how most routine, non-critical
notifications already work in this codebase — no email/WhatsApp side
effect for a routine assignment, unlike a HARD-RULE-#10 reassignment or
an SLA escalation)."""

import asyncpg


async def notify_and_task_on_assign(
    conn: asyncpg.Connection, tenant_id: str, *,
    requisition_id: str, recruiter_id: str, assigned_by_user_id: str | None,
) -> None:
    req = await conn.fetchrow(
        "SELECT title, priority, client_id FROM requisitions WHERE id=$1 AND tenant_id=$2",
        requisition_id, tenant_id,
    )
    if not req:
        return

    await conn.execute(
        """INSERT INTO notifications (tenant_id, user_id, recipient_user_id, title, body, type, resource, resource_id, channel)
           VALUES ($1,$2,$2,$3,$4,'info','requisition',$5,'inapp')""",
        tenant_id, recruiter_id,
        f"New assignment: {req['title']}",
        f"You've been assigned to \"{req['title']}\" (priority: {req['priority']}).",
        requisition_id,
    )

    await conn.execute(
        """INSERT INTO recruiter_tasks
             (tenant_id, requisition_id, req_title, client_id, recruiter_id, task_type, title,
              description, priority, due_at, created_by)
           VALUES ($1,$2,$3,$4,$5,'assignment_kickoff',$6,$7,$8, now() + interval '2 days', $9)""",
        tenant_id, requisition_id, req["title"], req["client_id"], recruiter_id,
        f"Get started: {req['title']}",
        "New requisition assignment — review the JD, confirm sourcing plan, and make first contact with any real candidates on file.",
        req["priority"] or "medium", assigned_by_user_id,
    )


async def notify_on_reassign(
    conn: asyncpg.Connection, tenant_id: str, *,
    requisition_id: str, new_recruiter_id: str, reason: str | None,
) -> None:
    """Lighter-weight than the assign path — a reassignment already gets a
    full audit trail (do_reassign()) and, for the outgoing recruiter, a
    kickoff task is meaningless (they're being taken OFF it). Just notify
    the incoming recruiter."""
    req = await conn.fetchrow(
        "SELECT title, priority FROM requisitions WHERE id=$1 AND tenant_id=$2", requisition_id, tenant_id
    )
    if not req:
        return
    body = f"You've been reassigned to \"{req['title']}\" (priority: {req['priority']})."
    if reason:
        body += f" Reason: {reason}"
    await conn.execute(
        """INSERT INTO notifications (tenant_id, user_id, recipient_user_id, title, body, type, resource, resource_id, channel)
           VALUES ($1,$2,$2,$3,$4,'info','requisition',$5,'inapp')""",
        tenant_id, new_recruiter_id, f"Reassigned to you: {req['title']}", body, requisition_id,
    )
