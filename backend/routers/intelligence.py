"""P18 + P19 — Resume Intelligence & Candidate Scoring.

Uses regex NER (zero LLM) + BGE-small embed service for semantic matching.
"""
import json
from typing import Optional
import httpx
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
import db
from deps import Actor, get_actor
from routers.ner import parse_resume, score_candidate

router = APIRouter(prefix="/intelligence", tags=["intelligence"])

EMBED_URL = "http://embed:8081/embed"


async def get_embedding(texts: list[str]) -> list[list[float]]:
    """Call BGE-small embed service."""
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(EMBED_URL, json={"texts": texts})
        r.raise_for_status()
        return r.json()["embeddings"]


def cosine_sim(a: list[float], b: list[float]) -> float:
    dot = sum(x*y for x,y in zip(a,b))
    na  = sum(x*x for x in a)**0.5
    nb  = sum(x*x for x in b)**0.5
    return dot / (na * nb + 1e-9)


# ── Schemas ──────────────────────────────────────────────

class ParseRequest(BaseModel):
    candidate_id: str
    resume_text: Optional[str] = None  # if None, fetch from DB

class ScoreRequest(BaseModel):
    candidate_id: str
    requisition_id: Optional[str] = None
    required_exp_yr_min: float = 0
    required_exp_yr_max: Optional[float] = None
    required_education: Optional[str] = None
    jd_text: Optional[str] = None  # for semantic match

class BulkScoreRequest(BaseModel):
    requisition_id: str
    required_exp_yr_min: float = 0
    required_exp_yr_max: Optional[float] = None
    required_education: Optional[str] = None
    jd_text: Optional[str] = None
    limit: int = 50
    candidate_ids: list = []
    # Real bug fixed 2026-08-20: this field was referenced below
    # (`not body.fast_mode`) but never declared here — every real call
    # with a non-empty jd_text crashed with a 500 AttributeError the
    # instant that line was reached (Pydantic raises on an undefined
    # attribute access, not silently returning None). Never caught
    # before because this endpoint has zero real callers, frontend or
    # backend, so nothing had ever exercised the jd_text-provided path.
    fast_mode: bool = False

class JdParseRequest(BaseModel):
    requisition_id: str
    jd_text: str
    required_exp_yr_min: float = 0
    required_exp_yr_max: Optional[float] = None
    required_education: Optional[str] = None


# ── Resume Parse (P18) ───────────────────────────────────

