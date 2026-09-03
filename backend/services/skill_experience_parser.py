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
                                          override_text: Optional[str] = None) -> int:
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
    and defeat the whole point of this filter."""
    try:
        row = await conn.fetchrow(
            "SELECT resume_text, skills FROM candidates WHERE tenant_id=$1 AND id=$2",
            tenant_id, candidate_id)
        if not row:
            return 0
        scan_text = override_text if override_text and override_text.strip() else row["resume_text"]
        if not scan_text:
            return 0
        known_skills = {s.lower() for s in (row["skills"] or [])}

        proposed = parse_skill_summary_text(scan_text)
        real_rows = []
        for p in proposed:
            if not p["looks_like_experience"]:
                continue
            if p["skill_name"].lower() in known_skills:
                real_rows.append(p)
                continue
            canonical = _recognized_taxonomy_skill(p["skill_name"])
            if canonical:
                real_rows.append({**p, "skill_name": canonical})
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
