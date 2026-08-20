"""
Resume & JD NER — pure regex, zero-token, zero external LLM.
Uses local embed service (BGE-small) for semantic scoring.
"""
import re
from typing import Optional

# ── Common tech skills dictionary ─────────────────────────
SKILL_PATTERNS = [
    # Languages
    r'\bPython\b', r'\bJava\b', r'\bJavaScript\b', r'\bTypeScript\b',
    r'\bC\+\+\b', r'\bC#\b', r'\bGolang\b', r'\bRust\b', r'\bKotlin\b',
    r'\bSwift\b', r'\bPHP\b', r'\bRuby\b', r'\bScala\b', r'\bR\b',
    # Frameworks
    r'\bReact\b', r'\bAngular\b', r'\bVue\.?js\b', r'\bNode\.?js\b',
    r'\bDjango\b', r'\bFastAPI\b', r'\bFlask\b', r'\bSpring\b',
    r'\b\.NET\b', r'\bNext\.?js\b', r'\bExpress\b',
    # Databases
    r'\bPostgreSQL\b', r'\bMySQL\b', r'\bMongoDB\b', r'\bRedis\b',
    r'\bElasticsearch\b', r'\bCassandra\b', r'\bOracle\b',
    r'\bSQL\b', r'\bNoSQL\b', r'\bDynamoDB\b',
    # Cloud/DevOps
    r'\bAWS\b', r'\bAzure\b', r'\bGCP\b', r'\bGoogle Cloud\b',
    r'\bDocker\b', r'\bKubernetes\b', r'\bTerraform\b', r'\bJenkins\b',
    r'\bGitHub\b', r'\bGitLab\b', r'\bCI/CD\b',
    # AI/ML
    r'\bMachine Learning\b', r'\bDeep Learning\b', r'\bNLP\b',
    r'\bTensorFlow\b', r'\bPyTorch\b', r'\bscikit.?learn\b',
    r'\bPandas\b', r'\bNumPy\b', r'\bOpenCV\b',
    # Staffing-specific
    r'\bATS\b', r'\bBullhorn\b', r'\bWorkday\b', r'\bSAP\b',
    r'\bLinkedIn Recruiter\b', r'\bBoolean Search\b',
    r'\bSourcing\b', r'\bHeadhunting\b', r'\bEnd.to.End Recruitment\b',
    r'\bTalent Acquisition\b', r'\bHR\b', r'\bPayroll\b',
]

TITLE_PATTERNS = [
    r'(?:Senior|Sr\.?|Junior|Jr\.?|Lead|Principal|Staff|Associate)?\s*'
    r'(?:Software|Backend|Frontend|Full.?Stack|DevOps|Data|ML|AI|Cloud|'
    r'Mobile|iOS|Android|QA|Test|Security|Platform|Infrastructure|'
    r'Embedded|Systems|Network|Database|UI|UX|Product|Project|'
    r'Recruitment|HR|Talent|Account|Sales|Business|Marketing)\s*'
    r'(?:Engineer|Developer|Architect|Manager|Analyst|Scientist|'
    r'Consultant|Specialist|Director|Lead|Head|Officer|Executive|'
    r'Recruiter|Partner|Associate|Advisor)s?\b',
]

EDUCATION_KEYWORDS = {
    'PhD':      [r'\bPhD\b', r'\bDoctorate\b', r'\bD\.Phil\b'],
    'Masters':  [r'\bM\.?Tech\b', r'\bM\.?S\b', r'\bMBA\b', r'\bM\.?E\b',
                 r'\bMasters?\b', r'\bMSc\b', r'\bM\.?Sc\b'],
    'Bachelors':[r'\bB\.?Tech\b', r'\bBE\b', r'\bB\.?E\b', r'\bBSc\b',
                 r'\bB\.?Sc\b', r'\bBCA\b', r'\bBBA\b', r'\bBachelor\b',
                 r'\bGraduat\b'],
    'Diploma':  [r'\bDiploma\b', r'\bPolytechnic\b', r'\bITI\b'],
}

