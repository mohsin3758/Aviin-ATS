"""HTML (from a browser contentEditable rich-text editor) -> a small,
explicit block model -> real reportlab PDF flowables and real python-docx
elements.

Scope, stated plainly rather than silently under-delivered (mirrors this
codebase's own established convention, see template_merge.py): supports
exactly what the resume content editor's toolbar can produce -- bold,
italic, underline, strikethrough, font family/size/color, paragraphs,
bullet and numbered lists, real tables, and a horizontal rule. Not a
general-purpose HTML renderer; unknown tags are ignored (their text
content still comes through as plain text, never silently dropped).

Font family is deliberately restricted to RICH_TEXT_FONTS (see below) on
BOTH outputs, even though DOCX could in principle accept any font name --
consistency between what a PDF and a DOCX of the same edit look like
matters more than DOCX alone supporting more fonts. reportlab ships only
14 standard PDF fonts with no arbitrary-TTF embedding wired up here, so
this is the real ceiling.
"""
from __future__ import annotations

from html.parser import HTMLParser
from typing import Optional, TypedDict


class Run(TypedDict):
    text: str
    bold: bool
    italic: bool
    underline: bool
    strike: bool
    size: Optional[int]   # points
    font: Optional[str]   # one of RICH_TEXT_FONTS' keys
    color: Optional[str]  # "#rrggbb"


class Block(TypedDict, total=False):
    type: str  # "p" | "bullet" | "number" | "table" | "hr"
    runs: list[Run]
    rows: list[list[list[Run]]]  # table only: rows of cells of runs


# label -> (reportlab font family base name, docx font name). reportlab's
# built-in fonts are Helvetica/Times-Roman/Courier (+ Bold/Oblique/Italic
# variants) -- Arial/Georgia/Verdana/etc have no built-in PDF equivalent
# without embedding a real TTF, which this renderer doesn't do. Mapped to
# the closest real built-in rather than silently falling back to whatever
# the surrounding style already was, so a font choice always visibly does
# something on both outputs. Keys are real, normal web-safe font names
# (matching exactly what the resume editor's own font picker offers, see
# ResumeGeneratorModal.tsx's RESUME_FONTS) -- _normalize_font_face below
# maps whatever a real browser actually emits (e.g. "Arial", "arial,
# sans-serif", "Georgia" as a close-enough Times substitute) onto these.
RICH_TEXT_FONTS: dict[str, tuple[str, str]] = {
    "Arial": ("Helvetica", "Arial"),
    "Times New Roman": ("Times-Roman", "Times New Roman"),
    "Courier New": ("Courier", "Courier New"),
}


def _normalize_font_face(face: str) -> Optional[str]:
    """A real browser's execCommand('fontName', ...) / CSS font-family
    can come back as a bare name, a comma-separated stack, or a close
    relative (Georgia/Cambria read as serif, Verdana/Tahoma as
    sans-serif) -- matched to whichever of the 3 real supported fonts
    it most resembles, never silently dropped as unrecognized."""
    f = (face or "").split(",")[0].strip().strip("'\"").lower()
    if not f:
        return None
    if "courier" in f or "consolas" in f or "mono" in f:
        return "Courier New"
    if "times" in f or "georgia" in f or "cambria" in f or "serif" in f:
        return "Times New Roman"
    return "Arial"

# HTML legacy <font size="1-7"> scale -> real point size, matching the
# exact same scale already used by the proven email-compose rich-text
# editor (frontend/app/(dashboard)/conversations/page.tsx's own SIZES
# array) so a size picked here means the same thing a KAE already knows
# from that editor.
_HTML_SIZE_TO_PT = {1: 6, 2: 8, 3: 10, 4: 12, 5: 14, 6: 18, 7: 24}

_BLOCK_TAGS = {"p", "div"}
_BREAK_TAGS = {"br"}
_BOLD_TAGS = {"b", "strong"}
_ITALIC_TAGS = {"i", "em"}
_UNDERLINE_TAGS = {"u"}
_STRIKE_TAGS = {"strike", "s", "del"}
_LIST_TAGS = {"ul", "ol"}
_ITEM_TAGS = {"li"}
_TABLE_TAGS = {"table"}
_ROW_TAGS = {"tr"}
_CELL_TAGS = {"td", "th"}
_HR_TAGS = {"hr"}
_IGNORED_TAGS = {"html", "head", "body", "meta", "style", "script"}


def _empty_run_state() -> dict:
    return {"bold": False, "italic": False, "underline": False, "strike": False,
            "size": None, "font": None, "color": None}


