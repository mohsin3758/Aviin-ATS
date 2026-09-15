"""WhatsApp automation research (2026-09-15), gap: a bgv_checks row
reaching 'completed' or 'failed' never notified the candidate on any
channel. Deliberately non-alarming and free of the real check
`result`/`notes` -- Aadhaar/PAN-adjacent PII, Hard Rule #10 -- a status
ping only; real findings stay recruiter-only.
"""
from routers.whatsapp_bot import send_wa
from services.screening_i18n import t


async def process_bgv_notify(conn, tenant_id: str) -> int:
    sent = 0
    rows = await conn.fetch(
        """SELECT bc.id, bc.status, c.full_name, c.phone,
                  (SELECT ua.waha_session_name FROM applications a
                   JOIN user_whatsapp_accounts ua ON ua.tenant_id=a.tenant_id
                     AND ua.user_id=a.assigned_recruiter_id AND ua.status='working'
                   WHERE a.tenant_id=bc.tenant_id AND a.candidate_id=bc.candidate_id
                   ORDER BY a.updated_at DESC LIMIT 1) AS waha_session_name
           FROM bgv_checks bc
           JOIN candidates c ON c.id = bc.candidate_id
           WHERE bc.tenant_id=$1 AND bc.status IN ('completed','failed')
             AND bc.candidate_notified_at IS NULL AND c.phone IS NOT NULL""",
        tenant_id)
    for row in rows:
        if not row["waha_session_name"]:
            continue
        name = (row["full_name"] or "").split()[0] or "there"
        key = "bgv_completed" if row["status"] == "completed" else "bgv_flagged"
        delivered = await send_wa(row["phone"], t(key, "en", name=name), session=row["waha_session_name"])
        if delivered:
            await conn.execute("UPDATE bgv_checks SET candidate_notified_at=now() WHERE id=$1", row["id"])
            sent += 1
    return sent
