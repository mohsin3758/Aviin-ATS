"""
Phase D: OCR Service
Extracts text from scanned PDFs, images (JPG/PNG/TIFF), and mixed documents.
Uses tesseract + poppler. Falls back gracefully if not installed.

Strategy:
1. Try pdfminer first (fast, for text-based PDFs)
2. If text is too short → it's probably a scanned PDF → use OCR
3. For image files (JPG/PNG/TIFF) → use OCR directly
4. Return (text, method, confidence) for every file

Zero API cost. 100% free and offline.
"""
import re
import os
import sys
from pathlib import Path
from io import BytesIO
from typing import Optional

# ── OCR availability check ────────────────────────────────────────────────────
OCR_AVAILABLE = False
try:
    import pytesseract
    from PIL import Image
    OCR_AVAILABLE = True
except ImportError:
    pass

PDF2IMAGE_AVAILABLE = False
try:
    from pdf2image import convert_from_bytes, convert_from_path
    PDF2IMAGE_AVAILABLE = True
except ImportError:
    pass

PDFMINER_AVAILABLE = False
try:
    from pdfminer.high_level import extract_text as pdfminer_extract_text
    PDFMINER_AVAILABLE = True
except ImportError:
    pass

# Minimum characters to consider pdfminer extraction successful
PDFMINER_MIN_CHARS = 100

# Supported image MIME types for direct OCR
IMAGE_MIMES = {
    'image/jpeg', 'image/jpg', 'image/png', 'image/tiff',
    'image/tif', 'image/bmp', 'image/webp',
}
IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.tiff', '.tif', '.bmp', '.webp'}


def is_ocr_available() -> bool:
    """Check if OCR stack is fully installed."""
    return OCR_AVAILABLE and PDF2IMAGE_AVAILABLE


def detect_is_scanned(pdf_data: bytes, pdfminer_text: str) -> bool:
    """
    Detect if a PDF is scanned (image-only) based on:
    1. Very little text extracted by pdfminer
    2. File size suggests images (large file, little text)
    """
    text_len = len((pdfminer_text or '').strip())
    file_size = len(pdf_data)

    # If pdfminer got enough text → not scanned
    if text_len >= PDFMINER_MIN_CHARS:
        return False

    # Small file with some text → probably just a short doc, not scanned
    if file_size < 50_000 and text_len > 20:
        return False

    # Large file but almost no text → almost certainly scanned
    if file_size > 100_000 and text_len < 50:
        return True

    # Zero text and non-trivial file → scanned
    if text_len == 0 and file_size > 10_000:
        return True

    return text_len < PDFMINER_MIN_CHARS


def ocr_pdf(pdf_data: bytes, dpi: int = 200, max_pages: int = 8) -> tuple[str, float]:
    """
    Extract text from scanned PDF using OCR.
    Returns (text, confidence) where confidence is 0.0-1.0.
    """
    if not (OCR_AVAILABLE and PDF2IMAGE_AVAILABLE):
        return '', 0.0

    try:
        # Convert PDF pages to images
        images = convert_from_bytes(
            pdf_data,
            dpi=dpi,
            first_page=1,
            last_page=max_pages,
            fmt='jpeg',
            grayscale=True,   # Grayscale is faster and often better for text
        )
        if not images:
            return '', 0.0

        all_text = []
        total_conf = 0.0
        page_count = 0

        for img in images:
            try:
                # Get text with confidence data
                data = pytesseract.image_to_data(
                    img,
                    lang='eng',
                    output_type=pytesseract.Output.DICT,
                    config='--psm 3 --oem 3'  # Auto page segmentation, LSTM
                )
                # Extract words with confidence >= 30
                page_text_parts = []
                page_conf_sum = 0
                page_conf_count = 0
                for j, word in enumerate(data['text']):
                    conf = int(data['conf'][j])
                    if conf >= 0:  # -1 means not OCR'd
                        if conf >= 30 and word.strip():
                            page_text_parts.append(word)
                        if conf >= 0:
                            page_conf_sum += max(conf, 0)
                            page_conf_count += 1

                page_text = ' '.join(page_text_parts)
                all_text.append(page_text)
                if page_conf_count > 0:
                    total_conf += page_conf_sum / page_conf_count
                page_count += 1
            except Exception:
                # Try simple extraction as fallback for this page
                try:
                    page_text = pytesseract.image_to_string(img, lang='eng',
                                                              config='--psm 3 --oem 3')
                    all_text.append(page_text)
                    page_count += 1
                    total_conf += 50.0  # Unknown confidence, assume medium
                except Exception:
                    pass

        combined = '\n'.join(all_text).strip()
        avg_conf = (total_conf / page_count / 100.0) if page_count > 0 else 0.0
        return combined, round(min(avg_conf, 1.0), 3)

    except Exception as e:
        print(f'[OCR] PDF OCR error: {e}')
        return '', 0.0


