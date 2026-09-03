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
import asyncio
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
from permissions import require_permission, has_permission_soft
from routers.pipeline_stages import is_valid_stage
from routers.communications import _log as _log_candidate_message
from services.resume_formatting import render_resume_pdf, redact_contact, mask_name, _VALID_THEMES, _VALID_LOGO_POSITIONS, build_resume_filename
from services import template_merge
from services import email_tracking

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
# Real feature (2026-08-26): the KAE->Client hop's own pre-submit set —
# includes 'client_submission' itself, since that's the real stage the
# application is actually in the moment this fires (moving a card into
# "Submit to Client" is what triggers this send in the first place), on
# top of every earlier stage in case a KAE sends directly from an earlier
# point without passing through that stage first.
_PRE_SUBMIT_CLIENT_STAGES = _PRE_SUBMIT_STAGES | {"client_submission"}


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


def _format_skill_summary_default(rows) -> str:
    """Real gap fix (2026-09-03): the tracking-sheet's "Skill Relevant
    Exp / Support / Implementation / Projects" column (skill_summary,
    COLUMN_REGISTRY) has always been a blank, purely-manual free-text
    field for a recruiter/KAE to retype by hand on every single send —
    even though the SAME information already lives, real and structured,
    in candidate_skill_experience the moment auto_populate_skill_
    experience() (services/skill_experience_parser.py) has run. Builds a
    real, readable default line per stored row ("SAP FICO: 8 Yrs"),
    including project/duration/role/last-used detail whenever a row
    genuinely has it (most don't yet — the auto-populate path only ever
    fills skill_name + relevant_experience; a recruiter can still add the
    richer detail by hand, same as today). Never fabricates a value for a
    field that's empty. Purely a computed DEFAULT into auto_values, still
    fully free-text-editable in the actual send — matches this exact
    same "auto-computed starting point, human can still change it" model
    every other auto_values field already uses."""
    if not rows:
        return ""
    lines = []
    for r in rows:
        parts = [r["skill_name"]]
        detail = []
        if r.get("project_name"):
            detail.append(r["project_name"])
        if r.get("duration_from") or r.get("duration_to"):
            df = r["duration_from"].strftime("%b %Y") if r.get("duration_from") else "?"
            dt = r["duration_to"].strftime("%b %Y") if r.get("duration_to") else "Present"
            detail.append(f"{df} - {dt}")
        if r.get("role_types"):
            detail.append("/".join(r["role_types"]))
        if r.get("last_used"):
            detail.append(f"Last used: {r['last_used']}")
        label = r["skill_name"]
        if detail:
            label += " (" + ", ".join(detail) + ")"
        rel = r.get("relevant_experience") or ""
        lines.append(f"{label}: {rel}" if rel else label)
    return "\n".join(lines)


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

    skill_rows = await conn.fetch(
        """SELECT skill_name, project_name, duration_from, duration_to, role_types,
                  relevant_experience, last_used
           FROM candidate_skill_experience
           WHERE candidate_id=$1 ORDER BY sort_order""",
        row["candidate_id"])
    skill_summary_default = _format_skill_summary_default([dict(r) for r in skill_rows])

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
        "skill_summary": skill_summary_default,
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


async def _resolve_template(conn, tenant_id: str, client_id: Optional[str], direction: str = "recruiter_to_kae",
                             client_contact_id: Optional[str] = None, requisition_id: Optional[str] = None):
    """Real fix (this feature): a client can now genuinely have more than
    one active template pinned to it (non-default alternates a KAE can
    pick from) — the old ORDER BY created_at LIMIT 1 silently picked
    whichever was oldest with no way to express "this one is the real
    default." Now prefers the one actually marked is_default among a
    client's own templates, falling back to the client's oldest only if
    none is marked (shouldn't happen post-migration, but never 400s over
    it). direction distinguishes the recruiter->KAE hop from the newer
    KAE->client hop — each has its own independent default.

    REAL FEATURE (2026-09-02, reported live: "make default for the
    selected client and spoc or project wise"): resolution now checks 2
    more, more-specific scopes before falling back to the plain client
    default — requisition_id (one specific project/role) beats
    client_contact_id (one specific SPOC) beats a plain client-wide
    default beats the global fallback. Each optional param is None
    unless the caller genuinely knows it (e.g. no requisition context at
    all), so passing neither reproduces the exact original 2-tier
    behavior unchanged.

    REAL BUG FIX (2026-09-02, reported live: dozens of stray "QA S54
    Client ..." test templates cluttering the real picker): a client-
    pinned template whose client has since been soft-deleted is no
    longer eligible to resolve as a default — it stays visible only to
    an admin explicitly browsing "include inactive," matching the same
    is_active-filter convention already used everywhere else in this
    project. SPOC/requisition-pinned templates aren't separately checked
    here since both FKs are ON DELETE SET NULL — a genuinely orphaned one
    already falls through the tiers above it on its own."""
    row = None
    if requisition_id:
        row = await conn.fetchrow(
            """SELECT tst.* FROM tracking_sheet_templates tst
               JOIN requisitions r ON r.id = tst.requisition_id
               WHERE tst.tenant_id=$1 AND tst.requisition_id=$2 AND tst.direction=$3 AND tst.is_active
                 AND r.is_active IS NOT FALSE
               ORDER BY tst.is_default DESC, tst.created_at LIMIT 1""",
            tenant_id, requisition_id, direction)
    if row is None and client_contact_id:
        row = await conn.fetchrow(
            """SELECT * FROM tracking_sheet_templates
               WHERE tenant_id=$1 AND client_contact_id=$2 AND direction=$3 AND is_active
               ORDER BY is_default DESC, created_at LIMIT 1""",
            tenant_id, client_contact_id, direction)
    if row is None and client_id:
        row = await conn.fetchrow(
            """SELECT tst.* FROM tracking_sheet_templates tst
               JOIN clients cl ON cl.id = tst.client_id
               WHERE tst.tenant_id=$1 AND tst.client_id=$2 AND tst.direction=$3 AND tst.is_active
                 AND tst.client_contact_id IS NULL AND tst.requisition_id IS NULL
                 AND cl.is_active IS NOT FALSE
               ORDER BY tst.is_default DESC, tst.created_at LIMIT 1""",
            tenant_id, client_id, direction)
    if row is None:
        row = await conn.fetchrow(
            """SELECT * FROM tracking_sheet_templates
               WHERE tenant_id=$1 AND is_default AND client_id IS NULL AND direction=$2 AND is_active LIMIT 1""",
            tenant_id, direction)
    return row


async def _resolve_client_contacts(conn, tenant_id: str, client_id: Optional[str], kae_user_id: Optional[str] = None):
    """kae_user_id, when given, scopes the result to only the SPOCs this
    specific KAE has actually been assigned (client_contact_kae_
    assignments) — the real business requirement reported live
    2026-09-02: a client can have many SPOCs, but a given KAE should only
    ever see/use the ones an admin has assigned to them, not the whole
    client's contact book. Admin/manager callers pass kae_user_id=None
    and keep seeing every SPOC, unchanged."""
    if not client_id:
        return []
    if kae_user_id:
        return await conn.fetch(
            """SELECT cc.id, cc.contact_name, cc.email, cc.role_label, cc.is_primary
               FROM client_contacts cc
               JOIN client_contact_kae_assignments ka
                    ON ka.client_contact_id = cc.id AND ka.tenant_id = cc.tenant_id
               WHERE cc.tenant_id=$1 AND cc.client_id=$2 AND ka.kae_user_id=$3
               ORDER BY cc.is_primary DESC, cc.contact_name""",
            tenant_id, client_id, kae_user_id,
        )
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
    # REAL FEATURE (2026-09-02): a template can now be pinned to a
    # specific SPOC or a specific requisition/project within a client,
    # not just the client as a whole — see _resolve_template()'s own
    # docstring for the real resolution priority.
    client_contact_id: Optional[str] = None
    requisition_id: Optional[str] = None
    columns: list[dict]
    is_default: bool = False
    direction: str = "recruiter_to_kae"


async def _unset_other_defaults(conn, tenant_id: str, client_id: Optional[str], direction: str,
                                 client_contact_id: Optional[str] = None, requisition_id: Optional[str] = None,
                                 exclude_id: Optional[str] = None):
    """A default is scoped to exactly one tier — requisition, SPOC,
    client, or global — setting a new one only clears the OTHER
    template that shared that EXACT same scope, never a broader or
    narrower tier's default (the real bug this feature's own audit
    found for the client tier alone: the old single tenant-wide UNIQUE
    let two different clients silently fight over one "the" default;
    the same class of bug would recur here if a new SPOC-level default
    accidentally cleared the client-level one, or vice versa)."""
    if requisition_id:
        q = "UPDATE tracking_sheet_templates SET is_default=false WHERE tenant_id=$1 AND direction=$2 AND requisition_id=$3"
        args = [tenant_id, direction, requisition_id]
    elif client_contact_id:
        q = "UPDATE tracking_sheet_templates SET is_default=false WHERE tenant_id=$1 AND direction=$2 AND client_contact_id=$3"
        args = [tenant_id, direction, client_contact_id]
    elif client_id:
        q = ("UPDATE tracking_sheet_templates SET is_default=false WHERE tenant_id=$1 AND direction=$2 AND client_id=$3 "
             "AND client_contact_id IS NULL AND requisition_id IS NULL")
        args = [tenant_id, direction, client_id]
    else:
        q = "UPDATE tracking_sheet_templates SET is_default=false WHERE tenant_id=$1 AND direction=$2 AND client_id IS NULL"
        args = [tenant_id, direction]
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
        # REAL BUG FIX (2026-09-02, reported live): a client-pinned
        # template whose client has since been soft-deleted stayed
        # visible in the real picker forever — this tenant's own picker
        # had accumulated 29 stray "QA S54 Client ..." test templates
        # this way, since GET /clients (and every other list in this
        # app) already filters soft-deleted rows but this one never did.
        # Matches the same is_active-filter convention used everywhere
        # else; `include_inactive` still shows them for an admin who
        # genuinely wants to browse/clean up orphaned ones.
        if not include_inactive:
            where.append("(tst.client_id IS NULL OR cl.is_active IS NOT FALSE)")
        rows = await conn.fetch(
            f"""SELECT tst.*, cl.name AS client_name, cc.contact_name AS spoc_name, r.title AS requisition_title
                FROM tracking_sheet_templates tst
                LEFT JOIN clients cl ON cl.id = tst.client_id
                LEFT JOIN client_contacts cc ON cc.id = tst.client_contact_id
                LEFT JOIN requisitions r ON r.id = tst.requisition_id
                WHERE {' AND '.join(where)} ORDER BY tst.is_default DESC, tst.name""",
            *args)
    return [_template_out(r) for r in rows]


