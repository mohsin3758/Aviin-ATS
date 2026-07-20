from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import List
from typing import Optional
import db, events
from deps import Actor, get_actor
from schemas import CandidateCreate, CandidateUpdate

router = APIRouter(prefix="/candidates", tags=["candidates"])

FIELDS = (
    "id, tenant_id, full_name, email, phone, skills, total_exp_mo, "
    "location, current_employer, current_designation, resume_text, source, "
    "expected_ctc, current_ctc, notice_period_days, "
    "ai_match_score, color_indicator, last_activity, created_at, updated_at"
)

@router.get("")
async def list_candidates(
    search:   Optional[str] = Query(None),
    q:        Optional[str] = Query(None),
    skill:    Optional[str] = Query(None),
    location: Optional[str] = Query(None),
    employer: Optional[str] = Query(None),
    source:   Optional[str] = Query(None),
    min_exp:  Optional[int] = Query(None),
    max_exp:  Optional[int] = Query(None),
    limit:    int = Query(100, le=500),
    offset:   int = Query(0, ge=0),
    sort_by:  str = Query('created_at'),
    sort_dir: str = Query('desc'),
    actor: Actor = Depends(get_actor),
):
    conditions = ["tenant_id = $1", "is_active IS NOT FALSE"]
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
    if employer:
        params.append(f"%{employer}%"); conditions.append(f"current_employer ILIKE ${len(params)}")
    if source:
        params.append(source); conditions.append(f"source = ${len(params)}")
    if min_exp is not None:
        params.append(min_exp); conditions.append(f"total_exp_mo >= ${len(params)}")
    if max_exp is not None:
        params.append(max_exp); conditions.append(f"total_exp_mo <= ${len(params)}")

    ALLOWED = {"full_name","total_exp_mo","expected_ctc","created_at","last_activity","updated_at"}
    if sort_by not in ALLOWED: sort_by = "created_at"
    if sort_dir not in ("asc","desc"): sort_dir = "desc"
    where = "WHERE " + " AND ".join(conditions)
    p_limit  = len(params) + 1
    p_offset = len(params) + 2
    pl_sub = ("(SELECT a.stage || '|' || COALESCE(r.title,'')"
              " FROM applications a JOIN requisitions r ON r.id=a.requisition_id"
              " WHERE a.candidate_id=c.id ORDER BY a.updated_at DESC LIMIT 1) AS pipeline_status")
    flds = ", ".join("c." + f.strip() for f in FIELDS.split(","))
    async with db.tenant_conn(actor.tenant_id) as conn:
        total = await conn.fetchval(f"SELECT COUNT(*) FROM candidates c {where}", *params)
        rows  = await conn.fetch(
            f"SELECT {flds}, {pl_sub} FROM candidates c {where} ORDER BY c.{sort_by} {sort_dir} LIMIT ${p_limit} OFFSET ${p_offset}",
            *params, limit, offset)
    items = []
    for r in rows:
        d = dict(r)
        ps = d.pop("pipeline_status", None)
        if ps:
            parts = ps.split("|", 1)
            d["pipeline_stage"] = parts[0]
            d["pipeline_job"]   = parts[1] if len(parts) > 1 else ""
        else:
            d["pipeline_stage"] = None
            d["pipeline_job"]   = None
        items.append(d)
    return {"items": items, "total": int(total), "limit": limit, "offset": offset}


@router.post("/bulk-delete")
async def bulk_delete_candidates(body: dict, actor: Actor = Depends(get_actor)):
    ids = body.get("ids", [])
    if not ids: return {"deleted": 0}
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute(
            "UPDATE candidates SET is_active=false WHERE id=ANY(::uuid[]) AND tenant_id=",
            ids, actor.tenant_id)
    return {"deleted": len(ids)}


