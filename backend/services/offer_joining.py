"""WhatsApp automation research (2026-09-15), gap #7: for a staffing
agency, the placement fee triggers on the candidate actually JOINING, not
on the interview or even the offer -- the built WhatsApp Screening flow
stopped at "send interview invite" and left the highest-value, highest-
leakage part of the funnel completely unaddressed. offers.status already
has a real 'accepted' value and offers.joining_date (sql/01) -- this adds
only the send-tracking columns (sql/137), no new table.

Reuses services.screening_dispatch.is_business_hours -- a joining
reminder is exactly the same "don't message outside business hours"
class of send as a screening opt-in, no reason to duplicate that check.
"""
from routers.whatsapp_bot import send_wa
from services.screening_dispatch import is_business_hours
from services.screening_i18n import t


async def process_offer_joining_sequence(conn, tenant_id: str) -> int:
    if not is_business_hours():
        return 0

    sent = 0

    tomorrow_due = await conn.fetch(
        """SELECT o.id, o.joining_date, a.assigned_recruiter_id, r.title, cl.name AS client_name,
                  c.full_name, c.phone, ua.waha_session_name
           FROM offers o
           JOIN applications a ON a.id = o.application_id
           JOIN requisitions r ON r.id = a.requisition_id
           LEFT JOIN clients cl ON cl.id = r.client_id
           JOIN candidates c ON c.id = a.candidate_id
           LEFT JOIN user_whatsapp_accounts ua ON ua.id = (
               SELECT id FROM user_whatsapp_accounts
               WHERE tenant_id=$1 AND user_id=a.assigned_recruiter_id AND status='working' LIMIT 1)
           WHERE o.tenant_id=$1 AND o.status='accepted'
             AND o.joining_date = CURRENT_DATE + 1
             AND o.joining_reminder_sent_at IS NULL
             AND c.phone IS NOT NULL""",
        tenant_id)
    for row in tomorrow_due:
        if not row["waha_session_name"]:
            continue
        name = (row["full_name"] or "").split()[0] or "there"
        delivered = await send_wa(
            row["phone"],
            t("joining_reminder", "en", name=name, client=row["client_name"] or "your new employer",
              role=row["title"] or "your new role", date=row["joining_date"].strftime("%d %b %Y")),
            session=row["waha_session_name"])
        if delivered:
            await conn.execute(
                "UPDATE offers SET joining_reminder_sent_at=now() WHERE id=$1", row["id"])
            sent += 1

    today_due = await conn.fetch(
        """SELECT o.id, a.assigned_recruiter_id, r.title, cl.name AS client_name,
                  c.full_name, c.phone, ua.waha_session_name
           FROM offers o
           JOIN applications a ON a.id = o.application_id
           JOIN requisitions r ON r.id = a.requisition_id
           LEFT JOIN clients cl ON cl.id = r.client_id
           JOIN candidates c ON c.id = a.candidate_id
           LEFT JOIN user_whatsapp_accounts ua ON ua.id = (
               SELECT id FROM user_whatsapp_accounts
               WHERE tenant_id=$1 AND user_id=a.assigned_recruiter_id AND status='working' LIMIT 1)
           WHERE o.tenant_id=$1 AND o.status='accepted'
             AND o.joining_date = CURRENT_DATE
             AND o.joining_confirmation_sent_at IS NULL
             AND c.phone IS NOT NULL""",
        tenant_id)
    for row in today_due:
        if not row["waha_session_name"]:
            continue
        name = (row["full_name"] or "").split()[0] or "there"
        delivered = await send_wa(
            row["phone"],
            t("joining_confirm_ask", "en", name=name, client=row["client_name"] or "your new employer"),
            session=row["waha_session_name"])
        if delivered:
            await conn.execute(
                "UPDATE offers SET joining_confirmation_sent_at=now() WHERE id=$1", row["id"])
            sent += 1

    return sent
