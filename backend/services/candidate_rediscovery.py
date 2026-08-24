"""Candidate rediscovery (2026-08-25) — 3rd of the 3 recruiter-CRM
features from the "Recruiter CRM Landscape" research report, and the
single most independently-validated feature in the whole report:
multiple unrelated vendors (Gem, Eightfold, SeekOut) converge on large
real ROI from automatically surfacing existing dormant/rejected
candidates against a newly-opened requisition, instead of relying on a
recruiter remembering "didn't we already talk to this person?"

Reuses the exact matching engine match_candidates_for_requisition()
(requisitions.py) already uses — match_candidates() SQL function +
compute_skill_similarity() Python helper — no second matching engine.
Called best-effort (never raises to the caller) from the same 3 "just
became open" moments requisitions.py already hooks for
auto_distribute_on_open, plus a daily scheduler catch-up job."""
from typing import Optional

import db
from routers.ner import compute_skill_similarity
from services.candidate_ownership import get_ownership

POOL_SIZE = 300  # matches requisitions.py's match_candidates_for_requisition


async def scan_requisition_for_rediscovery(tenant_id: str, requisition_id: str, top_n: int = 5) -> list[dict]:
    async with db.tenant_conn(tenant_id) as conn:
        rows = await conn.fetch("SELECT * FROM match_candidates($1, $2)", requisition_id, POOL_SIZE)
        if not rows:
            return []

        req = await conn.fetchrow("SELECT title, skills_required FROM requisitions WHERE id=$1", requisition_id)
        req_skills = (req["skills_required"] if req else None) or []
        req_title = req["title"] if req else "a role"

        cand_ids = [r["candidate_id"] for r in rows]
        text_rows = await conn.fetch("SELECT id, resume_text FROM candidates WHERE id = ANY($1::uuid[])", cand_ids)
        resume_text_by_id = {r["id"]: r["resume_text"] for r in text_rows}

        # Exclude candidates currently in any active, non-rejected pipeline
        # anywhere — a candidate qualifies for rediscovery only if every
        # application they have (if any) is already 'rejected', or they
        # have none at all. is_active semantics match the "Remove from
        # Pipeline" convention (2026-08-20).
        ineligible_rows = await conn.fetch(
            """SELECT DISTINCT candidate_id FROM applications
               WHERE tenant_id=$1 AND candidate_id = ANY($2::uuid[])
                 AND is_active IS NOT FALSE AND stage <> 'rejected'""",
            tenant_id, cand_ids)
        ineligible = {r["candidate_id"] for r in ineligible_rows}

        scored = []
        for r in rows:
            d = dict(r)
            if d["candidate_id"] in ineligible:
                continue
            _, matched, missing = compute_skill_similarity(
                candidate_skills=d.get("skills"), required_skills=req_skills,
                resume_text=resume_text_by_id.get(d["candidate_id"]),
            )
            d["matched_skills"] = matched
            d["missing_skills"] = missing
            scored.append(d)

        # Same qualifying gate as match_candidates_for_requisition(): a
        # real matched skill required when the req has skills_required,
        # else fall back to top-by-cosine rather than claiming matches for
        # skills nobody ever specified.
        if req_skills:
            qualifying = [d for d in scored if len(d["matched_skills"]) > 0]
        else:
            qualifying = sorted(scored, key=lambda d: float(d["cosine_similarity"] or 0), reverse=True)[:20]

        qualifying.sort(key=lambda d: (len(d["matched_skills"]), float(d["cosine_similarity"] or 0)), reverse=True)
        top = qualifying[:top_n]
        if not top:
            return []

        inserted = []
        for d in top:
            row = await conn.fetchrow("""
                INSERT INTO candidate_rediscovery_matches
                  (tenant_id, requisition_id, candidate_id, cosine_similarity, matched_skills, missing_skills)
                VALUES ($1,$2,$3,$4,$5,$6)
                ON CONFLICT (tenant_id, requisition_id, candidate_id) DO NOTHING
                RETURNING id, candidate_id
            """, tenant_id, requisition_id, d["candidate_id"], d["cosine_similarity"],
                d["matched_skills"], d["missing_skills"])
            if row:
                inserted.append({**row, "full_name": d.get("full_name")})

        for row in inserted:
            recruiter_id = await _resolve_notify_recruiter(conn, tenant_id, requisition_id, str(row["candidate_id"]))
            if not recruiter_id:
                continue
            await conn.execute(
                "UPDATE candidate_rediscovery_matches SET notified_recruiter_id=$1, notified_at=now() WHERE id=$2",
                recruiter_id, row["id"])
            await conn.execute(
                """INSERT INTO notifications (tenant_id, user_id, recipient_user_id, title, body, type, resource, resource_id, channel)
                   VALUES ($1,$2,$2,$3,$4,'info','candidate',$5,'inapp')""",
                tenant_id, recruiter_id, f"Rediscovered candidate for {req_title}",
                f"{row['full_name']} is a strong match for \"{req_title}\" and isn't currently in any active pipeline.",
                str(row["candidate_id"]),
            )

        return inserted


async def _resolve_notify_recruiter(conn, tenant_id: str, requisition_id: str, candidate_id: str) -> Optional[str]:
    """3-tier: (1) the candidate's own active owner — their candidate,
    their credit; (2) else the requisition's actively assigned recruiter;
    (3) else no one — the match still persists, just isn't pushed."""
    owner = await get_ownership(conn, tenant_id, candidate_id)
    if owner and owner["status"] == "active":
        return str(owner["recruiter_id"])
    assigned = await conn.fetchval(
        "SELECT recruiter_id FROM assignments WHERE tenant_id=$1 AND requisition_id=$2 AND status='active'",
        tenant_id, requisition_id)
    return str(assigned) if assigned else None
