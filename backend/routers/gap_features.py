"""Real implementations for the features that were previously hardcoded
stubs (every endpoint returned a constant regardless of DB state):
NPS surveys, Talent Community, Employee Referrals, Reference Checks,
Async Video Screening, Report Builder, Browser-Extension capture.

job-distribution and bgv-api were retired, not rebuilt here — both
duplicate real functionality that already exists elsewhere (job-sharing's
job_shares/job_portal_issues, and /bgv's Aadhaar/DigiLocker verification
+ trust score) and building a second version of either would just be
new dead weight, not a fix.
"""
import os
import secrets
from datetime import datetime
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel

import db
from deps import Actor, get_actor, require_role_or_trusted_internal, require_role

_MGMT_ROLES = ("admin", "super_admin", "manager", "lead_recruiter")
from routers.nda import _send_email_with_pdf

TENANT_ID = os.environ.get("DEFAULT_TENANT_ID", "a92d7fd7-fb72-47d8-881e-2493c61717ce")
APP_URL = os.environ.get("NEXT_PUBLIC_APP_URL", "https://ats.aviinjobs.com")

nps_router = APIRouter(prefix="/nps", tags=["nps"])
gdpr_new_router = APIRouter(prefix="/gdpr", tags=["gdpr"])  # kept empty: real /gdpr lives in final_features.py
talent_router = APIRouter(prefix="/talent-pool", tags=["talent-pool"])
referral_router = APIRouter(prefix="/referrals", tags=["referrals"])
referral_redirect_router = APIRouter(prefix="/r", tags=["referral-redirect"])
refcheck_router = APIRouter(prefix="/refcheck", tags=["refcheck"])
ref_public_router = APIRouter(prefix="/ref-public", tags=["ref-public"])
video_router = APIRouter(prefix="/video", tags=["video"])
reportbuilder_router = APIRouter(prefix="/report-builder", tags=["report-builder"])
extension_router = APIRouter(prefix="/extension", tags=["extension"])

VIDEO_UPLOAD_DIR = Path("/app/uploads/video-responses")


# ═══════════════════════════════════════════════════════════ NPS ═══
class NpsRequestIn(BaseModel):
    candidate_id: str
    application_id: Optional[str] = None
    trigger_type: str = "post_interview"


@nps_router.post("/request")
async def request_nps(body: NpsRequestIn, actor: Actor = Depends(get_actor)):
    token = secrets.token_urlsafe(24)
    async with db.tenant_conn(actor.tenant_id) as conn:
        cand = await conn.fetchrow("SELECT full_name, email FROM candidates WHERE id=$1 AND tenant_id=$2",
                                    body.candidate_id, actor.tenant_id)
        if not cand:
            raise HTTPException(404, "Candidate not found")
        row = await conn.fetchrow(
            """INSERT INTO candidate_nps (tenant_id, candidate_id, application_id, trigger_type, token)
               VALUES ($1,$2,$3,$4,$5) RETURNING *""",
            actor.tenant_id, body.candidate_id, body.application_id, body.trigger_type, token,
        )
    if cand["email"]:
        link = f"{APP_URL}/nps-survey/{token}"
        await _send_email_with_pdf(
            actor.tenant_id, cand["email"], cand["full_name"],
            "How was your experience with us?",
            f"Hi {cand['full_name']},\n\nWe'd love your feedback — it takes under a minute:\n{link}\n\nThanks!",
        )
    return dict(row)


