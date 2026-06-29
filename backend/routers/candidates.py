from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
import db, events
from deps import Actor, get_actor
from schemas import CandidateCreate, CandidateUpdate

router = APIRouter(prefix="/candidates", tags=["candidates"])

FIELDS = (
    "id, tenant_id, full_name, email, phone, skills, total_exp_mo, "
    "location, current_employer, resume_text, source, "
    "expected_ctc, current_ctc, notice_period_days, "
    "ai_match_score, color_indicator, last_activity, created_at, updated_at"
)

@router.get("")
async def list_candidates(
    search: Optional[str] = Query(None),
    q:      Optional[str] = Query(None),
    skill:  Optional[str] = Query(None),
    location: Optional[str] = Query(None),
    source:   Optional[str] = Query(None),
    min_exp:  Optional[int] = Query(None),
    max_exp:  Optional[int] = Query(None),
    limit: int = Query(100, le=500),
    offset: int = Query(0, ge=0),
    actor: Actor = Depends(get_actor),
):
    conditions = ["tenant_id = $1"]
    params = [actor.tenant_id]
    term = search or q
    if term:
        params.append(f"%{term}%")
        n = len(params)
        conditions.append(
            f"(full_name ILIKE ${n} OR email ILIKE ${n} OR phone ILIKE ${n} "
            f"OR current_employer ILIKE ${n} OR EXISTS "
            f"(SELECT 1 FROM unnest(skills) sk WHERE sk ILIKE ${n}))"
        )
    if skill:
        params.append(skill); conditions.append(f"${len(params)} ILIKE ANY(skills)")
    if location:
        params.append(f"%{location}%"); conditions.append(f"location ILIKE ${len(params)}")
    if source:
        params.append(source); conditions.append(f"source = ${len(params)}")
    if min_exp is not None:
        params.append(min_exp); conditions.append(f"total_exp_mo >= ${len(params)}")
    if max_exp is not None:
        params.append(max_exp); conditions.append(f"total_exp_mo <= ${len(params)}")

    where = "WHERE " + " AND ".join(conditions)
    p_limit = len(params) + 1
    p_offset = len(params) + 2
    async with db.tenant_conn(actor.tenant_id) as conn:
        total = await conn.fetchval(f"SELECT COUNT(*) FROM candidates {where}", *params)
        rows = await conn.fetch(
            f"SELECT {FIELDS} FROM candidates {where} ORDER BY created_at DESC LIMIT ${p_limit} OFFSET ${p_offset}",
            *params, limit, offset)
    return {"items": [dict(r) for r in rows], "total": int(total), "limit": limit, "offset": offset}

@router.post("")
async def create_candidate(body: CandidateCreate, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            f"""INSERT INTO candidates
                (tenant_id,full_name,email,phone,skills,total_exp_mo,location,
                 current_employer,resume_text,source,expected_ctc,current_ctc,notice_period_days)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
               RETURNING {FIELDS}""",
            actor.tenant_id, body.full_name, body.email, body.phone, body.skills,
            body.total_exp_mo, body.location, body.current_employer, body.resume_text, body.source,
            getattr(body, "expected_ctc", None), getattr(body, "current_ctc", None),
            getattr(body, "notice_period_days", None))
        cid = row["id"]
        ct = getattr(body, "consent_text", None) or f"{body.full_name} consented to DPDP 2023."
        await conn.execute(
            "INSERT INTO consent_records (tenant_id,candidate_id,data_category,channel,consent_given,consent_text) VALUES ($1,$2,'resume_processing','api',TRUE,$3)",
            actor.tenant_id, cid, ct)
        await events.write_outbox(conn, actor.tenant_id, "candidate.created",
            {"candidate_id": str(cid), "full_name": body.full_name}, f"candidate.created:{cid}")
    return dict(row)

@router.get("/{candidate_id}")
async def get_candidate(candidate_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(f"SELECT {FIELDS} FROM candidates WHERE id=$1", candidate_id)
    if not row:
        raise HTTPException(404, "Candidate not found")
    return dict(row)

@router.patch("/{candidate_id}")
@router.put("/{candidate_id}")
async def update_candidate(candidate_id: str, body: CandidateUpdate, actor: Actor = Depends(get_actor)):
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(400, "No fields to update")
    params, clauses = [], []
    for k, v in updates.items():
        params.append(v); clauses.append(f"{k}=${len(params)}")
    params.append(candidate_id)
    sql = f"UPDATE candidates SET {chr(44).join(clauses)}, updated_at=now() WHERE id=${len(params)} RETURNING {FIELDS}"
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(sql, *params)
    if not row:
        raise HTTPException(404, "Candidate not found")
    return dict(row)

@router.delete("/{candidate_id}")
async def delete_candidate(candidate_id: str, actor: Actor = Depends(get_actor)):
    CHILD_TABLES = [
        "consent_records", "candidate_scores", "candidate_parsed_data",
        "candidate_activities", "candidate_tag_map", "candidate_status_tokens",
        "placement_predictions", "source_attribution", "bgv_checks",
        "technical_assessments", "hotlist", "candidate_retention_tracking",
        "compliance_records", "candidate_onboarding",
    ]
    async with db.tenant_conn(actor.tenant_id) as conn:
        async with conn.transaction():
            for tbl in CHILD_TABLES:
                try:
                    async with conn.transaction():
                        await conn.execute(
                            f"DELETE FROM {tbl} WHERE candidate_id=$1", candidate_id
                        )
                except Exception:
                    pass
            r = await conn.execute(
                "DELETE FROM candidates WHERE id=$1 AND tenant_id=$2",
                candidate_id, actor.tenant_id
            )
    if not int((r or "DELETE 0").split()[-1]):
        raise HTTPException(404, "Not found")
    return {"ok": True, "deleted": candidate_id}

@router.get("/{candidate_id}/applications")
async def candidate_applications(candidate_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            "SELECT a.id, a.requisition_id, r.title AS requisition_title, a.stage, a.fit_score, a.created_at, a.updated_at FROM applications a JOIN requisitions r ON r.id=a.requisition_id WHERE a.candidate_id=$1 ORDER BY a.created_at DESC",
            candidate_id)
    return [dict(r) for r in rows]
