from fastapi import APIRouter, Depends, HTTPException

import db
import events
from deps import Actor, get_actor
from schemas import RequisitionCreate, RequisitionUpdate

router = APIRouter(prefix="/requisitions", tags=["requisitions"])

# jd_embedding (vector(384)) deliberately excluded — large and has no
# asyncpg codec registered for the `vector` type.
FIELDS = """id, tenant_id, client_id, title, description, skills_required,
            location, employment_type, status, positions_count, sla_hours,
            created_by, created_at, updated_at"""

PIPELINE_STAGES = ["sourced", "screened", "submitted", "interview", "offer", "placed", "rejected"]


@router.get("")
async def list_requisitions(
    status: str | None = None,
    client_id: str | None = None,
    actor: Actor = Depends(get_actor),
):
    conditions: list[str] = []
    params: list = []
    if status:
        params.append(status)
        conditions.append(f"status = ${len(params)}")
    if client_id:
        params.append(client_id)
        conditions.append(f"client_id = ${len(params)}")

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    sql = f"SELECT {FIELDS} FROM requisitions {where} ORDER BY created_at DESC"

    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(sql, *params)
    return [dict(r) for r in rows]


@router.post("")
async def create_requisition(body: RequisitionCreate, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            f"""INSERT INTO requisitions
                  (tenant_id, client_id, title, description, skills_required,
                   location, employment_type, positions_count, sla_hours, created_by)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                RETURNING {FIELDS}""",
            actor.tenant_id, body.client_id, body.title, body.description,
            body.skills_required, body.location, body.employment_type,
            body.positions_count, body.sla_hours, actor.user_id,
        )

        await events.write_outbox(
            conn, actor.tenant_id, "requisition.created",
            {"requisition_id": str(row["id"]), "title": body.title},
            f"requisition.created:{row['id']}",
        )

    return dict(row)


@router.get("/{requisition_id}")
async def get_requisition(requisition_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(f"SELECT {FIELDS} FROM requisitions WHERE id = $1", requisition_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Requisition not found")
    return dict(row)


@router.patch("/{requisition_id}")
async def update_requisition(requisition_id: str, body: RequisitionUpdate, actor: Actor = Depends(get_actor)):
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    params: list = []
    set_clauses = []
    for key, value in updates.items():
        params.append(value)
        set_clauses.append(f"{key} = ${len(params)}")
    params.append(requisition_id)

    sql = f"""UPDATE requisitions SET {', '.join(set_clauses)}, updated_at = now()
              WHERE id = ${len(params)}
              RETURNING {FIELDS}"""

    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(sql, *params)
    if row is None:
        raise HTTPException(status_code=404, detail="Requisition not found")
    return dict(row)


@router.get("/{requisition_id}/pipeline")
async def requisition_pipeline(requisition_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            """SELECT a.id, a.candidate_id, c.full_name AS candidate_name,
                      c.skills, c.total_exp_mo, a.stage, a.fit_score,
                      a.assigned_recruiter_id, a.created_at, a.updated_at
               FROM applications a
               JOIN candidates c ON c.id = a.candidate_id
               WHERE a.requisition_id = $1
               ORDER BY a.updated_at DESC""",
            requisition_id,
        )

    board: dict[str, list] = {stage: [] for stage in PIPELINE_STAGES}
    for row in rows:
        board[row["stage"]].append(dict(row))
    return board
