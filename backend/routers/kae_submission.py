"""Recruiter -> KAE candidate submission.

Confirmed missing entirely before this router existed: grepped the whole
repo for tracking_sheet / submission_template, zero hits anywhere. Adjacent
pieces existed (client_portal's redacted public link, KAE ownership in
client_owners, generic CSV exports, candidate-facing stage emails) but
nothing connected a recruiter to the client-owning KAE with a resume that
hides contact details plus an Excel tracking-sheet row, by real email,
logged in the ATS.

Two things this deliberately does NOT conflate:
  - The tracking sheet ALWAYS includes phone/email (it's the client's
    internal record — the example sheet the request was built from has
    both). Redaction only ever applies to the resume attachment.
  - "Flexible template with toggles" vs "fully separate template per
    client" are the same underlying mechanism here (a named, ordered
    column list, optionally pinned to a client) — no separate code path
    for the two modes, they're just different template rows.
"""
import io
import os
import re
import json
import datetime
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
from pathlib import Path
from typing import Optional
from xml.sax.saxutils import escape as _esc

import asyncpg
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

import db
import events
from deps import Actor, get_actor, require_role
from permissions import require_permission
from routers.pipeline_stages import is_valid_stage
from services.resume_formatting import render_resume_pdf, redact_contact, mask_name, _VALID_THEMES, _VALID_LOGO_POSITIONS
from services import template_merge

router = APIRouter(tags=["kae-submission"])

TEMPLATE_FILE_DIR = Path("/app/uploads/tracking_sheet_templates")
_TEMPLATE_FILE_EXTS = {
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pdf": "application/pdf",
}
_DIRECTIONS = ("recruiter_to_kae", "kae_to_client")

# Every column a tracking-sheet template can include. auto=True columns are
# pre-filled from live candidate/requisition/tenant data; the rest are
# per-submission free text the recruiter fills in — they aren't stored
# candidate fields (e.g. "relevant experience for THIS role" isn't the same
# thing as the candidate's overall total_exp_mo).
COLUMN_REGISTRY = [
    {"key": "sl_no",              "label": "SL No",                                                    "auto": True},
    {"key": "date",                "label": "Date",                                                      "auto": True},
    {"key": "partner",             "label": "Partner",                                                   "auto": True},
    {"key": "candidate_name",      "label": "Name",                                                      "auto": True},
    {"key": "role",                "label": "Role",                                                      "auto": True},
    {"key": "total_exp",           "label": "Total Exp",                                                 "auto": True},
    {"key": "relevant_exp",        "label": "Relevant Exp",                                              "auto": False},
    {"key": "skill_summary",       "label": "Skill Relevant Exp / Support / Implementation / Projects",  "auto": False},
    {"key": "notice_period",       "label": "Notice Period / LWD",                                       "auto": True},
    {"key": "mobile_number",       "label": "Mobile Number",                                             "auto": True},
    {"key": "alternate_number",    "label": "Alternate Number",                                          "auto": False},
    {"key": "email_id",            "label": "Email Id",                                                  "auto": True},
    {"key": "current_location",    "label": "Current Location",                                          "auto": True},
    {"key": "deployment_location", "label": "Deployment Location",                                       "auto": False},
    {"key": "current_company",     "label": "Current Company",                                           "auto": True},
    {"key": "ctc",                 "label": "CTC",                                                       "auto": True},
    {"key": "ectc_rate_card",      "label": "ECTC / Rate Card",                                          "auto": True},
    # Real gap-closing additions (2026-08-19): LinkedIn/Job Type/NDA/
    # Recruiter Name/AI JD Score all have a genuine data source already in
    # this schema (candidates.linkedin_url, requisitions.employment_type,
    # nda_documents.status, applications.assigned_recruiter_id,
    # candidate_scores.readiness_index) — just never wired into the sheet.
    # RTR and Truecaller Verification have NO existing source of truth
    # anywhere in this codebase (no e-sign flow, no verification service) —
    # kept honest as manual (auto=False) entries rather than fabricating a
    # fake automatic status.
    {"key": "linkedin_id",             "label": "LinkedIn Id",                                           "auto": True},
    {"key": "job_type",                "label": "Job Type (Full Time / Contract / C2H / Freelancer)",    "auto": True},
    {"key": "nda_status",              "label": "NDA Status",                                            "auto": True},
    {"key": "recruiter_name",          "label": "Recruiter Name",                                        "auto": True},
    {"key": "ai_jd_score",             "label": "AI JD Match Score",                                     "auto": True},
    {"key": "rtr_status",              "label": "RTR (Right To Represent)",                               "auto": False},
    {"key": "truecaller_verification", "label": "Truecaller Verification",                               "auto": False},
]

# The real, out-of-the-box default column set for a brand-new tenant's
# default template — includes every genuinely automatic column above so
# "fill the missing features with a clean table sheet with all candidate
# details" is true immediately, no manual template editing required.
_DEFAULT_TEMPLATE_COLUMNS = [
    {"key": c["key"], "label": c["label"]} for c in COLUMN_REGISTRY
]

_PRE_SUBMIT_STAGES = {"sourced", "contacted", "interested", "nda", "screened"}


def _fmt_exp(months) -> str:
    if not months:
        return ""
    y, m = divmod(int(months), 12)
    if y and m:
        return f"{y}y {m}m"
    if y:
        return f"{y}y"
    return f"{m}m"


def _fmt_ctc(v) -> str:
    if v is None:
        return ""
    try:
        return f"{float(v):,.2f} LPA"
    except (TypeError, ValueError):
        return str(v)


def _jsonb(v, default):
    if v is None:
        return default
    return json.loads(v) if isinstance(v, str) else v


def _template_out(row) -> dict:
    d = dict(row)
    d["columns"] = _jsonb(d.get("columns"), [])
    return d


async def _app_context(conn, application_id: str):
    row = await conn.fetchrow(
        """SELECT a.id AS application_id, a.requisition_id, a.candidate_id, a.stage,
                  a.assigned_recruiter_id,
                  c.full_name, c.phone, c.email, c.location, c.current_employer,
                  c.total_exp_mo, c.notice_period_days, c.current_ctc, c.expected_ctc,
                  c.current_designation, c.skills, c.resume_text, c.linkedin_url,
                  r.title AS role_title, r.client_id, r.employment_type,
                  t.name AS tenant_name,
                  ru.full_name AS recruiter_name,
                  nda.status AS nda_status,
                  cs.readiness_index AS ai_score, cs.readiness_grade AS ai_grade
           FROM applications a
           JOIN candidates c ON c.id = a.candidate_id
           JOIN requisitions r ON r.id = a.requisition_id
           JOIN tenants t ON t.id = a.tenant_id
           LEFT JOIN users ru ON ru.id = a.assigned_recruiter_id
           LEFT JOIN LATERAL (
               SELECT status FROM nda_documents
               WHERE application_id = a.id ORDER BY created_at DESC LIMIT 1
           ) nda ON true
           LEFT JOIN LATERAL (
               SELECT readiness_index, readiness_grade FROM candidate_scores
               WHERE candidate_id = a.candidate_id AND requisition_id = a.requisition_id
               ORDER BY id DESC LIMIT 1
           ) cs ON true
           WHERE a.id = $1""",
        application_id,
    )
    if row is None:
        raise HTTPException(404, "Application not found")

    notice = f"{row['notice_period_days']} days" if row["notice_period_days"] is not None else ""
    ai_score = f"{row['ai_score']:.0f}% ({row['ai_grade']})" if row["ai_score"] is not None and row["ai_grade"] else \
               (f"{row['ai_score']:.0f}%" if row["ai_score"] is not None else "")
    auto_values = {
        "date": datetime.date.today().strftime("%d-%m-%Y"),
        "partner": row["tenant_name"] or "",
        "candidate_name": row["full_name"] or "",
        "role": row["role_title"] or "",
        "total_exp": _fmt_exp(row["total_exp_mo"]),
        "notice_period": notice,
        "mobile_number": row["phone"] or "",
        "email_id": row["email"] or "",
        "current_location": row["location"] or "",
        "current_company": row["current_employer"] or "",
        "ctc": _fmt_ctc(row["current_ctc"]),
        "ectc_rate_card": _fmt_ctc(row["expected_ctc"]),
        "linkedin_id": row["linkedin_url"] or "",
        "job_type": (row["employment_type"] or "").replace("_", " ").title(),
        "nda_status": (row["nda_status"] or "not_started").replace("_", " ").title(),
        "recruiter_name": row["recruiter_name"] or "",
        "ai_jd_score": ai_score,
    }
    return row, auto_values