EXP_YEAR_RANGE = re.compile(
    r'(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|'
    r'January|February|March|April|June|July|August|September|October|November|December)?'
    r'\s*(20\d{2}|19\d{2})\s*[-–—to]+\s*(20\d{2}|19\d{2}|Present|Current|Till date)',
    re.IGNORECASE
)

EMAIL_RE    = re.compile(r'\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b')
PHONE_RE    = re.compile(r'(?:\+91[-\s]?)?[6-9]\d{9}|\+\d{1,3}[-\s]?\d{6,14}')
LINKEDIN_RE = re.compile(r'linkedin\.com/in/[\w\-]+', re.IGNORECASE)


def extract_skills(text: str) -> list[str]:
    found = set()
    for pat in SKILL_PATTERNS:
        for m in re.finditer(pat, text, re.IGNORECASE):
            found.add(m.group(0).strip())
    return sorted(found)


def extract_titles(text: str) -> list[str]:
    found = set()
    for pat in TITLE_PATTERNS:
        for m in re.finditer(pat, text, re.IGNORECASE):
            t = m.group(0).strip()
            if len(t) > 3:
                found.add(t)
    return sorted(found)[:10]


def extract_education(text: str) -> tuple[str, list[str]]:
    level = 'Other'
    degrees = []
    for lvl, patterns in EDUCATION_KEYWORDS.items():
        for pat in patterns:
            if re.search(pat, text, re.IGNORECASE):
                degrees.append(pat.replace(r'\b','').replace('?','').strip('.'))
                if list(EDUCATION_KEYWORDS).index(lvl) < list(EDUCATION_KEYWORDS).index(level.replace('Other','Diploma')+'' if level != 'Other' else 'Diploma'):
                    level = lvl
    # Determine highest
    for lvl in ('PhD', 'Masters', 'Bachelors', 'Diploma'):
        for pat in EDUCATION_KEYWORDS[lvl]:
            if re.search(pat, text, re.IGNORECASE):
                level = lvl
                break
        if level == lvl:
            break
    return level, list(set(degrees))[:5]


def extract_experience(text: str) -> tuple[float, int, int, float]:
    """Returns (total_years, job_count, max_gap_months, avg_tenure_months)."""
    matches = EXP_YEAR_RANGE.findall(text)
    periods = []
    current_year = 2025
    for _, start_yr, end_yr in matches:
        try:
            s = int(start_yr)
            e = current_year if end_yr.lower() in ('present','current','till date') else int(end_yr)
            if 1990 <= s <= current_year and s <= e <= current_year + 1:
                periods.append((s, e))
        except Exception:
            pass

    if not periods:
        return 0.0, 0, 0, 0.0

    periods.sort()
    total_years = sum(e - s for s, e in periods)
    job_count   = len(periods)
    # Gap analysis (year-based, rough)
    gaps = []
    for i in range(1, len(periods)):
        gap = periods[i][0] - periods[i-1][1]
        if gap > 0:
            gaps.append(gap * 12)  # convert to months approx
    max_gap = max(gaps) if gaps else 0
    avg_tenure = (total_years / job_count * 12) if job_count else 0
    return float(total_years), job_count, max_gap, round(avg_tenure, 1)


def parse_resume(text: str) -> dict:
    """Full resume parse. Returns structured dict."""
    if not text:
        return {}
    skills      = extract_skills(text)
    titles      = extract_titles(text)
    edu_level, degrees = extract_education(text)
    total_yr, job_cnt, max_gap, avg_tenure = extract_experience(text)
    email_m   = EMAIL_RE.search(text)
    phone_m   = PHONE_RE.search(text)
    linkedin_m = LINKEDIN_RE.search(text)
    return {
        'extracted_skills':    skills,
        'extracted_titles':    titles,
        'education_level':     edu_level,
        'degrees':             degrees,
        'total_years_exp':     total_yr,
        'job_count':           job_cnt,
        'max_gap_months':      max_gap,
        'avg_tenure_months':   avg_tenure,
        'extracted_email':     email_m.group(0) if email_m else None,
        'extracted_phone':     phone_m.group(0) if phone_m else None,
        'linkedin_url':        f"https://{linkedin_m.group(0)}" if linkedin_m else None,
    }


