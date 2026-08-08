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
from typing import Optional
from xml.sax.saxutils import escape as _esc

import asyncpg
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import db
import events
from deps import Actor, get_actor
from routers.pipeline_stages import is_valid_stage

router = APIRouter(tags=["kae-submission"])

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
                  c.full_name, c.phone, c.email, c.location, c.current_employer,
                  c.total_exp_mo, c.notice_period_days, c.current_ctc, c.expected_ctc,
                  c.current_designation, c.skills, c.resume_text,
                  r.title AS role_title, r.client_id,
                  t.name AS tenant_name
           FROM applications a
           JOIN candidates c ON c.id = a.candidate_id
           JOIN requisitions r ON r.id = a.requisition_id
           JOIN tenants t ON t.id = a.tenant_id
           WHERE a.id = $1""",
        application_id,
    )
    if row is None:
        raise HTTPException(404, "Application not found")

    notice = f"{row['notice_period_days']} days" if row["notice_period_days"] is not None else ""
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
    }
    return row, auto_values


async def _resolve_kae(conn, tenant_id: str, client_id: Optional[str]):
    if not client_id:
        return None
    return await conn.fetchrow(
        """SELECT u.id, u.full_name, u.email
           FROM client_owners co JOIN users u ON u.id = co.user_id
           WHERE co.tenant_id=$1 AND co.client_id=$2 AND co.owner_type='kae' AND co.is_active
           ORDER BY co.assigned_at DESC LIMIT 1""",
        tenant_id, client_id,
    )


async def _resolve_template(conn, tenant_id: str, client_id: Optional[str]):
    row = None
    if client_id:
        row = await conn.fetchrow(
            "SELECT * FROM tracking_sheet_templates WHERE tenant_id=$1 AND client_id=$2 ORDER BY created_at LIMIT 1",
            tenant_id, client_id)
    if row is None:
        row = await conn.fetchrow(
            "SELECT * FROM tracking_sheet_templates WHERE tenant_id=$1 AND is_default LIMIT 1", tenant_id)
    return row


# ─────────────────────────── Templates CRUD ───────────────────────────

class TemplateIn(BaseModel):
    name: str
    client_id: Optional[str] = None
    columns: list[dict]
    is_default: bool = False


@router.get("/submission-templates/columns")
async def list_columns(actor: Actor = Depends(get_actor)):
    return COLUMN_REGISTRY


@router.get("/submission-templates")
async def list_templates(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            """SELECT tst.*, cl.name AS client_name
               FROM tracking_sheet_templates tst LEFT JOIN clients cl ON cl.id = tst.client_id
               WHERE tst.tenant_id=$1 ORDER BY tst.is_default DESC, tst.name""",
            actor.tenant_id)
    return [_template_out(r) for r in rows]


@router.post("/submission-templates")
async def create_template(body: TemplateIn, actor: Actor = Depends(get_actor)):
    if not body.columns:
        raise HTTPException(400, "Template must include at least one column")
    async with db.tenant_conn(actor.tenant_id) as conn:
        if body.is_default:
            await conn.execute(
                "UPDATE tracking_sheet_templates SET is_default=false WHERE tenant_id=$1", actor.tenant_id)
        row = await conn.fetchrow(
            """INSERT INTO tracking_sheet_templates (tenant_id, client_id, name, columns, is_default, created_by)
               VALUES ($1,$2,$3,$4,$5,$6) RETURNING *""",
            actor.tenant_id, body.client_id, body.name, json.dumps(body.columns), body.is_default, actor.user_id)
    return _template_out(row)


@router.put("/submission-templates/{template_id}")
async def update_template(template_id: str, body: TemplateIn, actor: Actor = Depends(get_actor)):
    if not body.columns:
        raise HTTPException(400, "Template must include at least one column")
    async with db.tenant_conn(actor.tenant_id) as conn:
        existing = await conn.fetchval(
            "SELECT id FROM tracking_sheet_templates WHERE id=$1 AND tenant_id=$2", template_id, actor.tenant_id)
        if not existing:
            raise HTTPException(404, "Template not found")
        if body.is_default:
            await conn.execute(
                "UPDATE tracking_sheet_templates SET is_default=false WHERE tenant_id=$1 AND id != $2",
                actor.tenant_id, template_id)
        row = await conn.fetchrow(
            """UPDATE tracking_sheet_templates SET name=$1, client_id=$2, columns=$3, is_default=$4, updated_at=now()
               WHERE id=$5 RETURNING *""",
            body.name, body.client_id, json.dumps(body.columns), body.is_default, template_id)
    return _template_out(row)


@router.delete("/submission-templates/{template_id}")
async def delete_template(template_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT is_default FROM tracking_sheet_templates WHERE id=$1 AND tenant_id=$2",
            template_id, actor.tenant_id)
        if not row:
            raise HTTPException(404, "Template not found")
        if row["is_default"]:
            raise HTTPException(400, "Cannot delete the default template — set another template as default first")
        await conn.execute("DELETE FROM tracking_sheet_templates WHERE id=$1", template_id)
    return {"ok": True}


# ─────────────────────────── Redaction + document generation ───────────────────────────

def _redact_text(text: str, candidate) -> str:
    if not text:
        return text
    out = text
    phone = (candidate["phone"] or "").strip()
    email = (candidate["email"] or "").strip()
    if phone:
        digits = re.sub(r"\D", "", phone)
        if len(digits) >= 6:
            out = re.sub(re.escape(digits), "[REDACTED]", out)
    if email:
        out = out.replace(email, "[REDACTED]")
    out = re.sub(r"[\w.+-]+@[\w-]+\.[\w.-]+", "[REDACTED]", out)
    out = re.sub(r"(\+?\d[\d\s\-()]{8,}\d)", "[REDACTED]", out)
    return out


def _build_clean_resume_pdf(candidate) -> bytes:
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
    GRAY = colors.HexColor("#64748b")
    h1 = ParagraphStyle("H1", fontSize=18, textColor=DARK, fontName="Helvetica-Bold", alignment=TA_CENTER, spaceAfter=2)
    sub = ParagraphStyle("Sub", fontSize=11, textColor=PRIMARY, fontName="Helvetica-Bold", alignment=TA_CENTER, spaceAfter=10)
    h2 = ParagraphStyle("H2", fontSize=11, textColor=PRIMARY, fontName="Helvetica-Bold", spaceBefore=12, spaceAfter=6)
    body = ParagraphStyle("Body", fontSize=10, textColor=DARK, leading=15, fontName="Helvetica")
    small = ParagraphStyle("Small", fontSize=9, textColor=GRAY, fontName="Helvetica")

    story = [
        Paragraph(_esc(candidate["full_name"] or "Candidate"), h1),
        Paragraph(_esc(candidate["current_designation"] or ""), sub),
        HRFlowable(width="100%", thickness=1.2, color=PRIMARY, spaceAfter=6),
        Paragraph(f"<b>Location:</b> {_esc(candidate['location'] or 'Not specified')} &nbsp;&nbsp;|&nbsp;&nbsp; "
                  f"<b>Total Experience:</b> {_esc(_fmt_exp(candidate['total_exp_mo']))}", body),
    ]
    if candidate["current_employer"]:
        story.append(Paragraph(f"<b>Current Employer:</b> {_esc(candidate['current_employer'])}", body))

    skills = candidate["skills"] or []
    if skills:
        story.append(Paragraph("KEY SKILLS", h2))
        story.append(Paragraph(_esc(", ".join(skills)), body))

    summary = _redact_text(candidate["resume_text"] or "", candidate)
    if summary.strip():
        story.append(Paragraph("PROFESSIONAL SUMMARY (auto-extracted — contact details removed)", h2))
        snippet = summary[:2200] + ("…" if len(summary) > 2200 else "")
        for para in snippet.split("\n"):
            if para.strip():
                story.append(Paragraph(_esc(para.strip()), body))

    story.append(Spacer(1, 0.6 * cm))
    story.append(Paragraph("Shared via AVIIN ATS — phone, email and address withheld at this stage.", small))
    doc.build(story)
    return buf.getvalue()


def _build_redacted_resume_pdf(candidate) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=2.2 * cm, rightMargin=2.2 * cm,
                             topMargin=2 * cm, bottomMargin=2 * cm)
    DARK = colors.HexColor("#0f172a")
    PRIMARY = colors.HexColor("#1e40af")
    GRAY = colors.HexColor("#64748b")
    h1 = ParagraphStyle("H1", fontSize=16, textColor=DARK, fontName="Helvetica-Bold", alignment=TA_CENTER, spaceAfter=4)
    small = ParagraphStyle("Small", fontSize=9, textColor=GRAY, fontName="Helvetica", alignment=TA_CENTER, spaceAfter=10)
    body = ParagraphStyle("Body", fontSize=9.5, textColor=DARK, leading=14, fontName="Helvetica")

    story = [
        Paragraph(_esc(candidate["full_name"] or "Candidate"), h1),
        Paragraph("Redacted resume — phone, email and address removed", small),
        HRFlowable(width="100%", thickness=1, color=PRIMARY, spaceAfter=8),
    ]
    text = _redact_text(candidate["resume_text"] or "", candidate)
    if not text.strip():
        story.append(Paragraph("No extracted resume text is available for this candidate — use Clean Summary instead.", body))
    else:
        for para in text.split("\n"):
            para = para.strip()
            if para:
                story.append(Paragraph(_esc(para), body))
            else:
                story.append(Spacer(1, 0.15 * cm))
    doc.build(story)
    return buf.getvalue()


def _anonymize_name(full_name: str) -> str:
    """'Ranjan Kumar Sharma' -> 'Ranjan K.' — first name + first letter of
    the last name, matching exactly what was asked (not just any masking)."""
    parts = (full_name or "").strip().split()
    if not parts:
        return "Candidate"
    if len(parts) == 1:
        return parts[0]
    return f"{parts[0]} {parts[-1][0]}."


def _build_projects_only_pdf(candidate) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable
    from services.improved_parser import extract_projects_section

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=2.2 * cm, rightMargin=2.2 * cm,
                             topMargin=2 * cm, bottomMargin=2 * cm)
    PRIMARY = colors.HexColor("#1e40af")
    DARK = colors.HexColor("#0f172a")
    GRAY = colors.HexColor("#64748b")
    h1 = ParagraphStyle("H1", fontSize=16, textColor=DARK, fontName="Helvetica-Bold", alignment=TA_CENTER, spaceAfter=4)
    small = ParagraphStyle("Small", fontSize=9, textColor=GRAY, fontName="Helvetica", alignment=TA_CENTER, spaceAfter=10)
    h2 = ParagraphStyle("H2", fontSize=11, textColor=PRIMARY, fontName="Helvetica-Bold", spaceBefore=6, spaceAfter=6)
    body = ParagraphStyle("Body", fontSize=10, textColor=DARK, leading=15, fontName="Helvetica")

    story = [
        Paragraph(_esc(candidate["full_name"] or "Candidate"), h1),
        Paragraph("Projects Summary — contact details and employment history withheld", small),
        HRFlowable(width="100%", thickness=1, color=PRIMARY, spaceAfter=8),
    ]
    projects_text = extract_projects_section(candidate["resume_text"] or "")
    if not projects_text:
        story.append(Paragraph('No distinct "Projects" section could be identified in this candidate\'s resume — try Clean Summary instead.', body))
    else:
        projects_text = _redact_text(projects_text, candidate)
        story.append(Paragraph("PROJECTS", h2))
        for para in projects_text.split("\n"):
            para = para.strip()
            if para:
                story.append(Paragraph(_esc(para), body))
            else:
                story.append(Spacer(1, 0.12 * cm))
    doc.build(story)
    return buf.getvalue()


def _build_confidential_pdf(candidate) -> bytes:
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
    GRAY = colors.HexColor("#64748b")
    h1 = ParagraphStyle("H1", fontSize=18, textColor=DARK, fontName="Helvetica-Bold", alignment=TA_CENTER, spaceAfter=2)
    sub = ParagraphStyle("Sub", fontSize=11, textColor=PRIMARY, fontName="Helvetica-Bold", alignment=TA_CENTER, spaceAfter=10)
    h2 = ParagraphStyle("H2", fontSize=11, textColor=PRIMARY, fontName="Helvetica-Bold", spaceBefore=12, spaceAfter=6)
    body = ParagraphStyle("Body", fontSize=10, textColor=DARK, leading=15, fontName="Helvetica")
    small = ParagraphStyle("Small", fontSize=9, textColor=GRAY, fontName="Helvetica")

    employer = candidate["current_employer"] or ""
    story = [
        Paragraph(_esc(candidate["full_name"] or "Candidate"), h1),
        Paragraph(_esc(candidate["current_designation"] or ""), sub),
        HRFlowable(width="100%", thickness=1.2, color=PRIMARY, spaceAfter=6),
        Paragraph(f"<b>Location:</b> {_esc(candidate['location'] or 'Not specified')} &nbsp;&nbsp;|&nbsp;&nbsp; "
                  f"<b>Total Experience:</b> {_esc(_fmt_exp(candidate['total_exp_mo']))}", body),
        Paragraph("<b>Current Employer:</b> Confidential", body),
    ]
    skills = candidate["skills"] or []
    if skills:
        story.append(Paragraph("KEY SKILLS", h2))
        story.append(Paragraph(_esc(", ".join(skills)), body))

    summary = _redact_text(candidate["resume_text"] or "", candidate)
    if employer:
        # Also mask the literal employer name wherever it appears in the free-text summary —
        # not just the structured "Current Employer" line above.
        summary = re.sub(re.escape(employer), "Confidential", summary, flags=re.I)
    if summary.strip():
        story.append(Paragraph("PROFESSIONAL SUMMARY (current company &amp; current projects marked Confidential)", h2))
        snippet = summary[:2200] + ("…" if len(summary) > 2200 else "")
        for para in snippet.split("\n"):
            if para.strip():
                story.append(Paragraph(_esc(para.strip()), body))

    story.append(Spacer(1, 0.6 * cm))
    story.append(Paragraph("Shared via AVIIN ATS — phone, email and address withheld at this stage.", small))
    doc.build(story)
    return buf.getvalue()


def _build_anonymized_pdf(candidate) -> bytes:
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
    GRAY = colors.HexColor("#64748b")
    h1 = ParagraphStyle("H1", fontSize=18, textColor=DARK, fontName="Helvetica-Bold", alignment=TA_CENTER, spaceAfter=2)
    sub = ParagraphStyle("Sub", fontSize=11, textColor=PRIMARY, fontName="Helvetica-Bold", alignment=TA_CENTER, spaceAfter=10)
    h2 = ParagraphStyle("H2", fontSize=11, textColor=PRIMARY, fontName="Helvetica-Bold", spaceBefore=12, spaceAfter=6)
    body = ParagraphStyle("Body", fontSize=10, textColor=DARK, leading=15, fontName="Helvetica")
    small = ParagraphStyle("Small", fontSize=9, textColor=GRAY, fontName="Helvetica")

    anon_name = _anonymize_name(candidate["full_name"])
    employer = candidate["current_employer"] or ""
    story = [
        Paragraph(_esc(anon_name), h1),
        Paragraph(_esc(candidate["current_designation"] or ""), sub),
        HRFlowable(width="100%", thickness=1.2, color=PRIMARY, spaceAfter=6),
        Paragraph(f"<b>Location:</b> {_esc(candidate['location'] or 'Not specified')} &nbsp;&nbsp;|&nbsp;&nbsp; "
                  f"<b>Total Experience:</b> {_esc(_fmt_exp(candidate['total_exp_mo']))}", body),
        Paragraph("<b>Current Employer:</b> AviinTech Business Solutions", body),
    ]
    skills = candidate["skills"] or []
    if skills:
        story.append(Paragraph("KEY SKILLS", h2))
        story.append(Paragraph(_esc(", ".join(skills)), body))

    summary = _redact_text(candidate["resume_text"] or "", candidate)
    full_name = candidate["full_name"] or ""
    if full_name:
        summary = re.sub(re.escape(full_name), anon_name, summary, flags=re.I)
    if employer:
        summary = re.sub(re.escape(employer), "AviinTech Business Solutions", summary, flags=re.I)
    if summary.strip():
        story.append(Paragraph("PROFESSIONAL SUMMARY (identity anonymized)", h2))
        snippet = summary[:2200] + ("…" if len(summary) > 2200 else "")
        for para in snippet.split("\n"):
            if para.strip():
                story.append(Paragraph(_esc(para.strip()), body))

    story.append(Spacer(1, 0.6 * cm))
    story.append(Paragraph("Shared via AVIIN ATS — anonymized profile.", small))
    doc.build(story)
    return buf.getvalue()


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


async def _send_kae_email(tenant_id: str, to_email: str, cc_email: Optional[str], subject: str,
                           body_text: str, attachments: list, body_html_extra: str = "") -> tuple:
    """attachments: list of (filename, bytes, mime_subtype). body_html_extra,
    if given, is appended as real HTML below the plain-text intro (used for
    the inline tracking-sheet table) — the message becomes multipart/
    alternative so clients without HTML rendering still see the plain text."""
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
        msg["To"] = to_email
        recipients = [to_email]
        if cc_email and cc_email != to_email:
            msg["Cc"] = cc_email
            recipients.append(cc_email)

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
        kae = await _resolve_kae(conn, actor.tenant_id, row["client_id"])
        template = await _resolve_template(conn, actor.tenant_id, row["client_id"])
        templates = await conn.fetch(
            """SELECT tst.id, tst.name, tst.client_id, tst.is_default, cl.name AS client_name
               FROM tracking_sheet_templates tst LEFT JOIN clients cl ON cl.id = tst.client_id
               WHERE tst.tenant_id=$1 ORDER BY tst.is_default DESC, tst.name""",
            actor.tenant_id)
        prior_count = await conn.fetchval(
            "SELECT count(*) FROM candidate_submissions WHERE requisition_id=$1", row["requisition_id"])
    return {
        "client_id": str(row["client_id"]) if row["client_id"] else None,
        "kae": dict(kae) if kae else None,
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


@router.post("/applications/{application_id}/submit-to-kae")
async def submit_to_kae(application_id: str, body: SubmitToKaeIn, actor: Actor = Depends(get_actor)):
    if body.resume_style not in _RESUME_STYLES:
        raise HTTPException(400, f"resume_style must be one of {', '.join(_RESUME_STYLES)}")
    if body.resume_style == "manual" and not body.manual_resume:
        raise HTTPException(400, "manual_resume is required when resume_style is 'manual'")

    async with db.tenant_conn(actor.tenant_id) as conn:
        row, auto_values = await _app_context(conn, application_id)
        client_id = row["client_id"]
        if not client_id:
            raise HTTPException(400, "This requisition has no client linked — cannot resolve a KAE")
        kae = await _resolve_kae(conn, actor.tenant_id, client_id)
        if not kae or not kae["email"]:
            raise HTTPException(400, "No active KAE with an email address is assigned to this client (see KAE > Owners)")

        template = None
        if body.template_id:
            template = await conn.fetchrow(
                "SELECT * FROM tracking_sheet_templates WHERE id=$1 AND tenant_id=$2",
                body.template_id, actor.tenant_id)
            if not template:
                raise HTTPException(404, "Template not found")
        else:
            template = await _resolve_template(conn, actor.tenant_id, client_id)
        if not template:
            raise HTTPException(400, "No tracking sheet template available — create one under Ops Settings > Templates")
        columns = _jsonb(template["columns"], [])

        prior_rows = await conn.fetch(
            "SELECT field_values FROM candidate_submissions WHERE requisition_id=$1 ORDER BY sent_at",
            row["requisition_id"])

        client_row = await conn.fetchrow("SELECT name FROM clients WHERE id=$1", client_id)
        recruiter_email = actor.email

    sl_no = len(prior_rows) + 1
    overrides = {k: v for k, v in (body.field_values or {}).items() if v not in (None, "")}
    final_values = {**auto_values, **overrides, "sl_no": str(sl_no)}

    sheet_rows = [_jsonb(r["field_values"], {}) for r in prior_rows] + [final_values]
    tracking_html = _build_tracking_html_table(columns, sheet_rows)

    candidate = {
        "full_name": row["full_name"], "phone": row["phone"], "email": row["email"],
        "location": row["location"], "current_employer": row["current_employer"],
        "current_designation": row["current_designation"], "total_exp_mo": row["total_exp_mo"],
        "skills": row["skills"], "resume_text": row["resume_text"],
    }
    _RESUME_LABELS = {
        "clean_generated": "contact-free clean summary",
        "redacted_original": "redacted original (phone/email removed)",
        "manual": "recruiter-edited summary (contact withheld)",
        "projects_only": "projects-only summary (contact & employment history withheld)",
        "confidential": "clean summary — current company & projects marked Confidential",
        "anonymized": "anonymized profile — identity & employer masked",
    }
    if body.resume_style == "clean_generated":
        resume_bytes = _build_clean_resume_pdf(candidate)
    elif body.resume_style == "redacted_original":
        resume_bytes = _build_redacted_resume_pdf(candidate)
    elif body.resume_style == "manual":
        resume_bytes = _build_manual_resume_pdf(body.manual_resume or {})
    elif body.resume_style == "projects_only":
        resume_bytes = _build_projects_only_pdf(candidate)
    elif body.resume_style == "confidential":
        resume_bytes = _build_confidential_pdf(candidate)
    else:  # anonymized
        resume_bytes = _build_anonymized_pdf(candidate)

    safe_name = re.sub(r"[^A-Za-z0-9_-]+", "_", candidate["full_name"] or "candidate")
    subject = f"Candidate Submission — {candidate['full_name']} for {row['role_title']}"
    body_text = (
        f"Hi {kae['full_name'] or ''},\n\n"
        f"Please find attached the profile for {candidate['full_name']} against \"{row['role_title']}\""
        f"{' (' + client_row['name'] + ')' if client_row else ''}. The tracking sheet "
        f"({sl_no} submission{'s' if sl_no != 1 else ''} on this role so far) is below.\n\n"
        f"Resume attached: {_RESUME_LABELS.get(body.resume_style, body.resume_style)}.\n\n"
        f"Regards,\n{actor.full_name or 'AVIIN ATS'}"
    )
    email_sent, email_error = await _send_kae_email(
        actor.tenant_id, kae["email"], recruiter_email if body.cc_self else None, subject, body_text,
        [
            (f"Resume_{safe_name}_{body.resume_style}.pdf", resume_bytes, "pdf"),
        ],
        body_html_extra=tracking_html,
    )

    async with db.tenant_conn(actor.tenant_id) as conn:
        sub_row = await conn.fetchrow(
            """INSERT INTO candidate_submissions
                 (tenant_id, application_id, candidate_id, requisition_id, client_id, template_id,
                  kae_user_id, resume_style, field_values, recipient_emails, status, error_message, sent_by)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *""",
            actor.tenant_id, application_id, row["candidate_id"], row["requisition_id"], client_id,
            template["id"], kae["id"], body.resume_style, json.dumps(final_values),
            [kae["email"]] + ([recruiter_email] if body.cc_self and recruiter_email and recruiter_email != kae["email"] else []),
            "sent" if email_sent else "failed", email_error, actor.user_id,
        )

        bumped = False
        if row["stage"] in _PRE_SUBMIT_STAGES and await is_valid_stage(conn, actor.tenant_id, "submitted"):
            await conn.execute("UPDATE applications SET stage='submitted', updated_at=now() WHERE id=$1", application_id)
            bumped = True
            await events.write_outbox(
                conn, actor.tenant_id, "application.stage_changed",
                {"application_id": application_id, "from": row["stage"], "to": "submitted", "reason": "submit_to_kae"},
                f"application.stage_changed:{application_id}:{sub_row['sent_at'].isoformat()}",
            )

        await events.write_outbox(
            conn, actor.tenant_id, "candidate.submitted_to_kae",
            {"application_id": application_id, "candidate_id": str(row["candidate_id"]),
             "kae_user_id": str(kae["id"]), "email_sent": email_sent},
            f"candidate.submitted_to_kae:{sub_row['id']}",
        )
        await events.write_audit(
            conn, actor.tenant_id, actor.user_id, "submit_to_kae", "application", application_id,
            before={"stage": row["stage"]},
            after={"kae": kae["full_name"], "resume_style": body.resume_style, "email_sent": email_sent, "sl_no": sl_no},
        )

    out = dict(sub_row)
    out["field_values"] = _jsonb(out["field_values"], {})
    out["email_sent"] = email_sent
    out["email_error"] = email_error
    out["stage_bumped_to_submitted"] = bumped
    out["kae_name"] = kae["full_name"]
    return out


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