async def _resolve_kaes(conn, tenant_id: str, client_id: Optional[str]):
    """Real fix (2026-08-19): client_owners has no uniqueness constraint on
    (tenant_id, client_id, owner_type) — only on (tenant_id, client_id,
    user_id) — so a client can genuinely have more than one active
    owner_type='kae' row (e.g. a primary + a backup KAE). The old version
    of this only ever fetched the single most-recently-assigned one and
    silently ignored the rest. Returns ALL active KAEs for a client,
    most-recent first; callers that need "the" primary KAE use [0]."""
    if not client_id:
        return []
    # REAL BUG FIX (2026-08-24): no u.is_active filter -- a deactivated
    # (departed staff, or QA-test) KAE with a still-active client_owners
    # row would genuinely receive a real submission email. Functional
    # correctness, not just a display issue.
    return await conn.fetch(
        """SELECT u.id, u.full_name, u.email
           FROM client_owners co JOIN users u ON u.id = co.user_id
           WHERE co.tenant_id=$1 AND co.client_id=$2 AND co.owner_type='kae' AND co.is_active
             AND u.is_active IS NOT FALSE AND u.email IS NOT NULL AND u.email != ''
           ORDER BY co.assigned_at DESC""",
        tenant_id, client_id,
    )


async def _resolve_template(conn, tenant_id: str, client_id: Optional[str], direction: str = "recruiter_to_kae"):
    """Real fix (this feature): a client can now genuinely have more than
    one active template pinned to it (non-default alternates a KAE can
    pick from) — the old ORDER BY created_at LIMIT 1 silently picked
    whichever was oldest with no way to express "this one is the real
    default." Now prefers the one actually marked is_default among a
    client's own templates, falling back to the client's oldest only if
    none is marked (shouldn't happen post-migration, but never 400s over
    it). direction distinguishes the recruiter->KAE hop from the newer
    KAE->client hop — each has its own independent default."""
    row = None
    if client_id:
        row = await conn.fetchrow(
            """SELECT * FROM tracking_sheet_templates
               WHERE tenant_id=$1 AND client_id=$2 AND direction=$3 AND is_active
               ORDER BY is_default DESC, created_at LIMIT 1""",
            tenant_id, client_id, direction)
    if row is None:
        row = await conn.fetchrow(
            """SELECT * FROM tracking_sheet_templates
               WHERE tenant_id=$1 AND is_default AND client_id IS NULL AND direction=$2 AND is_active LIMIT 1""",
            tenant_id, direction)
    return row


async def _resolve_client_contacts(conn, tenant_id: str, client_id: Optional[str]):
    if not client_id:
        return []
    return await conn.fetch(
        """SELECT id, contact_name, email, role_label, is_primary
           FROM client_contacts WHERE tenant_id=$1 AND client_id=$2
           ORDER BY is_primary DESC, contact_name""",
        tenant_id, client_id,
    )


# ─────────────────────────── Templates CRUD ───────────────────────────

class TemplateIn(BaseModel):
    name: str
    client_id: Optional[str] = None
    columns: list[dict]
    is_default: bool = False
    direction: str = "recruiter_to_kae"


async def _unset_other_defaults(conn, tenant_id: str, client_id: Optional[str], direction: str, exclude_id: Optional[str] = None):
    """A default is scoped to (tenant, direction, client_id-or-global) —
    setting a new one only clears the OTHER template that shared that exact
    scope, never a different client's or a different direction's default
    (the real bug this feature's own audit found: the old single
    tenant-wide UNIQUE let two different clients silently fight over one
    "the" default)."""
    if client_id is None:
        q = "UPDATE tracking_sheet_templates SET is_default=false WHERE tenant_id=$1 AND direction=$2 AND client_id IS NULL"
        args = [tenant_id, direction]
    else:
        q = "UPDATE tracking_sheet_templates SET is_default=false WHERE tenant_id=$1 AND direction=$2 AND client_id=$3"
        args = [tenant_id, direction, client_id]
    if exclude_id:
        q += f" AND id != ${len(args) + 1}"
        args.append(exclude_id)
    await conn.execute(q, *args)


@router.get("/submission-templates/columns")
async def list_columns(actor: Actor = Depends(get_actor)):
    return COLUMN_REGISTRY


