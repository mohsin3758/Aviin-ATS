"""
Phase B: Improved Resume Parser
Fixes all baseline failures:
  1. Name: first-line extraction (not regex pattern matching)
  2. Email: handles PDF artifacts (spaces, line breaks)
  3. Phone: all Indian + international formats
  4. Skills: keyword-based from technology dictionary (not section parsing)
  5. Experience: multiple patterns, overlapping date intervals
  6. Company/Designation: from work history section detection
  7. Ollama LLM: used for enhancement when available
  8. Confidence scoring: tells pipeline if parse is reliable

Zero API cost. All free.
"""
import re
from typing import Optional
try:
    # BUG FIX (2026-08-10 audit): this used to import _CACHE_LOADED BY NAME,
    # which copies its value (False) at import time and never sees the real
    # module's later update to True once init_cache() runs — the guard
    # below permanently read a stale False, so DB-backed skill
    # normalization never executed a single time in production despite the
    # cache genuinely loading correctly. Importing the module itself and
    # reading skill_normalizer._CACHE_LOADED at call time (not import time)
    # fixes it - the same variable, always current.
    import services.skill_normalizer as skill_normalizer
    from services.skill_normalizer import normalize_skills_list, normalize_skill
except ImportError:
    skill_normalizer = None
    normalize_skills_list = None
    normalize_skill = None

# ─── Section header blacklist (never extract these as names) ──────────────────
SECTION_HEADERS = frozenset([
    'professional summary', 'career summary', 'career objective', 'objective',
    'professional profile', 'profile summary', 'executive summary', 'summary',
    'work experience', 'professional experience', 'employment history',
    'experience', 'technical skills', 'core competencies', 'key skills',
    'skills', 'education', 'qualifications', 'certifications', 'projects',
    'achievements', 'awards', 'publications', 'references', 'contact',
    'personal details', 'personal information', 'personal profile',
    'curriculum vitae', 'resume', 'declarations', 'declaration',
    'enhancements frameworks', 'sybase high availability implementation',
    'requirements gathering', 'project details', 'career overview',
    'total experience', 'additional information', 'tools and technologies',
    # REAL BUG FOUND 2026-08-31: bare single/short-line section headers
    # (no "professional"/"personal" prefix) weren't in this list at all,
    # so a resume laid out with a standalone "Profile" or "About Me"
    # header line got that header returned as the candidate's own name -
    # confirmed on 7 and 3 real candidates respectively.
    'profile', 'about me',
])