async def _validate_template_scope(conn, tenant_id: str, client_id: Optional[str],
                                    client_contact_id: Optional[str], requisition_id: Optional[str]):
    """A SPOC or a requisition pin must genuinely belong to the SAME
    client the template is otherwise scoped to — a real, cheap guard
    against a mismatched pin (e.g. picking a SPOC from a different
    client than the one selected) silently resolving nothing at send
    time, rather than failing loudly here where the mistake is easy to
    see and fix."""
    if client_contact_id:
        owner_client = await conn.fetchval(
            "SELECT client_id FROM client_contacts WHERE id=$1 AND tenant_id=$2", client_contact_id, tenant_id)
        if not owner_client:
            raise HTTPException(400, "Unknown SPOC (client contact)")
        if client_id and str(owner_client) != str(client_id):
            raise HTTPException(400, "That SPOC belongs to a different client than the one selected")
    if requisition_id:
        req_row = await conn.fetchrow(
            "SELECT client_id FROM requisitions WHERE id=$1 AND tenant_id=$2", requisition_id, tenant_id)
        if not req_row:
            raise HTTPException(400, "Unknown requisition")
        if client_id and req_row["client_id"] and str(req_row["client_id"]) != str(client_id):
            raise HTTPException(400, "That requisition belongs to a different client than the one selected")


@router.post("/submission-templates")
async def create_template(body: TemplateIn, actor: Actor = Depends(get_actor)):
    if body.direction not in _DIRECTIONS:
        raise HTTPException(400, f"direction must be one of {_DIRECTIONS}")
    if not body.columns:
        raise HTTPException(400, "Template must include at least one column")
    async with db.tenant_conn(actor.tenant_id) as conn:
        await _validate_template_scope(conn, actor.tenant_id, body.client_id, body.client_contact_id, body.requisition_id)
        if body.is_default:
            await _unset_other_defaults(conn, actor.tenant_id, body.client_id, body.direction,
                                         client_contact_id=body.client_contact_id, requisition_id=body.requisition_id)
        row = await conn.fetchrow(
            """INSERT INTO tracking_sheet_templates
                 (tenant_id, client_id, client_contact_id, requisition_id, name, columns, is_default, direction, created_by)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *""",
            actor.tenant_id, body.client_id, body.client_contact_id, body.requisition_id,
            body.name, json.dumps(body.columns), body.is_default, body.direction, actor.user_id)
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
        await _validate_template_scope(conn, actor.tenant_id, body.client_id, body.client_contact_id, body.requisition_id)
        if body.is_default:
            await _unset_other_defaults(conn, actor.tenant_id, body.client_id, body.direction,
                                         client_contact_id=body.client_contact_id, requisition_id=body.requisition_id,
                                         exclude_id=template_id)
        row = await conn.fetchrow(
            """UPDATE tracking_sheet_templates
               SET name=$1, client_id=$2, client_contact_id=$3, requisition_id=$4, columns=$5, is_default=$6,
                   direction=$7, updated_at=now()
               WHERE id=$8 RETURNING *""",
            body.name, body.client_id, body.client_contact_id, body.requisition_id,
            json.dumps(body.columns), body.is_default, body.direction, template_id)
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
        try:
            await conn.execute("DELETE FROM tracking_sheet_templates WHERE id=$1", template_id)
        except asyncpg.exceptions.ForeignKeyViolationError:
            # REAL BUG FIX (2026-09-03, reported live: "Request failed"
            # on the actual Ops Settings Delete button, even after
            # un-defaulting first) — candidate_submissions.template_id
            # now has ON DELETE SET NULL (sql/110), so this branch is a
            # genuine defensive fallback for any future/unforeseen FK,
            # not the primary path — the point is this endpoint must
            # never surface a raw, unexplained 500 for a real,
            # deliberate delete attempt.
            raise HTTPException(
                409,
                "This template has real submission history attached and can't be permanently deleted. "
                "Use the deactivate (power) button instead — it removes it from every picker and default "
                "resolution just as effectively, while keeping the real send history intact.",
            )
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
        filename = build_resume_filename(candidate["full_name"], candidate["current_designation"], candidate["total_exp_mo"], "pdf")

        await _do_kae_submission(
            tenant_id, application_id, actor, resume_bytes,
            filename, "clean_generated",
            _RESUME_LABELS["clean_generated"],
            override_to_emails=settings["to_emails"], trigger_source="auto_screened",
        )
    except Exception as exc:
        print(f"Auto screening-team notification error (application {application_id}): {exc}")


async def _auto_submit_to_client_on_stage(tenant_id: str, application_id: str, actor: Actor):
    """Fired (best-effort, background) when a candidate is moved into a
    real, tenant-created custom stage named "client_submission" — the
    literal stage_key this tenant's own "Client Submission" stage uses.
    Mirrors _auto_notify_screening_team's exact shape (same settings-gate
    convention, same "never raise" discipline) but reuses the already-
    built KAE->Client engine (_do_client_submission) instead of duplicating
    it. Only fires in the stage's configured Automatic send mode — Manual
    mode is handled entirely by the frontend (opens the real Submit-to-
    Client review panel before the stage move commits), matching how
    every other per-stage Manual email already works in this codebase.
    Only fires for a KAE/KAM/admin/manager actor — a plain recruiter can
    still move a card into this stage, it just won't auto-email a client
    on their behalf."""
    try:
        if actor.role not in ("admin", "super_admin", "manager", "kae", "kam"):
            return
        async with db.tenant_conn(tenant_id) as conn:
            es_row = await conn.fetchrow("SELECT stage_templates FROM email_settings WHERE tenant_id=$1", tenant_id)
        stage_templates = _jsonb(es_row["stage_templates"], {}) if es_row else {}
        send_mode = (stage_templates.get("client_submission") or {}).get("send_mode", "manual")
        if send_mode != "auto":
            return  # Manual mode — the frontend's review panel handles the actual send.

        async with db.tenant_conn(tenant_id) as conn:
            row, _ = await _app_context(conn, application_id)
        if not row["client_id"]:
            return  # No client linked to this requisition — nothing to send, silently skip.
        candidate = {
            "full_name": row["full_name"], "phone": row["phone"], "email": row["email"],
            "location": row["location"], "current_employer": row["current_employer"],
            "current_designation": row["current_designation"], "total_exp_mo": row["total_exp_mo"],
            "skills": row["skills"], "resume_text": row["resume_text"],
        }
        resume_bytes = render_resume_pdf(candidate, _STYLE_CONFIGS["clean_generated"])
        filename = build_resume_filename(candidate["full_name"], candidate["current_designation"], candidate["total_exp_mo"], "pdf")

        await _do_client_submission(
            tenant_id, application_id, actor, resume_bytes,
            filename, "clean_generated",
            _RESUME_LABELS["clean_generated"],
            template_id=None, columns_override=None, hidden_columns=[],
            field_values=None, to_emails_override=None, cc_self=True, save_as_default=False,
            trigger_source="auto_client_submission",
        )
    except Exception as exc:
        print(f"Auto client-submission error (application {application_id}): {exc}")


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


def _default_client_email_text(role_title: str, contact_name: Optional[str], sender_name: Optional[str]) -> tuple[str, str]:
    """Real, editable starting point for the compose-email step (2026-09-02,
    reported live: "email mailing message should be display... compose
    email should be display before sending the email") - shared by the
    preview (so the KAE sees a real default before typing anything) and
    the actual send (as the fallback whenever no explicit override is
    typed), so the two can never quietly drift apart into two different
    wordings for the same real send."""
    greeting = f"Hi {contact_name}," if contact_name else "Hi Team,"
    subject = f"Profile Shared – {role_title}"
    body = (
        f"{greeting}\n\n"
        f"Please find the attached profile for the {role_title} position along with the updated tracking sheet.\n\n"
        f"Thanks & Regards,\n{sender_name or 'AVIIN ATS'}"
    )
    return subject, body


