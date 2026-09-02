"""
Resume Intake Service — Phases 1-5
Phase 1: Source detection + file storage
Phase 2: Regex + optional Ollama resume parsing
Phase 3: Candidate upsert with deduplication
Phase 4: Auto job matching
Phase 5: Notifications + auto-reply
"""
import re, json, base64, imaplib, email as email_lib, asyncio, os, uuid, httpx, threading
from email.header import decode_header, make_header
from datetime import datetime, timezone
from pathlib import Path
import db
from services.document_classifier import classify_document, is_resume_document, DOC_RESUME
try:
    from services.dedup_service import check_duplicate, compute_file_hash, EXACT_MATCH, HIGH_CONFIDENCE
    DEDUP_AVAILABLE = True
except ImportError:
    DEDUP_AVAILABLE = False
from services.improved_parser import parse_resume_v2, extract_skills_from_text, calc_confidence


def _clean_text(text: str) -> str:
    """Remove null bytes and control characters that PostgreSQL rejects.
    REAL BUG FIX (2026-08-18): this silently truncated EVERY resume's
    stored resume_text to 5000 chars, mid-sentence, regardless of the
    resume's real length -- confirmed on a real 7-page, dense multi-role
    resume where the cut landed partway through the FIRST section
    (Professional Summary), discarding the entire Professional Experience/
    Education/Certifications content that followed. candidates.resume_text
    is a plain TEXT column with no DB-level size limit, so there was never
    a real reason for this cap -- it silently loses real candidate data on
    every dense multi-page resume, not just this one. Kept a generous
    200,000-char safety cap (not zero) purely against a corrupted/garbage
    file producing pathological output, not as a normal-resume limit."""
    return (text or '').replace('\x00', ' ').replace('\r', ' ')[:200000]


# ─── Phase 1: Source Detection ────────────────────────────────────────────────
SOURCE_MAP = {
    'naukri':       {'label': 'Naukri',        'domains': ['naukri.com','naukrimail.com','naukrimails.com','infoedge.com']},
    'linkedin':     {'label': 'LinkedIn',      'domains': ['linkedin.com','e.linkedin.com','notifications.linkedin.com','em.linkedin.com']},
    'indeed':       {'label': 'Indeed',        'domains': ['indeed.com','indeedemail.com','indeed.co.in','indeedmail.com']},
    'shine':        {'label': 'Shine',         'domains': ['shine.com','shineindia.com','shinemail.com']},
    'monster':      {'label': 'Monster India', 'domains': ['monsterindia.com','monster.com','foundit.in']},
    'timesjobs':    {'label': 'TimesJobs',     'domains': ['timesjobs.com','timesinternet.in']},
    'freshersworld':{'label': 'Freshersworld', 'domains': ['freshersworld.com','fwjobs.com']},
    'iimjobs':      {'label': 'IIMJobs',       'domains': ['iimjobs.com']},
    'hirist':       {'label': 'Hirist',        'domains': ['hirist.com','hirist.tech']},
    'instahyre':    {'label': 'Instahyre',     'domains': ['instahyre.com']},
    'cutshort':     {'label': 'Cutshort',      'domains': ['cutshort.io','cutshort.com']},
    'internshala':  {'label': 'Internshala',   'domains': ['internshala.com']},
    'apna':         {'label': 'Apna',          'domains': ['apna.co','apnajobs.com']},
    'workindia':    {'label': 'WorkIndia',     'domains': ['workindia.in']},
    'glassdoor':    {'label': 'Glassdoor',     'domains': ['glassdoor.com','glassdoor.in','em.glassdoor.com']},
    'jora':         {'label': 'Jora',          'domains': ['jora.com','in.jora.com']},
    'simplyhired':  {'label': 'SimplyHired',   'domains': ['simplyhired.com','simplyhired.in']},
    'jobsforher':   {'label': 'JobsForHer',    'domains': ['jobsforher.com','herkey.com']},
    'quikr':        {'label': 'Quikr Jobs',    'domains': ['quikr.com','quikrjobs.com']},
    'rozgar':       {'label': 'Rozgar',        'domains': ['rozgar.com']},
    'sensehq':      {'label': 'SenseHQ',       'domains': ['sensehq.com']},
    'turbohire':    {'label': 'TurboHire',     'domains': ['turbohire.co']},
    'naukrigulf':   {'label': 'NaukriGulf',    'domains': ['naukrigulf.com']},
    'headhonchos':  {'label': 'HeadHonchos',   'domains': ['headhonchos.com']},
    'zoho_recruit': {'label': 'Zoho Recruit',  'domains': ['zoho.com','zohorecruit.com']},
    # Added alongside the 70+ free-portal sharing directory (job_portals.py)
    # so applications that arrive by email from these portals get correctly
    # source-tagged instead of falling into the generic 'Direct Email' bucket.
    'wellfound':    {'label': 'Wellfound',     'domains': ['wellfound.com','angel.co']},
    'dice':         {'label': 'Dice',          'domains': ['dice.com']},
    'toptal':       {'label': 'Toptal',        'domains': ['toptal.com']},
    'upwork':       {'label': 'Upwork',        'domains': ['upwork.com']},
    'freelancer':   {'label': 'Freelancer.com','domains': ['freelancer.com']},
    'fiverr':       {'label': 'Fiverr',        'domains': ['fiverr.com']},
    'remoteok':     {'label': 'RemoteOK',      'domains': ['remoteok.com']},
    'weworkremotely':{'label': 'We Work Remotely','domains': ['weworkremotely.com']},
    'bayt':         {'label': 'Bayt.com',      'domains': ['bayt.com']},
    'gulftalent':   {'label': 'GulfTalent',    'domains': ['gulftalent.com']},
    'ziprecruiter': {'label': 'ZipRecruiter',  'domains': ['ziprecruiter.com']},
    'careerbuilder':{'label': 'CareerBuilder', 'domains': ['careerbuilder.com']},
    'snagajob':     {'label': 'Snagajob',      'domains': ['snagajob.com']},
    'ncs_gov':      {'label': 'NCS (Govt)',    'domains': ['ncs.gov.in']},
    'ambitionbox':  {'label': 'AmbitionBox',   'domains': ['ambitionbox.com']},
}

RESUME_EXTS = {'.pdf', '.doc', '.docx', '.rtf'}
RESUME_MIMES = {
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/rtf', 'text/rtf',
}

# Senders that are never candidates (banks, alerts, newsletters, services)
SENDER_BLACKLIST = {
    'sbicard.com', 'sbicreditcard.com', 'hdfcbank.com', 'icicilombard.com',
    'icicibank.com', 'axisbank.com', 'kotak.com', 'indusind.com', 'yesbank.in',
    'billdesk.in', 'billdesk.com', 'paytm.com', 'razorpay.com', 'cashfree.com',
    'gpay.com', 'phonepe.com', 'amazonpay.in',
    'amazon.com', 'amazon.in', 'flipkart.com', 'myntra.com',
    'swiggy.in', 'zomato.com', 'makemytrip.com', 'agoda.com',
    'irctc.co.in', 'irctc.com',
    'jio.com', 'airtel.in', 'vodafone.in', 'bsnl.in',
    'greytip.com', 'greythr.com', 'keka.com', 'darwinbox.com',
    # Note: naukri.com, linkedin.com etc. NOT blocked here — classifier handles non-resume PDFs
    'info.sbicard.com', 'offers.sbicard.com',
    'symboinsurance.com', 'policybazaar.com',
    'linkedin.com',  # LinkedIn alerts (domain-matched separately for real applications)
    'cs.linkedin.com',  # LinkedIn customer support
}

NON_RESUME_NAME_PATTERNS = [
    'sbi card', 'hdfc bank', 'icici bank', 'axis bank',
    'bank account', 'bank statement', 'credit card',
    'payment', 'invoice', 'bill', 'receipt',
    'support', 'customer care', 'helpdesk', 'noreply', 'no reply',
    'alert', 'notification', 'newsletter',
    'agoda', 'amazon', 'flipkart', 'swiggy', 'zomato',
    'master service agreement', 'service agreement',
    'linkedin customer', 'gopayments', 'paynet',
]
# NOTE (2026-08-12): confirmed this list is still genuinely dead — nothing
# reads it. Deliberately NOT wiring it up wholesale: it contains generic
# terms ('alert', 'notification', 'support') that would false-positive
# against real, legitimate resume-forwarding senders this codebase already
# expects (e.g. Naukri/Indeed job-alert emails, per SUBJECT_PATTERNS below,
# routinely have from-names like "Naukri Alert") — activating it wholesale
# was tried and reverted after catching that regression before deploy, not
# after. Left in place for a future, more careful per-pattern audit.