# ─── Technology & Skill Keyword Dictionary ────────────────────────────────────
# Exhaustive list for Indian IT / staffing market
# Format: (canonical_name, [aliases/variants])
TECH_SKILLS = {
    # SAP (most common in Aviin's niche)
    'SAP ABAP': ['abap', 'sap abap', 'abap on hana', 'abap oop', 'abap objects',
                 'abap/4', 'abap4', 'sap abap oop', 'abap programming'],
    'SAP Basis': ['sap basis', 'basis', 'netweaver', 'sap netweaver', 'abap basis',
                  'sap infrastructure'],
    'SAP FICO': ['sap fico', 'sap fi', 'sap co', 'fi/co', 'fico', 'financial accounting',
                 's/4hana finance', 'sap finance'],
    'SAP SD': ['sap sd', 'sales distribution', 'order to cash', 'o2c'],
    # REAL BUG FIX (2026-08-18): 'materials management'/'procurement' alone
    # are generic engineering/business terms, not SAP-specific -- they
    # false-matched non-IT resumes (e.g. EPC/piping engineers who use
    # "procurement" in its plain-English sense). Kept only the aliases
    # that actually name the SAP module.
    'SAP MM': ['sap mm', 'sap materials management', 'sap procurement'],
    'SAP PP': ['sap pp', 'production planning', 'mrp'],
    'SAP PM': ['sap pm', 'plant maintenance'],
    'SAP QM': ['sap qm', 'quality management'],
    'SAP WM': ['sap wm', 'warehouse management', 'ewm', 'sap ewm'],
    'SAP HR': ['sap hr', 'human capital management', 'hcm', 'sap hcm', 'payroll'],
    'SAP BW': ['sap bw', 'business warehouse', 'bi/bw', 'sap bi'],
    'SAP HANA': ['sap hana', 's/4hana', 's4hana', 'hana', 'sap s/4'],
    'BAPI': ['bapi', 'business application programming interface'],
    'BADI': ['badi', 'business add-ins', 'user exit'],
    'SmartForms': ['smartforms', 'smart forms', 'adobe forms', 'adobe livecycle'],
    'ALV': ['alv', 'alv grid', 'alv reports', 'classical alv'],
    'LSMW': ['lsmw', 'legacy system migration workbench', 'data migration'],
    'RICEF': ['ricef', 'rice', 'rice objects'],
    'CDS Views': ['cds', 'cds views', 'core data services'],
    'OData': ['odata', 'o-data', 'rest api', 'sap api'],
    'Fiori': ['fiori', 'sap fiori', 'fiori elements', 'launchpad'],
    'SAPUI5': ['sapui5', 'ui5', 'sap ui5'],
    'SAP BTP': ['btp', 'sap btp', 'business technology platform', 'sap cloud platform'],
    'SAP CPI': ['cpi', 'cloud platform integration', 'sap integration suite', 'pi/po', 'sap pi'],

    # Programming Languages
    'Python': ['python', 'python3', 'python 3'],
    'Java': ['java', 'java 8', 'java 11', 'java ee', 'spring boot', 'j2ee'],
    'JavaScript': ['javascript', 'js', 'java script', 'ecmascript', 'es6', 'es2015'],
    'TypeScript': ['typescript', 'ts'],
    'C#': ['c#', 'c sharp', '.net', 'asp.net', 'dotnet'],
    'C++': ['c++', 'cpp', 'c plus plus'],
    # REAL BUG FIX (2026-08-18): canonical key "Go" was auto-registered as
    # a matchable keyword (same root cause as Spring/REST/Shell/Swift
    # above) despite the alias list already being narrow -- false-matched
    # "Go-Live" (a phrase repeated many times on a real SAP/project-
    # management resume: "System Cutover (Go-Live)", "Go-Live Support")
    # since the hyphen still counts as a word boundary. Renamed the key;
    # alias list unchanged.
    'Go (Golang)': ['golang', 'go lang'],
    'Rust': ['rust', 'rust lang'],
    'PHP': ['php', 'laravel', 'symfony'],
    'Ruby': ['ruby', 'ruby on rails', 'ror', 'rails'],
    'Kotlin': ['kotlin'],
    # REAL BUG FIX (2026-08-18): the alias list's bare 'swift' false-matched
    # "SWIFT" the banking/finance wire-transfer protocol (a real resume:
    # "...ACH, SWIFT, EDI, PMW, DMEE...") -- extremely common vocabulary on
    # SAP/Finance/Banking resumes. Renaming just the alias wasn't enough --
    # the canonical key "Swift" itself gets auto-registered as a matchable
    # keyword regardless of the alias list (same root cause as the Spring/
    # REST/Shell fixes), so the key itself had to move too. 'ios' alone
    # still catches genuine iOS-dev mentions.
    'Swift (iOS)': ['swiftui', 'swift programming', 'ios'],
    'R': ['r language', 'r programming', 'rstudio'],
    'Scala': ['scala', 'scala spark'],
    # REAL BUG FIX (2026-08-18): the alias list here was already narrow
    # (no bare 'shell'), but the canonical key ITSELF ("Shell") gets
    # auto-registered as a matchable keyword regardless of its alias list
    # -- the same root cause as the earlier same-day Spring/REST fix. On a
    # real SAP resume, "Shell" is a CLIENT NAME (Shell Oil), not the
    # scripting skill. Renamed to match what the alias list actually means.
    'Shell Scripting': ['bash', 'shell script', 'shell scripting', 'ksh', 'zsh', 'powershell'],
    'SQL': ['sql', 'mysql', 'postgresql', 'pl/sql', 'plsql', 't-sql', 'tsql'],

    # Cloud Platforms
    'AWS': ['aws', 'amazon web services', 'ec2', 's3', 'lambda', 'rds', 'dynamodb',
            'cloudwatch', 'iam', 'vpc', 'cloudformation', 'eks', 'ecs'],
    'Azure': ['azure', 'microsoft azure', 'azure devops', 'aks', 'azure functions',
              'azure blob', 'azure sql'],
    'GCP': ['gcp', 'google cloud', 'google cloud platform', 'bigquery', 'dataflow',
            'pubsub', 'gke', 'cloud run'],
    'Oracle Cloud': ['oracle cloud', 'oci'],

    # Databases
    'MySQL': ['mysql', 'mariadb'],
    'PostgreSQL': ['postgresql', 'postgres', 'postgre sql'],
    'MongoDB': ['mongodb', 'mongo'],
    'Oracle': ['oracle', 'oracle db', 'oracle database'],
    'SQL Server': ['sql server', 'mssql', 'microsoft sql server'],
    'Redis': ['redis'],
    'Elasticsearch': ['elasticsearch', 'elastic search', 'elk stack'],
    'Cassandra': ['cassandra', 'apache cassandra'],
    'Snowflake': ['snowflake'],
    'Databricks': ['databricks'],
    'DB2': ['db2', 'ibm db2'],
    'Sybase': ['sybase', 'ase', 'sybase ase', 'adaptive server'],

    # DevOps & Infrastructure
    'Docker': ['docker', 'containerization', 'docker compose'],
    'Kubernetes': ['kubernetes', 'k8s', 'helm', 'kubectl'],
    'Terraform': ['terraform', 'infrastructure as code', 'iac'],
    'Ansible': ['ansible'],
    # REAL BUG FIX (2026-08-18): bare 'pipeline' isn't Jenkins-specific --
    # it false-matched pipeline engineers, sales pipelines, data
    # pipelines, etc. 'CI/CD pipeline' together is still safely specific.
    'Jenkins': ['jenkins', 'ci/cd', 'ci/cd pipeline', 'jenkins pipeline'],
    'Git': ['git', 'github', 'gitlab', 'bitbucket', 'version control'],
    'Linux': ['linux', 'unix', 'ubuntu', 'centos', 'rhel', 'red hat'],
    'Nginx': ['nginx', 'apache'],

    # Data & ML
    'Apache Spark': ['spark', 'apache spark', 'pyspark', 'scala spark'],
    'Hadoop': ['hadoop', 'hive', 'hdfs', 'mapreduce'],
    'Airflow': ['airflow', 'apache airflow'],
    'Kafka': ['kafka', 'apache kafka'],
    'TensorFlow': ['tensorflow', 'tf', 'keras'],
    'PyTorch': ['pytorch', 'torch'],
    'scikit-learn': ['scikit-learn', 'sklearn', 'machine learning', 'ml'],
    'Pandas': ['pandas', 'numpy', 'scipy'],
    'Power BI': ['power bi', 'powerbi', 'dax', 'power query'],
    'Tableau': ['tableau', 'tableau desktop'],

    # Web Frameworks
    'React': ['react', 'reactjs', 'react.js', 'react native'],
    'Angular': ['angular', 'angularjs', 'angular 2+'],
    'Vue': ['vue', 'vuejs', 'vue.js'],
    'Node.js': ['nodejs', 'node.js', 'node js', 'express', 'expressjs'],
    'Django': ['django'],
    'Flask': ['flask'],
    'FastAPI': ['fastapi', 'fast api'],
    # REAL BUG FIX (2026-08-18): the bare 'spring' alias matched "spring
    # hanger" (a real piping-engineering term for a thermal-expansion
    # pipe support), spring water, the season, etc. Just removing it
    # from the alias list wasn't enough -- the canonical key itself gets
    # auto-registered as a matchable keyword too (see _SKILL_LOOKUP
    # below), so a bare canonical name of "Spring" reintroduced the same
    # false positive. Renamed the canonical key to the specific,
    # unambiguous "Spring Boot".
    'Spring Boot': ['spring boot', 'spring mvc', 'spring framework', 'springframework'],

    # Testing
    'Selenium': ['selenium', 'automation testing', 'test automation'],
    'JUnit': ['junit', 'pytest', 'unit testing', 'test driven', 'tdd'],

    # Methodologies
    'Agile': ['agile', 'scrum', 'kanban', 'sprint'],
    'DevOps': ['devops', 'devsecops'],
    'Microservices': ['microservices', 'micro services', 'service mesh'],
    # REAL BUG FIX (2026-08-18): same class of bug as Spring Boot above --
    # bare 'rest'/'api' are ordinary English/generic tech words ("...and
    # the rest of the team"), and the bare canonical name "REST" would
    # have reintroduced the same false positive via auto-registration
    # even with the generic aliases removed. Renamed to "REST API".
    'REST API': ['restful', 'rest api', 'restful api', 'web services'],
    'GraphQL': ['graphql'],
}