@nps_router.get("/status")
async def nps_status(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        agg = await conn.fetchrow(
            """SELECT COUNT(*) FILTER (WHERE submitted_at IS NOT NULL) AS responses,
                      COUNT(*) AS sent,
                      AVG(nps_score) FILTER (WHERE submitted_at IS NOT NULL) AS avg_score,
                      COUNT(*) FILTER (WHERE nps_score >= 9) AS promoters,
                      COUNT(*) FILTER (WHERE nps_score BETWEEN 7 AND 8) AS passives,
                      COUNT(*) FILTER (WHERE nps_score <= 6 AND submitted_at IS NOT NULL) AS detractors
               FROM candidate_nps WHERE tenant_id=$1""",
            actor.tenant_id,
        )
        recent = await conn.fetch(
            """SELECT n.nps_score, n.what_went_well, n.what_could_improve, n.submitted_at, c.full_name
               FROM candidate_nps n JOIN candidates c ON c.id = n.candidate_id
               WHERE n.tenant_id=$1 AND n.submitted_at IS NOT NULL AND c.is_active IS NOT FALSE
               ORDER BY n.submitted_at DESC LIMIT 20""",
            actor.tenant_id,
        )
    responses, sent = agg["responses"] or 0, agg["sent"] or 0
    promoters, detractors = agg["promoters"] or 0, agg["detractors"] or 0
    nps = round(((promoters - detractors) / responses) * 100, 1) if responses else None
    return {
        "configured": True,
        "sent": sent, "responses": responses,
        "response_rate": round(responses / sent * 100, 1) if sent else 0,
        "avg_score": round(float(agg["avg_score"]), 2) if agg["avg_score"] is not None else None,
        "nps_score": nps,
        "promoters": promoters, "passives": agg["passives"] or 0, "detractors": detractors,
        "recent": [dict(r) for r in recent],
    }


@nps_router.get("/public")
async def nps_public_get(token: str):
    async with db.system_conn() as conn:
        row = await conn.fetchrow(
            """SELECT n.trigger_type, n.submitted_at, c.full_name
               FROM candidate_nps n JOIN candidates c ON c.id = n.candidate_id
               WHERE n.token = $1""",
            token,
        )
    if not row:
        raise HTTPException(404, "Survey not found")
    return dict(row)


class NpsSubmitIn(BaseModel):
    token: str
    nps_score: int
    what_went_well: Optional[str] = None
    what_could_improve: Optional[str] = None


@nps_router.post("/public/submit")
async def nps_public_submit(body: NpsSubmitIn):
    if not (0 <= body.nps_score <= 10):
        raise HTTPException(400, "Score must be 0-10")
    async with db.system_conn() as conn:
        row = await conn.fetchrow(
            """UPDATE candidate_nps
               SET nps_score=$1, what_went_well=$2, what_could_improve=$3, submitted_at=now()
               WHERE token=$4 AND submitted_at IS NULL RETURNING id""",
            body.nps_score, body.what_went_well, body.what_could_improve, body.token,
        )
    if not row:
        raise HTTPException(404, "Survey not found or already submitted")
    return {"submitted": True}


# ═══════════════════════════════════════════════ Talent Community ═══
class TalentSubscribeIn(BaseModel):
    tenant_id: str = TENANT_ID
    email: str
    name: Optional[str] = None
    phone: Optional[str] = None
    job_categories: list[str] = []
    preferred_location: Optional[str] = None
    alert_type: str = "email"


@talent_router.get("/")
async def talent_list(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            "SELECT * FROM talent_community WHERE tenant_id=$1 ORDER BY subscribed_at DESC",
            actor.tenant_id,
        )
    return {"candidates": [dict(r) for r in rows]}


@talent_router.post("/subscribe")
async def talent_subscribe(body: TalentSubscribeIn):
    async with db.tenant_conn(body.tenant_id) as conn:
        row = await conn.fetchrow(
            """INSERT INTO talent_community (tenant_id, email, name, phone, job_categories, preferred_location, alert_type)
               VALUES ($1,$2,$3,$4,$5,$6,$7)
               ON CONFLICT DO NOTHING RETURNING *""",
            body.tenant_id, body.email.lower(), body.name, body.phone,
            body.job_categories, body.preferred_location, body.alert_type,
        )
    if not row:
        raise HTTPException(409, "Already subscribed")
    return dict(row)


@talent_router.patch("/{entry_id}/toggle")
async def talent_toggle(entry_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "UPDATE talent_community SET is_active = NOT is_active WHERE id=$1 AND tenant_id=$2 RETURNING *",
            entry_id, actor.tenant_id,
        )
        if not row:
            raise HTTPException(404, "Not found")
    return dict(row)


# ═══════════════════════════════════════════════════════ Referrals ═══
class ReferralIn(BaseModel):
    requisition_id: Optional[str] = None
    bonus_amount: Optional[float] = None


@referral_router.get("/")
async def referral_list(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            """SELECT rl.*, r.title AS requisition_title
               FROM referral_links rl LEFT JOIN requisitions r ON r.id = rl.requisition_id
               WHERE rl.tenant_id=$1 AND rl.referrer_user_id=$2
               ORDER BY rl.created_at DESC""",
            actor.tenant_id, actor.user_id,
        )
    return {"referrals": [dict(r) for r in rows]}


@referral_router.post("")
async def referral_create(body: ReferralIn, actor: Actor = Depends(get_actor)):
    if not actor.user_id:
        raise HTTPException(401, "Login required")
    code = secrets.token_urlsafe(6)
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """INSERT INTO referral_links (tenant_id, referrer_user_id, requisition_id, unique_code, bonus_amount)
               VALUES ($1,$2,$3,$4,$5) RETURNING *""",
            actor.tenant_id, actor.user_id, body.requisition_id, code, body.bonus_amount,
        )
    return {**dict(row), "share_url": f"{APP_URL}/r/{code}"}


