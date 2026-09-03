"""
Enterprise Email Management System — real threading, tracking, and
engagement-scoring engine, built 2026-09-03 to close the 11+ real gaps
found in the same-day audit against the "Enterprise Email Management,
Tracking & Reporting" spec.

Extends the existing candidate_messages/imap_messages tables rather than
building a parallel messaging system — matches this project's own
established "one shared engine, not two" discipline (Resume Generator,
KAE Review Queue, Reminders, etc.).

Business rule enforced here (unchanged, per explicit instruction): a
recruiter can email a candidate freely, and can email an internal AVIIN
user (KAE included) freely — but only a KAE, KAM, Manager, or Admin can
email a real client contact directly. The one existing, purpose-built
exception is the "Submit to Client" flow (kae_submission.py), which was
already correctly gated before this work and is untouched here.
"""
import re
import uuid
from datetime import datetime, timezone
from typing import Optional


CLIENT_EMAIL_ROLES = ("admin", "super_admin", "manager", "kae", "kam")


def normalize_subject(subject: Optional[str]) -> str:
    """Strips Re:/Fwd:/FW: prefixes (any count, any case) and collapses
    whitespace — the real signal used to group a conversation into one
    thread, matching how every mainstream mail client groups a thread."""
    if not subject:
        return ""
    s = subject.strip()
    while True:
        m = re.match(r"^(re|fw|fwd)\s*:\s*", s, re.I)
        if not m:
            break
        s = s[m.end():].strip()
    return re.sub(r"\s+", " ", s).lower()[:255]


def is_forward_subject(subject: Optional[str]) -> bool:
    return bool(subject) and bool(re.match(r"^\s*(fw|fwd)\s*:", subject, re.I))


def generate_message_id(domain: str = "ats.aviinjobs.com") -> str:
    """A real RFC822 Message-ID for an outbound send — needed so a later
    inbound reply's own In-Reply-To header can be correlated back to this
    exact message. Embedded in the actual SMTP send via the msg["Message-ID"]
    header (_send_email_bg in communications.py), not just stored — a
    Message-ID that's only ever in our own DB and never on the wire the
    recipient's mail server sees would never come back in a real reply."""
    return f"<{uuid.uuid4()}@{domain}>"


def extract_emails(*fields) -> set:
    """Splits any mix of comma/semicolon-separated address strings (to_email,
    cc, bcc — any of which may be None) into a flat, lowercased address set."""
    addrs = set()
    for f in fields:
        if not f:
            continue
        for a in re.split(r"[,;]", f):
            a = a.strip().lower()
            # Strip a "Name <addr>" wrapper if present — cc/bcc fields in
            # this codebase are usually bare addresses, but never assume.
            m = re.search(r"<([^>]+)>", a)
            if m:
                a = m.group(1).strip()
            if a and "@" in a:
                addrs.add(a)
    return addrs


async def resolve_client_contact_match(conn, tenant_id: str, *email_fields) -> Optional[dict]:
    """Checks whether any of the given recipient email strings match a real
    client_contacts row for this tenant. Returns the matched contact +
    client info if so, else None. This is the real, precise signal the RBAC
    gate below uses — matched against client_contacts.email specifically
    (the same table the SPOC/KAE-visibility mapping feature already
    established as the source of truth for "who is a client SPOC"), not a
    guessed domain match, to avoid false-positives against a legitimate
    non-SPOC contact at the same company domain."""
    addrs = extract_emails(*email_fields)
    if not addrs:
        return None
    row = await conn.fetchrow(
        """SELECT cc.id AS contact_id, cc.email, cc.contact_name,
                  cl.id AS client_id, cl.name AS client_name
           FROM client_contacts cc JOIN clients cl ON cl.id = cc.client_id
           WHERE cc.tenant_id=$1 AND lower(cc.email) = ANY($2::text[])
           LIMIT 1""",
        tenant_id, list(addrs),
    )
    return dict(row) if row else None


async def enforce_no_direct_client_email(conn, tenant_id: str, actor, *email_fields) -> None:
    """The real, non-bypassable enforcement of the stated business rule.
    Raises HTTPException(403) if the recipient set includes a real client
    contact AND the caller isn't a role explicitly allowed to email clients
    directly. actor.role is None (the trusted-internal/automation path) is
    exempt, matching this project's established convention — no legitimate
    trusted-internal caller currently exists for /communications/send
    (confirmed: automated stage-change emails go through a completely
    separate code path, _notify_stage_change_bg in applications.py, never
    through this endpoint), so this exemption costs nothing today and
    avoids surprising a future one."""
    from fastapi import HTTPException
    if actor.role is None or actor.role in CLIENT_EMAIL_ROLES:
        return
    match = await resolve_client_contact_match(conn, tenant_id, *email_fields)
    if match:
        raise HTTPException(
            403,
            f"Only a KAE, KAM, Manager, or Admin can email a client contact "
            f"directly ({match['contact_name']} at {match['client_name']}). "
            f"Use \"Submit to Client\" on the pipeline board, or ask your "
            f"KAE to send this on your behalf."
        )