# REAL BUG FIX (2026-08-12): is_junk_sender() only ever checked the
# sender's domain — never caught a genuine bounce notification. Confirmed
# live: 15 real "Mail Delivery System" garbage candidates, each with
# source_email MAILER-DAEMON@<this tenant's own real Hostinger relay
# domain> — a real bounce from this tenant's own outbound mail (e.g. a
# KAE-submission email to a bad address) that still had the original
# resume PDF attached, sailing through resume intake as if the bounce
# itself were a candidate. Domain-blacklisting alone can't catch this
# since the bounce's domain is the tenant's own legitimate mail relay, not
# a blacklistable third party — needs its own narrow, bounce-specific check.
BOUNCE_NAME_PATTERNS = [
    'mail delivery system', 'mail delivery subsystem', 'mailer-daemon',
    'mail delivery failure', 'delivery status notification',
    'undelivered mail returned to sender', 'returned mail', 'postmaster',
]
BOUNCE_LOCAL_PARTS = {'mailer-daemon', 'postmaster', 'mail-daemon', 'bounce', 'bounces'}

def is_junk_sender(from_email: str, from_name: str = '') -> bool:
    """Returns True if this sender is clearly not sending resumes."""
    email_l = (from_email or '').lower()
    domain = email_l.split('@')[-1] if '@' in email_l else ''
    local_part = email_l.split('@')[0] if '@' in email_l else ''
    if domain in SENDER_BLACKLIST or local_part in BOUNCE_LOCAL_PARTS:
        return True
    name_l = (from_name or '').lower().strip()
    return any(p in name_l for p in BOUNCE_NAME_PATTERNS)

# Phase E: Confidence-Based Routing Thresholds
CONF_AUTO_ACCEPT   = 0.55   # >= this → auto_accepted (create candidate immediately)
CONF_NEEDS_REVIEW  = 0.35   # >= this → needs_review (create + flag for human review)
# < CONF_NEEDS_REVIEW → low_confidence (store file, NO candidate until reviewed)

UPLOADS_BASE = Path('/app/uploads/resumes')
EXCLUDE_NAMES = {'logo','signature','banner','image','photo','icon','.png','.jpg','.gif','.jpeg','.bmp'}


# Subject patterns for job boards (when sender domain is unknown/generic)
SUBJECT_PATTERNS = {
    'naukri':    ['naukri.com', 'naukri alert', 'resume alert', 'naukri jobs', 'new application from naukri'],
    'linkedin':  ['new applicant for', 'applied to your job', 'linkedin job application', 'linkedin'],
    'indeed':    ['applied to', 'application from indeed', 'indeed job', 'applied via indeed'],
    'shine':     ['shine.com', 'applied on shine'],
    'monster':   ['monster india', 'monsterindia', 'applied via monster'],
    'timesjobs': ['timesjobs', 'applied on timesjobs'],
    'iimjobs':   ['iimjobs'],
    'hirist':    ['hirist'],
    'sensehq':   ['sensehq', 'referral status'],
    'internshala':['internshala'],
    'cutshort':  ['cutshort'],
    'instahyre': ['instahyre'],
}

def detect_source(from_email: str, subject: str = '') -> tuple:
    domain = (from_email or '').lower().split('@')[-1] if '@' in (from_email or '') else ''
    # 1. Domain match (most reliable)
    for key, cfg in SOURCE_MAP.items():
        for d in cfg['domains']:
            if domain == d or domain.endswith('.' + d):
                return key, cfg['label']
    # 2. Subject pattern match
    subj = (subject or '').lower()
    for key, patterns in SUBJECT_PATTERNS.items():
        if any(p in subj for p in patterns):
            label = SOURCE_MAP.get(key, {}).get('label', key.title())
            return key, label
    # 3. Key word in subject fallback
    for key, cfg in SOURCE_MAP.items():
        if key in subj:
            return key, cfg['label']
    return 'direct', 'Direct Email'


def is_resume_attachment(filename: str, mime_type: str) -> bool:
    if not filename:
        return False
    ext = Path(filename).suffix.lower()
    name = filename.lower()
    if any(x in name for x in EXCLUDE_NAMES):
        return False
    return ext in RESUME_EXTS or (mime_type or '').lower() in RESUME_MIMES


def save_resume_file(data: bytes, tenant_id: str, filename: str) -> str:
    date_str = datetime.now().strftime('%Y/%m/%d')
    folder = UPLOADS_BASE / tenant_id / date_str
    folder.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r'[^\w.\-]', '_', filename)[:200]
    uid = uuid.uuid4().hex[:8]
    dest = folder / f'{uid}_{safe}'
    dest.write_bytes(data)
    return f'/uploads/resumes/{tenant_id}/{date_str}/{uid}_{safe}'


# ─── Phase 2: Text Extraction + Parsing ──────────────────────────────────────
def extract_text_from_pdf(data: bytes) -> str:
    try:
        from io import BytesIO
        from pdfminer.high_level import extract_text
        return extract_text(BytesIO(data)) or ''
    except Exception:
        return ''


def extract_text_from_docx(data: bytes) -> str:
    try:
        from io import BytesIO
        from docx import Document
        doc = Document(BytesIO(data))
        return '\n'.join(p.text for p in doc.paragraphs)
    except Exception:
        return ''


def extract_text_from_attachment(data: bytes, mime_type: str, filename: str) -> str:
    """Phase D: extract text with OCR fallback for scanned PDFs and images."""
    # Try OCR-aware extraction first (handles scanned PDFs, images)
    try:
        from services.ocr_service import extract_text_with_ocr_fallback
        text, method, conf = extract_text_with_ocr_fallback(data, mime_type, filename)
        if method not in ('error', 'unsupported') and text is not None:
            return text or ''
    except ImportError:
        pass
    # Fallback: original extraction (no OCR)
    ext = Path(filename or '').suffix.lower()
    if ext == '.pdf' or 'pdf' in (mime_type or ''):
        return extract_text_from_pdf(data)
    if ext == '.docx' or 'wordprocessingml' in (mime_type or ''):
        return extract_text_from_docx(data)
    if ext == '.doc' or 'msword' in (mime_type or ''):
        t = extract_text_from_docx(data)
        return t if t.strip() else data.decode('utf-8', errors='ignore')[:5000]
    return data.decode('utf-8', errors='ignore')[:5000]


def regex_parse_resume(text: str, from_name: str = '', from_email: str = '') -> dict:
    t = text[:8000]

    # Email
    em = re.search(r'[\w.+\-]+@[\w\-]+\.[\w.]+', t)
    email = em.group(0).lower() if em else (from_email or None)

    # Phone
    ph = re.search(r'(?:\+91[\s\-]?)?[6-9]\d{9}', t.replace(' ', '').replace('-', ''))
    phone = ph.group(0) if ph else None

    # Name — with blacklist of common resume section headers
    RESUME_HEADERS = {
        'professional summary', 'candidate portfolio', 'career objective',
        'objective', 'summary', 'profile', 'about me', 'personal profile',
        'career summary', 'executive summary', 'professional profile',
        'curriculum vitae', 'resume', 'bio', 'overview', 'introduction',
        'key skills', 'technical skills', 'skills', 'experience',
        'education', 'certifications', 'achievements', 'projects',
        'work experience', 'employment', 'references', 'contact',
    }
    name = None
    # Try email From header name first (most reliable)
    if from_name and len(from_name.split()) >= 2 and from_name.lower() not in RESUME_HEADERS:
        name = from_name.strip().title()
    if not name:
        for p in [r'Name\s*[:\-]\s*([A-Z][a-zA-Z ]{3,40})',
                  r'^([A-Z][a-z]+(?: [A-Z][a-z]+){1,3})\s*\n',
                  r'^([A-Z][A-Z ]{5,30})\s*\n']:
            m = re.search(p, t, re.MULTILINE)
            if m:
                candidate = m.group(1).strip().title()
                if candidate.lower() not in RESUME_HEADERS and len(candidate.split()) >= 2:
                    name = candidate
                    break
    if not name:
        name = from_email.split('@')[0].replace('.', ' ').replace('_', ' ').title() if '@' in from_email else 'Unknown Candidate' 

    # Experience — multiple patterns to handle all common resume formats
    exp = None
    exp_patterns = [
        r'(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)(?:\s+of)?\s+(?:experience|exp)',
        r'Total\s+Experience\s*[:\-]?\s*(\d+(?:\.\d+)?)',
        r'Experience\s*[:\-]\s*(\d+(?:\.\d+)?)\s*(?:years?|yrs?)',
        r'(\d+(?:\.\d+)?)\s*(?:years?|yrs?)\s+of\s+(?:total\s+)?experience',
        r'exp(?:erience)?[:\s]+([5-9]\d?|[1-4]\d)\s*(?:years?|yrs?)',
    ]
    for p in exp_patterns:
        m = re.search(p, t, re.I)
        if m:
            try: exp = float(m.group(1))
            except Exception: pass
            if exp: break

    # Skills
    skills = []
    ss = re.search(r'(?:technical\s+)?skills?(?:\s+[&/]\s+\w+)?[:\s\n]+(.{20,600}?)(?:\n\n|\Z)', t, re.I | re.DOTALL)
    if ss:
        raw = re.split(r'[,|*\n\t/]+', ss.group(1))
        skills = [s.strip() for s in raw if 3 < len(s.strip()) < 45 and not s.strip().isdigit()][:20]

    # Company
    company = None
    co = re.search(r'(?:Current|Present|Working\s+at|Employer)\s*[:\-]\s*([^\n]{3,60})', t, re.I)
    if co: company = co.group(1).strip()

    # Designation
    designation = None
    for p in [r'(?:Designation|Role|Position|Title)\s*[:\-]\s*([^\n]{3,60})',
              r'currently\s+working\s+as\s+(?:a\s+)?([^\n]{3,60})']:
        m = re.search(p, t, re.I)
        if m:
            designation = m.group(1).strip()
            break

    # Location
    location = None
    lo = re.search(r'(?:Location|City|Based\s+(?:in|at))\s*[:\-]\s*([^\n]{2,50})', t, re.I)
    if lo: location = lo.group(1).strip()

    # LinkedIn
    linkedin = None
    li = re.search(r'linkedin\.com/in/[\w\-]+', t, re.I)
    if li: linkedin = 'https://' + li.group(0)

    # Education
    education = None
    edu = re.search(r'(?:B\.?Tech|B\.?E|M\.?Tech|MBA|MCA|BCA|B\.?Sc|M\.?Sc|B\.?Com|Ph\.?D|Diploma)[^\n]{0,80}', t, re.I)
    if edu: education = edu.group(0).strip()

    # CTC
    ctc = None
    c = re.search(r'(?:Expected|Desired)\s+CTC\s*[:\-]\s*([^\n]{2,30})', t, re.I)
    if c: ctc = c.group(1).strip()

    # Notice period
    notice = None
    n = re.search(r'Notice\s+Period\s*[:\-]\s*([^\n]{2,30})', t, re.I)
    if n: notice = n.group(1).strip()

    return {
        'name': name, 'email': email, 'phone': phone,
        'location': location, 'current_company': company,
        'current_designation': designation, 'experience_years': exp,
        'skills': skills, 'education': education,
        'expected_ctc': ctc, 'notice_period': notice, 'linkedin_url': linkedin,
    }


