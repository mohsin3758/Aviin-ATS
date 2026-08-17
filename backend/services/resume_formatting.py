"""Shared resume-formatting primitives: redaction, name masking, and a
compositional PDF/DOCX renderer used by both the standalone Resume
Generator (backend/routers/resume_generator.py) and the older, still-live
KAE-submission fixed-format renderers (backend/routers/kae_submission.py).

One engine, not two — kae_submission.py's 6 named formats are just
compositional configs that call render_resume_pdf() under the hood
(see kae_submission.py's _config_for_style()), so there's a single place
that knows how to build a resume document.
"""
import io
import re
from typing import Optional
from xml.sax.saxutils import escape as _esc


def mask_name(full_name: str) -> str:
    """'Mohsin Khan' -> 'Mohsin K' (first name + first letter of last name,
    no period — matches the exact rule requested: "Rahul Sharma -> Rahul S").
    Single-word names pass through unchanged; there's no surname to mask."""
    parts = (full_name or "").strip().split()
    if not parts:
        return "Candidate"
    if len(parts) == 1:
        return parts[0]
    return f"{parts[0]} {parts[-1][0]}"


def redact_contact(text: str, candidate: dict, redact_phone: bool, redact_email: bool) -> str:
    """Strip phone/email from free text — conditionally, since a caller that
    IS showing contact details (show_mobile/show_email true) wants them left
    alone in the body, not stripped just because the field exists."""
    if not text:
        return text
    out = text
    phone = (candidate.get("phone") or "").strip()
    email = (candidate.get("email") or "").strip()
    if redact_phone:
        if phone:
            digits = re.sub(r"\D", "", phone)
            if len(digits) >= 6:
                out = re.sub(re.escape(digits), "[REDACTED]", out)
        out = re.sub(r"(\+?\d[\d\s\-()]{8,}\d)", "[REDACTED]", out)
    if redact_email:
        if email:
            out = out.replace(email, "[REDACTED]")
        out = re.sub(r"[\w.+-]+@[\w-]+\.[\w.-]+", "[REDACTED]", out)
    return out


def fmt_exp(months) -> str:
    if not months:
        return ""
    y, m = divmod(int(months), 12)
    if y and m:
        return f"{y}y {m}m"
    if y:
        return f"{y}y"
    return f"{m}m"


DEFAULT_CONFIG = {
    "name_format": "full",          # full | masked
    "show_mobile": True,
    "show_email": True,
    "show_location": True,
    "company_mode": "original",     # original | replace | hide
    "company_replacement": None,
    "project_mode": "include",      # include | hide | focus
    "client_name_mode": "hide",     # show | hide | replace
    "client_name_replacement": None,
}


def _resolve_body_text(candidate: dict, config: dict) -> tuple[str, str]:
    """Returns (section_heading, body_text) for the main narrative block,
    already redacted/masked per config. project_mode='focus' isolates just
    the Projects section (falls back to the full summary with a note if the
    resume has no distinct Projects heading); 'hide' omits the narrative
    entirely; 'include' is the normal full extracted text."""
    from services.improved_parser import extract_projects_section, extract_summary_section

    resume_text = candidate.get("resume_text") or ""
    if config["project_mode"] == "hide":
        return "", ""

    if config["project_mode"] == "focus":
        projects = extract_projects_section(resume_text)
        if not projects:
            return "", ""
        heading = "PROJECTS"
        raw = projects
    else:
        # REAL BUG FIX (2026-08-18): this used to be `raw = resume_text`
        # -- the *entire* raw document, including its own embedded name/
        # title/"PROFESSIONAL SUMMARY" heading -- rendered under a
        # second, template-added "PROFESSIONAL SUMMARY" heading. Every
        # generated resume showed the candidate's name and title twice.
        heading = "PROFESSIONAL SUMMARY"
        raw = extract_summary_section(resume_text, candidate.get("full_name") or "") or ""

    text = redact_contact(raw, candidate, not config["show_mobile"], not config["show_email"])
    full_name = candidate.get("full_name") or ""
    if config["name_format"] == "masked" and full_name:
        text = re.sub(re.escape(full_name), mask_name(full_name), text, flags=re.I)
    employer = candidate.get("current_employer") or ""
    if employer and config["company_mode"] == "replace" and config["company_replacement"]:
        text = re.sub(re.escape(employer), config["company_replacement"], text, flags=re.I)
    elif employer and config["company_mode"] == "hide":
        text = re.sub(re.escape(employer), "[Company withheld]", text, flags=re.I)
    return heading, text


def _company_line(candidate: dict, config: dict) -> Optional[str]:
    employer = candidate.get("current_employer") or ""
    if config["company_mode"] == "hide":
        return None
    if config["company_mode"] == "replace":
        return config["company_replacement"] or employer or None
    return employer or None


def _client_line(client_name: Optional[str], config: dict) -> Optional[str]:
    if not client_name or config["client_name_mode"] == "hide":
        return None
    if config["client_name_mode"] == "replace":
        return config["client_name_replacement"] or client_name
    return client_name


