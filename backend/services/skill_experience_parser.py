"""Real feature (2026-08-30): parse a free-text "tracking sheet" style
blob (the kind a recruiter types into the KAE-submission `skill_summary`
field, e.g. "Fico Exp: 7.6 Yrs\nHana: 6 Yrs\nECC: 6 Yrs...") into
proposed candidate_skill_experience rows. Zero-token, pure regex — no
Ollama call, matching HARD RULE #1 (this is deterministic key:value
line extraction, not free-form summarization).

Deliberately over-inclusive, never silently drops a line — every
"Label: Value" line becomes a proposed row for a human to review and
remove if it isn't really a skill (e.g. "Total Projects: 6"). Under-
inclusion (silently dropping a real skill line) is the worse failure
mode for this kind of data, matching this project's established "let a
human confirm, don't guess silently" discipline."""
import re
from html.parser import HTMLParser
from typing import Optional

from services.improved_parser import _SKILL_LOOKUP

_LINE_RE = re.compile(r"^\s*([A-Za-z][A-Za-z0-9 /&,]{1,60}?)\s*:\s*(.+?)\s*$")
_EXP_VALUE_RE = re.compile(r"\d+(\.\d+)?\s*(yrs?|years?|months?|mo\b)", re.I)


def _normalize_skill_label(label: str) -> str:
    """Best-effort canonical form via the shared skills taxonomy — cosmetic
    only. 'Fico Exp' -> strip trailing Exp/Experience -> 'Fico' -> looked
    up -> 'SAP FICO'. Falls back to the raw label, title-cased, when no
    taxonomy match exists (e.g. 'MBC', 'EBS, BRS') — a short SAP module
    code not in the fixed dictionary is still a real, legitimate skill
    name in this codebase's own free-typed chip convention."""
    bare = re.sub(r"\s*(exp(erience)?)\s*$", "", label, flags=re.I).strip()
    hit = _SKILL_LOOKUP.get(bare.lower())
    if hit:
        return hit
    return bare or label


def parse_skill_summary_text(raw_text: str) -> list[dict]:
    """Real, non-AI extraction of Skill/Project-Experience candidate rows
    from a free-text blob. Returns a list of
    {skill_name, relevant_experience, looks_like_experience: bool} —
    the last flag is a hint for the UI (an entry whose value doesn't look
    like a real "N Yrs" figure, e.g. "Total Projects: 6", is pre-shown
    but visually flagged as likely not a real skill row, not silently
    dropped)."""
    if not raw_text or not raw_text.strip():
        return []
    rows = []
    seen = set()
    for raw_line in re.split(r"[\r\n]+", raw_text):
        line = raw_line.strip().strip(",")
        if not line:
            continue
        m = _LINE_RE.match(line)
        if not m:
            continue
        label, value = m.group(1).strip(), m.group(2).strip()
        # Real, minor bug found 2026-09-03 while root-causing the missing-
        # skills report below: a URL line like "https://www.linkedin.com/
        # in/..." matches _LINE_RE too — its own scheme colon reads as a
        # "Label: Value" pair (label="https", value="//www.linkedin...").
        # looks_like_experience already filters this out for the auto-
        # populate path (a URL never contains a real "N Yrs" figure), but
        # it still showed up as visible garbage in the Paste & Parse tool's
        # human-review list. Cheap, safe exclusion.
        if label.lower() in ("http", "https", "ftp", "mailto"):
            continue
        skill_name = _normalize_skill_label(label)
        key = skill_name.lower()
        if key in seen:
            continue
        seen.add(key)
        rows.append({
            "skill_name": skill_name,
            "relevant_experience": value,
            "looks_like_experience": bool(_EXP_VALUE_RE.search(value)),
        })
    return rows