@router.post("/parse")
async def parse_candidate(body: ParseRequest, actor: Actor = Depends(get_actor)):
    """Extract structured data from a candidate's resume_text (regex NER)."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        cand = await conn.fetchrow(
            "SELECT id, resume_text, skills, total_exp_mo FROM candidates WHERE id=$1",
            body.candidate_id)
        if not cand:
            raise HTTPException(404, "Candidate not found")

        text = body.resume_text or cand["resume_text"] or ""
        parsed = parse_resume(text)
        # Merge with existing skills array
        merged_skills = list(set(list(cand["skills"] or []) + parsed.get("extracted_skills", [])))
        parsed["extracted_skills"] = merged_skills

        row = await conn.fetchrow("""
            INSERT INTO candidate_parsed_data
              (tenant_id, candidate_id, extracted_skills, extracted_titles,
               education_level, degrees, total_years_exp, job_count,
               max_gap_months, avg_tenure_months,
               extracted_email, extracted_phone, linkedin_url, raw_parsed)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
            ON CONFLICT (tenant_id, candidate_id) DO UPDATE SET
              extracted_skills   = EXCLUDED.extracted_skills,
              extracted_titles   = EXCLUDED.extracted_titles,
              education_level    = EXCLUDED.education_level,
              degrees            = EXCLUDED.degrees,
              total_years_exp    = EXCLUDED.total_years_exp,
              job_count          = EXCLUDED.job_count,
              max_gap_months     = EXCLUDED.max_gap_months,
              avg_tenure_months  = EXCLUDED.avg_tenure_months,
              extracted_email    = EXCLUDED.extracted_email,
              extracted_phone    = EXCLUDED.extracted_phone,
              linkedin_url       = EXCLUDED.linkedin_url,
              raw_parsed         = EXCLUDED.raw_parsed,
              parsed_at          = now(),
              parse_version      = candidate_parsed_data.parse_version + 1
            RETURNING *
        """,
            actor.tenant_id, body.candidate_id,
            parsed.get("extracted_skills", []),
            parsed.get("extracted_titles", []),
            parsed.get("education_level", "Other"),
            parsed.get("degrees", []),
            parsed.get("total_years_exp"),
            parsed.get("job_count", 0),
            parsed.get("max_gap_months", 0),
            parsed.get("avg_tenure_months", 0),
            parsed.get("extracted_email"),
            parsed.get("extracted_phone"),
            parsed.get("linkedin_url"),
            json.dumps(parsed),
        )
    return dict(row)


@router.get("/parse/{candidate_id}")
async def get_parsed(candidate_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT * FROM candidate_parsed_data WHERE tenant_id=$1 AND candidate_id=$2",
            actor.tenant_id, candidate_id)
        if not row:
            raise HTTPException(404, "Not parsed yet. POST /intelligence/parse first.")
    return dict(row)


@router.post("/parse-jd")
async def parse_jd(body: JdParseRequest, actor: Actor = Depends(get_actor)):
    """Extract structured data from a JD text + generate embedding."""
    parsed = parse_resume(body.jd_text)  # reuse same extractor
    emb = await get_embedding([body.jd_text])
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            INSERT INTO jd_parsed_data
              (tenant_id, requisition_id, required_skills, preferred_skills,
               required_exp_years_min, required_exp_years_max,
               education_required, keywords, jd_embedding)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::vector)
            ON CONFLICT (tenant_id, requisition_id) DO UPDATE SET
              required_skills = EXCLUDED.required_skills,
              preferred_skills = EXCLUDED.preferred_skills,
              required_exp_years_min = EXCLUDED.required_exp_years_min,
              required_exp_years_max = EXCLUDED.required_exp_years_max,
              education_required = EXCLUDED.education_required,
              keywords = EXCLUDED.keywords,
              jd_embedding = EXCLUDED.jd_embedding,
              parsed_at = now()
            RETURNING id, requisition_id, required_skills, required_exp_years_min,
                      required_exp_years_max, education_required, keywords, parsed_at
        """,
            actor.tenant_id, body.requisition_id,
            parsed.get("extracted_skills", []),
            [],
            body.required_exp_yr_min, body.required_exp_yr_max,
            body.required_education,
            parsed.get("extracted_skills", [])[:20],
            str(emb[0]),
        )
    return dict(row)


# ── Candidate Scoring (P19) ──────────────────────────────