@router.get("/submission-templates")
async def list_templates(direction: Optional[str] = None, include_inactive: bool = False, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        where = ["tst.tenant_id=$1"]
        args = [actor.tenant_id]
        if direction:
            where.append(f"tst.direction=${len(args) + 1}")
            args.append(direction)
        if not include_inactive:
            where.append("tst.is_active")
        rows = await conn.fetch(
            f"""SELECT tst.*, cl.name AS client_name
                FROM tracking_sheet_templates tst LEFT JOIN clients cl ON cl.id = tst.client_id
                WHERE {' AND '.join(where)} ORDER BY tst.is_default DESC, tst.name""",
            *args)
    return [_template_out(r) for r in rows]


@router.post("/submission-templates")
async def create_template(body: TemplateIn, actor: Actor = Depends(get_actor)):
    if body.direction not in _DIRECTIONS:
        raise HTTPException(400, f"direction must be one of {_DIRECTIONS}")
    if not body.columns:
        raise HTTPException(400, "Template must include at least one column")
    async with db.tenant_conn(actor.tenant_id) as conn:
        if body.is_default:
            await _unset_other_defaults(conn, actor.tenant_id, body.client_id, body.direction)
        row = await conn.fetchrow(
            """INSERT INTO tracking_sheet_templates (tenant_id, client_id, name, columns, is_default, direction, created_by)
               VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *""",
            actor.tenant_id, body.client_id, body.name, json.dumps(body.columns), body.is_default, body.direction, actor.user_id)
    return _template_out(row)


@router.put("/submission-templates/{template_id}")
async def update_template(template_id: str, body: TemplateIn, actor: Actor = Depends(get_actor)):
    if body.direction not in _DIRECTIONS:
        raise HTTPException(400, f"direction must be one of {_DIRECTIONS}")
    if not body.columns:
        raise HTTPException(400, "Template must include at least one column")
    async with db.tenant_conn(actor.tenant_id) as conn:
        existing = await conn.fetchval(
            "SELECT id FROM tracking_sheet_templates WHERE id=$1 AND tenant_id=$2", template_id, actor.tenant_id)
        if not existing:
            raise HTTPException(404, "Template not found")
        if body.is_default:
            await _unset_other_defaults(conn, actor.tenant_id, body.client_id, body.direction, exclude_id=template_id)
        row = await conn.fetchrow(
            """UPDATE tracking_sheet_templates
               SET name=$1, client_id=$2, columns=$3, is_default=$4, direction=$5, updated_at=now()
               WHERE id=$6 RETURNING *""",
            body.name, body.client_id, json.dumps(body.columns), body.is_default, body.direction, template_id)
    return _template_out(row)


@router.delete("/submission-templates/{template_id}")
async def delete_template(template_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT is_default, file_path FROM tracking_sheet_templates WHERE id=$1 AND tenant_id=$2",
            template_id, actor.tenant_id)
        if not row:
            raise HTTPException(404, "Template not found")
        if row["is_default"]:
            raise HTTPException(400, "Cannot delete the default template — set another template as default first")
        await conn.execute("DELETE FROM tracking_sheet_templates WHERE id=$1", template_id)
    if row["file_path"]:
        try:
            (Path("/app") / row["file_path"].lstrip("/")).unlink(missing_ok=True)
        except Exception:
            pass
    return {"ok": True}


@router.patch("/submission-templates/{template_id}/toggle-active")
async def toggle_template_active(template_id: str, actor: Actor = Depends(get_actor)):
    """Softer alternative to Delete — a deactivated template drops out of
    _resolve_template()'s auto-selection and the picker lists, but stays
    editable/reactivatable and every past submission that used it keeps its
    own historical field_values snapshot untouched (candidate_submissions
    never depends on the template row still being active)."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT is_active, is_default FROM tracking_sheet_templates WHERE id=$1 AND tenant_id=$2",
            template_id, actor.tenant_id)
        if not row:
            raise HTTPException(404, "Template not found")
        if row["is_active"] and row["is_default"]:
            raise HTTPException(400, "Cannot deactivate the default template — set another template as default first")
        new_row = await conn.fetchrow(
            "UPDATE tracking_sheet_templates SET is_active = NOT is_active, updated_at=now() WHERE id=$1 RETURNING *",
            template_id)
    return _template_out(new_row)


@router.post("/submission-templates/{template_id}/duplicate")
async def duplicate_template(template_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        src = await conn.fetchrow(
            "SELECT * FROM tracking_sheet_templates WHERE id=$1 AND tenant_id=$2", template_id, actor.tenant_id)
        if not src:
            raise HTTPException(404, "Template not found")
        row = await conn.fetchrow(
            """INSERT INTO tracking_sheet_templates
                 (tenant_id, client_id, name, columns, is_default, direction, template_type,
                  file_path, file_name, file_mime_type, created_by)
               VALUES ($1,$2,$3,$4,false,$5,$6,$7,$8,$9,$10) RETURNING *""",
            actor.tenant_id, src["client_id"], f"{src['name']} (copy)", src["columns"],
            src["direction"], src["template_type"], src["file_path"], src["file_name"],
            src["file_mime_type"], actor.user_id,
        )
    return _template_out(row)


@router.post("/submission-templates/{template_id}/upload-file")
async def upload_template_file(template_id: str, file: UploadFile = File(...), actor: Actor = Depends(get_actor)):
    """Uploads a real .xlsx/.docx/.pdf as this template's document — from
    this point on, a send using this template merges real candidate data
    into the file's own {{token}} placeholders (see services/
    template_merge.py) instead of building the plain inline HTML table.
    .pdf is accepted but NOT merge-filled (a flattened PDF has no
    addressable field to write into) — it's sent as a static reference
    attachment alongside the always-generated live data table; this is a
    real, stated limitation, not silently pretended away."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        existing = await conn.fetchval(
            "SELECT id FROM tracking_sheet_templates WHERE id=$1 AND tenant_id=$2", template_id, actor.tenant_id)
        if not existing:
            raise HTTPException(404, "Template not found")

    ext = "." + (file.filename or "").rsplit(".", 1)[-1].lower()
    if ext not in _TEMPLATE_FILE_EXTS:
        raise HTTPException(400, "Unsupported file type — use .xlsx, .docx, or .pdf")
    file_bytes = await file.read()
    if len(file_bytes) > 10 * 1024 * 1024:
        raise HTTPException(400, "File too large (max 10MB)")

    folder = TEMPLATE_FILE_DIR / actor.tenant_id
    folder.mkdir(parents=True, exist_ok=True)
    rel_path = f"/uploads/tracking_sheet_templates/{actor.tenant_id}/{template_id}{ext}"
    (folder / f"{template_id}{ext}").write_bytes(file_bytes)

    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """UPDATE tracking_sheet_templates
               SET template_type='file', file_path=$1, file_name=$2, file_mime_type=$3, updated_at=now()
               WHERE id=$4 RETURNING *""",
            rel_path, file.filename or f"template{ext}", _TEMPLATE_FILE_EXTS[ext], template_id,
        )
    return _template_out(row)


@router.get("/submission-templates/{template_id}/download-file")
async def download_template_file(template_id: str, actor: Actor = Depends(get_actor)):
    from fastapi.responses import FileResponse
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT file_path, file_name, file_mime_type FROM tracking_sheet_templates WHERE id=$1 AND tenant_id=$2",
            template_id, actor.tenant_id)
    if not row or not row["file_path"]:
        raise HTTPException(404, "No file uploaded for this template")
    abs_path = Path("/app") / row["file_path"].lstrip("/")
    if not abs_path.exists():
        raise HTTPException(404, "File missing from disk")
    return FileResponse(abs_path, media_type=row["file_mime_type"], filename=row["file_name"])


# ─────────────────────────── Screening notification settings ───────────────────────────
# Real feature (2026-08-19): who gets the automatic "candidate shortlisted"
# email (To:) when a recruiter moves an application to "screened" — the
# internal screening team, not the KAE (who's cc'd instead, see
# _auto_notify_screening_team below). Same "auto-create a sensible default
# row on first read, PUT any time to change it" pattern already used by
# scoring_weight_config/sla_tier_config — the first save IS the default;
# nothing about it is a one-time-only lock, it can be changed again later
# exactly the same way.

class ScreeningSettingsIn(BaseModel):
    to_emails: list[str]
    is_enabled: bool = True


@router.get("/screening-settings")
async def get_screening_settings(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT * FROM screening_notification_settings WHERE tenant_id=$1", actor.tenant_id)
        if not row:
            row = await conn.fetchrow(
                "INSERT INTO screening_notification_settings (tenant_id) VALUES ($1) RETURNING *", actor.tenant_id)
    return dict(row)


@router.put("/screening-settings")
async def update_screening_settings(body: ScreeningSettingsIn, actor: Actor = Depends(require_role("admin", "super_admin", "manager"))):
    emails = [e.strip() for e in body.to_emails if e and e.strip()]
    if body.is_enabled and not emails:
        raise HTTPException(400, "At least one screening-team email is required to enable auto-notifications")
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """INSERT INTO screening_notification_settings (tenant_id, to_emails, is_enabled, updated_by, updated_at)
               VALUES ($1,$2,$3,$4,now())
               ON CONFLICT (tenant_id) DO UPDATE SET
                 to_emails=$2, is_enabled=$3, updated_by=$4, updated_at=now()
               RETURNING *""",
            actor.tenant_id, emails, body.is_enabled, actor.user_id,
        )
    return dict(row)


async def _auto_notify_screening_team(tenant_id: str, application_id: str, actor: Actor):
    """Fired (best-effort, background) when a recruiter moves an
    application to "screened" — real automation for the ask: recruiter
    shortlists a candidate, the system automatically builds the tracking
    sheet (with the real AI JD match score already in it) and emails it
    with the resume to the internal screening team, CC'ing every active
    KAE on the client. Never raises — a missing/disabled setting, a
    missing SMTP config, or any other failure here must never break the
    stage-change request itself, matching the existing
    _notify_stage_change_bg convention in applications.py."""
    try:
        async with db.tenant_conn(tenant_id) as conn:
            settings = await conn.fetchrow(
                "SELECT to_emails, is_enabled FROM screening_notification_settings WHERE tenant_id=$1", tenant_id)
        if not settings or not settings["is_enabled"] or not settings["to_emails"]:
            return  # Not configured for this tenant yet — silently skip, not an error.

        async with db.tenant_conn(tenant_id) as conn:
            row, _ = await _app_context(conn, application_id)
        candidate = {
            "full_name": row["full_name"], "phone": row["phone"], "email": row["email"],
            "location": row["location"], "current_employer": row["current_employer"],
            "current_designation": row["current_designation"], "total_exp_mo": row["total_exp_mo"],
            "skills": row["skills"], "resume_text": row["resume_text"],
        }
        # Sensible, safe default: the same "clean, contact-free" style/theme
        # every other unattended flow in this codebase defaults to — an
        # auto-fired email has no recruiter present to pick a style.
        resume_bytes = render_resume_pdf(candidate, _STYLE_CONFIGS["clean_generated"])
        safe_name = re.sub(r"[^A-Za-z0-9_-]+", "_", candidate["full_name"] or "candidate")

        await _do_kae_submission(
            tenant_id, application_id, actor, resume_bytes,
            f"Resume_{safe_name}_clean_generated.pdf", "clean_generated",
            _RESUME_LABELS["clean_generated"],
            override_to_emails=settings["to_emails"], trigger_source="auto_screened",
        )
    except Exception as exc:
        print(f"Auto screening-team notification error (application {application_id}): {exc}")