async def resolve_or_create_thread(conn, tenant_id: str, *, candidate_id=None, client_id=None,
                                    client_contact_id=None, subject: Optional[str],
                                    created_by=None, direction: str = "outbound"):
    """Finds an existing thread for this candidate/client + normalized
    subject, or creates one. One thread per (candidate_id OR client_id) +
    subject_key — matches how a real "Resume Discussion"/"Interview
    Discussion"/"Offer Discussion" conversation naturally stays connected
    across replies, even though the underlying rows live in candidate_
    messages (ATS-sent) and imap_messages (raw inbound sync) separately.
    A free-form to_email with no candidate/client link has no thread
    concept — returns None, exactly like today's un-threaded behavior."""
    if not candidate_id and not client_id:
        return None
    subject_key = normalize_subject(subject)
    scope_col = "candidate_id" if candidate_id else "client_id"
    scope_val = candidate_id or client_id
    existing = await conn.fetchrow(
        f"""SELECT id FROM email_threads
            WHERE tenant_id=$1 AND {scope_col}=$2 AND subject_key=$3
            ORDER BY last_activity_at DESC LIMIT 1""",
        tenant_id, scope_val, subject_key,
    )
    if existing:
        return existing["id"]
    thread_type = "client" if client_id else "candidate"
    row = await conn.fetchrow(
        """INSERT INTO email_threads
             (tenant_id, candidate_id, client_id, client_contact_id, thread_type,
              subject, subject_key, created_by, last_direction)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING id""",
        tenant_id, candidate_id, client_id, client_contact_id, thread_type,
        subject or "(no subject)", subject_key, created_by, direction,
    )
    return row["id"]


async def bump_thread_activity(conn, thread_id, direction: str) -> None:
    """REAL BUG FIX (2026-09-03, caught live via genuine testing, not code
    review): the original query reused $2 both as a raw SET assignment
    (last_direction = $2, inferred as the column's own character varying
    type) AND inside a CASE comparison ($2='inbound', which Postgres
    infers as plain text from the bare string literal) — the exact
    "AmbiguousParameterError: inconsistent types deduced for parameter"
    bug class already documented and fixed at least twice before in this
    project (retention_bank's INSERT, incentives' bank release/forfeit
    endpoint) for the identical reason. Fixed the same way those were:
    resolve the CASE outcome in Python before it ever reaches the query,
    since `direction` is already a plain, trusted Python string here, not
    user input needing a real SQL comparison."""
    if not thread_id:
        return
    reply_increment = 1 if direction == "inbound" else 0
    await conn.execute(
        """UPDATE email_threads
           SET last_activity_at = now(), last_direction = $2,
               message_count = message_count + 1,
               reply_count = reply_count + $3
           WHERE id = $1""",
        thread_id, direction, reply_increment,
    )


async def resolve_user_signature_html(conn, tenant_id: str, user_id: str) -> Optional[str]:
    """REAL FIX (2026-09-04, reported live: "the email signature is not
    working and is not being displayed in emails sent to any email
    address... Please investigate why the email signature is not being
    automatically appended to outgoing emails"). The real signature system
    (user_signatures + user_email_accounts.sig_new_mail/sig_reply) has
    always been fully real and correctly configured — the gap was that it
    was never wired into anything server-side: the general Compose tool
    only ever applies it client-side (fetches /signatures/for-account/{id}
    and inserts it into the body BEFORE the send request is made — already
    correctly working, confirmed by reading the actual frontend code, not
    touched here), which has no equivalent for a fully automated,
    server-generated email like Submit-to-KAE/Submit-to-Client, which never
    goes through the Compose box at all.

    Resolves the "new mail" signature (kae_submission.py's sends are a
    genuinely new outbound message, not a reply — matching the exact real
    "NEW MAIL" vs "REPLIES & FORWARDS" distinction a user configures in
    Settings) for this user's own connected mailbox. A user can have more
    than one connected account — prioritizes is_active, then is_default,
    then most-recently-added, so a user with exactly one account (the
    overwhelming common case) always resolves correctly regardless of
    whether they ever explicitly flagged it default. Returns None — never
    an empty string — when the user has no connected account with a real
    signature assigned, so a caller can cleanly skip appending anything
    rather than injecting a blank block."""
    if not user_id:
        return None
    row = await conn.fetchrow(
        """SELECT s.html
           FROM user_email_accounts a
           JOIN user_signatures s ON s.id = a.sig_new_mail
           WHERE a.tenant_id=$1 AND a.user_id=$2
           ORDER BY a.is_active DESC, a.is_default DESC, a.created_at DESC NULLS LAST
           LIMIT 1""",
        tenant_id, user_id,
    )
    html = row["html"] if row else None
    return html.strip() if html and html.strip() else None


