"""
Phase C: Skill Normalizer — DB-backed canonical skill normalization

Loads all skills + aliases from skills_taxonomy DB table.
Given any raw skill string, returns the canonical DB skill_name.
Falls back to improved_parser TECH_SKILLS dict if not in DB.
Thread-safe, async-safe, cached.
"""
import re
import asyncio
import asyncpg
from typing import Optional
from functools import lru_cache


# ── Noise words that are NOT skills ──────────────────────────────────────────
SKILL_NOISE_WORDS = frozenset([
    # Resume section labels mistaken for skills
    'number', 'ectc', 'notice period', 'email id', 'email', 'phone',
    'address', 'location', 'city', 'state', 'country', 'pin code',
    'date of birth', 'gender', 'nationality', 'marital status',
    'father name', 'mother name', 'passport',
    # Common non-skill phrases
    'conditions provided herein below', 'in english for driving',
    'business processes', 'effective presentation', 'resource',
    'services', 'management', 'support', 'team', 'development',
    'implementation', 'project', 'client', 'customer',
    'sap s',  # Incomplete SAP skill
    '4hana alone',  # Without "SAP" prefix — handle separately
    'multi tasking', 'time management', 'problem solving',
    'detail oriented', 'quick learner', 'team player', 'self motivated',
])

# ── Cache: alias_lowercase → canonical_name ─────────────────────────────────
_CACHE: dict[str, str] = {}
_CACHE_LOADED = False
_CACHE_LOCK = asyncio.Lock()


def _normalize_for_lookup(text: str) -> str:
    """Normalize raw text for lookup: lowercase, collapse spaces."""
    return re.sub(r'\s+', ' ', text.lower().strip().strip('.,;:'))


async def _load_cache_from_db(conn) -> dict[str, str]:
    """Load all skills + aliases from DB into lookup dict."""
    lookup: dict[str, str] = {}
    rows = await conn.fetch("""
        SELECT skill_name, aliases FROM skills_taxonomy
        WHERE is_active = TRUE
        ORDER BY skill_name""")
    for row in rows:
        canonical = row['skill_name']
        # Canonical name maps to itself
        lookup[_normalize_for_lookup(canonical)] = canonical
        # Each alias maps to canonical
        for alias in (row['aliases'] or []):
            lookup[_normalize_for_lookup(alias)] = canonical
    return lookup


async def init_cache(conn) -> None:
    """Initialize the skill lookup cache from DB. Call once at startup."""
    global _CACHE, _CACHE_LOADED
    async with _CACHE_LOCK:
        if _CACHE_LOADED:
            return
        _CACHE = await _load_cache_from_db(conn)
        _CACHE_LOADED = True
        print(f'[SkillNorm] Cache loaded: {len(_CACHE)} entries for {len(set(_CACHE.values()))} skills')


async def refresh_cache(conn) -> None:
    """Reload cache from DB (call after adding new skills)."""
    global _CACHE, _CACHE_LOADED
    async with _CACHE_LOCK:
        _CACHE = await _load_cache_from_db(conn)
        _CACHE_LOADED = True
        print(f'[SkillNorm] Cache refreshed: {len(_CACHE)} entries')


def normalize_skill(raw: str, fallback_lookup: dict = None) -> Optional[str]:
    """
    Normalize a raw skill string to canonical DB name.

    Args:
        raw: Raw skill string (e.g. "js", "SAP ABAP OOP", "4HANA")
        fallback_lookup: Optional extra lookup dict (e.g. from improved_parser)

    Returns:
        Canonical skill name or None if rejected as noise
    """
    if not raw or len(raw.strip()) < 2:
        return None

    raw_clean = raw.strip()
    norm = _normalize_for_lookup(raw_clean)

    # 1. Filter noise words
    if norm in SKILL_NOISE_WORDS:
        return None
    # Also reject if contains noise phrases
    if any(noise in norm for noise in ['conditions provided', 'in english for', 'herein below']):
        return None

    # 2. Check DB cache
    if norm in _CACHE:
        return _CACHE[norm]

    # 3. Check fallback lookup (improved_parser TECH_SKILLS)
    if fallback_lookup and norm in fallback_lookup:
        return fallback_lookup[norm]

    # 4. Partial match in cache (for multi-word skills)
    # e.g. "sap abap oop developer" → "SAP ABAP"
    # REAL BUG FIX (2026-09-03): this used a bare Python substring check
    # (`key in norm`) - found live while widening the skill taxonomy with
    # SAP COPA/ECC/FSCM (a real recruiter's own tracking sheet had all 3
    # as distinct line items from SAP FICO). A pre-existing, genuinely
    # legitimate DB alias, "sap co" -> SAP FICO (for real "SAP FI/CO"
    # mentions), is also a literal PREFIX of "sap copa" - the bare
    # substring check silently collapsed every "SAP COPA" mention into
    # "SAP FICO" instead, defeating the whole point of the taxonomy
    # widening: confirmed live, a real resume listing both would show
    # "SAP FICO" once and lose "SAP COPA" entirely, not merely
    # duplicated. extract_skills_from_text() (improved_parser.py) already
    # gets this right via a word-boundary-anchored regex - matched here,
    # closing the same bug class generally rather than patching just this
    # one alias, since any future short DB alias could collide with a
    # longer, genuinely different skill name the identical way.
    for key, canonical in _CACHE.items():
        if len(key) >= 4 and not norm.startswith('not '):
            pattern = r'(?<![a-z0-9])' + re.escape(key) + r'(?![a-z0-9])'
            if re.search(pattern, norm):
                return canonical

    # 5. If raw is already a well-formed tech term (short, no spaces or PascalCase), keep it
    words = raw_clean.split()
    if len(words) <= 3 and len(raw_clean) >= 2:
        # Check if it looks like a tech skill (not a sentence)
        if not any(raw_clean.lower().startswith(w) for w in
                   ['and ', 'or ', 'the ', 'a ', 'an ', 'for ', 'in ', 'with ', 'to ']):
            if not re.search(r'[.!?;]', raw_clean):  # No sentence punctuation
                return raw_clean  # Keep unknown but clean-looking skills

    return None


def normalize_skills_list(raw_skills: list, fallback_lookup: dict = None) -> list:
    """
    Normalize a list of raw skills. Returns deduplicated canonical list.
    """
    canonical: dict[str, bool] = {}  # canonical_name → True (ordered dedup)
    for raw in raw_skills:
        result = normalize_skill(raw, fallback_lookup)
        if result and result not in canonical:
            canonical[result] = True
    return list(canonical.keys())


def get_cache_stats() -> dict:
    """Return cache statistics."""
    skills = set(_CACHE.values())
    return {
        'total_entries': len(_CACHE),
        'unique_skills': len(skills),
        'loaded': _CACHE_LOADED,
    }


# ── Sync version for testing ─────────────────────────────────────────────────
def build_sync_lookup(skills_rows: list) -> dict:
    """Build lookup dict from DB rows (for use without async)."""
    lookup = {}
    for row in skills_rows:
        canonical = row['skill_name']
        lookup[_normalize_for_lookup(canonical)] = canonical
        for alias in (row.get('aliases') or []):
            lookup[_normalize_for_lookup(alias)] = canonical
    return lookup