def compute_skill_similarity(
    candidate_skills: Optional[list] = None,
    required_skills: Optional[list] = None,
    cosine_sim_value: Optional[float] = None,
    resume_text: Optional[str] = None,
) -> tuple:
    """Real gap fix (2026-08-20): skill_match_score previously came ONLY
    from embed cosine similarity of free-text JD description - if a
    requisition had no description text (jd_text empty/None), skill_sim
    silently defaulted to 0.0 even when the requisition's own structured
    `skills_required` list had real, checkable overlap with the
    candidate's skills (the exact same keyword comparison already used
    elsewhere in this codebase for the matched_skills/missing_skills UI
    chips - just never fed back into the score itself). Blends both
    signals honestly instead of letting either one silently zero out the
    other: keyword overlap against skills_required (explicit, zero-token,
    most reliable when present) weighted 60%, semantic cosine similarity
    of the free-text JD (fuzzier, but the only signal when skills_required
    is empty) weighted 40% - falls back to whichever single signal is
    actually available, and only to 0.0 when neither exists at all.

    Second real gap fix (2026-08-20, same day): a skill was only ever
    checked against the candidate's STRUCTURED `skills` array - which is
    itself the output of an imperfect resume-parsing pass and routinely
    misses a genuine skill mentioned in the resume's actual project/
    experience text but never pulled into that array. A candidate with
    real "Claim Management" experience described in a project bullet, but
    whose parsed `skills` list only captured "SAP FICO"/"SAP HANA", was
    shown as flatly missing it - not a fair "is this genuinely absent"
    signal. `resume_text`, when given, is checked as a second, case-
    insensitive substring pass before a required skill is declared
    missing - a skill found only in resume_text (not the structured list)
    still counts as matched, since it's real, checkable evidence, just
    not one this app's own parser happened to capture structurally.
    Returns (skill_similarity_0_to_1, matched_skills, missing_skills)."""
    cand_lower = {s.lower() for s in (candidate_skills or []) if s}
    text_lower = (resume_text or "").lower()
    req_list = [s for s in (required_skills or []) if s]
    matched = [s for s in req_list if s.lower() in cand_lower or (text_lower and s.lower() in text_lower)]
    missing = [s for s in req_list if s.lower() not in cand_lower and not (text_lower and s.lower() in text_lower)]
    keyword_ratio = (len(matched) / len(req_list)) if req_list else None

    if keyword_ratio is not None and cosine_sim_value is not None:
        sim = 0.6 * keyword_ratio + 0.4 * cosine_sim_value
    elif keyword_ratio is not None:
        sim = keyword_ratio
    elif cosine_sim_value is not None:
        sim = cosine_sim_value
    else:
        sim = 0.0
    return sim, matched, missing


