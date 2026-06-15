from fastapi import APIRouter, Depends, HTTPException

import db
import events
from deps import Actor, get_actor
from schemas import ApplicationCreate, StageUpdate

router = APIRouter(prefix="/applications", tags=["applications"])

FIELDS = """id, tenant_id, requisition_id, candidate_id, stage, fit_score,
            assigned_recruiter_id, created_at, updated_at"""


@router.post("")
async def create_application(body: ApplicationCreate, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        existing = await conn.fetchval(
            "SELECT id FROM applications WHERE requisition_id = $1 AND candidate_id = $2",
            body.requisition_id, body.candidate_id,
        )
        if existing:
            raise HTTPException(status_code=409, detail="Application already exists for this candidate/requisition")

        row = await conn.fetchrow(
            f"""INSERT INTO applications (tenant_id, requisition_id, candidate_id, assigned_recruiter_id)
                VALUES ($1, $2, $3, $4)
                RETURNING {FIELDS}""",
            actor.tenant_id, body.requisition_id, body.candidate_id, body.assigned_recruiter_id,
        )

        await events.write_outbox(
            conn, actor.tenant_id, "application.created",
            {
                "application_id": str(row["id"]),
                "requisition_id": body.requisition_id,
                "candidate_id": body.candidate_id,
            },
            f"application.created:{row['id']}",
        )

    return dict(row)


@router.get("/{application_id}")
async def get_application(application_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(f"SELECT {FIELDS} FROM applications WHERE id = $1", application_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Application not found")
    return dict(row)


@router.patch("/{application_id}/stage")
async def update_stage(application_id: str, body: StageUpdate, actor: Actor = Depends(get_actor)):
    # HARD RULE #10: rejecting a candidate is a HITL-gated, high-stakes action.
    if body.stage == "rejected" and actor.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Rejecting a candidate requires manager/admin role (HITL)")

    async with db.tenant_conn(actor.tenant_id) as conn:
        old = await conn.fetchrow("SELECT stage FROM applications WHERE id = $1", application_id)
        if old is None:
            raise HTTPException(status_code=404, detail="Application not found")

        row = await conn.fetchrow(
            f"""UPDATE applications SET stage = $1, updated_at = now()
                WHERE id = $2 RETURNING {FIELDS}""",
            body.stage, application_id,
        )

        await events.write_outbox(
            conn, actor.tenant_id, "application.stage_changed",
            {
                "application_id": application_id,
                "from": old["stage"],
                "to": body.stage,
                "reason": body.reason,
            },
            f"application.stage_changed:{application_id}:{row['updated_at'].isoformat()}",
        )

        if body.stage == "rejected":
            await events.write_assignment_event(
                conn, actor.tenant_id, "candidate.rejected",
                reason=body.reason, actor_user_id=actor.user_id,
                metadata={"application_id": application_id, "from_stage": old["stage"]},
            )
            await events.write_audit(
                conn, actor.tenant_id, actor.user_id, "reject", "application", application_id,
                before={"stage": old["stage"]}, after={"stage": "rejected", "reason": body.reason},
            )

    return dict(row)
