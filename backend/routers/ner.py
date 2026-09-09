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
    Third real gap fix (2026-08-23): the resume_text check above used
    plain Python `in` (a raw substring test), not a word-boundary check -
    harmless for a long, distinctive multi-word phrase, but a real false-
    positive risk once short, bare single-word requirements started being
    extracted verbatim from a recruiter's own typed query (e.g. "credit"
    as a required term would count "creditworthiness" as a match; "claim"
    would match inside "disclaimer"). Switched to the same word-boundary
    regex pattern already used elsewhere in this codebase for exactly
    this reason (TECH_SKILLS keyword extraction, _related_skill_hit) -
    strictly more correct than the substring check it replaces, never
    loosens an existing match.

    Fourth real gap fix (2026-09-06): a genuine, previously-undiscovered
    false-positive class found while investigating a live report of "AI
    Skills Matching... shows candidates matched for almost every skill" -
    the word-boundary check above is a pure grammatical check (is this a
    standalone word), with zero semantic awareness, so a resume literally
    stating "No ABAP development experience" still counted as a real
    match on "ABAP" - proven directly against a real synthetic resume
    before this fix (100% similarity on a required skill the candidate
    explicitly said they lack). _in_text() now checks EVERY occurrence
    of the term (not just the first) and only counts it as a genuine
    match if at least one occurrence has no negation cue word in its
    immediately preceding text - a real match elsewhere in the resume
    still counts even if one mention happens to be negated, matching this
    function's own established "never loosens an existing match, only
    ever removes a false one" discipline from the word-boundary fix
    above.

    Returns (skill_similarity_0_to_1, matched_skills, missing_skills)."""
    cand_lower = {s.lower() for s in (candidate_skills or []) if s}
    text_lower = (resume_text or "").lower()

    _NEGATION_CUES = {
        "no", "not", "without", "never", "lack", "lacking", "lacks",
        "none", "excluding", "except", "nor", "neither", "unfamiliar",
    }

    def _in_text(term: str) -> bool:
        if not text_lower:
            return False
        pattern = r'(?<![a-z0-9])' + re.escape(term) + r'(?![a-z0-9])'
        found_any = False
        for m in re.finditer(pattern, text_lower):
            found_any = True
            preceding = text_lower[max(0, m.start() - 40):m.start()]
            preceding_words = re.findall(r'[a-z]+', preceding)[-5:]
            if not any(w in _NEGATION_CUES for w in preceding_words):
                return True
        return False if found_any else False

    req_list = [s for s in (required_skills or []) if s]
    matched = [s for s in req_list if s.lower() in cand_lower or _in_text(s.lower())]
    missing = [s for s in req_list if s.lower() not in cand_lower and not _in_text(s.lower())]
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


def count_skill_occurrences(resume_text: Optional[str], skills: Optional[list]) -> dict:
    """Real feature (2026-09-09, Skill Verification Panel Phase 1): every
    caller of compute_skill_similarity() above only ever gets a yes/no per
    skill, even though its own _in_text() already walks every occurrence
    via re.finditer() to check for negation cues - the count was always
    right there, just discarded once the first genuine match was found.
    This is a deliberately separate, standalone function (not a refactor
    of _in_text/compute_skill_similarity) so the 8 existing callers of
    compute_skill_similarity across candidates.py/intelligence.py/
    requisitions.py/candidate_rediscovery.py keep behaving exactly as
    before - this only adds a new capability, it changes nothing existing.

    Returns RAW occurrence counts (every regex match, negation or not) -
    deliberately not negation-filtered. This is meant to answer "how many
    times does this word appear," matching a literal Ctrl+F in Word/PDF
    (the explicit comparison point this feature was requested against);
    negation-awareness is a separate, already-solved concern that stays
    scoped to match/no-match decisions elsewhere, not to this count.

    Returns {skill_name: count} for every skill in `skills`, 0 if none
    found or resume_text is empty."""
    text_lower = (resume_text or "").lower()
    out: dict = {}
    for skill in (skills or []):
        if not skill:
            continue
        if not text_lower:
            out[skill] = 0
            continue
        pattern = r'(?<![a-z0-9])' + re.escape(skill.lower()) + r'(?![a-z0-9])'
        out[skill] = len(re.findall(pattern, text_lower))
    return out


def compute_mandatory_coverage(
    candidate_skills: Optional[list],
    resume_text: Optional[str],
    mandatory_skills: Optional[list],
) -> dict:
    """Real feature (2026-09-09, Skill Verification Panel Phase 1): the
    recruiter's real manual process checks mandatory skills FIRST, as a
    gate, before anything else - but compute_skill_similarity() above
    scores every required skill (mandatory or optional) identically, and
    is used by 8 different call sites app-wide (Kanban board, every JD-
    match modal, candidate profile AI Match panel, rediscovery, Tier-1
    scorer) that never asked for mandatory-first weighting. Rather than
    change that shared function's behavior for all 8 (and silently shift
    scores across the app), this is a new, separate, additive function
    scoped to exactly this feature.

    Reuses the same word-boundary substring check compute_skill_similarity
    already relies on (candidate's structured skills[] OR a match in the
    resume's own text counts as found - a real skill mentioned only in a
    project bullet, not the parsed skills tags, is still real evidence),
    just scoped to mandatory_skills only and without compute_skill_
    similarity's negation-cue check (mandatory coverage is meant to be a
    strict, literal presence gate here, not a nuanced sentiment read).

    Returns {mandatory_total, mandatory_found, mandatory_missing,
    coverage_pct, gate_passed} - gate_passed is True only when every
    mandatory skill is found (100% coverage), matching the recruiter's
    own "all mandatory skills found" first check."""
    cand_lower = {s.lower() for s in (candidate_skills or []) if s}
    text_lower = (resume_text or "").lower()
    req_list = [s for s in (mandatory_skills or []) if s]

    def _found(skill: str) -> bool:
        if skill.lower() in cand_lower:
            return True
        if not text_lower:
            return False
        pattern = r'(?<![a-z0-9])' + re.escape(skill.lower()) + r'(?![a-z0-9])'
        return re.search(pattern, text_lower) is not None

    found = [s for s in req_list if _found(s)]
    missing = [s for s in req_list if s not in found]
    total = len(req_list)
    return {
        "mandatory_total": total,
        "mandatory_found": found,
        "mandatory_missing": missing,
        "coverage_pct": round(len(found) / total * 100, 1) if total else 100.0,
        "gate_passed": len(missing) == 0,
    }


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
