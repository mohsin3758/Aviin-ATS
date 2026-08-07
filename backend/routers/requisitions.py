import json
from typing import Optional

import asyncpg
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

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
            industry, client_name, approval_status"""

# Gap-audit item 09: hierarchy/approval-chain routing. requisitions.approval_
# status existed since an early migration but defaulted to 'approved' with
# zero application code reading or writing it - a vestigial column, not a
# workflow. This walks the creator's real users.reporting_to org chart
# (populated earlier this session) to build a genuine multi-step chain.
APPROVAL_EXEMPT_ROLES = ("admin", "super_admin", "manager")
MAX_APPROVAL_CHAIN_LEVELS = 3


async def _build_approval_chain(conn, creator_id: str, max_levels: int = MAX_APPROVAL_CHAIN_LEVELS) -> list[str]:
    """Walk reporting_to upward from the creator, one step per manager level
    found. Stops at max_levels, a missing reporting_to, or a cycle."""
    chain: list[str] = []
    seen = {creator_id}
    current = creator_id
    for _ in range(max_levels):
        row = await conn.fetchrow("SELECT reporting_to FROM users WHERE id=$1", current)
        nxt = row["reporting_to"] if row else None
        if not nxt or str(nxt) in seen:
            break
        nxt = str(nxt)
        chain.append(nxt)
        seen.add(nxt)
        current = nxt
    return chain


async def _notify_approver(conn, tenant_id: str, approver_id: str, requisition_id: str, title_text: str, req_title: str):
    await conn.execute(
        """INSERT INTO notifications (tenant_id,user_id,recipient_user_id,title,body,type,resource,resource_id,channel)
           VALUES ($1,$2,$2,$3,$4,'info','requisition',$5,'inapp')""",
        tenant_id, approver_id, title_text, f'"{req_title}" needs your approval', str(requisition_id),
    )

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

        result = dict(row)
        if actor.role not in APPROVAL_EXEMPT_ROLES:
            approvers = await _build_approval_chain(conn, actor.user_id)
            if approvers:
                await conn.execute(
                    "UPDATE requisitions SET approval_status='pending_approval' WHERE id=$1", row["id"],
                )
                result["approval_status"] = "pending_approval"
                for i, approver_id in enumerate(approvers, start=1):
                    await conn.execute(
                        """INSERT INTO requisition_approval_steps
                             (tenant_id, requisition_id, step_number, approver_id)
                           VALUES ($1,$2,$3,$4)""",
                        actor.tenant_id, row["id"], i, approver_id,
                    )
                await _notify_approver(conn, actor.tenant_id, approvers[0], row["id"],
                                        "Requisition awaiting your approval", body.title)

        await events.write_outbox(
            conn, actor.tenant_id, "requisition.created",
            {"requisition_id": str(row["id"]), "title": body.title},
            f"requisition.created:{row['id']}",
        )

    return result


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
        app = dict(row)
        for key in ("app_notes", "app_tags"):
            if isinstance(app.get(key), str):
                app[key] = json.loads(app[key])
        board.setdefault(row["stage"], []).append(app)
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
    sql/04_phase3_ai_engine.sql). RLS makes a wrong-tenant requisition_id yield [].
    match_candidates() itself only returns a skill_overlap COUNT, not which
    skills are missing — computed here in Python from skills_required so a
    recruiter can see exactly why a candidate scored the way they did."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("SELECT * FROM match_candidates($1, $2)", requisition_id, limit)
        req_skills = await conn.fetchval(
            "SELECT skills_required FROM requisitions WHERE id=$1", requisition_id) or []
    out = []
    for r in rows:
        d = dict(r)
        cand_lower = {s.lower() for s in (d.get("skills") or [])}
        d["missing_skills"] = [s for s in req_skills if s.lower() not in cand_lower]
        out.append(d)
    return out


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


@router.get("/{requisition_id}/approval-chain")
async def get_approval_chain(requisition_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            """SELECT s.*, u.full_name AS approver_name FROM requisition_approval_steps s
               JOIN users u ON u.id = s.approver_id
               WHERE s.tenant_id=$1 AND s.requisition_id=$2 ORDER BY s.step_number""",
            actor.tenant_id, requisition_id,
        )
    return [dict(r) for r in rows]


class ApprovalAction(BaseModel):
    comment: Optional[str] = None


async def _act_on_step(requisition_id: str, step_id: str, body: ApprovalAction, actor: Actor, approve: bool):
    async with db.tenant_conn(actor.tenant_id) as conn:
        step = await conn.fetchrow(
            "SELECT * FROM requisition_approval_steps WHERE id=$1 AND tenant_id=$2 AND requisition_id=$3",
            step_id, actor.tenant_id, requisition_id,
        )
        if not step:
            raise HTTPException(status_code=404, detail="Approval step not found")
        if str(step["approver_id"]) != actor.user_id and actor.role not in ("admin", "super_admin"):
            raise HTTPException(status_code=403, detail="Not your approval step")
        if step["status"] != "pending":
            raise HTTPException(status_code=400, detail=f"Step already {step['status']}")
        current = await conn.fetchval(
            """SELECT min(step_number) FROM requisition_approval_steps
               WHERE tenant_id=$1 AND requisition_id=$2 AND status='pending'""",
            actor.tenant_id, requisition_id,
        )
        if step["step_number"] != current:
            raise HTTPException(status_code=400, detail="An earlier approval step is still pending")

        req = await conn.fetchrow("SELECT title FROM requisitions WHERE id=$1", requisition_id)

        if approve:
            await conn.execute(
                "UPDATE requisition_approval_steps SET status='approved', comment=$1, acted_at=now() WHERE id=$2",
                body.comment, step_id,
            )
            next_step = await conn.fetchrow(
                """SELECT * FROM requisition_approval_steps
                   WHERE tenant_id=$1 AND requisition_id=$2 AND status='pending'
                   ORDER BY step_number LIMIT 1""",
                actor.tenant_id, requisition_id,
            )
            if next_step:
                await _notify_approver(conn, actor.tenant_id, str(next_step["approver_id"]), requisition_id,
                                        "Requisition awaiting your approval", req["title"])
            else:
                await conn.execute("UPDATE requisitions SET approval_status='approved' WHERE id=$1", requisition_id)
                await events.write_outbox(
                    conn, actor.tenant_id, "requisition.approved",
                    {"requisition_id": requisition_id}, f"requisition.approved:{requisition_id}",
                )
        else:
            await conn.execute(
                "UPDATE requisition_approval_steps SET status='rejected', comment=$1, acted_at=now() WHERE id=$2",
                body.comment, step_id,
            )
            await conn.execute(
                """UPDATE requisition_approval_steps SET status='skipped'
                   WHERE tenant_id=$1 AND requisition_id=$2 AND status='pending'""",
                actor.tenant_id, requisition_id,
            )
            await conn.execute("UPDATE requisitions SET approval_status='rejected' WHERE id=$1", requisition_id)
            await events.write_outbox(
                conn, actor.tenant_id, "requisition.rejected",
                {"requisition_id": requisition_id, "reason": body.comment}, f"requisition.rejected:{requisition_id}",
            )
    return {"approved": approve}


@router.post("/{requisition_id}/approval-steps/{step_id}/approve")
async def approve_step(requisition_id: str, step_id: str, body: ApprovalAction, actor: Actor = Depends(get_actor)):
    return await _act_on_step(requisition_id, step_id, body, actor, approve=True)


@router.post("/{requisition_id}/approval-steps/{step_id}/reject")
async def reject_step(requisition_id: str, step_id: str, body: ApprovalAction, actor: Actor = Depends(get_actor)):
    return await _act_on_step(requisition_id, step_id, body, actor, approve=False)
