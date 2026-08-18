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
    "visual_theme": "classic",      # classic | modern_sidebar | minimal_ats
}

# Real, distinct visual layouts a recruiter can pick between — separate
# dimension from the content-composition fields above (a "Project-Focused"
# template can render in any of these 3 looks). Not "clone an uploaded
# sample PDF" (that would need vision/AI analysis this zero-token codebase
# doesn't have) — a curated set of real layouts covering the styles
# recruiters actually asked for: a colored two-column layout (like a
# client-facing "showcase" resume) and a plain, color-free, single-column
# layout (the safest shape for automated ATS parsers on the client side).
VISUAL_THEMES = [
    {"id": "classic", "label": "Classic Professional",
     "description": "Centered header, single column, a blue accent rule. The current default look."},
    {"id": "modern_sidebar", "label": "Modern Sidebar",
     "description": "A shaded left sidebar for contact details and key skills, main column for the summary. A distinctive, client-facing look."},
    {"id": "minimal_ats", "label": "Minimal / ATS-Safe",
     "description": "Plain black text, no color, no tables, left-aligned. Optimized for automated resume-parsing systems."},
]
_VALID_THEMES = {t["id"] for t in VISUAL_THEMES}


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
    """Dispatches to one of VISUAL_THEMES's real renderers. All 3 use the
    exact same resolved content (_resolve_body_text/_company_line/etc) —
    only layout, color, and typography differ."""
    cfg = {**DEFAULT_CONFIG, **config}
    theme = cfg.get("visual_theme") or "classic"
    if theme not in _VALID_THEMES:
        theme = "classic"
    if theme == "modern_sidebar":
        return _render_pdf_sidebar(candidate, cfg, client_name)
    if theme == "minimal_ats":
        return _render_pdf_minimal(candidate, cfg, client_name)
    return _render_pdf_classic(candidate, cfg, client_name)


def _render_pdf_classic(candidate: dict, cfg: dict, client_name: str = None) -> bytes:
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