@router.get("/duplicates")
async def list_duplicates(actor: Actor = Depends(get_actor)):
    q = (
        "SELECT full_name, COUNT(*) AS cnt,"
        " array_agg(id::text ORDER BY created_at) AS ids,"
        " array_agg(COALESCE(email, '') ORDER BY created_at) AS emails,"
        " array_agg(COALESCE(phone, '') ORDER BY created_at) AS phones,"
        " array_agg(COALESCE(current_employer, '') ORDER BY created_at) AS employers,"
        " array_agg(total_exp_mo ORDER BY created_at) AS exps,"
        " array_agg(created_at::date::text ORDER BY created_at) AS dates"
        " FROM candidates"
        " WHERE tenant_id=$1 AND is_active IS NOT FALSE AND full_name IS NOT NULL"
        " GROUP BY full_name HAVING COUNT(*) > 1"
        " ORDER BY cnt DESC, full_name"
    )
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(q, actor.tenant_id)
    return {"groups": [dict(r) for r in rows]}


async def list_duplicates(actor: Actor = Depends(get_actor)):
    sql = (
        "SELECT full_name, COUNT(*) AS cnt,"
        " array_agg(id::text ORDER BY created_at) AS ids,"
        " array_agg(COALESCE(email, '') ORDER BY created_at) AS emails,"
        " array_agg(COALESCE(phone, '') ORDER BY created_at) AS phones,"
        " array_agg(COALESCE(current_employer, '') ORDER BY created_at) AS employers,"
        " array_agg(total_exp_mo ORDER BY created_at) AS exps,"
        " array_agg(created_at::date::text ORDER BY created_at) AS dates"
        " FROM candidates"
        " WHERE tenant_id= AND is_active IS NOT FALSE AND full_name IS NOT NULL"
        " GROUP BY full_name HAVING COUNT(*) > 1"
        " ORDER BY cnt DESC, full_name"
    )
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(sql, actor.tenant_id)
    return {"groups": [dict(r) for r in rows]}


@router.get("/export")
async def export_candidates(
    search:   Optional[str] = Query(None),
    skill:    Optional[str] = Query(None),
    location: Optional[str] = Query(None),
    employer: Optional[str] = Query(None),
    min_exp:  Optional[int] = Query(None),
    max_exp:  Optional[int] = Query(None),
    actor: Actor = Depends(get_actor),
):
    """Server-side CSV export — no row limit, respects all active filters."""
    import io, csv, datetime
    from fastapi.responses import StreamingResponse

    conditions = ["tenant_id = $1", "is_active IS NOT FALSE"]
    params = [actor.tenant_id]
    if search:
        params.append(f"%{search}%"); n = len(params)
        conditions.append(
            f"(full_name ILIKE ${n} OR email ILIKE ${n} OR phone ILIKE ${n} "
            f"OR current_employer ILIKE ${n} OR EXISTS "
            f"(SELECT 1 FROM unnest(skills) sk WHERE sk ILIKE ${n}))"
        )
    if skill:
        params.append(skill); conditions.append(f"${len(params)} ILIKE ANY(skills)")
    if location:
        params.append(f"%{location}%"); conditions.append(f"location ILIKE ${len(params)}")
    if employer:
        params.append(f"%{employer}%"); conditions.append(f"current_employer ILIKE ${len(params)}")
    if min_exp is not None:
        params.append(min_exp); conditions.append(f"total_exp_mo >= ${len(params)}")
    if max_exp is not None:
        params.append(max_exp); conditions.append(f"total_exp_mo <= ${len(params)}")

    where = "WHERE " + " AND ".join(conditions)
    cols = (
        "id, full_name, email, phone, location, current_employer, current_designation, "
        "total_exp_mo, expected_ctc, current_ctc, notice_period_days, linkedin_url, "
        "source, skills, created_at"
    )
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            f"SELECT {cols} FROM candidates {where} ORDER BY created_at DESC", *params)

    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(['Name','Email','Phone','Location','Employer','Designation',
                'Exp_Months','Expected_CTC','Current_CTC','Notice_Days',
                'LinkedIn','Source','Skills','Added_On'])
    for r in rows:
        w.writerow([
            r['full_name'] or '', r['email'] or '', r['phone'] or '',
            r['location'] or '', r['current_employer'] or '', r['current_designation'] or '',
            r['total_exp_mo'] or 0, r['expected_ctc'] or '', r['current_ctc'] or '',
            r['notice_period_days'] or '', r['linkedin_url'] or '', r['source'] or '',
            '; '.join(r['skills'] or []),
            r['created_at'].strftime('%Y-%m-%d') if r['created_at'] else '',
        ])
    out.seek(0)
    fname = f"candidates_{datetime.date.today()}.csv"
    return StreamingResponse(
        iter([out.getvalue()]),
        media_type='text/csv',
        headers={'Content-Disposition': f'attachment; filename="{fname}"'},
    )


