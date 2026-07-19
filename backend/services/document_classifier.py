"""
Document Classifier — Phase A
Classifies PDFs/DOCX as RESUME, INVOICE, FORM, BANK_STATEMENT, PAYSLIP,
OFFER_LETTER, CONTRACT, or UNKNOWN before any parsing attempt.

Zero API cost. Zero tokens. Pure keyword scoring + filename heuristics.
Calibrated against real Aviin ATS inbox documents.
"""
import re
from pathlib import Path
from dataclasses import dataclass
from typing import Optional

# ─── Document Classes ────────────────────────────────────────────────────────
DOC_RESUME         = 'RESUME'
DOC_INVOICE        = 'INVOICE'
DOC_FORM           = 'FORM'
DOC_BANK_STATEMENT = 'BANK_STATEMENT'
DOC_PAYSLIP        = 'PAYSLIP'
DOC_OFFER_LETTER   = 'OFFER_LETTER'
DOC_CONTRACT       = 'CONTRACT'
DOC_ID_DOCUMENT    = 'ID_DOCUMENT'
DOC_CERTIFICATE    = 'CERTIFICATE'
DOC_UNKNOWN        = 'UNKNOWN'

# Confidence thresholds
CONFIDENCE_AUTO_RESUME  = 0.55   # above → auto-process as resume
CONFIDENCE_REVIEW       = 0.35   # 0.35-0.55 → human review
# below 0.35 → reject / non-resume


@dataclass
class ClassificationResult:
    doc_class: str
    confidence: float          # 0.0 - 1.0
    is_resume: bool
    resume_score: float
    non_resume_score: float
    word_count: int
    signals_found: list        # which keywords triggered
    filename_hint: str         # what filename suggested
    decision: str              # AUTO_PROCESS | HUMAN_REVIEW | REJECT


# ─── Keyword Signal Tables ────────────────────────────────────────────────────
# Each entry: (keyword, weight)
# Higher weight = stronger signal for that class

RESUME_SIGNALS = [
    # Strong (3 pts) — definitively resume language
    ('professional summary', 3), ('career summary', 3), ('career objective', 3),
    ('work experience', 3), ('employment history', 3), ('professional experience', 3),
    ('curriculum vitae', 3), ('years of experience', 3), ('yrs of experience', 3),
    ('technical skills', 3), ('core competencies', 3), ('key skills', 3),
    ('skill set', 3), ('current employer', 3), ('current company', 3),
    ('previous company', 3), ('previous employer', 3), ('notice period', 3),
    ('immediate joiner', 3), ('years experience', 3), ('y_m', 2),
    # Medium (2 pts)
    ('experience', 2), ('qualification', 2), ('achievement', 2),
    ('responsibility', 2), ('designation', 2), ('employment', 2),
    ('internship', 2), ('freelance', 2), ('consultant', 2),
    ('certified', 2), ('certification', 2), ('linkedin', 2),
    ('github', 2), ('portfolio', 2), ('project', 2),
    ('objective', 2), ('profile summary', 2), ('career', 2),
    # Weak (1 pt) — common in many docs too
    ('skills', 1), ('education', 1), ('position', 1), ('role', 1),
    ('location', 1), ('available', 1), ('reference', 1),
    ('relevant experience', 1), ('total experience', 1),
    ('notice', 1), ('ctc', 1), ('salary', 1),
]

INVOICE_SIGNALS = [
    ('tax invoice', 5), ('invoice no', 4), ('invoice number', 4),
    ('invoice date', 4), ('pro forma invoice', 4), ('gst invoice', 4),
    ('bill to', 3), ('ship to', 3), ('gstin', 3), ('gst no', 3),
    ('gst number', 3), ('pan card no', 3), ('hsn code', 3), ('hsn/sac', 3),
    ('amount due', 3), ('total amount', 3), ('taxable amount', 3),
    ('cgst', 3), ('sgst', 3), ('igst', 3), ('grand total', 3),
    ('subtotal', 2), ('discount', 2), ('payment terms', 2),
    ('due date', 2), ('bank details', 2), ('account no', 2),
    ('irn', 2), ('e-way bill', 2), ('eway bill', 2),
    ('invoice', 1), ('billing', 1), ('vendor', 1),
]