def _render_pdf_sidebar(candidate: dict, cfg: dict, client_name: str = None) -> bytes:
    """A real 2-column layout: a shaded left sidebar (contact + key skills)
    built as a Table cell, a white main column (name/title header + the
    resolved summary/projects body) as the other cell. reportlab Tables are
    the standard way to get a true multi-column layout — Frames/columns on
    SimpleDocTemplate can't independently color one column's background."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.lib import colors
    from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle)

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=0, rightMargin=0, topMargin=0, bottomMargin=1.2 * cm)
    SIDEBAR_BG = colors.HexColor("#1e3a5f")
    SIDEBAR_TEXT = colors.HexColor("#e8eef5")
    SIDEBAR_ACCENT = colors.HexColor("#7fb3e0")
    DARK = colors.HexColor("#0f172a")
    PRIMARY = colors.HexColor("#1e40af")
    GRAY = colors.HexColor("#64748b")

    sb_label = ParagraphStyle("SbLabel", fontSize=9, textColor=SIDEBAR_ACCENT, fontName="Helvetica-Bold", spaceBefore=10, spaceAfter=4)
    sb_body = ParagraphStyle("SbBody", fontSize=9, textColor=SIDEBAR_TEXT, leading=13, fontName="Helvetica")
    m_name = ParagraphStyle("MName", fontSize=20, textColor=DARK, fontName="Helvetica-Bold", spaceAfter=2)
    m_title = ParagraphStyle("MTitle", fontSize=12, textColor=PRIMARY, fontName="Helvetica-Bold", spaceAfter=14)
    m_h2 = ParagraphStyle("MH2", fontSize=11, textColor=PRIMARY, fontName="Helvetica-Bold", spaceBefore=10, spaceAfter=6)
    m_body = ParagraphStyle("MBody", fontSize=10, textColor=DARK, leading=15, fontName="Helvetica")
    small = ParagraphStyle("Small", fontSize=8, textColor=GRAY, fontName="Helvetica")

    display_name = mask_name(candidate.get("full_name") or "") if cfg["name_format"] == "masked" else (candidate.get("full_name") or "Candidate")

    # ── Sidebar cell content ──
    sidebar = [Spacer(1, 1.2 * cm)]
    sidebar.append(Paragraph("CONTACT", sb_label))
    if cfg["show_mobile"] and candidate.get("phone"):
        sidebar.append(Paragraph(_esc(candidate["phone"]), sb_body))
    if cfg["show_email"] and candidate.get("email"):
        sidebar.append(Paragraph(_esc(candidate["email"]), sb_body))
    if cfg["show_location"] and candidate.get("location"):
        sidebar.append(Paragraph(_esc(candidate["location"]), sb_body))
    if candidate.get("total_exp_mo"):
        sidebar.append(Paragraph("EXPERIENCE", sb_label))
        sidebar.append(Paragraph(_esc(fmt_exp(candidate["total_exp_mo"])), sb_body))
    company_line = _company_line(candidate, cfg)
    if company_line:
        sidebar.append(Paragraph("CURRENT COMPANY", sb_label))
        sidebar.append(Paragraph(_esc(company_line), sb_body))
    skills = candidate.get("skills") or []
    if skills:
        sidebar.append(Paragraph("KEY SKILLS", sb_label))
        for s in skills[:18]:
            sidebar.append(Paragraph(f"• {_esc(s)}", sb_body))
    sidebar.append(Spacer(1, 1 * cm))

    # ── Main column content ──
    main = [Spacer(1, 1.2 * cm), Paragraph(_esc(display_name), m_name)]
    if candidate.get("current_designation"):
        main.append(Paragraph(_esc(candidate["current_designation"]), m_title))
    heading, text = _resolve_body_text(candidate, cfg)
    if text.strip():
        main.append(Paragraph(heading, m_h2))
        snippet = text[:2600] + ("…" if len(text) > 2600 else "")
        for para in snippet.split("\n"):
            if para.strip():
                main.append(Paragraph(_esc(para.strip()), m_body))
    client_line = _client_line(client_name, cfg)
    main.append(Spacer(1, 0.8 * cm))
    footer = "Generated via AVIIN ATS"
    if client_line:
        footer += f" — Submitted for: {client_line}"
    main.append(Paragraph(_esc(footer), small))

    page_w = A4[0]
    sidebar_w = page_w * 0.32
    main_w = page_w - sidebar_w
    table = Table([[sidebar, main]], colWidths=[sidebar_w, main_w])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, 0), SIDEBAR_BG),
        ("BACKGROUND", (1, 0), (1, 0), colors.white),
        ("LEFTPADDING", (0, 0), (0, 0), 0.9 * cm), ("RIGHTPADDING", (0, 0), (0, 0), 0.7 * cm),
        ("LEFTPADDING", (1, 0), (1, 0), 1.2 * cm), ("RIGHTPADDING", (1, 0), (1, 0), 1.2 * cm),
        ("TOPPADDING", (0, 0), (-1, 0), 0), ("BOTTOMPADDING", (0, 0), (-1, 0), 0),
        ("VALIGN", (0, 0), (-1, 0), "TOP"),
    ]))
    doc.build([table])
    return buf.getvalue()


def _render_pdf_minimal(candidate: dict, cfg: dict, client_name: str = None) -> bytes:
    """No color, no tables, no centering — the shape most likely to survive
    an automated ATS text-extraction pass on the client's own side."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=2.4 * cm, rightMargin=2.4 * cm,
                             topMargin=2.2 * cm, bottomMargin=2.2 * cm)
    BLACK = colors.HexColor("#000000")
    GRAY = colors.HexColor("#444444")
    h1 = ParagraphStyle("H1", fontSize=16, textColor=BLACK, fontName="Helvetica-Bold", spaceAfter=2)
    sub = ParagraphStyle("Sub", fontSize=11, textColor=BLACK, fontName="Helvetica", spaceAfter=8)
    h2 = ParagraphStyle("H2", fontSize=10.5, textColor=BLACK, fontName="Helvetica-Bold", spaceBefore=12, spaceAfter=5)
    body = ParagraphStyle("Body", fontSize=10, textColor=BLACK, leading=14, fontName="Helvetica")
    small = ParagraphStyle("Small", fontSize=8.5, textColor=GRAY, fontName="Helvetica")

    display_name = mask_name(candidate.get("full_name") or "") if cfg["name_format"] == "masked" else (candidate.get("full_name") or "Candidate")
    story = [Paragraph(_esc(display_name), h1)]
    if candidate.get("current_designation"):
        story.append(Paragraph(_esc(candidate["current_designation"]), sub))
    story.append(HRFlowable(width="100%", thickness=0.6, color=GRAY, spaceAfter=8))

    line_bits = []
    if cfg["show_location"] and candidate.get("location"):
        line_bits.append(candidate["location"])
    if candidate.get("total_exp_mo"):
        line_bits.append(f"{fmt_exp(candidate['total_exp_mo'])} experience")
    if cfg["show_mobile"] and candidate.get("phone"):
        line_bits.append(candidate["phone"])
    if cfg["show_email"] and candidate.get("email"):
        line_bits.append(candidate["email"])
    if line_bits:
        story.append(Paragraph(_esc(" | ".join(line_bits)), body))

    company_line = _company_line(candidate, cfg)
    if company_line:
        story.append(Paragraph(f"Current Company: {_esc(company_line)}", body))

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
    """Dispatches to one of VISUAL_THEMES's real DOCX renderers, mirroring
    the PDF dispatcher above."""
    cfg = {**DEFAULT_CONFIG, **config}
    theme = cfg.get("visual_theme") or "classic"
    if theme not in _VALID_THEMES:
        theme = "classic"
    if theme == "modern_sidebar":
        return _render_docx_sidebar(candidate, cfg, client_name)
    if theme == "minimal_ats":
        return _render_docx_minimal(candidate, cfg, client_name)
    return _render_docx_classic(candidate, cfg, client_name)