async def score_candidate_core(conn, tenant_id: str, candidate_id: str, requisition_id: Optional[str] = None,
                                required_exp_yr_min: float = 0, required_exp_yr_max: Optional[float] = None,
                                required_education: Optional[str] = None, jd_text: Optional[str] = None,
                                required_skills: Optional[list] = None):
    """Core of /intelligence/score, pulled out so it's callable from
    non-HTTP contexts (e.g. auto-scoring on resume intake) on a caller-
    supplied connection, not just via the ScoreRequest/Actor HTTP path."""
    from routers.ner import compute_skill_similarity
    cand = await conn.fetchrow("""
        SELECT ca.id, ca.total_exp_mo, ca.resume_text, ca.resume_embedding::text AS emb,
               ca.skills, cpd.extracted_skills, cpd.education_level,
               cpd.total_years_exp, cpd.max_gap_months, cpd.avg_tenure_months,
               cpd.job_count
        FROM candidates ca
        LEFT JOIN candidate_parsed_data cpd ON cpd.candidate_id=ca.id AND cpd.tenant_id=ca.tenant_id
        WHERE ca.id=$1 AND ca.tenant_id=$2
    """, candidate_id, tenant_id)
    if not cand:
        raise HTTPException(404, "Candidate not found")
    # Auto-parse if not already done
    if not cand.get("extracted_skills") and cand.get("resume_text"):
        from routers.ner import parse_resume
        parsed = parse_resume(cand["resume_text"] or "")
        await conn.execute("""
            INSERT INTO candidate_parsed_data
              (tenant_id, candidate_id, extracted_skills, education_level,
               total_years_exp, job_count, max_gap_months, avg_tenure_months)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            ON CONFLICT (tenant_id, candidate_id) DO UPDATE SET
              extracted_skills=EXCLUDED.extracted_skills
        """, tenant_id, candidate_id,
            parsed.get("extracted_skills",[]),
            parsed.get("education_level","Other"),
            parsed.get("total_years_exp"),
            parsed.get("job_count",0),
            parsed.get("max_gap_months",0),
            parsed.get("avg_tenure_months",0))
        # Refresh cand
        cand = await conn.fetchrow("""
            SELECT ca.id, ca.total_exp_mo, ca.resume_text, ca.resume_embedding::text AS emb,
                   ca.skills, cpd.extracted_skills, cpd.education_level,
                   cpd.total_years_exp, cpd.max_gap_months, cpd.avg_tenure_months, cpd.job_count
            FROM candidates ca
            LEFT JOIN candidate_parsed_data cpd ON cpd.candidate_id=ca.id AND cpd.tenant_id=ca.tenant_id
            WHERE ca.id=$1 AND ca.tenant_id=$2
        """, candidate_id, tenant_id)

    parsed_data = dict(cand)

    # Real gap fix (2026-08-20): skill match previously came ONLY from
    # cosine similarity of jd_text - a requisition with no description
    # text (common on quickly-created test/real requisitions alike)
    # silently forced skill_sim to 0 regardless of real, structured
    # skills_required overlap. When requisition_id is given but the
    # caller didn't already supply skills_required (score_one/auto-score
    # callers don't - only match_candidate_against_open_jobs does, since
    # it already has the row), fetch it here so every caller benefits,
    # not just the ones that remember to pass it.
    if requisition_id and required_skills is None:
        required_skills = await conn.fetchval(
            "SELECT skills_required FROM requisitions WHERE id=$1 AND tenant_id=$2",
            requisition_id, tenant_id) or []

    cosine_val = None
    if jd_text and cand["resume_text"]:
        try:
            embeddings = await get_embedding([cand["resume_text"], jd_text])
            cosine_val = max(0.0, cosine_sim(embeddings[0], embeddings[1]))
        except Exception:
            cosine_val = 0.5  # fallback if embed service issues

    skill_sim, matched_skills, missing_skills = compute_skill_similarity(
        candidate_skills=cand["skills"], required_skills=required_skills, cosine_sim_value=cosine_val,
        resume_text=cand["resume_text"],
    )

    scores = score_candidate(
        parsed_data,
        candidate_exp_mo=cand["total_exp_mo"] or 0,
        required_exp_yr_min=required_exp_yr_min,
        required_exp_yr_max=required_exp_yr_max,
        skill_similarity=skill_sim,
        required_education=required_education,
    )
    scores["skill_match_details"] = json.dumps({
        "cosine_similarity": round(cosine_val, 4) if cosine_val is not None else None,
        "keyword_matched_skills": matched_skills,
        "keyword_missing_skills": missing_skills,
    })

    row = await conn.fetchrow("""
        INSERT INTO candidate_scores
          (tenant_id, candidate_id, requisition_id,
           skill_match_score, experience_score, stability_score,
           education_score, fraud_risk_score, readiness_index, readiness_grade,
           has_gap_flag, duplicate_flag, inconsistency_flag, skill_match_details)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
        ON CONFLICT (tenant_id, candidate_id, requisition_id) DO UPDATE SET
          skill_match_score = EXCLUDED.skill_match_score,
          experience_score  = EXCLUDED.experience_score,
          stability_score   = EXCLUDED.stability_score,
          education_score   = EXCLUDED.education_score,
          fraud_risk_score  = EXCLUDED.fraud_risk_score,
          readiness_index   = EXCLUDED.readiness_index,
          readiness_grade   = EXCLUDED.readiness_grade,
          has_gap_flag      = EXCLUDED.has_gap_flag,
          skill_match_details = EXCLUDED.skill_match_details,
          scored_at         = now()
        RETURNING *
    """,
        tenant_id, candidate_id, requisition_id,
        scores["skill_match_score"], scores["experience_score"],
        scores["stability_score"],  scores["education_score"],
        scores["fraud_risk_score"], scores["readiness_index"],
        scores["readiness_grade"],  scores["has_gap_flag"],
        scores["duplicate_flag"],   scores["inconsistency_flag"],
        scores["skill_match_details"],
    )
    return dict(row)


