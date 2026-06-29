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

@router.post("/score")
async def score_one(body: ScoreRequest, actor: Actor = Depends(get_actor)):
    """Score a single candidate against a JD (or standalone)."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        cand = await conn.fetchrow("""
            SELECT ca.id, ca.total_exp_mo, ca.resume_text, ca.resume_embedding::text AS emb,
                   cpd.extracted_skills, cpd.education_level,
                   cpd.total_years_exp, cpd.max_gap_months, cpd.avg_tenure_months,
                   cpd.job_count
            FROM candidates ca
            LEFT JOIN candidate_parsed_data cpd ON cpd.candidate_id=ca.id AND cpd.tenant_id=ca.tenant_id
            WHERE ca.id=$1 AND ca.tenant_id=$2
        """, body.candidate_id, actor.tenant_id)
        if not cand:
            raise HTTPException(404, "Candidate not found")
        # Auto-parse if not already done
        if not cand.get("extracted_skills") and cand.get("resume_text"):
            from routers.ner import parse_resume
            import json as _json
            parsed = parse_resume(cand["resume_text"] or "")
            await conn.execute("""
                INSERT INTO candidate_parsed_data
                  (tenant_id, candidate_id, extracted_skills, education_level,
                   total_years_exp, job_count, max_gap_months, avg_tenure_months)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                ON CONFLICT (tenant_id, candidate_id) DO UPDATE SET
                  extracted_skills=EXCLUDED.extracted_skills
            """, actor.tenant_id, body.candidate_id,
                parsed.get("extracted_skills",[]),
                parsed.get("education_level","Other"),
                parsed.get("total_years_exp"),
                parsed.get("job_count",0),
                parsed.get("max_gap_months",0),
                parsed.get("avg_tenure_months",0))
            # Refresh cand
            cand = await conn.fetchrow("""
                SELECT ca.id, ca.total_exp_mo, ca.resume_text, ca.resume_embedding::text AS emb,
                       cpd.extracted_skills, cpd.education_level,
                       cpd.total_years_exp, cpd.max_gap_months, cpd.avg_tenure_months, cpd.job_count
                FROM candidates ca
                LEFT JOIN candidate_parsed_data cpd ON cpd.candidate_id=ca.id AND cpd.tenant_id=ca.tenant_id
                WHERE ca.id=$1 AND ca.tenant_id=$2
            """, body.candidate_id, actor.tenant_id)

        parsed_data = dict(cand)
        skill_sim = 0.0

        # Semantic similarity via embed service
        if body.jd_text and cand["resume_text"]:
            try:
                embeddings = await get_embedding([cand["resume_text"], body.jd_text])
                skill_sim  = max(0.0, cosine_sim(embeddings[0], embeddings[1]))
            except Exception:
                skill_sim = 0.5  # fallback if embed service issues

        scores = score_candidate(
            parsed_data,
            candidate_exp_mo=cand["total_exp_mo"] or 0,
            required_exp_yr_min=body.required_exp_yr_min,
            required_exp_yr_max=body.required_exp_yr_max,
            skill_similarity=skill_sim,
            required_education=body.required_education,
        )
        scores["skill_match_details"] = json.dumps({"cosine_similarity": round(skill_sim, 4)})

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
            actor.tenant_id, body.candidate_id, body.requisition_id,
            scores["skill_match_score"], scores["experience_score"],
            scores["stability_score"],  scores["education_score"],
            scores["fraud_risk_score"], scores["readiness_index"],
            scores["readiness_grade"],  scores["has_gap_flag"],
            scores["duplicate_flag"],   scores["inconsistency_flag"],
            json.dumps({"cosine_similarity": round(skill_sim, 4)}),
        )
    return dict(row)


@router.post("/score/bulk")
async def score_bulk(body: BulkScoreRequest, actor: Actor = Depends(get_actor)):
    """Score all candidates for a requisition using embed similarity."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        # Get JD embedding from parsed_data or generate
        jd_emb = None
        if body.jd_text:
            try:
                jd_embs = await get_embedding([body.jd_text])
                jd_emb = jd_embs[0]
            except Exception:
                pass

        candidates = await conn.fetch("""
            SELECT ca.id, ca.total_exp_mo, ca.resume_text,
                   cpd.education_level, cpd.total_years_exp,
                   cpd.max_gap_months, cpd.avg_tenure_months, cpd.job_count,
                   ca.resume_embedding::text AS emb
            FROM candidates ca
            LEFT JOIN candidate_parsed_data cpd ON cpd.candidate_id=ca.id AND cpd.tenant_id=ca.tenant_id
            WHERE ca.tenant_id=$1 AND (ARRAY_LENGTH($2::uuid[], 1) IS NULL OR ca.id = ANY($2::uuid[]))
            LIMIT $3
        """, actor.tenant_id, [c for c in (body.candidate_ids or [])], body.limit)

        results = []
        for cand in candidates:
            parsed_data = dict(cand)
            skill_sim = 0.0
            if jd_emb and cand["resume_text"] and not body.fast_mode:
                try:
                    import asyncio
                    c_embs = await asyncio.wait_for(
                        get_embedding([cand["resume_text"][:300]]),
                        timeout=3.0
                    )
                    skill_sim = max(0.0, cosine_sim(c_embs[0], jd_emb))
                except Exception:
                    skill_sim = 0.5  # fallback if embed times out

            scores = score_candidate(
                parsed_data,
                candidate_exp_mo=cand["total_exp_mo"] or 0,
                required_exp_yr_min=body.required_exp_yr_min,
                required_exp_yr_max=body.required_exp_yr_max,
                skill_similarity=skill_sim,
                required_education=body.required_education,
            )

            await conn.execute("""
                INSERT INTO candidate_scores
                  (tenant_id, candidate_id, requisition_id,
                   skill_match_score, experience_score, stability_score,
                   education_score, fraud_risk_score, readiness_index,
                   readiness_grade, has_gap_flag, skill_match_details)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
                ON CONFLICT (tenant_id, candidate_id, requisition_id) DO UPDATE SET
                  readiness_index = EXCLUDED.readiness_index,
                  readiness_grade = EXCLUDED.readiness_grade,
                  skill_match_score = EXCLUDED.skill_match_score,
                  scored_at = now()
            """,
                actor.tenant_id, cand["id"], body.requisition_id,
                scores["skill_match_score"], scores["experience_score"],
                scores["stability_score"],  scores["education_score"],
                scores["fraud_risk_score"], scores["readiness_index"],
                scores["readiness_grade"],  scores["has_gap_flag"],
                json.dumps({"cosine_similarity": round(skill_sim, 4)}),
            )
            results.append({"candidate_id": str(cand["id"]),
                            "readiness_index": scores["readiness_index"],
                            "readiness_grade": scores["readiness_grade"]})

    results.sort(key=lambda x: x["readiness_index"], reverse=True)
    return {"scored": len(results), "top_candidates": results[:20]}


@router.get("/candidates")
async def list_intelligence(
    min_score: Optional[float] = None,
    grade: Optional[str] = None,
    actor: Actor = Depends(get_actor)
):
    """List all candidates with their intelligence scores."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT * FROM v_candidate_intelligence
            WHERE ($1::numeric IS NULL OR readiness_index >= $1)
              AND ($2::text IS NULL OR readiness_grade = $2)
            ORDER BY readiness_index DESC NULLS LAST
            LIMIT 100
        """, min_score, grade)
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