def _parse_style_attr(style: str) -> dict:
    """A deliberately simple property:value; parser -- covers the real
    CSS properties browsers actually emit for execCommand output
    (font-weight, font-style, text-decoration, color, font-size,
    font-family), not general CSS."""
    out: dict = {}
    for decl in (style or "").split(";"):
        if ":" not in decl:
            continue
        k, v = decl.split(":", 1)
        out[k.strip().lower()] = v.strip()
    return out


def _color_to_hex(v: str) -> Optional[str]:
    v = (v or "").strip()
    if v.startswith("#"):
        return v[:7]
    if v.startswith("rgb"):
        nums = [n.strip() for n in v[v.find("(") + 1:v.find(")")].split(",")]
        try:
            r, g, b = (int(float(n)) for n in nums[:3])
            return f"#{r:02x}{g:02x}{b:02x}"
        except (ValueError, IndexError):
            return None
    return None


class _RichTextParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks: list[Block] = []
        self._run_stack: list[dict] = [_empty_run_state()]
        self._cur_runs: list[Run] = []
        self._list_stack: list[str] = []  # "ul" | "ol" per nesting level
        self._list_item_index: list[int] = []
        self._in_table = 0
        self._table_rows: list[list[list[Run]]] = []
        self._table_cur_row: list[list[Run]] = []
        self._skip_depth = 0  # inside <style>/<script>

    def _current_state(self) -> dict:
        return dict(self._run_stack[-1])

    def _flush_paragraph(self, kind: str = "p"):
        if self._cur_runs:
            block: Block = {"type": kind, "runs": self._cur_runs}
            if kind == "number" and self._list_item_index:
                block["n"] = self._list_item_index[-1]
            self.blocks.append(block)
        self._cur_runs = []

    def _append_text(self, data: str):
        if not data:
            return
        if self._in_table:
            state = self._current_state()
            self._table_cur_row_append(data, state)
            return
        state = self._current_state()
        self._cur_runs.append({"text": data, **state})

    def _table_cur_row_append(self, data: str, state: dict):
        if not self._table_cur_row:
            return
        cell_runs = self._table_cur_row[-1]
        cell_runs.append({"text": data, **state})

    def handle_starttag(self, tag, attrs):
        attrs_d = dict(attrs)
        if tag in _IGNORED_TAGS:
            if tag in ("style", "script"):
                self._skip_depth += 1
            return
        if tag in _BREAK_TAGS:
            self._append_text("\n")
            return
        if tag in _HR_TAGS:
            self._flush_paragraph()
            self.blocks.append({"type": "hr"})
            return
        if tag in _BOLD_TAGS:
            self._run_stack.append({**self._current_state(), "bold": True})
            return
        if tag in _ITALIC_TAGS:
            self._run_stack.append({**self._current_state(), "italic": True})
            return
        if tag in _UNDERLINE_TAGS:
            self._run_stack.append({**self._current_state(), "underline": True})
            return
        if tag in _STRIKE_TAGS:
            self._run_stack.append({**self._current_state(), "strike": True})
            return
        if tag == "font":
            state = self._current_state()
            if attrs_d.get("size"):
                try:
                    state["size"] = _HTML_SIZE_TO_PT.get(int(float(attrs_d["size"])))
                except ValueError:
                    pass
            if attrs_d.get("face"):
                state["font"] = _normalize_font_face(attrs_d["face"]) or state["font"]
            if attrs_d.get("color"):
                state["color"] = _color_to_hex(attrs_d["color"]) or state["color"]
            self._run_stack.append(state)
            return
        if tag == "span":
            state = self._current_state()
            css = _parse_style_attr(attrs_d.get("style", ""))
            if css.get("font-weight") in ("bold", "700", "800", "900"):
                state["bold"] = True
            if css.get("font-style") == "italic":
                state["italic"] = True
            if "underline" in (css.get("text-decoration") or ""):
                state["underline"] = True
            if "line-through" in (css.get("text-decoration") or ""):
                state["strike"] = True
            if css.get("color"):
                state["color"] = _color_to_hex(css["color"]) or state["color"]
            if css.get("font-family"):
                state["font"] = _normalize_font_face(css["font-family"]) or state["font"]
            if css.get("font-size"):
                px = css["font-size"].replace("px", "").strip()
                try:
                    state["size"] = round(float(px) * 0.75)
                except ValueError:
                    pass
            self._run_stack.append(state)
            return
        if tag in _BLOCK_TAGS:
            self._flush_paragraph()
            return
        if tag in _LIST_TAGS:
            self._flush_paragraph()
            self._list_stack.append(tag)
            self._list_item_index.append(0)
            return
        if tag in _ITEM_TAGS:
            self._flush_paragraph()
            if self._list_stack and self._list_stack[-1] == "ol":
                self._list_item_index[-1] += 1
            return
        if tag in _TABLE_TAGS:
            self._flush_paragraph()
            self._in_table += 1
            self._table_rows = []
            return
        if tag in _ROW_TAGS:
            self._table_cur_row = []
            return
        if tag in _CELL_TAGS:
            self._table_cur_row.append([])
            return

    def handle_endtag(self, tag):
        if tag in ("style", "script"):
            self._skip_depth = max(0, self._skip_depth - 1)
            return
        if tag in (_BOLD_TAGS | _ITALIC_TAGS | _UNDERLINE_TAGS | _STRIKE_TAGS | {"font", "span"}):
            if len(self._run_stack) > 1:
                self._run_stack.pop()
            return
        if tag in _BLOCK_TAGS:
            self._flush_paragraph()
            return
        if tag in _ITEM_TAGS:
            kind = "number" if (self._list_stack and self._list_stack[-1] == "ol") else "bullet"
            self._flush_paragraph(kind)
            return
        if tag in _LIST_TAGS:
            self._flush_paragraph()
            if self._list_stack:
                self._list_stack.pop()
                self._list_item_index.pop()
            return
        if tag in _ROW_TAGS:
            if self._table_cur_row:
                self._table_rows.append(self._table_cur_row)
            self._table_cur_row = []
            return
        if tag in _TABLE_TAGS:
            self._in_table = max(0, self._in_table - 1)
            if self._table_rows:
                self.blocks.append({"type": "table", "rows": self._table_rows})
            self._table_rows = []
            return

    def handle_data(self, data):
        if self._skip_depth:
            return
        self._append_text(data)

    def close(self):
        super().close()
        self._flush_paragraph()