class _TrackingSheetTableParser(HTMLParser):
    """Real bug fix (2026-09-09, reported live: a recruiter forwarded a
    resume with a real HTML tracking-sheet table in the email body --
    columns Source/SPOC/JR No/.../Skill/.../Total Exp/Rel Exp/... -- and
    NONE of it landed in Skill/Project Experience, despite the exact
    skill list and relevant-experience figure sitting right there).
    Root-caused against the real email: parse_skill_summary_text() above
    needs "Label: Value" colon-paired lines, but a real HTML <table>
    flattened to plain text by the sender's own mail client has NO such
    pairing at all -- every header cell, then every value cell, dumped
    in sequence with zero delimiters, since the "Skill" column alone
    holds 19 stacked lines (one per <br>) that destroy any 1:1
    positional correspondence with the other columns the moment you try
    to reconstruct it from the flattened text. The real table structure
    (which header goes with which value, and that a "Skill" cell can
    hold multiple <br>-separated entries) only survives in the raw HTML,
    which this app captured in imap_messages.html_body but never parsed
    for structure anywhere in the intake pipeline.

    Walks the FIRST <table> only (a real signature-block table almost
    always follows the actual tracking sheet in these emails, confirmed
    live in the exact reporting email -- Faisal's own contact-card table
    sits right after the tracking sheet's closing </table>; stopping
    after the first table's own end tag skips it automatically). A <br>
    inside a cell becomes a newline in that cell's own text, preserving
    a multi-skill "Skill" column as distinct lines instead of losing the
    boundaries the way a plain get_text() would."""
    def __init__(self):
        super().__init__()
        self.rows: list[list[str]] = []
        self._table_depth = 0
        self._in_row = False
        self._in_cell = False
        self._cell_parts: list[str] = []
        self._row_cells: list[str] = []
        self._done = False

    def handle_starttag(self, tag, attrs):
        if self._done:
            return
        if tag == 'table':
            self._table_depth += 1
        elif self._table_depth == 1 and tag == 'tr':
            self._in_row = True
            self._row_cells = []
        elif self._in_row and tag in ('td', 'th'):
            self._in_cell = True
            self._cell_parts = []
        elif self._in_cell and tag == 'br':
            self._cell_parts.append('\n')

    def handle_endtag(self, tag):
        if self._done:
            return
        if tag in ('td', 'th') and self._in_cell:
            text = ''.join(self._cell_parts).strip()
            # Real bug fix (2026-09-10, a THIRD real tracking-sheet
            # template -- Hari Babu Gorakala's, reported by faisal.k):
            # the sender's own Excel-to-HTML export wraps a cell in a
            # literal leading `"` whenever the source cell contains
            # embedded newlines, but the matching closing quote never
            # survives the conversion -- confirmed live on two separate
            # cells in the same real email (the Skill cell and the
            # ECTC/Rate Card cell both start with a stray `"` that is
            # not part of the real data). No genuine value in this
            # domain starts with a literal quote character, so stripping
            # a single leading one is safe and unconditional.
            if text.startswith('"'):
                text = text[1:].lstrip()
            self._row_cells.append(text)
            self._in_cell = False
        elif tag == 'tr' and self._in_row:
            self.rows.append(self._row_cells)
            self._in_row = False
        elif tag == 'table':
            self._table_depth -= 1
            if self._table_depth <= 0:
                self._done = True

    def handle_data(self, data):
        if self._in_cell:
            self._cell_parts.append(data)


def _normalize_headers(raw_headers: list[str]) -> list[str]:
    """Real bug fix (2026-09-10, reported live: a SECOND real tracking-
    sheet template from a different recruiter -- Aiman F's -- also
    failed to extract anything, despite the fix already shipped for the
    first one). Root-caused against this exact real email: its header
    cells use <br> WITHIN a single header ("Current<br>Location",
    "Current<br>Company") -- _TrackingSheetTableParser correctly turns
    that into an embedded newline per this module's own established
    convention (same as a multi-skill cell), but a raw multi-word lookup
    like "current location" then fails to match "current\nlocation" as
    a substring. Collapsing all whitespace (including embedded
    newlines) to single spaces before matching fixes every existing
    lookup at once, without changing any of them."""
    return [re.sub(r'\s+', ' ', h).strip().lower() for h in raw_headers]


def _find_col(headers: list[str], *keywords: str) -> Optional[int]:
    for i, h in enumerate(headers):
        if any(k in h for k in keywords):
            return i
    return None


def _find_col_excluding(headers: list[str], keywords: tuple, exclude: tuple) -> Optional[int]:
    """Same as _find_col, but skips a header that also matches any of
    `exclude` — needed for e.g. a bare "CTC" column search (real header
    seen live: "CTC" for current, "ECTC/Rate Card" for expected) where
    the plain substring "ctc" would otherwise also match "ECTC" itself."""
    for i, h in enumerate(headers):
        if any(k in h for k in keywords) and not any(x in h for x in exclude):
            return i
    return None


