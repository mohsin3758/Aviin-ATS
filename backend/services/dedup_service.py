"""
Phase F: Deduplication Service
4-stage identity resolution:
  Stage A: Exact deterministic (email, phone, file_hash, linkedin_url)
  Stage B: Strong fuzzy (name + employer, name + phone-partial)
  Stage C: Resume similarity (same file hash = same document)
  Stage D: Name-based (only flag, never auto-merge on name alone)

Zero API cost. All rule-based.
"""
import hashlib
import re
from typing import Optional
from dataclasses import dataclass


# ── Dedup decisions ──────────────────────────────────────────────────────────
EXACT_MATCH      = 'EXACT_MATCH'       # Deterministic — auto-merge
HIGH_CONFIDENCE  = 'HIGH_CONFIDENCE'   # > 0.80 — auto-merge with audit
POSSIBLE_MATCH   = 'POSSIBLE_MATCH'    # 0.50-0.80 — human review
NO_MATCH         = 'NO_MATCH'          # < 0.50 — create new


@dataclass
class DedupResult:
    decision: str
    score: float
    matched_candidate_id: Optional[str]
    evidence: list         # list of (method, description, weight)
    should_merge: bool     # True for EXACT + HIGH_CONFIDENCE


def compute_file_hash(data: bytes) -> str:
    """SHA-256 hash of file bytes."""
    return hashlib.sha256(data).hexdigest()


def normalize_name(name: str) -> str:
    """Normalize name for comparison: lowercase, remove extra spaces/punctuation."""
    if not name:
        return ''
    name = name.lower().strip()
    name = re.sub(r'[^\w\s]', '', name)  # remove punctuation
    name = re.sub(r'\s+', ' ', name)     # collapse spaces
    return name


def name_similarity(name1: str, name2: str) -> float:
    """
    Simple name similarity score 0.0-1.0.
    Uses token overlap (works for Indian names where order varies).
    """
    if not name1 or not name2:
        return 0.0
    n1 = set(normalize_name(name1).split())
    n2 = set(normalize_name(name2).split())
    if not n1 or not n2:
        return 0.0
    intersection = n1 & n2
    union = n1 | n2
    # Jaccard similarity
    jaccard = len(intersection) / len(union)
    # Bonus: if all tokens of shorter name are in longer name
    shorter = n1 if len(n1) <= len(n2) else n2
    longer = n2 if len(n1) <= len(n2) else n1
    if shorter.issubset(longer):
        jaccard = max(jaccard, 0.85)
    return round(jaccard, 3)