# REAL BUG FOUND 2026-08-31: a small local LLM prompted with a JSON-schema
# example (below) will, on a sparse/blank/corrupted document it has little
# real signal to work with, sometimes echo the example's own placeholder
# text back verbatim instead of a real extracted value - confirmed live:
# candidates with full_name genuinely stamped "person full name only"
# (the literal name-field example) and current_employer genuinely stamped
# the literal string "null" (the model emitting a quoted JSON STRING
# "null" instead of the bare JSON null keyword the prompt actually asked
# for - a real, separate small-model formatting inconsistency, not the
# same failure). merge_parsed()'s own `if v` check only filters an
# empty/falsy value - a non-empty string like "null" or the placeholder
# text passes straight through as if it were real data. Built as one
# reusable set covering every field's own example value, checked against
# every string field the model returns, not just name.
_OLLAMA_PLACEHOLDER_ECHOES = frozenset([
    'person full name only', 'personal email', 'phone number',
    'city or city state', 'most recent employer', 'most recent job title',
    'highest degree', 'notice period', 'linkedin url', 'linkedin url or null',
    'null', 'none', 'n/a', 'na', 'not mentioned', 'not specified',
])


_NAME_INSTITUTION_SIGNALS = (
    'college', 'university', 'institute', 'government', 'polytechnic', 'school of',
)


def _sanitize_llm_fields(data: dict) -> dict:
    """Strip any field whose value is just the prompt's own placeholder
    text echoed back, or the literal string "null"/"n/a" - never real
    extracted data. Applies to every string field the model can return."""
    for k, v in list(data.items()):
        if isinstance(v, str) and v.strip().lower() in _OLLAMA_PLACEHOLDER_ECHOES:
            data[k] = None
    # REAL BUG FOUND 2026-08-31, name-field specific: on a confusing
    # document (education section prominent, no clear name line) the
    # model sometimes returns a real institution's name for the "name"
    # field instead - confirmed live: "Govind Ballabh Pant Government
    # Engineering College" was written as a real candidate's full_name.
    # An institution name is never a legitimate person-name value
    # regardless of how confident the model sounds returning it.
    name_val = data.get('name')
    if isinstance(name_val, str) and any(sig in name_val.lower() for sig in _NAME_INSTITUTION_SIGNALS):
        data['name'] = None
    return data


async def parse_with_ollama(text: str, ollama_url: str, model: str) -> dict:
    prompt = (
        'You are a resume parser. Extract the following fields from the resume text below. '
        'Return ONLY a JSON object, no markdown, no explanation.\n'
        'JSON keys (use null for missing):\n'
        '{"name": "person full name only", "email": "personal email", "phone": "phone number", '
        '"location": "city or city state", "current_company": "most recent employer", '
        '"current_designation": "most recent job title", "experience_years": 0.0, '
        '"skills": ["skill1","skill2"], "education": "highest degree", '
        '"notice_period": "notice period", "linkedin_url": "linkedin URL or null"}\n'
        'Rules: name must be a person name only (not company/university/skill). '
        'Reject role emails (hr@, admin@, noreply@, careers@, postmaster@).\n\n'
        f'RESUME TEXT:\n{text[:3500]}'
    )
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(f'{ollama_url}/api/generate',
                                  json={'model': model, 'prompt': prompt, 'stream': False,
                                        'options': {'temperature': 0.05, 'num_predict': 512}})
            if r.status_code == 200:
                raw = r.json().get('response', '')
                m = re.search(r'\{[\s\S]*?\}', raw)
                if m:
                    try:
                        return _sanitize_llm_fields(json.loads(m.group(0)))
                    except json.JSONDecodeError:
                        pass
    except Exception as _e:
        print(f'[Ollama] parse failed: {_e}')
    return {}


def merge_parsed(base: dict, llm: dict) -> dict:
    merged = dict(base)
    for k, v in llm.items():
        if v and not merged.get(k):
            merged[k] = v
    return merged