def _render_docx_classic(candidate: dict, cfg: dict, client_name: str = None) -> bytes:
    from docx import Document
    from docx.shared import Pt, RGBColor
    from docx.enum.text import WD_ALIGN_PARAGRAPH

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


def _shade_cell(cell, hex_color: str) -> None:
    """python-docx has no first-class cell-shading API — the standard
    workaround is a raw <w:shd> element on the cell's tcPr, same technique
    used throughout the python-docx ecosystem for table-cell backgrounds."""
    from docx.oxml.ns import qn
    from docx.oxml import OxmlElement
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_color)
    tc_pr.append(shd)


def _render_docx_sidebar(candidate: dict, cfg: dict, client_name: str = None) -> bytes:
    """A single-row, 2-column table: shaded left cell (contact + skills),
    white right cell (name/title + resolved summary) — the DOCX analogue of
    the PDF sidebar theme's reportlab Table approach."""
    from docx import Document
    from docx.shared import Pt, RGBColor, Cm
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.enum.table import WD_TABLE_ALIGNMENT

    SIDEBAR_TEXT = RGBColor(0xe8, 0xee, 0xf5)
    SIDEBAR_ACCENT = RGBColor(0x7f, 0xb3, 0xe0)
    PRIMARY = RGBColor(0x1e, 0x40, 0xaf)
    DARK = RGBColor(0x0f, 0x17, 0x2a)

    doc = Document()
    for section in doc.sections:
        section.left_margin = Cm(1)
        section.right_margin = Cm(1)

    table = doc.add_table(rows=1, cols=2)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    left, right = table.rows[0].cells
    left.width = Cm(6)
    right.width = Cm(13)
    _shade_cell(left, "1E3A5F")

    display_name = mask_name(candidate.get("full_name") or "") if cfg["name_format"] == "masked" else (candidate.get("full_name") or "Candidate")

    def sb_heading(txt):
        p = left.add_paragraph()
        r = p.add_run(txt)
        r.bold = True
        r.font.size = Pt(9)
        r.font.color.rgb = SIDEBAR_ACCENT

    def sb_line(txt):
        p = left.add_paragraph()
        r = p.add_run(txt)
        r.font.size = Pt(9)
        r.font.color.rgb = SIDEBAR_TEXT

    left.paragraphs[0].text = ""
    sb_heading("CONTACT")
    if cfg["show_mobile"] and candidate.get("phone"):
        sb_line(candidate["phone"])
    if cfg["show_email"] and candidate.get("email"):
        sb_line(candidate["email"])
    if cfg["show_location"] and candidate.get("location"):
        sb_line(candidate["location"])
    if candidate.get("total_exp_mo"):
        sb_heading("EXPERIENCE")
        sb_line(fmt_exp(candidate["total_exp_mo"]))
    company_line = _company_line(candidate, cfg)
    if company_line:
        sb_heading("CURRENT COMPANY")
        sb_line(company_line)
    skills = candidate.get("skills") or []
    if skills:
        sb_heading("KEY SKILLS")
        for s in skills[:18]:
            sb_line(f"• {s}")

    right.paragraphs[0].text = ""
    p = right.paragraphs[0]
    r = p.add_run(display_name)
    r.bold = True
    r.font.size = Pt(18)
    r.font.color.rgb = DARK

    if candidate.get("current_designation"):
        p = right.add_paragraph()
        r = p.add_run(candidate["current_designation"])
        r.bold = True
        r.font.size = Pt(12)
        r.font.color.rgb = PRIMARY

    heading, text = _resolve_body_text(candidate, cfg)
    if text.strip():
        h = right.add_paragraph()
        r = h.add_run(heading)
        r.bold = True
        r.font.color.rgb = PRIMARY
        snippet = text[:2600] + ("…" if len(text) > 2600 else "")
        for para in snippet.split("\n"):
            if para.strip():
                right.add_paragraph(para.strip())

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


