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

from routers.whatsapp_bot import send_wa, send_wa_get_id
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


def normalize_phone_for_whatsapp(phone: str) -> str:
    """Confirmed live (2026-09-14): a real send to a candidate entered as
    a bare 10-digit number ("9738333493") returned delivered=False --
    WAHA's chatId needs a full number with country code
    (backend/routers/whatsapp.py's own SendRequest docstring: "E.164
    format, e.g. +919876543210"), and schemas.py's _validate_phone only
    checks digit COUNT (10-12), accepting a country-code-less number
    outright. The quick-add grid's "10-digit mobile" field invites
    exactly that. India-first product (CLAUDE.md) -- default a bare
    10-digit number to a +91 number rather than fail silently."""
    digits = "".join(ch for ch in (phone or "") if ch.isdigit())
    if len(digits) == 10:
        return "91" + digits
    return digits


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
                  warm_up_started_at, messages_sent_today, messages_sent_date, quality_rating
           FROM user_whatsapp_accounts
           WHERE tenant_id=$1 AND status='working' AND is_active=TRUE
             AND quality_rating != 'red'""",
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
        delivered, waha_msg_id = await send_wa_get_id(
            normalize_phone_for_whatsapp(session["phone"]), text, session=acct["waha_session_name"])
        if not delivered:
            # Left as pending_optin -- retried next tick. See module
            # docstring for why this doesn't guess at bad_number from a
            # failed send call itself (as opposed to a real message.ack
            # ERROR event afterward, now handled in routers/whatsapp_bot.py).
            continue

        await conn.execute(
            """UPDATE screening_sessions
               SET status='sent', last_message_at=now(), last_sent_waha_msg_id=$1, updated_at=now()
               WHERE id=$2""",
            waha_msg_id, session["id"])

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


def _classify_quality(reply_rate: float, optout_rate: float) -> str:
    """Shadow quality rating (WhatsApp automation research, 2026-09-14):
    mirrors Meta's own official Green/Yellow/Red quality-tier concept,
    computed from signals available without a real delivery-ack webhook
    (WAHA/WEBJS has none -- see module docstring). Opt-outs are weighted
    more heavily than silence: an explicit STOP is a much stronger
    negative signal than someone simply not replying."""
    if optout_rate > 0.20 or reply_rate < 0.10:
        return "red"
    if optout_rate > 0.10 or reply_rate < 0.25:
        return "yellow"
    return "green"


async def compute_number_health(conn, tenant_id: str) -> None:
    """Decision #24: a declining reply-rate trend on a number is a real
    early-warning signal worth surfacing proactively, not just reacted to
    after it's already disconnected. Uses reply/opt-out rate only, not
    true delivery-ack rate -- see this module's docstring for why no real
    delivery-ack signal exists in this codebase to compute that from.
    Also sets quality_rating -- dispatch_pending_screening_messages skips
    a 'red' account entirely, auto-pausing it before a real ban rather
    than only ever warning after the fact."""
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
        opted_out = sum(1 for r in recent if r["status"] == "opted_out")
        reply_rate = replied / total
        optout_rate = opted_out / total
        rating = _classify_quality(reply_rate, optout_rate)
        await conn.execute(
            """UPDATE user_whatsapp_accounts
               SET recent_reply_rate=$1, recent_optout_rate=$2, quality_rating=$3,
                   quality_rating_updated_at=now()
               WHERE id=$4""",
            round(reply_rate, 3), round(optout_rate, 3), rating, acct["id"])


async def create_reengagement_sessions(conn, tenant_id: str, cooldown_days: int = 30, limit: int = 20) -> int:
    """WhatsApp automation research (2026-09-15), gap #4: a candidate who
    went cold (declined or never replied) previously just sat there
    forever -- no consent is assumed to carry over here (DPDP), this
    creates a genuinely FRESH screening_sessions row (a brand-new opt-in
    solicitation, same as any other enrollment) only when a real, new open
    requisition now matches skills this candidate has already told us
    about. 'opted_out' (explicit STOP) and 'bad_number' are deliberately
    excluded -- both mean "do not contact again", not "went quiet"."""
    from routers.screening import enroll_candidate_for_screening, _default_add_stage
    from services.screening_matching import find_open_requisition_match

    stale = await conn.fetch(
        """SELECT DISTINCT ON (candidate_id) candidate_id, whatsapp_account_id, created_by, language
           FROM screening_sessions
           WHERE tenant_id=$1 AND status IN ('declined','no_response')
             AND updated_at < now() - make_interval(days => $2)
           ORDER BY candidate_id, created_at DESC
           LIMIT $3""",
        tenant_id, cooldown_days, limit)

    default_stage = await _default_add_stage(conn, tenant_id)
    created = 0
    for row in stale:
        match = await find_open_requisition_match(conn, tenant_id, str(row["candidate_id"]))
        if not match:
            continue
        try:
            async with conn.transaction():
                result = await enroll_candidate_for_screening(
                    conn, tenant_id, str(row["candidate_id"]), str(match["id"]), "re_engagement",
                    default_stage, str(row["whatsapp_account_id"]) if row["whatsapp_account_id"] else None,
                    row["created_by"], row["language"] or "en")
        except Exception:
            continue
        if result.get("status") == "enrolled":
            created += 1
    return created


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
            normalize_phone_for_whatsapp(row["phone"]),
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