# ─── Phase 3: Candidate Upsert ────────────────────────────────────────────────
async def upsert_candidate(conn, tenant_id: str, parsed: dict,
                           job_board: str, label: str,
                           from_email: str, file_path: str, resume_text: str,
                           received_by: dict | None = None) -> str:
    """received_by: {"user_id", "email"} of the recruiter whose registered
    personal mailbox this resume arrived in (2026-08-11, individual
    recruiter ownership) — None when there's no known per-recruiter
    mailbox for this message (e.g. backlog reprocessing with no account
    context), in which case no ownership claim is made and the candidate
    falls into the unassigned/review queue rather than guessing."""
    cand_email = (parsed.get('email') or '').lower().strip().lstrip('-.+@')
    # Reject: content-id emails (image001.png@...), too-short domains, no real TLD
    if cand_email:
        parts = cand_email.split('@')
        domain = parts[-1] if len(parts) == 2 else ''
        local = parts[0] if len(parts) == 2 else ''
        # Must have real TLD (2-6 chars), no image filenames, no hex-only domains
        valid = (re.match(r'^[\w.+\-]+@[\w\-]+\.[a-z]{2,6}(\.\w{2,4})?$', cand_email) and
                 not any(x in local for x in ['image', 'img', 'photo', 'logo', 'icon']) and
                 not re.match(r'^[0-9a-f]{6,}$', domain.split('.')[0]))
        if not valid:
            cand_email = ''

    # REAL BUG FOUND 2026-08-31: a candidate's own email can end up
    # matching a real INTERNAL staff account's email — confirmed live,
    # caused a genuine identity collision: a resume whose extracted
    # email happened to resolve to a real recruiter's own mailbox
    # (either via the same from_email fallback the name field already
    # had, fixed separately, or a literal email-forwarding artifact
    # embedded in the document's own text) got matched/merged into an
    # UNRELATED pre-existing candidate that already shared that same
    # (also wrongly extracted) email, silently attributing one real
    # person's resume data onto a completely different person's record.
    # First version of this fix checked for an EXACT match against a
    # currently-active users/user_email_accounts row - proved too
    # fragile on its own first live retest: the specific account
    # (faisal.k@aviintech.com) had since been disconnected/removed, so
    # no exact-match row existed any more even though the domain is
    # unmistakably this tenant's own real staff domain (77 real active
    # users share it). Fixed with a domain-level check instead - matches
    # this tenant's own real internal email domain(s) regardless of
    # whether one specific person's account is still connected today.
    # Deliberately excludes generic public providers (gmail.com etc.)
    # even if one staff member happens to use one, and requires 3+ real
    # active users on a domain before trusting it as "this company's own
    # domain" rather than one person's personal coincidence - a real
    # candidate legitimately using gmail.com must never be blocked just
    # because a colleague also has a gmail address for something.
    if cand_email:
        cand_domain = cand_email.split('@')[-1]
        # Deliberately NOT filtered to is_active — whether a domain is
        # structurally this tenant's own belongs to the domain itself,
        # not to how many of that domain's staff happen to be active
        # right now. Confirmed live this matters: aviintech.com genuinely
        # has 77 total users on it but only 2 currently active (this
        # same session's own earlier account-cleanup work deactivated
        # 75) — an is_active-filtered version of this check would have
        # missed the domain entirely and this fix would have silently
        # done nothing.
        is_internal_domain = await conn.fetchval("""
            SELECT count(*)>=3
            FROM users WHERE tenant_id=$1 AND split_part(email,'@',2)=$2
        """, tenant_id, cand_domain)
        PUBLIC_PROVIDERS = {
            'gmail.com', 'yahoo.com', 'yahoo.co.in', 'outlook.com', 'hotmail.com',
            'live.com', 'icloud.com', 'rediffmail.com', 'protonmail.com',
            'yopmail.com', 'aol.com', 'zoho.com', 'msn.com',
        }
        if is_internal_domain and cand_domain not in PUBLIC_PROVIDERS:
            cand_email = ''

    raw_phone = re.sub(r'[^\d]', '', parsed.get('phone') or '')
    cand_phone = raw_phone[-10:] if len(raw_phone) >= 10 else None

    name = (parsed.get('name') or '').strip()[:200]
    name_lower = name.lower()
    NON_RESUME_NAMES = ['sbi card','hdfc','icici','bank account','bank statement','support',
        'customer care','noreply','alert','notification','newsletter','agoda','amazon',
        'flipkart','swiggy','zomato','payment','invoice','master service','gopayments',
        'paynet','linkedin customer','telus','billdesk','accenture service']
    is_name_junk = not name or any(p in name_lower for p in NON_RESUME_NAMES)
    if is_name_junk:
        name = from_email.split('@')[0].replace('.', ' ').replace('-', ' ').replace('_', ' ').title() if '@' in from_email else 'Unknown Candidate'
    name = name.strip()[:200]

    try:
        exp_months = int(float(parsed.get('experience_years') or 0) * 12)
    except Exception:
        exp_months = 0

    SKILL_NOISE = {'resource', 'services', 'service', 'support', 'management',
                   'ability to learn', 'fresher', 'graduate', 'etc', 'other',
                   'new concepts', 'business processes', 'multi tasking'}
    raw_skills = [str(s).strip() for s in (parsed.get('skills') or []) if str(s).strip()]
    skills = []
    for s in raw_skills:
        sl = s.lower().strip()
        # Skip: too short/long, noise words, sentence fragments, PDF artifacts
        if (len(sl) < 2 or len(sl) > 45): continue
        if sl in SKILL_NOISE: continue
        if sl.startswith(('o ', '• ', '- ', '* ', '· ')): continue  # bullet artifacts
        if sl.endswith((':',  ':-', ': -', ': –')): continue  # header artifacts like Set: -
        if any(sl.startswith(p) for p in ('and ', 'or ', 'the ', 'for ', 'with ', 'in ', 'to ', 'a ', 'an ')): continue
        if s.count(' ') >= 5: continue  # Long phrases (>5 words) are not skills
        if re.search(r'[.!?;]', s): continue  # Contains sentence punctuation
        skills.append(s)
    skills = skills[:20]

    existing_id = None
    if cand_email:
        existing_id = await conn.fetchval(
            "SELECT id FROM candidates WHERE tenant_id=$1 AND LOWER(TRIM(email))=$2 LIMIT 1",
            tenant_id, cand_email)
    if not existing_id and cand_phone:
        existing_id = await conn.fetchval(
            "SELECT id FROM candidates WHERE tenant_id=$1 AND RIGHT(REGEXP_REPLACE(phone,'[^0-9]','','g'),10)=$2 LIMIT 1",
            tenant_id, cand_phone)

    if existing_id:
        # Individual recruiter ownership (rule 11, 2026-08-11 doc): a resume
        # re-arriving for an already-owned candidate must never silently
        # update that candidate's record for anyone but the owner — doing
        # so previously overwrote resume_path unconditionally (not even
        # COALESCE'd), so a different recruiter's mailbox could silently
        # replace the "current" resume shown/downloaded for someone else's
        # owned candidate. When the receiving mailbox belongs to a known
        # recruiter, resolve ownership first: unowned/expired -> this
        # recruiter legitimately claims it (consistent with rule 10 — an
        # existing record with no active owner is fair game to the next
        # real claimant); owned by someone else -> block the update
        # entirely and log it as a blocked_attempt (the incoming resume
        # file itself is still preserved as its own resume_files row by
        # the caller, unconditionally, right after this returns — only the
        # candidate's own fields are protected, per the user's explicit
        # "block entirely, don't silently merge" decision).
        if received_by and received_by.get("user_id") and received_by.get("email"):
            from services import candidate_ownership as _ownership
            claim = await _ownership.claim_ownership(
                conn, tenant_id, str(existing_id), received_by["user_id"], received_by["email"], "personal_mailbox",
            )
            if not claim["claimed"]:
                return str(existing_id)
        await conn.execute("""
            UPDATE candidates SET
              source_label=COALESCE(source_label,$3), source=COALESCE(source,$4),
              source_email=COALESCE(source_email,$5),
              current_designation=COALESCE(current_designation,$6),
              current_employer=COALESCE(current_employer,$7),
              location=COALESCE(location,$8), linkedin_url=COALESCE(linkedin_url,$9),
              resume_path=$10,
              resume_text=CASE WHEN(resume_text IS NULL OR resume_text='')THEN $11 ELSE resume_text END,
              total_exp_mo=CASE WHEN total_exp_mo=0 AND $12>0 THEN $12 ELSE total_exp_mo END,
              skills=CASE WHEN skills='{}' AND $13::text[]<>'{}' THEN $13 ELSE skills END,
              parsed_at=NOW(), updated_at=NOW()
            WHERE id=$1 AND tenant_id=$2""",
            existing_id, tenant_id, label, job_board, from_email,
            parsed.get('current_designation'), parsed.get('current_company'),
            parsed.get('location'), parsed.get('linkedin_url'),
            file_path, _clean_text(resume_text), exp_months, skills)
        return str(existing_id)

    new_id = await conn.fetchval("""
        INSERT INTO candidates
          (tenant_id,full_name,email,phone,skills,total_exp_mo,location,current_employer,
           current_designation,source,source_label,source_email,resume_path,resume_text,
           linkedin_url,auto_created,parsed_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,TRUE,NOW(),NOW())
        RETURNING id""",
        tenant_id, name, cand_email or None, cand_phone,
        skills, exp_months, parsed.get('location'), parsed.get('current_company'),
        parsed.get('current_designation'), job_board, label, from_email,
        file_path, _clean_text(resume_text), parsed.get('linkedin_url'))
    # HARD RULE #12: consent record before storing/processing candidate PII —
    # was missing on this path entirely (found in the 2026-08-09 BGV audit).
    # Only on genuine creation, not the existing_id UPDATE branch above,
    # which already has a consent record from whenever that candidate was
    # first created.
    await conn.execute(
        "INSERT INTO consent_records (tenant_id,candidate_id,data_category,channel,consent_given,consent_text) "
        "VALUES ($1,$2,'resume_processing','email',TRUE,$3)",
        tenant_id, new_id, f"Resume received via email from {from_email} and processed for candidate matching.",
    )
    # Individual recruiter ownership (2026-08-11): the recruiter whose own
    # registered mailbox received this resume individually owns the
    # resulting candidate for 30 days — only on genuine creation, never on
    # the existing_id UPDATE branch above (an update never transfers
    # ownership per the business rule).
    if received_by and received_by.get("user_id") and received_by.get("email"):
        from services import candidate_ownership as _ownership
        await _ownership.claim_ownership(
            conn, tenant_id, str(new_id), str(received_by["user_id"]), received_by["email"], "personal_mailbox",
        )
        from services import activity_events as _activity_events
        await _activity_events.log_recruiter_activity(
            conn, tenant_id, str(received_by["user_id"]), _activity_events.SOURCED, candidate_id=str(new_id),
        )
    from services import source_attribution as _source_attribution
    await _source_attribution.record_source_attribution(conn, tenant_id, str(new_id), job_board)
    return str(new_id)