@router.post("/score")
async def score_one(body: ScoreRequest, actor: Actor = Depends(get_actor)):
    """Score a single candidate against a JD (or standalone)."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        return await score_candidate_core(
            conn, actor.tenant_id, body.candidate_id, body.requisition_id,
            body.required_exp_yr_min, body.required_exp_yr_max,
            body.required_education, body.jd_text,
        )


@router.post("/score/bulk")
async def score_bulk(body: BulkScoreRequest, actor: Actor = Depends(get_actor)):
    """Score all candidates for a requisition. Rewritten 2026-08-20 to call
    the shared score_candidate_core() per candidate instead of maintaining
    a second, independently-drifted copy of the same scoring logic - that
    second copy is what let the fast_mode bug (undeclared field, crashed
    every real call with jd_text) and the skills_required-blind skill
    score both go unnoticed here specifically, even after being fixed in
    score_candidate_core's own callers. fast_mode now means "skip the
    per-candidate embed round-trip" (jd_text withheld from the core call)
    rather than a separate, less-capable scoring path - keyword-based
    skill_similarity from skills_required still applies either way."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        req = await conn.fetchrow(
            "SELECT skills_required FROM requisitions WHERE id=$1 AND tenant_id=$2",
            body.requisition_id, actor.tenant_id)
        required_skills = (req["skills_required"] if req else None) or []

        candidate_ids = await conn.fetch("""
            SELECT id FROM candidates
            WHERE tenant_id=$1 AND is_active IS NOT FALSE
              AND (ARRAY_LENGTH($2::uuid[], 1) IS NULL OR id = ANY($2::uuid[]))
            LIMIT $3
        """, actor.tenant_id, [c for c in (body.candidate_ids or [])], body.limit)

        results = []
        for row in candidate_ids:
            try:
                scores = await score_candidate_core(
                    conn, actor.tenant_id, str(row["id"]), body.requisition_id,
                    required_exp_yr_min=body.required_exp_yr_min,
                    required_exp_yr_max=body.required_exp_yr_max,
                    required_education=body.required_education,
                    jd_text=(None if body.fast_mode else body.jd_text),
                    required_skills=required_skills,
                )
                results.append({"candidate_id": str(row["id"]),
                                "readiness_index": scores["readiness_index"],
                                "readiness_grade": scores["readiness_grade"]})
            except Exception as e:
                print(f"[ScoreBulk] Failed scoring candidate {row['id']}: {e}")

    results.sort(key=lambda x: x["readiness_index"], reverse=True)
    return {"scored": len(results), "top_candidates": results[:20]}


