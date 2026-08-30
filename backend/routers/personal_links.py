"""Recruiter personal resume-drop link (2026-08-25) — 1st of the 3
recruiter-CRM features from the "Recruiter CRM Landscape" research
report. A permanent, shareable link per recruiter, not tied to any job —
post it on LinkedIn/WhatsApp as "send me your CV." Whoever submits
through it becomes a candidate auto-claimed as that recruiter's owned
candidate via the existing 30-day FCFS candidate_ownership service.

Two routers, same auth/no-auth split as field_attendance.py: `router`
(authenticated, the recruiter fetching/managing their own link) and
`public_router` (no auth — a public candidate lands here with only a
token, no app.tenant_id set yet)."""
import os
import secrets
import json as _json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Form, File, UploadFile

import db
from deps import Actor, get_actor

router = APIRouter(prefix="/personal-links", tags=["personal-links"])
public_router = APIRouter(prefix="/public/personal-links", tags=["public"])
job_router = APIRouter(prefix="/personal-links/job", tags=["personal-links"])
public_job_router = APIRouter(prefix="/public/job-links", tags=["public"])


async def _apply_extra_public_fields(
    conn, tenant_id: str, candidate_id: str, is_new_candidate: bool, *,
    role_position: Optional[str], current_ctc: Optional[float], expected_ctc: Optional[float],
    notice_period_days: Optional[int], preferred_location: Optional[str], linkedin_url: Optional[str],
    expert_skills_csv: Optional[str], intermediate_skills_csv: Optional[str], skill_experience_json: Optional[str],
):
    """Real feature (2026-08-30): the numbered field list reported live
    ("Role Position / Current CTC / Expected CTC / Notice Period /
    Current Location / Preferred Location / Expert Skills / Intermediate
    Skills / Skill Project Experience Optional / LinkedIn Profile"),
    shared by both public apply endpoints below (job-specific and
    personal-link) since they collect the identical extra fields.
    On a genuine new candidate, writes plainly. On an existing candidate
    re-submitting, uses the same gap-fill-only convention every other
    intake path in this codebase already follows (never overwrites a
    value already on file) - matching upsert_candidate()'s own rule.
    """
    expert = [s.strip() for s in (expert_skills_csv or "").split(",") if s.strip()]
    intermediate = [s.strip() for s in (intermediate_skills_csv or "").split(",") if s.strip()]
    combined = list(dict.fromkeys(expert + intermediate))  # dedupe, keep order

    if is_new_candidate:
        await conn.execute(
            """UPDATE candidates SET
                 interested_role=$2, current_ctc=$3, expected_ctc=$4, notice_period_days=$5,
                 desired_location=$6, linkedin_url=$7, expert_skills=$8, intermediate_skills=$9,
                 skills = CASE WHEN $10::text[] <> '{}' THEN
                   (SELECT array_agg(DISTINCT s) FROM unnest(skills || $10) s) ELSE skills END
               WHERE id=$1 AND tenant_id=$11""",
            candidate_id, role_position, current_ctc, expected_ctc, notice_period_days,
            preferred_location, linkedin_url, expert, intermediate, combined, tenant_id,
        )
    else:
        await conn.execute(
            """UPDATE candidates SET
                 interested_role = COALESCE(interested_role, $2),
                 current_ctc = COALESCE(current_ctc, $3),
                 expected_ctc = COALESCE(expected_ctc, $4),
                 notice_period_days = COALESCE(notice_period_days, $5),
                 desired_location = COALESCE(desired_location, $6),
                 linkedin_url = COALESCE(linkedin_url, $7),
                 expert_skills = CASE WHEN expert_skills='{}' AND $8::text[]<>'{}' THEN $8 ELSE expert_skills END,
                 intermediate_skills = CASE WHEN intermediate_skills='{}' AND $9::text[]<>'{}' THEN $9 ELSE intermediate_skills END,
                 skills = CASE WHEN $10::text[] <> '{}' THEN
                   (SELECT array_agg(DISTINCT s) FROM unnest(skills || $10) s) ELSE skills END
               WHERE id=$1 AND tenant_id=$11""",
            candidate_id, role_position, current_ctc, expected_ctc, notice_period_days,
            preferred_location, linkedin_url, expert, intermediate, combined, tenant_id,
        )

    # Skill / Project Experience (optional) - same real table/shape the
    # internal Add Candidate form already uses (candidates.py's own
    # PUT /{id}/skill-experience) - reused here as a genuine append, not
    # a second, parallel storage concept. Best-effort only: a malformed
    # or missing payload must never block a real public submission.
    if skill_experience_json:
        try:
            import json as _j
            rows = _j.loads(skill_experience_json)
            if isinstance(rows, list):
                existing_count = await conn.fetchval(
                    "SELECT COUNT(*) FROM candidate_skill_experience WHERE candidate_id=$1 AND tenant_id=$2",
                    candidate_id, tenant_id)
                for i, r in enumerate(rows):
                    if not isinstance(r, dict):
                        continue
                    skill_name = str(r.get("skill_name") or r.get("skill") or "").strip()
                    if not skill_name:
                        continue
                    role_types = r.get("role_types")
                    if not isinstance(role_types, list):
                        role_types = []
                    await conn.execute(
                        """INSERT INTO candidate_skill_experience
                             (tenant_id, candidate_id, skill_name, project_name, duration_from, duration_to,
                              role_types, relevant_experience, last_used, sort_order)
                           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)""",
                        tenant_id, candidate_id, skill_name, r.get("project_name"),
                        r.get("duration_from"), r.get("duration_to"), role_types,
                        r.get("relevant_experience"), r.get("last_used"), existing_count + i,
                    )
        except Exception:
            pass