# ── Engagement scoring ───────────────────────────────────────────────────────

def _score_level(score: float) -> str:
    if score >= 70:
        return "high"
    if score >= 40:
        return "medium"
    if score > 0:
        return "low"
    return "inactive"


async def compute_client_engagement_scores(conn, tenant_id: str, period_start, period_end):
    """Zero-token rule engine (no AI call), matching the exact real,
    already-proven shape of compute_health_scores() in p36_p42.py (a
    DIFFERENT, revenue/collections-based score — this one is purely
    email-behavior-based: opens, replies, attachment downloads, response
    time). Scores every real client that has at least one real email in
    the period, real clients only — a client no one has ever emailed
    correctly gets no row at all rather than a fabricated zero."""
    clients = await conn.fetch(
        """SELECT DISTINCT cm.client_id, cl.name AS client_name
           FROM candidate_messages cm JOIN clients cl ON cl.id = cm.client_id
           WHERE cm.tenant_id=$1 AND cm.client_id IS NOT NULL AND cm.channel='email'
             AND cm.is_deleted IS NOT TRUE
             AND cm.created_at::date BETWEEN $2 AND $3""",
        tenant_id, period_start, period_end,
    )
    results = []
    for row in clients:
        cid = row["client_id"]
        stats = await conn.fetchrow(
            """SELECT
                   COUNT(*) FILTER (WHERE direction='outbound') AS sent,
                   COUNT(*) FILTER (WHERE direction='outbound' AND email_open_count > 0) AS opened,
                   COUNT(*) FILTER (WHERE direction='outbound' AND replied_at IS NOT NULL) AS replied,
                   COALESCE(SUM(attachment_download_count), 0) AS downloads,
                   AVG(EXTRACT(EPOCH FROM (replied_at - created_at)) / 3600)
                       FILTER (WHERE replied_at IS NOT NULL) AS avg_resp_hrs
               FROM candidate_messages
               WHERE tenant_id=$1 AND client_id=$2 AND channel='email' AND is_deleted IS NOT TRUE
                 AND created_at::date BETWEEN $3 AND $4""",
            tenant_id, cid, period_start, period_end,
        )
        sent = stats["sent"] or 0
        opened = stats["opened"] or 0
        replied = stats["replied"] or 0
        downloads = int(stats["downloads"] or 0)
        avg_resp = float(stats["avg_resp_hrs"]) if stats["avg_resp_hrs"] is not None else None
        open_rate = round((opened / sent) * 100, 1) if sent else 0.0
        reply_rate = round((replied / sent) * 100, 1) if sent else 0.0
        # 40% reply rate + 25% open rate + 20% attachment engagement (capped)
        # + 15% response speed (faster = higher, honest zero when no reply ever).
        speed_score = 0.0
        if avg_resp is not None:
            speed_score = max(0.0, 100.0 - min(avg_resp, 100.0))
        download_score = min(100.0, downloads * 20.0)
        score = round(
            reply_rate * 0.40 + open_rate * 0.25 + download_score * 0.20 + speed_score * 0.15, 2
        )
        level = _score_level(score)
        await conn.execute(
            """INSERT INTO client_engagement_scores
                 (tenant_id, client_id, period_start, period_end, emails_sent, emails_opened,
                  emails_replied, attachments_downloaded, avg_response_hours, open_rate,
                  reply_rate, engagement_score, engagement_level)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
               ON CONFLICT (tenant_id, client_id, period_start, period_end) DO UPDATE SET
                 emails_sent=EXCLUDED.emails_sent, emails_opened=EXCLUDED.emails_opened,
                 emails_replied=EXCLUDED.emails_replied,
                 attachments_downloaded=EXCLUDED.attachments_downloaded,
                 avg_response_hours=EXCLUDED.avg_response_hours, open_rate=EXCLUDED.open_rate,
                 reply_rate=EXCLUDED.reply_rate, engagement_score=EXCLUDED.engagement_score,
                 engagement_level=EXCLUDED.engagement_level, computed_at=now()""",
            tenant_id, cid, period_start, period_end, sent, opened, replied, downloads,
            avg_resp, open_rate, reply_rate, score, level,
        )
        results.append({
            "client_id": str(cid), "client_name": row["client_name"],
            "engagement_score": score, "engagement_level": level,
            "emails_sent": sent, "open_rate": open_rate, "reply_rate": reply_rate,
        })
    return sorted(results, key=lambda x: -x["engagement_score"])
