import json

import asyncpg
from fastapi import APIRouter, Depends, HTTPException

import db
import events
from deps import Actor, get_actor
from schemas import RequisitionCreate, RequisitionUpdate

router = APIRouter(prefix="/requisitions", tags=["requisitions"])

# jd_embedding (vector(384)) deliberately excluded - large and has no
# asyncpg codec registered for the `vector` type.
FIELDS = """id, tenant_id, client_id, title, description, skills_required,
            location, employment_type, status, positions_count, sla_hours,
            created_by, created_at, updated_at,
            experience_min, experience_max,
            budget_min, budget_max, bill_rate,
            work_mode, priority, deadline, expected_start_date,
            education_required, shift_type, notice_period_max,
            industry, client_name"""

PIPELINE_STAGES = ["sourced", "contacted", "interested", "nda", "screened", "submitted", "l1_interview", "l2_interview", "offer", "offer_accepted", "placed", "rejected", "hold"]


@router.get("")
async def list_requisitions(
    status: str | None = None,
    client_id: str | None = None,
    priority: str | None = None,
    work_mode: str | None = None,
    search: str | None = None,
    limit: int | None = None,
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
    if priority:
        params.append(priority)
        conditions.append(f"priority = ${len(params)}")
    if work_mode:
        params.append(work_mode)
        conditions.append(f"work_mode = ${len(params)}")
    if search:
        params.append(f"%{search}%")
        conditions.append(
            f"(lower(title) LIKE lower(${len(params)}) "
            f"OR lower(location) LIKE lower(${len(params)}) "
            f"OR EXISTS (SELECT 1 FROM unnest(skills_required) s WHERE lower(s) LIKE lower(${len(params)})))"
        )

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    limit_clause = f"LIMIT {int(limit)}" if limit and limit > 0 else ""
    sql = f"SELECT {FIELDS} FROM requisitions {where} ORDER BY created_at DESC {limit_clause}"

    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(sql, *params)
    return [dict(r) for r in rows]


@router.post("")
async def create_requisition(body: RequisitionCreate, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            f"""INSERT INTO requisitions
                  (tenant_id, client_id, title, description, skills_required,
                   location, employment_type, positions_count, sla_hours, created_by,
                   experience_min, experience_max,
                   budget_min, budget_max, bill_rate,
                   work_mode, priority, deadline, expected_start_date,
                   education_required, shift_type, notice_period_max,
                   industry, client_name)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                        $11, $12, $13, $14, $15, $16, $17, $18, $19,
                        $20, $21, $22, $23, $24)
                RETURNING {FIELDS}""",
            actor.tenant_id, body.client_id, body.title, body.description,
            body.skills_required, body.location, body.employment_type,
            body.positions_count, body.sla_hours, actor.user_id,
            body.experience_min, body.experience_max,
            body.budget_min, body.budget_max, body.bill_rate,
            body.work_mode, body.priority, body.deadline, body.expected_start_date,
            body.education_required, body.shift_type, body.notice_period_max,
            body.industry, body.client_name,
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
                      c.email, c.phone, c.skills, c.total_exp_mo,
                      c.current_designation, c.current_employer, c.location,
                      c.resume_path, c.expected_ctc, c.notice_period_days,
                      c.jd_match_score, c.ai_match_score,
                      a.stage, a.fit_score, a.app_notes, a.app_tags,
                      a.rejected_reason, a.assigned_recruiter_id,
                      a.created_at, a.updated_at,
                      (SELECT COUNT(*) FROM interview_scorecards s
                       WHERE s.application_id = a.id AND s.tenant_id = a.tenant_id
                      )::int AS scorecard_count
               FROM applications a
               JOIN candidates c ON c.id = a.candidate_id
               WHERE a.requisition_id = $1
               ORDER BY a.updated_at DESC""",
            requisition_id,
        )

    board: dict[str, list] = {stage: [] for stage in PIPELINE_STAGES}
    for row in rows:
        board.setdefault(row["stage"], []).append(dict(row))
    return board




@router.get("/{requisition_id}/pipeline-stats")
async def pipeline_stats(requisition_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """SELECT
                 COUNT(*) FILTER (WHERE stage = 'placed') AS placed,
                 COUNT(*) FILTER (WHERE stage = 'offer_accepted') AS offer_accepted,
                 COUNT(*) FILTER (WHERE stage NOT IN ('placed','rejected','hold')) AS in_pipeline,
                 COUNT(*) FILTER (WHERE stage IN ('rejected','hold')) AS dropped,
                 COUNT(*) AS total
               FROM applications WHERE requisition_id = $1 AND tenant_id = $2""",
            requisition_id, actor.tenant_id,
        )
    return dict(row) if row else {"placed":0,"offer_accepted":0,"in_pipeline":0,"dropped":0,"total":0}
@router.get("/{requisition_id}/match-candidates")
async def match_candidates_for_requisition(
    requisition_id: str, limit: int = 10, actor: Actor = Depends(get_actor)
):
    """T1: pgvector cosine similarity + skill overlap (see match_candidates() in
    sql/04_phase3_ai_engine.sql). RLS makes a wrong-tenant requisition_id yield []."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("SELECT * FROM match_candidates($1, $2)", requisition_id, limit)
    return [dict(r) for r in rows]


@router.get("/{requisition_id}/match-recruiters")
async def match_recruiters_for_requisition(
    requisition_id: str, limit: int = 5, actor: Actor = Depends(get_actor)
):
    """T1: historical skill-overlap + spare capacity (see match_recruiters() in
    sql/04_phase3_ai_engine.sql)."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("SELECT * FROM match_recruiters($1, $2)", requisition_id, limit)
    return [dict(r) for r in rows]


@router.post("/{requisition_id}/assign")
async def assign_requisition(requisition_id: str, actor: Actor = Depends(get_actor)):
    """T0/T1: auto-assign the top-ranked recruiter via assign_with_explanation()
    (sql/04_phase3_ai_engine.sql). Not HITL-gated - only "reassigned" is in
    HARD RULE #10, not the initial "assigned"."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        try:
            row = await conn.fetchrow("SELECT * FROM assign_with_explanation($1)", requisition_id)
        except asyncpg.exceptions.RaiseError as exc:
            message = str(exc)
            status_code = 404 if "not found" in message.lower() else 409
            raise HTTPException(status_code=status_code, detail=message)

    result = dict(row)
    result["explanation"] = json.loads(result["explanation"])
    return result