def parse_tracking_sheet_html(html: str) -> list[dict]:
    """Real feature (2026-09-09) -- see _TrackingSheetTableParser above
    for the full root-cause story. Finds the tracking sheet's real
    "Skill" column (however many entries it holds) and its "Rel Exp" /
    "Total Exp" column via real header names, not position guessing.

    Deliberately more trusting than parse_skill_summary_text() above:
    every entry here already survived structural proof (it came from an
    actual named "Skill" column in a real table, not a loose "Label:
    Value" text guess), so auto_populate_skill_experience() below skips
    its usual taxonomy-recognition gate for these specific rows --
    requiring "Internal Orders" or "F1-MM Integration" (real entries
    from the reporting email, neither in this codebase's own curated
    skill dictionary) to also match a fixed taxonomy would silently
    drop real, deliberately-typed recruiter data.

    Every skill in the column gets the SAME relevant-experience value
    (the sheet's own Rel Exp, or Total Exp if no Rel Exp column exists)
    -- this table format has no more granular per-skill duration
    anywhere, so reusing the recruiter's own real, stated figure is the
    most honest available signal, not a fabricated one.

    Returns the same shape as parse_skill_summary_text() (skill_name,
    relevant_experience, looks_like_experience) so callers don't need to
    branch on which extractor produced a row. Returns [] whenever the
    table doesn't clearly look like a tracking sheet (no recognizable
    Skill column, or no candidate-identifying column alongside it) --
    never guesses at a table that might be something else entirely, the
    same discipline as this file's other functions."""
    if not html or not html.strip():
        return []
    parser = _TrackingSheetTableParser()
    try:
        parser.feed(html)
    except Exception:
        return []
    rows = [r for r in parser.rows if any(c.strip() for c in r)]
    if len(rows) < 2:
        return []

    headers = _normalize_headers(rows[0])
    if _find_col(headers, 'skill') is None:
        return []
    if _find_col(headers, 'name', 'candidate', 'email') is None:
        return []

    skill_idx = _find_col(headers, 'skill')
    exp_idx = _find_col(headers, 'rel exp', 'relevant exp', 'relevant experience')
    if exp_idx is None:
        exp_idx = _find_col(headers, 'total exp', 'total experience')

    data_row = rows[1]
    if skill_idx is None or skill_idx >= len(data_row):
        return []
    skill_cell = data_row[skill_idx]
    exp_value = (data_row[exp_idx].strip() if exp_idx is not None and exp_idx < len(data_row) else '') or None

    out = []
    seen = set()

    # Real bug fix (2026-09-10): a SECOND real tracking-sheet template
    # packs per-skill years directly into the Skill cell as a numbered
    # list embedded in prose -- "1)SAP FICO-13 Yrs 2)S4 Hana Public
    # Cloud -4 yrs 3)ECC- 9.8 yrs..." -- genuinely richer data than the
    # first template's flat skill list (a real per-skill figure, not one
    # shared value), and structurally incompatible with the newline-
    # split path below (this is one continuous prose block, not one
    # skill per line). Tried FIRST; only a real, confirmed live email is
    # what motivated this pattern, so it stays narrow (requires an
    # explicit "N)" marker AND a trailing "yrs"/"years" on each entry --
    # never guesses at a number embedded in a skill name meaning
    # something else, e.g. "Projects - 2 End to End..." in the same real
    # cell correctly does NOT match, since it has no trailing yrs/years).
    numbered_pat = re.compile(r'\d+\)\s*(.+?)\s*-\s*(\d+(?:\.\d+)?\+?)\s*(?:yrs?|years?)\b', re.I)
    numbered_matches = list(numbered_pat.finditer(re.sub(r'\s+', ' ', skill_cell)))
    if numbered_matches:
        for m in numbered_matches:
            raw_name, years = m.group(1).strip().strip(","), m.group(2).strip()
            if not raw_name or len(raw_name) > 80:
                continue
            skill_name = _normalize_skill_label(raw_name)
            key = skill_name.lower()
            if key in seen:
                continue
            seen.add(key)
            out.append({
                "skill_name": skill_name,
                "relevant_experience": f"{years} Yrs",
                "looks_like_experience": True,
            })
        return out

    # Real bug fix (2026-09-10, Hari Babu Gorakala's tracking sheet -- a
    # THIRD real Skill-cell format): per-line "Label : N Yrs" pairs mixed
    # in the SAME cell with genuine non-skill summary lines that use the
    # exact same "Label: N" shape but carry no trailing Yrs unit at all
    # (e.g. "Total Projects: 10", "Support: 3", "Migration: 1") --
    # structurally indistinguishable from a real skill line by shape
    # alone. A bare-fallback read of the whole cell (format 3 below)
    # previously took each raw line -- colon and all -- as a literal
    # "skill name", producing garbage like '"Total Projects: 10' as if
    # it were a real skill; confirmed live against the real email.
    # Requires an explicit ": N Yrs/Years" suffix on the line (this
    # alone already excludes "Total Projects: 10" etc, since they carry
    # no unit) AND the label must pass this file's own established
    # taxonomy gate (_recognized_taxonomy_skill, the same one
    # auto_populate_skill_experience already uses for its free-text path
    # below) -- needed because "Overall : 13 Yrs" in the SAME real cell
    # matches the ": N Yrs" shape exactly as well as any real skill line
    # does (confirmed: SAP FICO/SAP COPA/S4HANA/SAP ECC/FSCM all pass the
    # gate, Overall/Total Projects/End Implementations/Support/Migration
    # all correctly fail it). A label that fails the gate is dropped
    # outright, not kept as a bare name -- this whole-cell format is
    # colon-structured, so a line that doesn't parse as a real
    # "skill: years" pair is metadata, not an unrelated flat skill name.
    _line_colon_years_re = re.compile(r'^(.+?)\s*:\s*(\d+(?:\.\d+)?\+?)\s*(?:yrs?|years?)\s*$', re.I)
    colon_lines = [ln.strip().strip(',') for ln in re.split(r"[\r\n]+", skill_cell) if ln.strip()]
    colon_matches = [_line_colon_years_re.match(ln) for ln in colon_lines]
    if any(colon_matches):
        for m in colon_matches:
            if not m:
                continue
            raw_name, years = m.group(1).strip(), m.group(2).strip()
            canonical = _recognized_taxonomy_skill(raw_name)
            if not canonical:
                continue
            key = canonical.lower()
            if key in seen:
                continue
            seen.add(key)
            out.append({
                "skill_name": canonical,
                "relevant_experience": f"{years} Yrs",
                "looks_like_experience": True,
            })
        return out

    # Real feature (2026-09-10, the canonical AVIIN ATS tracking-sheet
    # template): one skill per line, each optionally suffixed with its
    # own "- N Yrs" — the clean, recommended format this parser is built
    # to prefer going forward, distinct from both real ad-hoc formats
    # already handled above (a flat name-only list, and a numbered list
    # embedded in prose). Checked per-line so a template recruiter can
    # freely mix a plain skill name (falls back to the shared Rel Exp/
    # Total Exp value, exactly like the simple format) with a line that
    # states its own years, without needing every line to match.
    _line_years_re = re.compile(r'^(.+?)\s*[-–]\s*(\d+(?:\.\d+)?\+?)\s*(?:yrs?|years?)\s*$', re.I)

    for raw_line in re.split(r"[\r\n]+", skill_cell):
        line = raw_line.strip().strip(",")
        if not line:
            continue
        m = _line_years_re.match(line)
        name, line_exp = (m.group(1).strip(), f"{m.group(2)} Yrs") if m else (line, exp_value)
        if not name or len(name) > 60:
            continue
        skill_name = _normalize_skill_label(name)
        key = skill_name.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append({
            "skill_name": skill_name,
            "relevant_experience": line_exp,
            "looks_like_experience": True,
        })
    return out


