"""Real, automatic source_attribution population — closing the gap the
2026-09-02 audit found: candidates.source has been genuinely auto-
populated across every real intake path for a long time, but the richer
source_attribution table (vendor, cost, placement value, ROI — the table
that actually backs "Conversion Rate by Source") only ever got a row via
one manual-entry-only endpoint. Live count before this fix: 1 row against
4,840 candidates.

candidates.source uses a wide, organically-grown vocabulary (direct,
linkedin, recruiter_personal_link, recruiter_job_link, referral,
whatsapp, naukri, csv_import, website, sensehq, self_apply, and blank).
source_attribution.source_channel is CHECK-constrained to a narrower,
pre-defined set (direct, vendor, linkedin, naukri, indeed, referral,
walk_in, campus, job_portal, other) — confirmed live via psql before
writing this. A blind copy would violate the constraint on most real
values, so every real value is explicitly mapped here rather than
guessed; anything genuinely unmapped falls to 'other', never crashes.
"""

_CHANNEL_MAP = {
    "direct": "direct",
    "website": "direct",
    "self_apply": "direct",
    "recruiter_personal_link": "direct",
    "recruiter_job_link": "direct",
    "linkedin": "linkedin",
    "naukri": "naukri",
    "job_board": "job_portal",
    "indeed": "indeed",
    "referral": "referral",
    "csv_import": "other",
    "excel_import": "other",
    "bulk_import": "other",
    "whatsapp": "other",
    "sensehq": "other",
}


def map_source_channel(source: str | None) -> str:
    """Normalize candidates.source's wide real vocabulary down to
    source_attribution's narrower CHECK-constrained set. Never raises —
    an unrecognized or blank value honestly falls to 'other'/'direct'
    rather than guessing at a category it can't actually support."""
    if not source:
        return "direct"
    return _CHANNEL_MAP.get(source.strip().lower(), "other")


async def record_source_attribution(conn, tenant_id: str, candidate_id: str, source: str | None,
                                      vendor_id: str | None = None, source_cost: float = 0) -> None:
    """Best-effort, real INSERT — called only on a candidate's GENUINE
    creation branch across every real intake path (manual add, email/
    WhatsApp resume intake, public apply, personal/job-share links, CSV/
    Excel bulk import), never on an update-to-an-existing-candidate
    branch. ON CONFLICT DO NOTHING: a candidate's first real intake
    channel is the one that counts for attribution — a later re-intake
    of the same person (matched by email/phone) never overwrites it,
    matching upsert_candidate()'s own established gap-fill-only
    discipline elsewhere in this codebase. Never blocks the caller's own
    real work on failure — this is enrichment, not a hard requirement,
    same convention as every other best-effort side write in this file's
    neighboring services (activity_events, ownership)."""
    try:
        channel = map_source_channel(source)
        await conn.execute(
            """INSERT INTO source_attribution (tenant_id, candidate_id, vendor_id, source_channel, source_cost)
               VALUES ($1,$2,$3,$4,$5)
               ON CONFLICT (tenant_id, candidate_id) DO NOTHING""",
            tenant_id, candidate_id, vendor_id, channel, source_cost,
        )
    except Exception as ex:
        print(f"[source_attribution] best-effort record failed for candidate {candidate_id}: {ex}")


async def mark_source_attribution_placed(conn, tenant_id: str, candidate_id: str, placement_value: float | None) -> None:
    """Fires on a REAL placement (offer acceptance) — the automatic
    counterpart to the existing manual PATCH .../attribution/{id}/
    outcome endpoint, same ROI formula. Only updates a row that already
    exists (a candidate placed with no attribution row at all has
    nothing to update — record_source_attribution should already have
    created one on intake for any candidate created after this fix
    shipped; a pre-existing candidate from before this fix simply has no
    attribution history to correct here, and inventing one after the
    fact would misrepresent when the record was actually created)."""
    try:
        await conn.execute(
            """UPDATE source_attribution SET
                 placed=TRUE, placed_at=now(), placement_value=$2,
                 roi = CASE WHEN source_cost>0 THEN ROUND(($2-source_cost)/source_cost*100,2) ELSE NULL END
               WHERE tenant_id=$1 AND candidate_id=$3""",
            tenant_id, placement_value or 0, candidate_id,
        )
    except Exception as ex:
        print(f"[source_attribution] best-effort placement mark failed for candidate {candidate_id}: {ex}")
