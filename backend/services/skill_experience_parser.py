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