def _parse_ctc_to_rupees(raw: Optional[str]) -> Optional[float]:
    """"6 LPA" / "6.5 Lakhs" / "12,00,000" -> raw rupees (candidates.
    current_ctc/expected_ctc's real stored unit — confirmed against this
    tenant's own existing data, e.g. 1100000 for an "11 LPA" candidate).
    A bare small number with no unit (e.g. "6", "12") is treated as LPA —
    the universal Indian staffing convention seen in every real tracking
    sheet this session, and no real CTC in this domain is ever quoted as
    a bare number under 200 in raw rupees.

    REAL BUG FIX (2026-09-10): a real tracking sheet's own "ECTC/Rate
    Card" column (this exact column deliberately double-purposed for
    both a full-time annual figure and a contract/freelance periodic
    rate) held "1.50 L/Month" for a freelance candidate — silently
    treating that as a flat "1.5 Lakhs" annual figure would understate
    a real ~18L/year-equivalent rate by roughly 12x, materially
    misleading a recruiter, not just imprecise. Never guesses at the
    conversion: a periodic-rate qualifier (/month, /day, /hour and
    their "per X" spellings) returns None outright so the field stays
    genuinely blank rather than confidently wrong — the same "never
    guess-correct, leave it for a human" discipline this codebase
    already applies to candidate identity fields.

    REAL BUG FIX (2026-09-10, a THIRD real tracking sheet, Hari Babu
    Gorakala's): the same column held "1.6L/M" — a single-letter "M"
    abbreviation for "per month", confirmed live against the real
    email. The original qualifier regex required the FULL word
    "month"/"day"/"hour"/"hr" after the slash, so "/M" alone matched
    nothing and this periodic rate silently fell through to the flat-
    LPA branch below, producing a wrong expected_ctc of 160000 (as if
    1.6L were an ANNUAL figure) instead of being recognized as monthly.
    Now also matches the bare single-letter abbreviations (/M, /D, /H)
    that only ever appear directly after a slash in this exact CTC/rate
    context, never in isolation elsewhere in a short cell value."""
    if not raw:
        return None
    s = raw.strip().lower()
    if re.search(r'(?:/|per\s+)\s*(?:months?|mo|m|days?|d|hours?|hrs?|h)\b|\bmonthly\b|\bhourly\b|\bdaily\b', s):
        return None
    m = re.search(r'(\d+(?:\.\d+)?)\s*(?:lpa|lakhs?|l\b)', s)
    if m:
        return float(m.group(1)) * 100000
    m = re.search(r'(\d+(?:\.\d+)?)\s*(?:cr|crore)', s)
    if m:
        return float(m.group(1)) * 10000000
    m = re.search(r'([\d,]+(?:\.\d+)?)', s)
    if m:
        try:
            num = float(m.group(1).replace(',', ''))
        except ValueError:
            return None
        return num * 100000 if num < 200 else num
    return None