async def _send_kae_email(tenant_id: str, to_emails, cc_emails, subject: str,
                           body_text: str, attachments: list, body_html_extra: str = "",
                           message_id_header: str = None) -> tuple:
    """attachments: list of (filename, bytes, mime_subtype). body_html_extra,
    if given, is appended as real HTML below the plain-text intro (used for
    the inline tracking-sheet table) — the message becomes multipart/
    alternative so clients without HTML rendering still see the plain text.

    Real improvement (2026-08-19): to_emails/cc_emails now accept either a
    single string (back-compat with every existing caller) or a real
    list — needed once a submission could go to a whole screening-team
    list with multiple KAEs cc'd, not just one of each.

    message_id_header (2026-09-03 audit): when given, embedded on the real
    outgoing MIME message so a later reply's In-Reply-To genuinely matches
    what this function logs to candidate_messages — without this, every
    Submit-to-KAE/Submit-to-Client send was completely invisible to the
    real reply/bounce-correlation and Sent-folder/Mailbox-Dashboard
    tracking this project already built for every other send path."""
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
        if message_id_header:
            msg["Message-ID"] = message_id_header
        msg["From"] = f'{cfg["smtp_from_name"] or "AVIIN ATS"} <{cfg["smtp_from"] or cfg["smtp_user"]}>'
        msg["To"] = ", ".join(to_list)
        recipients = list(to_list)
        if cc_list:
            msg["Cc"] = ", ".join(cc_list)
            recipients.extend(cc_list)

        if body_html_extra:
            alt = MIMEMultipart("alternative")
            alt.attach(MIMEText(body_text, "plain"))
            # REAL FIX (2026-09-03, reported live via real Outlook desktop
            # screenshots): 2 genuine issues with every one of these real
            # sent emails, both confirmed against the actual rendered
            # message, not guessed. (1) relying on CSS white-space:
            # pre-wrap to preserve the real \n\n paragraph breaks already
            # present in body_text doesn't work in Outlook desktop - its
            # HTML rendering engine is Word's own, a well-known, long-
            # standing quirk where that CSS property is not reliably
            # respected - the real greeting/message/sign-off ran together
            # onto one crammed line with zero visible spacing. Every real
            # \n now converts to an explicit <br>, the standard, portable
            # workaround for exactly this. (2) the closing "Regards,
            # {name}" block always rendered BEFORE the tracking-sheet
            # table, sandwiched awkwardly ahead of the actual data -
            # moved to render AFTER it instead, matching both where a
            # real signature naturally belongs and the real reference
            # email the user provided as the correct example. Split on
            # the LAST genuine \n\n boundary - a structural rule, not a
            # keyword match on "Regards"/"Thanks & Regards" specifically -
            # so this holds for both this module's own real templates AND
            # any custom text a KAE actually types into the compose box;
            # if the whole message has no \n\n boundary at all, nothing
            # splits and the full text renders before the table exactly
            # as it always has, a safe, unchanged fallback.
            if "\n\n" in body_text.strip():
                message_part, _, signature_part = body_text.rpartition("\n\n")
            else:
                message_part, signature_part = body_text, ""
            def _html_lines(t: str) -> str:
                return _esc(t).replace("\n", "<br>")
            _style = "font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#0f172a;"
            html_body = f'<div style="{_style}">{_html_lines(message_part)}</div>{body_html_extra}'
            if signature_part:
                html_body += f'<div style="{_style}margin-top:14px;">{_html_lines(signature_part)}</div>'
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
        "candidate_id": str(row["candidate_id"]),
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


@router.get("/applications/{application_id}/tracking-sheet-preview")
async def tracking_sheet_preview_for_compose(application_id: str, actor: Actor = Depends(get_actor)):
    """Real, populated tracking-sheet HTML for a given application — reuses
    the exact same row-building logic (recruiter->KAE direction, sl_no
    counted the same way) as Submit-to-KAE, but read-only: never sends
    anything, never writes candidate_submissions, never bumps sl_no for
    real. Built so the general Compose tool's "Insert Tracking Sheet"
    action can drop the real, live sheet into an arbitrary email body
    without going through either dedicated send flow."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        row, auto_values = await _app_context(conn, application_id)
        template = await _resolve_template(conn, actor.tenant_id, row["client_id"], "recruiter_to_kae")
        if not template:
            raise HTTPException(400, "No tracking sheet template available — create one under Ops Settings > Templates")
        columns = _jsonb(template["columns"], [])
        # Real fix (2026-09-03, reported live): only this candidate's own
        # row, never every prior candidate re-sent into each new preview —
        # sl_no stays a real, continuing count via a lightweight COUNT.
        prior_count = await conn.fetchval(
            "SELECT count(*) FROM candidate_submissions WHERE requisition_id=$1 AND direction='recruiter_to_kae'",
            row["requisition_id"])
    sl_no = (prior_count or 0) + 1
    final_values = {**auto_values, "sl_no": str(sl_no)}
    sheet_rows = [final_values]
    tracking_html = _build_tracking_html_table(columns, sheet_rows)
    return {
        "tracking_html": tracking_html,
        "role_title": row["role_title"],
        "candidate_name": row["full_name"],
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
    KAE + tracking-sheet template, builds the real tracking sheet for
    this send, sends the email with the GIVEN resume attachment, writes
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

        # Real bug fix, found while building the KAE->Client hop: this
        # count had no direction filter at all — once a requisition had
        # BOTH recruiter->KAE and KAE->client submissions, the two
        # directions' sl_no sequences bled into each other (a
        # requisition's 1st real recruiter->KAE send could land as "SL No
        # 5" purely because 4 unrelated KAE->client sends had already
        # happened on the same requisition). Each direction is its own
        # sequence with its own independent sl_no count, matching how
        # _do_client_submission's own query was already correctly scoped
        # from the start.
        # Real fix (2026-09-03, reported live: "I do not want the system
        # to repeatedly send the same tracking sheets... to
        # mohsinkhan@aviintech.com"): a lightweight COUNT for a real,
        # continuing sl_no — not a full fetch of every prior row's
        # field_values, since the resulting sheet below now shows only
        # this candidate's own row, never re-attaching every earlier
        # candidate's data into each new email.
        prior_count = await conn.fetchval(
            "SELECT count(*) FROM candidate_submissions WHERE requisition_id=$1 AND direction='recruiter_to_kae'",
            row["requisition_id"])
        client_row = await conn.fetchrow("SELECT name FROM clients WHERE id=$1", client_id)
        recruiter_email = actor.email

    sl_no = (prior_count or 0) + 1
    overrides = {k: v for k, v in (field_values or {}).items() if v not in (None, "")}
    final_values = {**auto_values, **overrides, "sl_no": str(sl_no)}
    sheet_rows = [final_values]
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
    message_id_header = email_tracking.generate_message_id()
    email_sent, email_error = await _send_kae_email(
        tenant_id, to_recipients, cc_recipients, subject, body_text,
        [(resume_filename, resume_bytes, subtype)],
        body_html_extra=tracking_html,
        message_id_header=message_id_header,
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
        # REAL BUG FIX (2026-09-03, found investigating a live report of
        # "Sent: 0" on a real KAE's own Mailbox Dashboard despite a genuine
        # Submit-to-KAE send minutes earlier): this whole feature only ever
        # wrote to candidate_submissions, a separate table the Conversations
        # Sent folder / Mailbox Dashboard / reply-tracking system never
        # reads — every real recruiter-to-KAE send was structurally
        # invisible to all of it, regardless of volume. Internal team
        # communication, not client-facing — client_id/client_contact_id
        # stay unset; recipient_type explicit so _log()'s own default
        # ("candidate" whenever cand_id is set) doesn't wrongly imply this
        # was sent TO the candidate.
        await _log_candidate_message(
            conn, tenant_id, row["candidate_id"], application_id, "email", subject, body_text,
            "sent" if email_sent else "failed", actor.user_id,
            to_email=", ".join(to_recipients), cc=", ".join(cc_recipients) if cc_recipients else None,
            recipient_type="internal", message_id_header_override=message_id_header,
        )

        # QA sweep (2026-09-01) — real, reproduced race condition, found
        # while investigating S61's own flaky UI test: `row["stage"]` was
        # captured once, early, via _app_context() at the very top of this
        # function - BEFORE the slow, real SMTP send below it. If the
        # application's REAL stage changed during that window (a genuine,
        # observed race: the sibling client-submission automation racing
        # in parallel), this stale in-memory value could still say
        # "screened" long after the database itself had already moved on -
        # silently overwriting whatever the OTHER, more-recent transition
        # had correctly set. Fixed to a single atomic UPDATE...WHERE...
        # RETURNING that checks and captures the CURRENT database value at
        # the moment of the write, not an earlier snapshot - both closes
        # the race and stays correctly race-safe for any future concurrent
        # caller, not just this one observed case.
        bumped = False
        old_stage_at_bump = None
        if await is_valid_stage(conn, tenant_id, "submitted"):
            bump_row = await conn.fetchrow(
                """WITH prev AS (SELECT stage AS old_stage FROM applications WHERE id=$1)
                   UPDATE applications a SET stage='submitted', updated_at=now()
                   FROM prev
                   WHERE a.id=$1 AND prev.old_stage = ANY($2)
                   RETURNING prev.old_stage""",
                application_id, list(_PRE_SUBMIT_STAGES),
            )
            if bump_row:
                bumped = True
                old_stage_at_bump = bump_row["old_stage"]
                await events.write_outbox(
                    conn, tenant_id, "application.stage_changed",
                    {"application_id": application_id, "from": old_stage_at_bump, "to": "submitted", "reason": "submit_to_kae"},
                    f"application.stage_changed:{application_id}:{sub_row['sent_at'].isoformat()}",
                )

        await events.write_outbox(
            conn, tenant_id, "candidate.submitted_to_kae",
            {"application_id": application_id, "candidate_id": str(row["candidate_id"]),
             "kae_user_id": str(primary_kae["id"]) if primary_kae else None, "email_sent": email_sent},
            f"candidate.submitted_to_kae:{sub_row['id']}",
        )
        # Same stale-row["stage"] class fixed above - this audit "before"
        # snapshot needs the real value regardless of which bump branch
        # ran, so re-read it fresh here rather than trust the early one.
        audit_before_stage = old_stage_at_bump if bumped else await conn.fetchval(
            "SELECT stage FROM applications WHERE id=$1", application_id)
        await events.write_audit(
            conn, tenant_id, actor.user_id, "submit_to_kae", "application", application_id,
            before={"stage": audit_before_stage},
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
        # Manual mode lets the recruiter type a different name/designation
        # than what's on file — use what they actually typed for the
        # filename too, matching what's on the document itself. total_exp
        # stays the real, numeric candidate field regardless (the manual
        # form's own total_exp is a free-text string like "5y 2m", not
        # reliably parseable back into whole years for "NYrs").
        mr = body.manual_resume or {}
        filename = build_resume_filename(mr.get("name") or candidate["full_name"], mr.get("designation") or candidate["current_designation"], candidate["total_exp_mo"], "pdf")
    else:
        cfg = {**_STYLE_CONFIGS[body.resume_style]}
        if body.visual_theme:
            cfg["visual_theme"] = body.visual_theme
        if body.logo_position:
            cfg["logo_position"] = body.logo_position
        resume_bytes = render_resume_pdf(candidate, cfg)
        filename = build_resume_filename(candidate["full_name"], candidate["current_designation"], candidate["total_exp_mo"], "pdf")

    return await _do_kae_submission(
        actor.tenant_id, application_id, actor, resume_bytes,
        filename, body.resume_style,
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


# ══════════════════════ KAE Review Queue (2026-08-26) ══════════════════════
# When 2+ recruiters each submit their own candidate for the SAME
# requisition, the only place a KAE could previously compare them was the
# cumulative emailed tracking sheet — nothing in the app itself. These 3
# endpoints add that: a cross-role inbox (every requisition with pending
# recruiter->KAE submissions, scoped to the KAE's own clients), a per-
# requisition comparison ranked by the real, already-computed AI JD Match
# Score (candidate_scores, the same source the emailed tracking sheet's
# ai_jd_score column already used — no second scoring engine), and a
# lightweight Shortlisted/Not Selected marker. The marker is deliberately
# a SOFT signal only — it never blocks or auto-rejects the other
# candidates, since a role genuinely having 2+ real finalists is normal.

async def _kae_owned_client_ids(conn, tenant_id: str, user_id: str) -> list:
    rows = await conn.fetch(
        "SELECT client_id FROM client_owners WHERE tenant_id=$1 AND user_id=$2 AND is_active",
        tenant_id, user_id)
    return [r["client_id"] for r in rows]


@router.get("/kae/review-queue")
async def kae_review_queue(actor: Actor = Depends(require_role("admin", "super_admin", "manager", "kae", "kam"))):
    """Cross-role inbox — every requisition with at least one real
    recruiter->KAE submission, most-recent activity first. A kae/kam only
    sees requisitions on clients they actually own (client_owners) —
    admin/manager/super_admin see every requisition tenant-wide, matching
    the exemption pattern already used throughout this codebase."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        scope_clients = None
        if actor.role in ("kae", "kam"):
            scope_clients = await _kae_owned_client_ids(conn, actor.tenant_id, actor.user_id)
            if not scope_clients:
                return []
        rows = await conn.fetch(
            """WITH latest AS (
                 SELECT DISTINCT ON (cs.requisition_id, cs.candidate_id)
                   cs.requisition_id, cs.candidate_id, cs.kae_decision, cs.sent_at
                 FROM candidate_submissions cs
                 WHERE cs.tenant_id=$1 AND cs.direction='recruiter_to_kae' AND cs.requisition_id IS NOT NULL
                 ORDER BY cs.requisition_id, cs.candidate_id, cs.sent_at DESC
               )
               SELECT r.id AS requisition_id, r.title AS requisition_title, cl.name AS client_name,
                      COUNT(*)::int AS candidate_count,
                      COUNT(*) FILTER (WHERE latest.kae_decision IS NULL)::int AS undecided_count,
                      MAX(sc.readiness_index) AS top_score,
                      MAX(latest.sent_at) AS last_submission_at
               FROM latest
               JOIN requisitions r ON r.id = latest.requisition_id AND r.is_active IS NOT FALSE
               JOIN candidates cand ON cand.id = latest.candidate_id AND cand.is_active IS NOT FALSE
               LEFT JOIN clients cl ON cl.id = r.client_id
               LEFT JOIN candidate_scores sc ON sc.candidate_id = latest.candidate_id AND sc.requisition_id = latest.requisition_id
               WHERE ($2::uuid[] IS NULL OR r.client_id = ANY($2::uuid[]))
               GROUP BY r.id, r.title, cl.name
               ORDER BY last_submission_at DESC""",
            actor.tenant_id, scope_clients)
    return [dict(r) for r in rows]