# ─────────────────────────── Redaction + document generation ───────────────────────────

def _redact_text(text: str, candidate) -> str:
    return redact_contact(text, candidate, True, True)


# REFACTOR (2026-08-12, Resume Generator build): the 5 near-identical PDF
# builders that used to live here (clean/redacted/projects_only/
# confidential/anonymized) are now just compositional configs against the
# same shared renderer the new standalone Resume Generator uses
# (services/resume_formatting.render_resume_pdf) — one document engine,
# not two, per the explicit "do not create multiple competing document
# engines" requirement. Output is materially the same for every style
# except one deliberate change: masked names now render as "Ranjan K"
# (no trailing period), matching the Resume Generator spec's exact
# examples ("Rahul Sharma -> Rahul S"), where the old _anonymize_name here
# used to add a period — a cosmetic difference, not a functional one.
_STYLE_CONFIGS = {
    "clean_generated":   {"name_format": "full", "show_mobile": False, "show_email": False, "show_location": True,
                           "company_mode": "original", "project_mode": "include"},
    "redacted_original":  {"name_format": "full", "show_mobile": False, "show_email": False, "show_location": True,
                            "company_mode": "original", "project_mode": "include"},
    "projects_only":       {"name_format": "full", "show_mobile": False, "show_email": False, "show_location": True,
                             "company_mode": "hide", "project_mode": "focus"},
    "confidential":        {"name_format": "full", "show_mobile": False, "show_email": False, "show_location": True,
                             "company_mode": "replace", "company_replacement": "Confidential", "project_mode": "include"},
    "anonymized":          {"name_format": "masked", "show_mobile": False, "show_email": False, "show_location": True,
                             "company_mode": "replace", "company_replacement": "AviinTech Business Solutions", "project_mode": "include"},
}


def _build_manual_resume_pdf(fields: dict) -> bytes:
    """Renders directly from recruiter-supplied/edited fields, no auto-
    extraction — this IS the "Manual editing" format: whatever the
    recruiter typed becomes the output verbatim (still escaped for PDF
    safety), not a re-parse of the original resume."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=2.2 * cm, rightMargin=2.2 * cm,
                             topMargin=2 * cm, bottomMargin=2 * cm)
    PRIMARY = colors.HexColor("#1e40af")
    DARK = colors.HexColor("#0f172a")
    h1 = ParagraphStyle("H1", fontSize=18, textColor=DARK, fontName="Helvetica-Bold", alignment=TA_CENTER, spaceAfter=2)
    sub = ParagraphStyle("Sub", fontSize=11, textColor=PRIMARY, fontName="Helvetica-Bold", alignment=TA_CENTER, spaceAfter=10)
    h2 = ParagraphStyle("H2", fontSize=11, textColor=PRIMARY, fontName="Helvetica-Bold", spaceBefore=12, spaceAfter=6)
    body = ParagraphStyle("Body", fontSize=10, textColor=DARK, leading=15, fontName="Helvetica")

    story = [
        Paragraph(_esc(fields.get("name") or "Candidate"), h1),
        Paragraph(_esc(fields.get("designation") or ""), sub),
        HRFlowable(width="100%", thickness=1.2, color=PRIMARY, spaceAfter=6),
    ]
    meta_bits = []
    if fields.get("location"):
        meta_bits.append(f"<b>Location:</b> {_esc(fields['location'])}")
    if fields.get("total_exp"):
        meta_bits.append(f"<b>Total Experience:</b> {_esc(fields['total_exp'])}")
    if meta_bits:
        story.append(Paragraph(" &nbsp;&nbsp;|&nbsp;&nbsp; ".join(meta_bits), body))
    if fields.get("skills"):
        story.append(Paragraph("KEY SKILLS", h2))
        story.append(Paragraph(_esc(str(fields["skills"])), body))
    if fields.get("summary"):
        story.append(Paragraph("SUMMARY", h2))
        for para in str(fields["summary"]).split("\n"):
            if para.strip():
                story.append(Paragraph(_esc(para.strip()), body))
    doc.build(story)
    return buf.getvalue()


def _build_tracking_html_table(columns: list, rows: list) -> str:
    """Renders the tracking sheet as an inline HTML table for the email
    body — replaces the original Excel-attachment version per the request
    ("in the E-mail body, Not Excel file"). Column labels/values come from
    the exact same template + field_values data the Excel version used."""
    thead = "".join(
        f'<th style="padding:6px 10px;background:#1e3a8a;color:#ffffff;font-size:11px;'
        f'text-align:left;border:1px solid #cbd5e1;white-space:nowrap;">{_esc(str(c.get("label", c.get("key"))))}</th>'
        for c in columns
    )
    body_rows = ""
    for i, r in enumerate(rows):
        bg = "#f8fafc" if i % 2 else "#ffffff"
        cells = "".join(
            f'<td style="padding:6px 10px;font-size:11px;border:1px solid #cbd5e1;'
            f'vertical-align:top;background:{bg};">{_esc(str(r.get(c["key"], "") or ""))}</td>'
            for c in columns
        )
        body_rows += f"<tr>{cells}</tr>"
    return (
        '<table style="border-collapse:collapse;width:100%;font-family:Arial,Helvetica,sans-serif;margin:12px 0;">'
        f"<thead><tr>{thead}</tr></thead><tbody>{body_rows}</tbody></table>"
    )


async def _send_kae_email(tenant_id: str, to_emails, cc_emails, subject: str,
                           body_text: str, attachments: list, body_html_extra: str = "") -> tuple:
    """attachments: list of (filename, bytes, mime_subtype). body_html_extra,
    if given, is appended as real HTML below the plain-text intro (used for
    the inline tracking-sheet table) — the message becomes multipart/
    alternative so clients without HTML rendering still see the plain text.

    Real improvement (2026-08-19): to_emails/cc_emails now accept either a
    single string (back-compat with every existing caller) or a real
    list — needed once a submission could go to a whole screening-team
    list with multiple KAEs cc'd, not just one of each."""
    to_list = [to_emails] if isinstance(to_emails, str) else list(to_emails or [])
    cc_list = [cc_emails] if isinstance(cc_emails, str) else list(cc_emails or [])
    to_list = [e for e in to_list if e]
    cc_list = [e for e in cc_list if e and e not in to_list]
    if not to_list:
        return False, "No recipient email address resolved"
    try:
        db_url = os.environ.get("DATABASE_URL", "postgresql://app_user:apppw@db:5432/ats")
        raw = await asyncpg.connect(db_url)
        try:
            cfg = await raw.fetchrow(
                "SELECT smtp_host,smtp_port,smtp_user,smtp_password,smtp_from,smtp_from_name,smtp_tls "
                "FROM email_settings WHERE tenant_id=$1 AND is_active=TRUE LIMIT 1", tenant_id)
        finally:
            await raw.close()
        if not cfg or not cfg["smtp_host"]:
            return False, "No active SMTP configuration for this tenant (Settings > Email)"

        msg = MIMEMultipart("mixed")
        msg["Subject"] = subject
        msg["From"] = f'{cfg["smtp_from_name"] or "AVIIN ATS"} <{cfg["smtp_from"] or cfg["smtp_user"]}>'
        msg["To"] = ", ".join(to_list)
        recipients = list(to_list)
        if cc_list:
            msg["Cc"] = ", ".join(cc_list)
            recipients.extend(cc_list)

        if body_html_extra:
            alt = MIMEMultipart("alternative")
            alt.attach(MIMEText(body_text, "plain"))
            html_body = f'<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#0f172a;white-space:pre-wrap;">{_esc(body_text)}</div>{body_html_extra}'
            alt.attach(MIMEText(html_body, "html"))
            msg.attach(alt)
        else:
            msg.attach(MIMEText(body_text, "plain"))
        for fname, fbytes, subtype in attachments:
            part = MIMEBase("application", subtype)
            part.set_payload(fbytes)
            encoders.encode_base64(part)
            part.add_header("Content-Disposition", f'attachment; filename="{fname}"')
            msg.attach(part)

        port = cfg["smtp_port"] or 587
        with smtplib.SMTP(cfg["smtp_host"], port, timeout=15) as s:
            s.ehlo()
            if cfg["smtp_tls"] and port == 587:
                s.starttls()
                s.ehlo()
            if cfg["smtp_user"]:
                s.login(cfg["smtp_user"], cfg["smtp_password"] or "")
            s.sendmail(cfg["smtp_from"] or cfg["smtp_user"], recipients, msg.as_string())
        return True, None
    except Exception as exc:
        return False, str(exc)