def parse_html_blocks(html: str) -> list[Block]:
    """Real, live-typed content (a KAE's own edit) -> the block model
    every renderer below consumes. Never raises on malformed input --
    HTMLParser degrades gracefully on its own; worst case is a block
    boundary landing in a slightly different place, never lost text."""
    if not html or not html.strip():
        return []
    parser = _RichTextParser()
    parser.feed(html)
    parser.close()
    # A block-boundary text node (whitespace between tags in the source
    # markup, or a bare "<div><br></div>" blank contentEditable line) has
    # no real content of its own -- paragraph spacing already gives
    # visual separation, so an empty "p" block would only ever add a
    # stray blank line downstream. bullet/number/table/hr are kept as-is
    # even if empty -- those are structurally meaningful (a real, if
    # blank, list item or table cell), never accidental whitespace.
    return [b for b in parser.blocks
            if b["type"] != "p" or "".join(r["text"] for r in b.get("runs", [])).strip()]


def blocks_to_plain_text(blocks: list[Block]) -> str:
    """Real fallback for a visual theme that hasn't been upgraded to
    render real Table/list flowables yet (see resume_formatting.py) --
    every visual theme still shows the KAE's real edited words, just
    without table/list layout, rather than silently reverting to the
    pre-edit auto-extracted text."""
    lines = []
    for b in blocks:
        if b["type"] == "hr":
            lines.append("---")
        elif b["type"] == "table":
            for row in b.get("rows", []):
                lines.append(" | ".join("".join(r["text"] for r in cell) for cell in row))
        else:
            prefix = "• " if b["type"] == "bullet" else (f"{b.get('n', 1)}. " if b["type"] == "number" else "")
            lines.append(prefix + "".join(r["text"] for r in b.get("runs", [])))
    return "\n".join(lines)


# ─────────────────────────── PDF (reportlab) ───────────────────────────

def _esc_xml(text: str) -> str:
    from xml.sax.saxutils import escape
    return escape(text)


def _runs_to_reportlab_markup(runs: list[Run]) -> str:
    out = []
    for r in runs:
        t = _esc_xml(r["text"]).replace("\n", "<br/>")
        size_attr = f' size="{r["size"]}"' if r.get("size") else ""
        color_attr = f' color="{r["color"]}"' if r.get("color") else ""
        face_attr = f' face="{RICH_TEXT_FONTS[r["font"]][0]}"' if r.get("font") in RICH_TEXT_FONTS else ""
        if size_attr or color_attr or face_attr:
            t = f"<font{face_attr}{size_attr}{color_attr}>{t}</font>"
        if r.get("bold"):
            t = f"<b>{t}</b>"
        if r.get("italic"):
            t = f"<i>{t}</i>"
        if r.get("underline"):
            t = f"<u>{t}</u>"
        if r.get("strike"):
            t = f"<strike>{t}</strike>"
        out.append(t)
    return "".join(out)


