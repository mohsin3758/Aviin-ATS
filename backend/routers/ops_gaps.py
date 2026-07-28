"""Round 2 of the DB-vs-sidebar audit: real APIs for tables that had
seed/live data (or a fully-built SQL contract, in the alerts case) but
no backend router at all — operational alerts, scoring/SLA config,
submittals, recruiter work sessions, recruiter-client blocks, saved
filters, the candidate self-service upload portal, and the external
agency/vendor submission portal.
"""
import os
import secrets
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from pathlib import Path

import db
from deps import Actor, get_actor, require_role

alerts_router = APIRouter(prefix="/alerts", tags=["alerts"])
config_router = APIRouter(prefix="/ops-config", tags=["ops-config"])
submittals_router = APIRouter(prefix="/submittals", tags=["submittals"])
worksessions_router = APIRouter(prefix="/work-sessions", tags=["work-sessions"])
blocks_router = APIRouter(prefix="/recruiter-client-blocks", tags=["recruiter-client-blocks"])
filters_router = APIRouter(prefix="/saved-filters", tags=["saved-filters"])
candidate_uploads_router = APIRouter(prefix="/candidate-status", tags=["status"])
agency_router = APIRouter(prefix="/agency", tags=["agency"])
agency_public_router = APIRouter(prefix="/agency-public", tags=["agency-public"])

UPLOAD_DIR = Path("/app/uploads/candidate-portal")