from pydantic import BaseModel as _BM


class RankRequest(_BM):
    jd_text: str
    limit: int = 50
    min_exp_months: Optional[int] = None


@router.post("/rank")
async def rank_candidates(body: RankRequest, actor: Actor = Depends(get_actor)):
    """
    Score and rank all active candidates against a job description.
    Uses regex skill extraction + experience + location scoring (free, instant).
    Score breakdown: skills 65pts + experience 25pts + designation 5pts + location 5pts.
    """
    import re
    from services.improved_parser import extract_skills_from_text, extract_experience_v2

    jd = body.jd_text or ''
    req_skills    = extract_skills_from_text(jd)
    req_lower     = {s.lower() for s in req_skills}
    min_exp_years = extract_experience_v2(jd) or 0
    min_exp_mo    = body.min_exp_months if body.min_exp_months is not None else int(min_exp_years * 12)

    loc_hint = ''
    lm = re.search(r'(?:location|based in|office)\s*[:\-]\s*([^\n,]{2,30})', jd, re.I)
    if lm:
        loc_hint = lm.group(1).strip().lower()[:15]

    role_words = {w.lower() for w in re.findall(r'[A-Za-z]+', jd[:300]) if len(w) > 3}

    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            f"SELECT {FIELDS} FROM candidates "
            f"WHERE tenant_id=$1 AND is_active IS NOT FALSE ORDER BY created_at DESC",
            actor.tenant_id,
        )

    scored = []
    for r in rows:
        c = dict(r)
        cand_skills_lower = {s.lower() for s in (c.get('skills') or [])}
        matched   = req_lower & cand_skills_lower
        skill_pct = len(matched) / max(len(req_lower), 1)
        skill_score = round(skill_pct * 65)

        cand_exp = c.get('total_exp_mo') or 0
        if min_exp_mo > 0:
            exp_score = round(min(cand_exp / min_exp_mo, 1.4) / 1.4 * 25)
        else:
            exp_score = round(min(cand_exp / 60, 1.0) * 25)

        desig = (c.get('current_designation') or '').lower()
        desig_words = {w for w in re.findall(r'[a-z]+', desig) if len(w) > 3}
        desig_score = min(len(desig_words & role_words), 1) * 5

        loc_score = 5 if loc_hint and loc_hint in (c.get('location') or '').lower() else 0

        total = skill_score + exp_score + desig_score + loc_score
        matched_names = [s for s in (c.get('skills') or []) if s.lower() in req_lower]

        scored.append({
            **c,
            'rank_score':      total,
            'matched_skills':  matched_names,
            'skill_match_pct': round(skill_pct * 100),
        })

    scored.sort(key=lambda x: x['rank_score'], reverse=True)
    return {
        'required_skills':         list(req_skills),
        'min_exp_months_detected': min_exp_mo,
        'total_candidates_scored': len(scored),
        'ranked':                  scored[:body.limit],
    }




class BulkAssignBody(BaseModel):
    candidate_ids: list
    requisition_id: str