APP_URL = os.environ.get("NEXT_PUBLIC_APP_URL", "https://ats.aviinjobs.com")


@router.get("/me")
async def get_or_create_my_link(actor: Actor = Depends(get_actor)):
    """Get-or-create: every recruiter gets exactly one permanent link,
    generated lazily on first request rather than requiring a separate
    "create" step."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT * FROM recruiter_personal_links WHERE tenant_id=$1 AND recruiter_id=$2",
            actor.tenant_id, actor.user_id)
        if not row:
            token = secrets.token_urlsafe(12)
            row = await conn.fetchrow(
                """INSERT INTO recruiter_personal_links (tenant_id, recruiter_id, token)
                   VALUES ($1,$2,$3)
                   ON CONFLICT (tenant_id, recruiter_id) DO NOTHING
                   RETURNING *""",
                actor.tenant_id, actor.user_id, token)
            if not row:
                # Lost a genuine race with a concurrent request — re-select
                # rather than error, matching the get-or-create contract.
                row = await conn.fetchrow(
                    "SELECT * FROM recruiter_personal_links WHERE tenant_id=$1 AND recruiter_id=$2",
                    actor.tenant_id, actor.user_id)
    return {**dict(row), "share_url": f"{APP_URL}/link/{row['token']}"}


@public_router.get("/{token}")
async def get_link_info(token: str):
    """No auth — the public landing page's first call, before the
    candidate has typed anything. Never leaks tenant_id/recruiter_id to
    an anonymous caller, matching public_apply's own established
    discipline (p28_p32.py)."""
    async with db.system_conn() as conn:
        row = await conn.fetchrow("SELECT * FROM get_personal_link_by_token($1)", token)
    if not row:
        raise HTTPException(status_code=404, detail="Invalid or expired link")
    return {"recruiter_name": row["recruiter_name"], "tenant_name": row["tenant_name"]}


@public_router.post("/{token}/apply")
async def submit_resume(
    token: str,
    full_name: str = Form(''),
    email: str = Form(''),
    phone: Optional[str] = Form(None),
    location: Optional[str] = Form(None),
    current_employer: Optional[str] = Form(None),
    experience_months: int = Form(0),
    consent_given: bool = Form(False),
    resume: Optional[UploadFile] = File(None),
    # 2026-08-30 — reported live, see _apply_extra_public_fields() above
    role_position: Optional[str] = Form(None),
    current_ctc: Optional[float] = Form(None),
    expected_ctc: Optional[float] = Form(None),
    notice_period_days: Optional[int] = Form(None),
    preferred_location: Optional[str] = Form(None),
    linkedin_url: Optional[str] = Form(None),
    expert_skills: Optional[str] = Form(None),
    intermediate_skills: Optional[str] = Form(None),
    skill_experience: Optional[str] = Form(None),
):
    """No-auth public resume submission — same intake shape as
    public_apply() (p28_p32.py) minus the job/application half, since
    this link isn't tied to any specific role. HARD RULE #12: consent is
    required, not defaulted, same as every other public intake path."""
    async with db.system_conn() as conn:
        link = await conn.fetchrow("SELECT * FROM get_personal_link_by_token($1)", token)
    if not link:
        raise HTTPException(status_code=404, detail="Invalid or expired link")
    if not consent_given:
        raise HTTPException(status_code=400, detail="Consent to store and process your details is required to submit")
    if not full_name or not email:
        raise HTTPException(status_code=400, detail="Name and email are required")

    tenant_id = str(link["tenant_id"])
    recruiter_id = str(link["recruiter_id"])

    parsed: dict = {}
    resume_bytes: Optional[bytes] = None
    resume_filename: Optional[str] = None
    resume_mime: Optional[str] = None
    if resume is not None and resume.filename:
        try:
            resume_bytes = await resume.read()
            resume_filename = resume.filename
            resume_mime = resume.content_type or ''
            from services.resume_intake_service import extract_text_from_attachment, save_resume_file
            from services.document_classifier import classify_document
            from services.improved_parser import parse_resume_v2
            text = extract_text_from_attachment(resume_bytes, resume_mime, resume_filename)
            doc_result = classify_document(text, resume_filename, resume_mime)
            if doc_result.is_resume:
                parsed = parse_resume_v2(text, from_name=full_name, from_email=email, filename=resume_filename)
                parsed["_resume_text"] = text
        except Exception:
            # Best-effort enrichment only — a parsing failure must never
            # block a real submission.
            parsed = {}

    async with db.tenant_conn(tenant_id) as conn:
        email = email.lower()
        cand = await conn.fetchrow(
            "SELECT id FROM candidates WHERE email=$1 AND tenant_id=$2::uuid", email, tenant_id)
        is_new_candidate = cand is None
        if not cand:
            skills = parsed.get("skills") or []
            resume_text = parsed.get("_resume_text")
            cand = await conn.fetchrow("""
                INSERT INTO candidates
                  (tenant_id, full_name, email, phone, location, current_employer, total_exp_mo, source,
                   skills, resume_text)
                VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, 'recruiter_personal_link', $8, $9) RETURNING id
            """, tenant_id, full_name, email, phone, location, current_employer,
                 experience_months, skills, resume_text)
            await conn.execute(
                "INSERT INTO consent_records (tenant_id,candidate_id,data_category,channel,consent_given,consent_text) "
                "VALUES ($1::uuid,$2,'resume_processing','recruiter_personal_link',TRUE,$3)",
                tenant_id, cand['id'],
                "Applicant checked the DPDP 2023 consent box on a recruiter's personal resume-drop link.",
            )
        elif parsed.get("_resume_text"):
            # Existing candidate re-submitting — same gap-fill-only
            # convention as upsert_candidate()/public_apply(), never
            # overwrites a value already on file.
            await conn.execute("""
                UPDATE candidates SET
                  resume_text = CASE WHEN (resume_text IS NULL OR resume_text='') THEN $2 ELSE resume_text END,
                  skills = CASE WHEN skills = '{}' AND $3::text[] <> '{}' THEN $3 ELSE skills END
                WHERE id=$1""",
                cand['id'], parsed.get("_resume_text"), parsed.get("skills") or [])

        if resume_bytes:
            file_path = save_resume_file(resume_bytes, tenant_id, resume_filename)
            await conn.execute("""
                INSERT INTO resume_files
                  (tenant_id, candidate_id, job_board, job_board_label, source_email,
                   file_name, file_path, mime_type, file_size,
                   parse_status, parsed_data, parse_confidence, routing_decision)
                VALUES ($1,$2,'personal_link','Personal Resume Link',$3,$4,$5,$6,$7,$8,$9,$10,$11)""",
                tenant_id, cand['id'], email, resume_filename, file_path, resume_mime, len(resume_bytes),
                'auto_accepted' if parsed else 'not_a_resume',
                _json.dumps(parsed) if parsed else '{}',
                round(float(parsed.get("_confidence", 0.7) or 0.7), 3) if parsed else 0.0,
                'auto_accepted' if parsed else 'rejected')

        await _apply_extra_public_fields(
            conn, tenant_id, str(cand['id']), is_new_candidate,
            role_position=role_position, current_ctc=current_ctc, expected_ctc=expected_ctc,
            notice_period_days=notice_period_days, preferred_location=preferred_location,
            linkedin_url=linkedin_url, expert_skills_csv=expert_skills,
            intermediate_skills_csv=intermediate_skills, skill_experience_json=skill_experience,
        )

        # On genuine creation only — never claim ownership on an update to
        # an existing candidate, matching every other intake path's rule.
        if is_new_candidate:
            recruiter_email = await conn.fetchval("SELECT email FROM users WHERE id=$1", recruiter_id)
            if recruiter_email:
                from services.candidate_ownership import claim_ownership
                await claim_ownership(conn, tenant_id, cand['id'], recruiter_id, recruiter_email, 'personal_link')

        # Every successful submission, not just new candidates — matches
        # referral_links.click_count's own "every event, not unique" convention.
        await conn.execute(
            "UPDATE recruiter_personal_links SET submission_count = submission_count + 1 WHERE tenant_id=$1 AND token=$2",
            tenant_id, token)

    return {"applied": True}


@job_router.get("/{requisition_id}")
async def get_or_create_job_link(requisition_id: str, actor: Actor = Depends(get_actor)):
    """Get-or-create a job-specific resume link, the standard-form
    counterpart to the per-job referral_links (which sends a candidate to
    the full public Career Page instead). Same clean form, scoped to one
    requisition, same claim_ownership() attribution on submit."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        req = await conn.fetchrow(
            "SELECT id, title FROM requisitions WHERE id=$1 AND tenant_id=$2 AND is_active IS NOT FALSE",
            requisition_id, actor.tenant_id)
        if not req:
            raise HTTPException(status_code=404, detail="Requisition not found")
        row = await conn.fetchrow(
            "SELECT * FROM recruiter_job_links WHERE tenant_id=$1 AND recruiter_id=$2 AND requisition_id=$3",
            actor.tenant_id, actor.user_id, requisition_id)
        if not row:
            token = secrets.token_urlsafe(12)
            row = await conn.fetchrow(
                """INSERT INTO recruiter_job_links (tenant_id, recruiter_id, requisition_id, token)
                   VALUES ($1,$2,$3,$4)
                   ON CONFLICT (tenant_id, recruiter_id, requisition_id) DO NOTHING
                   RETURNING *""",
                actor.tenant_id, actor.user_id, requisition_id, token)
            if not row:
                row = await conn.fetchrow(
                    "SELECT * FROM recruiter_job_links WHERE tenant_id=$1 AND recruiter_id=$2 AND requisition_id=$3",
                    actor.tenant_id, actor.user_id, requisition_id)
    return {**dict(row), "requisition_title": req["title"], "share_url": f"{APP_URL}/apply/{row['token']}"}


