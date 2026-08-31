"""Requisition <-> recruiter assignments.

HARD RULE #10: reassignment is a high-stakes, HITL-gated action
(admin/manager only) — writes assignment_event 'reassigned' +
audit_log, marks the old assignment 'reassigned' and creates a new
'active' assignment for the new recruiter.
"""

from decimal import Decimal

import asyncpg
from fastapi import APIRouter, Depends, HTTPException

import db
import events
from deps import Actor, get_actor, require_role
from schemas import AssignmentCreate, ReassignRequest
from services import assignment_notify
from routers.ops_gaps import is_auto_assign_enabled

router = APIRouter(prefix="/assignments", tags=["assignments"])

FIELDS = """id, tenant_id, requisition_id, recruiter_id, status, match_score,
            assigned_at, updated_at"""


def _workload_label(available_capacity, capacity_weekly) -> str:
    """Same bucket thresholds as assign_with_explanation()'s SQL CASE, so
    manual assignment shows the identical High/Medium/Low signal as
    Auto-Assign for the same recruiter - not a second, drifting rule."""
    if not capacity_weekly:
        return "High"
    ratio = (available_capacity or 0) / capacity_weekly
    if ratio >= 0.6:
        return "Low"
    if ratio >= 0.3:
        return "Medium"
    return "High"


async def _recruiter_match_detail(conn, requisition_id: str, recruiter_id: str) -> dict | None:
    """Reuses match_recruiters() (the one real, already-tested scoring
    engine) to fetch the same full factor breakdown for a SPECIFIC,
    already-chosen recruiter - a generous limit so a manually-picked
    recruiter who wouldn't rank in a small top-N call still shows up.
    Returns None if the recruiter isn't a currently-eligible match at all
    (e.g. blocked on this client) - callers fall back to a bare response
    rather than failing the whole assignment over a missing tooltip."""
    rows = await conn.fetch("SELECT * FROM match_recruiters($1, $2)", requisition_id, 1000)
    for r in rows:
        if str(r["recruiter_id"]) == str(recruiter_id):
            d = dict(r)
            d["workload_label"] = _workload_label(d["available_capacity"], d["capacity_weekly"])
            return d
    return None


@router.get("")
async def list_assignments(requisition_id: str | None = None, actor: Actor = Depends(get_actor)):
    conditions: list[str] = []
    params: list = []
    if requisition_id:
        params.append(requisition_id)
        conditions.append(f"requisition_id = ${len(params)}")

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(f"SELECT {FIELDS} FROM assignments {where} ORDER BY assigned_at DESC", *params)
    return [dict(r) for r in rows]