def ocr_image(image_data: bytes, mime_type: str = '') -> tuple[str, float]:
    """
    Extract text from image file (JPG/PNG/TIFF) using OCR.
    Returns (text, confidence).
    """
    if not OCR_AVAILABLE:
        return '', 0.0

    try:
        img = Image.open(BytesIO(image_data))
        # Convert to grayscale for better OCR
        if img.mode not in ('L', 'RGB'):
            img = img.convert('RGB')

        data = pytesseract.image_to_data(
            img, lang='eng',
            output_type=pytesseract.Output.DICT,
            config='--psm 3 --oem 3'
        )
        words = []
        conf_sum = 0
        conf_count = 0
        for j, word in enumerate(data['text']):
            conf = int(data['conf'][j])
            if conf >= 30 and word.strip():
                words.append(word)
            if conf >= 0:
                conf_sum += max(conf, 0)
                conf_count += 1

        text = ' '.join(words)
        avg_conf = (conf_sum / conf_count / 100.0) if conf_count > 0 else 0.0
        return text, round(avg_conf, 3)

    except Exception as e:
        print(f'[OCR] Image OCR error: {e}')
        # Fallback: simple extract
        try:
            img = Image.open(BytesIO(image_data))
            text = pytesseract.image_to_string(img, lang='eng')
            return text.strip(), 0.5
        except Exception:
            return '', 0.0


def extract_text_with_ocr_fallback(
    data: bytes,
    mime_type: str = 'application/pdf',
    filename: str = '',
) -> tuple[str, str, float]:
    """
    Main entry point for Phase D text extraction.

    Returns (text, method, confidence) where:
      method = 'pdfminer' | 'ocr_pdf' | 'ocr_image' | 'empty' | 'error'
      confidence = 0.0-1.0

    Strategy:
    1. Zero-byte → return empty
    2. Image file → OCR directly
    3. PDF → pdfminer first, OCR if too short
    4. DOCX → handled separately (python-docx)
    """
    if not data or len(data) < 100:
        return '', 'empty', 0.0

    ext = Path(filename).suffix.lower() if filename else ''
    mime_lower = (mime_type or '').lower()

    # ── Image files: OCR directly ──────────────────────────────────
    if ext in IMAGE_EXTENSIONS or any(m in mime_lower for m in ('image/jpeg', 'image/png', 'image/tiff', 'image/bmp')):
        if OCR_AVAILABLE:
            text, conf = ocr_image(data, mime_type)
            method = 'ocr_image'
            print(f'[OCR] Image OCR: {len(text)} chars, conf={conf}')
        else:
            return '', 'no_ocr', 0.0
        return text, method, conf

    # ── PDF: pdfminer first, OCR fallback ─────────────────────────
    if ext == '.pdf' or 'pdf' in mime_lower:
        pdfminer_text = ''
        if PDFMINER_AVAILABLE:
            try:
                pdfminer_text = pdfminer_extract_text(BytesIO(data)) or ''
            except Exception:
                pdfminer_text = ''

        # If pdfminer got enough text → use it
        if len(pdfminer_text.strip()) >= PDFMINER_MIN_CHARS:
            return pdfminer_text, 'pdfminer', 0.95

        # Scanned PDF detected → try OCR
        if detect_is_scanned(data, pdfminer_text):
            if OCR_AVAILABLE and PDF2IMAGE_AVAILABLE:
                print(f'[OCR] Scanned PDF detected ({len(data):,} bytes, {len(pdfminer_text)} pdfminer chars) → running OCR')
                ocr_text, conf = ocr_pdf(data)
                if ocr_text and len(ocr_text.strip()) > len(pdfminer_text.strip()):
                    print(f'[OCR] OCR extracted {len(ocr_text)} chars (conf={conf})')
                    return ocr_text, 'ocr_pdf', conf
                else:
                    print(f'[OCR] OCR returned less than pdfminer, using pdfminer result')
            else:
                print(f'[OCR] Scanned PDF but OCR not available — returning empty text')

        # Return whatever pdfminer got (even if minimal)
        return pdfminer_text, 'pdfminer', 0.7 if len(pdfminer_text.strip()) > 20 else 0.1

    # ── DOCX/DOC: handled by python-docx (not OCR) ────────────────
    if ext in ('.docx', '.doc') or 'wordprocessingml' in mime_lower:
        try:
            from docx import Document
            doc = Document(BytesIO(data))
            text = '\n'.join(p.text for p in doc.paragraphs)
            return text, 'docx', 0.95
        except Exception as e:
            return '', 'error', 0.0

    # ── RTF/TXT ───────────────────────────────────────────────────
    if ext in ('.rtf', '.txt') or 'text/' in mime_lower:
        try:
            text = data.decode('utf-8', errors='ignore')
            return text, 'text', 0.9
        except Exception:
            return '', 'error', 0.0

    # Fallback: try to decode as text
    try:
        text = data.decode('utf-8', errors='ignore')[:8000]
        if len(text.strip()) > 50:
            return text, 'raw_text', 0.5
    except Exception:
        pass

    return '', 'unsupported', 0.0


def get_ocr_status() -> dict:
    """Return OCR capability status for health/debug."""
    return {
        'ocr_available': OCR_AVAILABLE,
        'pdf2image_available': PDF2IMAGE_AVAILABLE,
        'pdfminer_available': PDFMINER_AVAILABLE,
        'tesseract_version': _get_tesseract_version(),
        'fully_operational': OCR_AVAILABLE and PDF2IMAGE_AVAILABLE,
    }


def _get_tesseract_version() -> str:
    if not OCR_AVAILABLE:
        return 'not installed'
    try:
        return pytesseract.get_tesseract_version().vstring
    except Exception:
        try:
            return pytesseract.get_tesseract_version()
        except Exception:
            return 'unknown'