# ─── Phase 4: Job Matching ────────────────────────────────────────────────────
async def match_requisition(conn, tenant_id: str, subject: str, skills: list, job_board: str = ''):
    if not subject:
        return None
    # Real bug fix (2026-08-20), found while root-causing the same live
    # "nothing to sort by" report the skills-matching fix above addresses:
    # this query had no is_active/status filter at all - a candidate could
    # only ever match against whichever 50 requisitions happened to be
    # MOST RECENTLY CREATED, soft-deleted or not. On a real tenant with
    # heavy test-suite activity (this one), that window can fill up
    # entirely with soft-deleted QA rows, crowding out every real open
    # requisition and making a match structurally impossible regardless of
    # how well subject/skills actually line up with a real role.
    reqs = await conn.fetch(
        "SELECT id, title FROM requisitions WHERE tenant_id=$1 AND is_active IS NOT FALSE"
        " AND status='open' ORDER BY created_at DESC LIMIT 50",
        tenant_id)
    if not reqs:
        return None
    subj_lower = subject.lower()

    # Source-specific patterns
    import re as _re
    naukri_m = _re.search(r'applied for (.+?)(?:\s+at\s+|$)', subj_lower)
    linkedin_m = _re.search(r'new applicant(?:s)? for (.+?)(?:\s+-|$)', subj_lower)
    indeed_m = _re.search(r'(?:applied to|application for) (.+?)(?:\s+-|$)', subj_lower)
    extracted_title = None
    for m in [naukri_m, linkedin_m, indeed_m]:
        if m:
            extracted_title = m.group(1).strip()
            break

    # 1. Exact title match from extracted pattern
    if extracted_title:
        for r in reqs:
            if r['title'].lower() in extracted_title or extracted_title in r['title'].lower():
                return str(r['id'])

    # 2. General subject match
    for r in reqs:
        title = r['title'].lower()
        words = [w for w in title.split() if len(w) > 3]
        if title in subj_lower or any(w in subj_lower for w in words):
            return str(r['id'])

    # 3. Skills-based fallback. Real bug fixed 2026-08-20 (root-caused
    # while investigating a live "Sort by Match % does nothing" report -
    # this was the actual cause: candidates were never getting matched to
    # a requisition at intake at all, so there was nothing to score or
    # sort): `skill_set & title_words` requires an EXACT match between a
    # whole skill phrase ("sap fico") and a single title token ("sap") -
    # a set intersection of two different string values, which can never
    # succeed for the overwhelmingly common case of a multi-word skill
    # against a short requisition title. Confirmed directly against a
    # real candidate (skills incl. "SAP FICO"/"SAP HANA", title "SAP ABAP
    # Developer") that the old check always returned an empty set despite
    # "sap" plainly being a real, meaningful match. Fixed to check whether
    # any significant title word appears as a substring of any skill.
    if skills:
        skill_set = {s.lower() for s in skills}
        for r in reqs:
            title_words = [w.lower() for w in r['title'].split() if len(w) > 2]
            if any(tw in sk for tw in title_words for sk in skill_set):
                return str(r['id'])
    return None


async def _pick_round_robin_recruiter(conn, tenant_id: str):
    """Approved item 03 (AI Auto-Assignment Engine audit): resume intake
    never set applications.assigned_recruiter_id, so every inbound resume
    landed fully unowned. Round-robin = least current open-application
    load among active, not-on-leave recruiters — self-correcting, no
    rotation-cursor table to drift out of sync. Returns None (leave
    unassigned) if no eligible recruiter exists rather than guessing."""
    row = await conn.fetchrow("""
        SELECT u.id
        FROM users u
        LEFT JOIN applications a ON a.assigned_recruiter_id = u.id
            AND a.tenant_id = u.tenant_id AND a.stage NOT IN ('rejected','placed')
        WHERE u.tenant_id = $1 AND u.role = 'recruiter' AND u.is_active
          AND NOT EXISTS (
            SELECT 1 FROM recruiter_leave rl
            WHERE rl.recruiter_id = u.id AND rl.tenant_id = u.tenant_id
              AND CURRENT_DATE BETWEEN rl.start_date AND rl.end_date
          )
        GROUP BY u.id
        ORDER BY COUNT(a.id) ASC, u.full_name ASC
        LIMIT 1
    """, tenant_id)
    return row["id"] if row else None


async def create_application(conn, tenant_id: str, candidate_id: str, requisition_id: str):
    try:
        # Individual recruiter ownership (2026-08-11) overrides round-robin
        # entirely: if this candidate has an active 30-day ownership lock,
        # the owner is the assigned recruiter, full stop — round-robin only
        # ever applies as the fallback for candidates nobody currently owns.
        from services import candidate_ownership as _ownership
        owner = await _ownership.get_ownership(conn, tenant_id, candidate_id)
        if owner and owner["status"] == "active" and owner["ownership_expires_at"] > datetime.now(timezone.utc):
            recruiter_id = owner["recruiter_id"]
        else:
            recruiter_id = await _pick_round_robin_recruiter(conn, tenant_id)
        # Real bug fix (2026-08-20): this hardcoded 'sourced' unconditionally
        # - the exact same flaw already found and fixed in applications.py's
        # HTTP POST /applications (same day), just missed here since this is
        # a separate internal function, not the HTTP endpoint. For this
        # tenant, 'sourced' is a deliberately hidden stage - every resume
        # auto-matched at intake landed in a real application that could
        # never appear on the actual Kanban board, only ever visible via
        # "already in pipeline" banners elsewhere. Same fallback as the
        # other two creation paths (bulk-assign, POST /applications).
        # 2026-08-25: extracted to a real shared helper — see
        # routers.pipeline_stages.resolve_default_add_stage's own docstring.
        from routers.pipeline_stages import resolve_default_add_stage
        default_stage = await resolve_default_add_stage(conn, tenant_id)
        # ON CONFLICT target must restate the partial unique index's
        # predicate (applications_tenant_req_cand_active_key,
        # 2026-08-20's "Remove from Pipeline" migration) — a removed
        # (is_active=false) row falls outside that index, so this
        # correctly inserts a fresh application rather than silently
        # no-op-ing against a candidate someone already removed.
        await conn.execute("""
            INSERT INTO applications(tenant_id,requisition_id,candidate_id,stage,assigned_recruiter_id)
            VALUES($1,$2,$3,$4,$5)
            ON CONFLICT(tenant_id,requisition_id,candidate_id) WHERE is_active IS NOT FALSE DO NOTHING""",
            tenant_id, requisition_id, candidate_id, default_stage, recruiter_id)
    except Exception as e:
        print(f'[ResumeIntake] Application insert: {e}')


# ─── Phase 5: Notifications & Auto-Reply ─────────────────────────────────────
async def notify_recruiters(conn, tenant_id: str, candidate_name: str,
                            designation, exp_years, job_board_label: str, candidate_id: str):
    try:
        exp = float(exp_years or 0)
    except Exception:
        exp = 0.0
    headline = f'{designation} {exp:.0f}yr'.strip() if designation else (f'{exp:.0f}yr' if exp else '')
    msg = f'New resume: {candidate_name}' + (f' ({headline})' if headline else '') + f' via {job_board_label}'
    title = 'New Resume Received'
    body = msg
    # ── In-app notifications ──────────────────────────────────────────────────
    try:
        users = await conn.fetch(
            "SELECT id FROM users WHERE tenant_id=$1 LIMIT 10", tenant_id)
        for u in users:
            try:
                await conn.execute(
                    """INSERT INTO notifications(tenant_id,recipient_user_id,user_id,type,title,body,resource,resource_id,is_read,created_at)
                    VALUES($1,$2,$2,'resume_received',$3,$4,'candidate',$5,FALSE,NOW())""",
                    tenant_id, u['id'], title, body, candidate_id)
            except Exception:
                pass
    except Exception as e:
        print(f'[ResumeIntake] Notify DB: {e}')

    # ── SMTP email alert to recruiter ─────────────────────────────────────────
    try:
        smtp_cfg = await conn.fetchrow(
            "SELECT smtp_host, smtp_port, smtp_user, smtp_password, smtp_from, smtp_from_name, smtp_tls "
            "FROM email_settings WHERE tenant_id=$1 AND is_active=TRUE LIMIT 1", tenant_id)
        if smtp_cfg and smtp_cfg['smtp_host'] and smtp_cfg['smtp_from']:
            import smtplib, threading
            from email.mime.text import MIMEText
            from email.mime.multipart import MIMEMultipart as _MM
            recipient = smtp_cfg['smtp_from']
            em = _MM('alternative')
            em['Subject'] = f'[ATS] {title}: {candidate_name}'
            em['From'] = f"{smtp_cfg.get('smtp_from_name') or 'AVIIN ATS'} <{recipient}>"
            em['To'] = recipient
            exp_str = f'{exp:.0f} years' if exp else 'Fresher'
            text_body = (
                f'New Resume Received\n\n'
                f'Candidate  : {candidate_name}\n'
                f'Designation: {designation or "Not specified"}\n'
                f'Experience : {exp_str}\n'
                f'Source     : {job_board_label}\n\n'
                f'View in ATS: (open your ATS dashboard → Candidates)\n'
            )
            em.attach(MIMEText(text_body, 'plain'))
            def _send():
                try:
                    host = smtp_cfg['smtp_host']
                    port = smtp_cfg['smtp_port'] or 587
                    pw   = smtp_cfg['smtp_password'] or ''
                    user = smtp_cfg['smtp_user'] or recipient
                    with smtplib.SMTP(host, port, timeout=10) as s:
                        s.ehlo()
                        if smtp_cfg.get('smtp_tls', True):
                            s.starttls(); s.ehlo()
                        s.login(user, pw)
                        s.sendmail(recipient, [recipient], em.as_string())
                    print(f'[ResumeIntake] Email alert sent to {recipient}')
                except Exception as ex:
                    print(f'[ResumeIntake] Email alert failed: {ex}')
            threading.Thread(target=_send, daemon=True).start()
    except Exception as e:
        print(f'[ResumeIntake] Email alert setup failed: {e}')