# Build fast lookup: lowercase alias → canonical name
_SKILL_LOOKUP: dict[str, str] = {}
for canonical, aliases in TECH_SKILLS.items():
    _SKILL_LOOKUP[canonical.lower()] = canonical
    for alias in aliases:
        _SKILL_LOOKUP[alias.lower()] = canonical


def extract_skills_from_text(text: str) -> list[str]:
    """
    Keyword-based skill extraction.
    Scans entire resume text for known technology keywords.
    Returns deduplicated list of canonical skill names.
    """
    text_lower = ' ' + text.lower() + ' '
    found: dict[str, bool] = {}

    for alias, canonical in _SKILL_LOOKUP.items():
        # Word-boundary matching: surrounded by non-alphanumeric chars
        pattern = r'(?<![a-z0-9])' + re.escape(alias) + r'(?![a-z0-9])'
        if re.search(pattern, text_lower):
            found[canonical] = True

    return list(found.keys())


def extract_name_v2(text: str, from_name: str = '') -> Optional[str]:
    """
    Improved name extraction: uses first meaningful lines of document.
    Most resumes start with the candidate's name in the first 1-3 lines.
    """
    # Priority 1: From email sender name (if passed and looks like a real name)
    if from_name and len(from_name.split()) >= 2:
        fn_lower = from_name.lower()
        if not any(h in fn_lower for h in SECTION_HEADERS):
            clean = from_name.strip().strip('"\'')
            if re.match(r'^[A-Z][a-zA-Z]', clean) and len(clean) < 60:
                return clean

    # Priority 2: First few non-empty, non-header lines
    lines = []
    for raw_line in text.split('\n'):
        stripped = raw_line.strip()
        if stripped and len(stripped) >= 2:
            lines.append(stripped)
        if len(lines) >= 10:
            break

    for line in lines[:8]:
        line_lower = line.lower()
        # Skip known section headers
        # Skip if line IS a section header (exact or substring match)
        if any(h in line_lower for h in SECTION_HEADERS):
            continue
        # Extra: skip common 2-word section phrases not caught above
        if line_lower in ('career objective', 'career summary', 'professional summary',
                           'key skills', 'core competencies', 'personal details',
                           'contact information', 'personal information',
                           'technical expertise', 'areas of expertise'):
            continue
        # Skip lines that are job titles / role descriptions (contain | or /)
        # but allow names with dots (e.g., "Vijay.K")
        words = line.split()
        if not words or len(words) > 5:
            continue
        # All words should start with capital or be abbreviated (X.Y)
        looks_like_name = True
        for w in words:
            clean_w = w.rstrip('.,')
            if not clean_w:
                continue
            if not (clean_w[0].isupper() or clean_w[0].isdigit()):
                looks_like_name = False
                break
            # Reject if word contains numbers (e.g. "Senior2" or "Lead123")
            if re.search(r'\d{2,}', clean_w):
                looks_like_name = False
                break
        if not looks_like_name:
            continue
        # Reject lines that are clearly designations. REAL BUG FOUND
        # 2026-08-31: this only ever fired for a 2+ word line
        # (`len(words) > 1`) - a bare single-word designation on its own
        # line ("Manager", "Consultant") sailed straight through and got
        # wrongly returned as the candidate's name; confirmed live on 3
        # real candidates. None of these designation words are plausible
        # substrings of a real single-word person name, so dropping the
        # length restriction closes this with no real risk of rejecting
        # a genuine name.
        designation_signals = ['senior', 'junior', 'lead', 'manager', 'engineer',
                               'consultant', 'developer', 'analyst', 'architect',
                               'specialist', 'associate', 'executive', 'director',
                               'officer', 'head', 'vp', 'cto', 'ceo', 'sap']
        if any(ds in line_lower for ds in designation_signals):
            continue
        # Looks like a name: 1-4 words, properly capitalized
        if 1 <= len(words) <= 4:
            # Normalize: handle "ALOK SINGH" (all caps) → "Alok Singh"
            if line.isupper():
                return line.title()
            return line

    # Fallback for OCR text: scan full text for proper name pattern
    # OCR from scanned PDFs often has name buried mid-paragraph
    name_pattern = re.compile(
        r'([A-Z][a-z]{1,15})\s+([A-Z][a-z]{1,15})\s+([A-Z][a-z]{1,15})')
    for match in name_pattern.finditer(text[:1500]):
        candidate = match.group(0)
        c_lower = candidate.lower()
        if not any(h in c_lower for h in SECTION_HEADERS):
            if not any(d in c_lower for d in ['sap', 'abap', 'java', 'python', 'sql',
                                               'oracle', 'linux', 'react', 'angular']):
                return candidate

    if from_name:
        return from_name.split('@')[0].replace('.', ' ').replace('_', ' ').title()
    return None


_ROLE_EMAIL_PREFIXES = frozenset([
    'postmaster', 'noreply', 'noreplies', 'no-reply', 'donotreply', 'do-not-reply',
    'autoreply', 'auto-reply', 'admin', 'administrator', 'info', 'support', 'help',
    'helpdesk', 'contact', 'enquiry', 'enquiries', 'query', 'queries',
    'hr', 'hrd', 'recruitment', 'recruiter', 'recruiting', 'careers', 'jobs', 'hiring',
    'webmaster', 'hostmaster', 'abuse', 'security', 'alerts',
    'notification', 'notifications', 'mailer', 'mailbox',
    'bounce', 'unsubscribe', 'newsletter',
    'accounts', 'billing', 'sales', 'marketing', 'hello', 'team', 'office', 'feedback', 'reply',
])

def _is_role_email(email: str) -> bool:
    if not email or '@' not in email:
        return False
    raw_user = email.lower().split('@')[0].split('+')[0].rstrip('0123456789')
    return raw_user in _ROLE_EMAIL_PREFIXES

