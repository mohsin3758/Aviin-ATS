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
import os
import re
from typing import Optional
from xml.sax.saxutils import escape as _esc


_SUBHEADING_ALLCAPS_RE = re.compile(r'^[A-Z0-9 &/,.\'\-]{3,55}:?$')

# Local to this bolding feature only -- deliberately NOT merged into
# improved_parser.SECTION_HEADERS, which several other parsing functions
# (section-boundary detection, name extraction) depend on for different,
# more consequential behavior. Common mixed-case resume sub-headings that
# the strict ALL-CAPS heuristic below doesn't catch (e.g. "Functional
# Skills", "Competencies:") -- found via a real resume that used exactly
# these as bare one-line headers.
_EXTRA_SUBHEADINGS = frozenset([
    'competencies', 'functional skills', 'system configuration',
    'testing and validation', 'domain experience', 'system cutover',
    'system cutover (go-live)',
])


def _is_subheading(line: str) -> bool:
    """Real improvement (2026-08-18): the body text was rendered as one
    visually flat block, losing all the structure a real resume has --
    bold section headers, bold "Employer:"/"Client:" lines -- confirmed
    directly against a real generated PDF next to its own source document.
    Flags a line for bold/emphasized rendering instead of plain body text.
    Deliberately conservative: only lines matching this codebase's own
    curated SECTION_HEADERS list (plus a small local supplement above), a
    real "Employer:"/"Client:" field label, or a short genuinely ALL-CAPS
    line (a common resume convention for section headers, e.g. "DOMAIN
    EXPERIENCE:") -- never a guess at arbitrary emphasis within ordinary
    sentences."""
    from services.improved_parser import SECTION_HEADERS
    s = line.strip()
    if not s:
        return False
    normalized = s.rstrip(':').strip().lower()
    if normalized in SECTION_HEADERS or normalized in _EXTRA_SUBHEADINGS:
        return True
    low = s.lower()
    if low.startswith('employer:') or low.startswith('client:'):
        return True
    # Real bug fix (2026-08-18): a bare single-word ALL-CAPS fragment like
    # "SAP." was matching this branch -- confirmed directly against a real
    # generated PDF where the tail end of a hard-wrapped sentence ("...
    # advanced migration of\nSAP.") rendered "SAP." as its own bold,
    # spaced-out subheading line instead of the last two words of the
    # sentence it belongs to. Real section headings in this codebase's own
    # convention are always multi-word ("KEY SKILLS", "DOMAIN EXPERIENCE")
    # -- single ALL-CAPS tokens standing alone are acronyms/fragments, not
    # headings, so this branch now requires at least two words.
    if (_SUBHEADING_ALLCAPS_RE.match(s) and any(c.isalpha() for c in s)
            and s.upper() == s and len(s.rstrip(':').split()) >= 2):
        return True
    return False


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
    "logo_position": "top_right",   # none | top_left | top_right
}

# Real improvement (2026-08-18, round 2): the logo was first added to the
# document FOOTER (replacing an earlier fixed "Generated via AVIIN ATS"
# text line) -- moved to a real page-HEADER placement per direct user
# feedback, with a genuine left/right choice rather than one fixed spot.
# "none" renders no logo at all. Same AVIIN Tech logo asset + sizing-by-
# real-aspect-ratio convention already established for call letters/offer
# letters (PDF via reportlab's Image flowable with hAlign; DOCX via
# python-docx's Run.add_picture with the containing paragraph's
# alignment). The "Submitted for: <client>" line (job-specific generation
# context, unrelated to logo placement) stays in the footer, unaffected.
LOGO_PATH = os.path.join(os.path.dirname(__file__), "..", "assets", "aviintech-logo.png")

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

LOGO_POSITION_OPTIONS = [
    {"id": "top_left", "label": "Top Left", "description": "AVIIN Tech logo in the header, aligned left."},
    {"id": "top_right", "label": "Top Right", "description": "AVIIN Tech logo in the header, aligned right."},
    {"id": "none", "label": "No Logo", "description": "No logo anywhere in the document."},
]
_VALID_LOGO_POSITIONS = {o["id"] for o in LOGO_POSITION_OPTIONS}


