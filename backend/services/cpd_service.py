"""
Phase G: candidate_parsed_data service
Handles writing, upserting, and backfilling structured parse results.
One row per candidate = current best parse snapshot.
resume_files = full history (every parse attempt).
"""
import json
import logging

log = logging.getLogger(__name__)

GARBAGE_SKILL_WORDS = {
    'skills','experience','education','profile','summary','objective','responsibilities',
    'which','that','this','and','for','the','to','in','of','a','an','with','on','at',
    'work','team','strong','good','excellent','ability','knowledge','understanding',
    'as','or','by','from','is','are','was','been','has','have','had','will','can',
    'demands','personal','advancement','necessary','meet','every','challenge','but',
}


def _parse_json(raw) -> dict:
    """Normalise parsed_data from asyncpg (may come as str or dict)."""
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except Exception:
            return {}
    if isinstance(raw, dict):
        return raw
    return {}


def extract_structured_fields(parsed: dict) -> dict:
    """Map parser output dict to candidate_parsed_data columns."""
    raw_skills  = parsed.get("skills") or []
    exp_years   = float(parsed.get("experience_years") or 0)
    exp_months  = int(exp_years * 12)
    email       = (parsed.get("email") or "")[:200] or None
    phone       = (parsed.get("phone") or "")[:50] or None
    linkedin    = (parsed.get("linkedin_url") or "")[:500] or None
    edu         = parsed.get("education") or ""
    company     = parsed.get("current_company") or parsed.get("current_employer") or ""
    title       = parsed.get("current_designation") or ""

    companies = [company] if company else []
    titles    = [title]   if title   else []

    # Filter garbage skills
    skills = [
        s for s in (raw_skills or [])
        if isinstance(s, str)
        and 2 < len(s) < 60
        and s.lower().strip() not in GARBAGE_SKILL_WORDS
        and not s.lower().startswith(("as ", "and ", "which ", "that ", "for "))
        and s.count(" ") <= 5          # max 6 words
        and not any(c in s for c in ["(", ")", "/", "\\"])
    ][:50]

    # Education level heuristic
    edu_level = None
    el = edu.lower()
    if any(x in el for x in ["phd", "doctorate"]):
        edu_level = "phd"
    elif any(x in el for x in ["mba", "m.sc", "m.tech", "master", "mca", "me "]):
        edu_level = "masters"
    elif any(x in el for x in ["b.tech", "b.e", "bca", "bsc", "bcom", "bachelor", "be "]):
        edu_level = "bachelors"
    elif any(x in el for x in ["diploma", "polytechnic"]):
        edu_level = "diploma"
    elif any(x in el for x in ["12th", "hsc", "+2"]):
        edu_level = "12th"

    return {
        "extracted_skills":    skills,
        "extracted_titles":    titles,
        "extracted_companies": companies,
        "education_level":     edu_level,
        "degrees":             [edu] if edu else [],
        "institutions":        [],
        "total_years_exp":     round(exp_years, 1),
        "job_count":           len(companies),
        "max_gap_months":      0,
        "avg_tenure_months":   round(exp_months / max(len(companies), 1), 1),
        "extracted_email":     email,
        "extracted_phone":     phone,
        "linkedin_url":        linkedin,
        "raw_parsed":          json.dumps(parsed, default=str),
    }


async def upsert_candidate_parsed_data(
    conn,
    tenant_id: str,
    candidate_id: str,
    parsed,
    resume_file_id: str = None,
    parse_source: str = "v2_parser",
) -> bool:
    """
    Upsert into candidate_parsed_data (one row per candidate).
    ON CONFLICT DO UPDATE keeps the best data: more skills wins,
    higher exp wins, missing fields get filled in.
    """
    parsed_dict = _parse_json(parsed) if not isinstance(parsed, dict) else parsed
    fields = extract_structured_fields(parsed_dict)
    try:
        await conn.execute("""
            INSERT INTO candidate_parsed_data (
              tenant_id, candidate_id, resume_file_id, parse_source,
              extracted_skills, extracted_titles, extracted_companies,
              education_level, degrees, institutions,
              total_years_exp, job_count, max_gap_months, avg_tenure_months,
              extracted_email, extracted_phone, linkedin_url,
              raw_parsed, parsed_at, parse_version
            )
            VALUES ($1,$2,$3,$4, $5,$6,$7, $8,$9,$10, $11,$12,$13,$14, $15,$16,$17, $18::jsonb, NOW(), 1)
            ON CONFLICT (tenant_id, candidate_id) DO UPDATE SET
              resume_file_id     = COALESCE(EXCLUDED.resume_file_id, candidate_parsed_data.resume_file_id),
              parse_source       = EXCLUDED.parse_source,
              extracted_skills   = CASE
                WHEN array_length(EXCLUDED.extracted_skills,1) IS NOT NULL
                 AND (array_length(candidate_parsed_data.extracted_skills,1) IS NULL
                      OR array_length(EXCLUDED.extracted_skills,1) > array_length(candidate_parsed_data.extracted_skills,1))
                THEN EXCLUDED.extracted_skills
                ELSE candidate_parsed_data.extracted_skills END,
              extracted_titles   = CASE
                WHEN array_length(EXCLUDED.extracted_titles,1) IS NOT NULL
                THEN EXCLUDED.extracted_titles
                ELSE candidate_parsed_data.extracted_titles END,
              extracted_companies = CASE
                WHEN array_length(EXCLUDED.extracted_companies,1) IS NOT NULL
                THEN EXCLUDED.extracted_companies
                ELSE candidate_parsed_data.extracted_companies END,
              education_level    = COALESCE(EXCLUDED.education_level, candidate_parsed_data.education_level),
              degrees            = CASE
                WHEN array_length(EXCLUDED.degrees,1) IS NOT NULL
                THEN EXCLUDED.degrees
                ELSE candidate_parsed_data.degrees END,
              total_years_exp    = CASE
                WHEN EXCLUDED.total_years_exp > COALESCE(candidate_parsed_data.total_years_exp, 0)
                THEN EXCLUDED.total_years_exp
                ELSE candidate_parsed_data.total_years_exp END,
              extracted_email    = COALESCE(EXCLUDED.extracted_email, candidate_parsed_data.extracted_email),
              extracted_phone    = COALESCE(EXCLUDED.extracted_phone, candidate_parsed_data.extracted_phone),
              linkedin_url       = COALESCE(EXCLUDED.linkedin_url, candidate_parsed_data.linkedin_url),
              raw_parsed         = EXCLUDED.raw_parsed,
              parsed_at          = NOW(),
              parse_version      = candidate_parsed_data.parse_version + 1
        """,
            tenant_id, candidate_id, resume_file_id, parse_source,
            fields["extracted_skills"],
            fields["extracted_titles"],
            fields["extracted_companies"],
            fields["education_level"],
            fields["degrees"],
            fields["institutions"],
            fields["total_years_exp"],
            fields["job_count"],
            fields["max_gap_months"],
            fields["avg_tenure_months"],
            fields["extracted_email"],
            fields["extracted_phone"],
            fields["linkedin_url"],
            fields["raw_parsed"],
        )
        return True
    except Exception as e:
        log.warning(f"upsert_candidate_parsed_data failed for {candidate_id}: {e}")
        return False


