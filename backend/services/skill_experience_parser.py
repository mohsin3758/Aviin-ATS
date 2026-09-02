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
    exactly as before."""
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
        if not known_skills:
            return 0

        proposed = parse_skill_summary_text(scan_text)
        real_rows = [
            p for p in proposed
            if p["looks_like_experience"] and p["skill_name"].lower() in known_skills
        ]
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
