"""Throttled WhatsApp sender for screening opt-in messages (WhatsApp
Screening Blueprint, Milestone 1, Phase 1 - Enroll & throttle).

Business hours + jitter + per-number warm-up ramp + per-recruiter-number
pacing all work together, per the blueprint's own guardrail note that no
one of these alone is enough to keep WAHA (an unofficial client) from
getting a number banned.

NOT implemented here (scoped out of Milestone 1, noted for a fast-follow):
true delivery-ack-based bad_number detection. WAHA's webhook integration
in this codebase (backend/routers/whatsapp_bot.py) only ever registered
for INBOUND messages -- there is no existing handler for WAHA's async
message.ack delivery-status event, confirmed by grep (no hits anywhere
in backend/ for message.ack/messageAck). send_wa()'s own return value
only confirms WAHA accepted the API call, not that WhatsApp delivered it
to a real number -- using that as a bad_number signal would misclassify
a temporarily-down WAHA session the same as a genuinely invalid number.
A failed send here is left as pending_optin and retried on the next
dispatch tick rather than guessed at.
"""
import random
from datetime import datetime, date
from zoneinfo import ZoneInfo

from routers.whatsapp_bot import send_wa
from services.screening_i18n import t

IST = ZoneInfo("Asia/Kolkata")
BUSINESS_DAYS = {0, 1, 2, 3, 4, 5}  # Monday=0 .. Saturday=5; Sunday excluded
BUSINESS_START_HOUR = 9
BUSINESS_END_HOUR = 19  # 7PM, exclusive

WARM_UP_DAYS = 5
WARM_UP_DAILY_CAP = 20
STEADY_DAILY_CAP = 150

# Kept as the English fallback/reference string (e.g. for a language-less
# caller) -- real sends go through services.screening_i18n.t("opt_in", lang, ...).
OPT_IN_TEMPLATE = t("opt_in", "en")


def is_business_hours(now: datetime | None = None) -> bool:
    now = now or datetime.now(IST)
    return now.weekday() in BUSINESS_DAYS and BUSINESS_START_HOUR <= now.hour < BUSINESS_END_HOUR


def _daily_cap(warm_up_started_at, today: date) -> int:
    if not warm_up_started_at:
        return WARM_UP_DAILY_CAP
    days_live = (today - warm_up_started_at.date()).days
    return WARM_UP_DAILY_CAP if days_live < WARM_UP_DAYS else STEADY_DAILY_CAP


async def dispatch_pending_screening_messages(conn, tenant_id: str) -> int:
    """One opt-in send per eligible recruiter WhatsApp account per call.
    The scheduler job re-runs every 2 minutes, so real pacing comes from
    next_eligible_send_at (set to now()+jitter after every send), not from
    this function trying to loop/sleep internally. Returns count sent."""
    if not is_business_hours():
        return 0

    today = datetime.now(IST).date()
    accounts = await conn.fetch(
        """SELECT id, waha_session_name, next_eligible_send_at,
                  warm_up_started_at, messages_sent_today, messages_sent_date
           FROM user_whatsapp_accounts
           WHERE tenant_id=$1 AND status='working' AND is_active=TRUE""",
        tenant_id)

    sent = 0
    now = datetime.now(IST)
    for acct in accounts:
        next_ok = acct["next_eligible_send_at"]
        if next_ok and next_ok > now:
            continue

        sent_today = acct["messages_sent_today"] if acct["messages_sent_date"] == today else 0
        if sent_today >= _daily_cap(acct["warm_up_started_at"], today):
            continue

        session = await conn.fetchrow(
            """SELECT s.id, s.language, c.full_name, c.phone, r.title, cl.name AS client_name,
                      u.full_name AS recruiter_name
               FROM screening_sessions s
               JOIN candidates c ON c.id = s.candidate_id
               JOIN requisitions r ON r.id = s.requisition_id
               LEFT JOIN clients cl ON cl.id = r.client_id
               JOIN user_whatsapp_accounts ua2 ON ua2.id = s.whatsapp_account_id
               JOIN users u ON u.id = ua2.user_id
               WHERE s.tenant_id=$1 AND s.whatsapp_account_id=$2 AND s.status='pending_optin'
               ORDER BY s.created_at ASC LIMIT 1""",
            tenant_id, acct["id"])
        if not session or not session["phone"]:
            continue

        text = t(
            "opt_in", session["language"] or "en",
            name=(session["full_name"] or "").split()[0] or "there",
            recruiter=session["recruiter_name"] or "our recruiting team",
            role=session["title"] or "this role",
            client=session["client_name"] or "our client",
        )
        delivered = await send_wa(session["phone"], text, session=acct["waha_session_name"])
        if not delivered:
            # Left as pending_optin -- retried next tick. See module
            # docstring for why this doesn't guess at bad_number.
            continue

        await conn.execute(
            """UPDATE screening_sessions
               SET status='sent', last_message_at=now(), updated_at=now()
               WHERE id=$1""",
            session["id"])

        jitter_minutes = random.randint(1, 3)
        await conn.execute(
            """UPDATE user_whatsapp_accounts
               SET next_eligible_send_at = now() + make_interval(mins => $1),
                   warm_up_started_at = COALESCE(warm_up_started_at, now()),
                   messages_sent_today = CASE WHEN messages_sent_date = $2 THEN messages_sent_today + 1 ELSE 1 END,
                   messages_sent_date = $2
               WHERE id=$3""",
            jitter_minutes, today, acct["id"])
        sent += 1
    return sent