@public_job_router.get("/{token}")
async def get_job_link_info(token: str):
    async with db.system_conn() as conn:
        row = await conn.fetchrow("SELECT * FROM get_job_link_by_token($1)", token)
    if not row or row["req_is_active"] is False or row["req_status"] != "open":
        raise HTTPException(status_code=404, detail="This link is invalid, expired, or the role is no longer open")
    return {
        "recruiter_name": row["recruiter_name"],
        "tenant_name": row["tenant_name"],
        "requisition_title": row["requisition_title"],
    }


@public_job_router.post("/{token}/apply")
async def submit_job_resume(
    token: str,
    full_name: str = Form(''),
    email: str = Form(''),
    phone: Optional[str] = Form(None),
    location: Optional[str] = Form(None),
    current_employer: Optional[str] = Form(None),
    experience_months: int = Form(0),
    consent_given: bool = Form(False),
    resume: Optional[UploadFile] = File(None),
    # 2026-08-30 — same real fields as submit_resume() above
    role_position: Optional[str] = Form(None),
    current_ctc: Optional[float] = Form(None),
    expected_ctc: Optional[float] = Form(None),
    notice_period_days: Optional[int] = Form(None),
    preferred_location: Optional[str] = Form(None),
    linkedin_url: Optional[str] = Form(None),
    expert_skills: Optional[str] = Form(None),
    intermediate_skills: Optional[str] = Form(None),
    skill_experience: Optional[str] = Form(None),
):
    """No-auth public resume submission, scoped to one job — same intake
    shape as submit_resume() above, plus a real application on the target
    requisition (tenant's configured default add-stage) and ownership
    attribution tagged 'job_share_link', matching the existing per-job
    referral_links convention (2026-08-25)."""
    async with db.system_conn() as conn:
        link = await conn.fetchrow("SELECT * FROM get_job_link_by_token($1)", token)
    if not link or link["req_is_active"] is False or link["req_status"] != "open":
        raise HTTPException(status_code=404, detail="This link is invalid, expired, or the role is no longer open")
    if not consent_given:
        raise HTTPException(status_code=400, detail="Consent to store and process your details is required to submit")
    if not full_name or not email:
        raise HTTPException(status_code=400, detail="Name and email are required")

    tenant_id = str(link["tenant_id"])
    recruiter_id = str(link["recruiter_id"])
    requisition_id = str(link["requisition_id"])

    parsed: dict = {}
    resume_bytes: Optional[bytes] = None
    resume_filename: Optional[str] = None
    resume_mime: Optional[str] = None
    if resume is not None and resume.filename:
        try:
            resume_bytes = await resume.read()
            resume_filename = resume.filename
            resume_mime = resume.content_type or ''
            from services.resume_intake_service import extract_text_from_attachment, save_resume_file
            from services.document_classifier import classify_document
            from services.improved_parser import parse_resume_v2
            text = extract_text_from_attachment(resume_bytes, resume_mime, resume_filename)
            doc_result = classify_document(text, resume_filename, resume_mime)
            if doc_result.is_resume:
                parsed = parse_resume_v2(text, from_name=full_name, from_email=email, filename=resume_filename)
                parsed["_resume_text"] = text
        except Exception:
            parsed = {}

    from routers.pipeline_stages import resolve_default_add_stage

    async with db.tenant_conn(tenant_id) as conn:
        email = email.lower()
        cand = await conn.fetchrow(
            "SELECT id FROM candidates WHERE email=$1 AND tenant_id=$2::uuid", email, tenant_id)
        is_new_candidate = cand is None
        if not cand:
            skills = parsed.get("skills") or []
            resume_text = parsed.get("_resume_text")
            cand = await conn.fetchrow("""
                INSERT INTO candidates
                  (tenant_id, full_name, email, phone, location, current_employer, total_exp_mo, source,
                   skills, resume_text)
                VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, 'recruiter_job_link', $8, $9) RETURNING id
            """, tenant_id, full_name, email, phone, location, current_employer,
                 experience_months, skills, resume_text)
            await conn.execute(
                "INSERT INTO consent_records (tenant_id,candidate_id,data_category,channel,consent_given,consent_text) "
                "VALUES ($1::uuid,$2,'resume_processing','recruiter_job_link',TRUE,$3)",
                tenant_id, cand['id'],
                "Applicant checked the DPDP 2023 consent box on a recruiter's job-specific resume link.",
            )
        elif parsed.get("_resume_text"):
            await conn.execute("""
                UPDATE candidates SET
                  resume_text = CASE WHEN (resume_text IS NULL OR resume_text='') THEN $2 ELSE resume_text END,
                  skills = CASE WHEN skills = '{}' AND $3::text[] <> '{}' THEN $3 ELSE skills END
                WHERE id=$1""",
                cand['id'], parsed.get("_resume_text"), parsed.get("skills") or [])

        if resume_bytes:
            file_path = save_resume_file(resume_bytes, tenant_id, resume_filename)
            await conn.execute("""
                INSERT INTO resume_files
                  (tenant_id, candidate_id, job_board, job_board_label, source_email,
                   file_name, file_path, mime_type, file_size,
                   parse_status, parsed_data, parse_confidence, routing_decision)
                VALUES ($1,$2,'job_share_link','Job-Specific Resume Link',$3,$4,$5,$6,$7,$8,$9,$10,$11)""",
                tenant_id, cand['id'], email, resume_filename, file_path, resume_mime, len(resume_bytes),
                'auto_accepted' if parsed else 'not_a_resume',
                _json.dumps(parsed) if parsed else '{}',
                round(float(parsed.get("_confidence", 0.7) or 0.7), 3) if parsed else 0.0,
                'auto_accepted' if parsed else 'rejected')

        await _apply_extra_public_fields(
            conn, tenant_id, str(cand['id']), is_new_candidate,
            role_position=role_position, current_ctc=current_ctc, expected_ctc=expected_ctc,
            notice_period_days=notice_period_days, preferred_location=preferred_location,
            linkedin_url=linkedin_url, expert_skills_csv=expert_skills,
            intermediate_skills_csv=intermediate_skills, skill_experience_json=skill_experience,
        )

        if is_new_candidate:
            recruiter_email = await conn.fetchval("SELECT email FROM users WHERE id=$1", recruiter_id)
            if recruiter_email:
                from services.candidate_ownership import claim_ownership
                await claim_ownership(conn, tenant_id, cand['id'], recruiter_id, recruiter_email, 'job_share_link')

        # Real application on the target requisition — the piece that
        # distinguishes this from the job-less personal link. Skip
        # silently (never error the public submission) if the candidate
        # is already genuinely in this requisition's pipeline.
        existing_app = await conn.fetchval(
            "SELECT id FROM applications WHERE tenant_id=$1 AND candidate_id=$2 AND requisition_id=$3 "
            "AND is_active IS NOT FALSE",
            tenant_id, cand['id'], requisition_id)
        if not existing_app:
            default_stage = await resolve_default_add_stage(conn, tenant_id)
            await conn.execute(
                "INSERT INTO applications (tenant_id, candidate_id, requisition_id, stage, assigned_recruiter_id) "
                "VALUES ($1,$2,$3,$4,$5)",
                tenant_id, cand['id'], requisition_id, default_stage, recruiter_id)

        await conn.execute(
            "UPDATE recruiter_job_links SET submission_count = submission_count + 1 WHERE tenant_id=$1 AND token=$2",
            tenant_id, token)

    return {"applied": True}