FORM_SIGNALS = [
    ('data protection', 5), ('declaration of consent', 5),
    ('gdpr', 4), ('eu-gdpr', 4), ('bdsg', 4), ('personal data', 4),
    ('processing of', 3), ('data subject', 3), ('consent form', 3),
    ('hereby declare', 3), ('signature of', 3), ('date of signing', 3),
    ('acknowledgement', 3), ('undertaking', 3), ('declaration form', 3),
    ('application form', 3), ('registration form', 3), ('iam', 2),
    ('thyssenkrupp', 2), ('8 id', 2), ('unique identifier', 2),
    ('hereby', 2), ('undersigned', 2), ('affix', 2),
    ('form no', 2), ('ref no', 2), ('sr no', 1),
]

BANK_SIGNALS = [
    ('account statement', 5), ('bank statement', 5), ('statement of account', 5),
    ('opening balance', 4), ('closing balance', 4), ('ifsc code', 4),
    ('micr code', 4), ('account number', 4), ('account no', 3),
    ('transaction id', 3), ('neft', 3), ('rtgs', 3), ('imps', 3),
    ('debit amount', 3), ('credit amount', 3), ('available balance', 3),
    ('cheque number', 2), ('withdrawal', 2), ('deposit', 2),
    ('utr number', 2), ('ref number', 2),
]

PAYSLIP_SIGNALS = [
    ('salary slip', 5), ('pay slip', 5), ('payslip', 5),
    ('earnings', 4), ('gross salary', 4), ('net salary', 4),
    ('basic pay', 4), ('gross pay', 4), ('net pay', 4),
    ('hra', 3), ('pf deduction', 3), ('professional tax', 3),
    ('tds deduction', 3), ('take home', 3), ('month of', 3),
    ('employee id', 2), ('department', 2), ('pay period', 2),
    ('deductions', 2), ('allowance', 2), ('lop', 2),
]

OFFER_SIGNALS = [
    # Strong signals (5 pts)
    ('offer letter', 5), ('appointment letter', 5), ('letter of appointment', 5),
    ('pleased to confirm our offer', 5), ('offer of employment', 5),
    ('confirm our offer', 5), ('confirm your appointment', 5),
    ('pleased to offer you', 5), ('pleased to extend', 5),
    ('we are pleased to confirm', 5), ('we are pleased to offer', 5),
    # Medium signals (4 pts)
    ('joining date', 4), ('date of joining', 4), ('pleased to offer', 4),
    ('you have been selected', 4), ('cost to company', 4),
    ('compensation package', 4), ('terms of employment', 4),
    ('your appointment', 4), ('your employment', 4),
    ('start date', 4), ('starting date', 4), ('commencement', 4),
    # Weaker signals (3 pts)
    ('probation period', 3), ('reporting manager', 3), ('reporting to', 3),
    ('accept this offer', 3), ('offer is contingent', 3),
    ('dear [a-z]+', 3),  # "Dear [Name]," pattern — common in offer letters
    ('sincerely yours', 3), ('yours sincerely', 3), ('warm regards', 2),
    # Low signals (2 pts)
    ('variable pay', 2), ('fixed pay', 2), ('signing bonus', 2),
    ('ctc details', 2), ('gross salary', 2), ('net salary', 2),
    ('grade', 2), ('band', 2), ('department', 2),
    # Legal/Contract documents (not resumes)
    ('master service agreement', 10), ('master services agreement', 10),
    ('msa-aviin', 10), ('msa aviin', 10), ('service agreement', 8),
    ('terms and conditions', 8), ('confidentiality agreement', 8),
    ('non-disclosure agreement', 8), ('nda agreement', 8),
    ('provider intends to furnish', 10), ('as defined herein', 8),
    ('whereas the parties', 10), ('governing law', 8), ('indemnification', 8),
]

