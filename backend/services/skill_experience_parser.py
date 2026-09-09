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
            self._row_cells.append(''.join(self._cell_parts).strip())
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


def _find_col(headers: list[str], *keywords: str) -> Optional[int]:
    for i, h in enumerate(headers):
        if any(k in h for k in keywords):
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

    headers = [h.strip().lower() for h in rows[0]]
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
    for raw_line in re.split(r"[\r\n]+", skill_cell):
        name = raw_line.strip().strip(",")
        if not name or len(name) > 60:
            continue
        skill_name = _normalize_skill_label(name)
        key = skill_name.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append({
            "skill_name": skill_name,
            "relevant_experience": exp_value,
            "looks_like_experience": True,
        })
    return out


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