def score_candidate(
    parsed: dict,
    candidate_exp_mo: int = 0,
    required_exp_yr_min: float = 0,
    required_exp_yr_max: Optional[float] = None,
    skill_similarity: float = 0.0,   # 0-1 from cosine
    required_education: Optional[str] = None,
    check_duplicates: bool = False,
) -> dict:
    """Compute P19 intelligence scores (all rule-based)."""
    # 1. Skill match (from embed cosine, scaled 0-100)
    skill_score = round(min(skill_similarity * 100, 100), 2)

    # 2. Experience fit
    # Real bug fixed 2026-08-20, found while backfilling requisition
    # matching for the existing Resume Inbox queue: total_years_exp comes
    # from a NUMERIC column (candidate_parsed_data), which asyncpg returns
    # as a Python Decimal - a genuinely pre-existing latent bug (the old
    # composite formula multiplied exp_score by a float too), just never
    # triggered before today because no candidate with a Decimal-valued
    # total_years_exp had ever been scored via this exact code path.
    # float() here keeps every downstream computation in plain float,
    # since Decimal arithmetic with float literals raises TypeError.
    actual_yr = float((parsed.get('total_years_exp') or 0) or (candidate_exp_mo / 12))
    if required_exp_yr_max:
        if actual_yr < required_exp_yr_min:
            exp_score = max(0, 50 - (required_exp_yr_min - actual_yr) * 10)
        elif actual_yr > required_exp_yr_max * 1.5:
            exp_score = 70  # overqualified
        else:
            exp_score = 100
    elif required_exp_yr_min > 0:
        ratio = min(actual_yr / required_exp_yr_min, 2.0)
        exp_score = min(ratio * 70, 100)
    else:
        exp_score = 80

    # 3. Stability
    max_gap   = parsed.get('max_gap_months', 0) or 0
    avg_ten   = parsed.get('avg_tenure_months', 0) or 0
    if max_gap > 18:
        stab = 40
    elif max_gap > 12:
        stab = 60
    elif max_gap > 6:
        stab = 75
    else:
        stab = 90
    if avg_ten > 0 and avg_ten < 12:
        stab = max(stab - 20, 20)  # job hopper penalty
    stability_score = stab

    # 4. Education
    edu_rank = {'PhD':100, 'Masters':85, 'Bachelors':70, 'Diploma':50, 'Other':40}
    if required_education and required_education in edu_rank:
        cand_lvl = parsed.get('education_level', 'Other')
        cand_rank = edu_rank.get(cand_lvl, 40)
        req_rank  = edu_rank[required_education]
        edu_score = min(100, (cand_rank / req_rank) * 100) if req_rank > 0 else 80
    else:
        edu_score = 75

    # 5. Fraud risk (lower is better — 0 = no risk)
    fraud_risk = 0
    gap_flag = max_gap > 12

    # 6. Composite Readiness Index
    # Real fix (2026-08-20): skill match was only 35% of the composite,
    # so a candidate with ZERO overlapping skills for a role could still
    # land a "C" grade (50%+) purely from strong experience/stability/
    # education - reported live as a "fake" match score by a real user
    # (a SAP FI/CO functional consultant scored 52% against an SAP ABAP
    # Developer role and a Senior React Developer role despite matching
    # none of either role's required skills). Skill fit is the single
    # most decisive signal for a role-specific match, so it now carries
    # more weight AND directly gates the final composite - a candidate
    # with 0% skill overlap can never score above half of what their
    # non-skill factors alone would suggest, while a strong skill match
    # is never penalized (gate=1.0 at skill_score=100).
    readiness_raw = (
        skill_score    * 0.40 +
        exp_score      * 0.22 +
        stability_score* 0.18 +
        edu_score      * 0.15 +
        max(0, 100 - fraud_risk) * 0.05
    )
    skill_gate = 0.5 + 0.5 * (skill_score / 100)
    readiness = round(readiness_raw * skill_gate, 2)

    return {
        'skill_match_score':      skill_score,
        'experience_score':       round(exp_score, 2),
        'stability_score':        round(stability_score, 2),
        'education_score':        round(edu_score, 2),
        'fraud_risk_score':       round(fraud_risk, 2),
        'readiness_index':        readiness,
        'readiness_grade':        (
            'A+' if readiness >= 85 else 'A' if readiness >= 75 else
            'B'  if readiness >= 65 else 'C' if readiness >= 50 else 'D'
        ),
        'has_gap_flag':           gap_flag,
        'duplicate_flag':         False,
        'inconsistency_flag':     False,
    }