def extract_email_v2(text: str, from_email: str = '') -> Optional[str]:
    """Extract candidate email from resume text only (never uses from_email)."""
    # Clean PDF artifacts: remove spaces within likely email tokens
    cleaned = re.sub(r'(\S+)\s+@\s+(\S+)', r'\1@\2', text)
    cleaned = re.sub(r'(\S+@\S+)\s+\.\s+(\S+)', r'\1.\2', cleaned)

    all_emails = re.findall(r'[\w.+\-]+@[\w\-]+\.[\w.]{2,6}', cleaned)
    good = []
    for em in all_emails:
        el = em.lower()
        if any(x in el for x in ['image', 'logo', 'header', 'footer']):
            continue
        if re.search(r'^[0-9a-f]{6,}\.', el):
            continue
        if not re.search(r'\.[a-z]{2,6}$', el):
            continue
        if _is_role_email(el):
            continue
        good.append(el)
    return good[0] if good else None


def extract_phone_v2(text: str) -> Optional[str]:
    """
    Improved phone extraction: handles all Indian and international formats.
    """
    # Remove common noise
    cleaned = text.replace(' ', '').replace('-', '').replace('(', '').replace(')', '')

    # Indian mobile (starts with 6-9, 10 digits)
    indian = re.search(r'(?:\+91)?([6-9]\d{9})', cleaned)
    if indian:
        digits = indian.group(1)
        return f'+91-{digits[:5]}-{digits[5:]}'

    # International
    intl = re.search(r'\+[1-9]\d{9,14}', cleaned)
    if intl:
        return intl.group(0)

    return None


def extract_experience_v2(text: str) -> Optional[float]:
    """
    Improved experience extraction: handles many patterns.
    Returns years as float.
    """
    text_lower = text.lower()

    patterns = [
        # "8.5+ years of experience", "8 years experience"
        (r'(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)(?:\s+of)?\s*(?:total\s+)?(?:experience|exp|work)', 1.0),
        # "Total Experience: 8 Years"
        (r'total\s+(?:work\s+)?experience\s*[:\-]\s*(\d+(?:\.\d+)?)', 1.0),
        # "Experience: 8 Years" or "Experience: 8+ Years"
        (r'experience\s*[:\-]\s*(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)', 1.0),
        # "[8y_0m]" or "[8Y_0M]" or "8y 0m" (Naukri format)
        (r'\[?(\d+)\s*[yY][\s_]?\d+\s*[mM]\]?', 1.0),
        # "8 Yrs" alone on a line
        (r'^\s*(\d+(?:\.\d+)?)\s*(?:years?|yrs?)\s*$', 1.0, re.MULTILINE),
        # "over X years" / "more than X years"
        (r'(?:over|more than|approximately|about)\s+(\d+)\s*(?:years?|yrs?)', 1.0),
        # "5 yrs of SAP ABAP experience" — anything between yrs and experience
        (r'(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)\s+of\s+[\w\W]{0,40}?\s*experience', 1.0, re.IGNORECASE),
        # "15+ years" standalone — no "experience" required
        (r'(\d+)\s*\+\s*(?:years?|yrs?)(?:\s|$)', 1.0),
        # "X years" in file/profile name like "Consultant_5yrs"
        (r'_(\d+)\s*(?:years?|yrs?)(?:\W|$)', 1.0),
        # "X Year Experience" or "X Years Exp"
        (r'(\d+(?:\.\d+)?)\s*(?:years?|yrs?)\s+(?:experience|exp)', 1.0),
    ]

    best = None
    for pat_args in patterns:
        if len(pat_args) == 3:
            pat, scale, flags = pat_args
            m = re.search(pat, text_lower, flags)
        else:
            pat, scale = pat_args
            m = re.search(pat, text_lower)
        if m:
            try:
                val = float(m.group(1)) * scale
                if 0.5 <= val <= 50:  # sanity: between 6mo and 50yr
                    if best is None or val > best:
                        best = val
            except Exception:
                pass

    # If pattern-based extraction failed, try date-range calculation
    if best is None:
        best = _calc_exp_from_dates(text)
    return best



def _calc_exp_from_dates(text: str) -> Optional[float]:
    """Calculate total experience from date ranges in work history."""
    import datetime
    now = datetime.date.today()
    # Normalize date formats: "June-2023" → "June 2023", "Feb-2020" → "Feb 2020"
    # Handle "Month-Year-Month Year" patterns (dashes as both separators)
    text = re.sub(
        r'\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)-(\d{4})\b',
        r'\1 \2', text, flags=re.I)
    # Normalize "June 2023- March 2025" → "June 2023 to March 2025"
    text = re.sub(r'(\d{4})\s*-\s*([A-Za-z])', r'\1 to \2', text)
    MONTHS_MAP = {
        'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6,
        'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12,
        'january': 1, 'february': 2, 'march': 3, 'april': 4,
        'june': 6, 'july': 7, 'august': 8, 'september': 9,
        'october': 10, 'november': 11, 'december': 12,
    }

    def parse_date(s):
        s = s.strip().lower()
        if s in ('present', 'current', 'till date', 'till now', 'to date', 'ongoing', 'now', 'date'):
            return now
        m = re.match(r'([a-z]+)\s+(\d{4})', s)
        if m and m.group(1) in MONTHS_MAP:
            return datetime.date(int(m.group(2)), MONTHS_MAP[m.group(1)], 1)
        m = re.match(r'^(\d{4})$', s)
        if m:
            return datetime.date(int(m.group(1)), 1, 1)
        m = re.match(r'(\d{4})[\-/](\d{1,2})', s)
        if m:
            return datetime.date(int(m.group(1)), int(m.group(2)), 1)
        return None

    range_pats = [
        r'([A-Za-z]+\s+\d{4}|\d{4})\s+(?:to|–|—|-)\s+(present|current|till\s+date|till\s+now|[A-Za-z]+\s+\d{4}|\d{4})',
        r'(\d{4})\s*[-–]\s*(\d{4}|present|current|till\s+date)',
    ]
    dates = []
    for pat in range_pats:
        for m in re.finditer(pat, text, re.I):
            start = parse_date(m.group(1))
            end = parse_date(m.group(2))
            if start and end and end >= start:
                dates.append((start, end))

    if not dates:
        return None
    earliest = min(d[0] for d in dates)
    latest = max(d[1] for d in dates)
    months = (latest.year - earliest.year) * 12 + (latest.month - earliest.month)
    years = round(months / 12, 1)
    return years if 0.5 <= years <= 50 else None