_BULLET_ONLY_LINE_RE = re.compile(r'^[ \t]*[•❖◆●○■♦\-\*][ \t]*$', re.M)


def _strip_bullet_only_lines(text: str) -> str:
    """A source PDF's own text extraction sometimes splits 'bullet' and its
    sentence onto separate lines (a real PDF-layout artifact, not something
    this codebase introduced) -- e.g. a lone '•' line with the actual
    sentence appearing as its own paragraph right after. Rendered verbatim,
    that's a visibly empty bullet point on the generated resume. Real bug
    report (2026-08-18): a candidate's generated PDF showed two bare '•'
    lines with nothing after them. Drops any line that is ONLY a bullet
    character -- never touches a line that has real bullet+text together,
    which stays exactly as-is."""
    if not text:
        return text
    return _BULLET_ONLY_LINE_RE.sub('', text)


_MULTI_SPACE_RE = re.compile(r'[ \t]{2,}')
BULLET_LINE_RE = re.compile(r'^[ \t]*([•▪●○■♦])[ \t]*(.*)$')


def _normalize_whitespace(text: str) -> str:
    """Real improvement (2026-08-18): PDF text extraction (justified-text
    layouts especially) commonly leaves runs of 2+ spaces between words --
    confirmed directly in a real resume's stored text ("I  worked  in
    Technip  Energies", "•  Working with Burns..."). Rendered verbatim,
    that's visibly uneven spacing throughout the generated document, most
    noticeable right after a bullet character. Collapses any run of 2+
    spaces/tabs to exactly one -- never touches newlines, which are real
    line/paragraph boundaries, not extraction noise."""
    if not text:
        return text
    return '\n'.join(_MULTI_SPACE_RE.sub(' ', line) for line in text.split('\n'))


_SENTENCE_END_RE = re.compile(r'[.:;!?]$')


def _merge_wrapped_lines(text: str) -> list[str]:
    """Real fix (2026-08-18): confirmed directly against this candidate's
    own stored resume_text that the source PDF's text extraction hard-wraps
    long lines at a fixed character width, independent of sentence
    boundaries -- e.g. "...Set up Network profiles and\\nsettlement
    profiles. Configured..." is really ONE continuous sentence, split into
    two raw newline-separated lines with no punctuation at the break.
    Splitting purely on '\\n' (every renderer's loop, until now) treated
    each wrapped fragment as its own paragraph -- harmless when rendered as
    plain body text, but actively wrong once _classify_lines() (added the
    same day) started auto-bulleting achievement-shaped lines: each
    fragment got its OWN bullet, turning one real achievement into several
    nonsensical ones. Reflows wrapped fragments back into logical lines
    before any classification runs: a line only starts a new logical line
    when it is itself a literal-bulleted or subheading line, the line
    before it is a subheading (headings never absorb the next line), or
    the line before it already ends in real sentence-terminal punctuation,
    or the line before it is itself too short to plausibly be a hard-wrap
    artifact -- otherwise it's a wrapped continuation and gets appended
    onto the previous logical line.

    Real bug caught and fixed while verifying this against the actual
    candidate above: without a minimum-length guard, a genuinely short,
    separate line with no trailing punctuation -- a role title
    ("SAP S4 HANA Finance Consultant") or a short standalone bullet
    ("Worked in Migrations") -- got wrongly absorbed into whatever
    followed it, since it looked identical to a real wrapped fragment by
    the punctuation rule alone. Every genuine wrapped fragment observed
    in this document's own real hard-wrap width ran 90-115 characters;
    60 is a conservative floor under that, so short lines stay standalone
    while long unterminated lines still merge correctly."""
    _WRAP_MIN_LEN = 60
    raw = [l.strip() for l in text.split('\n') if l.strip()]
    merged: list[str] = []
    for line in raw:
        starts_new = (
            not merged
            or bool(BULLET_LINE_RE.match(line))
            or _is_subheading(line)
            or _is_subheading(merged[-1])
            or bool(_SENTENCE_END_RE.search(merged[-1]))
            or len(merged[-1]) < _WRAP_MIN_LEN
        )
        if starts_new:
            merged.append(line)
        else:
            merged[-1] = f"{merged[-1]} {line}"
    return merged