def _parse_monthly_salary_to_rupees(raw: Optional[str]) -> Optional[float]:
    """Real feature (2026-09-10) — the tracking-sheet template's own
    dedicated "Monthly Contract Salary" column (candidates.
    monthly_contract_salary): unlike _parse_ctc_to_rupees above, a
    periodic-rate qualifier here is the EXPECTED unit, not a reason to
    reject the value — this column only ever means "per month" by
    definition, so "1.5 L/Month" and a bare "1.5 L" mean the same real
    thing here. Same LPA/Lakhs parsing, never annualizes it (the whole
    point of this being a separate column from expected_ctc is that the
    two units are never mixed)."""
    if not raw:
        return None
    s = raw.strip().lower()
    m = re.search(r'(\d+(?:\.\d+)?)\s*(?:lpa|lakhs?|l\b)', s)
    if m:
        return float(m.group(1)) * 100000
    m = re.search(r'([\d,]+(?:\.\d+)?)', s)
    if m:
        try:
            num = float(m.group(1).replace(',', ''))
        except ValueError:
            return None
        return num * 100000 if num < 200 else num
    return None


def _normalize_job_type(raw: Optional[str]) -> Optional[str]:
    """"FTE"/"Full Time"/"Contract"/"Freelance"/"Freelancer"/"Freelancing"
    -> the 3 canonical values the tracking-sheet template itself asks
    recruiters to use. Checks "freelance" and "contract" before "fte"
    since a real cell can legitimately read something like "Contract -
    Freelancer" together; freelance is the more specific engagement type
    when both words appear.

    REAL BUG FIX (2026-09-10): matched literal "freelance" as a
    substring — but a real tracking sheet cell said "Freelancing", which
    does NOT contain "freelance" (the words diverge at the 9th
    character: freelanc-E vs freelanc-I-ng), so this silently returned
    None for a real, correctly-located cell. Matches the shorter, safe
    stem "freelanc" instead, covering freelance/freelancer/freelancing
    uniformly — confirmed this doesn't collide with any other real
    English word."""
    if not raw:
        return None
    s = raw.strip().lower()
    if 'freelanc' in s:
        return 'Freelancer'
    if 'contract' in s:
        return 'Contract'
    if 'fte' in s or 'full time' in s or 'full-time' in s or 'permanent' in s:
        return 'FTE'
    return None


def _parse_yes_no(raw: Optional[str]) -> Optional[bool]:
    """"Yes"/"Received"/"Verified" -> True; "No"/"Not Received"/"Not
    Verified" -> False; blank/"Pending"/"N/A" -> None (candidates.
    nda_received, .truecaller_verified). Negative forms are checked
    FIRST and with word-boundary regex — "Not Received" contains the
    substring "received", which would otherwise also match the positive
    check below and silently flip the real answer."""
    if not raw:
        return None
    s = raw.strip().lower()
    if not s or s in ('-', 'na', 'n/a', 'pending', 'tbd', 'tba'):
        return None
    if re.search(r'\bnot\s+(?:received|verified|done|matched?)\b|\bno\b|\bmismatch', s):
        return False
    if re.search(r'\byes\b|\breceived\b|\bverified\b|\bdone\b|\bcomplete|\bmatch(?:ed)?\b', s):
        return True
    return None


def _parse_notice_days(raw: Optional[str]) -> Optional[int]:
    """"30 Days" / "1 Month" / "Immediate" -> integer days (candidates.
    notice_period_days)."""
    if not raw:
        return None
    s = raw.strip().lower()
    if 'immediate' in s:
        return 0
    m = re.search(r'(\d+)\s*day', s)
    if m:
        return int(m.group(1))
    m = re.search(r'(\d+(?:\.\d+)?)\s*month', s)
    if m:
        return round(float(m.group(1)) * 30)
    m = re.search(r'(\d+)', s)
    if m:
        return int(m.group(1))
    return None