async def check_duplicate(
    conn,
    tenant_id: str,
    parsed: dict,
    file_data: bytes = None,
    file_hash: str = None,
) -> DedupResult:
    """
    Check if parsed candidate data matches an existing candidate.

    Args:
        conn: asyncpg connection
        tenant_id: tenant UUID
        parsed: dict with name, email, phone, linkedin_url, current_company, etc.
        file_data: raw file bytes (for SHA-256 hash)
        file_hash: pre-computed SHA-256 (if file_data not available)

    Returns:
        DedupResult with decision and matched_candidate_id
    """
    evidence = []
    fh = file_hash or (compute_file_hash(file_data) if file_data else None)

    # ── Stage A: Exact deterministic ─────────────────────────────────────
    # A1. File hash (exact same document)
    if fh:
        existing_rf = await conn.fetchrow("""
            SELECT rf.candidate_id, c.full_name
            FROM resume_files rf
            JOIN candidates c ON c.id = rf.candidate_id
            WHERE rf.tenant_id=$1 AND rf.file_hash=$2 AND rf.candidate_id IS NOT NULL
            LIMIT 1""", tenant_id, fh)
        if existing_rf:
            evidence.append(('file_hash', f'Identical file SHA-256={fh[:12]}...', 1.0))
            return DedupResult(
                decision=EXACT_MATCH, score=1.0,
                matched_candidate_id=str(existing_rf['candidate_id']),
                evidence=evidence, should_merge=True)

    # A2. Normalized email
    email = (parsed.get('email') or '').lower().strip()
    if email and '@' in email:
        existing = await conn.fetchval("""
            SELECT id FROM candidates
            WHERE tenant_id=$1 AND LOWER(TRIM(email))=$2 LIMIT 1""",
            tenant_id, email)
        if existing:
            evidence.append(('email', f'Exact email match: {email}', 1.0))
            return DedupResult(
                decision=EXACT_MATCH, score=1.0,
                matched_candidate_id=str(existing),
                evidence=evidence, should_merge=True)

    # A3. Normalized phone (last 10 digits)
    raw_phone = re.sub(r'[^\d]', '', parsed.get('phone') or '')
    phone10 = raw_phone[-10:] if len(raw_phone) >= 10 else None
    if phone10:
        existing = await conn.fetchval("""
            SELECT id FROM candidates
            WHERE tenant_id=$1
              AND RIGHT(REGEXP_REPLACE(COALESCE(phone,''),'[^0-9]','','g'),10)=$2
            LIMIT 1""", tenant_id, phone10)
        if existing:
            evidence.append(('phone', f'Exact phone match: ...{phone10}', 1.0))
            return DedupResult(
                decision=EXACT_MATCH, score=1.0,
                matched_candidate_id=str(existing),
                evidence=evidence, should_merge=True)

    # A4. LinkedIn URL
    linkedin = (parsed.get('linkedin_url') or '').lower().strip().rstrip('/')
    if linkedin and 'linkedin.com/in/' in linkedin:
        # Normalize: extract just the path
        m = re.search(r'linkedin\.com/in/([\w\-]+)', linkedin)
        if m:
            li_path = m.group(1)
            existing = await conn.fetchval("""
                SELECT id FROM candidates
                WHERE tenant_id=$1 AND linkedin_url ILIKE $2 LIMIT 1""",
                tenant_id, f'%linkedin.com/in/{li_path}%')
            if existing:
                evidence.append(('linkedin_url', f'LinkedIn URL match: /in/{li_path}', 1.0))
                return DedupResult(
                    decision=EXACT_MATCH, score=1.0,
                    matched_candidate_id=str(existing),
                    evidence=evidence, should_merge=True)

    # ── Stage B: Strong fuzzy ─────────────────────────────────────────────
    name = (parsed.get('name') or '').strip()
    score = 0.0

    if name and len(name.split()) >= 2:
        # B1. Same name + same employer (threshold lowered 0.80→0.75; designation bonus)
        employer = (parsed.get('current_company') or '').lower().strip()
        designation = (parsed.get('current_designation') or '').lower().strip()

        if employer and len(employer) >= 3:
            existing_rows = await conn.fetch("""
                SELECT id, full_name, current_employer, current_designation
                FROM candidates
                WHERE tenant_id=$1
                  AND LOWER(current_employer) LIKE $2
                  AND full_name IS NOT NULL
                LIMIT 30""", tenant_id, f'%{employer[:20]}%')
            for row in existing_rows:
                ns = name_similarity(name, row['full_name'])
                if ns >= 0.75:
                    s = 0.75 + ns * 0.20
                    # Bonus: designation also matches → very strong signal
                    row_desig = (row['current_designation'] or '').lower()
                    if designation and len(designation) >= 5 and designation[:15] in row_desig:
                        s = min(s + 0.10, 0.99)
                        evidence.append(('name+employer+designation',
                            f'Name {ns:.0%} + employer "{employer[:25]}" + designation match', s))
                    else:
                        evidence.append(('name+employer',
                            f'Name similarity {ns:.0%} + same employer "{employer[:25]}"', s))
                    score = max(score, s)
                    if score >= 0.82:
                        return DedupResult(
                            decision=HIGH_CONFIDENCE, score=round(score, 3),
                            matched_candidate_id=str(row['id']),
                            evidence=evidence, should_merge=True)

        # B2. Name + designation alone (without employer) — moderate signal
        if score < 0.82 and designation and len(designation) >= 6:
            existing_rows = await conn.fetch("""
                SELECT id, full_name, current_designation
                FROM candidates
                WHERE tenant_id=$1
                  AND LOWER(current_designation) LIKE $2
                  AND full_name IS NOT NULL
                LIMIT 20""", tenant_id, f'%{designation[:20]}%')
            for row in existing_rows:
                ns = name_similarity(name, row['full_name'])
                if ns >= 0.85:
                    s = 0.70 + ns * 0.15
                    score = max(score, s)
                    evidence.append(('name+designation',
                        f'Name {ns:.0%} + same designation "{designation[:25]}"', s))

        # B3. Email username ↔ name token overlap
        # e.g. email "rajesh.kumar@gmail.com" + name "Rajesh Kumar" = strong match
        if score < 0.82 and email:
            email_user = email.split('@')[0].lower()
            name_tokens = set(normalize_name(name).split())
            email_tokens = set(re.split(r'[\.\-_]', email_user))
            if len(name_tokens & email_tokens) >= 2:
                existing_rows = await conn.fetch("""
                    SELECT id, full_name FROM candidates
                    WHERE tenant_id=$1
                      AND email IS NOT NULL
                      AND SPLIT_PART(LOWER(email),'@',1) = $2
                    LIMIT 5""", tenant_id, email_user)
                for row in existing_rows:
                    ns = name_similarity(name, row['full_name'])
                    if ns >= 0.75:
                        s = 0.80 + ns * 0.10
                        score = max(score, s)
                        evidence.append(('name+email_user',
                            f'Name {ns:.0%} + matching email username "{email_user[:20]}"', s))
                        if score >= 0.82:
                            return DedupResult(
                                decision=HIGH_CONFIDENCE, score=round(score, 3),
                                matched_candidate_id=str(row['id']),
                                evidence=evidence, should_merge=True)

        # B4. Name similarity alone (flag only, never auto-merge)
        if score < 0.60:
            existing_rows = await conn.fetch("""
                SELECT id, full_name, email, phone
                FROM candidates
                WHERE tenant_id=$1
                  AND LOWER(full_name) LIKE $2
                  AND full_name IS NOT NULL
                LIMIT 15""", tenant_id,
                f'%{name.split()[0].lower()}%')

            for row in existing_rows:
                ns = name_similarity(name, row['full_name'])
                if ns >= 0.70:
                    score = max(score, ns * 0.65)
                    evidence.append(('name_fuzzy',
                        f'Name similarity {ns:.0%}: "{name}" ≈ "{row["full_name"]}"',
                        ns * 0.65))

        if score >= 0.60:
            best_id = None
            best_score = 0
            rows = await conn.fetch("""
                SELECT id, full_name FROM candidates
                WHERE tenant_id=$1 AND full_name IS NOT NULL LIMIT 200""", tenant_id)
            for row in rows:
                ns = name_similarity(name, row['full_name'])
                if ns > best_score:
                    best_score = ns
                    best_id = str(row['id'])
            if best_score >= 0.70 and best_id:
                return DedupResult(
                    decision=POSSIBLE_MATCH, score=round(score, 3),
                    matched_candidate_id=best_id,
                    evidence=evidence, should_merge=False)

    # No match
    return DedupResult(
        decision=NO_MATCH, score=0.0,
        matched_candidate_id=None,
        evidence=evidence, should_merge=False)