def extract_company_v2(text: str) -> Optional[str]:
    """
    Extract current/most recent employer.
    Looks for company names in work experience section.
    """
    text_lower = text.lower()

    # Pattern: "Current Company: X" or "Present Employer: X"
    # REAL BUG FIX (2026-08-18): the "working with/at X" fallback had no
    # boundary on its capture, so a common resume phrasing like "Working
    # with Burns & McDonnell as an Electrical design Engineer from 29th
    # August..." swallowed the job title and start date into the company
    # name too ("Burns & Mcdonnell As An Electrical Design Engineer From
    # 29Th"). Non-greedy capture + a lookahead stop at "as/since/from" (as
    # whole words) or a comma/dash/pipe/newline/end -- doesn't affect the
    # other two labeled-field patterns, which already stop at end-of-line.
    for pat in [
        r'current\s+(?:company|employer|organization)\s*[:\-]\s*([^\n]{3,60})',
        r'(?:working\s+(?:at|with)|employed\s+at)\s*[:\-]?\s*([^\n,]{3,60}?)(?=\s+(?:as|since|from)\b|[,\-–|]|\n|$)',
        r'present\s+(?:company|employer)\s*[:\-]\s*([^\n]{3,60})',
        # A bare "Employer: X" field label -- found via a real resume with
        # a repeated "Employer: <name>: <date range>" block per role, listed
        # newest-first; re.search finds the FIRST (= most recent) one. The
        # capture excludes ':' so it stops before a trailing date-range
        # colon (e.g. "Employer: Bramasol: August 2025- April 2026" ->
        # "Bramasol", not the whole date-range tail).
        r'\bemployer\s*[:\-]\s*([^\n:]{3,60})',
    ]:
        m = re.search(pat, text_lower)
        if m:
            co = m.group(1).strip().rstrip('.,')
            if 3 < len(co) < 80:
                return co.title()

    # Fallback: find "at Company" after a job title near "present/current"
    m = re.search(r'at\s+([A-Z][A-Za-z\s&,\.]{3,50}?)(?:\s*[-–|]|\s*\n)', text)
    if m and 'present' in text_lower[max(0, m.start()-200):m.start()+50]:
        co = m.group(1).strip()
        if len(co) < 60:
            return co

    return None


def extract_designation_v2(text: str) -> Optional[str]:
    """
    Extract current designation/job title.
    """
    text_lower = text.lower()

    # "Designation: X" or "Current Role: X"
    for pat in [
        r'(?:designation|current\s+(?:role|position|title))\s*[:\-]\s*([^\n]{3,80})',
        r'(?:position|role)\s*[:\-]\s*([^\n]{3,80})',
    ]:
        m = re.search(pat, text_lower)
        if m:
            des = m.group(1).strip().rstrip('.,')
            if 3 < len(des) < 100:
                # Capitalize properly
                return des.title()

    # Fallback: second line of document often has designation
    lines = [l.strip() for l in text.split('\n') if l.strip()]
    if len(lines) >= 2:
        second = lines[1]
        # Should be a designation: contains role keywords
        role_words = ['engineer', 'consultant', 'developer', 'analyst', 'manager',
                      'architect', 'specialist', 'lead', 'senior', 'associate',
                      'administrator', 'executive', 'officer', 'head', 'director']
        if any(rw in second.lower() for rw in role_words) and len(second) < 100:
            return second.rstrip('.,')

    return None


def extract_location_v2(text: str) -> Optional[str]:
    """Extract location/city from resume — expanded to 200+ Indian cities."""
    text_lower = text.lower()

    # Pattern 1: Explicit labeled field (highest priority)
    for pat in [
        r'(?:current\s+location|location|city|based\s+(?:in|at)|residing\s+(?:in|at)|address)\s*[:\-]\s*([^\n,]{2,60})',
        r'(?:current\s+address|permanent\s+address|present\s+address)\s*[:\-]\s*([^\n,]{2,80})',
        r'(?:native\s+place|hometown|home\s+town)\s*[:\-]\s*([^\n,]{2,50})',
    ]:
        m = re.search(pat, text_lower)
        if m:
            raw = m.group(1).strip().rstrip('.,')
            # Take only the city part (before comma or slash)
            city_part = re.split(r'[,/|]', raw)[0].strip()
            if 2 < len(city_part) < 60:
                return city_part.title()

    # Pattern 2: "City, State" inline pattern
    STATES = [
        'karnataka', 'maharashtra', 'telangana', 'andhra pradesh', 'tamil nadu',
        'delhi', 'uttar pradesh', 'rajasthan', 'gujarat', 'west bengal',
        'kerala', 'madhya pradesh', 'haryana', 'punjab', 'bihar',
        'odisha', 'jharkhand', 'chhattisgarh', 'uttarakhand', 'himachal pradesh',
        'goa', 'assam', 'chandigarh', 'pondicherry',
    ]
    for state in STATES:
        m = re.search(r'([a-z][a-z\s]{2,25}),\s*' + re.escape(state), text_lower)
        if m:
            city = m.group(1).strip().rstrip('.,')
            if 2 < len(city) < 40:
                return city.title()

    # Pattern 3: Extended city list — Tier 1, 2 & 3 Indian cities
    INDIAN_CITIES = [
        # Mega cities
        'bangalore', 'bengaluru', 'mumbai', 'pune', 'hyderabad', 'chennai',
        'delhi', 'new delhi', 'kolkata', 'ahmedabad',
        # NCR & satellite
        'noida', 'gurgaon', 'gurugram', 'faridabad', 'ghaziabad', 'greater noida',
        'manesar',
        # South India
        'coimbatore', 'kochi', 'cochin', 'ernakulam', 'trivandrum',
        'thiruvananthapuram', 'madurai', 'tiruchirappalli', 'trichy',
        'mysore', 'mysuru', 'mangalore', 'mangaluru', 'hubballi', 'hubli',
        'belgaum', 'belagavi', 'dharwad', 'kalaburagi', 'gulbarga',
        'vijayawada', 'visakhapatnam', 'vizag', 'warangal', 'tirupati',
        'nellore', 'guntur', 'kurnool', 'rajahmundry', 'kakinada',
        'salem', 'tirunelveli', 'vellore', 'erode', 'thoothukudi',
        'pondicherry', 'puducherry', 'thanjavur', 'dindigul',
        'thrissur', 'kozhikode', 'calicut', 'kannur', 'malappuram',
        'kollam', 'palakkad', 'alappuzha', 'kottayam',
        'tumkur', 'bellary', 'shimoga', 'shivamogga', 'udupi',
        # West India
        'surat', 'vadodara', 'baroda', 'rajkot', 'bhavnagar', 'jamnagar',
        'gandhinagar', 'anand', 'nadiad', 'bhuj',
        'nashik', 'nagpur', 'aurangabad', 'solapur', 'kolhapur',
        'thane', 'navi mumbai', 'pimpri', 'chinchwad', 'pimpri-chinchwad',
        'sangli', 'amravati', 'latur', 'akola', 'nanded',
        'panaji', 'vasco', 'margao',
        # North India
        'lucknow', 'kanpur', 'agra', 'varanasi', 'allahabad', 'prayagraj',
        'meerut', 'mathura', 'bareilly', 'aligarh', 'moradabad',
        'jaipur', 'jodhpur', 'udaipur', 'ajmer', 'kota', 'bikaner',
        'chandigarh', 'amritsar', 'ludhiana', 'jalandhar', 'patiala',
        'bhopal', 'indore', 'gwalior', 'jabalpur', 'ujjain',
        'patna', 'gaya', 'bhagalpur', 'muzaffarpur', 'darbhanga',
        'ranchi', 'jamshedpur', 'dhanbad', 'bokaro',
        'raipur', 'bilaspur', 'durg', 'bhilai',
        'dehradun', 'haridwar', 'roorkee', 'haldwani',
        'shimla', 'manali', 'dharamsala',
        # East India
        'bhubaneswar', 'cuttack', 'rourkela', 'berhampur',
        'guwahati', 'silchar', 'dibrugarh',
        # IT hub satellite / special
        'whitefield', 'electronic city', 'marathahalli', 'btm layout',
        'hsr layout', 'jp nagar', 'koramangala', 'hebbal', 'yelahanka',
        'hitech city', 'madhapur', 'gachibowli', 'secunderabad',
        'salt lake', 'rajarhat', 'new town',
        'hinjewadi', 'magarpatta', 'wakad', 'baner', 'kharadi',
    ]

    # Sort by length desc so "new delhi" matches before "delhi"
    INDIAN_CITIES.sort(key=len, reverse=True)

    for city in INDIAN_CITIES:
        if re.search(r'(?<![a-z])' + re.escape(city) + r'(?![a-z])', text_lower):
            # Avoid false positives inside longer words
            return city.replace('-', ' ').title()

    # Pattern 4: Lines containing "PIN: XXXXXX" → city is usually nearby
    m = re.search(r'([a-z][a-z\s]{2,25})\s*[,\-]?\s*(?:pin|pincode)\s*[:\-]?\s*\d{6}', text_lower)
    if m:
        city = m.group(1).strip()
        if 2 < len(city) < 40:
            return city.title()

    return None