def render_resume_pdf(candidate: dict, config: dict, client_name: str = None) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable

    cfg = {**DEFAULT_CONFIG, **config}
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

    display_name = mask_name(candidate.get("full_name") or "") if cfg["name_format"] == "masked" else (candidate.get("full_name") or "Candidate")
    story = [
        Paragraph(_esc(display_name), h1),
        Paragraph(_esc(candidate.get("current_designation") or ""), sub),
        HRFlowable(width="100%", thickness=1.2, color=PRIMARY, spaceAfter=6),
    ]

    meta_bits = []
    if cfg["show_location"] and candidate.get("location"):
        meta_bits.append(f"<b>Location:</b> {_esc(candidate['location'])}")
    if candidate.get("total_exp_mo"):
        meta_bits.append(f"<b>Total Experience:</b> {_esc(fmt_exp(candidate['total_exp_mo']))}")
    if meta_bits:
        story.append(Paragraph(" &nbsp;&nbsp;|&nbsp;&nbsp; ".join(meta_bits), body))

    contact_bits = []
    if cfg["show_mobile"] and candidate.get("phone"):
        contact_bits.append(f"<b>Mobile:</b> {_esc(candidate['phone'])}")
    if cfg["show_email"] and candidate.get("email"):
        contact_bits.append(f"<b>Email:</b> {_esc(candidate['email'])}")
    if contact_bits:
        story.append(Paragraph(" &nbsp;&nbsp;|&nbsp;&nbsp; ".join(contact_bits), body))

    company_line = _company_line(candidate, cfg)
    if company_line:
        story.append(Paragraph(f"<b>Current Company:</b> {_esc(company_line)}", body))

    skills = candidate.get("skills") or []
    if skills:
        story.append(Paragraph("KEY SKILLS", h2))
        story.append(Paragraph(_esc(", ".join(skills)), body))

    heading, text = _resolve_body_text(candidate, cfg)
    if text.strip():
        story.append(Paragraph(heading, h2))
        snippet = text[:2600] + ("…" if len(text) > 2600 else "")
        for para in snippet.split("\n"):
            if para.strip():
                story.append(Paragraph(_esc(para.strip()), body))

    client_line = _client_line(client_name, cfg)
    story.append(Spacer(1, 0.6 * cm))
    footer = "Generated via AVIIN ATS"
    if client_line:
        footer += f" — Submitted for: {client_line}"
    story.append(Paragraph(_esc(footer), small))
    doc.build(story)
    return buf.getvalue()


def render_resume_docx(candidate: dict, config: dict, client_name: str = None) -> bytes:
    from docx import Document
    from docx.shared import Pt, RGBColor
    from docx.enum.text import WD_ALIGN_PARAGRAPH

    cfg = {**DEFAULT_CONFIG, **config}
    PRIMARY = RGBColor(0x1e, 0x40, 0xaf)
    DARK = RGBColor(0x0f, 0x17, 0x2a)

    doc = Document()
    display_name = mask_name(candidate.get("full_name") or "") if cfg["name_format"] == "masked" else (candidate.get("full_name") or "Candidate")

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run(display_name)
    r.bold = True
    r.font.size = Pt(18)
    r.font.color.rgb = DARK

    if candidate.get("current_designation"):
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p.add_run(candidate["current_designation"])
        r.bold = True
        r.font.size = Pt(12)
        r.font.color.rgb = PRIMARY

    meta_bits = []
    if cfg["show_location"] and candidate.get("location"):
        meta_bits.append(f"Location: {candidate['location']}")
    if candidate.get("total_exp_mo"):
        meta_bits.append(f"Total Experience: {fmt_exp(candidate['total_exp_mo'])}")
    if meta_bits:
        doc.add_paragraph(" | ".join(meta_bits))

    contact_bits = []
    if cfg["show_mobile"] and candidate.get("phone"):
        contact_bits.append(f"Mobile: {candidate['phone']}")
    if cfg["show_email"] and candidate.get("email"):
        contact_bits.append(f"Email: {candidate['email']}")
    if contact_bits:
        doc.add_paragraph(" | ".join(contact_bits))

    company_line = _company_line(candidate, cfg)
    if company_line:
        doc.add_paragraph(f"Current Company: {company_line}")

    skills = candidate.get("skills") or []
    if skills:
        h = doc.add_paragraph()
        r = h.add_run("KEY SKILLS")
        r.bold = True
        r.font.color.rgb = PRIMARY
        doc.add_paragraph(", ".join(skills))

    heading, text = _resolve_body_text(candidate, cfg)
    if text.strip():
        h = doc.add_paragraph()
        r = h.add_run(heading)
        r.bold = True
        r.font.color.rgb = PRIMARY
        snippet = text[:2600] + ("…" if len(text) > 2600 else "")
        for para in snippet.split("\n"):
            if para.strip():
                doc.add_paragraph(para.strip())

    client_line = _client_line(client_name, cfg)
    footer = "Generated via AVIIN ATS"
    if client_line:
        footer += f" — Submitted for: {client_line}"
    fp = doc.add_paragraph()
    fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    fr = fp.add_run(footer)
    fr.italic = True
    fr.font.size = Pt(9)

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()