def _render_docx_minimal(candidate: dict, cfg: dict, client_name: str = None) -> bytes:
    """No color, left-aligned, no italics — the DOCX analogue of the PDF
    minimal/ATS-safe theme."""
    from docx import Document
    from docx.shared import Pt, RGBColor

    BLACK = RGBColor(0x00, 0x00, 0x00)
    GRAY = RGBColor(0x44, 0x44, 0x44)

    doc = Document()
    display_name = mask_name(candidate.get("full_name") or "") if cfg["name_format"] == "masked" else (candidate.get("full_name") or "Candidate")

    p = doc.add_paragraph()
    r = p.add_run(display_name)
    r.bold = True
    r.font.size = Pt(16)
    r.font.color.rgb = BLACK

    if candidate.get("current_designation"):
        p = doc.add_paragraph()
        r = p.add_run(candidate["current_designation"])
        r.font.size = Pt(11)
        r.font.color.rgb = BLACK

    line_bits = []
    if cfg["show_location"] and candidate.get("location"):
        line_bits.append(candidate["location"])
    if candidate.get("total_exp_mo"):
        line_bits.append(f"{fmt_exp(candidate['total_exp_mo'])} experience")
    if cfg["show_mobile"] and candidate.get("phone"):
        line_bits.append(candidate["phone"])
    if cfg["show_email"] and candidate.get("email"):
        line_bits.append(candidate["email"])
    if line_bits:
        doc.add_paragraph(" | ".join(line_bits))

    company_line = _company_line(candidate, cfg)
    if company_line:
        doc.add_paragraph(f"Current Company: {company_line}")

    skills = candidate.get("skills") or []
    if skills:
        h = doc.add_paragraph()
        r = h.add_run("KEY SKILLS")
        r.bold = True
        r.font.color.rgb = BLACK
        doc.add_paragraph(", ".join(skills))

    heading, text = _resolve_body_text(candidate, cfg)
    if text.strip():
        h = doc.add_paragraph()
        r = h.add_run(heading)
        r.bold = True
        r.font.color.rgb = BLACK
        snippet = text[:2600] + ("…" if len(text) > 2600 else "")
        for para in snippet.split("\n"):
            if para.strip():
                doc.add_paragraph(para.strip())

    client_line = _client_line(client_name, cfg)
    footer = "Generated via AVIIN ATS"
    if client_line:
        footer += f" — Submitted for: {client_line}"
    fp = doc.add_paragraph()
    fr = fp.add_run(footer)
    fr.font.size = Pt(8.5)
    fr.font.color.rgb = GRAY

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()