CONTRACT_SIGNALS = [
    ('agreement', 4), ('this agreement', 4), ('service agreement', 4),
    ('terms and conditions', 4), ('nda', 4), ('non-disclosure', 4),
    ('whereas', 3), ('party of the first', 3), ('hereinafter referred', 3),
    ('indemnify', 3), ('liability', 3), ('jurisdiction', 3),
    ('governing law', 3), ('termination clause', 3), ('force majeure', 3),
    ('confidentiality', 2), ('intellectual property', 2), ('covenant', 2),
]

ID_DOC_SIGNALS = [
    ('date of birth', 4), ('father name', 4), ('mother name', 4),
    ('aadhar', 4), ('aadhaar', 4), ('pan card', 4), ('passport', 4),
    ('voter id', 4), ('driving licence', 4), ('nationality', 3),
    ('gender', 3), ('blood group', 3), ('UID', 2),
]

CERTIFICATE_SIGNALS = [
    ('certificate of', 4), ('this is to certify', 4), ('awarded to', 4),
    ('in recognition of', 3), ('course completion', 3), ('hereby certified', 3),
    ('transcript', 3), ('marks obtained', 3), ('percentage', 2),
    ('roll number', 2), ('examination', 2), ('university', 2),
]

# ─── Filename Heuristics ──────────────────────────────────────────────────────
RESUME_FILENAME_SIGNALS = [
    r'cv[_\-\s]', r'resume[_\-\s]?', r'curriculum[_\-]?vitae',
    r'\d+[ym][\d_]', r'_\d+y_\d+m', r'\[\d+y_\d+m\]',  # e.g. 5y_3m, [10y_0m]
    r'profile[_\-]', r'naukri_', r'_consultant', r'_engineer',
    r'_developer', r'_analyst', r'_manager', r'_specialist',
    r'_associate', r'_executive', r'job_application',
]

NON_RESUME_FILENAME_SIGNALS = [
    r'invoice', r'tax_inv', r'bill\b', r'receipt', r'statement',
    r'bank', r'salary.?slip', r'payslip', r'payroll',
    r'offer.?letter', r'offr.?letter', r'offerletter', r'offrletter',
    r'appointment', r'joining',
    r'agreement', r'contract', r'nda\b',
    r'aadhar', r'aadhaar', r'pan.?card', r'passport',
    r'protection', r'consent', r'declaration', r'form',
    r'certificate', r'degree', r'marksheet', r'transcript',
    r'relieving', r'experience.?letter', r'noc\b',
    r'relieving.?letter', r'resignation', r'termination',
]


def score_signals(text_lower: str, signals: list) -> tuple[float, list]:
    """Score text against a signal list. Returns (raw_score, matched_signals)."""
    total = 0
    matched = []
    for kw, weight in signals:
        if kw in text_lower:
            total += weight
            matched.append(kw)
    return float(total), matched


def classify_from_filename(filename: str) -> str:
    """Quick pre-filter from filename before text extraction."""
    fn = filename.lower().replace(' ', '_').replace('-', '_')
    for pattern in RESUME_FILENAME_SIGNALS:
        if re.search(pattern, fn):
            return 'RESUME_HINT'
    for pattern in NON_RESUME_FILENAME_SIGNALS:
        if re.search(pattern, fn):
            return 'NON_RESUME_HINT'
    return 'UNKNOWN'


