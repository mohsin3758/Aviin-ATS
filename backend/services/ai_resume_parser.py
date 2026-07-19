"""
AI resume parser using Claude Haiku (claude-haiku-4-5-20251001).
Called by resume_intake_service.py when ANTHROPIC_API_KEY is set.
Returns the same dict shape as parse_resume_v2().
"""
import http.client
import json
import os
import re
from typing import Optional

_API_KEY = os.environ.get('ANTHROPIC_API_KEY', '')


def is_configured() -> bool:
    return bool(_API_KEY and _API_KEY.startswith('sk-ant-'))


_SYSTEM_PROMPT = """You are a resume parser. Extract structured data from the resume text.
Return ONLY a valid JSON object with these keys (use null for missing fields):
{
  "name": "Full Name of the candidate (person, not company)",
  "email": "candidate personal email (null if only role/shared emails found)",
  "phone": "phone number with country code if present",
  "current_employer": "most recent company name",
  "current_designation": "most recent job title",
  "total_exp_mo": integer months of total experience (0 if unknown),
  "skills": ["skill1", "skill2"],
  "location": "city or city, state",
  "linkedin_url": "linkedin profile URL or null",
  "notice_period_days": integer days or null,
  "current_ctc": "current salary/CTC as string or null",
  "expected_ctc": "expected salary/CTC as string or null",
  "education_level": "highest: phd/masters/bachelors/diploma/12th/10th or null",
  "degrees": ["degree name"],
  "institutions": ["institution name"],
  "companies_history": ["company1", "company2"]
}

Rules:
- name: extract the PERSON'S name only. Never use company names, university names, skill lists, or location names.
- email: only personal emails. Reject role addresses (hr@, recruiter@, noreply@, info@, careers@, postmaster@, admin@, etc.).
- Never invent or guess data. Return null for anything not present.
- Return ONLY the JSON, no markdown, no explanation."""


def parse_resume_with_ai(text: str) -> dict:
    """Parse resume text using Claude Haiku. Raises on API error."""
    if not is_configured():
        raise RuntimeError('ANTHROPIC_API_KEY not set')

    payload = json.dumps({
        'model': 'claude-haiku-4-5-20251001',
        'max_tokens': 1024,
        'system': _SYSTEM_PROMPT,
        'messages': [{'role': 'user', 'content': text[:6000]}]
    }).encode('utf-8')

    conn = http.client.HTTPSConnection('api.anthropic.com', timeout=30)
    conn.request('POST', '/v1/messages', body=payload, headers={
        'Content-Type': 'application/json',
        'x-api-key': _API_KEY,
        'anthropic-version': '2023-06-01',
    })
    resp = conn.getresponse()
    raw = resp.read().decode('utf-8')
    conn.close()

    if resp.status != 200:
        raise RuntimeError(f'Anthropic API error {resp.status}: {raw[:200]}')

    data = json.loads(raw)
    content = data['content'][0]['text'].strip()

    # Strip markdown code fences if present
    content = re.sub(r'^```(?:json)?\s*', '', content)
    content = re.sub(r'\s*```$', '', content)

    parsed = json.loads(content)

    # Normalise to expected types
    result = {
        'name': _str(parsed.get('name')),
        'email': _email(parsed.get('email')),
        'phone': _str(parsed.get('phone')),
        'current_employer': _str(parsed.get('current_employer')),
        'current_designation': _str(parsed.get('current_designation')),
        'total_exp_mo': _int(parsed.get('total_exp_mo')),
        'skills': _list(parsed.get('skills')),
        'location': _str(parsed.get('location')),
        'linkedin_url': _str(parsed.get('linkedin_url')),
        'notice_period_days': _int(parsed.get('notice_period_days')),
        'current_ctc': _str(parsed.get('current_ctc')),
        'expected_ctc': _str(parsed.get('expected_ctc')),
        'education_level': _str(parsed.get('education_level')),
        'degrees': _list(parsed.get('degrees')),
        'institutions': _list(parsed.get('institutions')),
        'companies_history': _list(parsed.get('companies_history')),
        '_confidence': 0.92,
        '_parse_source': 'ai_haiku',
    }
    return result


# ── helpers ──────────────────────────────────────────────────────────────────

_ROLE_PREFIXES = frozenset([
    'postmaster', 'noreply', 'noreplies', 'no-reply', 'donotreply', 'do-not-reply',
    'autoreply', 'auto-reply', 'admin', 'administrator', 'info', 'support', 'help',
    'helpdesk', 'contact', 'enquiry', 'enquiries', 'query', 'queries',
    'hr', 'hrd', 'recruitment', 'recruiter', 'recruiting', 'careers', 'jobs', 'hiring',
    'webmaster', 'hostmaster', 'abuse', 'security', 'alerts',
    'notification', 'notifications', 'mailer', 'mailbox',
    'bounce', 'unsubscribe', 'newsletter',
    'accounts', 'billing', 'sales', 'marketing', 'hello', 'team', 'office', 'feedback', 'reply',
])

_AVIIN_DOMS = frozenset([
    'aviintech.com', 'aviinjobs.com', 'aviin.in',
    'aviin.com', 'aviin.co.in', 'aviingroup.com',
])


def _str(v) -> Optional[str]:
    if v is None or v == '':
        return None
    s = str(v).strip()
    return s if s else None


def _int(v) -> int:
    try:
        return int(v) if v is not None else 0
    except (TypeError, ValueError):
        return 0


def _list(v) -> list:
    if isinstance(v, list):
        return [str(x).strip() for x in v if x]
    return []


def _email(v) -> Optional[str]:
    if not v or '@' not in str(v):
        return None
    e = str(v).strip().lower()
    user = e.split('@')[0].split('+')[0].rstrip('0123456789')
    if user in _ROLE_PREFIXES:
        return None
    domain = e.split('@')[-1]
    if domain in _AVIIN_DOMS:
        return None
    return e