@router.get("/kae/review-queue/{requisition_id}")
async def kae_review_queue_for_requisition(requisition_id: str, actor: Actor = Depends(require_role("admin", "super_admin", "manager", "kae", "kam"))):
    """The actual comparison view — every distinct candidate submitted for
    this ONE requisition (latest submission per candidate, in case of a
    resubmission), ranked by real AI JD Match Score (candidate_scores,
    correctly scoped to this exact candidate+requisition pair — never the
    tenant-wide applications.fit_score, which can be stale/cross-role)."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        req = await conn.fetchrow("SELECT id, title, client_id FROM requisitions WHERE id=$1 AND tenant_id=$2 AND is_active IS NOT FALSE", requisition_id, actor.tenant_id)
        if not req:
            raise HTTPException(404, "Requisition not found")
        if actor.role in ("kae", "kam"):
            owned = await _kae_owned_client_ids(conn, actor.tenant_id, actor.user_id)
            if not req["client_id"] or req["client_id"] not in owned:
                raise HTTPException(403, "You don't own this requisition's client")

        rows = await conn.fetch(
            """WITH latest AS (
                 SELECT DISTINCT ON (cs.candidate_id)
                   cs.id AS submission_id, cs.candidate_id, cs.sent_by, cs.sent_at,
                   cs.kae_decision, cs.kae_decision_at, cs.kae_decision_by
                 FROM candidate_submissions cs
                 WHERE cs.tenant_id=$1 AND cs.direction='recruiter_to_kae' AND cs.requisition_id=$2
                 ORDER BY cs.candidate_id, cs.sent_at DESC
               )
               SELECT latest.submission_id, latest.candidate_id, c.full_name AS candidate_name,
                      latest.sent_by, ub.full_name AS submitted_by_name, latest.sent_at,
                      latest.kae_decision, latest.kae_decision_at, kdb.full_name AS kae_decision_by_name,
                      sc.readiness_index, sc.readiness_grade, sc.skill_match_details,
                      app.stage AS current_stage, app.id AS application_id
               FROM latest
               JOIN candidates c ON c.id = latest.candidate_id AND c.is_active IS NOT FALSE
               LEFT JOIN users ub ON ub.id = latest.sent_by
               LEFT JOIN users kdb ON kdb.id = latest.kae_decision_by
               LEFT JOIN candidate_scores sc ON sc.candidate_id = latest.candidate_id AND sc.requisition_id=$2
               LEFT JOIN LATERAL (
                   SELECT id, stage FROM applications
                   WHERE candidate_id = latest.candidate_id AND requisition_id=$2 AND is_active IS NOT FALSE
                   ORDER BY updated_at DESC LIMIT 1
               ) app ON true
               ORDER BY sc.readiness_index DESC NULLS LAST, latest.sent_at""",
            actor.tenant_id, requisition_id)

    out = []
    for r in rows:
        d = dict(r)
        details = _jsonb(d.pop("skill_match_details"), {})
        d["matched_skills"] = details.get("keyword_matched_skills") or []
        d["missing_skills"] = details.get("keyword_missing_skills") or []
        out.append(d)
    return {"requisition_id": req["id"], "requisition_title": req["title"], "candidates": out}


class KaeDecisionIn(BaseModel):
    decision: Optional[str] = None  # 'shortlisted' | 'not_selected' | null (clear)


@router.patch("/candidate-submissions/{submission_id}/decision")
async def set_kae_decision(submission_id: str, body: KaeDecisionIn, actor: Actor = Depends(require_role("admin", "super_admin", "manager", "kae", "kam"))):
    if body.decision not in (None, "shortlisted", "not_selected"):
        raise HTTPException(400, "decision must be 'shortlisted', 'not_selected', or null")
    async with db.tenant_conn(actor.tenant_id) as conn:
        before = await conn.fetchrow(
            "SELECT kae_decision, candidate_id, requisition_id FROM candidate_submissions WHERE id=$1 AND tenant_id=$2 AND direction='recruiter_to_kae'",
            submission_id, actor.tenant_id)
        if not before:
            raise HTTPException(404, "Submission not found")
        row = await conn.fetchrow(
            """UPDATE candidate_submissions
               SET kae_decision=$1,
                   kae_decision_at=CASE WHEN $1::text IS NULL THEN NULL ELSE now() END,
                   kae_decision_by=CASE WHEN $1::text IS NULL THEN NULL ELSE $2::uuid END
               WHERE id=$3 AND tenant_id=$4
               RETURNING *""",
            body.decision, actor.user_id, submission_id, actor.tenant_id)
        await events.write_audit(
            conn, actor.tenant_id, actor.user_id, "kae_decision", "candidate_submission", submission_id,
            before={"kae_decision": before["kae_decision"]},
            after={"kae_decision": body.decision, "candidate_id": str(before["candidate_id"]), "requisition_id": str(before["requisition_id"]) if before["requisition_id"] else None},
        )
    return dict(row)


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
async def list_client_contacts(client_id: str, actor: Actor = Depends(get_actor)):
    # REAL BUG FIX (2026-09-02): was hard-gated on companies:read — a
    # KAE/KAM with no such grant couldn't see even their OWN assigned
    # client's SPOCs at all (the "No client contact configured" warning
    # in Submit to Client, and an empty SPOC list on Companies, for
    # someone who genuinely has SPOCs assigned to them). Now scopes to
    # the caller's own assigned SPOCs for kae/kam instead of blocking.
    async with db.tenant_conn(actor.tenant_id) as conn:
        if await has_permission_soft(conn, actor, "companies", "read", route=f"GET /clients/{client_id}/contacts"):
            rows = await _resolve_client_contacts(conn, actor.tenant_id, client_id)
        elif actor.role in ("kae", "kam"):
            rows = await _resolve_client_contacts(conn, actor.tenant_id, client_id, kae_user_id=actor.user_id)
        else:
            raise HTTPException(403, f"Your role ('{actor.role}') does not have 'read' access to 'companies'")
    return [dict(r) for r in rows]


class ClientContactIn(BaseModel):
    contact_name: str
    email: str
    role_label: Optional[str] = None
    is_primary: bool = False


@router.post("/clients/{client_id}/contacts", status_code=201)
async def create_client_contact(client_id: str, body: ClientContactIn, actor: Actor = Depends(get_actor)):
    # REAL FEATURE (2026-09-02, reported live): a KAE is very often the
    # first person to actually learn a new SPOC's contact details — this
    # now lets them add one for a client they're genuinely assigned to
    # (client_owners), not just admin/manager. The KAE who adds it is
    # auto-assigned to it (they added it, they can use it immediately);
    # extending that visibility to other KAEs on the same client is a
    # separate, explicit admin action (PUT .../kae-assignments below),
    # matching the real "admin controls who sees which SPOC" requirement.
    async with db.tenant_conn(actor.tenant_id) as conn:
        can_manage = await has_permission_soft(conn, actor, "companies", "update", route=f"POST /clients/{client_id}/contacts")
        is_kae = actor.role in ("kae", "kam")
        if not can_manage and not is_kae:
            raise HTTPException(403, f"Your role ('{actor.role}') does not have 'update' access to 'companies'")
        exists = await conn.fetchval("SELECT 1 FROM clients WHERE id=$1 AND tenant_id=$2", client_id, actor.tenant_id)
        if not exists:
            raise HTTPException(404, "Client not found")
        if is_kae and not can_manage:
            owns = await conn.fetchval(
                "SELECT 1 FROM client_owners WHERE tenant_id=$1 AND client_id=$2 AND user_id=$3 AND is_active",
                actor.tenant_id, client_id, actor.user_id)
            if not owns:
                raise HTTPException(403, "You can only add a SPOC for a client you're assigned to")
        if body.is_primary:
            await conn.execute(
                "UPDATE client_contacts SET is_primary=false WHERE tenant_id=$1 AND client_id=$2",
                actor.tenant_id, client_id)
        row = await conn.fetchrow(
            """INSERT INTO client_contacts (tenant_id, client_id, contact_name, email, role_label, is_primary, created_by)
               VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *""",
            actor.tenant_id, client_id, body.contact_name, body.email, body.role_label, body.is_primary, actor.user_id)
        if is_kae and not can_manage:
            await conn.execute(
                """INSERT INTO client_contact_kae_assignments (tenant_id, client_contact_id, kae_user_id, assigned_by)
                   VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING""",
                actor.tenant_id, row["id"], actor.user_id, actor.user_id)
    return dict(row)


@router.put("/client-contacts/{contact_id}")
async def update_client_contact(contact_id: str, body: ClientContactIn, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        existing = await conn.fetchrow(
            "SELECT client_id FROM client_contacts WHERE id=$1 AND tenant_id=$2", contact_id, actor.tenant_id)
        if not existing:
            raise HTTPException(404, "Contact not found")
        can_manage = await has_permission_soft(conn, actor, "companies", "update", route=f"PUT /client-contacts/{contact_id}")
        if not can_manage:
            if actor.role in ("kae", "kam"):
                assigned = await conn.fetchval(
                    "SELECT 1 FROM client_contact_kae_assignments WHERE tenant_id=$1 AND client_contact_id=$2 AND kae_user_id=$3",
                    actor.tenant_id, contact_id, actor.user_id)
                if not assigned:
                    raise HTTPException(403, "You can only edit a SPOC assigned to you")
            else:
                raise HTTPException(403, f"Your role ('{actor.role}') does not have 'update' access to 'companies'")
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


@router.get("/client-contacts/{contact_id}/kae-assignments")
async def list_contact_kae_assignments(contact_id: str, actor: Actor = Depends(require_permission("companies", "read"))):
    """Which KAEs can currently see/use this one SPOC — powers the admin-
    facing "Visible to" picker on the Companies page's SPOC panel."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            """SELECT ka.kae_user_id, u.full_name, u.email
               FROM client_contact_kae_assignments ka
               JOIN users u ON u.id = ka.kae_user_id
               WHERE ka.tenant_id=$1 AND ka.client_contact_id=$2 AND u.is_active IS NOT FALSE
               ORDER BY u.full_name""",
            actor.tenant_id, contact_id)
    return [dict(r) for r in rows]


class KaeAssignmentsIn(BaseModel):
    kae_user_ids: list[str]


@router.put("/client-contacts/{contact_id}/kae-assignments")
async def set_contact_kae_assignments(contact_id: str, body: KaeAssignmentsIn, actor: Actor = Depends(require_permission("companies", "update"))):
    # Real business-admin action (who is allowed to see and use this
    # SPOC), same bar as every other client_owners/visibility write in
    # this codebase — a full-replace of the assignment set, not a diff,
    # matching this project's established "small child list, full
    # replace" convention (e.g. candidate_skill_experience PUT).
    if actor.role not in ("admin", "super_admin", "manager"):
        raise HTTPException(403, "Assigning SPOC visibility requires manager/admin role")
    async with db.tenant_conn(actor.tenant_id) as conn:
        exists = await conn.fetchval("SELECT client_id FROM client_contacts WHERE id=$1 AND tenant_id=$2", contact_id, actor.tenant_id)
        if not exists:
            raise HTTPException(404, "Contact not found")
        async with conn.transaction():
            await conn.execute(
                "DELETE FROM client_contact_kae_assignments WHERE tenant_id=$1 AND client_contact_id=$2",
                actor.tenant_id, contact_id)
            for uid in body.kae_user_ids:
                await conn.execute(
                    """INSERT INTO client_contact_kae_assignments (tenant_id, client_contact_id, kae_user_id, assigned_by)
                       VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING""",
                    actor.tenant_id, contact_id, uid, actor.user_id)
        rows = await conn.fetch(
            """SELECT ka.kae_user_id, u.full_name, u.email
               FROM client_contact_kae_assignments ka JOIN users u ON u.id = ka.kae_user_id
               WHERE ka.tenant_id=$1 AND ka.client_contact_id=$2""",
            actor.tenant_id, contact_id)
    return [dict(r) for r in rows]


async def _client_tracking_sheet_rows(conn, tenant_id: str, requisition_id: str, auto_values: dict,
                                       hidden_columns: Optional[list] = None):
    """The real per-send sheet — the row this preview/send represents,
    and ONLY that row. Real bug fix (2026-09-03, reported live): this
    used to re-attach every historical candidate's full row into every
    new email ("I do not want the system to repeatedly send the same
    tracking sheets to the client... Send only the tracking sheet
    related to the current candidate(s) being submitted"), which is what
    the cumulative design shipped 2026-07-29 always intended for the
    inbox-side reading experience but not for what actually lands in a
    fresh email every time. sl_no stays a real, continuing count (the
    client can still tell this is the Nth candidate submitted for this
    role over time) via a lightweight COUNT rather than re-fetching every
    prior row's field_values just to throw them away. Shared by the real
    send (_do_client_submission) and the read-only live preview below,
    so a KAE reviewing the sheet before sending sees EXACTLY what will
    actually go out, not an approximation."""
    prior_count = await conn.fetchval(
        "SELECT count(*) FROM candidate_submissions WHERE requisition_id=$1 AND direction='kae_to_client'",
        requisition_id)
    sl_no = (prior_count or 0) + 1
    final_values = {**auto_values, "sl_no": str(sl_no)}
    sheet_rows = [final_values]
    hidden_set = set(hidden_columns or [])
    merge_rows = ([{k: ("" if k in hidden_set else v) for k, v in r.items()} for r in sheet_rows]
                  if hidden_set else sheet_rows)
    return sheet_rows, merge_rows, sl_no


@router.get("/applications/{application_id}/submit-to-client/preview")
async def submit_to_client_preview(
    application_id: str,
    contact_id: Optional[str] = None,
    actor: Actor = Depends(require_role("admin", "super_admin", "manager", "kae", "kam")),
):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row, auto_values = await _app_context(conn, application_id)
        # REAL BUG FIX (2026-09-02, reported live): a KAE only ever saw
        # every SPOC on the client regardless of what an admin actually
        # assigned them — this is the real send/preview path, so the same
        # scoping applied to the Companies-page contact list has to apply
        # here too, or the "view only what's assigned to you" rule would
        # be enforceable in the UI but bypassable via this endpoint.
        kae_scope = actor.user_id if actor.role in ("kae", "kam") else None
        contacts = await _resolve_client_contacts(conn, actor.tenant_id, row["client_id"], kae_user_id=kae_scope)
        primary_contact = next((c for c in contacts if c["is_primary"]), None)
        # `contact_id`, when the caller has already picked a specific
        # SPOC (not just accepted the primary), is what a SPOC-level
        # template default actually resolves against — falls back to the
        # primary contact so the very first load (before any explicit
        # pick) still resolves correctly.
        scope_contact_id = contact_id or (primary_contact["id"] if primary_contact else None)
        template = await _resolve_template(
            conn, actor.tenant_id, row["client_id"], "kae_to_client",
            client_contact_id=scope_contact_id, requisition_id=row["requisition_id"])
        # REAL BUG FIX (2026-09-02, reported live): this listing had the
        # exact same "includes templates pinned to a soft-deleted client"
        # clutter as GET /submission-templates, independently, since it's
        # a separate inline query — this IS the query behind the picker
        # in the reported screenshot showing dozens of stray "QA S54
        # Client ..." rows. Same is_active-on-client filter, plus the
        # SPOC/requisition names so the picker can show what each
        # template is actually pinned to.
        templates = await conn.fetch(
            """SELECT tst.id, tst.name, tst.client_id, tst.client_contact_id, tst.requisition_id,
                      tst.is_default, tst.template_type, tst.file_name, cl.name AS client_name,
                      cc.contact_name AS spoc_name, r.title AS requisition_title
               FROM tracking_sheet_templates tst
               LEFT JOIN clients cl ON cl.id = tst.client_id
               LEFT JOIN client_contacts cc ON cc.id = tst.client_contact_id
               LEFT JOIN requisitions r ON r.id = tst.requisition_id
               WHERE tst.tenant_id=$1 AND tst.direction='kae_to_client' AND tst.is_active
                 AND (tst.client_id IS NULL OR cl.is_active IS NOT FALSE)
               ORDER BY tst.is_default DESC, tst.name""",
            actor.tenant_id)
        # REAL FEATURE (2026-09-02, reported live: "Tracking sheet should
        # be visible and display with TABLE sheet with all details to
        # review before sharing with the client"): the modal previously
        # only ever showed template NAME buttons with no way to see what
        # the actual populated sheet contains — this is the real, live
        # table (same data + same row-building logic the real send
        # uses), rendered for whichever template just resolved above.
        tracking_html = None
        tracking_columns = None
        tracking_rows = None
        if template:
            columns = _jsonb(template["columns"], [])
            sheet_rows, _, _ = await _client_tracking_sheet_rows(conn, actor.tenant_id, row["requisition_id"], auto_values)
            tracking_html = _build_tracking_html_table(columns, sheet_rows)
            # REAL FEATURE (2026-09-02, reported live: "keep the option to
            # editable in the tracking sheet") — structured columns/rows
            # alongside the pre-rendered HTML, so the frontend can render
            # the LAST row (the one this send actually represents, still
            # unset at this point) as real, editable inputs bound to the
            # already-tracked `fields` state, while every earlier row
            # (a genuine already-sent submission — an honest audit record,
            # never rewritten) stays plain, read-only text.
            tracking_columns = columns
            tracking_rows = sheet_rows
        prior_count = await conn.fetchval(
            "SELECT count(*) FROM candidate_submissions WHERE requisition_id=$1 AND direction='kae_to_client'",
            row["requisition_id"])
        # REAL GAP FIX (2026-09-02, reported live): the Submit-to-Client
        # panel never showed WHICH client a candidate was being submitted
        # to anywhere — real, previously-missing context for the reviewer.
        client_name = None
        if row["client_id"]:
            client_name = await conn.fetchval("SELECT name FROM clients WHERE id=$1", row["client_id"])
        # REAL FEATURE (2026-09-02, reported live: "compose email should
        # be display before sending the email") — a real, honest default
        # subject/body, shown editable in the modal before Send, not a
        # backend-only string the KAE never sees until it's already gone.
        default_subject, default_body = _default_client_email_text(
            row["role_title"], primary_contact["contact_name"] if primary_contact else None, actor.full_name)
    return {
        "candidate_id": str(row["candidate_id"]),
        "requisition_id": str(row["requisition_id"]) if row["requisition_id"] else None,
        "client_id": str(row["client_id"]) if row["client_id"] else None,
        "client_name": client_name,
        "primary_contact": dict(primary_contact) if primary_contact else None,
        "contacts": [dict(c) for c in contacts],
        "resolved_template": _template_out(template) if template else None,
        "templates": [_template_out(t) for t in templates],
        "tracking_html": tracking_html,
        "columns": tracking_columns,
        "rows": tracking_rows,
        "default_subject": default_subject,
        "default_body": default_body,
        "auto_values": {**auto_values, "sl_no": str((prior_count or 0) + 1)},
        "has_resume_text": bool((row["resume_text"] or "").strip()),
        "stage": row["stage"],
    }


@router.get("/applications/{application_id}/submit-to-client/tracking-preview")
async def submit_to_client_tracking_preview(
    application_id: str,
    template_id: Optional[str] = None,
    contact_id: Optional[str] = None,
    hidden_columns: Optional[str] = None,
    actor: Actor = Depends(require_role("admin", "super_admin", "manager", "kae", "kam")),
):
    """Re-render the real, live tracking table whenever the KAE changes
    which template/SPOC is selected or toggles a hidden column — called
    on-change from the modal, separate from the main preview endpoint so
    picking a different template doesn't re-fetch everything else
    (contacts, resume text, etc). hidden_columns is a comma-separated
    list, matching how a plain GET query param carries a list most
    simply."""
    hidden_list = [h for h in (hidden_columns or "").split(",") if h]
    async with db.tenant_conn(actor.tenant_id) as conn:
        row, auto_values = await _app_context(conn, application_id)
        template = None
        if template_id:
            template = await conn.fetchrow(
                "SELECT * FROM tracking_sheet_templates WHERE id=$1 AND tenant_id=$2 AND direction='kae_to_client'",
                template_id, actor.tenant_id)
            if not template:
                raise HTTPException(404, "Tracking sheet template not found")
        else:
            kae_scope = actor.user_id if actor.role in ("kae", "kam") else None
            contacts = await _resolve_client_contacts(conn, actor.tenant_id, row["client_id"], kae_user_id=kae_scope)
            primary_contact = next((c for c in contacts if c["is_primary"]), None)
            scope_contact_id = contact_id or (primary_contact["id"] if primary_contact else None)
            template = await _resolve_template(
                conn, actor.tenant_id, row["client_id"], "kae_to_client",
                client_contact_id=scope_contact_id, requisition_id=row["requisition_id"])
        if not template:
            raise HTTPException(400, "No client tracking sheet template available")
        columns = _jsonb(template["columns"], [])
        visible_columns = [c for c in columns if c["key"] not in hidden_list]
        sheet_rows, _, _ = await _client_tracking_sheet_rows(
            conn, actor.tenant_id, row["requisition_id"], auto_values, hidden_list)
    return {
        "tracking_html": _build_tracking_html_table(visible_columns, sheet_rows),
        # Same real structured columns/rows as the main preview endpoint —
        # this is the on-change refetch (template/SPOC/hidden-column
        # picked differently), so the frontend's editable last row needs
        # a fresh set of columns here too, not just on first load.
        "columns": visible_columns,
        "rows": sheet_rows,
        "row_count": len(sheet_rows),
        "template_type": template["template_type"],
        "file_name": template["file_name"],
    }


class SubmitToClientIn(BaseModel):
    template_id: Optional[str] = None
    contact_id: Optional[str] = None
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
    # REAL FEATURE (2026-09-02): which scope "save as default" pins to —
    # 'client' (every SPOC/project for this client, the original, still-
    # default behavior), 'contact' (this one SPOC only), or 'requisition'
    # (this one project/role only).
    default_scope: str = "client"
    # REAL FEATURE (2026-09-02, reported live: "compose email should be
    # display before sending the email") — the KAE's own edited subject/
    # message, shown pre-filled with a real default in the modal and
    # freely editable before Send. Falls back to the same honest default
    # (_default_client_email_text) when left blank, never silently sends
    # something the KAE never saw.
    email_subject: Optional[str] = None
    email_body: Optional[str] = None


async def _do_client_submission(
    tenant_id: str, application_id: str, actor: Actor,
    resume_bytes: bytes, resume_filename: str, resume_style: str, resume_style_label: str,
    template_id: Optional[str], columns_override: Optional[list], hidden_columns: list,
    field_values: Optional[dict], to_emails_override: Optional[list], cc_self: bool, save_as_default: bool,
    trigger_source: str = "manual", contact_id: Optional[str] = None, default_scope: str = "client",
    subject_override: Optional[str] = None, body_override: Optional[str] = None,
) -> dict:
    """The KAE->Client hop: mirrors _do_kae_submission's shape (same
    _app_context, same resume attachment, same audit/outbox discipline) but
    resolves a client contact (not a KAE) as the recipient, a
    direction='kae_to_client' template, and supports three real,
    independent edits a KAE can make before sending without ever silently
    mutating an unrelated saved default:
      - hidden_columns: ALWAYS one-time — recorded on this submission row
        for audit, never written back to the template, regardless of
        save_as_default.
      - columns_override: the effective column list for THIS send. Only
        persisted if save_as_default=True, and even then only ever written
        to a template pinned to the scope default_scope names (client,
        this one SPOC, or this one requisition) — never a broader/
        narrower scope's default.
      - contact_id: which SPOC to address (and, when saving a default,
        which SPOC to scope it to) — falls back to the primary contact
        when not explicitly chosen."""
    async with db.tenant_conn(tenant_id) as conn:
        row, auto_values = await _app_context(conn, application_id)
        client_id = row["client_id"]
        if not client_id:
            raise HTTPException(400, "This requisition has no client linked — cannot resolve a recipient")
        # Same real "only the SPOCs this KAE was actually assigned" scope
        # as the preview endpoint — applies to the automated auto-screened
        # trigger too, but ONLY when that trigger's actor is genuinely a
        # kae/kam (an admin/manager/recruiter-driven auto-submit keeps
        # seeing every SPOC on the client, unchanged).
        kae_scope = actor.user_id if actor.role in ("kae", "kam") else None
        contacts = await _resolve_client_contacts(conn, tenant_id, client_id, kae_user_id=kae_scope)
        # REAL BUG (found via genuine testing, not code review):
        # c["id"] comes back from asyncpg as a native uuid.UUID object,
        # never equal to the plain string contact_id from the request
        # body via `==` — a real, explicit contact_id was silently
        # treated as "not found," falling through to the misleading "No
        # client contact is configured" error even with contacts on
        # file. Compared as strings on both sides.
        primary_contact = next((c for c in contacts if str(c["id"]) == str(contact_id)), None) if contact_id else (contacts[0] if contacts else None)
        if not to_emails_override and not primary_contact:
            raise HTTPException(400, "No client contact is configured — add one under Companies > this client > Contacts")
        scope_contact_id = primary_contact["id"] if primary_contact else None

        template = None
        if template_id:
            template = await conn.fetchrow(
                "SELECT * FROM tracking_sheet_templates WHERE id=$1 AND tenant_id=$2 AND direction='kae_to_client'",
                template_id, tenant_id)
            if not template:
                raise HTTPException(404, "Tracking sheet template not found")
        else:
            template = await _resolve_template(
                conn, tenant_id, client_id, "kae_to_client",
                client_contact_id=scope_contact_id, requisition_id=row["requisition_id"])
        if not template and not columns_override:
            raise HTTPException(400, "No client tracking sheet template available — create one under Ops Settings > Templates")
        columns = columns_override if columns_override else _jsonb(template["columns"], [])
        visible_columns = [c for c in columns if c["key"] not in (hidden_columns or [])]

        client_row = await conn.fetchrow("SELECT name FROM clients WHERE id=$1", client_id)
        recruiter_email = actor.email

        # REAL BUG (found via genuine testing, not code review, while
        # investigating an unrelated delete-fix on 2026-09-03): the final
        # candidate_submissions row always recorded whichever template was
        # resolved BEFORE save_as_default ran (template["id"]) — the two
        # `template_id = template_id or str(...)` reassignments below this
        # comment used to update the function's own `template_id`
        # PARAMETER, which nothing downstream ever reads again (the real
        # INSERT used `template["id"]` directly), so saving a genuinely
        # NEW client/SPOC/project-scoped default silently mis-attributed
        # that very submission to the OLD, broader template instead of the
        # new, more specific one it was actually configured to use.
        # used_template_id is the real, single source of truth for what
        # this send used, correctly updated by both save-as-default
        # branches and read by the INSERT below.
        used_template_id = template["id"] if template else None

        if save_as_default and columns_override:
            # Real scope tuple this save targets — matches _resolve_
            # template()/_unset_other_defaults()'s own tiering exactly, so
            # a 'contact'-scoped save can never silently clobber (or get
            # silently found instead of) the client-wide default.
            scope_requisition_id = row["requisition_id"] if default_scope == "requisition" else None
            scope_client_contact_id = scope_contact_id if default_scope == "contact" else None
            if default_scope == "requisition":
                existing_scoped_default = await conn.fetchrow(
                    """SELECT id FROM tracking_sheet_templates
                       WHERE tenant_id=$1 AND requisition_id=$2 AND direction='kae_to_client' AND is_default""",
                    tenant_id, scope_requisition_id)
                scope_label = f"{row['role_title'] or 'Role'} — Project Tracking Sheet"
            elif default_scope == "contact":
                existing_scoped_default = await conn.fetchrow(
                    """SELECT id FROM tracking_sheet_templates
                       WHERE tenant_id=$1 AND client_contact_id=$2 AND direction='kae_to_client' AND is_default""",
                    tenant_id, scope_client_contact_id)
                scope_label = f"{primary_contact['contact_name'] if primary_contact else 'SPOC'} — SPOC Tracking Sheet"
            else:
                existing_scoped_default = await conn.fetchrow(
                    """SELECT id FROM tracking_sheet_templates
                       WHERE tenant_id=$1 AND client_id=$2 AND direction='kae_to_client' AND is_default
                         AND client_contact_id IS NULL AND requisition_id IS NULL""",
                    tenant_id, client_id)
                scope_label = f"{client_row['name'] if client_row else 'Client'} — Client Tracking Sheet"
            if existing_scoped_default:
                await conn.execute(
                    "UPDATE tracking_sheet_templates SET columns=$1, updated_at=now() WHERE id=$2",
                    json.dumps(columns_override), existing_scoped_default["id"])
                used_template_id = existing_scoped_default["id"]
            else:
                await _unset_other_defaults(conn, tenant_id, client_id, "kae_to_client",
                                             client_contact_id=scope_client_contact_id, requisition_id=scope_requisition_id)
                new_tpl = await conn.fetchrow(
                    """INSERT INTO tracking_sheet_templates
                         (tenant_id, client_id, client_contact_id, requisition_id, name, columns, is_default, direction, created_by)
                       VALUES ($1,$2,$3,$4,$5,$6,true,'kae_to_client',$7) RETURNING id""",
                    tenant_id, client_id, scope_client_contact_id, scope_requisition_id,
                    scope_label, json.dumps(columns_override), actor.user_id)
                used_template_id = new_tpl["id"]

        sheet_rows, merge_rows, sl_no = await _client_tracking_sheet_rows(
            conn, tenant_id, row["requisition_id"], auto_values, hidden_columns)

    overrides = {k: v for k, v in (field_values or {}).items() if v not in (None, "")}
    # sl_no is always system-computed, never an editable override — this
    # matches _do_kae_submission's own sibling logic exactly, guarding
    # against a stray "sl_no" key in field_values (never expected, but
    # never allowed to win either).
    final_values = {**sheet_rows[-1], **overrides, "sl_no": sheet_rows[-1]["sl_no"]}
    sheet_rows[-1] = final_values
    # Hidden columns must never leak into ANY output for this send — not
    # just the inline table. A file-template merge (xlsx/docx) reads
    # straight from a row dict by key, so the real fix is blanking the
    # hidden keys out of the dict itself before it ever reaches the merge
    # engine, not just filtering which columns get *listed*.
    hidden_set = set(hidden_columns or [])
    if hidden_set:
        merge_rows[-1] = {k: ("" if k in hidden_set else v) for k, v in final_values.items()}

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
        contact_name_for_greeting = None
    else:
        to_recipients = [primary_contact["email"]]
        # REAL BUG FIX (2026-09-02): this used to assume the "to" contact
        # was always contacts[0] (true before contact_id existed, since
        # the primary contact was the only one ever chosen) — now that a
        # caller can explicitly pick a non-primary SPOC via contact_id,
        # CC must exclude whichever contact actually ended up as "to",
        # not just the first one, or that same person would be listed as
        # both To and Cc on the real sent email.
        cc_recipients = [c["email"] for c in contacts if c["id"] != primary_contact["id"] and c["email"]] + \
                         ([recruiter_email] if cc_self and recruiter_email else [])
        contact_name_for_greeting = primary_contact["contact_name"]

    # Real wording match (2026-08-25) — the tenant's own requested exact
    # format ("Hi [Client Name], Please find the attached profile for the
    # [Role Name] position along with the updated tracking sheet. Thanks &
    # Regards, [Your Name]"), now via the same shared helper the preview
    # endpoint uses to show this exact text before Send (2026-09-02,
    # reported live: "compose email should be display before sending") —
    # subject_override/body_override (whatever the KAE actually typed in
    # the compose box, blank or not) always wins over this honest default.
    default_subject, default_body = _default_client_email_text(
        row["role_title"], contact_name_for_greeting, actor.full_name)
    subject = (subject_override or "").strip() or default_subject
    body_text = (body_override or "").strip() or default_body
    message_id_header = email_tracking.generate_message_id()
    email_sent, email_error = await _send_kae_email(
        tenant_id, to_recipients, cc_recipients, subject, body_text, attachments,
        body_html_extra=body_html_extra,
        message_id_header=message_id_header,
    )

    async with db.tenant_conn(tenant_id) as conn:
        sub_row = await conn.fetchrow(
            """INSERT INTO candidate_submissions
                 (tenant_id, application_id, candidate_id, requisition_id, client_id, template_id,
                  resume_style, field_values, recipient_emails, to_emails, status, error_message, sent_by,
                  direction, hidden_columns, recipient_contact_id, trigger_source)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'kae_to_client',$14,$15,$16) RETURNING *""",
            tenant_id, application_id, row["candidate_id"], row["requisition_id"], client_id,
            used_template_id, resume_style, json.dumps(final_values),
            list(dict.fromkeys(to_recipients + cc_recipients)), to_recipients,
            "sent" if email_sent else "failed", email_error, actor.user_id,
            hidden_columns or [], primary_contact["id"] if (primary_contact and not to_emails_override) else None,
            trigger_source,
        )
        # REAL BUG FIX (2026-09-03, same root cause as the sibling
        # recruiter-to-KAE fix above): a genuinely client-facing send is
        # even more consequential to have invisible — client_id/
        # client_contact_id ARE set here (this is exactly the kind of real
        # send the Client Health / SLA / engagement-score tracking built
        # earlier the same day is meant to measure), and threading a real
        # Message-ID through means a client's real reply now correlates
        # back correctly too, not just the send itself becoming visible.
        await _log_candidate_message(
            conn, tenant_id, row["candidate_id"], application_id, "email", subject, body_text,
            "sent" if email_sent else "failed", actor.user_id,
            to_email=", ".join(to_recipients), cc=", ".join(cc_recipients) if cc_recipients else None,
            client_id=client_id,
            client_contact_id=primary_contact["id"] if (primary_contact and not to_emails_override) else None,
            recipient_type="client", message_id_header_override=message_id_header,
        )

        await events.write_outbox(
            conn, tenant_id, "candidate.submitted_to_client",
            {"application_id": application_id, "candidate_id": str(row["candidate_id"]),
             "client_id": str(client_id), "email_sent": email_sent},
            f"candidate.submitted_to_client:{sub_row['id']}",
        )
        # Same stale-row["stage"] class fixed below (the actual bump
        # logic) - re-read fresh rather than trust the early snapshot.
        _audit_before_stage = await conn.fetchval("SELECT stage FROM applications WHERE id=$1", application_id)
        await events.write_audit(
            conn, tenant_id, actor.user_id, "submit_to_client", "application", application_id,
            before={"stage": _audit_before_stage},
            after={"to": to_recipients, "cc": cc_recipients, "resume_style": resume_style,
                   "email_sent": email_sent, "sl_no": sl_no, "hidden_columns": hidden_columns,
                   "saved_as_default": bool(save_as_default and columns_override)},
        )

        # Real automation (2026-08-26): once the real client-facing send
        # completes, the application automatically advances to "Submitted"
        # — mirroring _do_kae_submission's own bump-to-submitted above,
        # just for the client hop, and only from a genuine pre-submission
        # stage (never regresses/errors on a candidate already further
        # along, e.g. already at l1_interview). Real pipeline_movements +
        # candidate_activities rows too, matching update_stage()'s own
        # convention, so this shows up correctly in the Pipeline Audit Log
        # / Activity Timeline / stage-conversion analytics — not just the
        # event outbox.
        # QA sweep (2026-09-01) — real, reproduced race condition (same
        # root cause + same fix as _do_kae_submission's own bump above):
        # `row["stage"]` was captured once, early, before the slow, real
        # SMTP send in this function — a stale in-memory snapshot that
        # could silently disagree with the database's real, current value
        # by the time this UPDATE runs, especially with the sibling
        # recruiter->KAE automation (_auto_notify_screening_team) racing
        # in parallel on the exact same application (both fire from real,
        # legitimate stage transitions). Confirmed live: reproduced this
        # exact race via the real API — moving an application to
        # "screened" (firing the KAE automation in the background) then
        # immediately calling this real submit-to-client flow correctly
        # bumped to "submitted" at first, but the KAE automation's own
        # SLOWER, stale-data bump then silently raced in afterward.
        # Same fix: one atomic UPDATE...WHERE...RETURNING checking and
        # capturing the CURRENT database value at write time.
        bumped = False
        old_stage_at_bump = None
        if await is_valid_stage(conn, tenant_id, "submitted"):
            bump_row = await conn.fetchrow(
                """WITH prev AS (SELECT stage AS old_stage FROM applications WHERE id=$1)
                   UPDATE applications a SET stage='submitted', updated_at=now()
                   FROM prev
                   WHERE a.id=$1 AND prev.old_stage = ANY($2)
                   RETURNING prev.old_stage""",
                application_id, list(_PRE_SUBMIT_CLIENT_STAGES),
            )
            if bump_row:
                bumped = True
                old_stage_at_bump = bump_row["old_stage"]
                await events.write_outbox(
                    conn, tenant_id, "application.stage_changed",
                    {"application_id": application_id, "from": old_stage_at_bump, "to": "submitted", "reason": "submit_to_client"},
                    f"application.stage_changed:{application_id}:{sub_row['sent_at'].isoformat()}",
                )
                await conn.execute(
                    """INSERT INTO pipeline_movements
                         (tenant_id, candidate_id, application_id, stage_from, stage_to, reason, triggered_by)
                       VALUES ($1,$2,$3,$4,'submitted','submit_to_client',$5)""",
                    tenant_id, row["candidate_id"], application_id, old_stage_at_bump,
                    str(actor.user_id) if actor.user_id else "system",
                )
                await conn.execute(
                    """INSERT INTO candidate_activities
                         (tenant_id, candidate_id, user_id, activity_type, title, description)
                       VALUES ($1,$2,$3,'status_change','Stage changed',$4)""",
                    tenant_id, row["candidate_id"], actor.user_id,
                    f"{old_stage_at_bump.replace('_',' ').title()} → Submitted",
                )

    # Unlike the internal recruiter->KAE bump above, THIS transition is
    # genuinely candidate-facing (the candidate really has now been
    # submitted to the client) — the user's explicit ask was for the
    # real "Submitted" stage default email to actually reach the
    # candidate, not just move the card silently. Fires the same real
    # notification path every other stage change uses (email + WhatsApp,
    # consent-gated, tenant-template-aware) — best-effort, outside the
    # tenant_conn block since it opens its own connection and must never
    # be able to take the actual client send down with it if it fails.
    if bumped and row["email"]:
        try:
            from routers.applications import _notify_stage_change_bg
            asyncio.create_task(_notify_stage_change_bg(
                row["candidate_id"], "submitted", row["email"], row["full_name"], tenant_id,
                requisition_id=row["requisition_id"], application_id=application_id,
            ))
        except Exception as _ex:
            print(f"Submitted-stage candidate notification dispatch error: {_ex}")

    out = dict(sub_row)
    out["field_values"] = _jsonb(out["field_values"], {})
    out["email_sent"] = email_sent
    out["email_error"] = email_error
    out["recipient_name"] = primary_contact["contact_name"] if (primary_contact and not to_emails_override) else "Client/KAM"
    out["stage_bumped_to_submitted"] = bumped
    return out


@router.post("/applications/{application_id}/submit-to-client")
async def submit_to_client(
    application_id: str, body: SubmitToClientIn,
    actor: Actor = Depends(require_role("admin", "super_admin", "manager", "kae", "kam")),
):
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
    if body.default_scope not in ("client", "contact", "requisition"):
        raise HTTPException(400, "default_scope must be one of ('client', 'contact', 'requisition')")

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
        mr = body.manual_resume or {}
        filename = build_resume_filename(mr.get("name") or candidate["full_name"], mr.get("designation") or candidate["current_designation"], candidate["total_exp_mo"], "pdf")
    else:
        cfg = {**_STYLE_CONFIGS[body.resume_style]}
        if body.visual_theme:
            cfg["visual_theme"] = body.visual_theme
        if body.logo_position:
            cfg["logo_position"] = body.logo_position
        resume_bytes = render_resume_pdf(candidate, cfg)
        filename = build_resume_filename(candidate["full_name"], candidate["current_designation"], candidate["total_exp_mo"], "pdf")

    return await _do_client_submission(
        actor.tenant_id, application_id, actor, resume_bytes,
        filename, body.resume_style,
        _RESUME_LABELS.get(body.resume_style, body.resume_style),
        template_id=body.template_id, columns_override=body.columns, hidden_columns=body.hidden_columns,
        field_values=body.field_values, to_emails_override=body.to_emails, cc_self=body.cc_self,
        save_as_default=body.save_as_default, contact_id=body.contact_id, default_scope=body.default_scope,
        subject_override=body.email_subject, body_override=body.email_body,
    )


class SubmitToClientBatchIn(SubmitToClientIn):
    additional_application_ids: list[str] = []


@router.post("/applications/{application_id}/submit-to-client/batch")
async def submit_to_client_batch(
    application_id: str, body: SubmitToClientBatchIn,
    actor: Actor = Depends(require_role("admin", "super_admin", "manager", "kae", "kam")),
):
    """Real feature (2026-09-03, reported live on the tracking-sheet
    preview: "option to add new row" -- clarified via direct back-and-
    forth to mean submitting several DIFFERENT real candidates for the
    same role to the same client in one action, each getting their own
    real send (a genuine new SL No, matching the tracking sheet's own
    continuing count), instead of repeating the whole Submit-to-Client
    flow once per candidate. Real fix, same day, later: each send now
    shows only ITS OWN candidate's row (see _client_tracking_sheet_rows'
    own docstring) -- so a batch of 3 produces 3 separate real emails,
    each showing exactly 1 row, never all 3 candidates combined into one
    shared table.

    Deliberately a thin batch WRAPPER around the exact same, already-
    proven _do_client_submission() -- called once per candidate,
    SEQUENTIALLY, never concurrently: each call's own sl_no computation
    (_client_tracking_sheet_rows) reads the real, just-committed prior
    row, so sequencing is what keeps SL Nos correctly consecutive across
    the whole batch. Never a second, parallel send engine -- every real
    safeguard the single-candidate path already has (HITL role gate,
    SPOC-visibility scoping, hidden-column redaction, stage-bump race
    safety, notification dispatch) applies identically to every
    candidate in the batch, for free.

    manual_resume is deliberately not supported here -- one hand-typed
    summary can't correctly describe several different real people;
    batch callers must use a real style that renders from each
    candidate's own profile. field_values (any manual cell overrides
    the KAE typed for the row they were looking at) and
    columns_override/save_as_default (template-level, not per-
    candidate) apply ONLY to the first (anchor) candidate -- applying
    one person's specific override text to someone else's row would be
    wrong, and the template-save side effect only needs to happen once.
    One candidate's real failure (a missing client contact, an
    unrelated requisition, a transient send error) never aborts the
    rest of the batch -- each result is independently captured."""
    if body.resume_style == "manual":
        raise HTTPException(400, "resume_style 'manual' is not supported for a batch submission — pick a style that renders from each candidate's own profile, or remove the extra candidates")
    if body.resume_style not in _RESUME_STYLES:
        raise HTTPException(400, f"resume_style must be one of {', '.join(_RESUME_STYLES)}")
    if body.visual_theme is not None and body.visual_theme not in _VALID_THEMES:
        raise HTTPException(400, f"visual_theme must be one of {sorted(_VALID_THEMES)}")
    if body.logo_position is not None and body.logo_position not in _VALID_LOGO_POSITIONS:
        raise HTTPException(400, f"logo_position must be one of {sorted(_VALID_LOGO_POSITIONS)}")
    if body.default_scope not in ("client", "contact", "requisition"):
        raise HTTPException(400, "default_scope must be one of ('client', 'contact', 'requisition')")

    all_ids = [application_id] + [a for a in dict.fromkeys(body.additional_application_ids) if a and a != application_id]
    if len(all_ids) > 20:
        raise HTTPException(400, "A single batch send is capped at 20 candidates")

    async with db.tenant_conn(actor.tenant_id) as conn:
        anchor_row, _ = await _app_context(conn, application_id)
    anchor_req_id = anchor_row["requisition_id"]

    results = []
    for i, app_id in enumerate(all_ids):
        try:
            async with db.tenant_conn(actor.tenant_id) as conn:
                row, _ = await _app_context(conn, app_id)
            # Real safety guard: every candidate in the batch must be a
            # real applicant on the SAME requisition (same client, same
            # role) the anchor was opened for -- never silently include
            # someone from an unrelated role just because a caller passed
            # a stray id.
            if row["requisition_id"] != anchor_req_id:
                results.append({"application_id": app_id, "candidate_id": str(row["candidate_id"]),
                                 "candidate_name": row["full_name"], "email_sent": False,
                                 "error": "Not on the same requisition as the anchor candidate — skipped"})
                continue
            candidate = {
                "full_name": row["full_name"], "phone": row["phone"], "email": row["email"],
                "location": row["location"], "current_employer": row["current_employer"],
                "current_designation": row["current_designation"], "total_exp_mo": row["total_exp_mo"],
                "skills": row["skills"], "resume_text": row["resume_text"],
            }
            cfg = {**_STYLE_CONFIGS[body.resume_style]}
            if body.visual_theme:
                cfg["visual_theme"] = body.visual_theme
            if body.logo_position:
                cfg["logo_position"] = body.logo_position
            resume_bytes = render_resume_pdf(candidate, cfg)
            filename = build_resume_filename(candidate["full_name"], candidate["current_designation"], candidate["total_exp_mo"], "pdf")

            is_anchor = (i == 0)
            result = await _do_client_submission(
                actor.tenant_id, app_id, actor, resume_bytes, filename, body.resume_style,
                _RESUME_LABELS.get(body.resume_style, body.resume_style),
                template_id=body.template_id, columns_override=body.columns if is_anchor else None,
                hidden_columns=body.hidden_columns, field_values=body.field_values if is_anchor else {},
                to_emails_override=body.to_emails, cc_self=body.cc_self,
                save_as_default=body.save_as_default if is_anchor else False,
                contact_id=body.contact_id, default_scope=body.default_scope,
                subject_override=body.email_subject, body_override=body.email_body,
            )
            results.append({
                "application_id": app_id, "candidate_id": str(row["candidate_id"]),
                "candidate_name": row["full_name"], "email_sent": result["email_sent"],
                "email_error": result.get("email_error"),
                "stage_bumped_to_submitted": result["stage_bumped_to_submitted"],
                "submission_id": str(result["id"]),
            })
        except HTTPException as he:
            results.append({"application_id": app_id, "candidate_id": None, "candidate_name": None,
                             "email_sent": False, "error": str(he.detail)})
        except Exception as ex:
            results.append({"application_id": app_id, "candidate_id": None, "candidate_name": None,
                             "email_sent": False, "error": str(ex)})

    return {"results": results, "total": len(results), "sent": sum(1 for r in results if r.get("email_sent"))}