async def compute_number_health(conn, tenant_id: str) -> None:
    """Decision #24: a declining reply-rate trend on a number is a real
    early-warning signal worth surfacing proactively, not just reacted to
    after it's already disconnected. Uses reply rate only, not true
    delivery-ack rate -- see this module's docstring for why no real
    delivery-ack signal exists in this codebase to compute that from."""
    accounts = await conn.fetch(
        "SELECT id FROM user_whatsapp_accounts WHERE tenant_id=$1 AND status='working'", tenant_id)
    for acct in accounts:
        recent = await conn.fetch(
            """SELECT status FROM screening_sessions
               WHERE whatsapp_account_id=$1 AND status != 'pending_optin'
               ORDER BY created_at DESC LIMIT 20""",
            acct["id"])
        total = len(recent)
        if total < 5:
            continue
        replied = sum(1 for r in recent if r["status"] not in ("sent", "no_response"))
        await conn.execute(
            "UPDATE user_whatsapp_accounts SET recent_reply_rate=$1 WHERE id=$2",
            round(replied / total, 3), acct["id"])


async def check_screening_reminders(conn, tenant_id: str) -> int:
    """Every 30 min, capped at 3 (90 min total) -- decision #4. Runs on a
    10-minute scheduler tick (see scheduler.py), well under the 30-minute
    cadence, so reminders stay prompt without needing exact-30-minute
    alignment. On the 3rd miss, status -> no_response."""
    if not is_business_hours():
        return 0

    due = await conn.fetch(
        """SELECT s.id, s.reminder_count, s.language, c.full_name, c.phone, ua.waha_session_name
           FROM screening_sessions s
           JOIN candidates c ON c.id = s.candidate_id
           JOIN user_whatsapp_accounts ua ON ua.id = s.whatsapp_account_id
           WHERE s.tenant_id=$1 AND s.status='sent'
             AND s.last_message_at < now() - interval '30 minutes'""",
        tenant_id)

    processed = 0
    for row in due:
        if row["reminder_count"] >= 3:
            await conn.execute(
                "UPDATE screening_sessions SET status='no_response', updated_at=now() WHERE id=$1",
                row["id"])
            processed += 1
            continue
        name = (row["full_name"] or "").split()[0] or "there"
        await send_wa(
            row["phone"],
            t("reminder", row["language"] or "en", name=name),
            session=row["waha_session_name"],
        )
        await conn.execute(
            """UPDATE screening_sessions
               SET reminder_count = reminder_count + 1, last_message_at = now(), updated_at = now()
               WHERE id=$1""",
            row["id"])
        processed += 1
    return processed