# ═══════════════════════════════════════════════════ Operational Alerts ═══
@alerts_router.get("")
async def list_alerts(stalled_hours: int = 48, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        stalled = await conn.fetch("SELECT * FROM find_stalled_assignments($1)", stalled_hours)
        breaches = await conn.fetch("SELECT * FROM find_sla_breaches()")
        acked = await conn.fetch(
            "SELECT alert_id FROM alert_acknowledgments WHERE tenant_id=$1", actor.tenant_id,
        )
    acked_ids = {r["alert_id"] for r in acked}
    alerts = []
    for r in stalled:
        aid = f"stale_{r['assignment_id']}"
        alerts.append({
            "alert_id": aid, "type": "stalled_assignment", "severity": "warning",
            "title": f"{r['requisition_title']} — no update in {round(r['hours_since_update'])}h",
            "detail": f"Assigned to {r['recruiter_name']}",
            "acknowledged": aid in acked_ids,
        })
    for r in breaches:
        aid = f"sla_{r['requisition_id']}"
        alerts.append({
            "alert_id": aid, "type": "sla_breach", "severity": "critical",
            "title": f"{r['title']} — SLA breached ({round(r['hours_open'])}h open, limit {r['sla_hours']}h)",
            "detail": f"{r['placements_count']}/{r['positions_count']} positions filled",
            "acknowledged": aid in acked_ids,
        })
    return {"alerts": alerts, "unacknowledged": sum(1 for a in alerts if not a["acknowledged"])}


class AckIn(BaseModel):
    alert_id: str
    note: Optional[str] = None


@alerts_router.post("/acknowledge")
async def acknowledge_alert(body: AckIn, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """INSERT INTO alert_acknowledgments (tenant_id, alert_id, acknowledged_by, note)
               VALUES ($1,$2,$3,$4)
               ON CONFLICT DO NOTHING RETURNING *""",
            actor.tenant_id, body.alert_id, actor.user_id, body.note or "",
        )
    return dict(row) if row else {"already_acknowledged": True}


# ═══════════════════════════════════════════════════ Scoring / SLA config ═══
class ScoringWeightsIn(BaseModel):
    capacity: float
    skill_match: float
    relationship: float
    performance: float
    leave_status: float
    location_match: float
    seniority_match: float
    language_match: float
    tenure_stability: float
    urgency_bonus: float


@config_router.get("/scoring-weights")
async def get_scoring_weights(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("SELECT * FROM scoring_weight_config WHERE tenant_id=$1", actor.tenant_id)
        if not row:
            row = await conn.fetchrow(
                "INSERT INTO scoring_weight_config (tenant_id) VALUES ($1) RETURNING *", actor.tenant_id,
            )
    return dict(row)


@config_router.put("/scoring-weights")
async def update_scoring_weights(body: ScoringWeightsIn, actor: Actor = Depends(require_role("admin", "super_admin", "manager"))):
    total = sum(body.dict().values())
    if not (0.98 <= total <= 1.02):
        raise HTTPException(400, f"Weights should sum to ~1.0 (currently {total:.2f})")
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """INSERT INTO scoring_weight_config
                 (tenant_id, capacity, skill_match, relationship, performance, leave_status,
                  location_match, seniority_match, language_match, tenure_stability, urgency_bonus, updated_by, updated_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
               ON CONFLICT (tenant_id) DO UPDATE SET
                 capacity=$2, skill_match=$3, relationship=$4, performance=$5, leave_status=$6,
                 location_match=$7, seniority_match=$8, language_match=$9, tenure_stability=$10,
                 urgency_bonus=$11, updated_by=$12, updated_at=now()
               RETURNING *""",
            actor.tenant_id, body.capacity, body.skill_match, body.relationship, body.performance,
            body.leave_status, body.location_match, body.seniority_match, body.language_match,
            body.tenure_stability, body.urgency_bonus, actor.user_id,
        )
    return dict(row)


class SlaTiersIn(BaseModel):
    low_hours: int
    medium_hours: int
    high_hours: int
    critical_hours: int


@config_router.get("/sla-tiers")
async def get_sla_tiers(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("SELECT * FROM sla_tier_config WHERE tenant_id=$1", actor.tenant_id)
        if not row:
            row = await conn.fetchrow(
                "INSERT INTO sla_tier_config (tenant_id) VALUES ($1) RETURNING *", actor.tenant_id,
            )
    return dict(row)


@config_router.put("/sla-tiers")
async def update_sla_tiers(body: SlaTiersIn, actor: Actor = Depends(require_role("admin", "super_admin", "manager"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """INSERT INTO sla_tier_config (tenant_id, low_hours, medium_hours, high_hours, critical_hours, updated_by, updated_at)
               VALUES ($1,$2,$3,$4,$5,$6,now())
               ON CONFLICT (tenant_id) DO UPDATE SET
                 low_hours=$2, medium_hours=$3, high_hours=$4, critical_hours=$5, updated_by=$6, updated_at=now()
               RETURNING *""",
            actor.tenant_id, body.low_hours, body.medium_hours, body.high_hours, body.critical_hours, actor.user_id,
        )
    return dict(row)


# ═══════════════════════════════════════════════════════════ Submittals ═══
class SubmittalIn(BaseModel):
    application_id: str
    submitted_rate: Optional[float] = None
    rate_type: str = "annual"


@submittals_router.get("")
async def list_submittals(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            """SELECT s.*, c.full_name AS candidate_name, r.title AS requisition_title
               FROM submittals s
               JOIN applications a ON a.id = s.application_id
               JOIN candidates c ON c.id = a.candidate_id
               JOIN requisitions r ON r.id = a.requisition_id
               WHERE s.tenant_id=$1 ORDER BY s.submitted_at DESC""",
            actor.tenant_id,
        )
    return [dict(r) for r in rows]


@submittals_router.post("")
async def create_submittal(body: SubmittalIn, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        app = await conn.fetchrow("SELECT id FROM applications WHERE id=$1 AND tenant_id=$2",
                                   body.application_id, actor.tenant_id)
        if not app:
            raise HTTPException(404, "Application not found")
        row = await conn.fetchrow(
            """INSERT INTO submittals (tenant_id, application_id, submitted_rate, rate_type)
               VALUES ($1,$2,$3,$4) RETURNING *""",
            actor.tenant_id, body.application_id, body.submitted_rate, body.rate_type,
        )
    return dict(row)


class SubmittalUpdateIn(BaseModel):
    status: Optional[str] = None
    client_feedback: Optional[str] = None


@submittals_router.patch("/{submittal_id}")
async def update_submittal(submittal_id: str, body: SubmittalUpdateIn, actor: Actor = Depends(get_actor)):
    valid_status = {"submitted", "client_review", "shortlisted", "rejected", "withdrawn"}
    if body.status and body.status not in valid_status:
        raise HTTPException(400, f"status must be one of {valid_status}")
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """UPDATE submittals SET
                 status = COALESCE($1, status),
                 client_feedback = COALESCE($2, client_feedback)
               WHERE id=$3 AND tenant_id=$4 RETURNING *""",
            body.status, body.client_feedback, submittal_id, actor.tenant_id,
        )
        if not row:
            raise HTTPException(404, "Submittal not found")
    return dict(row)


# ═══════════════════════════════════════════════════════ Work Sessions ═══
@worksessions_router.get("")
async def list_my_sessions(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            "SELECT * FROM work_sessions WHERE tenant_id=$1 AND user_id=$2 ORDER BY clock_in DESC LIMIT 30",
            actor.tenant_id, actor.user_id,
        )
        open_session = await conn.fetchrow(
            "SELECT * FROM work_sessions WHERE tenant_id=$1 AND user_id=$2 AND clock_out IS NULL",
            actor.tenant_id, actor.user_id,
        )
    return {"sessions": [dict(r) for r in rows], "open_session": dict(open_session) if open_session else None}


@worksessions_router.post("/clock-in")
async def clock_in(note_in: Optional[str] = None, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        existing = await conn.fetchrow(
            "SELECT id FROM work_sessions WHERE tenant_id=$1 AND user_id=$2 AND clock_out IS NULL",
            actor.tenant_id, actor.user_id,
        )
        if existing:
            raise HTTPException(409, "Already clocked in")
        row = await conn.fetchrow(
            "INSERT INTO work_sessions (tenant_id, user_id, note_in) VALUES ($1,$2,$3) RETURNING *",
            actor.tenant_id, actor.user_id, note_in,
        )
    return dict(row)


@worksessions_router.post("/clock-out")
async def clock_out(note_out: Optional[str] = None, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """UPDATE work_sessions SET clock_out=now(), note_out=$1,
                 duration_mins = ROUND(EXTRACT(EPOCH FROM (now() - clock_in)) / 60, 2)
               WHERE tenant_id=$2 AND user_id=$3 AND clock_out IS NULL
               RETURNING *""",
            note_out, actor.tenant_id, actor.user_id,
        )
        if not row:
            raise HTTPException(409, "Not currently clocked in")
    return dict(row)


# ═══════════════════════════════════════════════ Recruiter-Client Blocks ═══
class BlockIn(BaseModel):
    recruiter_id: str
    client_id: Optional[str] = None
    reason: Optional[str] = None


@blocks_router.get("")
async def list_blocks(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            """SELECT b.*, u.full_name AS recruiter_name, c.name AS client_name
               FROM recruiter_client_blocks b
               JOIN users u ON u.id = b.recruiter_id
               LEFT JOIN clients c ON c.id = b.client_id
               WHERE b.tenant_id=$1 ORDER BY b.created_at DESC""",
            actor.tenant_id,
        )
    return [dict(r) for r in rows]


@blocks_router.post("")
async def create_block(body: BlockIn, actor: Actor = Depends(require_role("admin", "super_admin", "manager"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """INSERT INTO recruiter_client_blocks (tenant_id, recruiter_id, client_id, reason, blocked_by)
               VALUES ($1,$2,$3,$4,$5) RETURNING *""",
            actor.tenant_id, body.recruiter_id, body.client_id, body.reason, actor.user_id,
        )
    return dict(row)


@blocks_router.delete("/{block_id}")
async def delete_block(block_id: str, actor: Actor = Depends(require_role("admin", "super_admin", "manager"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        result = await conn.execute("DELETE FROM recruiter_client_blocks WHERE id=$1 AND tenant_id=$2",
                                     block_id, actor.tenant_id)
        if result == "DELETE 0":
            raise HTTPException(404, "Not found")
    return {"deleted": True}


# ═══════════════════════════════════════════════════════ Saved Filters ═══
class SavedFilterIn(BaseModel):
    name: str
    filters: dict
    is_shared: bool = False


@filters_router.get("")
async def list_saved_filters(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            "SELECT * FROM saved_filters WHERE tenant_id=$1 AND (user_id=$2 OR is_shared) ORDER BY created_at DESC",
            actor.tenant_id, actor.user_id,
        )
    return [dict(r) for r in rows]


@filters_router.post("")
async def create_saved_filter(body: SavedFilterIn, actor: Actor = Depends(get_actor)):
    import json as _json
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """INSERT INTO saved_filters (tenant_id, user_id, name, filters, is_shared)
               VALUES ($1,$2,$3,$4,$5) RETURNING *""",
            actor.tenant_id, actor.user_id, body.name, _json.dumps(body.filters), body.is_shared,
        )
    return dict(row)


@filters_router.delete("/{filter_id}")
async def delete_saved_filter(filter_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        result = await conn.execute(
            "DELETE FROM saved_filters WHERE id=$1 AND tenant_id=$2 AND user_id=$3",
            filter_id, actor.tenant_id, actor.user_id,
        )
        if result == "DELETE 0":
            raise HTTPException(404, "Not found")
    return {"deleted": True}


# ═══════════════════════════════════════ Candidate self-service uploads ═══
@candidate_uploads_router.post("/public/upload")
async def candidate_public_upload(token: str, doc_type: str = "general", file: UploadFile = File(...)):
    allowed = {".pdf", ".doc", ".docx", ".jpg", ".jpeg", ".png"}
    ext = "." + (file.filename or "file").rsplit(".", 1)[-1].lower()
    if ext not in allowed:
        raise HTTPException(400, f"Unsupported format: {ext}")
    data = await file.read()
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    fname = f"{secrets.token_hex(8)}{ext}"
    (UPLOAD_DIR / fname).write_bytes(data)
    async with db.system_conn() as conn:
        try:
            row = await conn.fetchrow(
                "SELECT * FROM upload_candidate_document_by_token($1,$2,$3,$4)",
                token, file.filename, f"/uploads/candidate-portal/{fname}", doc_type,
            )
        except Exception as exc:
            raise HTTPException(409, str(exc))
    return {"uploaded": True, "id": str(row["id"])}


@candidate_uploads_router.get("/public/uploads")
async def candidate_public_uploads_list(token: str):
    async with db.system_conn() as conn:
        rows = await conn.fetch("SELECT * FROM list_candidate_uploads_by_token($1)", token)
    return [dict(r) for r in rows]


# ═══════════════════════════════════════ Agency / Vendor Submission Portal ═══
class AgencyUserIn(BaseModel):
    agency_id: str
    email: str
    full_name: str


@agency_router.get("/users")
async def list_agency_users(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            """SELECT au.*, va.name AS agency_name FROM agency_users au
               JOIN vendor_agencies va ON va.id = au.agency_id
               WHERE au.tenant_id=$1 ORDER BY au.created_at DESC""",
            actor.tenant_id,
        )
    return [dict(r) for r in rows]


@agency_router.post("/users")
async def create_agency_user(body: AgencyUserIn, actor: Actor = Depends(require_role("admin", "super_admin", "manager"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """INSERT INTO agency_users (tenant_id, agency_id, email, full_name)
               VALUES ($1,$2,$3,$4) RETURNING *""",
            actor.tenant_id, body.agency_id, body.email, body.full_name,
        )
    base = os.environ.get("NEXT_PUBLIC_APP_URL", "https://ats.aviinjobs.com")
    return {**dict(row), "portal_url": f"{base}/agency-submit/{row['token']}"}


@agency_router.get("/submissions")
async def list_agency_submissions(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            """SELECT s.*, va.name AS agency_name, r.title AS requisition_title
               FROM agency_submissions s
               JOIN vendor_agencies va ON va.id = s.agency_id
               JOIN requisitions r ON r.id = s.requisition_id
               WHERE s.tenant_id=$1 ORDER BY s.created_at DESC""",
            actor.tenant_id,
        )
    return [dict(r) for r in rows]


class SubmissionConvertIn(BaseModel):
    pass


@agency_router.post("/submissions/{submission_id}/convert")
async def convert_agency_submission(submission_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        sub = await conn.fetchrow("SELECT * FROM agency_submissions WHERE id=$1 AND tenant_id=$2",
                                   submission_id, actor.tenant_id)
        if not sub:
            raise HTTPException(404, "Submission not found")
        cand = await conn.fetchrow(
            """INSERT INTO candidates (tenant_id, full_name, email, phone, total_exp_mo,
                 current_employer, current_designation, source)
               VALUES ($1,$2,$3,$4,$5,$6,$7,'agency') RETURNING id""",
            actor.tenant_id, sub["full_name"], sub["email"], sub["phone"], sub["total_exp_mo"],
            sub["current_employer"], sub["current_designation"],
        )
        await conn.execute(
            """INSERT INTO applications (tenant_id, candidate_id, requisition_id, stage)
               VALUES ($1,$2,$3,'sourced') ON CONFLICT DO NOTHING""",
            actor.tenant_id, cand["id"], sub["requisition_id"],
        )
        await conn.execute("UPDATE agency_submissions SET status='shortlisted' WHERE id=$1", submission_id)
    return {"candidate_id": str(cand["id"])}


@agency_public_router.get("/public")
async def agency_public_info(token: str):
    async with db.system_conn() as conn:
        user = await conn.fetchrow("SELECT * FROM get_agency_user_by_token($1)", token)
        if not user:
            raise HTTPException(404, "Invalid or expired link")
        reqs = await conn.fetch("SELECT * FROM list_open_requisitions_for_agency($1)", token)
    return {"agency_user": dict(user), "open_requisitions": [dict(r) for r in reqs]}


class AgencySubmitIn(BaseModel):
    token: str
    requisition_id: str
    full_name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    total_exp_mo: int = 0
    current_employer: Optional[str] = None
    current_designation: Optional[str] = None
    expected_ctc: Optional[float] = None
    notes: Optional[str] = None


@agency_public_router.post("/public/submit")
async def agency_public_submit(body: AgencySubmitIn):
    async with db.system_conn() as conn:
        try:
            row = await conn.fetchrow(
                "SELECT * FROM submit_agency_candidate($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
                body.token, body.requisition_id, body.full_name, body.email, body.phone,
                body.total_exp_mo, body.current_employer, body.current_designation,
                body.expected_ctc, body.notes,
            )
        except Exception as exc:
            raise HTTPException(409, str(exc))
    return {"submitted": True, "id": str(row["id"])}