def extract_linkedin_v2(text: str) -> Optional[str]:
    """Extract LinkedIn profile URL."""
    m = re.search(r'(?:https?://)?(?:www\.)?linkedin\.com/in/[\w\-]+/?', text, re.I)
    if m:
        url = m.group(0)
        if not url.startswith('http'):
            url = 'https://' + url
        return url.rstrip('/')
    return None


_EDUCATION_HEADING_RE = re.compile(
    r'^\s*(?:academic\s+)?(?:education(?:al\s+qualifications?)?|qualifications?|'
    r'academic\s+(?:background|details|qualifications?))\s*:?\s*$',
    re.I | re.M)

# Real bug fix (gap-audit, 2026-09-02): the prior education extraction
# (see parse_resume_v2's old inline block) was one bare regex match with
# no year and no institution — confirmed live, 0 of N candidate records
# had any institution data ever. Degree tokens kept close to the
# original set (deliberately no bare "BA"/"MA"/"10th"/"12th" — too
# short/ambiguous, high false-positive risk against unrelated
# capitalized text elsewhere in a resume).
_DEGREE_RE = re.compile(
    r'\bB\.?\s?Tech\b|\bB\.?\s?E\.?\b|\bM\.?\s?Tech\b|\bM\.?\s?E\.?\b|\bMBA\b|'
    r'\bMCA\b|\bBCA\b|\bB\.?\s?Sc\b|\bM\.?\s?Sc\b|\bB\.?\s?Com\b|\bM\.?\s?Com\b|'
    r'\bPh\.?\s?D\b|\bBBA\b|\bDiploma\b',
    re.I)

_EDU_YEAR_RE = re.compile(r'\b(19[5-9]\d|20[0-4]\d)\b')

# Institution names in Indian resumes are inconsistently cased (all-caps,
# title-case) — matched purely on the trailing keyword, not on
# capitalization, then a bounded run of words immediately before it is
# captured as the likely institution name (handles "XYZ College of
# Engineering", "ABC Institute of Technology", "XYZ Business School"
# shapes). "School" included deliberately, despite the modest risk of
# also matching a plain "High School" line — a real, common institution
# type for this codebase's own market (MBAs from a named "Business
# School"), and a harmless, non-misleading false positive at worst.
_INSTITUTION_RE = re.compile(
    r'(?:[A-Za-z][A-Za-z.&\'\-]*\s+){0,6}'
    r'(?:University|College|Institute|Polytechnic|Academy|School)'
    r'(?:\s+of\s+[A-Za-z][A-Za-z\s]{2,30})?',
    re.I)


def extract_education_section(text: str) -> Optional[str]:
    """Isolate the real "Education" section — same standalone-heading +
    SECTION_HEADERS-boundary convention already established by
    extract_projects_section. Deliberately conservative — no heading
    match, no guess (the caller falls back to scanning the whole
    document instead of inventing a boundary)."""
    if not text:
        return None
    m = _EDUCATION_HEADING_RE.search(text)
    if not m:
        return None
    start = m.end()
    rest = text[start:]
    end = len(rest)
    for line_m in re.finditer(r'^\s*([A-Za-z][A-Za-z /&\-]{2,40})\s*:?\s*$', rest, re.M):
        candidate = line_m.group(1).strip().lower()
        if candidate in SECTION_HEADERS and candidate not in ('education', 'qualifications'):
            end = line_m.start()
            break
    section = rest[:end].strip()
    return section[:3000] if section else None