def _classify_lines(text: str) -> list[tuple[str, str]]:
    """Real improvement (2026-08-18): many real resumes visually bullet
    every achievement/responsibility line under a role via the SOURCE
    PDF's own list formatting -- a layout property, not a literal
    character in the text stream -- so plain-text extraction silently
    drops that signal for any line that didn't happen to have a real '•'
    character. Confirmed directly against a real resume where an entire
    role's worth of achievement sentences ("Established internal order
    settlements...", "Implemented EBS reconciliation...") rendered with
    no bullet at all, reading as an undifferentiated wall of sentences,
    while OTHER roles nearby (which happened to have literal bullets in
    the extracted text) looked correct. Standard reverse-chronological
    resume convention bullets every real achievement sentence under a
    role while leaving the role's own title line and section headers
    alone -- this function reproduces that, conservatively:

    Returns [(display_text, kind), ...] where kind is 'subhead', 'bullet',
    or 'body'. A plain (non-already-bulleted, non-subheading) line only
    becomes an auto-bullet when ALL of: (a) we're inside a real
    PROFESSIONAL EXPERIENCE-style block -- seen a "professional
    experience"/"work experience"/"employment history" heading, OR a
    real "Employer:" line (a resume-specific signal just as strong even
    with no generic heading present); (b) it is NOT the line immediately
    after an "Employer:"/"Client:" line (that slot is almost always the
    role's own title, e.g. "SAP FICO Lead Constant" -- never an
    achievement); (c) it reads like a real sentence (ends with '.' or is
    a genuinely long line). Deliberately conservative in the same spirit
    as _is_subheading() above -- never applied outside a real experience
    block, so the PROFESSIONAL SUMMARY's own intro paragraph and other
    prose stay untouched. Known, accepted limitation: this resume's own
    source structure inconsistently places a role's title line after
    "Employer:" for some roles and after "Client:" for others -- when a
    title line is genuinely absent in a spot this heuristic expects one,
    the very next real achievement line is conservatively left
    unbulleted rather than risk a title line wrongly gaining a bullet."""
    out: list[tuple[str, str]] = []
    in_experience = False
    prev_was_role_header = False
    for p in _merge_wrapped_lines(text):
        bm = BULLET_LINE_RE.match(p)
        if bm:
            out.append((bm.group(2).strip(), 'bullet'))
            prev_was_role_header = False
            continue
        if _is_subheading(p):
            normalized = p.rstrip(':').strip().lower()
            low = p.lower()
            is_role_header = low.startswith('employer:') or low.startswith('client:')
            if normalized in ('professional experience', 'work experience', 'employment history') or is_role_header:
                in_experience = True
            out.append((p, 'subhead'))
            prev_was_role_header = is_role_header
            continue
        if in_experience and not prev_was_role_header and (p.endswith('.') or len(p) > 40):
            out.append((p, 'bullet'))
        else:
            out.append((p, 'body'))
        prev_was_role_header = False
    return out


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
    text = _strip_bullet_only_lines(text)
    text = _normalize_whitespace(text)
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


def _pdf_header_logo_flowables(cfg: dict) -> list:
    """Real improvement (2026-08-18, round 2): the logo moved from the
    footer to the page header per direct user feedback, with a genuine
    left/right placement choice -- reportlab's Image flowable already
    supports hAlign natively, so a real top-left/top-right header is just
    the image as the very first flowable with hAlign set accordingly (no
    absolute positioning/canvas tricks needed). Returns [] for
    logo_position="none" or a missing asset file."""
    pos = cfg.get("logo_position", "top_right")
    if pos not in ("top_left", "top_right") or not os.path.exists(LOGO_PATH):
        return []
    from reportlab.lib.units import cm
    from reportlab.platypus import Image, Spacer
    logo_w = 2.6 * cm
    logo_h = logo_w * (342 / 730)
    img = Image(LOGO_PATH, width=logo_w, height=logo_h)
    img.hAlign = "LEFT" if pos == "top_left" else "RIGHT"
    return [img, Spacer(1, 0.25 * cm)]


