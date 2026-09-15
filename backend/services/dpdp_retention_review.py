"""WhatsApp automation research round 3 (2026-09-15): India's DPDP Rules
2025 (notified 2025-11-14) require erasing personal data once its purpose
ends or on prolonged inactivity, with a mandatory notice to the data
principal before erasure. This module deliberately does NOT erase or
auto-notify anything -- per CLAUDE.md's own "Do not touch without
explicit evidence" section, hard-deleting real candidate PII is
irreversible and this codebase already treats resume_files/PII as
soft-delete-only everywhere else. This ONLY flags candidates for a human
(admin/data-privacy owner) to review, since the actual retention window
and erasure process is a policy decision, not an engineering one.

A single digest task per tenant per run, not one task per candidate --
this is a periodic compliance review, not a per-candidate incident.
"""
_STALE_DAYS = 365


async def flag_stale_screening_candidates(conn, tenant_id: str) -> int:
    stale = await conn.fetch(
        """SELECT c.id, c.full_name, s.status, s.updated_at
           FROM screening_sessions s
           JOIN candidates c ON c.id = s.candidate_id
           WHERE s.tenant_id=$1
             AND s.status IN ('declined','opted_out','no_response','bad_number')
             AND s.updated_at < now() - make_interval(days => $2)
             AND NOT EXISTS (SELECT 1 FROM interview_schedules i WHERE i.candidate_id=c.id)
             AND NOT EXISTS (SELECT 1 FROM offers o JOIN applications a ON a.id=o.application_id
                             WHERE a.candidate_id=c.id)
             AND NOT EXISTS (SELECT 1 FROM placements p WHERE p.candidate_id=c.id)
             AND NOT EXISTS (SELECT 1 FROM recruiter_tasks rt WHERE rt.candidate_name=c.full_name
                             AND rt.status='pending')""",
        tenant_id, _STALE_DAYS)
    if not stale:
        return 0

    already_flagged = await conn.fetchval(
        """SELECT 1 FROM recruiter_tasks
           WHERE tenant_id=$1 AND task_type='data_retention_review'
             AND created_at > now() - interval '25 days' LIMIT 1""",
        tenant_id)
    if already_flagged:
        return 0

    names = ", ".join(r["full_name"] for r in stale[:10])
    more = f" and {len(stale) - 10} more" if len(stale) > 10 else ""
    admin = await conn.fetchrow(
        "SELECT id FROM users WHERE tenant_id=$1 AND role IN ('admin','super_admin') ORDER BY created_at LIMIT 1",
        tenant_id)
    await conn.execute("""
        INSERT INTO recruiter_tasks (tenant_id, recruiter_id, candidate_name, task_type, title, priority)
        VALUES ($1,$2,$3,'data_retention_review',$4,'medium')
    """, tenant_id, admin["id"] if admin else None, f"{len(stale)} candidate(s)",
         f"DPDP data-retention review: {len(stale)} WhatsApp-screened candidate(s) declined/no-response/opted-out "
         f"for over a year with no downstream activity ({names}{more}) -- review for erasure per your retention "
         f"policy (DPDP Rules 2025 require a 48h notice to the candidate before erasing).")
    return len(stale)