def parse_tracking_sheet_candidate_fields(html: str) -> Optional[dict]:
    """Real bug fix (2026-09-09, same reporting email as parse_tracking_
    sheet_html above -- the recruiter's ask was "all tracking sheet
    details should add... in the candidate box", not just skills).
    Confirmed live: candidates.current_employer and .location for the
    reporting candidate held actively WRONG data, not just missing data
    -- extract_company_v2's "working at/with X" fallback regex
    (services/improved_parser.py) misfired on this exact tracking
    sheet's own column header text, "Duration working with current
    company", parsing the literal words "current company" as if they
    were a real employer name (confirmed by reproducing the exact match
    against the real combined text before writing this). Separately,
    extract_location_v2 returned "Mumbai" — not the candidate's real
    "Gandinagar, Gujarat" from the tracking sheet, but a city pulled
    from the SENDER'S OWN email signature block ("b: Bangalore,
    Kalaburagi, Mumbai, Delhi & Hyderabad", his company's listed
    office cities) — that function's plain city-list scan has no way to
    tell a candidate's real location apart from any other city name
    anywhere in the combined text, including a stranger's signature.

    Both existing extractors work directly off free-flowing prose with
    no notion of "whose sentence is this" — a real, structural
    limitation neither this fix nor the reporting session's scope
    attempts to redesign. What IS fixable here: when a genuine tracking-
    sheet table is present, its own explicitly labeled columns (Current
    Organization/Location/CTC/Notice Period) are a real, structurally
    reliable, definitely-about-the-candidate signal that should simply
    outrank a fragile whole-document regex guess, the same "structural
    proof beats a text guess" reasoning already applied to skills above.

    Returns None if this doesn't look like a real tracking sheet (same
    Skill+identity-column check as parse_tracking_sheet_html), else a
    dict with only the keys that had a real, non-empty cell value:
    current_employer, location, current_ctc, expected_ctc,
    notice_period_days."""
    if not html or not html.strip():
        return None
    parser = _TrackingSheetTableParser()
    try:
        parser.feed(html)
    except Exception:
        return None
    rows = [r for r in parser.rows if any(c.strip() for c in r)]
    if len(rows) < 2:
        return None

    headers = _normalize_headers(rows[0])
    if _find_col(headers, 'skill') is None:
        return None
    if _find_col(headers, 'name', 'candidate', 'email') is None:
        return None

    data_row = rows[1]

    def _cell(*keywords: str) -> Optional[str]:
        idx = _find_col(headers, *keywords)
        if idx is None or idx >= len(data_row):
            return None
        v = data_row[idx].strip()
        return v or None

    def _cell_excluding(keywords: tuple, exclude: tuple) -> Optional[str]:
        idx = _find_col_excluding(headers, keywords, exclude)
        if idx is None or idx >= len(data_row):
            return None
        v = data_row[idx].strip()
        return v or None

    out: dict = {}
    org = _cell('current organization', 'current company', 'current employer')
    if org:
        out['current_employer'] = org
    loc = _cell('current location')
    if loc:
        out['location'] = loc
    # REAL BUG FIX (2026-09-10): a second real tracking-sheet template
    # uses bare "CTC" for current and "ECTC/Rate Card" for expected --
    # neither matches "current ctc"/"expected ctc" at all. Bare "ctc" as
    # a fallback keyword would ALSO match inside "ECTC" (a real
    # substring), so the fallback explicitly excludes any header that
    # also says "ectc"/"expected".
    ctc_cur_raw = _cell('current ctc') or _cell_excluding(('ctc',), ('ectc', 'expected'))
    ctc_cur = _parse_ctc_to_rupees(ctc_cur_raw)
    if ctc_cur is not None:
        out['current_ctc'] = ctc_cur
    ctc_exp_raw = _cell('expected ctc', 'ectc')
    ctc_exp = _parse_ctc_to_rupees(ctc_exp_raw)
    if ctc_exp is not None:
        out['expected_ctc'] = ctc_exp
    notice = _parse_notice_days(_cell('notice period'))
    if notice is not None:
        out['notice_period_days'] = notice

    # Real feature (2026-09-10, reported live: "add the all missing Job
    # Type, NDA status, or Truecaller verification, Monthly Contract
    # Salary... keep the automatic extract and insert").
    job_type = _normalize_job_type(_cell('job type'))
    if job_type:
        out['job_type'] = job_type
    nda = _parse_yes_no(_cell('nda'))
    if nda is not None:
        out['nda_received'] = nda
    truecaller = _parse_yes_no(_cell('truecaller'))
    if truecaller is not None:
        out['truecaller_verified'] = truecaller

    # The new template's own dedicated column, tried first.
    monthly_raw = _cell('monthly contract salary', 'monthly salary')
    monthly = _parse_monthly_salary_to_rupees(monthly_raw)
    if monthly is None:
        # Real gap fix: a real older sheet (Anas A's) only ever has the
        # single ambiguous "ECTC/Rate Card" column — its "1.50 L/Month"
        # value correctly returns None from _parse_ctc_to_rupees above
        # (never guess a periodic rate is annual), which used to mean
        # this real, recruiter-typed figure was silently dropped
        # entirely rather than stored anywhere. Now: if the only salary
        # signal available is that same ambiguous column AND it reads as
        # a periodic rate (ctc_exp_raw parsed to None above despite
        # having real text), route it here instead — recovering data
        # that already existed but had nowhere correct to land before
        # this field existed.
        if ctc_exp_raw and ctc_exp is None:
            monthly = _parse_monthly_salary_to_rupees(ctc_exp_raw)
    if monthly is not None:
        out['monthly_contract_salary'] = monthly

    return out or None