async def merge_duplicate_candidates(conn, tenant_id: str, keep_id: str, merge_id: str) -> dict:
    """
    Merge merge_id INTO keep_id. keep_id is the canonical record.
    Updates all foreign keys, copies missing data, marks merge_id as deleted.
    Returns merge summary.
    """
    keep = await conn.fetchrow("SELECT * FROM candidates WHERE id=$1", keep_id)
    merge = await conn.fetchrow("SELECT * FROM candidates WHERE id=$1", merge_id)
    if not keep or not merge:
        return {'error': 'Candidate not found'}

    # Copy missing fields from merge → keep (prefer keep's data)
    updates = {}
    for field in ['email', 'phone', 'location', 'linkedin_url', 'current_employer',
                  'current_designation', 'source_email', 'source_label']:
        if not keep[field] and merge[field]:
            updates[field] = merge[field]

    # Skills: union of both
    keep_skills = set(keep['skills'] or [])
    merge_skills = set(merge['skills'] or [])
    combined_skills = list(keep_skills | merge_skills)
    if len(combined_skills) > len(keep_skills):
        updates['skills'] = combined_skills

    # Experience: take maximum
    keep_exp = keep['total_exp_mo'] or 0
    merge_exp = merge['total_exp_mo'] or 0
    if merge_exp > keep_exp:
        updates['total_exp_mo'] = merge_exp

    if updates:
        set_clause = ', '.join(f'{k}=${i+2}' for i, k in enumerate(updates.keys()))
        values = [keep_id] + list(updates.values())
        await conn.execute(f"UPDATE candidates SET {set_clause} WHERE id=$1", *values)

    # Re-link resume_files from merge → keep
    await conn.execute(
        "UPDATE resume_files SET candidate_id=$1 WHERE candidate_id=$2",
        keep_id, merge_id)

    # Re-link applications
    await conn.execute(
        "UPDATE applications SET candidate_id=$1 WHERE candidate_id=$2 "
        "AND NOT EXISTS (SELECT 1 FROM applications WHERE candidate_id=$1 AND requisition_id=applications.requisition_id)",
        keep_id, merge_id)

    # Re-link candidate_parsed_data
    await conn.execute(
        "UPDATE candidate_parsed_data SET candidate_id=$1 WHERE candidate_id=$2",
        keep_id, merge_id)

    # Soft-delete the merged candidate
    await conn.execute("UPDATE candidates SET is_active=FALSE WHERE id=$1", merge_id)

    return {
        'kept': keep_id,
        'merged': merge_id,
        'fields_copied': list(updates.keys()),
        'skills_added': len(combined_skills) - len(keep_skills),
    }