@router.get("/candidates")
async def list_intelligence(
    min_score: Optional[float] = None,
    grade: Optional[str] = None,
    requisition_id: Optional[str] = None,
    candidate_id: Optional[str] = None,
    actor: Actor = Depends(get_actor)
):
    """Tenant-wide, cross-recruiter ranked candidate list — the "Account
    Manager view": every scored (candidate, requisition) pair, sorted by
    fit, regardless of which recruiter submitted the candidate. There's no
    formal "account_manager" auth role in this system (users.role is just
    admin/manager/recruiter) — visibility here is admin/manager always, or
    anyone holding a real client_owners assignment (kae/account_manager/
    secondary), matching how "manages client accounts" is actually modeled
    elsewhere in the schema.

    Deliberately queries candidate_scores directly rather than
    v_candidate_intelligence — that view only surfaces each candidate's
    single most-recent score with no indication of which requisition it
    was scored against, which isn't useful for "who should I present for
    THIS role."

    requisition_id/candidate_id added 2026-08-09: the unfiltered view is
    ORDER BY readiness_index DESC LIMIT 200 - a deliberate, reasonable cap
    for "show me the best candidates tenant-wide", but it means there was
    previously no way to reliably ask "show me every scored candidate for
    THIS specific role" on a tenant with more than 200 higher-or-equal-
    scoring pairs (this one has 500+) - arguably the more common real
    question an account manager actually has. min_score alone can't
    substitute for this: filtering to >= a given score still returns
    whatever's within the top 200 of that filtered set, which is not the
    same as "all of them" once the filtered set itself exceeds 200 rows."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        # actor.role is None for x-tenant-id-only access (no JWT) — that's
        # the trusted internal/automation path (n8n, etc.), not a real user
        # role, so it's exempt from this gate rather than being treated as
        # "not admin/manager" and blocked.
        if actor.role is not None and actor.role not in ("admin", "manager"):
            is_am = await conn.fetchval(
                "SELECT 1 FROM client_owners WHERE tenant_id=$1 AND user_id=$2 AND is_active LIMIT 1",
                actor.tenant_id, actor.user_id)
            if not is_am:
                raise HTTPException(403, "Account Manager view requires admin/manager role or a client ownership assignment")
        rows = await conn.fetch("""
            SELECT ca.id AS candidate_id, ca.full_name, ca.email, ca.skills, ca.total_exp_mo,
                   ca.location, ca.current_employer, ca.current_designation,
                   cpd.extracted_skills, cpd.education_level, cpd.total_years_exp,
                   cs.readiness_index, cs.readiness_grade, cs.skill_match_score,
                   cs.experience_score, cs.stability_score, cs.education_score,
                   cs.has_gap_flag, cs.duplicate_flag, cs.scored_at,
                   cs.requisition_id, r.title AS requisition_title, r.client_id, cl.name AS client_name
            FROM candidate_scores cs
            JOIN candidates ca ON ca.id = cs.candidate_id AND ca.tenant_id = cs.tenant_id
            LEFT JOIN candidate_parsed_data cpd ON cpd.candidate_id = ca.id AND cpd.tenant_id = ca.tenant_id
            LEFT JOIN requisitions r ON r.id = cs.requisition_id
            LEFT JOIN clients cl ON cl.id = r.client_id
            WHERE cs.tenant_id = $1 AND ca.is_active IS NOT FALSE
              AND ($2::numeric IS NULL OR cs.readiness_index >= $2)
              AND ($3::text IS NULL OR cs.readiness_grade = $3)
              AND ($4::uuid IS NULL OR cs.requisition_id = $4)
              AND ($5::uuid IS NULL OR cs.candidate_id = $5)
            ORDER BY cs.readiness_index DESC NULLS LAST
            LIMIT 200
        """, actor.tenant_id, min_score, grade, requisition_id, candidate_id)
    return [dict(r) for r in rows]


@router.get("/stats")
async def intelligence_stats(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            SELECT COUNT(*) AS total_scored,
                   ROUND(AVG(readiness_index),1) AS avg_readiness,
                   COUNT(*) FILTER (WHERE readiness_grade='A+') AS grade_aplus,
                   COUNT(*) FILTER (WHERE readiness_grade='A')  AS grade_a,
                   COUNT(*) FILTER (WHERE readiness_grade='B')  AS grade_b,
                   COUNT(*) FILTER (WHERE readiness_grade IN ('C','D')) AS grade_cd,
                   COUNT(*) FILTER (WHERE has_gap_flag) AS gap_flagged,
                   COUNT(*) FILTER (WHERE duplicate_flag) AS duplicate_flagged
            FROM candidate_scores
        """)
        parsed = await conn.fetchval(
            "SELECT COUNT(*) FROM candidate_parsed_data WHERE tenant_id=$1", actor.tenant_id)
    return {**dict(row), "total_parsed": parsed}