def _docx_header_logo(doc, cfg: dict) -> None:
    """DOCX analogue of _pdf_header_logo_flowables above -- python-docx
    positions an inline picture via the containing paragraph's own
    alignment (LEFT/RIGHT), inserted as the very first paragraph in the
    document."""
    pos = cfg.get("logo_position", "top_right")
    if pos not in ("top_left", "top_right") or not os.path.exists(LOGO_PATH):
        return
    from docx.shared import Cm
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT if pos == "top_left" else WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run().add_picture(LOGO_PATH, width=Cm(2.6))


def _pdf_footer_flowables(cfg: dict, client_line: Optional[str], small_style) -> list:
    """The footer now only ever carries the "Submitted for: <client>"
    line (job-specific generation context) -- the logo lives in the
    header, see _pdf_header_logo_flowables above."""
    from reportlab.lib.units import cm
    from reportlab.platypus import Paragraph, Spacer
    if not client_line:
        return []
    return [Spacer(1, 0.5 * cm), Paragraph(_esc(f"Submitted for: {client_line}"), small_style)]


def _docx_footer(doc, cfg: dict, client_line: Optional[str], *, italic: bool = True,
                  centered: bool = True, size: float = 9, color=None) -> None:
    """DOCX analogue of _pdf_footer_flowables above -- text-only now, the
    logo lives in the header (_docx_header_logo)."""
    from docx.shared import Pt
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    if client_line:
        fp = doc.add_paragraph()
        if centered:
            fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
        fr = fp.add_run(f"Submitted for: {client_line}")
        fr.italic = italic
        fr.font.size = Pt(size)
        if color is not None:
            fr.font.color.rgb = color


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
    # REAL BUG FIX (2026-08-18): reportlab's ParagraphStyle defaults
    # `leading` (line height) to a FIXED 12pt regardless of fontSize --
    # confirmed directly (`ParagraphStyle(fontSize=18).leading == 12`).
    # Every heading style below was larger than 12pt with no explicit
    # leading, so the text rendered taller than its allocated line box and
    # visually overlapped the paragraph right after it -- confirmed on a
    # real generated PDF (name and title overlapping at the very top of
    # the page). This has been true since the renderer was first built;
    # only surfaced now because this is the first time a generated PDF was
    # actually rendered to an image and inspected, rather than checked via
    # text extraction (which reveals content, not visual layout).
    h1 = ParagraphStyle("H1", fontSize=18, leading=22, textColor=DARK, fontName="Helvetica-Bold", alignment=TA_CENTER, spaceAfter=4)
    sub = ParagraphStyle("Sub", fontSize=11, leading=14, textColor=PRIMARY, fontName="Helvetica-Bold", alignment=TA_CENTER, spaceAfter=10)
    h2 = ParagraphStyle("H2", fontSize=11, leading=14, textColor=PRIMARY, fontName="Helvetica-Bold", spaceBefore=12, spaceAfter=6)
    body = ParagraphStyle("Body", fontSize=10, textColor=DARK, leading=15, fontName="Helvetica")
    # Real improvement (2026-08-18): bold in-body sub-headings (section
    # titles, "Employer:"/"Client:" lines) -- same size/color as body text
    # so it reads as emphasis, not a competing heading level against h2.
    subhead = ParagraphStyle("SubHead", fontSize=10, leading=15, textColor=DARK, fontName="Helvetica-Bold", spaceBefore=8, spaceAfter=2)
    small = ParagraphStyle("Small", fontSize=9, leading=11, textColor=GRAY, fontName="Helvetica")
    # Real improvement (2026-08-18): reportlab's `bulletText` param gives a
    # real hanging indent -- a wrapped bullet line's second line aligns
    # under the FIRST WORD after the bullet, not back at the left margin,
    # matching how a real bulleted list looks (confirmed against the
    # source document's own rendering). Rendering "• text" as one plain
    # string with no indent (the previous approach) left wrapped lines
    # flush left, visually indistinguishable from a new paragraph.
    bullet = ParagraphStyle("Bullet", fontSize=10, textColor=DARK, leading=15, fontName="Helvetica",
                             leftIndent=14, bulletIndent=0, spaceBefore=1, spaceAfter=1)

    display_name = mask_name(candidate.get("full_name") or "") if cfg["name_format"] == "masked" else (candidate.get("full_name") or "Candidate")
    story = _pdf_header_logo_flowables(cfg) + [
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
        # REAL BUG FIX (2026-08-18): this used to hard-cap the rendered
        # body at 2600 chars regardless of how much real content
        # _resolve_body_text() actually returned -- for a dense, multi-
        # role resume, the entire Professional Experience/Education/
        # Certifications section (everything past the opening summary
        # paragraph) was silently cut off with an ellipsis, even after
        # today's earlier fix restored the full text into the pipeline.
        # SimpleDocTemplate/python-docx both paginate naturally across as
        # many pages as the real content needs -- no reason to
        # artificially truncate before handing it to them.
        # Real improvement (2026-08-18): _classify_lines() auto-bullets real
        # achievement sentences under a role that never had a literal bullet
        # character in the extracted text -- a common case, since many
        # source resumes convey their bullets as a layout property of the
        # original document rather than a character in the text stream --
        # in addition to preserving lines that already had a real one.
        for line_text, kind in _classify_lines(text):
            if kind == 'bullet':
                story.append(Paragraph(_esc(line_text), bullet, bulletText='•'))
            elif kind == 'subhead':
                story.append(Paragraph(_esc(line_text), subhead))
            else:
                story.append(Paragraph(_esc(line_text), body))

    client_line = _client_line(client_name, cfg)
    story.extend(_pdf_footer_flowables(cfg, client_line, small))
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

    # REAL BUG FIX (2026-08-18): see the identical fix + explanation in
    # _render_pdf_classic above -- every style here missing an explicit
    # `leading` defaulted to reportlab's fixed 12pt regardless of fontSize.
    sb_label = ParagraphStyle("SbLabel", fontSize=9, leading=11, textColor=SIDEBAR_ACCENT, fontName="Helvetica-Bold", spaceBefore=10, spaceAfter=4)
    sb_body = ParagraphStyle("SbBody", fontSize=9, textColor=SIDEBAR_TEXT, leading=13, fontName="Helvetica")
    m_name = ParagraphStyle("MName", fontSize=20, leading=24, textColor=DARK, fontName="Helvetica-Bold", spaceAfter=4)
    m_title = ParagraphStyle("MTitle", fontSize=12, leading=15, textColor=PRIMARY, fontName="Helvetica-Bold", spaceAfter=14)
    m_h2 = ParagraphStyle("MH2", fontSize=11, leading=14, textColor=PRIMARY, fontName="Helvetica-Bold", spaceBefore=10, spaceAfter=6)
    m_body = ParagraphStyle("MBody", fontSize=10, textColor=DARK, leading=15, fontName="Helvetica")
    # Real improvement (2026-08-18): bold in-body sub-headings, matching
    # the identical addition in _render_pdf_classic above.
    m_subhead = ParagraphStyle("MSubHead", fontSize=10, leading=15, textColor=DARK, fontName="Helvetica-Bold", spaceBefore=8, spaceAfter=2)
    # Real improvement (2026-08-18): hanging-indent bullets, matching the
    # identical addition in _render_pdf_classic above.
    m_bullet = ParagraphStyle("MBullet", fontSize=10, textColor=DARK, leading=15, fontName="Helvetica",
                               leftIndent=12, bulletIndent=0, spaceBefore=1, spaceAfter=1)
    small = ParagraphStyle("Small", fontSize=8, leading=10, textColor=GRAY, fontName="Helvetica")

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
        # REAL BUG FIX (2026-08-18): unlike the classic/minimal themes,
        # this theme's sidebar+main layout is ONE reportlab Table row --
        # reportlab cannot split a single Table row across pages, so an
        # uncapped (or insufficiently capped) body throws "too large on
        # page N" and generation fails outright. The main column is
        # narrower than a full-width page (~68%), so it wraps into
        # meaningfully more lines per character than the classic theme's
        # full-width column -- confirmed empirically that even 2600 chars
        # still overflowed a page here; 1400 reliably fits with real
        # header/sidebar content alongside it. A sidebar/infographic-style
        # resume is conventionally a single-page format by design anyway
        # (unlike the classic/minimal themes, which render a traditional
        # flowing resume and were deliberately left uncapped this same
        # day) -- not an attempt at true multi-page two-column pagination.
        snippet = text[:1400] + ("…" if len(text) > 1400 else "")
        for line_text, kind in _classify_lines(snippet):
            if kind == 'bullet':
                main.append(Paragraph(_esc(line_text), m_bullet, bulletText='•'))
            elif kind == 'subhead':
                main.append(Paragraph(_esc(line_text), m_subhead))
            else:
                main.append(Paragraph(_esc(line_text), m_body))
    client_line = _client_line(client_name, cfg)
    main.extend(_pdf_footer_flowables(cfg, client_line, small))

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

    # Real improvement (2026-08-18, round 2): this theme's doc margins are
    # all 0 (a deliberate full-bleed design for the colored sidebar block)
    # -- a bare Image flowable would sit flush against the page edge with
    # no breathing room, so the header logo gets wrapped in its own real
    # one-cell Table purely for real left/right padding, matching this
    # theme's own established idiom of controlling spacing via Table
    # padding rather than doc margins.
    header_flows = []
    logo_pos = cfg.get("logo_position", "top_right")
    if logo_pos in ("top_left", "top_right") and os.path.exists(LOGO_PATH):
        logo_w = 2.6 * cm
        logo_h = logo_w * (342 / 730)
        from reportlab.platypus import Image
        logo_img = Image(LOGO_PATH, width=logo_w, height=logo_h)
        logo_img.hAlign = "LEFT" if logo_pos == "top_left" else "RIGHT"
        header_row = Table([[logo_img]], colWidths=[page_w])
        header_row.setStyle(TableStyle([
            ("LEFTPADDING", (0, 0), (-1, -1), 0.9 * cm), ("RIGHTPADDING", (0, 0), (-1, -1), 0.9 * cm),
            ("TOPPADDING", (0, 0), (-1, -1), 0.6 * cm), ("BOTTOMPADDING", (0, 0), (-1, -1), 0.3 * cm),
        ]))
        header_flows = [header_row]

    doc.build(header_flows + [table])
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
    # REAL BUG FIX (2026-08-18): see the identical fix + explanation in
    # _render_pdf_classic above.
    h1 = ParagraphStyle("H1", fontSize=16, leading=19, textColor=BLACK, fontName="Helvetica-Bold", spaceAfter=4)
    sub = ParagraphStyle("Sub", fontSize=11, leading=14, textColor=BLACK, fontName="Helvetica", spaceAfter=8)
    h2 = ParagraphStyle("H2", fontSize=10.5, leading=13, textColor=BLACK, fontName="Helvetica-Bold", spaceBefore=12, spaceAfter=5)
    body = ParagraphStyle("Body", fontSize=10, textColor=BLACK, leading=14, fontName="Helvetica")
    # Real improvement (2026-08-18): bold in-body sub-headings, matching
    # the identical addition in _render_pdf_classic above.
    subhead = ParagraphStyle("SubHead", fontSize=10, leading=14, textColor=BLACK, fontName="Helvetica-Bold", spaceBefore=8, spaceAfter=2)
    # Real improvement (2026-08-18): hanging-indent bullets, matching the
    # identical addition in _render_pdf_classic above.
    bullet = ParagraphStyle("Bullet", fontSize=10, textColor=BLACK, leading=14, fontName="Helvetica",
                             leftIndent=14, bulletIndent=0, spaceBefore=1, spaceAfter=1)
    small = ParagraphStyle("Small", fontSize=8.5, leading=10.5, textColor=GRAY, fontName="Helvetica")

    display_name = mask_name(candidate.get("full_name") or "") if cfg["name_format"] == "masked" else (candidate.get("full_name") or "Candidate")
    story = _pdf_header_logo_flowables(cfg) + [Paragraph(_esc(display_name), h1)]
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
        # REAL BUG FIX (2026-08-18): this used to hard-cap the rendered
        # body at 2600 chars regardless of how much real content
        # _resolve_body_text() actually returned -- for a dense, multi-
        # role resume, the entire Professional Experience/Education/
        # Certifications section (everything past the opening summary
        # paragraph) was silently cut off with an ellipsis, even after
        # today's earlier fix restored the full text into the pipeline.
        # SimpleDocTemplate/python-docx both paginate naturally across as
        # many pages as the real content needs -- no reason to
        # artificially truncate before handing it to them.
        for line_text, kind in _classify_lines(text):
            if kind == 'bullet':
                story.append(Paragraph(_esc(line_text), bullet, bulletText='•'))
            elif kind == 'subhead':
                story.append(Paragraph(_esc(line_text), subhead))
            else:
                story.append(Paragraph(_esc(line_text), body))

    client_line = _client_line(client_name, cfg)
    story.extend(_pdf_footer_flowables(cfg, client_line, small))
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

    _docx_header_logo(doc, cfg)

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
        # REAL BUG FIX (2026-08-18): this used to hard-cap the rendered
        # body at 2600 chars regardless of how much real content
        # _resolve_body_text() actually returned -- for a dense, multi-
        # role resume, the entire Professional Experience/Education/
        # Certifications section (everything past the opening summary
        # paragraph) was silently cut off with an ellipsis, even after
        # today's earlier fix restored the full text into the pipeline.
        # SimpleDocTemplate/python-docx both paginate naturally across as
        # many pages as the real content needs -- no reason to
        # artificially truncate before handing it to them.
        # Real improvement (2026-08-18): a real bulleted paragraph (Word's
        # built-in "List Bullet" style, available by default -- no custom
        # numbering XML needed) instead of a literal "• " prefix on a plain
        # paragraph, which had no hanging indent -- a wrapped bullet line
        # fell back to the left margin instead of aligning under the text.
        for line_text, kind in _classify_lines(text):
            if kind == 'bullet':
                doc.add_paragraph(line_text, style='List Bullet')
                continue
            pp = doc.add_paragraph()
            r = pp.add_run(line_text)
            if kind == 'subhead':
                r.bold = True
                r.font.color.rgb = DARK

    client_line = _client_line(client_name, cfg)
    _docx_footer(doc, cfg, client_line)

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

    _docx_header_logo(doc, cfg)

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
        # REAL BUG FIX (2026-08-18): kept capped, matching the PDF sidebar
        # renderer -- a sidebar/infographic-style layout is a one-page
        # design by convention (unlike the classic/minimal themes, which
        # render a traditional flowing resume and were deliberately left
        # uncapped this same day). Keeps PDF/DOCX output consistent for
        # the same theme rather than one paginating and the other not.
        snippet = text[:2600] + ("…" if len(text) > 2600 else "")
        for line_text, kind in _classify_lines(snippet):
            if kind == 'bullet':
                right.add_paragraph(line_text, style='List Bullet')
                continue
            pp = right.add_paragraph()
            r = pp.add_run(line_text)
            if kind == 'subhead':
                r.bold = True
                r.font.color.rgb = DARK

    client_line = _client_line(client_name, cfg)
    _docx_footer(doc, cfg, client_line)

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

    _docx_header_logo(doc, cfg)

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
        # REAL BUG FIX (2026-08-18): this used to hard-cap the rendered
        # body at 2600 chars regardless of how much real content
        # _resolve_body_text() actually returned -- for a dense, multi-
        # role resume, the entire Professional Experience/Education/
        # Certifications section (everything past the opening summary
        # paragraph) was silently cut off with an ellipsis, even after
        # today's earlier fix restored the full text into the pipeline.
        # SimpleDocTemplate/python-docx both paginate naturally across as
        # many pages as the real content needs -- no reason to
        # artificially truncate before handing it to them.
        for line_text, kind in _classify_lines(text):
            if kind == 'bullet':
                doc.add_paragraph(line_text, style='List Bullet')
                continue
            pp = doc.add_paragraph()
            r = pp.add_run(line_text)
            if kind == 'subhead':
                r.bold = True
                r.font.color.rgb = BLACK

    client_line = _client_line(client_name, cfg)
    _docx_footer(doc, cfg, client_line, italic=False, centered=False, size=8.5, color=GRAY)

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()