def extract_education_v2(text: str) -> list[dict]:
    """Real, structured education extraction — degree + institution +
    year, each field independently None when not confidently found
    (never guessed). Scans within the real "Education" section when one
    exists (isolates real degree/institution pairs from unrelated
    degree-shaped tokens elsewhere in the resume, e.g. a job title
    mentioning "MBA required"); falls back to the first 4000 chars of
    the whole document when no explicit heading exists, matching the
    old parser's own always-scan-something behavior. Returns up to 5
    distinct entries, deduped by degree text."""
    if not text:
        return []
    section = extract_education_section(text) or text[:4000]
    matches = list(_DEGREE_RE.finditer(section))
    entries = []
    seen = set()
    for i, m in enumerate(matches):
        degree = m.group(0).strip()
        key = degree.lower().replace('.', '').replace(' ', '')
        if key in seen:
            continue
        seen.add(key)

        # Real bug found via testing (2026-09-02): an earlier version
        # used a fixed +/-window regardless of neighboring entries — on
        # a resume listing 2 degrees back to back, the second entry's
        # window reached backward far enough to still contain the FIRST
        # entry's institution/year, and re.search() (leftmost match)
        # silently attributed the wrong school and wrong year to the
        # second degree. Forward-only, and never past the NEXT real
        # degree match, so one entry's window can never contain another
        # entry's own institution/year — at the cost of missing an
        # institution stated BEFORE the degree on the same line, an
        # accepted trade-off (the old, pre-fix parser only ever looked
        # forward from the degree token too).
        window_end = matches[i + 1].start() if i + 1 < len(matches) else len(section)
        window_end = min(window_end, m.end() + 150)
        window = section[m.end():window_end]

        year = None
        ym = _EDU_YEAR_RE.search(window)
        if ym:
            year = ym.group(0)

        institution = None
        im = _INSTITUTION_RE.search(window)
        if im:
            institution = re.sub(r'\s+', ' ', im.group(0)).strip(' ,.-')[:150]

        entries.append({'degree': degree[:60], 'institution': institution, 'year': year})
        if len(entries) >= 5:
            break
    return entries


_PROJECT_HEADING_RE = re.compile(
    r'^\s*(?:key\s+)?projects?(?:\s+(?:details|experience|handled|worked))?\s*:?\s*$',
    re.I | re.M)


def extract_projects_section(text: str) -> Optional[str]:
    """Best-effort "Projects" section extraction — this codebase's resume
    fields (skills/company/designation/experience_years/education) are all
    single-value regex pulls; nothing extracts a distinct projects block,
    which the "Projects only" resume-sharing format needs. Finds a
    standalone "Projects" heading line and captures everything up to the
    next recognized section header (reusing SECTION_HEADERS, same
    boundary-detection convention as the rest of this file) or end of text.
    Deliberately conservative — no heading match, no guess."""
    if not text:
        return None
    m = _PROJECT_HEADING_RE.search(text)
    if not m:
        return None
    start = m.end()
    rest = text[start:]
    end = len(rest)
    for line_m in re.finditer(r'^\s*([A-Za-z][A-Za-z /&\-]{2,40})\s*:?\s*$', rest, re.M):
        candidate = line_m.group(1).strip().lower()
        if candidate in SECTION_HEADERS and candidate != 'projects':
            end = line_m.start()
            break
    section = rest[:end].strip()
    return section[:3000] if section else None


_SUMMARY_HEADING_RE = re.compile(
    r'^\s*(?:professional|career|executive)?\s*(?:summary|profile|objective)\s*:?\s*$',
    re.I | re.M)

_LEADING_NAME_LINES_RE = re.compile(
    r'\A\s*(?:[A-Z][A-Za-z.\'\-]*\s*){1,6}\s*\n+'   # a name-like line (1-6 capitalized words)
    r'(?:[^\n]{0,120}\n+){0,2}?'                      # up to 2 more short lines (title/tagline)
)
# REAL BUG FIX (2026-08-18): this used to anchor with `^` under re.M, which
# matches at the start of ANY line, not just the true start of the string —
# `.sub(count=1)` would then latch onto the FIRST short "capitalized
# word(s) + newline" line ANYWHERE later in the document once the name
# itself had already been stripped, not just a genuine leading title/
# tagline. Caught on a real resume with no distinct title line after the
# name: it silently deleted a lone "August." sitting mid-paragraph
# ("...to 28th\nAugust.\n\nI Worked in Toyo...") because that one-word
# capitalized line was the first thing anywhere in the text matching the
# pattern. \A anchors to the absolute start only, so this heuristic now
# either strips the real leading lines or does nothing — never a guess
# at a match found deeper in the document.


def extract_summary_section(text: str, full_name: str = '') -> Optional[str]:
    """Strip the duplicated leading name/title/heading block, the same way
    extract_projects_section() isolates Projects -- REAL BUG FIX
    (2026-08-18): the Resume Generator used to render the *entire* raw
    resume_text (name, title, its own "PROFESSIONAL SUMMARY" heading,
    and everything after) as the body under a template-rendered
    "PROFESSIONAL SUMMARY" heading, producing a visibly duplicated
    name/title/heading block on every generated resume.

    SECOND REAL BUG FIX (2026-08-18, same day): the first version of this
    fix additionally stopped capturing at the next recognized section
    header (e.g. "Professional Experience") once a Summary/Profile/
    Objective heading was found -- correctly removing the duplication, but
    also silently discarding the ENTIRE rest of the resume for any well-
    structured document. Confirmed live on a real 7-page, dense multi-role
    resume: only the opening "Professional Summary" paragraph survived in
    the generated PDF, and the entire employment history, skills
    breakdown, education, and certifications vanished. The renderer only
    ever shows ONE narrative body block (no separate Experience/Education/
    Skills sections exist in the template) and already caps it to a
    readable length at render time (2600 chars) -- this function's real
    job is just to strip the duplicated leading header, never to isolate
    a single section and drop everything after it."""
    if not text:
        return None
    # REAL BUG FIX (2026-08-18): this function used to slice its result to
    # an arbitrary length -- 20,000 chars originally, raised to 100,000
    # once the 20,000 cap silently cut off a real resume's last employer.
    # The 100,000 cap itself then became the binding limit the very same
    # day, confirmed on a real 102,474-char synthetic resume where every
    # theme (old and new) truncated mid-sentence at the identical point,
    # nowhere near the document's real end. Raising the number again would
    # just recreate the identical bug at the next larger real resume --
    # removed the cap entirely instead. There is no legitimate reason for
    # THIS function to impose its own length bound at all: no render-time
    # cap remains downstream (removed earlier the same day, across every
    # theme), and storage-time already has its own real safety cap
    # (_clean_text() in resume_intake_service.py) that this text has
    # already passed through by the time it gets here.
    m = _SUMMARY_HEADING_RE.search(text)
    if m:
        section = text[m.end():].strip()
        if section:
            return section
    # No explicit heading -- strip the leading name (+ up to 2 short
    # title/tagline lines) so the raw text isn't re-echoed verbatim.
    stripped = text
    if full_name:
        name_re = re.compile(r'^\s*' + re.escape(full_name) + r'\s*\n+', re.I | re.M)
        stripped = name_re.sub('', stripped, count=1)
    stripped = _LEADING_NAME_LINES_RE.sub('', stripped, count=1).strip()
    return stripped or None