async def backfill_candidate_parsed_data(conn, tenant_id: str) -> dict:
    """
    Backfill candidate_parsed_data from all existing resume_files.
    Pass 1: For each candidate, use the file with highest parse_confidence.
    Pass 2: For candidates with NO resume_files (manually added), use candidates table data.
    Safe to run multiple times (idempotent upsert).
    """
    # Pass 1 — resume_files
    rows = await conn.fetch("""
        SELECT DISTINCT ON (candidate_id)
          id           AS resume_file_id,
          candidate_id,
          parsed_data,
          parse_confidence,
          routing_decision
        FROM resume_files
        WHERE tenant_id = $1
          AND candidate_id IS NOT NULL
          AND parsed_data IS NOT NULL
          AND parsed_data != '{}'::jsonb
        ORDER BY candidate_id, parse_confidence DESC NULLS LAST, created_at DESC
    """, tenant_id)

    created = 0; updated = 0; skipped = 0; errors = 0

    for row in rows:
        try:
            parsed = _parse_json(row["parsed_data"])
            if not parsed:
                skipped += 1
                continue
            existing = await conn.fetchval(
                "SELECT parse_version FROM candidate_parsed_data WHERE tenant_id=$1 AND candidate_id=$2",
                tenant_id, str(row["candidate_id"])
            )
            ok = await upsert_candidate_parsed_data(
                conn, tenant_id, str(row["candidate_id"]), parsed,
                resume_file_id=str(row["resume_file_id"]),
                parse_source="backfill_v2",
            )
            if ok:
                if existing: updated += 1
                else:        created += 1
            else:
                errors += 1
        except Exception as e:
            log.warning(f"Backfill error for {row['candidate_id']}: {e}")
            errors += 1

    # Pass 2 — manually-added candidates with no resume_files
    orphans = await conn.fetch("""
        SELECT c.id, c.full_name, c.email, c.phone, c.linkedin_url,
               c.skills, c.total_exp_mo, c.current_employer, c.current_designation
        FROM candidates c
        WHERE c.tenant_id = $1
          AND c.is_active = TRUE
          AND NOT EXISTS (
            SELECT 1 FROM candidate_parsed_data cpd
            WHERE cpd.candidate_id = c.id AND cpd.tenant_id = c.tenant_id
          )
    """, tenant_id)

    orphan_created = 0; orphan_errors = 0
    for o in orphans:
        try:
            exp_mo = int(o["total_exp_mo"] or 0)
            parsed = {
                "name":               o["full_name"],
                "email":              o["email"],
                "phone":              o["phone"],
                "linkedin_url":       o["linkedin_url"],
                "skills":             list(o["skills"] or []),
                "experience_years":   round(exp_mo / 12, 1),
                "current_company":    o["current_employer"],
                "current_designation": o["current_designation"],
            }
            ok = await upsert_candidate_parsed_data(
                conn, tenant_id, str(o["id"]), parsed,
                resume_file_id=None,
                parse_source="candidate_manual",
            )
            if ok: orphan_created += 1
            else:  orphan_errors += 1
        except Exception as e:
            log.warning(f"Orphan cpd failed for {o['id']}: {e}")
            orphan_errors += 1

    return {
        "total_files":             len(rows),
        "created":                 created + orphan_created,
        "updated":                 updated,
        "skipped":                 skipped,
        "errors":                  errors + orphan_errors,
        "orphan_candidates_filled": orphan_created,
    }
