"""WhatsApp automation research round 3 (2026-09-15): placed-contractor
timesheet nudges are a real, named staffing-industry pattern (Vincere,
TrackOlap) distinct from candidate screening -- it operates on the
placements/timesheets entities (sql/05, sql/10), not candidates, since a
staffing agency's revenue runs on the timesheet-to-invoice cycle, not the
placement date itself.
"""
from routers.whatsapp_bot import send_wa
from services.screening_dispatch import is_business_hours
from services.screening_i18n import t


async def process_timesheet_reminders(conn, tenant_id: str) -> int:
    if not is_business_hours():
        return 0
    sent = 0

    # A placement active last week with no timesheet row at all yet --
    # create the draft stub so there's something real to track a reminder
    # against (a recruiter would otherwise have to create this row
    # manually anyway once the candidate does submit hours).
    await conn.execute(
        """INSERT INTO timesheets (tenant_id, placement_id, candidate_id, client_id, week_start)
           SELECT p.tenant_id, p.id, p.candidate_id, p.client_id,
                  date_trunc('week', CURRENT_DATE)::date - 7
           FROM placements p
           WHERE p.tenant_id=$1 AND p.status='active'
             AND p.start_date <= (date_trunc('week', CURRENT_DATE)::date - 1)
             AND (p.end_date IS NULL OR p.end_date >= (date_trunc('week', CURRENT_DATE)::date - 7))
             AND NOT EXISTS (
               SELECT 1 FROM timesheets ts
               WHERE ts.placement_id=p.id AND ts.week_start = date_trunc('week', CURRENT_DATE)::date - 7)
           ON CONFLICT DO NOTHING""",
        tenant_id)

    due = await conn.fetch(
        """SELECT ts.id, ts.week_start, c.full_name, c.phone,
                  (SELECT ua.waha_session_name FROM user_whatsapp_accounts ua
                   WHERE ua.tenant_id=$1 AND ua.user_id=r.created_by AND ua.status='working' LIMIT 1) AS waha_session_name
           FROM timesheets ts
           JOIN candidates c ON c.id = ts.candidate_id
           JOIN placements p ON p.id = ts.placement_id
           JOIN requisitions r ON r.id = p.requisition_id
           WHERE ts.tenant_id=$1 AND ts.status='draft'
             AND ts.week_end < CURRENT_DATE
             AND ts.whatsapp_reminder_sent_at IS NULL
             AND c.phone IS NOT NULL""",
        tenant_id)
    for row in due:
        if not row["waha_session_name"]:
            continue
        name = (row["full_name"] or "").split()[0] or "there"
        delivered = await send_wa(
            row["phone"], t("timesheet_reminder", "en", name=name, week_start=row["week_start"].strftime("%d %b")),
            session=row["waha_session_name"])
        if delivered:
            await conn.execute("UPDATE timesheets SET whatsapp_reminder_sent_at=now() WHERE id=$1", row["id"])
            sent += 1

    # A reminder that's gone unanswered for 3+ days escalates once to a
    # back-office task rather than nagging the contractor indefinitely.
    stale = await conn.fetch(
        """SELECT ts.id, ts.week_start, c.full_name, p.requisition_id
           FROM timesheets ts
           JOIN candidates c ON c.id = ts.candidate_id
           JOIN placements p ON p.id = ts.placement_id
           WHERE ts.tenant_id=$1 AND ts.status='draft'
             AND ts.whatsapp_reminder_sent_at < now() - interval '3 days'
             AND ts.whatsapp_escalated_at IS NULL""",
        tenant_id)
    for row in stale:
        await conn.execute("""
            INSERT INTO recruiter_tasks (tenant_id, requisition_id, candidate_name, task_type, title, priority)
            VALUES ($1,$2,$3,'callback_request',$4,'medium')
        """, tenant_id, row["requisition_id"], row["full_name"],
             f"{row['full_name']}'s timesheet for week of {row['week_start'].strftime('%d %b')} is still not submitted")
        await conn.execute("UPDATE timesheets SET whatsapp_escalated_at=now() WHERE id=$1", row["id"])

    return sent