def _recognized_taxonomy_skill(raw: str) -> Optional[str]:
    """Real gap fix (2026-09-03), see auto_populate_skill_experience()'s
    docstring for the full story. Checks whether `raw` is a genuinely
    recognized skill per this codebase's real, curated taxonomy —
    independent of any one candidate's own possibly-incomplete skills[]
    array. Deliberately mirrors only skill_normalizer.normalize_skill()'s
    steps 1-4 (noise-word rejection, exact DB-cache match, exact static-
    fallback match, word-boundary partial match) and never its own
    looser step 5 ("looks like a clean short term, keep it anyway") —
    that step would also accept real non-skill noise from a tracking
    sheet ("Support", "Migration", "Overall") and defeat the whole point
    of this check. Returns the canonical skill name, or None."""
    from services import skill_normalizer
    norm = skill_normalizer._normalize_for_lookup(raw)
    if not norm or norm in skill_normalizer.SKILL_NOISE_WORDS:
        return None
    if norm in skill_normalizer._CACHE:
        return skill_normalizer._CACHE[norm]
    if norm in _SKILL_LOOKUP:
        return _SKILL_LOOKUP[norm]
    for key, canonical in {**_SKILL_LOOKUP, **skill_normalizer._CACHE}.items():
        if len(key) >= 4:
            if re.search(r"(?<![a-z0-9])" + re.escape(key) + r"(?![a-z0-9])", norm):
                return canonical
    return None