async def send_auto_reply(from_email: str, candidate_name: str, smtp_acc: dict):
    if not from_email or not smtp_acc or not smtp_acc.get('email'):
        return
    try:
        import smtplib
        from email.mime.text import MIMEText
        from email.mime.multipart import MIMEMultipart as _MM

        msg = _MM('alternative')
        msg['Subject'] = 'Thank you for your application — AVIIN Jobs'
        msg['From'] = f"{smtp_acc.get('display_name','AVIIN Jobs')} <{smtp_acc['email']}>"
        msg['To'] = from_email
        body = (f'Dear {candidate_name},\n\n'
                'Thank you for your application. We have received your profile and our '
                'recruitment team will review it shortly.\n\n'
                'If your profile matches our current requirements, we will contact you within 2-3 working days.\n\n'
                'Best regards,\nAVIIN Jobs Recruitment Team')
        msg.attach(MIMEText(body, 'plain'))

        def _send():
            try:
                pw = smtp_acc.get('smtp_password', '')
                with smtplib.SMTP(smtp_acc['smtp_host'], smtp_acc.get('smtp_port', 587), timeout=10) as s:
                    s.ehlo()
                    if smtp_acc.get('smtp_tls', True):
                        s.starttls(); s.ehlo()
                    s.login(smtp_acc.get('smtp_user', smtp_acc['email']), pw)
                    s.sendmail(smtp_acc['email'], [from_email], msg.as_string())
                print(f'[ResumeIntake] Auto-reply sent to {from_email}')
            except Exception as ex:
                print(f'[ResumeIntake] Auto-reply failed: {ex}')
        threading.Thread(target=_send, daemon=True).start()
    except Exception as e:
        print(f'[ResumeIntake] Auto-reply setup error: {e}')


