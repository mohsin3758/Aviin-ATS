"""Requisition <-> recruiter assignments.

HARD RULE #10: reassignment is a high-stakes, HITL-gated action
(admin/manager only) — writes assignment_event 'reassigned' +
audit_log, marks the old assignment 'reassigned' and creates a new
'active' assignment for the new recruiter.
"""

from fastapi import APIRouter, Depends, HTTPException

import db
import events
from deps import Actor, get_actor, require_role
from schemas import AssignmentCreate, ReassignRequest

router = APIRouter(prefix="/assignments", tags=["assignments"])

FIELDS = """id, tenant_id, requisition_id, recruiter_id, status, match_score,
            assigned_at, updated_at"""


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
async def create_assignment(body: AssignmentCreate, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            f"""INSERT INTO assignments (tenant_id, requisition_id, recruiter_id, match_score)
                VALUES ($1, $2, $3, $4)
                RETURNING {FIELDS}""",
            actor.tenant_id, body.requisition_id, body.recruiter_id, body.match_score,
        )

        await events.write_assignment_event(
            conn, actor.tenant_id, "assigned",
            assignment_id=str(row["id"]), reason="Manual assignment",
            actor_user_id=actor.user_id, metadata={"match_score": body.match_score},
        )

    return dict(row)


@router.post("/{assignment_id}/reassign")
async def reassign(
    assignment_id: str, body: ReassignRequest, actor: Actor = Depends(require_role("admin", "manager"))
):
    async with db.tenant_conn(actor.tenant_id) as conn:
        old = await conn.fetchrow(f"SELECT {FIELDS} FROM assignments WHERE id = $1", assignment_id)
        if old is None:
            raise HTTPException(status_code=404, detail="Assignment not found")
        if old["status"] != "active":
            raise HTTPException(status_code=409, detail=f"Assignment is '{old['status']}', expected 'active'")

        updated = await conn.fetchrow(
            f"""UPDATE assignments SET status = 'reassigned', updated_at = now()
                WHERE id = $1 RETURNING {FIELDS}""",
            assignment_id,
        )

        new_row = await conn.fetchrow(
            f"""INSERT INTO assignments (tenant_id, requisition_id, recruiter_id, status, match_score)
                VALUES ($1, $2, $3, 'active', $4)
                RETURNING {FIELDS}""",
            actor.tenant_id, old["requisition_id"], body.new_recruiter_id, old["match_score"],
        )

        await events.write_assignment_event(
            conn, actor.tenant_id, "reassigned",
            assignment_id=assignment_id, reason=body.reason, actor_user_id=actor.user_id,
            metadata={
                "from_recruiter_id": str(old["recruiter_id"]),
                "to_recruiter_id": body.new_recruiter_id,
                "new_assignment_id": str(new_row["id"]),
            },
        )
        await events.write_audit(
            conn, actor.tenant_id, actor.user_id, "reassign", "assignment", assignment_id,
            before={"recruiter_id": str(old["recruiter_id"]), "status": "active"},
            after={
                "recruiter_id": body.new_recruiter_id,
                "status": "reassigned",
                "new_assignment_id": str(new_row["id"]),
            },
        )

    return {"old": dict(updated), "new": dict(new_row)}