async def auto_populate_skill_experience(conn, tenant_id: str, candidate_id: str,
                                          override_text: Optional[str] = None,
                                          override_html: Optional[str] = None) -> int:
    """Real, gap-audit fix (2026-09-02): candidate_skill_experience only
    ever got populated by manual entry or a human reviewing a pasted
    tracking-sheet snippet — live before this fix, 0 rows, ever, despite
    a real, well-designed table existing for exactly this purpose.
    Reuses the SAME already-proven parse_skill_summary_text() extractor
    (built for the KAE-submission "Paste & Parse" tool) run directly
    against the candidate's own resume_text — deliberately STRICTER than
    that tool's own "over-inclusive, a human reviews it" design: keeps a
    row only when BOTH the value genuinely looks like a real
    "N Yrs"/"N months" figure AND the extracted label matches one of
    this candidate's own already-recognized skills — blocks noise like
    "Total Experience: 5 Years" or "Notice Period: 30 Days" (a real
    "Label: Value" line that isn't actually a skill at all) from
    silently landing in the DB, since nothing here gets a human review
    first. Never overwrites or duplicates an existing row for the same
    skill — appends only, matching this table's own established
    convention from the public-form/paste-tool call sites. Best-effort;
    never raises (a resume with no usable signal is a real, honest
    outcome, not a caller-visible failure). Returns how many rows were
    newly created.

    override_text (real gap fix, 2026-09-03): email-intake candidates
    have candidates.resume_text stored as ATTACHMENT-ONLY text -- the
    email body (where a recruiter's own tracking-sheet skill-summary
    line often actually lives, e.g. "SAP FICO : 8 Yrs") is never
    persisted into that column, by design, since blindly storing raw
    email chrome (signatures, thread quotes, "please find attached")
    into a field the Resume Generator later renders verbatim into a
    candidate-facing PDF would visibly pollute it. Instead, the ONE real
    intake call site that has the combined resume+body text on hand at
    the moment it matters (resume_intake_service.py's
    process_email_for_resume) passes it here directly, so this function
    scans the richer text without ever persisting it anywhere -- every
    other caller is unaffected, still reading resume_text from the DB
    exactly as before.

    Real, live gap fix (2026-09-03): the original acceptance rule
    required the tracking-sheet skill name to ALSO appear in the
    candidate's own `skills[]` array -- a real, reasonable-looking guard
    against noise, but it silently assumed that array is a reliable,
    independent signal. It isn't: `skills[]` comes from the SAME
    resume-attachment parsing that, for a real, non-rare share of
    candidates in this project's own history, fails outright (a
    corrupted legacy .doc, OCR garbage, an unreadable scan) and produces
    an incomplete or near-empty list. Confirmed live: a real candidate
    ("HARI...") whose attachment parsing left `skills[]` at just 3 wrong-
    ish entries had her genuinely real, explicitly-labeled tracking-sheet
    line "SAP COPA : 3 Yrs" (and SAP ECC, SAP FSCM) silently dropped —
    2 of 5 real skills kept, 3 lost, purely because the OTHER extraction
    path had already failed. Now also accepts a skill name recognized by
    the same real, curated taxonomy this codebase trusts everywhere else
    (skill_normalizer's DB-backed cache + improved_parser's static
    fallback), independent of that one candidate's own possibly-broken
    skills[] array. Deliberately reuses only normalize_skill()'s steps
    1-4 (noise-word rejection, exact match, word-boundary partial match)
    via _recognized_taxonomy_skill() below -- never its own looser step 5
    ("looks like a clean short term, keep it anyway"), which would also
    accept genuine non-skill noise like "Support"/"Migration"/"Overall"
    and defeat the whole point of this filter.

    override_html (real bug fix, 2026-09-09): see parse_tracking_sheet_
    html()/_TrackingSheetTableParser above for the full story -- a real
    HTML <table> tracking sheet in the email body has no "Label: Value"
    pairing at all once flattened to plain text (its "Skill" column
    alone holds many stacked entries), so parse_skill_summary_text()
    above structurally cannot see it no matter how rich override_text
    is. When real HTML is available, table-column rows are tried FIRST
    and, since they already carry real structural proof (a genuine named
    "Skill" column, not a guessed "Label: Value" line), skip the
    taxonomy-recognition gate entirely -- unlike every row below it."""
    try:
        row = await conn.fetchrow(
            "SELECT resume_text, skills FROM candidates WHERE tenant_id=$1 AND id=$2",
            tenant_id, candidate_id)
        if not row:
            return 0
        known_skills = {s.lower() for s in (row["skills"] or [])}

        real_rows = []
        if override_html and override_html.strip():
            real_rows.extend(parse_tracking_sheet_html(override_html))
        seen_keys = {r["skill_name"].lower() for r in real_rows}

        scan_text = override_text if override_text and override_text.strip() else row["resume_text"]
        if scan_text:
            for p in parse_skill_summary_text(scan_text):
                key = p["skill_name"].lower()
                if key in seen_keys or not p["looks_like_experience"]:
                    continue
                if key in known_skills:
                    real_rows.append(p)
                    seen_keys.add(key)
                    continue
                canonical = _recognized_taxonomy_skill(p["skill_name"])
                if canonical and canonical.lower() not in seen_keys:
                    real_rows.append({**p, "skill_name": canonical})
                    seen_keys.add(canonical.lower())
        if not real_rows:
            return 0

        existing = await conn.fetch(
            "SELECT LOWER(skill_name) AS s FROM candidate_skill_experience WHERE tenant_id=$1 AND candidate_id=$2",
            tenant_id, candidate_id)
        existing_names = {r["s"] for r in existing}
        offset = await conn.fetchval(
            "SELECT COUNT(*) FROM candidate_skill_experience WHERE tenant_id=$1 AND candidate_id=$2",
            tenant_id, candidate_id) or 0

        created = 0
        for p in real_rows:
            key = p["skill_name"].lower()
            if key in existing_names:
                continue
            await conn.execute(
                """INSERT INTO candidate_skill_experience
                   (tenant_id, candidate_id, skill_name, relevant_experience, sort_order)
                   VALUES ($1,$2,$3,$4,$5)""",
                tenant_id, candidate_id, p["skill_name"], p["relevant_experience"], offset + created,
            )
            existing_names.add(key)
            created += 1
        return created
    except Exception:
        return 0


async def apply_tracking_sheet_candidate_fields(conn, tenant_id: str, candidate_id: str,
                                                 override_html: Optional[str]) -> int:
    """Real bug fix (2026-09-09) — applies parse_tracking_sheet_candidate_
    fields() above to the real candidate row. Deliberately unconditional
    (overwrites, doesn't COALESCE-only-fill): this runs exactly once, in
    the same fire-and-forget background task as auto_populate_skill_
    experience above, immediately after intake — before any recruiter
    has had a chance to review or hand-correct the record, so there's no
    real human edit at risk of being clobbered. Confirmed live: the
    field is often already non-NULL by this point with an actively WRONG
    value (extract_company_v2/extract_location_v2 already ran during the
    earlier parse step and can populate garbage, e.g. "Current Company"
    literal text or a recruiter's own signature-block city) — a plain
    "only if NULL" fill would never correct that, only ever fill a
    genuinely blank field. Best-effort; never raises. Returns how many
    fields were updated."""
    if not override_html or not override_html.strip():
        return 0
    try:
        fields = parse_tracking_sheet_candidate_fields(override_html)
        if not fields:
            return 0
        params: list = [tenant_id, candidate_id]
        set_clauses = []
        for key, value in fields.items():
            params.append(value)
            set_clauses.append(f"{key} = ${len(params)}")
        await conn.execute(
            f"UPDATE candidates SET {', '.join(set_clauses)}, updated_at = now() "
            f"WHERE tenant_id=$1 AND id=$2",
            *params,
        )
        return len(fields)
    except Exception:
        return 0