def blocks_to_pdf_flowables(blocks: list[Block], body_style, bullet_style, heading_style=None) -> list:
    """Real Paragraph/Table/HRFlowable flowables from the block model --
    body_style/bullet_style are the caller's own ParagraphStyle objects
    (each visual theme already defines its own body/bullet look; this
    stays theme-agnostic and just reuses whichever style the caller's
    own theme passes in, matching every other themed section already
    built this way in resume_formatting.py)."""
    from reportlab.platypus import Paragraph, Table, TableStyle, HRFlowable
    from reportlab.lib import colors as rl_colors

    flowables = []
    for b in blocks:
        if b["type"] == "hr":
            flowables.append(HRFlowable(width="100%", thickness=0.75, color=rl_colors.HexColor("#cbd5e1"), spaceBefore=4, spaceAfter=4))
        elif b["type"] == "table":
            data = [[Paragraph(_runs_to_reportlab_markup(cell) or "&nbsp;", body_style) for cell in row] for row in b.get("rows", [])]
            if not data:
                continue
            tbl = Table(data, repeatRows=1)
            tbl.setStyle(TableStyle([
                ("GRID", (0, 0), (-1, -1), 0.75, rl_colors.HexColor("#cbd5e1")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("BACKGROUND", (0, 0), (-1, 0), rl_colors.HexColor("#f1f5f9")),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]))
            flowables.append(tbl)
        else:
            markup = _runs_to_reportlab_markup(b.get("runs", []))
            if not markup.strip():
                continue
            if b["type"] == "bullet":
                flowables.append(Paragraph(markup, bullet_style, bulletText="•"))
            elif b["type"] == "number":
                flowables.append(Paragraph(markup, bullet_style, bulletText=f"{b.get('n', 1)}."))
            else:
                flowables.append(Paragraph(markup, body_style))
    return flowables


# ─────────────────────────── DOCX (python-docx) ───────────────────────────

def blocks_to_docx(doc, blocks: list[Block]):
    """Appends real paragraphs/lists/tables/rules onto an existing
    python-docx Document, in place -- mirrors blocks_to_pdf_flowables'
    same block model so both outputs come from one real edit."""
    from docx.shared import Pt, RGBColor
    from docx.oxml.ns import qn
    from docx.oxml import OxmlElement

    def apply_runs(paragraph, runs: list[Run]):
        for r in runs:
            for line_i, line in enumerate(r["text"].split("\n")):
                if line_i > 0:
                    paragraph.add_run().add_break()
                if not line:
                    continue
                run = paragraph.add_run(line)
                run.bold = bool(r.get("bold"))
                run.italic = bool(r.get("italic"))
                run.underline = bool(r.get("underline"))
                if r.get("strike"):
                    run.font.strike = True
                if r.get("size"):
                    run.font.size = Pt(r["size"])
                if r.get("font") in RICH_TEXT_FONTS:
                    run.font.name = RICH_TEXT_FONTS[r["font"]][1]
                if r.get("color"):
                    hexs = r["color"].lstrip("#")
                    if len(hexs) == 6:
                        run.font.color.rgb = RGBColor.from_string(hexs.upper())

    for b in blocks:
        if b["type"] == "hr":
            p = doc.add_paragraph()
            p_pr = p._p.get_or_add_pPr()
            border = OxmlElement("w:pBdr")
            bottom = OxmlElement("w:bottom")
            bottom.set(qn("w:val"), "single")
            bottom.set(qn("w:sz"), "6")
            bottom.set(qn("w:color"), "cbd5e1")
            border.append(bottom)
            p_pr.append(border)
        elif b["type"] == "table":
            rows = b.get("rows", [])
            if not rows:
                continue
            ncols = max(len(r) for r in rows)
            tbl = doc.add_table(rows=len(rows), cols=ncols)
            tbl.style = "Table Grid"
            for ri, row in enumerate(rows):
                for ci, cell_runs in enumerate(row):
                    cell_p = tbl.cell(ri, ci).paragraphs[0]
                    apply_runs(cell_p, cell_runs)
        else:
            style = "List Bullet" if b["type"] == "bullet" else ("List Number" if b["type"] == "number" else None)
            p = doc.add_paragraph(style=style)
            apply_runs(p, b.get("runs", []))