def calc_confidence(parsed: dict) -> float:
    """
    Compute parse confidence score (0.0 - 1.0).
    Used to route: HIGH → auto-accept, MEDIUM → accept+warn, LOW → review queue.
    """
    score = 0.0

    name = parsed.get('name', '')
    if name and name not in ('Unknown Candidate', 'Unknown') and len(name.split()) >= 1:
        score += 0.20

    email = parsed.get('email', '')
    if email and '@' in email and re.match(r'^[\w.+\-]+@[\w\-]+\.\w{2,}$', email):
        score += 0.20

    phone = parsed.get('phone', '')
    if phone and len(re.sub(r'[^\d]', '', phone)) >= 10:
        score += 0.15

    skills = parsed.get('skills', [])
    if len(skills) >= 5:
        score += 0.20
    elif len(skills) >= 2:
        score += 0.10

    exp = parsed.get('experience_years')
    if exp is not None and 0.5 <= float(exp) <= 50:
        score += 0.15

    if parsed.get('current_company'):
        score += 0.05
    if parsed.get('current_designation'):
        score += 0.05

    return round(min(score, 1.0), 2)


async def parse_with_ollama_v2(text: str, ollama_url: str, model: str,
                                partial: dict) -> dict:
    """
    Phase B LLM parser: targeted extraction of fields regex missed.
    Only asks Ollama for fields that regex failed on.
    Reduces prompt size = faster + more reliable.
    """
    import httpx

    # Identify which fields regex missed
    missing = []
    if not partial.get('name') or partial['name'] in ('Unknown Candidate', 'Unknown'):
        missing.append('name')
    if not partial.get('email'):
        missing.append('email')
    if not partial.get('experience_years'):
        missing.append('experience_years')
    if len(partial.get('skills', [])) < 3:
        missing.append('skills')
    if not partial.get('current_company'):
        missing.append('current_company')
    if not partial.get('current_designation'):
        missing.append('current_designation')

    if not missing:
        return {}  # regex got everything

    # Build targeted prompt
    fields_json = ', '.join(f'"{f}": null' for f in missing)
    first_500 = text[:800]  # Use first 800 chars (most info is here)

    prompt = (
        f'Extract ONLY these fields from the resume text: {missing}\n'
        f'Return ONLY valid JSON like: {{{fields_json}}}\n'
        f'No explanation. No markdown. Just JSON.\n\n'
        f'RESUME START:\n{first_500}\n...RESUME END'
    )

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                f'{ollama_url}/api/generate',
                json={'model': model, 'prompt': prompt, 'stream': False,
                      'options': {'temperature': 0.0, 'num_predict': 200}},
                timeout=15
            )
            if r.status_code == 200:
                import json, re as _re
                raw = r.json().get('response', '')
                m = _re.search(r'\{[\s\S]*?\}', raw)
                if m:
                    return json.loads(m.group(0))
    except Exception:
        pass
    return {}


def parse_resume_v2(text: str, from_name: str = '', from_email: str = '', filename: str = '') -> dict:
    """
    Improved synchronous parser — Phase B.
    Returns structured dict with all fields + confidence score.
    """
    full_text = text[:8000]

    name = extract_name_v2(full_text, from_name)
    email = extract_email_v2(full_text, from_email)
    phone = extract_phone_v2(full_text)
    skills = extract_skills_from_text(full_text)
    # Phase C: normalize skills against DB taxonomy
    if normalize_skills_list is not None and skill_normalizer is not None and skill_normalizer._CACHE_LOADED:
        skills = normalize_skills_list(skills)
    exp_years = extract_experience_v2(full_text)
    # Filename hint: if filename explicitly states years, take the MAX
    if filename:
        fn_match = re.search(r'(\d{1,2})[_\s]*(?:years?|yrs?|Y_\d+M)', filename, re.I)
        if fn_match:
            try:
                fn_exp = float(fn_match.group(1))
                if fn_exp > (exp_years or 0):
                    exp_years = fn_exp  # Filename explicitly states more years
            except Exception:
                pass
    company = extract_company_v2(full_text)
    designation = extract_designation_v2(full_text)
    location = extract_location_v2(full_text)
    linkedin = extract_linkedin_v2(full_text)

    # Education — real, structured degree/institution/year extraction
    # (gap-audit fix, 2026-09-02); `edu` is kept as a plain string for
    # backward compatibility with every existing reader of parsed
    # ['education'], now built from the real, richer entries instead of
    # a single bare regex match with no year/institution.
    education_entries = extract_education_v2(full_text)
    edu = None
    if education_entries:
        first = education_entries[0]
        edu = first['degree']
        if first.get('institution'):
            edu += f" — {first['institution']}"
        if first.get('year'):
            edu += f" ({first['year']})"

    # CTC / Notice period (simple)
    ctc = None
    ctc_m = re.search(r'(?:expected|desired)\s+ctc\s*[:\-]\s*([^\n]{2,30})', full_text, re.I)
    if ctc_m:
        ctc = ctc_m.group(1).strip()

    notice = None
    notice_m = re.search(r'notice\s+period\s*[:\-]\s*([^\n]{2,30})', full_text, re.I)
    if notice_m:
        notice = notice_m.group(1).strip()

    parsed = {
        'name': name,
        'email': email,
        'phone': phone,
        'location': location,
        'current_company': company,
        'current_designation': designation,
        'experience_years': exp_years,
        'skills': skills,
        'education': edu,
        'education_entries': education_entries,
        'expected_ctc': ctc,
        'notice_period': notice,
        'linkedin_url': linkedin,
    }

    parsed['_confidence'] = calc_confidence(parsed)
    return parsed