# ─── Master Pipeline ──────────────────────────────────────────────────────────
async def process_email_for_resume(
    conn, msg_id: str, tenant_id: str, account_id: str,
    imap_uid: str, folder: str,
    from_email: str, from_name: str, subject: str,
    attachments_meta: list,
    imap_host: str, imap_port: int, imap_user: str, imap_password: str,
    ollama_url: str = '', ollama_model: str = '',
    smtp_acc: dict = None,
    imap_conn=None,
) -> dict:
    """imap_conn: an already-open, already-selected-folder imaplib.IMAP4_SSL
    connection, for batch callers (process-pending) that process many
    messages in one call - opening a fresh connection per message was both
    slow (100 sequential logins) and fragile (transient connection drops
    against a flaky mail host got permanently recorded as failures, with no
    retry, since imap_error used to set auto_processed=TRUE). If not given,
    a one-off connection is opened as before (used by the live single-
    message IMAP IDLE path, where this is unavoidable)."""
    job_board, label = detect_source(from_email, subject)

    # Skip blacklisted senders (banks, alerts, newsletters, bounce notifications)
    if is_junk_sender(from_email, from_name):
        await conn.execute(
            "UPDATE imap_messages SET auto_processed=TRUE,process_status='junk_sender' WHERE id=$1", msg_id)
        return {'status': 'junk_sender'}

    resume_atts = [a for a in (attachments_meta or [])
                   if is_resume_attachment(a.get('filename', ''), a.get('mime_type', ''))]
    if not resume_atts:
        await conn.execute(
            "UPDATE imap_messages SET auto_processed=TRUE,process_status='no_resume' WHERE id=$1", msg_id)
        return {'status': 'no_resume'}

    # Download from IMAP
    try:
        if imap_conn is not None:
            M = imap_conn
            _, data = M.uid('FETCH', imap_uid.encode(), '(RFC822)')
        else:
            M = imaplib.IMAP4_SSL(imap_host, imap_port)
            M.login(imap_user, imap_password)
            M.select(folder, readonly=True)
            _, data = M.uid('FETCH', imap_uid.encode(), '(RFC822)')
            M.logout()
        if not data or not data[0] or not isinstance(data[0], tuple):
            # The server answered cleanly but has nothing for this UID - the
            # message was deleted/moved out of this folder after we recorded
            # it (a normal, permanent condition, not a network blip). Unlike
            # a raised exception below, this can NEVER succeed on retry, so
            # unlike imap_error it must be marked auto_processed - otherwise
            # ORDER BY received_at DESC keeps re-selecting this exact row
            # forever and the rest of the backlog behind it never gets a
            # chance to run.
            print(f'[ResumeIntake] uid={imap_uid} folder={folder}: message no longer on server, skipping permanently')
            await conn.execute(
                "UPDATE imap_messages SET auto_processed=TRUE,process_status='not_found' WHERE id=$1", msg_id)
            return {'status': 'not_found'}
        raw_msg = email_lib.message_from_bytes(data[0][1])
    except Exception as ex:
        # Transient (connection drop, timeout) - do NOT mark auto_processed
        # so this gets retried on the next process-pending/live-sync pass
        # instead of being silently stuck forever.
        print(f'[ResumeIntake] uid={imap_uid} folder={folder}: IMAP error (will retry): {ex}')
        await conn.execute(
            "UPDATE imap_messages SET process_status='imap_error' WHERE id=$1", msg_id)
        return {'status': 'error', 'error': str(ex)}

    body_text = ''
    for part in raw_msg.walk():
        if part.get_content_type() == 'text/plain':
            body_text += (part.get_payload(decode=True) or b'').decode('utf-8', errors='ignore')

    file_path = file_name = mime_type = None
    file_size = 0
    parsed = {}
    resume_text = ''

    for part in raw_msg.walk():
        raw_fn = part.get_filename()
        if not raw_fn:
            continue
        try:
            fn = str(make_header(decode_header(raw_fn)))
        except Exception:
            fn = str(raw_fn)
        mt = part.get_content_type()
        if not is_resume_attachment(fn, mt):
            continue
        att_data = part.get_payload(decode=True)
        if not att_data:
            continue

        file_name = fn
        mime_type = mt
        file_size = len(att_data)
        file_path = save_resume_file(att_data, tenant_id, fn)
        resume_text = extract_text_from_attachment(att_data, mt, fn).replace('\x00', ' ')
        body_text_clean = body_text.replace('\x00', ' ')
        # REAL BUG FIX (2026-08-18): full_text used to be capped at 6000
        # chars and that SAME capped value fed both the document classifier
        # AND parse_resume_v2()'s real field extraction. For a dense multi-
        # page resume, the actual "Employer: X" / experience section can sit
        # well past 6000 chars -- confirmed live: a real 7-page SAP resume's
        # employer field, 20000+ chars into the document, was never even
        # seen by the parser, regardless of any regex fix, because the text
        # feeding it had already been truncated before extraction ran.
        # Classification only ever needs a representative sample (fast,
        # cheap, doesn't need the whole doc); real field extraction needs
        # the complete text.
        full_text = resume_text + '\n' + body_text_clean
        classify_sample = full_text[:6000]

        # ── Phase A: Document Classification ──────────────────────────
        # REJECT invoices, bank statements, forms BEFORE creating candidates
        doc_result = classify_document(classify_sample, fn)
        if not doc_result.is_resume and doc_result.decision == 'REJECT':
            print(f'[DocClassifier] REJECT {doc_result.doc_class} (conf={doc_result.confidence}) {fn[:40]}')
            await conn.execute(
                "UPDATE imap_messages SET auto_processed=TRUE,process_status='non_resume_doc' WHERE id=$1",
                msg_id)
            return {
                'status': 'non_resume_doc',
                'doc_class': doc_result.doc_class,
                'confidence': doc_result.confidence,
            }
        # ─────────────────────────────────────────────────────────────

        # Phase B: Use improved parser (v2) with keyword skills + smarter name/exp
        # If the sender is internal staff (same mailbox domain as the account
        # we're reading from) forwarding/sharing a candidate's resume from
        # their own inbox, trusting from_name/from_email as the candidate's
        # identity would record the forwarder as the candidate instead of
        # whoever the resume is actually about - so treat those fields as
        # unavailable and let name/email come from the resume text itself.
        sender_domain = (from_email or '').split('@')[-1].lower().strip()
        own_domain = (imap_user or '').split('@')[-1].lower().strip()
        is_internal_sender = bool(sender_domain) and sender_domain == own_domain
        name_hint = '' if is_internal_sender else from_name
        email_hint = '' if is_internal_sender else from_email
        parsed = parse_resume_v2(full_text, name_hint, email_hint, fn)
        # Ollama enhancement if available
        if ollama_url and ollama_model:
            llm = await parse_with_ollama(full_text, ollama_url, ollama_model)
            if llm:
                parsed = merge_parsed(parsed, llm)
        if not parsed.get('email') and not is_internal_sender and '@' in (from_email or ''):
            parsed['email'] = from_email
        break

    if not file_path:
        await conn.execute(
            "UPDATE imap_messages SET auto_processed=TRUE,process_status='no_data' WHERE id=$1", msg_id)
        return {'status': 'error', 'error': 'No attachment data'}

    # Phase F: File hash for dedup
    fh = None
    if att_data and DEDUP_AVAILABLE:
        fh = compute_file_hash(att_data)
        # Check for exact file duplicate BEFORE creating candidate
        dedup_result = await check_duplicate(conn, tenant_id, parsed,
                                              file_hash=fh)
        if dedup_result.decision in (EXACT_MATCH, HIGH_CONFIDENCE) and dedup_result.matched_candidate_id:
            print(f'[Dedup] {dedup_result.decision}: {dedup_result.evidence[0][0]} → linking to existing candidate')
            # Link this file to existing candidate, skip parse
            await conn.execute(
                "UPDATE imap_messages SET auto_processed=TRUE,process_status='dedup_matched',candidate_id=$1 WHERE id=$2",
                dedup_result.matched_candidate_id, msg_id)
            return {
                'status': 'dedup_matched',
                'candidate_id': dedup_result.matched_candidate_id,
                'dedup_method': dedup_result.evidence[0][0] if dedup_result.evidence else 'unknown',
                'label': label,
            }

    # Phase E: Confidence-based routing
    conf = float(parsed.get('_confidence', 0) or 0)
    if conf >= CONF_AUTO_ACCEPT:
        routing_decision = 'auto_accepted'
    elif conf >= CONF_NEEDS_REVIEW:
        routing_decision = 'needs_review'
    else:
        routing_decision = 'low_confidence'

    # Only create candidate if confidence is sufficient
    if routing_decision != 'low_confidence':
        # Individual recruiter ownership (2026-08-11): account_id already
        # tells us exactly which recruiter's own registered mailbox this
        # resume arrived in (user_email_accounts.user_id) — that identity
        # used to be discarded entirely; now resolved once and threaded
        # into upsert_candidate() so the receiving recruiter claims the
        # candidate on genuine creation. None when there's no per-recruiter
        # mailbox context (e.g. some backlog-reprocessing calls) — falls
        # into the unassigned queue rather than guessing.
        received_by = None
        if account_id:
            acc = await conn.fetchrow(
                "SELECT user_id, email FROM user_email_accounts WHERE id=$1", account_id)
            if acc:
                received_by = {"user_id": str(acc["user_id"]), "email": acc["email"]}
        candidate_id = await upsert_candidate(conn, tenant_id, parsed, job_board, label,
                                              from_email, file_path, resume_text,
                                              received_by=received_by)
    else:
        candidate_id = None
        print(f'[Routing] LOW_CONFIDENCE (conf={conf:.2f}): file stored, no candidate created')

    # A low_confidence resume deliberately gets no candidate (candidate_id is
    # None) - create_application's INSERT requires a non-null candidate_id,
    # so calling it unconditionally violated that constraint on every
    # low-confidence item. The caught exception didn't propagate, but it
    # left the connection's transaction in Postgres's "aborted" state for
    # the rest of this item's processing, since catching a Python exception
    # doesn't clear that - every later query on this same conn then failed
    # too with "current transaction is aborted".
    requisition_id = None
    if candidate_id:
        requisition_id = await match_requisition(conn, tenant_id, subject, parsed.get('skills', []), job_board)
        if requisition_id:
            await create_application(conn, tenant_id, candidate_id, requisition_id)
        # Auto-score against every real open job, not just the one JD this
        # resume happened to auto-match to ("uploaded -> instant score",
        # not wait for someone to manually trigger /intelligence/score or
        # click the AI Match Score button). 2026-09-02 gap-audit fix — this
        # used to only fire when a JD match was found, and even then only
        # scored against that ONE requisition; live before the fix, only
        # ~6% of candidates had ever been scored against anything. Widened
        # to fire for every genuinely-created candidate here, scored
        # against every real open job (which naturally includes the
        # matched JD above, if any, since it's still open). Fire-and-
        # forget on its OWN connection, deliberately not awaited on `conn`
        # — this file's transaction is one aborted SQL error away from
        # poisoning every later query in this batch item (see the routing-
        # decision comment above), and scoring does a real network call to
        # the embed service, so it must never be able to take the resume/
        # candidate insert down with it.
        from routers.intelligence import auto_score_candidate_bg
        asyncio.create_task(auto_score_candidate_bg(tenant_id, str(candidate_id)))

    # NOTE: if this INSERT hits uq_resume_files_msg_fname (a leftover row
    # from an earlier attempt whose imap_messages.auto_processed update
    # never landed), do NOT try to recover here - the SQL exception has
    # already put this transaction/savepoint into an aborted state, and any
    # further query on this same connection (even a plain SELECT) fails
    # with "current transaction is aborted" until an actual ROLLBACK runs.
    # Let it propagate; process_pending_batch's outer conn.transaction()
    # context manager rolls back the savepoint on the way out, and recovers
    # this specific case on a now-clean connection afterward.
    resume_file_id = await conn.fetchval("""
        INSERT INTO resume_files
          (tenant_id,candidate_id,imap_msg_id,job_board,job_board_label,
           source_email,source_domain,file_name,file_path,mime_type,
           file_size,parse_status,parsed_data,requisition_id,
           parse_confidence,routing_decision)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$14,$12,$13,$15,$14)
        RETURNING id""",
        tenant_id, candidate_id, msg_id, job_board, label,
        from_email, (from_email or '').split('@')[-1] if '@' in (from_email or '') else '',
        file_name, file_path, mime_type, file_size,
        json.dumps(parsed), requisition_id,
        routing_decision,   # $14 = parse_status
        round(conf, 3))     # $15 = parse_confidence


    # Phase G: write structured parse results to candidate_parsed_data
    if candidate_id and resume_file_id:
        try:
            await upsert_candidate_parsed_data(
                conn, tenant_id, str(candidate_id), parsed,
                resume_file_id=str(resume_file_id),
                parse_source='v2_parser',
            )
        except Exception as _cpd_err:
            print(f'[Phase G] cpd write failed: {_cpd_err}')

        # BUG FIX (2026-08-10 audit): document_uploaded is a defined
        # candidate_activities type nothing ever wrote — every real resume
        # intake (the highest-volume real path in the app) left zero trace
        # on the candidate's own Activity Timeline. Best-effort, same
        # try/except shape as the parsed_data write right above — must
        # never be able to take the resume/candidate insert down with it.
        try:
            await conn.execute(
                """INSERT INTO candidate_activities
                   (tenant_id,candidate_id,activity_type,title,description)
                   VALUES ($1,$2,'document_uploaded',$3,$4)""",
                tenant_id, candidate_id,
                f"Resume received via {job_board or 'email'}",
                file_name or '',
            )
        except Exception as _act_err:
            print(f'[Phase G] activity write failed: {_act_err}')

    await conn.execute("""
        UPDATE imap_messages SET auto_processed=TRUE,process_status='done',candidate_id=$1
        WHERE id=$2""", candidate_id, msg_id)

    try:
        exp = float(parsed.get('experience_years') or 0)
    except Exception:
        exp = 0.0
    await notify_recruiters(conn, tenant_id, parsed.get('name', 'Unknown'),
                            parsed.get('current_designation'), exp, label, candidate_id)
    if smtp_acc and parsed.get('email') and parsed['email'] != from_email:
        await send_auto_reply(parsed['email'], parsed.get('name', 'Applicant'), smtp_acc)

    # Phase 5 optional: WhatsApp notification to candidate if phone available.
    # send_whatsapp_to_candidate was never implemented anywhere in this
    # codebase - calling it unconditionally threw NameError for every
    # resume with a phone number (i.e. nearly all of them), and since the
    # caller wraps this whole function in a transaction, that exception
    # silently rolled back the candidate/resume_files rows this function
    # had just successfully created. Guarded so a missing optional
    # notification feature can never undo a successful resume intake.
    phone = parsed.get('phone')
    if phone:
        try:
            await send_whatsapp_to_candidate(phone, parsed.get('name', 'Applicant'), label)
        except NameError:
            pass
        except Exception as ex:
            print(f'[ResumeIntake] WhatsApp notify failed (non-fatal): {ex}')

    return {
        'status': 'done',
        'candidate_id': candidate_id,
        'resume_file_id': str(resume_file_id) if resume_file_id else None,
        'job_board': job_board, 'label': label,
        'name': parsed.get('name'), 'email': parsed.get('email'),
        'skills_count': len(parsed.get('skills', [])),
        'requisition_matched': bool(requisition_id),
        'confidence': round(conf, 3),
        'routing': routing_decision,
    }


