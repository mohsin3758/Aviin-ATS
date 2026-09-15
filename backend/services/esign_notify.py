"""WhatsApp automation research (2026-09-15), gap: post-offer milestone
sequencing (Jobvite pattern) had only ever gotten as far as the joining-
confirmation half (services/offer_joining.py) -- the NDA and offer
e-sign links (nda_documents, offer_letters) already exist and already
notify by email (scheduler.py's existing reminder job), but never by
WhatsApp. whatsapp_sent_at (sql/139) is tracked separately from email's
own sent_at/reminder_sent_at so the two channels can't race or double-
send off the same column.
"""
import os

from routers.whatsapp_bot import send_wa
from services.screening_i18n import t

_BASE_URL = os.environ.get("NEXT_PUBLIC_APP_URL", "https://ats.aviintech.com")


async def process_esign_whatsapp_notify(conn, tenant_id: str) -> int:
    sent = 0

    nda_rows = await conn.fetch(
        """SELECT nd.id, nd.signing_token, c.full_name, c.phone,
                  (SELECT ua.waha_session_name FROM user_whatsapp_accounts ua
                   WHERE ua.tenant_id=$1 AND ua.user_id=a.assigned_recruiter_id AND ua.status='working'
                   LIMIT 1) AS waha_session_name
           FROM nda_documents nd
           JOIN candidates c ON c.id = nd.candidate_id
           JOIN applications a ON a.id = nd.application_id
           WHERE nd.tenant_id=$1 AND nd.status='sent' AND nd.whatsapp_sent_at IS NULL
             AND nd.signing_token IS NOT NULL AND c.phone IS NOT NULL""",
        tenant_id)
    for row in nda_rows:
        if not row["waha_session_name"]:
            continue
        name = (row["full_name"] or "").split()[0] or "there"
        link = f"{_BASE_URL}/sign-nda/{row['signing_token']}"
        delivered = await send_wa(row["phone"], t("esign_ready_nda", "en", name=name, link=link),
                                   session=row["waha_session_name"])
        if delivered:
            await conn.execute("UPDATE nda_documents SET whatsapp_sent_at=now() WHERE id=$1", row["id"])
            sent += 1

    offer_rows = await conn.fetch(
        """SELECT ol.id, ol.signing_token, c.full_name, c.phone,
                  (SELECT ua.waha_session_name FROM user_whatsapp_accounts ua
                   WHERE ua.tenant_id=$1 AND ua.user_id=a.assigned_recruiter_id AND ua.status='working'
                   LIMIT 1) AS waha_session_name
           FROM offer_letters ol
           JOIN candidates c ON c.id = ol.candidate_id
           JOIN offers o ON o.id = ol.offer_id
           JOIN applications a ON a.id = o.application_id
           WHERE ol.tenant_id=$1 AND ol.status='sent' AND ol.whatsapp_sent_at IS NULL
             AND ol.signing_token IS NOT NULL AND c.phone IS NOT NULL""",
        tenant_id)
    for row in offer_rows:
        if not row["waha_session_name"]:
            continue
        name = (row["full_name"] or "").split()[0] or "there"
        link = f"{_BASE_URL}/sign-offer/{row['signing_token']}"
        delivered = await send_wa(row["phone"], t("esign_ready_offer", "en", name=name, link=link),
                                   session=row["waha_session_name"])
        if delivered:
            await conn.execute("UPDATE offer_letters SET whatsapp_sent_at=now() WHERE id=$1", row["id"])
            sent += 1

    return sent