@router.post("")
async def create_assignment(
    body: AssignmentCreate, actor: Actor = Depends(require_role("admin", "manager", "kae"))
):
    """Recommendation 4 (recruiter-assignment gap analysis): initial manual
    assign had no role gate at all — any authenticated user (including a
    recruiter) could assign anyone to any requisition, unlike /reassign
    which was already admin/manager-only. Also guards against a second
    'active' row on the same requisition — the table itself has no unique
    constraint enforcing "one active assignment per requisition", so a
    duplicate call previously landed silently instead of erroring.

    2026-08-24: widened to also allow role='kae' (manual assignment is
    now reachable from KAE, Manager, or Admin accounts, per request), and
    the response now carries the same real availability/priority/workload
    breakdown Auto-Assign already surfaces — reusing match_recruiters(),
    not a second scoring path — so the manual picker's tooltip can show
    "full message all details" identically to the auto-assign one."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        existing = await conn.fetchval(
            "SELECT id FROM assignments WHERE requisition_id=$1 AND status='active'",
            body.requisition_id,
        )
        if existing:
            raise HTTPException(
                status_code=409,
                detail="This requisition already has an active assignment — use /reassign instead",
            )

        detail = await _recruiter_match_detail(conn, body.requisition_id, body.recruiter_id)
        match_score = body.match_score if body.match_score is not None else (detail["match_score"] if detail else None)

        row = await conn.fetchrow(
            f"""INSERT INTO assignments (tenant_id, requisition_id, recruiter_id, match_score)
                VALUES ($1, $2, $3, $4)
                RETURNING {FIELDS}""",
            actor.tenant_id, body.requisition_id, body.recruiter_id, match_score,
        )

        recruiter_name = await conn.fetchval("SELECT full_name FROM users WHERE id=$1", body.recruiter_id)

        explanation = {"reason": "manually_assigned", "assigned_by": actor.user_id}
        if detail:
            # match_score/performance_score come back as Postgres numeric
            # -> asyncpg Decimal, which json.dumps() can't serialize
            # (write_assignment_event below json.dumps()s this dict
            # directly, unlike an HTTP response where FastAPI's
            # jsonable_encoder would handle it automatically) - cast
            # explicitly rather than let the write silently fail.
            for k in ("match_score", "skill_match_count", "available_capacity", "active_assignments",
                      "capacity_weekly", "on_leave", "location_match", "has_prior_client_relationship",
                      "tenure_months", "performance_score", "workload_label"):
                v = detail[k]
                explanation[k] = float(v) if isinstance(v, Decimal) else v

        await events.write_assignment_event(
            conn, actor.tenant_id, "assigned",
            assignment_id=str(row["id"]), reason="Manual assignment",
            actor_user_id=actor.user_id, metadata=explanation,
        )

        # Real gap closed (2026-08-24 research pass): a recruiter previously
        # only found out they'd been assigned by noticing it themselves.
        await assignment_notify.notify_and_task_on_assign(
            conn, actor.tenant_id, requisition_id=body.requisition_id,
            recruiter_id=body.recruiter_id, assigned_by_user_id=actor.user_id,
        )

    result = dict(row)
    result["recruiter_name"] = recruiter_name
    result["explanation"] = explanation
    return result


@router.post("/{assignment_id}/reassign")
async def reassign(
    assignment_id: str, body: ReassignRequest, actor: Actor = Depends(require_role("admin", "manager"))
):
    """Reassign to a specific recruiter, or auto-pick the next-best
    alternative via match_recruiters() when new_recruiter_id is omitted.

    Delegates to do_reassign() (documented in CLAUDE.md's TARGET DB
    FUNCTIONS since P1/P3, previously never called anywhere) instead of
    reimplementing the same swap in Python — that duplicate version
    never wrote event_outbox (HARD RULE #5/#6 gap: a 'reassigned' event
    fired assignment_event + audit_log but never dispatched anywhere)."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        old = await conn.fetchrow(f"SELECT {FIELDS} FROM assignments WHERE id = $1", assignment_id)
        if old is None:
            raise HTTPException(status_code=404, detail="Assignment not found")
        if old["status"] != "active":
            raise HTTPException(status_code=409, detail=f"Assignment is '{old['status']}', expected 'active'")

        # Real, server-side gate (2026-08-31) - only the AUTO-PICK path
        # (new_recruiter_id omitted) is affected by the tenant's Auto-
        # Assign on/off switch. Reassigning to a specific, human-chosen
        # recruiter is manual and is never blocked by this.
        if body.new_recruiter_id is None and not await is_auto_assign_enabled(conn, actor.tenant_id):
            raise HTTPException(status_code=403, detail="AI Auto-Assign is turned off for this tenant (Ops Settings). Pick a specific recruiter instead.")

        try:
            result = await conn.fetchrow(
                "SELECT * FROM do_reassign($1, $2, $3)",
                assignment_id, body.reason, body.new_recruiter_id,
            )
        except asyncpg.exceptions.RaiseError as exc:
            message = str(exc)
            status_code = 404 if "not found" in message.lower() else 409
            raise HTTPException(status_code=status_code, detail=message)

        await events.write_audit(
            conn, actor.tenant_id, actor.user_id, "reassign", "assignment", assignment_id,
            before={"recruiter_id": str(old["recruiter_id"]), "status": "active"},
            after={
                "recruiter_id": str(result["new_recruiter_id"]),
                "status": "reassigned",
                "new_assignment_id": str(result["new_assignment_id"]),
                "auto_picked": body.new_recruiter_id is None,
            },
        )

        await assignment_notify.notify_on_reassign(
            conn, actor.tenant_id, requisition_id=str(old["requisition_id"]),
            new_recruiter_id=str(result["new_recruiter_id"]), reason=body.reason,
        )

    return {
        "old_assignment_id": str(result["old_assignment_id"]),
        "new_assignment_id": str(result["new_assignment_id"]),
        "new_recruiter_id": str(result["new_recruiter_id"]),
        "new_recruiter_name": result["new_recruiter_name"],
        "match_score": result["match_score"],
        "auto_picked": body.new_recruiter_id is None,
    }