RESUME_BACKLOG_LOCK_NS = 778899  # arbitrary fixed namespace for this advisory lock


async def process_pending_batch(tenant_id: str, limit: int = 50, ollama_url: str = '', ollama_model: str = '') -> dict:
    """Process up to `limit` pending resume emails for one tenant. Shared by
    both POST /resume-intake/process-pending (manual trigger) and the
    scheduled backlog-clearing job in scheduler.py, so both go through the
    exact same connection-reuse + circuit-breaker + per-item-transaction
    logic rather than drifting into two copies of this bug-prone flow.

    Takes a Postgres advisory lock per tenant so a manual click and the
    every-1-min scheduled run can never overlap for the same tenant - not
    because overlap would corrupt anything, just to avoid doubling up IMAP
    connections against a mail host that's already proven touchy about
    concurrent logins today.

    Opens its OWN db.tenant_conn() per item rather than sharing one
    connection for the whole batch - the earlier version ran all 50 items
    in a single transaction, so NONE of a batch's progress became visible
    or durable to any other connection until the entire batch committed.
    With OCR-heavy PDFs mixed in, a single batch was observed taking 12+
    minutes, making the whole pipeline look completely frozen from outside
    (this pending count, /resume-intake/stats, etc.) even though it was
    actively working - and a crash or restart mid-batch would have lost
    everything done so far, not just the one item that failed. The lock
    itself is held on a separate, dedicated connection for the whole
    batch's duration (cheap - it does no writes) so overlap protection
    doesn't depend on the same connection doing all the slow work too."""
    async with db.tenant_conn(tenant_id) as lock_conn:
        got_lock = await lock_conn.fetchval(
            "SELECT pg_try_advisory_lock($1, hashtext($2))", RESUME_BACKLOG_LOCK_NS, str(tenant_id))
        if not got_lock:
            return {'processed': 0, 'skipped_no_resume': 0, 'candidates_created_or_updated': 0,
                    'errors': 0, 'status': 'already_running'}
        try:
            return await _process_pending_batch_locked(tenant_id, limit, ollama_url, ollama_model)
        finally:
            await lock_conn.execute(
                "SELECT pg_advisory_unlock($1, hashtext($2))", RESUME_BACKLOG_LOCK_NS, str(tenant_id))


async def _process_pending_batch_locked(tenant_id: str, limit: int, ollama_url: str, ollama_model: str) -> dict:
    async with db.tenant_conn(tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT im.id, im.imap_uid, im.folder, im.from_email, im.from_name,
                   im.subject, im.attachments, im.tenant_id,
                   ua.imap_host, ua.imap_port, ua.imap_user, ua.imap_password,
                   ua.email as smtp_email, ua.display_name,
                   ua.smtp_host, ua.smtp_port, ua.smtp_user, ua.smtp_password, ua.smtp_tls
            FROM imap_messages im
            JOIN user_email_accounts ua ON ua.id=im.account_id
            WHERE im.tenant_id=$1 AND im.is_deleted IS NOT TRUE
              AND im.folder='INBOX' AND ua.is_active=TRUE
              AND (im.auto_processed IS NOT TRUE)
              AND im.attachments IS NOT NULL AND im.attachments!='[]'
            ORDER BY im.received_at DESC LIMIT $2""",
            tenant_id, limit)
    # rows fetched, connection above released - everything below opens its
    # own fresh per-item connection so each item commits independently.

    imap_conns = {}

    def _get_conn(host, port, user, pw):
        key = (host, port, user, pw)
        M = imap_conns.get(key)
        if M is not None:
            try:
                M.noop()
                return M
            except Exception:
                try:
                    M.logout()
                except Exception:
                    pass
                imap_conns.pop(key, None)
        M = imaplib.IMAP4_SSL(host, port)
        M.login(user, pw)
        M.select('INBOX', readonly=True)
        imap_conns[key] = M
        return M

    processed = skipped = created = errors = 0
    consecutive_connect_failures = 0
    for row in rows:
        attachments = row['attachments']
        if isinstance(attachments, str):
            try:
                attachments = json.loads(attachments or '[]')
            except Exception:
                attachments = []
        has_resume = any(
            is_resume_attachment(a.get('filename', ''), a.get('mime_type', ''))
            for a in (attachments or []))
        if not has_resume:
            async with db.tenant_conn(tenant_id) as conn:
                await conn.execute(
                    "UPDATE imap_messages SET auto_processed=TRUE,process_status='no_resume' WHERE id=$1",
                    row['id'])
            skipped += 1
            continue

        raw_pw = row['imap_password'] or ''
        try:
            imap_pw = base64.b64decode(raw_pw.encode()).decode()
        except Exception:
            imap_pw = raw_pw
        smtp_acc = {
            'email': row['smtp_email'],
            'display_name': row['display_name'] or 'AVIIN Jobs',
            'smtp_host': row['smtp_host'] or '',
            'smtp_port': row['smtp_port'] or 587,
            'smtp_user': row['smtp_user'] or '',
            'smtp_password': imap_pw,
            'smtp_tls': row['smtp_tls'] if row['smtp_tls'] is not None else True,
        } if row.get('smtp_host') else None

        try:
            M = _get_conn(row['imap_host'], row['imap_port'] or 993, row['imap_user'], imap_pw)
            consecutive_connect_failures = 0
        except Exception as ex:
            errors += 1
            consecutive_connect_failures += 1
            print(f'[ResumeIntake] IMAP connect failed, will retry next batch: {ex}')
            if consecutive_connect_failures >= 3:
                print('[ResumeIntake] 3 consecutive connect failures - aborting batch early to avoid rate-limit pileup')
                break
            await asyncio.sleep(2)
            continue

        try:
            async with db.tenant_conn(tenant_id) as conn:
                result = await process_email_for_resume(
                    conn=conn,
                    msg_id=str(row['id']),
                    tenant_id=str(row['tenant_id']),
                    account_id=None,
                    imap_uid=row['imap_uid'],
                    folder=row['folder'],
                    from_email=row['from_email'] or '',
                    from_name=row['from_name'] or '',
                    subject=row['subject'] or '',
                    attachments_meta=attachments,
                    imap_host=row['imap_host'],
                    imap_port=row['imap_port'] or 993,
                    imap_user=row['imap_user'],
                    imap_password=imap_pw,
                    ollama_url=ollama_url,
                    ollama_model=ollama_model,
                    smtp_acc=smtp_acc,
                    imap_conn=M,
                )
            # This item's own db.tenant_conn() has now committed (or rolled
            # back) independently - a slow/failed item can no longer hold
            # up or wipe out every other item in the batch, and progress on
            # already-finished items is durable even if a later item or the
            # whole process dies.
            processed += 1
            if result.get('status') == 'error':
                key = (row['imap_host'], row['imap_port'] or 993, row['imap_user'], imap_pw)
                imap_conns.pop(key, None)
                try:
                    M.logout()
                except Exception:
                    pass
            if result.get('status') == 'done' and result.get('candidate_id'):
                created += 1
        except Exception as ex:
            if 'uq_resume_files_msg_fname' in str(ex):
                # A resume_files row for this exact (msg_id, file_name)
                # already exists from an earlier attempt that inserted it
                # successfully but never got back to marking
                # imap_messages.auto_processed=TRUE (several since-fixed
                # bugs today could cause that). Without this, this one
                # message retries every batch forever, permanently
                # blocking whatever's queued behind it. Needs a fresh
                # connection - the one that raised this is already rolled
                # back and released.
                try:
                    async with db.tenant_conn(tenant_id) as rconn:
                        existing = await rconn.fetchrow(
                            "SELECT id, candidate_id FROM resume_files WHERE imap_msg_id=$1 LIMIT 1",
                            str(row['id']))
                        await rconn.execute(
                            "UPDATE imap_messages SET auto_processed=TRUE,process_status='done' WHERE id=$1", row['id'])
                    processed += 1
                    if existing and existing['candidate_id']:
                        created += 1
                except Exception as ex2:
                    errors += 1
                    print(f'[ResumeIntake] Recovery for {row["id"]} also failed: {ex2}')
                continue
            errors += 1
            print(f'[ResumeIntake] Error processing {row["id"]}: {ex}')

    for M in imap_conns.values():
        try:
            M.logout()
        except Exception:
            pass

    return {
        'processed': processed,
        'skipped_no_resume': skipped,
        'candidates_created_or_updated': created,
        'errors': errors,
    }
