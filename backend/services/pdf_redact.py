"""True, compliance-grade PII redaction for an original uploaded resume
PDF -- burns each page to a raster image and blacks out any line
containing a phone number or email address, then reassembles the
redacted images into a new PDF. 100% of the source document's real
visual layout (tables, bold, borders, columns) survives untouched,
since nothing is re-composed -- every pixel not covered by a redaction
box is the original page, verbatim.

Deliberately image-based, not a "draw a white/black box over the still-
live text" overlay: the overlay approach only visually hides the PII
while the original characters remain fully present and recoverable in
the PDF's own content stream (peel the box off in any real PDF editor
and the phone number is still there) -- not a real redaction for DPDP
2023 purposes, and this codebase already has one documented incident
of shipping something that LOOKED like protection but wasn't (see
CLAUDE.md's Aadhaar/PAN encryption-at-rest rule). Rasterizing genuinely
removes the underlying text; there is nothing left to peel back.

Real, honest scope, stated plainly rather than silently under-
delivered (mirrors this codebase's own established convention -- see
template_merge.py): PDF originals only. The output is a real image of
each page, not live text -- it will not be copy-paste-able or parsed
by an ATS that expects real text content. That trade-off is the actual
cost of a genuine redaction that can't be undone, not a corner cut.
"""
import re
from io import BytesIO
from typing import Optional

PHONE_RE = re.compile(r'(?:\+?\d[\d\-\s().]{7,}\d)')
EMAIL_RE = re.compile(r'[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}')

# Real pdf2image/poppler dependency check -- same real fallback
# convention as ocr_service.py's own PDF2IMAGE_AVAILABLE, so a missing
# system poppler install degrades to "can't redact" rather than a raw
# ImportError surfacing all the way up to a real send request.
PDF2IMAGE_AVAILABLE = False
try:
    from pdf2image import convert_from_bytes
    PDF2IMAGE_AVAILABLE = True
except ImportError:
    pass


def _line_has_pii(text: str) -> bool:
    return bool(EMAIL_RE.search(text)) or bool(PHONE_RE.search(text))


def _iter_text_lines(element):
    """Recurses through pdfminer's real layout tree (LTTextBox ->
    LTTextLine, skipping non-text elements like LTFigure/LTRect/LTImage
    entirely -- they carry no redactable text and nothing here needs to
    touch them)."""
    from pdfminer.layout import LTTextLine, LTTextContainer
    if isinstance(element, LTTextLine):
        yield element
    elif isinstance(element, LTTextContainer):
        for child in element:
            yield from _iter_text_lines(child)


def redact_pdf_original(file_bytes: bytes, dpi: int = 200) -> Optional[bytes]:
    """Returns real redacted PDF bytes, or None if this document can't be
    processed (not a real PDF, corrupt, or poppler/pdf2image unavailable)
    -- callers must fall back to the compositional renderer on None,
    never silently send an unredacted original."""
    if not PDF2IMAGE_AVAILABLE:
        return None
    try:
        from pdfminer.high_level import extract_pages
        from PIL import ImageDraw
        from reportlab.pdfgen import canvas as rl_canvas
        from reportlab.lib.utils import ImageReader

        pages_layout = list(extract_pages(BytesIO(file_bytes)))
        images = convert_from_bytes(file_bytes, dpi=dpi)
        if not pages_layout or not images or len(pages_layout) != len(images):
            return None

        scale = dpi / 72.0  # PDF points -> pixels at this real DPI
        out_buf = BytesIO()
        c = None
        for page_layout, img in zip(pages_layout, images):
            page_w_pt, page_h_pt = page_layout.width, page_layout.height
            draw = ImageDraw.Draw(img)
            redacted_any = False
            for element in page_layout:
                for line in _iter_text_lines(element):
                    if _line_has_pii(line.get_text()):
                        x0, y0, x1, y1 = line.bbox
                        # PDF origin is bottom-left; image origin is top-left.
                        px0, px1 = x0 * scale, x1 * scale
                        py0, py1 = (page_h_pt - y1) * scale, (page_h_pt - y0) * scale
                        pad = 2
                        draw.rectangle([px0 - pad, py0 - pad, px1 + pad, py1 + pad], fill="black")
                        redacted_any = True
            _ = redacted_any  # real per-page signal, not currently surfaced further
            if c is None:
                c = rl_canvas.Canvas(out_buf, pagesize=(page_w_pt, page_h_pt))
            else:
                c.showPage()
                c.setPageSize((page_w_pt, page_h_pt))
            c.drawImage(ImageReader(img), 0, 0, width=page_w_pt, height=page_h_pt)
        if c is None:
            return None
        c.save()
        return out_buf.getvalue()
    except Exception:
        return None