@router.post("/bulk-assign")
async def bulk_assign(body: BulkAssignBody, actor: Actor = Depends(get_actor)):
    """Create applications for multiple candidates against a single requisition."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        # Validate requisition belongs to tenant
        req = await conn.fetchrow(
            "SELECT id, title FROM requisitions WHERE id=$1 AND tenant_id=$2",
            body.requisition_id, actor.tenant_id)
        if not req:
            from fastapi import HTTPException
            raise HTTPException(404, "Requisition not found")

        # Job-specific fit_score (same formula as match_candidates()/the Add
        # Candidate modal) so the score a recruiter picked from persists onto
        # the application, instead of falling back to the candidate's stale,
        # non-job-specific jd_match_score on the pipeline board.
        score_rows = await conn.fetch(
            "SELECT candidate_id, fit_score FROM match_candidates($1, 100000)",
            body.requisition_id)
        scores = {str(r["candidate_id"]): r["fit_score"] for r in score_rows}

        created = 0
        skipped = 0
        for cid in body.candidate_ids:
            # Check if application already exists
            exists = await conn.fetchval(
                "SELECT 1 FROM applications WHERE candidate_id=$1 AND requisition_id=$2 AND tenant_id=$3",
                cid, body.requisition_id, actor.tenant_id)
            if exists:
                skipped += 1
                continue
            await conn.execute("""
                INSERT INTO applications
                  (tenant_id, candidate_id, requisition_id, stage, fit_score)
                VALUES ($1, $2, $3, 'sourced', $4)
                ON CONFLICT DO NOTHING
            """, actor.tenant_id, cid, body.requisition_id, scores.get(cid))
            # Log activity
            await conn.execute("""
                INSERT INTO candidate_activities
                  (tenant_id, candidate_id, user_id, activity_type, title, description)
                VALUES ($1, $2, $3, 'status_change', 'Added to Pipeline', $4)
            """, actor.tenant_id, cid, str(actor.user_id),
                 f"Added to pipeline: {req['title']}")
            created += 1

    return {"created": created, "skipped": skipped, "requisition_title": req["title"]}

@router.get("/check-duplicate")
async def check_duplicate(
    email: str = None,
    phone: str = None,
    actor: Actor = Depends(get_actor),
):
    async with db.tenant_conn(actor.tenant_id) as conn:
        results = []
        if email:
            row = await conn.fetchrow(
                f"SELECT {FIELDS} FROM candidates WHERE email ILIKE $1", email.strip())
            if row:
                results.append({"match_type": "email", "candidate": dict(row)})
        if phone:
            clean = phone.strip().replace(" ","").replace("-","").replace("+91","").replace("+","")
            row = await conn.fetchrow(
                f"SELECT {FIELDS} FROM candidates WHERE REPLACE(REPLACE(REPLACE(phone,'+91',''),'-',''),' ','') ILIKE $1",
                "%" + clean[-10:])
            if row:
                results.append({"match_type": "phone", "candidate": dict(row)})
        return {"duplicates": results, "has_duplicate": len(results) > 0}


@router.post("")
async def create_candidate(body: CandidateCreate, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        # Check for existing candidate with same email (per tenant)
        if body.email:
            existing = await conn.fetchrow(
                f"SELECT {FIELDS} FROM candidates WHERE email=$1 LIMIT 1",
                body.email.strip().lower())
            if existing:
                raise HTTPException(409, {
                    "detail": "A candidate with this email already exists",
                    "existing_id": str(existing["id"]),
                    "existing_name": existing["full_name"]
                })
        try:
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
        except Exception as exc:
            if "uq_candidates_email_per_tenant" in str(exc):
                existing2 = await conn.fetchrow(
                    f"SELECT {FIELDS} FROM candidates WHERE email=$1 LIMIT 1",
                    body.email.strip().lower())
                raise HTTPException(409, {
                    "detail": "A candidate with this email already exists",
                    "existing_id": str(existing2["id"]) if existing2 else None
                }) from exc
            raise
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
        # Fetch latest resume file for download button
        rf = await conn.fetchrow(
            "SELECT id, file_name FROM resume_files WHERE candidate_id=$1 AND tenant_id=$2"
            " ORDER BY created_at DESC LIMIT 1",
            candidate_id, actor.tenant_id
        )
    d = dict(row)
    if rf:
        d['latest_resume_file_id'] = str(rf['id'])
        d['latest_resume_file_name'] = rf['file_name']
    return d


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
                        await conn.execute(f"DELETE FROM {tbl} WHERE candidate_id=$1", candidate_id)
                except Exception:
                    pass
            r = await conn.execute(
                "DELETE FROM candidates WHERE id=$1 AND tenant_id=$2",
                candidate_id, actor.tenant_id)
    if not int((r or "DELETE 0").split()[-1]):
        raise HTTPException(404, "Not found")
    return {"ok": True, "deleted": candidate_id}


@router.post("/{candidate_id}/merge")
async def merge_candidate(candidate_id: str, body: dict, actor: Actor = Depends(get_actor)):
    discard_id = body.get("discard_id")
    if not discard_id: raise HTTPException(400, "discard_id required")
    async with db.tenant_conn(actor.tenant_id) as conn:
        keep    = await conn.fetchrow("SELECT id FROM candidates WHERE id= AND tenant_id=", candidate_id, actor.tenant_id)
        discard = await conn.fetchrow("SELECT id FROM candidates WHERE id= AND tenant_id=", discard_id, actor.tenant_id)
        if not keep or not discard: raise HTTPException(404, "Candidate not found")
        await conn.execute("""
            UPDATE applications SET candidate_id=
            WHERE candidate_id= AND tenant_id=
              AND requisition_id NOT IN (
                  SELECT requisition_id FROM applications WHERE candidate_id=)
        """, candidate_id, discard_id, actor.tenant_id)
        await conn.execute("UPDATE candidates SET is_active=false WHERE id=", discard_id)
    return {"merged": True, "kept": candidate_id, "discarded": discard_id}


@router.get("/{candidate_id}/applications")
async def candidate_applications(candidate_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            "SELECT a.id, a.requisition_id, r.title AS requisition_title, a.stage, "
            "a.fit_score, a.created_at, a.updated_at "
            "FROM applications a JOIN requisitions r ON r.id=a.requisition_id "
            "WHERE a.candidate_id=$1 ORDER BY a.created_at DESC",
            candidate_id)
    return [dict(r) for r in rows]


@router.get("/{candidate_id}/parse-history")
async def parse_history(candidate_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        cpd = await conn.fetchrow(
            "SELECT * FROM candidate_parsed_data WHERE tenant_id=$1 AND candidate_id=$2",
            actor.tenant_id, candidate_id)
        files = await conn.fetch(
            "SELECT id, imap_msg_id, job_board_label, source_email, file_name, "
            "routing_decision, parse_confidence, dedup_status, "
            "parsed_data->>'name' AS parsed_name, parsed_data->'skills' AS parsed_skills, "
            "parsed_data->>'experience_years' AS parsed_exp, "
            "parsed_data->>'current_company' AS parsed_company, created_at "
            "FROM resume_files WHERE tenant_id=$1 AND candidate_id=$2 "
            "ORDER BY parse_confidence DESC NULLS LAST, created_at DESC",
            actor.tenant_id, candidate_id)
        cand = await conn.fetchrow(
            "SELECT id, full_name, email, skills, total_exp_mo, source_label "
            "FROM candidates WHERE id=$1",
            candidate_id)
    if not cand:
        raise HTTPException(404, "Candidate not found")

    import json as _json
    def _skills(raw):
        if not raw: return []
        try:
            v = _json.loads(raw) if isinstance(raw, str) else raw
            return list(v)[:10] if isinstance(v, list) else []
        except Exception:
            return []

    return {
        "candidate": dict(cand),
        "current_parsed_data": {
            "resume_file_id":   str(cpd["resume_file_id"]) if cpd and cpd["resume_file_id"] else None,
            "parse_source":     cpd["parse_source"] if cpd else None,
            "parse_version":    cpd["parse_version"] if cpd else 0,
            "parsed_at":        cpd["parsed_at"].isoformat() if cpd and cpd["parsed_at"] else None,
            "extracted_skills": list(cpd["extracted_skills"] or []) if cpd else [],
            "total_years_exp":  float(cpd["total_years_exp"] or 0) if cpd else 0,
            "education_level":  cpd["education_level"] if cpd else None,
            "extracted_email":  cpd["extracted_email"] if cpd else None,
            "extracted_phone":  cpd["extracted_phone"] if cpd else None,
            "linkedin_url":     cpd["linkedin_url"] if cpd else None,
        } if cpd else None,
        "resume_files": [
            {
                "id":               str(f["id"]),
                "file_name":        f["file_name"],
                "source":           f["job_board_label"],
                "source_email":     f["source_email"],
                "routing_decision": f["routing_decision"],
                "parse_confidence": float(f["parse_confidence"] or 0),
                "dedup_status":     f["dedup_status"],
                "parsed_name":      f["parsed_name"],
                "parsed_skills":    _skills(f["parsed_skills"]),
                "parsed_exp":       f["parsed_exp"],
                "parsed_company":   f["parsed_company"],
                "created_at":       f["created_at"].isoformat(),
            }
            for f in files
        ],
        "total_files":     len(files),
        "has_parsed_data": cpd is not None,
    }