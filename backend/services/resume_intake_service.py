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
from services.document_classifier import classify_document, is_resume_document, DOC_RESUME
try:
    from services.dedup_service import check_duplicate, compute_file_hash, EXACT_MATCH, HIGH_CONFIDENCE
    DEDUP_AVAILABLE = True
except ImportError:
    DEDUP_AVAILABLE = False
from services.improved_parser import parse_resume_v2, extract_skills_from_text, calc_confidence
try:
    from services.ai_resume_parser import parse_resume_with_ai, is_configured as _ai_configured
except Exception:
    parse_resume_with_ai = None
    _ai_configured = lambda: False


def _clean_text(text: str) -> str:
    """Remove null bytes and control characters that PostgreSQL rejects."""
    return (text or '').replace('\x00', ' ').replace('\r', ' ')[:5000]


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

def is_junk_sender(from_email: str) -> bool:
    """Returns True if this sender is clearly not sending resumes."""
    domain = (from_email or '').lower().split('@')[-1] if '@' in (from_email or '') else ''
    return domain in SENDER_BLACKLIST

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
                        return json.loads(m.group(0))
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
                           from_email: str, file_path: str, resume_text: str) -> str:
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
    return str(new_id)


# ─── Phase 4: Job Matching ────────────────────────────────────────────────────
async def match_requisition(conn, tenant_id: str, subject: str, skills: list, job_board: str = ''):
    if not subject:
        return None
    reqs = await conn.fetch(
        "SELECT id, title FROM requisitions WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50",
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

    # 3. Skills-based fallback
    if skills:
        skill_set = {s.lower() for s in skills}
        for r in reqs:
            title_words = {w.lower() for w in r['title'].split()}
            if skill_set & title_words:
                return str(r['id'])
    return None


async def create_application(conn, tenant_id: str, candidate_id: str, requisition_id: str):
    try:
        await conn.execute("""
            INSERT INTO applications(tenant_id,requisition_id,candidate_id,stage)
            VALUES($1,$2,$3,'sourced')
            ON CONFLICT(tenant_id,requisition_id,candidate_id) DO NOTHING""",
            tenant_id, requisition_id, candidate_id)
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

    # Skip blacklisted senders (banks, alerts, newsletters)
    if is_junk_sender(from_email):
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
        full_text = (resume_text + '\n' + body_text_clean)[:6000]

        # ── Phase A: Document Classification ──────────────────────────
        # REJECT invoices, bank statements, forms BEFORE creating candidates
        doc_result = classify_document(full_text, fn)
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
        parsed = parse_resume_v2(full_text, from_name, from_email, fn)
        # Ollama enhancement if available
        if ollama_url and ollama_model:
            llm = await parse_with_ollama(full_text, ollama_url, ollama_model)
            if llm:
                parsed = merge_parsed(parsed, llm)
        if not parsed.get('email') and '@' in (from_email or ''):
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
        candidate_id = await upsert_candidate(conn, tenant_id, parsed, job_board, label,
                                              from_email, file_path, resume_text)
    else:
        candidate_id = None
        print(f'[Routing] LOW_CONFIDENCE (conf={conf:.2f}): file stored, no candidate created')

    requisition_id = await match_requisition(conn, tenant_id, subject, parsed.get('skills', []), job_board)
    if requisition_id:
        await create_application(conn, tenant_id, candidate_id, requisition_id)

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


async def process_pending_batch(conn, tenant_id: str, limit: int = 50, ollama_url: str = '', ollama_model: str = '') -> dict:
    """Process up to `limit` pending resume emails for one tenant. Shared by
    both POST /resume-intake/process-pending (manual trigger) and the
    scheduled backlog-clearing job in scheduler.py, so both go through the
    exact same connection-reuse + circuit-breaker + per-item-transaction
    logic rather than drifting into two copies of this bug-prone flow."""
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
            async with conn.transaction():
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