# ─────────────────────────── Preview + Submit + History ───────────────────────────

@router.get("/applications/{application_id}/submit-to-kae/preview")
async def submission_preview(application_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row, auto_values = await _app_context(conn, application_id)
        kaes = await _resolve_kaes(conn, actor.tenant_id, row["client_id"])
        template = await _resolve_template(conn, actor.tenant_id, row["client_id"])
        templates = await conn.fetch(
            """SELECT tst.id, tst.name, tst.client_id, tst.is_default, cl.name AS client_name
               FROM tracking_sheet_templates tst LEFT JOIN clients cl ON cl.id = tst.client_id
               WHERE tst.tenant_id=$1 ORDER BY tst.is_default DESC, tst.name""",
            actor.tenant_id)
        prior_count = await conn.fetchval(
            "SELECT count(*) FROM candidate_submissions WHERE requisition_id=$1", row["requisition_id"])
        screening = await conn.fetchrow(
            "SELECT to_emails, is_enabled FROM screening_notification_settings WHERE tenant_id=$1", actor.tenant_id)
    return {
        "client_id": str(row["client_id"]) if row["client_id"] else None,
        "kae": dict(kaes[0]) if kaes else None,
        # Real fix (2026-08-19): a client can have more than one active KAE
        # (backup/secondary) — the old "kae" singular field silently hid
        # every KAE past the most-recently-assigned one.
        "kaes": [dict(k) for k in kaes],
        "screening_team_configured": bool(screening and screening["is_enabled"] and screening["to_emails"]),
        "resolved_template_id": str(template["id"]) if template else None,
        "templates": [dict(t) for t in templates],
        "auto_values": {**auto_values, "sl_no": str((prior_count or 0) + 1)},
        "has_resume_text": bool((row["resume_text"] or "").strip()),
    }


_RESUME_STYLES = ("clean_generated", "redacted_original", "manual", "projects_only", "confidential", "anonymized")


class SubmitToKaeIn(BaseModel):
    template_id: Optional[str] = None
    resume_style: str = "clean_generated"
    field_values: dict = {}
    cc_self: bool = True
    manual_resume: Optional[dict] = None  # required when resume_style == 'manual': {name, designation, location, total_exp, skills, summary}
    # Real improvement (2026-08-19): the KAE-submission formats used to be
    # rendered exclusively in the Classic visual theme (no visual_theme key
    # was ever set in _STYLE_CONFIGS, so render_resume_pdf() always fell
    # back to DEFAULT_CONFIG's "classic") -- the standalone Resume
    # Generator built 2026-08-18 got 8 real visual themes, but this older,
    # still-live submission path never gained the same variety. None here
    # means "unspecified" -> falls back to classic/top_right, preserving
    # exact prior behavior for any existing caller that doesn't send these.
    # Only applies to the 5 auto-generated styles below; "manual" keeps its
    # own dedicated, un-themed renderer (see _build_manual_resume_pdf) --
    # it never routed through the shared compositional engine to begin
    # with, and doing so would need a real redesign (its total_exp field
    # is a pre-formatted string like "5y 2m", incompatible with the shared
    # renderers' fmt_exp(int_months) call), not a one-line wire-up.
    visual_theme: Optional[str] = None
    logo_position: Optional[str] = None


async def _do_kae_submission(
    tenant_id: str, application_id: str, actor: Actor,
    resume_bytes: bytes, resume_filename: str, resume_style: str, resume_style_label: str,
    generated_resume_id: str = None, template_id: str = None, field_values: dict = None, cc_self: bool = True,
    override_to_emails: Optional[list] = None, trigger_source: str = "manual",
) -> dict:
    """Shared submission-tracking core (2026-08-12 audit fix): resolves the
    KAE + tracking-sheet template, builds the real cumulative tracking
    sheet, sends the email with the GIVEN resume attachment, writes
    candidate_submissions, bumps the application stage, and writes audit/
    outbox. Used by both submit_to_kae() below (the 6 legacy fixed styles)
    AND resume_generator.py's Generate & Submit (the new compositional
    engine) — one real submission-tracking system, not two. Before this
    fix, a resume sent via the new Resume Generator's Generate & Submit
    button emailed the KAE directly with none of this: invisible in
    submission history, stage never advanced, tracking-sheet sl_no never
    incremented for it.

    Real improvement (2026-08-19): override_to_emails (the screening-team
    address list) lets the auto-screened trigger send primarily to the
    screening team instead of the KAE directly, CC'ing every active KAE
    on the client (plural — client_owners genuinely allows more than one)
    instead of just one. When override_to_emails is None (every existing
    caller), behavior is completely unchanged: primary KAE is the "To",
    still a hard 400 if none is assigned — that requirement only ever
    applied to the manual/direct-to-KAE flow, not the screening-team one,
    where a still-unassigned KAE is a real, expected, non-blocking state."""
    async with db.tenant_conn(tenant_id) as conn:
        row, auto_values = await _app_context(conn, application_id)
        client_id = row["client_id"]
        if not client_id:
            raise HTTPException(400, "This requisition has no client linked — cannot resolve a KAE")
        kaes = await _resolve_kaes(conn, tenant_id, client_id)
        primary_kae = kaes[0] if kaes else None
        if not override_to_emails and (not primary_kae or not primary_kae["email"]):
            raise HTTPException(400, "No active KAE with an email address is assigned to this client (see KAE > Owners)")

        template = None
        if template_id:
            template = await conn.fetchrow(
                "SELECT * FROM tracking_sheet_templates WHERE id=$1 AND tenant_id=$2", template_id, tenant_id)
            if not template:
                raise HTTPException(404, "Tracking sheet template not found")
        else:
            template = await _resolve_template(conn, tenant_id, client_id)
        if not template:
            raise HTTPException(400, "No tracking sheet template available — create one under Ops Settings > Templates")
        columns = _jsonb(template["columns"], [])

        # Real bug fix, found while building the KAE->Client hop: this query
        # had no direction filter at all — once a requisition had BOTH
        # recruiter->KAE and KAE->client submissions, the two directions'
        # sl_no sequences bled into each other (a requisition's 1st real
        # recruiter->KAE send could land as "SL No 5" purely because 4
        # unrelated KAE->client sends had already happened on the same
        # requisition). Each direction is its own cumulative sheet with its
        # own independent sl_no count, matching how _do_client_submission's
        # own query was already correctly scoped from the start.
        prior_rows = await conn.fetch(
            "SELECT field_values FROM candidate_submissions WHERE requisition_id=$1 AND direction='recruiter_to_kae' ORDER BY sent_at",
            row["requisition_id"])
        client_row = await conn.fetchrow("SELECT name FROM clients WHERE id=$1", client_id)
        recruiter_email = actor.email

    sl_no = len(prior_rows) + 1
    overrides = {k: v for k, v in (field_values or {}).items() if v not in (None, "")}
    final_values = {**auto_values, **overrides, "sl_no": str(sl_no)}
    sheet_rows = [_jsonb(r["field_values"], {}) for r in prior_rows] + [final_values]
    tracking_html = _build_tracking_html_table(columns, sheet_rows)

    kae_emails = [k["email"] for k in kaes if k["email"]]
    if override_to_emails:
        to_recipients = list(override_to_emails)
        cc_recipients = kae_emails + ([recruiter_email] if cc_self and recruiter_email else [])
        greeting = "Hi Team,"
        kae_note = f"\n\nKAE{'s' if len(kae_emails) != 1 else ''} cc'd: {', '.join(k['full_name'] or k['email'] for k in kaes)}." if kaes else \
                   "\n\nNote: no KAE is currently assigned to this client (Settings > KAE > Owners)."
    else:
        to_recipients = [primary_kae["email"]]
        cc_recipients = kae_emails[1:] + ([recruiter_email] if cc_self and recruiter_email else [])
        greeting = f"Hi {primary_kae['full_name'] or ''},"
        kae_note = ""

    subject = f"Candidate Submission — {row['full_name']} for {row['role_title']}"
    body_text = (
        f"{greeting}\n\n"
        f"Please find attached the profile for {row['full_name']} against \"{row['role_title']}\""
        f"{' (' + client_row['name'] + ')' if client_row else ''}. The tracking sheet "
        f"({sl_no} submission{'s' if sl_no != 1 else ''} on this role so far) is below.\n\n"
        f"Resume attached: {resume_style_label}."
        f"{kae_note}\n\n"
        f"Regards,\n{actor.full_name or 'AVIIN ATS'}"
    )
    ext = resume_filename.rsplit(".", 1)[-1].lower()
    subtype = "pdf" if ext == "pdf" else "vnd.openxmlformats-officedocument.wordprocessingml.document"
    email_sent, email_error = await _send_kae_email(
        tenant_id, to_recipients, cc_recipients, subject, body_text,
        [(resume_filename, resume_bytes, subtype)],
        body_html_extra=tracking_html,
    )

    async with db.tenant_conn(tenant_id) as conn:
        sub_row = await conn.fetchrow(
            """INSERT INTO candidate_submissions
                 (tenant_id, application_id, candidate_id, requisition_id, client_id, template_id,
                  kae_user_id, resume_style, field_values, recipient_emails, status, error_message, sent_by,
                  generated_resume_id, trigger_source)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *""",
            tenant_id, application_id, row["candidate_id"], row["requisition_id"], client_id,
            template["id"], primary_kae["id"] if primary_kae else None, resume_style, json.dumps(final_values),
            list(dict.fromkeys(to_recipients + cc_recipients)),
            "sent" if email_sent else "failed", email_error, actor.user_id, generated_resume_id, trigger_source,
        )

        bumped = False
        if row["stage"] in _PRE_SUBMIT_STAGES and await is_valid_stage(conn, tenant_id, "submitted"):
            await conn.execute("UPDATE applications SET stage='submitted', updated_at=now() WHERE id=$1", application_id)
            bumped = True
            await events.write_outbox(
                conn, tenant_id, "application.stage_changed",
                {"application_id": application_id, "from": row["stage"], "to": "submitted", "reason": "submit_to_kae"},
                f"application.stage_changed:{application_id}:{sub_row['sent_at'].isoformat()}",
            )

        await events.write_outbox(
            conn, tenant_id, "candidate.submitted_to_kae",
            {"application_id": application_id, "candidate_id": str(row["candidate_id"]),
             "kae_user_id": str(primary_kae["id"]) if primary_kae else None, "email_sent": email_sent},
            f"candidate.submitted_to_kae:{sub_row['id']}",
        )
        await events.write_audit(
            conn, tenant_id, actor.user_id, "submit_to_kae", "application", application_id,
            before={"stage": row["stage"]},
            after={"to": to_recipients, "cc": cc_recipients, "resume_style": resume_style,
                   "email_sent": email_sent, "sl_no": sl_no, "trigger_source": trigger_source},
        )

    out = dict(sub_row)
    out["field_values"] = _jsonb(out["field_values"], {})
    out["email_sent"] = email_sent
    out["email_error"] = email_error
    out["stage_bumped_to_submitted"] = bumped
    out["kae_name"] = primary_kae["full_name"] if primary_kae else None
    return out


@router.get("/applications/{application_id}/submit-to-kae/manual-draft")
async def submit_to_kae_manual_draft(application_id: str, actor: Actor = Depends(get_actor)):
    """Pre-filled starting point for the "Manual editing" resume format —
    the recruiter edits this in the UI before it's rendered verbatim, no
    re-parsing happens server-side once submitted."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        row, _ = await _app_context(conn, application_id)
    summary = _redact_text(row["resume_text"] or "", row)
    return {
        "name": row["full_name"] or "",
        "designation": row["current_designation"] or "",
        "location": row["location"] or "",
        "total_exp": _fmt_exp(row["total_exp_mo"]),
        "skills": ", ".join(row["skills"] or []),
        "summary": summary[:2200],
    }


_RESUME_LABELS = {
    "clean_generated": "contact-free clean summary",
    "redacted_original": "redacted original (phone/email removed)",
    "manual": "recruiter-edited summary (contact withheld)",
    "projects_only": "projects-only summary (contact & employment history withheld)",
    "confidential": "clean summary — current company & projects marked Confidential",
    "anonymized": "anonymized profile — identity & employer masked",
}


@router.post("/applications/{application_id}/submit-to-kae")
async def submit_to_kae(application_id: str, body: SubmitToKaeIn, actor: Actor = Depends(get_actor)):
    if body.resume_style not in _RESUME_STYLES:
        raise HTTPException(400, f"resume_style must be one of {', '.join(_RESUME_STYLES)}")
    if body.resume_style == "manual" and not body.manual_resume:
        raise HTTPException(400, "manual_resume is required when resume_style is 'manual'")
    if body.visual_theme is not None and body.visual_theme not in _VALID_THEMES:
        raise HTTPException(400, f"visual_theme must be one of {sorted(_VALID_THEMES)}")
    if body.logo_position is not None and body.logo_position not in _VALID_LOGO_POSITIONS:
        raise HTTPException(400, f"logo_position must be one of {sorted(_VALID_LOGO_POSITIONS)}")

    async with db.tenant_conn(actor.tenant_id) as conn:
        row, _ = await _app_context(conn, application_id)
    candidate = {
        "full_name": row["full_name"], "phone": row["phone"], "email": row["email"],
        "location": row["location"], "current_employer": row["current_employer"],
        "current_designation": row["current_designation"], "total_exp_mo": row["total_exp_mo"],
        "skills": row["skills"], "resume_text": row["resume_text"],
    }
    if body.resume_style == "manual":
        resume_bytes = _build_manual_resume_pdf(body.manual_resume or {})
    else:
        cfg = {**_STYLE_CONFIGS[body.resume_style]}
        if body.visual_theme:
            cfg["visual_theme"] = body.visual_theme
        if body.logo_position:
            cfg["logo_position"] = body.logo_position
        resume_bytes = render_resume_pdf(candidate, cfg)

    safe_name = re.sub(r"[^A-Za-z0-9_-]+", "_", candidate["full_name"] or "candidate")
    return await _do_kae_submission(
        actor.tenant_id, application_id, actor, resume_bytes,
        f"Resume_{safe_name}_{body.resume_style}.pdf", body.resume_style,
        _RESUME_LABELS.get(body.resume_style, body.resume_style),
        template_id=body.template_id, field_values=body.field_values, cc_self=body.cc_self,
    )


@router.get("/applications/{application_id}/submissions")
async def submission_history(application_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            """SELECT cs.*, u.full_name AS kae_name, ub.full_name AS sent_by_name, tst.name AS template_name
               FROM candidate_submissions cs
               LEFT JOIN users u ON u.id = cs.kae_user_id
               LEFT JOIN users ub ON ub.id = cs.sent_by
               LEFT JOIN tracking_sheet_templates tst ON tst.id = cs.template_id
               WHERE cs.application_id=$1 ORDER BY cs.sent_at DESC""",
            application_id)
    out = []
    for r in rows:
        d = dict(r)
        d["field_values"] = _jsonb(d["field_values"], {})
        out.append(d)
    return out


# ══════════════════════ KAE -> Client / KAM submission (2nd hop) ══════════════════════
# Everything above this line is the recruiter -> KAE hop, built 2026-07-29
# onward. There was no second hop at all: nothing routed a candidate onward
# from the KAE to the actual client/KAM, and nothing distinguished "sent to
# our KAE" from "shared with the client" anywhere in the schema. This
# section adds that hop as its own real, tracked, one-click action —
# direction='kae_to_client' throughout — reusing every shared piece above
# (COLUMN_REGISTRY, _app_context, _build_tracking_html_table, resume
# rendering, _send_kae_email) rather than a second, parallel system.

@router.get("/clients/{client_id}/contacts")
async def list_client_contacts(client_id: str, actor: Actor = Depends(require_permission("companies", "read"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await _resolve_client_contacts(conn, actor.tenant_id, client_id)
    return [dict(r) for r in rows]


class ClientContactIn(BaseModel):
    contact_name: str
    email: str
    role_label: Optional[str] = None
    is_primary: bool = False


@router.post("/clients/{client_id}/contacts", status_code=201)
async def create_client_contact(client_id: str, body: ClientContactIn, actor: Actor = Depends(require_permission("companies", "update"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        exists = await conn.fetchval("SELECT 1 FROM clients WHERE id=$1 AND tenant_id=$2", client_id, actor.tenant_id)
        if not exists:
            raise HTTPException(404, "Client not found")
        if body.is_primary:
            await conn.execute(
                "UPDATE client_contacts SET is_primary=false WHERE tenant_id=$1 AND client_id=$2",
                actor.tenant_id, client_id)
        row = await conn.fetchrow(
            """INSERT INTO client_contacts (tenant_id, client_id, contact_name, email, role_label, is_primary, created_by)
               VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *""",
            actor.tenant_id, client_id, body.contact_name, body.email, body.role_label, body.is_primary, actor.user_id)
    return dict(row)


@router.put("/client-contacts/{contact_id}")
async def update_client_contact(contact_id: str, body: ClientContactIn, actor: Actor = Depends(require_permission("companies", "update"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        existing = await conn.fetchrow(
            "SELECT client_id FROM client_contacts WHERE id=$1 AND tenant_id=$2", contact_id, actor.tenant_id)
        if not existing:
            raise HTTPException(404, "Contact not found")
        if body.is_primary:
            await conn.execute(
                "UPDATE client_contacts SET is_primary=false WHERE tenant_id=$1 AND client_id=$2 AND id != $3",
                actor.tenant_id, existing["client_id"], contact_id)
        row = await conn.fetchrow(
            """UPDATE client_contacts SET contact_name=$1, email=$2, role_label=$3, is_primary=$4, updated_at=now()
               WHERE id=$5 RETURNING *""",
            body.contact_name, body.email, body.role_label, body.is_primary, contact_id)
    return dict(row)


@router.delete("/client-contacts/{contact_id}")
async def delete_client_contact(contact_id: str, actor: Actor = Depends(require_permission("companies", "update"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.execute("DELETE FROM client_contacts WHERE id=$1 AND tenant_id=$2", contact_id, actor.tenant_id)
    return {"ok": True, "deleted": row != "DELETE 0"}


@router.get("/applications/{application_id}/submit-to-client/preview")
async def submit_to_client_preview(application_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row, auto_values = await _app_context(conn, application_id)
        contacts = await _resolve_client_contacts(conn, actor.tenant_id, row["client_id"])
        template = await _resolve_template(conn, actor.tenant_id, row["client_id"], "kae_to_client")
        templates = await conn.fetch(
            """SELECT tst.id, tst.name, tst.client_id, tst.is_default, tst.template_type, tst.file_name, cl.name AS client_name
               FROM tracking_sheet_templates tst LEFT JOIN clients cl ON cl.id = tst.client_id
               WHERE tst.tenant_id=$1 AND tst.direction='kae_to_client' AND tst.is_active
               ORDER BY tst.is_default DESC, tst.name""",
            actor.tenant_id)
        prior_count = await conn.fetchval(
            "SELECT count(*) FROM candidate_submissions WHERE requisition_id=$1 AND direction='kae_to_client'",
            row["requisition_id"])
    return {
        "client_id": str(row["client_id"]) if row["client_id"] else None,
        "primary_contact": dict(contacts[0]) if contacts and contacts[0]["is_primary"] else None,
        "contacts": [dict(c) for c in contacts],
        "resolved_template": _template_out(template) if template else None,
        "templates": [_template_out(t) for t in templates],
        "auto_values": {**auto_values, "sl_no": str((prior_count or 0) + 1)},
        "has_resume_text": bool((row["resume_text"] or "").strip()),
        "stage": row["stage"],
    }


class SubmitToClientIn(BaseModel):
    template_id: Optional[str] = None
    to_emails: Optional[list[str]] = None
    columns: Optional[list[dict]] = None
    hidden_columns: list[str] = []
    field_values: dict = {}
    resume_style: str = "clean_generated"
    manual_resume: Optional[dict] = None
    visual_theme: Optional[str] = None
    logo_position: Optional[str] = None
    cc_self: bool = True
    save_as_default: bool = False


async def _do_client_submission(
    tenant_id: str, application_id: str, actor: Actor,
    resume_bytes: bytes, resume_filename: str, resume_style: str, resume_style_label: str,
    template_id: Optional[str], columns_override: Optional[list], hidden_columns: list,
    field_values: Optional[dict], to_emails_override: Optional[list], cc_self: bool, save_as_default: bool,
) -> dict:
    """The KAE->Client hop: mirrors _do_kae_submission's shape (same
    _app_context, same resume attachment, same audit/outbox discipline) but
    resolves a client contact (not a KAE) as the recipient, a
    direction='kae_to_client' template, and supports two real, independent
    edits a KAE can make before sending without ever silently mutating the
    saved default:
      - hidden_columns: ALWAYS one-time — recorded on this submission row
        for audit, never written back to the template, regardless of
        save_as_default.
      - columns_override: the effective column list for THIS send. Only
        persisted if save_as_default=True, and even then only ever written
        to a template row pinned to THIS client — a shared/global default
        template is never silently repurposed by one client's edit."""
    async with db.tenant_conn(tenant_id) as conn:
        row, auto_values = await _app_context(conn, application_id)
        client_id = row["client_id"]
        if not client_id:
            raise HTTPException(400, "This requisition has no client linked — cannot resolve a recipient")
        contacts = await _resolve_client_contacts(conn, tenant_id, client_id)
        primary_contact = contacts[0] if contacts else None
        if not to_emails_override and not primary_contact:
            raise HTTPException(400, "No client contact is configured — add one under Companies > this client > Contacts")

        template = None
        if template_id:
            template = await conn.fetchrow(
                "SELECT * FROM tracking_sheet_templates WHERE id=$1 AND tenant_id=$2 AND direction='kae_to_client'",
                template_id, tenant_id)
            if not template:
                raise HTTPException(404, "Tracking sheet template not found")
        else:
            template = await _resolve_template(conn, tenant_id, client_id, "kae_to_client")
        if not template and not columns_override:
            raise HTTPException(400, "No client tracking sheet template available — create one under Ops Settings > Templates")
        columns = columns_override if columns_override else _jsonb(template["columns"], [])
        visible_columns = [c for c in columns if c["key"] not in (hidden_columns or [])]

        prior_rows = await conn.fetch(
            """SELECT field_values FROM candidate_submissions
               WHERE requisition_id=$1 AND direction='kae_to_client' ORDER BY sent_at""",
            row["requisition_id"])
        client_row = await conn.fetchrow("SELECT name FROM clients WHERE id=$1", client_id)
        recruiter_email = actor.email

        if save_as_default and columns_override:
            # Persists ONLY as a client-pinned template for this exact
            # client — never overwrites a global/shared default, and never
            # fires from hidden_columns (that stays a per-send redaction).
            existing_client_default = await conn.fetchrow(
                """SELECT id FROM tracking_sheet_templates
                   WHERE tenant_id=$1 AND client_id=$2 AND direction='kae_to_client' AND is_default""",
                tenant_id, client_id)
            if existing_client_default:
                await conn.execute(
                    "UPDATE tracking_sheet_templates SET columns=$1, updated_at=now() WHERE id=$2",
                    json.dumps(columns_override), existing_client_default["id"])
            else:
                await _unset_other_defaults(conn, tenant_id, client_id, "kae_to_client")
                new_tpl = await conn.fetchrow(
                    """INSERT INTO tracking_sheet_templates
                         (tenant_id, client_id, name, columns, is_default, direction, created_by)
                       VALUES ($1,$2,$3,$4,true,'kae_to_client',$5) RETURNING id""",
                    tenant_id, client_id, f"{client_row['name'] if client_row else 'Client'} — Client Tracking Sheet",
                    json.dumps(columns_override), actor.user_id)
                template_id = template_id or str(new_tpl["id"])

    sl_no = len(prior_rows) + 1
    overrides = {k: v for k, v in (field_values or {}).items() if v not in (None, "")}
    final_values = {**auto_values, **overrides, "sl_no": str(sl_no)}
    sheet_rows = [_jsonb(r["field_values"], {}) for r in prior_rows] + [final_values]
    # Hidden columns must never leak into ANY output for this send — not
    # just the inline table. A file-template merge (xlsx/docx) reads
    # straight from a row dict by key, so the real fix is blanking the
    # hidden keys out of the dict itself before it ever reaches the merge
    # engine, not just filtering which columns get *listed*.
    hidden_set = set(hidden_columns or [])
    merge_rows = [{k: ("" if k in hidden_set else v) for k, v in r.items()} for r in sheet_rows] if hidden_set else sheet_rows

    attachments = [(resume_filename, resume_bytes,
                     "pdf" if resume_filename.lower().endswith(".pdf") else
                     "vnd.openxmlformats-officedocument.wordprocessingml.document")]
    body_html_extra = ""
    if template and template["template_type"] == "file" and template["file_path"]:
        abs_path = Path("/app") / template["file_path"].lstrip("/")
        if abs_path.exists():
            raw = abs_path.read_bytes()
            ext = abs_path.suffix.lower()
            if ext == ".xlsx":
                merged = template_merge.fill_xlsx_template(raw, merge_rows)
                attachments.append((f"Tracking_Sheet_{client_row['name'] if client_row else ''}.xlsx".replace(" ", "_"),
                                     merged, "vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
            elif ext == ".docx":
                merged = template_merge.fill_docx_template(raw, merge_rows)
                attachments.append((template["file_name"] or "Tracking_Sheet.docx", merged,
                                     "vnd.openxmlformats-officedocument.wordprocessingml.document"))
            else:  # .pdf — attached as a static reference only, never merged (see upload_template_file docstring)
                attachments.append((template["file_name"] or "Tracking_Sheet_Template.pdf", raw, "pdf"))
                body_html_extra = _build_tracking_html_table(visible_columns, sheet_rows)
    else:
        body_html_extra = _build_tracking_html_table(visible_columns, sheet_rows)

    if to_emails_override:
        to_recipients = list(to_emails_override)
        cc_recipients = [c["email"] for c in contacts if c["email"] not in to_recipients] + \
                         ([recruiter_email] if cc_self and recruiter_email else [])
        greeting = "Hi Team,"
    else:
        to_recipients = [primary_contact["email"]]
        cc_recipients = [c["email"] for c in contacts[1:] if c["email"]] + \
                         ([recruiter_email] if cc_self and recruiter_email else [])
        greeting = f"Hi {primary_contact['contact_name'] or ''},"

    subject = f"Candidate Submission — {row['full_name']} for {row['role_title']}"
    body_text = (
        f"{greeting}\n\n"
        f"Please find attached the profile for {row['full_name']} against \"{row['role_title']}\""
        f"{' (' + client_row['name'] + ')' if client_row else ''}. "
        f"{'The tracking sheet is attached.' if attachments and len(attachments) > 1 and body_html_extra == '' else 'The tracking sheet is below.'}\n\n"
        f"Resume attached: {resume_style_label}.\n\n"
        f"Regards,\n{actor.full_name or 'AVIIN ATS'}"
    )
    email_sent, email_error = await _send_kae_email(
        tenant_id, to_recipients, cc_recipients, subject, body_text, attachments,
        body_html_extra=body_html_extra,
    )

    async with db.tenant_conn(tenant_id) as conn:
        sub_row = await conn.fetchrow(
            """INSERT INTO candidate_submissions
                 (tenant_id, application_id, candidate_id, requisition_id, client_id, template_id,
                  resume_style, field_values, recipient_emails, to_emails, status, error_message, sent_by,
                  direction, hidden_columns, recipient_contact_id, trigger_source)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'kae_to_client',$14,$15,'manual') RETURNING *""",
            tenant_id, application_id, row["candidate_id"], row["requisition_id"], client_id,
            template["id"] if template else None, resume_style, json.dumps(final_values),
            list(dict.fromkeys(to_recipients + cc_recipients)), to_recipients,
            "sent" if email_sent else "failed", email_error, actor.user_id,
            hidden_columns or [], primary_contact["id"] if (primary_contact and not to_emails_override) else None,
        )

        await events.write_outbox(
            conn, tenant_id, "candidate.submitted_to_client",
            {"application_id": application_id, "candidate_id": str(row["candidate_id"]),
             "client_id": str(client_id), "email_sent": email_sent},
            f"candidate.submitted_to_client:{sub_row['id']}",
        )
        await events.write_audit(
            conn, tenant_id, actor.user_id, "submit_to_client", "application", application_id,
            before={"stage": row["stage"]},
            after={"to": to_recipients, "cc": cc_recipients, "resume_style": resume_style,
                   "email_sent": email_sent, "sl_no": sl_no, "hidden_columns": hidden_columns,
                   "saved_as_default": bool(save_as_default and columns_override)},
        )

    out = dict(sub_row)
    out["field_values"] = _jsonb(out["field_values"], {})
    out["email_sent"] = email_sent
    out["email_error"] = email_error
    out["recipient_name"] = primary_contact["contact_name"] if (primary_contact and not to_emails_override) else "Client/KAM"
    return out


@router.post("/applications/{application_id}/submit-to-client")
async def submit_to_client(application_id: str, body: SubmitToClientIn, actor: Actor = Depends(get_actor)):
    """One-Click Approve & Send: everything defaults from real, live data
    (auto_values, the client's configured default template, clean_generated
    resume) — a caller that sends an empty-ish body genuinely completes the
    whole "generate + send" flow in one call. Every field is still
    independently editable first via the /preview endpoint's data."""
    if body.resume_style not in _RESUME_STYLES:
        raise HTTPException(400, f"resume_style must be one of {', '.join(_RESUME_STYLES)}")
    if body.resume_style == "manual" and not body.manual_resume:
        raise HTTPException(400, "manual_resume is required when resume_style is 'manual'")
    if body.visual_theme is not None and body.visual_theme not in _VALID_THEMES:
        raise HTTPException(400, f"visual_theme must be one of {sorted(_VALID_THEMES)}")
    if body.logo_position is not None and body.logo_position not in _VALID_LOGO_POSITIONS:
        raise HTTPException(400, f"logo_position must be one of {sorted(_VALID_LOGO_POSITIONS)}")

    async with db.tenant_conn(actor.tenant_id) as conn:
        row, _ = await _app_context(conn, application_id)
    candidate = {
        "full_name": row["full_name"], "phone": row["phone"], "email": row["email"],
        "location": row["location"], "current_employer": row["current_employer"],
        "current_designation": row["current_designation"], "total_exp_mo": row["total_exp_mo"],
        "skills": row["skills"], "resume_text": row["resume_text"],
    }
    if body.resume_style == "manual":
        resume_bytes = _build_manual_resume_pdf(body.manual_resume or {})
    else:
        cfg = {**_STYLE_CONFIGS[body.resume_style]}
        if body.visual_theme:
            cfg["visual_theme"] = body.visual_theme
        if body.logo_position:
            cfg["logo_position"] = body.logo_position
        resume_bytes = render_resume_pdf(candidate, cfg)

    safe_name = re.sub(r"[^A-Za-z0-9_-]+", "_", candidate["full_name"] or "candidate")
    return await _do_client_submission(
        actor.tenant_id, application_id, actor, resume_bytes,
        f"Resume_{safe_name}_{body.resume_style}.pdf", body.resume_style,
        _RESUME_LABELS.get(body.resume_style, body.resume_style),
        template_id=body.template_id, columns_override=body.columns, hidden_columns=body.hidden_columns,
        field_values=body.field_values, to_emails_override=body.to_emails, cc_self=body.cc_self,
        save_as_default=body.save_as_default,
    )
