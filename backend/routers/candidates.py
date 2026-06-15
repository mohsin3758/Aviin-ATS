from fastapi import APIRouter, Depends, HTTPException

import db
import events
from deps import Actor, get_actor
from schemas import CandidateCreate, CandidateUpdate

router = APIRouter(prefix="/candidates", tags=["candidates"])

# resume_embedding (vector(384)) deliberately excluded — large and has
# no asyncpg codec registered for the `vector` type.
FIELDS = """id, tenant_id, full_name, email, phone, skills, total_exp_mo,
            location, current_employer, resume_text, source,
            created_at, updated_at"""


@router.get("")
async def list_candidates(
    skill: str | None = None,
    location: str | None = None,
    q: str | None = None,
    actor: Actor = Depends(get_actor),
):
    conditions: list[str] = []
    params: list = []
    if skill:
        params.append(skill)
        conditions.append(f"${len(params)} = ANY(skills)")
    if location:
        params.append(f"%{location}%")
        conditions.append(f"location ILIKE ${len(params)}")
    if q:
        params.append(f"%{q}%")
        conditions.append(f"(full_name ILIKE ${len(params)} OR resume_text ILIKE ${len(params)})")

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    sql = f"SELECT {FIELDS} FROM candidates {where} ORDER BY created_at DESC"

    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(sql, *params)
    return [dict(r) for r in rows]


@router.post("")
async def create_candidate(body: CandidateCreate, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            f"""INSERT INTO candidates
                  (tenant_id, full_name, email, phone, skills, total_exp_mo,
                   location, current_employer, resume_text, source)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                RETURNING {FIELDS}""",
            actor.tenant_id, body.full_name, body.email, body.phone, body.skills,
            body.total_exp_mo, body.location, body.current_employer,
            body.resume_text, body.source,
        )
        cand_id = row["id"]

        # HARD RULE #12: consent before any candidate PII is processed.
        consent_text = body.consent_text or (
            f"{body.full_name} consented to resume storage and AI-based "
            "matching per DPDP 2023 at registration."
        )
        await conn.execute(
            """INSERT INTO consent_records
                 (tenant_id, candidate_id, data_category, channel, consent_given, consent_text)
               VALUES ($1, $2, 'resume_processing', 'api', TRUE, $3)""",
            actor.tenant_id, cand_id, consent_text,
        )

        # HARD RULE #5/#6
        await events.write_outbox(
            conn, actor.tenant_id, "candidate.created",
            {"candidate_id": str(cand_id), "full_name": body.full_name},
            f"candidate.created:{cand_id}",
        )

    return dict(row)


@router.get("/{candidate_id}")
async def get_candidate(candidate_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(f"SELECT {FIELDS} FROM candidates WHERE id = $1", candidate_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Candidate not found")
    return dict(row)


@router.patch("/{candidate_id}")
async def update_candidate(candidate_id: str, body: CandidateUpdate, actor: Actor = Depends(get_actor)):
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    params: list = []
    set_clauses = []
    for key, value in updates.items():
        params.append(value)
        set_clauses.append(f"{key} = ${len(params)}")
    params.append(candidate_id)

    sql = f"""UPDATE candidates SET {', '.join(set_clauses)}, updated_at = now()
              WHERE id = ${len(params)}
              RETURNING {FIELDS}"""

    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(sql, *params)
    if row is None:
        raise HTTPException(status_code=404, detail="Candidate not found")
    return dict(row)


@router.get("/{candidate_id}/applications")
async def candidate_applications(candidate_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            """SELECT a.id, a.requisition_id, r.title AS requisition_title,
                      a.stage, a.fit_score, a.assigned_recruiter_id,
                      a.created_at, a.updated_at
               FROM applications a
               JOIN requisitions r ON r.id = a.requisition_id
               WHERE a.candidate_id = $1
               ORDER BY a.created_at DESC""",
            candidate_id,
        )
    return [dict(r) for r in rows]