def classify_document(
    text: str,
    filename: str = '',
    mime_type: str = '',
    min_words: int = 80,
) -> ClassificationResult:
    """
    Classify a document as RESUME or other type.

    Args:
        text: extracted plain text from PDF/DOCX
        filename: original filename for heuristic boost
        mime_type: MIME type hint
        min_words: minimum words to be a valid document

    Returns:
        ClassificationResult with is_resume flag and confidence
    """
    text_lower = text.lower().strip()
    word_count = len(text.split()) if text else 0

    # ── Step 0: Trivial rejections ─────────────────────────────────────────
    if word_count < min_words:
        return ClassificationResult(
            doc_class=DOC_UNKNOWN, confidence=0.0, is_resume=False,
            resume_score=0.0, non_resume_score=0.0, word_count=word_count,
            signals_found=[], filename_hint='TOO_SHORT',
            decision='REJECT',
        )

    # ── Step 1: Filename heuristic ─────────────────────────────────────────
    filename_hint = classify_from_filename(filename)

    # ── Step 2: Score all classes ──────────────────────────────────────────
    r_score,  r_matched  = score_signals(text_lower, RESUME_SIGNALS)
    inv_score, inv_match = score_signals(text_lower, INVOICE_SIGNALS)
    frm_score, frm_match = score_signals(text_lower, FORM_SIGNALS)
    bnk_score, bnk_match = score_signals(text_lower, BANK_SIGNALS)
    pay_score, pay_match = score_signals(text_lower, PAYSLIP_SIGNALS)
    off_score, off_match = score_signals(text_lower, OFFER_SIGNALS)
    con_score, con_match = score_signals(text_lower, CONTRACT_SIGNALS)
    idd_score, idd_match = score_signals(text_lower, ID_DOC_SIGNALS)
    cer_score, cer_match = score_signals(text_lower, CERTIFICATE_SIGNALS)

    # Non-resume total
    non_resume_raw = max(inv_score, frm_score, bnk_score, pay_score,
                         off_score, con_score, idd_score, cer_score)

    # ── Step 3: Word count boost for resumes ───────────────────────────────
    # Real resumes are typically 500-3000 words
    if 300 <= word_count <= 5000:
        r_score += 3.0
    elif 150 <= word_count < 300:
        r_score += 1.0

    # ── Step 4: Filename boost ─────────────────────────────────────────────
    if filename_hint == 'RESUME_HINT':
        r_score += 5.0
    elif filename_hint == 'NON_RESUME_HINT':
        non_resume_raw += 5.0
        r_score -= 2.0

    # ── Step 5: Determine winner ───────────────────────────────────────────
    all_scores = {
        DOC_RESUME:         r_score,
        DOC_INVOICE:        inv_score,
        DOC_FORM:           frm_score,
        DOC_BANK_STATEMENT: bnk_score,
        DOC_PAYSLIP:        pay_score,
        DOC_OFFER_LETTER:   off_score,
        DOC_CONTRACT:       con_score,
        DOC_ID_DOCUMENT:    idd_score,
        DOC_CERTIFICATE:    cer_score,
    }

    winner = max(all_scores, key=all_scores.get)
    winner_score = all_scores[winner]
    total = sum(all_scores.values()) or 1.0

    # ── Step 6: Compute confidence ─────────────────────────────────────────
    if winner == DOC_RESUME:
        # Resume confidence: how much better is resume score vs best non-resume
        non_resume_max = max(inv_score, frm_score, bnk_score, pay_score,
                             off_score, con_score, idd_score, cer_score)
        margin = r_score - non_resume_max
        raw_confidence = min(1.0, (r_score / max(total, 1)) + (margin / 20.0))
        confidence = max(0.0, min(1.0, raw_confidence))
    else:
        confidence = min(1.0, winner_score / (r_score + winner_score + 1))

    # ── Step 7: Decide action ──────────────────────────────────────────────
    is_resume = (winner == DOC_RESUME)
    if is_resume:
        if confidence >= CONFIDENCE_AUTO_RESUME:
            decision = 'AUTO_PROCESS'
        elif confidence >= CONFIDENCE_REVIEW:
            decision = 'HUMAN_REVIEW'
        else:
            decision = 'REJECT'
    else:
        decision = 'REJECT'

    # Collect matched signals for transparency
    signals_found = r_matched[:10] if is_resume else (
        inv_match + frm_match + bnk_match + pay_match +
        off_match + con_match + idd_match + cer_match
    )[:10]

    return ClassificationResult(
        doc_class=winner,
        confidence=round(confidence, 3),
        is_resume=is_resume,
        resume_score=round(r_score, 1),
        non_resume_score=round(non_resume_raw, 1),
        word_count=word_count,
        signals_found=signals_found,
        filename_hint=filename_hint,
        decision=decision,
    )


# ─── Convenience helper ───────────────────────────────────────────────────────
def is_resume_document(text: str, filename: str = '', mime_type: str = '') -> tuple[bool, float, str]:
    """
    Quick check: returns (is_resume, confidence, decision).
    Use this in the pipeline before parsing.
    """
    result = classify_document(text, filename, mime_type)
    return result.is_resume, result.confidence, result.decision