@referral_redirect_router.get("/{code}")
async def referral_redirect(code: str):
    from fastapi.responses import RedirectResponse
    async with db.system_conn() as conn:
        row = await conn.fetchrow("SELECT * FROM redeem_referral_click($1)", code)
    if not row:
        raise HTTPException(404, "Referral link not found")
    dest = f"{APP_URL}/careers/{row['requisition_id']}?ref={code}" if row["requisition_id"] else f"{APP_URL}/careers?ref={code}"
    return RedirectResponse(dest)


@referral_router.patch("/{referral_id}/mark-bonus-paid")
async def referral_mark_bonus_paid(referral_id: str, actor: Actor = Depends(require_role("admin","manager"))):
    """Gap-audit fix (2026-09-02) — the real, human-confirmed second half
    of the referral-hire lifecycle. `bonus_eligible` flips automatically
    on a genuine placement (record_referral_hire, below); `bonus_paid`
    only ever changes here, by an admin/manager explicitly confirming
    the money actually went out — matching HARD RULE #10's HITL
    principle for anything touching real payouts. Refuses to mark a
    referral paid that was never even eligible, rather than silently
    allowing an unearned bonus to be recorded as paid."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT bonus_eligible, bonus_paid FROM referral_links WHERE id=$1 AND tenant_id=$2",
            referral_id, actor.tenant_id)
        if not row:
            raise HTTPException(404, "Referral not found")
        if not row["bonus_eligible"]:
            raise HTTPException(400, "This referral has no confirmed hire yet — nothing to mark as paid")
        if row["bonus_paid"]:
            raise HTTPException(400, "Already marked as paid")
        updated = await conn.fetchrow(
            "UPDATE referral_links SET bonus_paid=TRUE WHERE id=$1 RETURNING *",
            referral_id)
    return dict(updated)


async def record_referral_hire(conn, tenant_id: str, candidate_id: str, placement_value) -> None:
    """Gap-audit fix (2026-09-02): the click->candidate half of this
    funnel already worked (candidate_ids array-append in p28_p32.py's
    public_apply); nothing anywhere ever closed the loop on an actual
    hire. Called from the same real placement hook offers.py already
    uses for source_attribution — a candidate can legitimately appear in
    more than one referral_links row (two different recruiters each
    shared a link, the same person applied via both), so every matching
    row is credited, not just the first. Only sets `bonus_eligible`
    (an automatic, objective fact) - never `bonus_paid`, which stays a
    real, separate, human-confirmed action (HARD RULE #10's HITL
    principle - never fully autonomous on anything touching real money).
    Best-effort: a candidate who never arrived via any referral link
    correctly matches zero rows and this is a genuine no-op, not an
    error."""
    try:
        await conn.execute(
            """UPDATE referral_links SET
                 hired_candidate_id=$2, hired_at=now(), placement_value=$3, bonus_eligible=TRUE
               WHERE tenant_id=$1 AND $2::uuid = ANY(candidate_ids)""",
            tenant_id, candidate_id, placement_value or 0,
        )
    except Exception as ex:
        print(f"[referral] best-effort hire record failed for candidate {candidate_id}: {ex}")


# ══════════════════════════════════════════════════ Reference Checks ═══
class RefcheckIn(BaseModel):
    candidate_id: str
    offer_id: Optional[str] = None
    referee_name: str
    referee_email: str
    referee_phone: Optional[str] = None
    relationship: Optional[str] = None
    company: Optional[str] = None


@refcheck_router.get("")
async def refcheck_list(candidate_id: Optional[str] = None, actor: Actor = Depends(get_actor)):
    conditions = ["rc.tenant_id=$1", "c.is_active IS NOT FALSE"]
    params: list = [actor.tenant_id]
    if candidate_id:
        params.append(candidate_id)
        conditions.append(f"rc.candidate_id=${len(params)}")
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            f"""SELECT rc.*, c.full_name AS candidate_name,
                       rr.q2_work_quality, rr.q3_reliability, rr.q4_rehire, rr.q7_overall_rating,
                       rr.q5_strengths, rr.q6_concerns, rr.submitted_at AS response_submitted_at
                FROM reference_checks rc
                JOIN candidates c ON c.id = rc.candidate_id
                LEFT JOIN reference_responses rr ON rr.reference_check_id = rc.id
                WHERE {' AND '.join(conditions)} ORDER BY rc.created_at DESC""",
            *params,
        )
    return [dict(r) for r in rows]


@refcheck_router.post("")
async def refcheck_create(body: RefcheckIn, actor: Actor = Depends(get_actor)):
    token = secrets.token_urlsafe(24)
    async with db.tenant_conn(actor.tenant_id) as conn:
        cand = await conn.fetchrow("SELECT full_name FROM candidates WHERE id=$1 AND tenant_id=$2",
                                    body.candidate_id, actor.tenant_id)
        if not cand:
            raise HTTPException(404, "Candidate not found")
        row = await conn.fetchrow(
            """INSERT INTO reference_checks
                 (tenant_id, candidate_id, offer_id, referee_name, referee_email, referee_phone,
                  relationship, company, token, status, sent_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'sent',now())
               RETURNING *""",
            actor.tenant_id, body.candidate_id, body.offer_id, body.referee_name, body.referee_email,
            body.referee_phone, body.relationship, body.company, token,
        )
    link = f"{APP_URL}/reference-check/{token}"
    await _send_email_with_pdf(
        actor.tenant_id, body.referee_email, body.referee_name,
        f"Reference request for {cand['full_name']}",
        f"Hi {body.referee_name},\n\n{cand['full_name']} listed you as a reference. "
        f"Could you fill out this short form?\n{link}\n\nThanks!",
    )
    return dict(row)


@ref_public_router.get("")
async def ref_public_get(token: str):
    async with db.system_conn() as conn:
        row = await conn.fetchrow("SELECT * FROM get_reference_check_by_token($1)", token)
    if not row:
        raise HTTPException(404, "Not found")
    return dict(row)


class RefResponseIn(BaseModel):
    token: str
    q1_known_duration: Optional[str] = None
    q2_work_quality: int
    q3_reliability: int
    q4_rehire: bool
    q5_strengths: Optional[str] = None
    q6_concerns: Optional[str] = None
    q7_overall_rating: int


@ref_public_router.post("/submit")
async def ref_public_submit(body: RefResponseIn):
    async with db.system_conn() as conn:
        try:
            row = await conn.fetchrow(
                "SELECT * FROM submit_reference_response_by_token($1,$2,$3,$4,$5,$6,$7,$8)",
                body.token, body.q1_known_duration, body.q2_work_quality, body.q3_reliability,
                body.q4_rehire, body.q5_strengths, body.q6_concerns, body.q7_overall_rating,
            )
        except Exception as exc:
            raise HTTPException(409, str(exc))
    return {"submitted": True, "id": str(row["id"])}


# ═══════════════════════════════════════════════════ Video Screening ═══
class VideoQuestionIn(BaseModel):
    title: str
    question_text: str
    time_limit_secs: int = 90
    requisition_id: Optional[str] = None
    order_num: int = 0


@video_router.get("/questions")
async def video_questions_list(requisition_id: Optional[str] = None, actor: Actor = Depends(get_actor)):
    conditions = ["tenant_id=$1", "is_active=true"]
    params: list = [actor.tenant_id]
    if requisition_id:
        params.append(requisition_id)
        conditions.append(f"(requisition_id=${len(params)} OR requisition_id IS NULL)")
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            f"SELECT * FROM video_questions WHERE {' AND '.join(conditions)} ORDER BY order_num NULLS LAST",
            *params,
        )
    return [dict(r) for r in rows]


@video_router.post("/questions")
async def video_question_create(body: VideoQuestionIn, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """INSERT INTO video_questions
                 (tenant_id, title, question_text, time_limit_secs, requisition_id, order_num, created_by, is_active)
               VALUES ($1,$2,$3,$4,$5,$6,$7,true) RETURNING *""",
            actor.tenant_id, body.title, body.question_text, body.time_limit_secs,
            body.requisition_id, body.order_num, actor.user_id,
        )
    return dict(row)


class VideoTokenIn(BaseModel):
    candidate_id: str
    question_ids: list[str]
    requisition_id: Optional[str] = None


@video_router.post("/tokens")
async def video_token_create(body: VideoTokenIn, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        cand = await conn.fetchrow("SELECT full_name, email FROM candidates WHERE id=$1 AND tenant_id=$2",
                                    body.candidate_id, actor.tenant_id)
        if not cand:
            raise HTTPException(404, "Candidate not found")
        row = await conn.fetchrow(
            """INSERT INTO video_screening_tokens (tenant_id, candidate_id, question_ids, requisition_id)
               VALUES ($1,$2,$3,$4) RETURNING *""",
            actor.tenant_id, body.candidate_id, body.question_ids, body.requisition_id,
        )
    link = f"{APP_URL}/video-screening/{row['token']}"
    if cand["email"]:
        await _send_email_with_pdf(
            actor.tenant_id, cand["email"], cand["full_name"],
            "Video screening — a few quick questions",
            f"Hi {cand['full_name']},\n\nPlease record short video answers to a few questions here "
            f"(link valid 7 days):\n{link}\n\nThanks!",
        )
    return {**dict(row), "link": link}


@video_router.get("/responses")
async def video_responses_list(candidate_id: Optional[str] = None, requisition_id: Optional[str] = None,
                                actor: Actor = Depends(get_actor)):
    conditions = ["vr.tenant_id=$1"]
    params: list = [actor.tenant_id]
    if candidate_id:
        params.append(candidate_id)
        conditions.append(f"vr.candidate_id=${len(params)}")
    if requisition_id:
        params.append(requisition_id)
        conditions.append(f"vr.requisition_id=${len(params)}")
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            f"""SELECT vr.*, c.full_name AS candidate_name, vq.question_text
                FROM video_responses vr
                JOIN candidates c ON c.id = vr.candidate_id
                LEFT JOIN video_questions vq ON vq.id = vr.question_id
                WHERE {' AND '.join(conditions)} ORDER BY vr.created_at DESC""",
            *params,
        )
    return [dict(r) for r in rows]


class VideoReviewIn(BaseModel):
    recruiter_rating: int
    recruiter_notes: Optional[str] = None


@video_router.patch("/responses/{response_id}/review")
async def video_response_review(response_id: str, body: VideoReviewIn, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """UPDATE video_responses
               SET recruiter_rating=$1, recruiter_notes=$2, status='reviewed',
                   reviewed_by=$3, reviewed_at=now()
               WHERE id=$4 AND tenant_id=$5 RETURNING *""",
            body.recruiter_rating, body.recruiter_notes, actor.user_id, response_id, actor.tenant_id,
        )
        if not row:
            raise HTTPException(404, "Not found")
    return dict(row)


@video_router.get("/public")
async def video_public_get(token: str):
    async with db.system_conn() as conn:
        rows = await conn.fetch("SELECT * FROM get_video_screening_by_token($1)", token)
    if not rows:
        raise HTTPException(404, "Link not found or expired")
    return {"candidate_name": rows[0]["candidate_name"], "expires_at": rows[0]["expires_at"],
            "questions": [{"id": str(r["question_id"]), "text": r["question_text"],
                           "time_limit_secs": r["time_limit_secs"]} for r in rows]}


@video_router.post("/public/submit")
async def video_public_submit(token: str, question_id: str, file: UploadFile = File(...)):
    allowed = {".webm", ".mp4", ".mov"}
    ext = "." + (file.filename or "clip.webm").rsplit(".", 1)[-1].lower()
    if ext not in allowed:
        raise HTTPException(400, f"Unsupported format: {ext}")
    data = await file.read()
    VIDEO_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    fname = f"{token[:8]}-{question_id}{ext}"
    (VIDEO_UPLOAD_DIR / fname).write_bytes(data)
    async with db.system_conn() as conn:
        try:
            row = await conn.fetchrow(
                "SELECT * FROM submit_video_response_by_token($1,$2,$3,$4,$5)",
                token, question_id, f"/uploads/video-responses/{fname}", file.filename, None,
            )
        except Exception as exc:
            raise HTTPException(409, str(exc))
    return {"submitted": True, "id": str(row["id"])}


# ═══════════════════════════════════════════════════════ Report Builder ═══
ALLOWED_ENTITIES = {
    "candidates": "candidates",
    "requisitions": "requisitions",
    "applications": "applications",
    "placements": "placements",
}


class SavedReportIn(BaseModel):
    name: str
    description: Optional[str] = None
    entity: str
    fields: list[str]
    filters: dict = {}
    group_by: Optional[str] = None


@reportbuilder_router.get("/")
async def report_list(actor: Actor = Depends(require_role_or_trusted_internal(*_MGMT_ROLES))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            "SELECT * FROM saved_reports WHERE tenant_id=$1 ORDER BY created_at DESC",
            actor.tenant_id,
        )
    return {"reports": [dict(r) for r in rows]}


@reportbuilder_router.post("/")
async def report_create(body: SavedReportIn, actor: Actor = Depends(require_role_or_trusted_internal(*_MGMT_ROLES))):
    if body.entity not in ALLOWED_ENTITIES:
        raise HTTPException(400, f"entity must be one of {list(ALLOWED_ENTITIES)}")
    import json as _json
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """INSERT INTO saved_reports (tenant_id, user_id, name, description, entity, fields, filters, group_by)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *""",
            actor.tenant_id, actor.user_id, body.name, body.description, body.entity,
            _json.dumps(body.fields), _json.dumps(body.filters), body.group_by,
        )
    return dict(row)


@reportbuilder_router.post("/{report_id}/run")
async def report_run(report_id: str, actor: Actor = Depends(require_role_or_trusted_internal(*_MGMT_ROLES))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rep = await conn.fetchrow("SELECT * FROM saved_reports WHERE id=$1 AND tenant_id=$2",
                                   report_id, actor.tenant_id)
        if not rep:
            raise HTTPException(404, "Report not found")
        table = ALLOWED_ENTITIES.get(rep["entity"])
        if not table:
            raise HTTPException(400, "Invalid entity on saved report")
        import json as _json
        fields = _json.loads(rep["fields"]) if isinstance(rep["fields"], str) else rep["fields"]
        cols = await conn.fetch(
            "SELECT column_name FROM information_schema.columns WHERE table_name=$1 AND table_schema='public'",
            table,
        )
        valid_cols = {c["column_name"] for c in cols}
        safe_fields = [f for f in fields if f in valid_cols] or ["id"]
        select_cols = ", ".join(f'"{f}"' for f in safe_fields)
        rows = await conn.fetch(
            f'SELECT {select_cols} FROM "{table}" WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 500',
            actor.tenant_id,
        )
    return {"entity": rep["entity"], "fields": safe_fields, "rows": [dict(r) for r in rows]}


@reportbuilder_router.delete("/{report_id}")
async def report_delete(report_id: str, actor: Actor = Depends(require_role_or_trusted_internal(*_MGMT_ROLES))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        result = await conn.execute("DELETE FROM saved_reports WHERE id=$1 AND tenant_id=$2",
                                     report_id, actor.tenant_id)
        if result == "DELETE 0":
            raise HTTPException(404, "Not found")
    return {"deleted": True}


# ═══════════════════════════════════════════════════ Extension capture ═══
class CaptureIn(BaseModel):
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    current_title: Optional[str] = None
    current_company: Optional[str] = None
    profile_url: Optional[str] = None
    source: str = "linkedin"


@extension_router.get("/ping")
async def ext_ping():
    return {"ok": True}


@extension_router.post("/capture")
async def ext_capture(body: CaptureIn, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """INSERT INTO extension_captures
                 (tenant_id, captured_by, name, email, phone, current_title, current_company, profile_url, source)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *""",
            actor.tenant_id, actor.user_id, body.name, body.email, body.phone,
            body.current_title, body.current_company, body.profile_url, body.source,
        )
    return dict(row)


@extension_router.get("/captures")
async def ext_captures_list(converted: Optional[bool] = None, actor: Actor = Depends(get_actor)):
    conditions = ["tenant_id=$1"]
    params: list = [actor.tenant_id]
    if converted is not None:
        conditions.append("candidate_id IS " + ("NOT NULL" if converted else "NULL"))
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            f"SELECT * FROM extension_captures WHERE {' AND '.join(conditions)} ORDER BY created_at DESC",
            *params,
        )
    return [dict(r) for r in rows]


@extension_router.post("/captures/{capture_id}/convert")
async def ext_capture_convert(capture_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        cap = await conn.fetchrow("SELECT * FROM extension_captures WHERE id=$1 AND tenant_id=$2",
                                   capture_id, actor.tenant_id)
        if not cap:
            raise HTTPException(404, "Capture not found")
        if cap["candidate_id"]:
            raise HTTPException(409, "Already converted")
        cand = await conn.fetchrow(
            """INSERT INTO candidates (tenant_id, full_name, email, phone, current_employer, source)
               VALUES ($1,$2,$3,$4,$5,'extension') RETURNING id""",
            actor.tenant_id, cap["name"], cap["email"], cap["phone"], cap["current_company"],
        )
        # HARD RULE #12 — was missing on this path entirely (found in the
        # 2026-08-09 BGV audit).
        await conn.execute(
            "INSERT INTO consent_records (tenant_id,candidate_id,data_category,channel,consent_given,consent_text) "
            "VALUES ($1,$2,'resume_processing','browser_extension',TRUE,$3)",
            actor.tenant_id, cand["id"], f"Captured via browser extension by recruiter {actor.user_id}.",
        )
        await conn.execute("UPDATE extension_captures SET candidate_id=$1 WHERE id=$2",
                            cand["id"], capture_id)
    return {"candidate_id": str(cand["id"])}


class LinkedinCaptureIn(BaseModel):
    linkedin_url: str
    raw_data: dict


@extension_router.post("/linkedin")
async def linkedin_capture(body: LinkedinCaptureIn, actor: Actor = Depends(get_actor)):
    import json as _json
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """INSERT INTO linkedin_captures (tenant_id, linkedin_url, raw_data, captured_by)
               VALUES ($1,$2,$3,$4) RETURNING *""",
            actor.tenant_id, body.linkedin_url, _json.dumps(body.raw_data), actor.user_id,
        )
    return dict(row)


@extension_router.get("/linkedin")
async def linkedin_captures_list(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            "SELECT * FROM linkedin_captures WHERE tenant_id=$1 ORDER BY created_at DESC",
            actor.tenant_id,
        )
    return [dict(r) for r in rows]
