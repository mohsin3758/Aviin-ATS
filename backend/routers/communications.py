"""Phase R2 - Communication Hub (webmail v3 - full featured)"""
import os, smtplib, threading, base64, re, urllib.parse
from datetime import date, datetime, timedelta, timezone
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional, List
import json
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
import httpx
import db
from services import candidate_ownership as ownership
from services import email_tracking
from deps import Actor, get_actor
from routers.whatsapp import _ensure_consent

router = APIRouter(prefix="/communications", tags=["communications"])
# Public (no auth) — the recipient's own email client fetches this, not the
# ATS. tracking_token (a random uuid, not the message id) is the security
# boundary, same pattern as the anonymous NDA/offer sign links.
tracking_router = APIRouter(tags=["email-tracking"])
WAHA_BASE = os.getenv("WAHA_URL", "http://waha:3000")
WAHA_KEY = os.getenv("WAHA_API_KEY", "aviinATS2026secure")
WAHA_SESSION = "default"

_PIXEL_GIF = base64.b64decode("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==")


@tracking_router.get("/track/open/{token}.gif")
async def track_email_open(token: str):
    # candidate_messages now has FORCE ROW LEVEL SECURITY (sql/38...sql) —
    # this anonymous, tenant-unaware caller can no longer UPDATE it
    # directly through system_conn() (app.tenant_id=''), same class of fix
    # as the NDA/offer-signing/device-enrollment token flows: a
    # SECURITY DEFINER function owned by postgres bypasses RLS for this
    # one specific, token-scoped write.
    try:
        async with db.system_conn() as conn:
            await conn.execute("SELECT record_email_open($1)", token)
    except Exception as ex:
        print(f"Email open tracking error: {ex}")
    return Response(content=_PIXEL_GIF, media_type="image/gif",
                     headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"})


# Real link-click + resume-download tracking (2026-09-03 audit, gap #3:
# "Link Clicked"/"Attachment Downloaded"/"Resume Downloaded" — all 3 were
# completely untracked before this). Every real <a href> in an outbound
# HTML email is rewritten (see _wrap_links_for_tracking below) to route
# through this one public, anonymous, token-scoped redirect first, then
# forwards on to the real destination — same "token is the security
# boundary" pattern as the open-tracking pixel right above it. A link
# whose target matches this app's own real resume/document-download
# endpoints also counts as a genuine "attachment downloaded" event, not
# just a click — the honest, real way to track that signal, since a raw
# MIME email attachment downloaded in the recipient's OWN mail client is
# fundamentally invisible to this backend; a real ATS-hosted download
# LINK is the one case that's genuinely trackable.
_RESUME_DOWNLOAD_PATTERNS = ("/resume-intake/", "/candidates/", "/resume-generator/")


@tracking_router.get("/track/click/{token}")
async def track_link_click(token: str, url: str = Query(...)):
    # REAL BUG FIX (2026-09-03, caught via genuine live testing, not code
    # review): the original version ran a raw UPDATE against
    # candidate_messages through db.system_conn() — candidate_messages has
    # FORCE ROW LEVEL SECURITY, and system_conn() deliberately sets
    # app.tenant_id='' for this genuinely anonymous, tenant-unaware caller
    # (the recipient's own email client clicking a link, exactly like the
    # open-tracking pixel right above). Casting '' to ::uuid raises a hard
    # Postgres error — the exact class already documented dozens of times
    # in this project — silently swallowed by the old broad try/except, so
    # every click/download was tracked as "successful" (the real 302
    # redirect always fired) while genuinely writing nothing. Confirmed
    # live before fixing: link_click_count stayed 0 despite a real,
    # successful-looking redirect. Fixed with a real SECURITY DEFINER SQL
    # function (record_link_click, sql/109) — matches the exact pattern
    # already established for record_email_open right above it — that
    # runs the whole update+thread-bump+notification atomically with
    # postgres's own RLS-bypassing privileges, not 3 separate RLS-unsafe
    # writes from this anonymous connection.
    try:
        async with db.system_conn() as conn:
            await conn.fetchrow(
                "SELECT * FROM record_link_click($1, $2)",
                token, any(p in url for p in _RESUME_DOWNLOAD_PATTERNS),
            )
    except Exception as ex:
        print(f"Link click tracking error: {ex}")
    return RedirectResponse(url=url, status_code=302)


def _wrap_links_for_tracking(html: str, tracking_token) -> str:
    """Rewrites every real <a href="http(s)://..."> in an outbound HTML
    email to route through the click-tracking redirect above. Only
    touches real absolute http(s) links (never mailto:/tel:/anchor
    fragments, which have nothing meaningful to "click-track")."""
    if not tracking_token or not html:
        return html
    def _sub(m):
        original = m.group(2)
        if not original.lower().startswith(("http://", "https://")):
            return m.group(0)
        wrapped = f"{PUBLIC_BASE_URL}/track/click/{tracking_token}?url={urllib.parse.quote(original, safe='')}"
        return f'{m.group(1)}{wrapped}{m.group(3)}'
    return re.sub(r'(<a\s[^>]*href=")([^"]+)(")', _sub, html, flags=re.I)


MSG_COLS = """cm.id, cm.candidate_id,
    COALESCE(c.full_name, cm.to_email, 'External') AS candidate_name,
    COALESCE(c.email, cm.to_email) AS email, c.phone,
    cm.channel, cm.direction, cm.subject, cm.body, cm.status,
    cm.stage_at_send, cm.created_at, cm.deleted_at,
    cm.is_read, cm.is_starred, cm.to_email, cm.cc,
    cm.email_opened_at, cm.email_open_count, cm.tracking_token,
    u.full_name AS sent_by_name"""

MSG_JOINS = """FROM candidate_messages cm
    LEFT JOIN candidates c ON c.id=cm.candidate_id
    LEFT JOIN users u ON u.id=cm.sent_by"""

# Real gap fix (2026-08-27): a real KAE with zero candidates assigned/owned
# and zero messages of her own was seeing the ENTIRE tenant's outbound
# ATS-sent history in her "Inbox"/"Sent" — every stage-change email any
# recruiter ever sent to any candidate, not her own. The inbound-IMAP half
# of these same endpoints already correctly scopes non-admin roles to
# their own connected mail account (ua.user_id=$N) — this outbound half
# never got the same treatment. admin/super_admin/lead_recruiter/manager
# keep full tenant-wide visibility, matching /imap-messages' own existing
# is_admin convention exactly.
_INBOX_ADMIN_ROLES = ("admin", "super_admin", "lead_recruiter", "manager")


def _own_ats_message_filter(user_param_idx: int) -> str:
    """SQL fragment restricting candidate_messages to ones this actor
    either personally sent, or that belong to a candidate whose current
    application is assigned to them, or a candidate they actively own
    (candidate_ownership) — "my mailbox," not the whole tenant's."""
    u = f"${user_param_idx}"
    return f"""(
        cm.sent_by = {u}
        OR EXISTS (SELECT 1 FROM applications a WHERE a.id = cm.application_id AND a.assigned_recruiter_id = {u})
        OR EXISTS (SELECT 1 FROM candidate_ownership co WHERE co.candidate_id = cm.candidate_id AND co.recruiter_id = {u} AND co.status = 'active')
    )"""


async def _assert_imap_writable(conn, msg_id: str, actor) -> None:
    """Real IDOR-class gap fix (2026-08-31): the IMAP write endpoints
    (read/star/trash/snooze/archive/move) only ever checked tenant_id -
    any authenticated tenant user who knew/guessed another user's private
    IMAP message UUID could mark it read, star/trash/archive/move it, even
    though every read-side endpoint in this file (get_imap_messages,
    search_emails, archive_list, junk_list) already correctly scopes a
    non-admin to their own connected mailbox via user_email_accounts.
    user_id. Flagged but explicitly left unfixed on 2026-08-30 when that
    read-side scoping was built ("a lower-severity IDOR-class gap...not
    touched here"); closed now. Same admin-role exemption as every read
    endpoint in this file (_INBOX_ADMIN_ROLES), plus the standard
    actor.role is None exemption for the trusted-internal/automation path
    used throughout this project. Raises a clean 404 (not 403) so this can
    never confirm a guessed UUID's existence to an unauthorized caller."""
    if actor.role in _INBOX_ADMIN_ROLES or actor.role is None:
        row = await conn.fetchrow(
            "SELECT id FROM imap_messages WHERE id=$1 AND tenant_id=$2", msg_id, actor.tenant_id)
    else:
        row = await conn.fetchrow(
            """SELECT im.id FROM imap_messages im
               JOIN user_email_accounts ua ON ua.id = im.account_id
               WHERE im.id=$1 AND im.tenant_id=$2 AND ua.user_id=$3""",
            msg_id, actor.tenant_id, actor.user_id)
    if not row:
        raise HTTPException(404, "Message not found")


async def _get_smtp(conn, tenant_id: str):
    return await conn.fetchrow(
        "SELECT smtp_host,smtp_port,smtp_user,smtp_password,smtp_from,smtp_from_name,smtp_tls "
        "FROM email_settings WHERE tenant_id=$1 AND is_active=TRUE LIMIT 1", tenant_id)


def _send_email_bg(smtp, to_email, subject, body_html, cc=None, bcc=None, message_id_header=None):
    def go():
        try:
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject or "(no subject)"
            msg["From"] = f"{smtp['smtp_from_name']} <{smtp['smtp_from']}>"
            msg["To"] = to_email
            if message_id_header:
                # Real threading (2026-09-03 audit, gap #2): this Message-ID
                # is what lets a later inbound reply's own In-Reply-To
                # header correlate back to this exact sent message — set on
                # the actual wire, not just stored in our own DB, since a
                # self-generated id nobody's mail server ever saw would
                # never come back in a real reply.
                msg["Message-ID"] = message_id_header
            if cc: msg["Cc"] = cc if isinstance(cc,str) else ", ".join(cc)
            rcpts = [to_email]
            if cc: rcpts += ([cc] if isinstance(cc,str) else cc)
            if bcc: rcpts += ([bcc] if isinstance(bcc,str) else bcc)
            if "<" in (body_html or "") and ">" in (body_html or ""):
                msg.attach(MIMEText(body_html, "html"))
            else:
                msg.attach(MIMEText(body_html or "", "plain"))
            with smtplib.SMTP(smtp["smtp_host"], smtp["smtp_port"] or 587, timeout=10) as s:
                s.ehlo()
                if smtp["smtp_tls"] and (smtp["smtp_port"] or 587) == 587:
                    s.starttls(); s.ehlo()
                if smtp["smtp_user"]:
                    s.login(smtp["smtp_user"], smtp["smtp_password"])
                s.sendmail(smtp["smtp_from"], rcpts, msg.as_string())
            print(f"Email sent to {to_email}")
        except Exception as ex:
            print(f"Email error: {ex}")
    threading.Thread(target=go, daemon=True).start()


async def _send_wa(phone: str, message: str, session: str = WAHA_SESSION) -> bool:
    """Real per-user WhatsApp numbers (2026-08-27): callers resolve
    session via routers.whatsapp.resolve_send_session() (the actor's own
    connected personal WAHA session, if any) before calling this -
    defaults to the shared company session, unchanged, when they don't
    have one or don't pass it (e.g. bulk-send, still shared by design)."""
    p = phone.strip().replace(" ","").replace("-","")
    if not p.startswith("+"): p = "+91" + p.lstrip("0")[-10:]
    chat_id = p.lstrip("+") + "@c.us"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(f"{WAHA_BASE}/api/sendText",
                headers={"X-Api-Key": WAHA_KEY, "Content-Type": "application/json"},
                json={"session": session, "chatId": chat_id, "text": message})
            return r.status_code < 400
    except Exception as ex:
        print(f"WhatsApp error: {ex}"); return False


async def _log(conn, tenant_id, cand_id, app_id, channel, subject, body, status,
               sent_by, tmpl_id=None, stage=None, to_email=None, cc=None,
               client_id=None, client_contact_id=None, recipient_type=None,
               message_id_header_override=None):
    """Returns {id, tracking_token, message_id_header, thread_id} on success
    so callers can embed an open-tracking pixel / link-tracking wrap keyed
    to this specific message, or None on failure.

    Real threading + client-linkage (2026-09-03 audit, gaps #2/#4): every
    real email send now resolves-or-creates an email_threads row (grouping
    "Resume Discussion"/"Interview Discussion"/"Offer Discussion" replies
    into one real conversation) and gets a genuine RFC822 Message-ID
    embedded on the wire — the two building blocks reply-detection in
    imap_bg.py correlates a later inbound reply back against.

    message_id_header_override: a real Message-ID a caller ALREADY embedded
    on the outgoing SMTP message itself before calling this function (e.g.
    kae_submission.py's Submit-to-KAE/Submit-to-Client sends, which build
    and send their own MIME message before this logging call happens) —
    generating a fresh one here instead would silently desync the DB's own
    record from what the recipient's mail server actually saw, breaking
    reply correlation for that message. Every other, pre-existing caller
    passes nothing and keeps the original self-generated behavior."""
    message_id_header = message_id_header_override or (email_tracking.generate_message_id() if channel == "email" else None)
    thread_id = None
    if channel == "email" and status == "sent":
        try:
            thread_id = await email_tracking.resolve_or_create_thread(
                conn, tenant_id, candidate_id=cand_id, client_id=client_id,
                client_contact_id=client_contact_id, subject=subject,
                created_by=sent_by, direction="outbound",
            )
        except Exception as ex:
            print(f"Thread resolve error: {ex}")
    try:
        row = await conn.fetchrow(
            """INSERT INTO candidate_messages
               (tenant_id,candidate_id,application_id,channel,direction,subject,body,
                status,sent_by,template_id,stage_at_send,is_read,to_email,cc,
                message_id_header,thread_id,client_id,client_contact_id,recipient_type,
                last_activity_at)
               VALUES($1,$2,$3,$4,'outbound',$5,$6,$7,$8,$9,$10,TRUE,$11,$12,
                      $13,$14,$15,$16,$17,now())
               RETURNING id, tracking_token, message_id_header, thread_id""",
            tenant_id, cand_id, app_id, channel, subject, body, status,
            sent_by, tmpl_id, stage, to_email, cc,
            message_id_header, thread_id, client_id, client_contact_id,
            recipient_type or ("client" if client_id else "candidate" if cand_id else "other"))
        if thread_id and status == "sent":
            await email_tracking.bump_thread_activity(conn, thread_id, "outbound")
        if tmpl_id and status == "sent":
            # sent_count was a fully dead column (2026-08-10 audit) — no
            # code anywhere incremented it, so every template showed 0 uses
            # regardless of real traffic. This is the single choke point
            # every send path (email/whatsapp, single/bulk) already
            # funnels through.
            await conn.execute(
                "UPDATE email_templates SET sent_count = sent_count + 1 WHERE id=$1 AND tenant_id=$2",
                tmpl_id, tenant_id,
            )
        # BUG FIX (2026-08-10 audit): email_sent/whatsapp_sent are defined
        # candidate_activities types that nothing ever wrote — a candidate
        # could receive real messages with zero trace on their own Activity
        # Timeline. This is the single choke point every send path
        # (single/bulk, email/whatsapp) already funnels through.
        if cand_id and status == "sent" and channel in ("email", "whatsapp"):
            await conn.execute(
                """INSERT INTO candidate_activities
                   (tenant_id,candidate_id,user_id,activity_type,title,description)
                   VALUES ($1,$2,$3,$4,$5,$6)""",
                tenant_id, cand_id, sent_by, f"{channel}_sent",
                subject or (f"{channel.title()} message sent"),
                (body or "")[:280],
            )
        return dict(row) if row else None
    except Exception as ex:
        print(f"Log error: {ex}")
        return None


async def _resolve_template_vars(conn, tenant_id: str, candidate_id: Optional[str] = None,
                                  application_id: Optional[str] = None) -> dict:
    """Resolves real values for every placeholder the 6 real email_templates
    rows actually contain (checked directly against production, 2026-08-10
    audit): {candidate_name}/{name}/{first_name}, {role}, {client_name},
    {company} (the agency's own name — distinct from client_name, appears
    in template footers), {recruiter_name}, {recruiter_phone}, {ctc},
    {date}/{time}/{mode}/{meeting_link}/{interviewer_name} (from the
    candidate's nearest upcoming interview), {joining_date} (from a real
    offer if one exists), {location} (the requisition's). Best-effort:
    any field with no real source (e.g. no linked requisition, no offer
    yet) resolves to an empty string rather than leaving the literal
    placeholder in a message a candidate actually receives — this
    includes {deadline}/{hr_contact}/{hr_phone}, which have no source
    anywhere in the schema at all.
    """
    tenant = await conn.fetchrow("SELECT name FROM tenants WHERE id=$1", tenant_id)
    company = (tenant["name"] if tenant else None) or "AVIIN Jobs Services"

    row = None
    if application_id:
        row = await conn.fetchrow(
            """SELECT c.full_name, c.expected_ctc,
                      r.title AS role, r.location, cl.name AS client_name,
                      u.full_name AS recruiter_name, u.phone AS recruiter_phone,
                      i.scheduled_at AS interview_at, i.mode, i.meeting_link,
                      iu.full_name AS interviewer_name,
                      o.joining_date
               FROM applications a
               JOIN candidates c ON c.id = a.candidate_id
               LEFT JOIN requisitions r ON r.id = a.requisition_id
               LEFT JOIN clients cl ON cl.id = r.client_id
               LEFT JOIN users u ON u.id = a.assigned_recruiter_id
               LEFT JOIN interview_schedules i ON i.application_id = a.id
                 AND i.status = 'scheduled' AND i.scheduled_at >= now()
               LEFT JOIN users iu ON iu.id = i.interviewer_id
               LEFT JOIN offers o ON o.application_id = a.id
               WHERE a.id = $1 AND a.tenant_id = $2
               ORDER BY i.scheduled_at ASC, o.created_at DESC LIMIT 1""",
            application_id, tenant_id,
        )
    if not row and candidate_id:
        row = await conn.fetchrow(
            """SELECT c.full_name, c.expected_ctc, NULL AS role, c.location,
                      NULL AS client_name, NULL AS recruiter_name, NULL AS recruiter_phone,
                      NULL AS interview_at, NULL AS mode, NULL AS meeting_link,
                      NULL AS interviewer_name, NULL AS joining_date
               FROM candidates c WHERE c.id = $1 AND c.tenant_id = $2""",
            candidate_id, tenant_id,
        )
    full_name = (row["full_name"] if row else None) or "there"
    first_name = full_name.split(" ")[0] if full_name else "there"
    interview_at = row["interview_at"] if row else None
    joining_date = row["joining_date"] if row else None
    ctc = row["expected_ctc"] if row else None
    return {
        "name": full_name, "first_name": first_name, "candidate_name": full_name,
        "company": company,
        "role": (row["role"] if row else None) or "",
        "client_name": (row["client_name"] if row else None) or "",
        "location": (row["location"] if row else None) or "",
        "recruiter_name": (row["recruiter_name"] if row else None) or "",
        "recruiter_phone": (row["recruiter_phone"] if row else None) or "",
        "interviewer_name": (row["interviewer_name"] if row else None) or "",
        "mode": ((row["mode"] if row else None) or "").replace("_", " ").title(),
        "meeting_link": (row["meeting_link"] if row else None) or "",
        "ctc": (f"{float(ctc):,.0f}" if ctc else ""),
        "date": interview_at.strftime("%d %b %Y") if interview_at else "",
        "time": interview_at.strftime("%I:%M %p") if interview_at else "",
        "joining_date": joining_date.strftime("%d %b %Y") if joining_date else "",
        "deadline": "", "hr_contact": "", "hr_phone": "",
    }


PUBLIC_BASE_URL = os.environ.get("PUBLIC_BASE_URL", "https://ats.aviinjobs.com")


def _with_tracking_pixel(body_text: str, tracking_token) -> str:
    """Wraps a message body as HTML with an invisible 1x1 open-tracking
    pixel — only for candidate-facing email, never for the plain-text copy
    stored in candidate_messages.body (that stays the clean original)."""
    if not tracking_token:
        return body_text or ""
    pixel_url = f"{PUBLIC_BASE_URL}/track/open/{tracking_token}.gif"
    pixel_tag = f'<img src="{pixel_url}" width="1" height="1" style="display:none" alt="" />'
    if "<" in (body_text or "") and ">" in (body_text or ""):
        return (body_text or "") + pixel_tag
    import html as _html
    escaped = _html.escape(body_text or "").replace("\n", "<br>")
    return f'<html><body style="font-family:sans-serif;font-size:14px;color:#1e293b;white-space:normal;">{escaped}{pixel_tag}</body></html>'


# ── Models ─────────────────────────────────────────────────────────────────────

class SendMsg(BaseModel):
    candidate_id: Optional[str] = None
    to_email: Optional[str] = None      # free-form email recipient
    to_name: Optional[str] = None
    channel: str = "email"
    subject: Optional[str] = None
    message: str
    cc: Optional[str] = None
    bcc: Optional[str] = None
    application_id: Optional[str] = None
    template_id: Optional[str] = None
    stage: Optional[str] = None

class BulkMsg(BaseModel):
    requisition_id: Optional[str] = None
    stage: Optional[str] = None
    candidate_ids: Optional[List[str]] = None
    channel: str = "email"
    subject: Optional[str] = None
    message: str
    template_id: Optional[str] = None

class DraftBody(BaseModel):
    candidate_id: Optional[str] = None
    to_email: Optional[str] = None
    to_name: Optional[str] = None
    channel: str = "email"
    subject: Optional[str] = None
    body: str = ""
    cc: Optional[str] = None


# ── Folder endpoints ───────────────────────────────────────────────────────────

@router.get("/inbox")
async def inbox(limit: int = Query(50, le=500), offset: int = Query(0), channel: Optional[str] = None,
                actor: Actor = Depends(get_actor)):
    is_admin = actor.role in _INBOX_ADMIN_ROLES
    async with db.tenant_conn(actor.tenant_id) as conn:
        # ---- Outbound ATS messages ----
        w = "WHERE cm.tenant_id=$1 AND cm.is_deleted IS NOT TRUE"
        p = [actor.tenant_id]
        if channel and channel not in ('imap', 'inbound'):
            p.append(channel); w += f" AND cm.channel=${len(p)}"
        if not is_admin:
            p.append(actor.user_id)
            w += f" AND {_own_ats_message_filter(len(p))}"
        p.append(limit)
        outbound = await conn.fetch(f"""
            SELECT DISTINCT ON (COALESCE(cm.candidate_id::text, cm.to_email))
                {MSG_COLS},
                (SELECT COUNT(*) FROM candidate_messages cm2
                 WHERE cm2.tenant_id=cm.tenant_id
                 AND COALESCE(cm2.candidate_id::text,cm2.to_email)=COALESCE(cm.candidate_id::text,cm.to_email)
                 AND cm2.is_deleted IS NOT TRUE) AS msg_count,
                (SELECT COUNT(*) FROM candidate_messages cm3
                 WHERE cm3.tenant_id=cm.tenant_id
                 AND COALESCE(cm3.candidate_id::text,cm3.to_email)=COALESCE(cm.candidate_id::text,cm.to_email)
                 AND cm3.is_deleted IS NOT TRUE AND cm3.is_read IS NOT TRUE) AS unread_count
            {MSG_JOINS}
            {w}
            ORDER BY COALESCE(cm.candidate_id::text, cm.to_email), cm.created_at DESC
            LIMIT ${len(p)}""", *p)

        # ---- Inbound IMAP messages ----
        imap_rows = []
        if not channel or channel in ('email', 'imap', 'inbound'):
            imap_rows = await conn.fetch("""
                SELECT
                    im.id,
                    im.candidate_id,
                    COALESCE(NULLIF(im.from_name,''), NULLIF(im.from_email,''), 'Unknown Sender') AS candidate_name,
                    im.from_email AS email,
                    im.folder AS imap_folder,
                    im.imap_uid AS imap_uid,
                    NULL::text AS phone,
                    'email'::text AS channel,
                    'inbound'::text AS direction,
                    COALESCE(im.subject, '(no subject)') AS subject,
                    COALESCE(im.html_body, im.body, '') AS body,
                    'received'::text AS status,
                    im.received_at AS created_at,
                    NULL::text AS deleted_at,
                    ua.display_name AS sent_by_name,
                    im.is_read,
                    im.is_starred,
                    im.to_email,
                    im.cc,
                    1::bigint AS msg_count,
                    (CASE WHEN im.is_read THEN 0 ELSE 1 END)::bigint AS unread_count,
                    im.snoozed_until,
                    CASE 
                        WHEN im.attachments IS NOT NULL AND jsonb_array_length(im.attachments) > 0
                        THEN (SELECT jsonb_agg(jsonb_build_object('filename', a->>'filename', 'mime_type', a->>'mime_type', 'size', (a->>'size')::int))
                              FROM jsonb_array_elements(im.attachments) a)
                        ELSE '[]'::jsonb
                    END AS attachments
                FROM imap_messages im
                JOIN user_email_accounts ua ON ua.id = im.account_id
                WHERE im.tenant_id = $1 AND ua.user_id = $2
                  AND im.is_deleted IS NOT TRUE
                  AND im.folder = 'INBOX'
                ORDER BY im.received_at DESC
                LIMIT $3 OFFSET $4
            """, actor.tenant_id, actor.user_id, limit, offset)

        all_msgs = [dict(r) for r in outbound] + [dict(r) for r in imap_rows]
        # Parse JSONB attachments field (asyncpg returns as string)
        for m in all_msgs:
            if 'attachments' in m and isinstance(m['attachments'], str):
                try:
                    m['attachments'] = json.loads(m['attachments'])
                except Exception:
                    m['attachments'] = []
        all_msgs.sort(key=lambda x: str(x.get('created_at') or ''), reverse=True)
        return all_msgs[:limit]


@router.get("/thread/{cand_id}")
async def get_thread(cand_id: str, actor: Actor = Depends(get_actor)):
    """All messages for a candidate thread"""
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(f"""
            SELECT {MSG_COLS} {MSG_JOINS}
            WHERE cm.candidate_id=$1 AND cm.tenant_id=$2 AND cm.is_deleted IS NOT TRUE
            ORDER BY cm.created_at ASC""", cand_id, actor.tenant_id)
        cand = await conn.fetchrow(
            "SELECT full_name,email,phone FROM candidates WHERE id=$1", cand_id)
        # Mark all as read
        await conn.execute(
            "UPDATE candidate_messages SET is_read=TRUE WHERE candidate_id=$1 AND tenant_id=$2",
            cand_id, actor.tenant_id)
        return {"candidate": dict(cand) if cand else None,
                "messages": [dict(r) for r in rows], "total": len(rows)}



@router.get("/inbox-count")
async def inbox_count(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        if actor.role in _INBOX_ADMIN_ROLES:
            ats_cnt = await conn.fetchval("SELECT COUNT(*) FROM candidate_messages WHERE tenant_id=$1 AND is_deleted IS NOT TRUE", actor.tenant_id)
        else:
            ats_cnt = await conn.fetchval(
                f"""SELECT COUNT(*) FROM candidate_messages cm
                    WHERE cm.tenant_id=$1 AND cm.is_deleted IS NOT TRUE AND {_own_ats_message_filter(2)}""",
                actor.tenant_id, actor.user_id)
        imap_cnt = await conn.fetchval("""SELECT COUNT(*) FROM imap_messages im JOIN user_email_accounts ua ON ua.id=im.account_id WHERE im.tenant_id=$1 AND ua.user_id=$2 AND im.is_deleted IS NOT TRUE AND im.folder = 'INBOX'""", actor.tenant_id, actor.user_id)
        by_folder = await conn.fetch("""SELECT im.folder, COUNT(*) as cnt FROM imap_messages im JOIN user_email_accounts ua ON ua.id=im.account_id WHERE im.tenant_id=$1 AND ua.user_id=$2 GROUP BY im.folder ORDER BY cnt DESC""", actor.tenant_id, actor.user_id)
        return {"total": (ats_cnt or 0)+(imap_cnt or 0), "ats": ats_cnt or 0, "imap": imap_cnt or 0, "by_folder": [dict(r) for r in by_folder]}

@router.get("/sent")
async def sent(limit: int = Query(200, le=500), actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        _sent_scope = "" if actor.role in _INBOX_ADMIN_ROLES else f"AND {_own_ats_message_filter(3)}"
        _sent_params = [actor.tenant_id, limit] if actor.role in _INBOX_ADMIN_ROLES else [actor.tenant_id, limit, actor.user_id]
        ats_rows = await conn.fetch(f"""
            SELECT {MSG_COLS} {MSG_JOINS}
            WHERE cm.tenant_id=$1 AND cm.direction='outbound' AND cm.is_deleted IS NOT TRUE
              AND cm.channel != 'email' {_sent_scope}
            ORDER BY cm.created_at DESC LIMIT $2""", *_sent_params)
        imap_sent = await conn.fetch("""
            SELECT
                im.id, im.candidate_id,
                COALESCE(NULLIF(im.from_name,''), NULLIF(im.from_email,''), 'Unknown Sender') AS candidate_name,
                im.to_email AS email,
                im.folder AS imap_folder, im.imap_uid AS imap_uid,
                NULL::text AS phone, 'email'::text AS channel, 'outbound'::text AS direction,
                COALESCE(im.subject, '(no subject)') AS subject,
                COALESCE(im.html_body, im.body, '') AS body,
                'sent'::text AS status,
                im.received_at AS created_at, NULL::text AS deleted_at,
                ua.display_name AS sent_by_name,
                TRUE AS is_read,
                im.is_starred,
                im.to_email AS to_email,
                im.cc,
                1::bigint AS msg_count,
                0::bigint AS unread_count,
                CASE WHEN im.attachments IS NOT NULL AND jsonb_array_length(im.attachments) > 0
                     THEN (SELECT jsonb_agg(jsonb_build_object('filename', a->>'filename', 'mime_type', a->>'mime_type', 'size', (a->>'size')::int))
                           FROM jsonb_array_elements(im.attachments) a)
                     ELSE '[]'::jsonb END AS attachments
            FROM imap_messages im
            JOIN user_email_accounts ua ON ua.id = im.account_id
            WHERE im.tenant_id = $1 AND ua.user_id = $2
              AND im.folder LIKE '%Sent%'
              AND im.is_deleted IS NOT TRUE
            ORDER BY im.received_at DESC LIMIT $3
            """, actor.tenant_id, actor.user_id, limit)
        all_msgs = [dict(r) for r in ats_rows] + [dict(r) for r in imap_sent]
        for m in all_msgs:
            if 'attachments' in m and isinstance(m['attachments'], str):
                try: m['attachments'] = json.loads(m['attachments'] or '[]')
                except: m['attachments'] = []
        all_msgs.sort(key=lambda x: str(x.get('created_at') or ''), reverse=True)
        return all_msgs[:limit]


@router.get("/trash")
async def trash_list(limit: int = Query(200, le=500), actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(f"""
            SELECT {MSG_COLS} {MSG_JOINS}
            WHERE cm.tenant_id=$1 AND cm.is_deleted=TRUE
            ORDER BY cm.deleted_at DESC LIMIT $2""", actor.tenant_id, limit)
        return [dict(r) for r in rows]


@router.get("/starred")
async def starred(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        ats_rows = await conn.fetch(f"""
            SELECT {MSG_COLS} {MSG_JOINS}
            WHERE cm.tenant_id=$1 AND cm.is_starred=TRUE AND cm.is_deleted IS NOT TRUE
            ORDER BY cm.created_at DESC LIMIT 200""", actor.tenant_id)
        imap_rows = await conn.fetch("""
            SELECT
                im.id, im.candidate_id,
                COALESCE(NULLIF(im.from_name,''), NULLIF(im.from_email,''), 'Unknown Sender') AS candidate_name,
                im.from_email AS email,
                im.folder AS imap_folder, im.imap_uid AS imap_uid,
                NULL::text AS phone, 'email'::text AS channel, 'inbound'::text AS direction,
                COALESCE(im.subject, '(no subject)') AS subject,
                COALESCE(im.html_body, im.body, '') AS body,
                'received'::text AS status,
                im.received_at AS created_at, NULL::text AS deleted_at,
                ua.display_name AS sent_by_name,
                im.is_read, im.is_starred,
                im.to_email, im.cc,
                1::bigint AS msg_count,
                (CASE WHEN im.is_read THEN 0 ELSE 1 END)::bigint AS unread_count,
                CASE WHEN im.attachments IS NOT NULL AND jsonb_array_length(im.attachments) > 0
                     THEN (SELECT jsonb_agg(jsonb_build_object('filename', a->>'filename', 'mime_type', a->>'mime_type', 'size', (a->>'size')::int))
                           FROM jsonb_array_elements(im.attachments) a)
                     ELSE '[]'::jsonb END AS attachments
            FROM imap_messages im
            JOIN user_email_accounts ua ON ua.id = im.account_id
            WHERE im.tenant_id = $1 AND ua.user_id = $2
              AND im.is_starred = TRUE AND im.is_deleted IS NOT TRUE
            ORDER BY im.received_at DESC LIMIT 200
            """, actor.tenant_id, actor.user_id)
        all_msgs = [dict(r) for r in ats_rows] + [dict(r) for r in imap_rows]
        for m in all_msgs:
            if 'attachments' in m and isinstance(m['attachments'], str):
                try: m['attachments'] = json.loads(m['attachments'] or '[]')
                except: m['attachments'] = []
        all_msgs.sort(key=lambda x: str(x.get('created_at') or ''), reverse=True)
        return all_msgs


@router.patch("/messages/{msg_id}/trash")
async def trash_message(msg_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        # Try candidate_messages first
        r = await conn.fetchrow(
            "UPDATE candidate_messages SET is_deleted=TRUE,deleted_at=NOW() WHERE id=$1 AND tenant_id=$2 RETURNING id",
            msg_id, actor.tenant_id)
        if r:
            return {"trashed": True}
        # Fallback: try imap_messages (IMAP emails use same trash endpoint)
        r2 = await conn.fetchrow(
            "UPDATE imap_messages SET is_deleted=TRUE WHERE id=$1 AND tenant_id=$2 RETURNING id",
            msg_id, actor.tenant_id)
        if not r2: raise HTTPException(404, "Message not found")
        return {"trashed": True}


@router.patch("/messages/{msg_id}/restore")
async def restore_message(msg_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        r = await conn.fetchrow(
            "UPDATE candidate_messages SET is_deleted=FALSE,deleted_at=NULL WHERE id=$1 AND tenant_id=$2 RETURNING id",
            msg_id, actor.tenant_id)
        if r:
            return {"restored": True}
        r2 = await conn.fetchrow(
            "UPDATE imap_messages SET is_deleted=FALSE WHERE id=$1 AND tenant_id=$2 RETURNING id",
            msg_id, actor.tenant_id)
        if not r2: raise HTTPException(404, "Message not found")
        return {"restored": True}


@router.delete("/messages/{msg_id}")
async def delete_perm(msg_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute(
            "DELETE FROM candidate_messages WHERE id=$1 AND tenant_id=$2",
            msg_id, actor.tenant_id)
        return {"deleted": True}


@router.patch("/messages/{msg_id}/read")
async def mark_read(msg_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute("UPDATE candidate_messages SET is_read=TRUE WHERE id=$1 AND tenant_id=$2", msg_id, actor.tenant_id)
        await conn.execute("UPDATE imap_messages SET is_read=TRUE WHERE id=$1 AND tenant_id=$2", msg_id, actor.tenant_id)
        return {"ok": True}


@router.patch("/messages/{msg_id}/unread")
async def mark_unread(msg_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute("UPDATE candidate_messages SET is_read=FALSE WHERE id=$1 AND tenant_id=$2", msg_id, actor.tenant_id)
        await conn.execute("UPDATE imap_messages SET is_read=FALSE WHERE id=$1 AND tenant_id=$2", msg_id, actor.tenant_id)
        return {"ok": True}


@router.patch("/messages/{msg_id}/star")
async def toggle_star(msg_id: str, actor: Actor = Depends(get_actor)):
    """Real IDOR-class gap fix (2026-08-31, same root cause as
    _assert_imap_writable): this dual-purpose endpoint updated either
    table with no ownership scoping at all — the imap_messages fallback
    branch is dead from the current frontend (which routes IMAP stars
    through the dedicated, now-fixed star_imap_ep instead), but stayed
    live, reachable code with zero protection. Scoped both branches to
    match this file's established convention: admin-class roles keep
    full tenant visibility, everyone else is restricted to messages
    they personally sent/own (_own_ats_message_filter) or IMAP messages
    in a mailbox they personally connected."""
    is_admin = actor.role in _INBOX_ADMIN_ROLES or actor.role is None
    async with db.tenant_conn(actor.tenant_id) as conn:
        if is_admin:
            r = await conn.fetchrow("UPDATE candidate_messages SET is_starred=NOT COALESCE(is_starred,FALSE) WHERE id=$1 AND tenant_id=$2 RETURNING is_starred", msg_id, actor.tenant_id)
        else:
            r = await conn.fetchrow(
                f"UPDATE candidate_messages cm SET is_starred=NOT COALESCE(is_starred,FALSE) "
                f"WHERE id=$1 AND tenant_id=$2 AND {_own_ats_message_filter(3)} RETURNING is_starred",
                msg_id, actor.tenant_id, actor.user_id)
        if not r:
            if is_admin:
                r = await conn.fetchrow("UPDATE imap_messages SET is_starred=NOT COALESCE(is_starred,FALSE) WHERE id=$1 AND tenant_id=$2 RETURNING is_starred", msg_id, actor.tenant_id)
            else:
                r = await conn.fetchrow(
                    """UPDATE imap_messages im SET is_starred=NOT COALESCE(is_starred,FALSE)
                       WHERE im.id=$1 AND im.tenant_id=$2
                         AND EXISTS (SELECT 1 FROM user_email_accounts ua WHERE ua.id=im.account_id AND ua.user_id=$3)
                       RETURNING is_starred""",
                    msg_id, actor.tenant_id, actor.user_id)
        if not r: raise HTTPException(404, "Not found")
        return {"starred": r["is_starred"]}


# ── Drafts ─────────────────────────────────────────────────────────────────────
# Real gap fix (2026-08-31): message_drafts had no owner/creator column at
# all - every recruiter's in-progress draft was tenant-shared, listable/
# editable/deletable by any other authenticated user. sql/97 adds
# created_by; scoped here the same way every other personal-mailbox
# surface in this file already is - admin-class roles keep full
# tenant-wide oversight visibility, everyone else sees only their own
# drafts. A pre-existing draft saved before this fix (created_by IS
# NULL) is claimed by whoever next edits/saves it, matching this
# project's established "never fabricate a historical author" discipline.

@router.get("/drafts")
async def list_drafts(actor: Actor = Depends(get_actor)):
    is_admin = actor.role in _INBOX_ADMIN_ROLES or actor.role is None
    scope = "" if is_admin else " AND (d.created_by=$2 OR d.created_by IS NULL)"
    params = [actor.tenant_id] if is_admin else [actor.tenant_id, actor.user_id]
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(f"""
            SELECT d.id, d.candidate_id, c.full_name AS candidate_name,
                   COALESCE(c.email, d.to_email) AS email,
                   d.to_email, d.channel, d.subject, d.body, d.cc,
                   d.created_at, d.updated_at, d.created_by
            FROM message_drafts d
            LEFT JOIN candidates c ON c.id=d.candidate_id
            WHERE d.tenant_id=$1 {scope} ORDER BY d.updated_at DESC""", *params)
        cnt = await conn.fetchval(
            f"SELECT COUNT(*) FROM message_drafts d WHERE d.tenant_id=$1 {scope}", *params)
        return {"drafts": [dict(r) for r in rows], "count": cnt}


@router.post("/drafts")
async def save_draft(body: DraftBody, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            INSERT INTO message_drafts (tenant_id,candidate_id,to_email,channel,subject,body,cc,created_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id""",
            actor.tenant_id, body.candidate_id or None, body.to_email,
            body.channel, body.subject, body.body, body.cc, actor.user_id)
        return {"id": str(row["id"]), "saved": True}


@router.put("/drafts/{draft_id}")
async def update_draft(draft_id: str, body: DraftBody, actor: Actor = Depends(get_actor)):
    is_admin = actor.role in _INBOX_ADMIN_ROLES or actor.role is None
    scope = "" if is_admin else " AND (created_by=$9 OR created_by IS NULL)"
    async with db.tenant_conn(actor.tenant_id) as conn:
        r = await conn.fetchrow(f"""
            UPDATE message_drafts
            SET candidate_id=$1,to_email=$2,channel=$3,subject=$4,body=$5,cc=$6,
                updated_at=NOW(), created_by=COALESCE(created_by,$9)
            WHERE id=$7 AND tenant_id=$8 {scope} RETURNING id""",
            body.candidate_id or None, body.to_email, body.channel,
            body.subject, body.body, body.cc, draft_id, actor.tenant_id,
            actor.user_id)
        if not r: raise HTTPException(404, "Draft not found")
        return {"id": draft_id, "saved": True}


@router.delete("/drafts/{draft_id}")
async def delete_draft(draft_id: str, actor: Actor = Depends(get_actor)):
    is_admin = actor.role in _INBOX_ADMIN_ROLES or actor.role is None
    scope = "" if is_admin else " AND (created_by=$3 OR created_by IS NULL)"
    params = [draft_id, actor.tenant_id] if is_admin else [draft_id, actor.tenant_id, actor.user_id]
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute(
            f"DELETE FROM message_drafts WHERE id=$1 AND tenant_id=$2 {scope}", *params)
        return {"deleted": True}


class ScheduleBody(BaseModel):
    scheduled_send_at: str  # ISO datetime


@router.post("/drafts/{draft_id}/schedule")
async def schedule_draft(draft_id: str, body: ScheduleBody, actor: Actor = Depends(get_actor)):
    """Real scheduled send (2026-09-03 audit, gap #7): marks an existing
    draft to be sent automatically at a future time. The actual send
    happens in scheduler.py's process_scheduled_email_sends() (every 5
    min) — this endpoint only ever flips the flag on a draft the caller
    already owns, reusing the exact save/update draft machinery already
    built rather than a second, parallel "scheduled email" concept."""
    try:
        when = datetime.fromisoformat(body.scheduled_send_at.replace("Z", "+00:00"))
    except Exception:
        raise HTTPException(400, "Invalid scheduled_send_at — use ISO 8601")
    if when <= datetime.now(timezone.utc):
        raise HTTPException(400, "scheduled_send_at must be in the future")
    is_admin = actor.role in _INBOX_ADMIN_ROLES or actor.role is None
    scope = "" if is_admin else " AND (created_by=$4 OR created_by IS NULL)"
    params = [when, draft_id, actor.tenant_id] if is_admin else [when, draft_id, actor.tenant_id, actor.user_id]
    async with db.tenant_conn(actor.tenant_id) as conn:
        r = await conn.fetchrow(
            f"""UPDATE message_drafts SET scheduled_send_at=$1, is_scheduled=TRUE,
                    sent_at=NULL, send_error=NULL, created_by=COALESCE(created_by,$4)
                WHERE id=$2 AND tenant_id=$3 {scope} RETURNING id""",
            *params)
        if not r:
            raise HTTPException(404, "Draft not found")
        return {"id": draft_id, "scheduled": True, "scheduled_send_at": when.isoformat()}


@router.post("/drafts/{draft_id}/unschedule")
async def unschedule_draft(draft_id: str, actor: Actor = Depends(get_actor)):
    is_admin = actor.role in _INBOX_ADMIN_ROLES or actor.role is None
    scope = "" if is_admin else " AND (created_by=$3 OR created_by IS NULL)"
    params = [draft_id, actor.tenant_id] if is_admin else [draft_id, actor.tenant_id, actor.user_id]
    async with db.tenant_conn(actor.tenant_id) as conn:
        r = await conn.fetchrow(
            f"UPDATE message_drafts SET is_scheduled=FALSE, scheduled_send_at=NULL "
            f"WHERE id=$1 AND tenant_id=$2 {scope} RETURNING id", *params)
        if not r:
            raise HTTPException(404, "Draft not found")
        return {"id": draft_id, "scheduled": False}


@router.get("/drafts/scheduled")
async def list_scheduled_drafts(actor: Actor = Depends(get_actor)):
    is_admin = actor.role in _INBOX_ADMIN_ROLES or actor.role is None
    scope = "" if is_admin else " AND (d.created_by=$2 OR d.created_by IS NULL)"
    params = [actor.tenant_id] if is_admin else [actor.tenant_id, actor.user_id]
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(f"""
            SELECT d.id, d.candidate_id, c.full_name AS candidate_name,
                   COALESCE(c.email, d.to_email) AS email, d.subject,
                   d.scheduled_send_at, d.sent_at, d.send_error
            FROM message_drafts d LEFT JOIN candidates c ON c.id=d.candidate_id
            WHERE d.tenant_id=$1 AND d.is_scheduled=TRUE {scope}
            ORDER BY d.scheduled_send_at ASC""", *params)
        return [dict(r) for r in rows]


# ── Send ────────────────────────────────────────────────────────────────────────

@router.post("/log-manual")
async def log_manual_message(body: dict, actor: Actor = Depends(get_actor)):
    """Real, honest, manual chat-record entry (2026-08-27) - for outreach
    that happened OUTSIDE this app (e.g. click-to-chat: wa.me opens the
    recruiter's own WhatsApp client, which this backend has no API access
    into) but the recruiter still wants a real record on the candidate's
    timeline. Never fabricated - only ever written when a human explicitly
    clicks "Log this outreach"."""
    cand_id = body.get("candidate_id")
    channel = body.get("channel", "whatsapp")
    text = (body.get("body") or "").strip()
    if not cand_id or not text:
        raise HTTPException(400, "candidate_id and body are required")
    async with db.tenant_conn(actor.tenant_id) as conn:
        cand = await conn.fetchrow("SELECT id FROM candidates WHERE id=$1 AND tenant_id=$2", cand_id, actor.tenant_id)
        if not cand:
            raise HTTPException(404, "Candidate not found")
        logged = await _log(conn, actor.tenant_id, cand_id, None, channel, None, text, "sent", str(actor.user_id))
    if not logged:
        raise HTTPException(500, "Could not log this message")
    return {"logged": True, "id": logged["id"]}


@router.post("/send")
async def send_msg(body: SendMsg, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        results = {}
        smtp = await _get_smtp(conn, actor.tenant_id)

        # Resolve recipient
        if body.candidate_id:
            cand = await conn.fetchrow(
                "SELECT full_name,email,phone FROM candidates WHERE id=$1 AND tenant_id=$2",
                body.candidate_id, actor.tenant_id)
            if not cand: raise HTTPException(404, "Candidate not found")
            # Broadened candidate-ownership enforcement (2026-08-11) —
            # only applies to a real candidate_id send; a free-form
            # to_email recipient has no ownership concept.
            await ownership.check_ownership_or_raise(conn, actor.tenant_id, body.candidate_id, actor)
            to_email = cand["email"]
            to_name = cand["full_name"]
            to_phone = cand["phone"]
        elif body.to_email:
            to_email = body.to_email
            to_name = body.to_name or body.to_email
            to_phone = None
        else:
            raise HTTPException(400, "Provide candidate_id or to_email")

        # Real RBAC enforcement (2026-09-03 audit, gap #1 — the stated
        # business rule itself was previously unenforced): a real client-
        # contacts match on To/CC/BCC gates this send to KAE/KAM/Manager/
        # Admin. A candidate_id send never hits this (a candidate's own
        # email is always a legitimate recipient regardless of role); only
        # a free-form to_email path can resolve to a real client SPOC.
        client_match = None
        if body.to_email:
            client_match = await email_tracking.resolve_client_contact_match(
                conn, actor.tenant_id, body.to_email, body.cc, body.bcc)
            if client_match and actor.role is not None and actor.role not in email_tracking.CLIENT_EMAIL_ROLES:
                raise HTTPException(
                    403,
                    f"Only a KAE, KAM, Manager, or Admin can email a client contact "
                    f"directly ({client_match['contact_name']} at {client_match['client_name']}). "
                    f"Use \"Submit to Client\" on the pipeline board, or ask your KAE "
                    f"to send this on your behalf.")
        client_id = client_match["client_id"] if client_match else None
        client_contact_id = client_match["contact_id"] if client_match else None

        # BUG FIX (2026-08-10 audit): this, the single-send path the actual
        # Conversations composer calls, never personalized anything — a
        # recruiter picking a template and hitting Send emailed the
        # candidate literal text like "Hi {candidate_name},". bulk-send
        # already personalized on name; this now uses the same resolver
        # (richer: also covers {role}/{client_name}/{recruiter_name}/{ctc}/
        # {date}/{time}, the placeholders the real templates contain).
        tvars = await _resolve_template_vars(conn, actor.tenant_id, body.candidate_id, body.application_id) \
            if (body.candidate_id or body.application_id) else {"name": to_name, "first_name": (to_name or "there").split(" ")[0]}
        subj_p = _personalize(body.subject, tvars)
        msg_p = _personalize(body.message, tvars)

        if body.channel in ("email", "both"):
            if not to_email: results["email"] = "no_email"
            elif not smtp: results["email"] = "smtp_not_configured"
            else:
                subj = subj_p or "AVIIN Jobs Services"
                logged = await _log(conn, actor.tenant_id, body.candidate_id, body.application_id,
                           "email", subj, msg_p, "sent", str(actor.user_id),
                           body.template_id, body.stage, to_email, body.cc,
                           client_id, client_contact_id)
                tracked = _with_tracking_pixel(msg_p, logged["tracking_token"] if logged else None)
                tracked = _wrap_links_for_tracking(tracked, logged["tracking_token"] if logged else None)
                _send_email_bg(smtp, to_email, subj, tracked, body.cc, body.bcc,
                                logged["message_id_header"] if logged else None)
                results["email"] = "sent"

        if body.channel in ("whatsapp", "both"):
            phone = to_phone if body.candidate_id else None
            if not phone: results["whatsapp"] = "no_phone"
            # HARD RULE #7/#12 fix (2026-08-10 audit): this was the one path
            # every real WhatsApp-composer UI actually calls, and it never
            # checked consent — the consent-checking code in whatsapp.py
            # existed but had zero UI callers. Same _ensure_consent used there.
            elif body.candidate_id and not await _ensure_consent(conn, actor.tenant_id, body.candidate_id):
                results["whatsapp"] = "no_consent"
            else:
                from routers.whatsapp import resolve_send_session
                personal_session = await resolve_send_session(actor.tenant_id, str(actor.user_id))
                ok = await _send_wa(phone, msg_p, personal_session or WAHA_SESSION)
                st = "sent" if ok else "failed"
                await _log(conn, actor.tenant_id, body.candidate_id, body.application_id,
                           "whatsapp", None, msg_p, st, str(actor.user_id),
                           body.template_id, body.stage, to_email, None)
                results["whatsapp"] = st

        return {"success": True, "results": results, "to": to_name}


def _personalize(text: Optional[str], vars: dict) -> Optional[str]:
    """Substitutes every {key} placeholder found in `vars` — the single-
    brace convention every real email_templates row actually uses. Extended
    (2026-08-10 audit) from the original {name}/{first_name}-only version
    to also cover {candidate_name}/{role}/{client_name}/{recruiter_name}/
    {ctc}/{date}/{time}, matching what the real seeded templates contain."""
    if not text:
        return text
    for k, v in vars.items():
        text = text.replace(f"{{{k}}}", str(v))
    return text


@router.post("/bulk-send")
async def bulk_send(body: BulkMsg, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        if body.candidate_ids:
            cands = await conn.fetch(
                "SELECT id,full_name,email,phone FROM candidates WHERE id=ANY($1::uuid[]) AND tenant_id=$2",
                body.candidate_ids, actor.tenant_id)
        elif body.stage and body.requisition_id:
            cands = await conn.fetch("""SELECT DISTINCT c.id,c.full_name,c.email,c.phone
                FROM applications a JOIN candidates c ON c.id=a.candidate_id
                WHERE a.stage=$1 AND a.requisition_id=$2::uuid AND a.tenant_id=$3""",
                body.stage, body.requisition_id, actor.tenant_id)
        elif body.stage:
            cands = await conn.fetch("""SELECT DISTINCT c.id,c.full_name,c.email,c.phone
                FROM applications a JOIN candidates c ON c.id=a.candidate_id
                WHERE a.stage=$1 AND a.tenant_id=$2""", body.stage, actor.tenant_id)
        else:
            raise HTTPException(400, "Provide stage or candidate_ids")
        smtp = await _get_smtp(conn, actor.tenant_id)
        sent = failed = skipped = 0
        for cand in cands:
            # Broadened candidate-ownership enforcement (2026-08-11) —
            # skip (not fail-the-whole-batch) a candidate someone else
            # actively owns, same treatment as every other per-candidate
            # skip reason in this loop (no email/phone, SMTP not
            # configured, WhatsApp consent missing).
            owner = await ownership.get_ownership(conn, actor.tenant_id, str(cand["id"]))
            if ownership.owner_blocked(owner, actor):
                skipped += 1
                continue
            cvars = await _resolve_template_vars(conn, actor.tenant_id, str(cand["id"]))
            msg = _personalize(body.message, cvars)
            if body.channel in ("email","both"):
                if not cand["email"] or not smtp: skipped += 1
                else:
                    subj = _personalize(body.subject, cvars) or "AVIIN Jobs - Update"
                    # Log first so the send can embed a pixel keyed to this
                    # exact message row; candidate_messages.body stays the
                    # clean original text, the pixel only rides on the SMTP copy.
                    logged = await _log(conn, actor.tenant_id, str(cand["id"]), None, "email", subj,
                               msg, "sent", str(actor.user_id), body.template_id, body.stage,
                               cand["email"], None)
                    tracked = _with_tracking_pixel(msg, logged["tracking_token"] if logged else None)
                    tracked = _wrap_links_for_tracking(tracked, logged["tracking_token"] if logged else None)
                    _send_email_bg(smtp, cand["email"], subj, tracked, None, None,
                                    logged["message_id_header"] if logged else None)
                    sent += 1
            if body.channel in ("whatsapp","both"):
                if not cand["phone"]: skipped += 1
                # Same HARD RULE #7/#12 fix as send_msg() above.
                elif not await _ensure_consent(conn, actor.tenant_id, str(cand["id"])):
                    skipped += 1
                else:
                    ok = await _send_wa(cand["phone"], msg)
                    st = "sent" if ok else "failed"
                    await _log(conn, actor.tenant_id, str(cand["id"]), None, "whatsapp", None,
                               msg, st, str(actor.user_id), body.template_id, body.stage,
                               None, None)
                    if ok: sent += 1
                    else: failed += 1
        return {"sent": sent, "failed": failed, "skipped": skipped, "total": len(cands)}


# ── Stats ───────────────────────────────────────────────────────────────────────

@router.get("/stats")
async def stats(actor: Actor = Depends(get_actor)):
    # Real gap fix (2026-08-27): every one of these ATS-message counts
    # was tenant-wide regardless of role — the exact same missing scoping
    # already fixed on /inbox, /inbox-count, /sent (a real KAE with zero
    # candidates of her own saw the whole tenant's unread count on her
    # own sidebar badge). message_drafts has no owner column at all (a
    # real, separate, pre-existing schema gap — flagged, not fixed here,
    # since drafts were never part of what was reported and fixing it
    # needs an actual migration, not just a query change).
    is_admin = actor.role in _INBOX_ADMIN_ROLES
    ats_scope = "" if is_admin else f"AND {_own_ats_message_filter(2)}"
    ats_params = [actor.tenant_id] if is_admin else [actor.tenant_id, actor.user_id]
    async with db.tenant_conn(actor.tenant_id) as conn:
        inbox_cnt = await conn.fetchval(
            f"SELECT COUNT(DISTINCT COALESCE(cm.candidate_id::text,cm.to_email)) FROM candidate_messages cm WHERE cm.tenant_id=$1 AND cm.is_deleted IS NOT TRUE {ats_scope}",
            *ats_params)
        imap_unread_cnt = await conn.fetchval("SELECT COUNT(*) FROM imap_messages im JOIN user_email_accounts ua ON ua.id=im.account_id WHERE im.tenant_id=$1 AND ua.user_id=$2 AND im.is_read IS NOT TRUE AND im.is_deleted IS NOT TRUE AND im.folder = 'INBOX'", actor.tenant_id, actor.user_id)
        unread_cnt_ats = await conn.fetchval(
            f"SELECT COUNT(*) FROM candidate_messages cm WHERE cm.tenant_id=$1 AND cm.is_read IS NOT TRUE AND cm.is_deleted IS NOT TRUE {ats_scope}",
            *ats_params)
        unread_cnt = (unread_cnt_ats or 0) + (imap_unread_cnt or 0)
        sent_cnt_ats = await conn.fetchval(
            f"SELECT COUNT(*) FROM candidate_messages cm WHERE cm.tenant_id=$1 AND cm.direction='outbound' AND cm.is_deleted IS NOT TRUE AND cm.channel != 'email' {ats_scope}",
            *ats_params)
        sent_cnt_imap = await conn.fetchval(
            "SELECT COUNT(*) FROM imap_messages im JOIN user_email_accounts ua ON ua.id=im.account_id WHERE im.tenant_id=$1 AND ua.user_id=$2 AND im.folder LIKE '%Sent%' AND im.is_deleted IS NOT TRUE",
            actor.tenant_id, actor.user_id)
        sent_cnt = (sent_cnt_ats or 0) + (sent_cnt_imap or 0)
        draft_cnt = await conn.fetchval(
            "SELECT COUNT(*) FROM message_drafts WHERE tenant_id=$1", actor.tenant_id)
        trash_cnt = await conn.fetchval(
            f"SELECT COUNT(*) FROM candidate_messages cm WHERE cm.tenant_id=$1 AND cm.is_deleted=TRUE {ats_scope}",
            *ats_params)
        starred_cnt_ats = await conn.fetchval(
            f"SELECT COUNT(*) FROM candidate_messages cm WHERE cm.tenant_id=$1 AND cm.is_starred=TRUE AND cm.is_deleted IS NOT TRUE {ats_scope}",
            *ats_params)
        starred_cnt_imap = await conn.fetchval(
            "SELECT COUNT(*) FROM imap_messages im JOIN user_email_accounts ua ON ua.id=im.account_id WHERE im.tenant_id=$1 AND ua.user_id=$2 AND im.is_starred=TRUE AND im.is_deleted IS NOT TRUE",
            actor.tenant_id, actor.user_id)
        starred_cnt = (starred_cnt_ats or 0) + (starred_cnt_imap or 0)
        wa_cnt = await conn.fetchval(
            f"SELECT COUNT(*) FROM candidate_messages cm WHERE cm.tenant_id=$1 AND cm.channel='whatsapp' AND cm.is_deleted IS NOT TRUE {ats_scope}",
            *ats_params)
        return {"folder_counts": {
            "inbox": inbox_cnt, "sent": sent_cnt, "drafts": draft_cnt,
            "trash": trash_cnt, "starred": starred_cnt, "whatsapp": wa_cnt,
            "unread": unread_cnt
        }}


@router.get("/dashboard")
async def mailbox_dashboard(team_view: bool = Query(False), actor: Actor = Depends(get_actor)):
    """Real "Mailbox Dashboard" widget set (2026-09-03 audit, gap #5):
    Today Sent/Received, Unread, Pending Follow-Ups, Client Replies Today,
    Open Rate, Reply Rate, Avg Response Time. Self-scoped by default (each
    KAE/recruiter's own mailbox, matching the spec's own "each KAE should
    have Inbox/Sent/..." framing); team_view=true only takes effect for a
    real management-class role, silently ignored otherwise — same
    established convention as the Reminders dashboard's own team_view."""
    is_admin = actor.role in _INBOX_ADMIN_ROLES
    scope_team = team_view and is_admin
    own_cond = "" if scope_team else f"AND {_own_ats_message_filter(2)}"
    own_params = [actor.tenant_id] if scope_team else [actor.tenant_id, actor.user_id]
    today = date.today()
    async with db.tenant_conn(actor.tenant_id) as conn:
        today_sent = await conn.fetchval(
            f"""SELECT COUNT(*) FROM candidate_messages cm
                WHERE cm.tenant_id=$1 AND cm.direction='outbound' AND cm.channel='email'
                  AND cm.is_deleted IS NOT TRUE AND cm.created_at::date=$3 {own_cond}""",
            *own_params, today)
        today_received = await conn.fetchval(
            """SELECT COUNT(*) FROM imap_messages im JOIN user_email_accounts ua ON ua.id=im.account_id
               WHERE im.tenant_id=$1 AND ($2 OR ua.user_id=$3) AND im.folder='INBOX'
                 AND im.is_deleted IS NOT TRUE AND im.received_at::date=$4""",
            actor.tenant_id, scope_team, actor.user_id, today)
        unread_ats = await conn.fetchval(
            f"""SELECT COUNT(*) FROM candidate_messages cm
                WHERE cm.tenant_id=$1 AND cm.is_read IS NOT TRUE AND cm.is_deleted IS NOT TRUE {own_cond}""",
            *own_params)
        unread_imap = await conn.fetchval(
            """SELECT COUNT(*) FROM imap_messages im JOIN user_email_accounts ua ON ua.id=im.account_id
               WHERE im.tenant_id=$1 AND ($2 OR ua.user_id=$3) AND im.folder='INBOX'
                 AND im.is_read IS NOT TRUE AND im.is_deleted IS NOT TRUE""",
            actor.tenant_id, scope_team, actor.user_id)
        pending_followups = await conn.fetchval(
            """SELECT COUNT(*) FROM recruiter_tasks
               WHERE tenant_id=$1 AND status IN ('pending','in_progress')
                 AND ($2 OR recruiter_id=$3)""",
            actor.tenant_id, scope_team, actor.user_id)
        client_replies_today = await conn.fetchval(
            f"""SELECT COUNT(*) FROM candidate_messages cm
                WHERE cm.tenant_id=$1 AND cm.client_id IS NOT NULL
                  AND cm.replied_at::date=$3 {own_cond}""",
            *own_params, today)
        rates = await conn.fetchrow(
            f"""SELECT COUNT(*) AS sent,
                       COUNT(*) FILTER (WHERE email_open_count > 0) AS opened,
                       COUNT(*) FILTER (WHERE replied_at IS NOT NULL) AS replied,
                       AVG(EXTRACT(EPOCH FROM (replied_at - created_at)) / 3600)
                           FILTER (WHERE replied_at IS NOT NULL) AS avg_resp_hrs
                FROM candidate_messages cm
                WHERE cm.tenant_id=$1 AND cm.direction='outbound' AND cm.channel='email'
                  AND cm.is_deleted IS NOT TRUE AND cm.created_at >= now() - INTERVAL '30 days' {own_cond}""",
            *own_params)
        sent_30d = rates["sent"] or 0
        open_rate = round((rates["opened"] or 0) / sent_30d * 100, 1) if sent_30d else 0.0
        reply_rate = round((rates["replied"] or 0) / sent_30d * 100, 1) if sent_30d else 0.0
        avg_resp = round(float(rates["avg_resp_hrs"]), 1) if rates["avg_resp_hrs"] is not None else None
        return {
            "scope": "team" if scope_team else "personal",
            "today_sent": today_sent or 0,
            "today_received": today_received or 0,
            "unread": (unread_ats or 0) + (unread_imap or 0),
            "pending_followups": pending_followups or 0,
            "client_replies_today": client_replies_today or 0,
            "open_rate_pct": open_rate,
            "reply_rate_pct": reply_rate,
            "avg_response_hours": avg_resp,
            "period": "last 30 days (rates)",
        }


@router.get("/whatsapp/status")
async def wa_status(actor: Actor = Depends(get_actor)):
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{WAHA_BASE}/api/sessions/{WAHA_SESSION}", headers={"X-Api-Key": WAHA_KEY})
            if r.status_code == 200: return {"connected": True, "session": r.json()}
            return {"connected": False, "status_code": r.status_code}
    except Exception as e:
        return {"connected": False, "error": str(e)}


@router.post("/whatsapp/start-session")
async def wa_start(actor: Actor = Depends(get_actor)):
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(f"{WAHA_BASE}/api/sessions/start",
                headers={"X-Api-Key": WAHA_KEY},
                json={"name": WAHA_SESSION, "config": {"debug": False}})
            return {"started": r.status_code < 400, "response": r.json() if r.content else {}}
    except Exception as e:
        return {"started": False, "error": str(e)}


@router.patch("/imap/{msg_id}/read")
async def mark_imap_read_ep(msg_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        await _assert_imap_writable(conn, msg_id, actor)
        await conn.execute("UPDATE imap_messages SET is_read=TRUE WHERE id=$1 AND tenant_id=$2", msg_id, actor.tenant_id)
        return {"ok": True}

@router.patch("/imap/{msg_id}/star")
async def star_imap_ep(msg_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        await _assert_imap_writable(conn, msg_id, actor)
        r = await conn.fetchrow("UPDATE imap_messages SET is_starred=NOT COALESCE(is_starred,FALSE) WHERE id=$1 AND tenant_id=$2 RETURNING is_starred", msg_id, actor.tenant_id)
        return {"starred": r["is_starred"] if r else False}

@router.patch("/imap/{msg_id}/trash")
async def trash_imap_ep(msg_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        await _assert_imap_writable(conn, msg_id, actor)
        await conn.execute("UPDATE imap_messages SET is_deleted=TRUE WHERE id=$1 AND tenant_id=$2", msg_id, actor.tenant_id)
        return {"ok": True}

@router.get("/imap-messages")
async def get_imap_messages(limit: int = Query(200, le=500), folder: str = Query(None), actor: Actor = Depends(get_actor)):
    """Return IMAP emails with Phase H resume processing tags. Admins see all tenant emails."""
    import json as _json
    async with db.tenant_conn(actor.tenant_id) as conn:
        is_admin = actor.role in ("admin", "super_admin", "lead_recruiter", "manager")
        folder_sql = ""
        if folder:
            folder_sql = f"AND im.folder='{folder}'"
        elif is_admin:
            folder_sql = "AND im.folder LIKE '%INBOX%'"

        if is_admin:
            rows = await conn.fetch(f"""
                SELECT
                  im.id, im.subject, im.from_email, im.from_name, im.to_email,
                  im.received_at, im.is_read, im.is_starred, im.is_deleted,
                  im.auto_processed, im.process_status, im.attachments,
                  im.candidate_id, im.folder,
                  ua.email AS account_email,
                  rf.id                                AS resume_file_id,
                  rf.routing_decision,
                  rf.parse_confidence,
                  rf.parsed_data->>'name'              AS rf_candidate_name,
                  rf.parsed_data->'skills'             AS rf_skills,
                  c.id                                 AS candidate_id_linked,
                  c.full_name                          AS candidate_full_name,
                  c.total_exp_mo,
                  c.skills                             AS candidate_skills
                FROM imap_messages im
                JOIN user_email_accounts ua ON ua.id = im.account_id
                LEFT JOIN LATERAL (
                    SELECT rf2.* FROM resume_files rf2
                    WHERE rf2.tenant_id = im.tenant_id
                      AND (
                        rf2.imap_msg_id = im.id
                        OR (rf2.source_email = im.from_email
                            AND rf2.imap_msg_id IS NOT NULL
                            AND ABS(EXTRACT(EPOCH FROM (rf2.created_at - im.received_at))) < 86400)
                      )
                    ORDER BY (rf2.imap_msg_id = im.id) DESC, rf2.created_at DESC LIMIT 1
                ) rf ON true
                LEFT JOIN candidates c ON c.id = rf.candidate_id
                WHERE im.tenant_id=$1 AND im.is_deleted IS NOT TRUE {folder_sql}
                ORDER BY im.received_at DESC LIMIT $2
            """, actor.tenant_id, limit)
        else:
            rows = await conn.fetch(f"""
                SELECT
                  im.id, im.subject, im.from_email, im.from_name, im.to_email,
                  im.received_at, im.is_read, im.is_starred, im.is_deleted,
                  im.auto_processed, im.process_status, im.attachments,
                  im.candidate_id, im.folder,
                  ua.email AS account_email,
                  rf.id                                AS resume_file_id,
                  rf.routing_decision,
                  rf.parse_confidence,
                  rf.parsed_data->>'name'              AS rf_candidate_name,
                  rf.parsed_data->'skills'             AS rf_skills,
                  c.id                                 AS candidate_id_linked,
                  c.full_name                          AS candidate_full_name,
                  c.total_exp_mo,
                  c.skills                             AS candidate_skills
                FROM imap_messages im
                JOIN user_email_accounts ua ON ua.id = im.account_id AND ua.user_id=$2
                LEFT JOIN LATERAL (
                    SELECT rf2.* FROM resume_files rf2
                    WHERE rf2.tenant_id = im.tenant_id
                      AND (
                        rf2.imap_msg_id = im.id
                        OR (rf2.source_email = im.from_email
                            AND rf2.imap_msg_id IS NOT NULL
                            AND ABS(EXTRACT(EPOCH FROM (rf2.created_at - im.received_at))) < 86400)
                      )
                    ORDER BY (rf2.imap_msg_id = im.id) DESC, rf2.created_at DESC LIMIT 1
                ) rf ON true
                LEFT JOIN candidates c ON c.id = rf.candidate_id
                WHERE im.tenant_id=$1 AND im.is_deleted IS NOT TRUE {folder_sql}
                ORDER BY im.received_at DESC LIMIT $3
            """, actor.tenant_id, actor.user_id, limit)

        def build_tag(r):
            d = dict(r)
            has_resume = d.get("resume_file_id") is not None
            skills = []
            if d.get("candidate_skills"):
                skills = list(d["candidate_skills"])[:3]
            elif d.get("rf_skills"):
                try:
                    raw = d["rf_skills"]
                    sk = _json.loads(raw) if isinstance(raw, str) else raw
                    skills = [s for s in (sk or []) if isinstance(s, str) and len(s) < 35][:3]
                except Exception:
                    pass
            exp_mo = d.get("total_exp_mo") or 0
            d["resume_tag"] = {
                "detected": has_resume,
                "routing": d.get("routing_decision"),
                "confidence": float(d.get("parse_confidence") or 0),
                "candidate_name": d.get("candidate_full_name") or d.get("rf_candidate_name"),
                "skills": skills,
                "exp": f"{exp_mo // 12}yr" if exp_mo else None,
            } if has_resume else None
            return d

        msgs = [build_tag(r) for r in rows]
        unread = sum(1 for m in msgs if not m.get("is_read"))
        return {"messages": msgs, "unread": unread, "total": len(msgs)}


@router.get("/email-templates")
async def list_templates(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            "SELECT id,name,category,subject,body_html,variables,is_active "
            "FROM email_templates WHERE tenant_id=$1 AND is_active=TRUE ORDER BY name",
            actor.tenant_id)
        return [dict(r) for r in rows]


@router.get("/nurture-sequences")
async def list_nurture(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            "SELECT id,name,trigger_event,steps,is_active,created_at "
            "FROM nurture_sequences WHERE tenant_id=$1 ORDER BY name", actor.tenant_id)
        return [dict(r) for r in rows]


@router.post("/mark-all-read")
async def mark_all_read(body: dict = None, actor: Actor = Depends(get_actor)):
    """Mark all emails as read in a folder.

    Real bug fix (2026-08-31, found while closing the IMAP write-endpoint
    ownership gap in this same file): this previously ignored `folder`
    entirely beyond a bare gate check, and ignored the caller's own
    identity entirely — every click, from any real user, in any real
    folder, marked EVERY imap_messages row AND EVERY candidate_messages
    row in the WHOLE TENANT as read, tenant-wide, regardless of which
    mailbox owned them. A real, live "Mark all as read" button was
    silently wiping every other user's unread state on every click.
    Rewritten to scope by both: non-admin roles only ever touch their own
    connected mailbox (matching _INBOX_ADMIN_ROLES/_own_ats_message_filter,
    the same convention every read-side folder endpoint in this file
    already uses), and only the real folder actually being viewed — the
    exact WHERE clauses mirror each folder's own dedicated GET endpoint
    (inbox/`/inbox`, sent/`/sent`, archive/`/archive`, junk/`/junk`,
    starred/`/starred`, snoozed via snoozed_until, whatsapp via
    channel='whatsapp'). `drafts` has no is_read column at all — correctly
    a no-op, matching prior behavior for any other unrecognized folder."""
    folder = (body or {}).get('folder', 'inbox')
    is_admin = actor.role in _INBOX_ADMIN_ROLES or actor.role is None
    async with db.tenant_conn(actor.tenant_id) as conn:
        own_imap = "" if is_admin else " AND EXISTS (SELECT 1 FROM user_email_accounts ua WHERE ua.id=im.account_id AND ua.user_id=$2)"
        imap_params = [actor.tenant_id] if is_admin else [actor.tenant_id, actor.user_id]

        if folder in ('inbox', 'ats_inbox'):
            await conn.execute(
                f"UPDATE imap_messages im SET is_read=TRUE WHERE im.tenant_id=$1 AND im.is_deleted IS NOT TRUE AND im.folder='INBOX'{own_imap}",
                *imap_params)
        elif folder == 'sent':
            await conn.execute(
                f"UPDATE imap_messages im SET is_read=TRUE WHERE im.tenant_id=$1 AND im.is_deleted IS NOT TRUE AND im.folder LIKE '%Sent%'{own_imap}",
                *imap_params)
        elif folder == 'starred':
            await conn.execute(
                f"UPDATE imap_messages im SET is_read=TRUE WHERE im.tenant_id=$1 AND im.is_deleted IS NOT TRUE AND im.is_starred=TRUE{own_imap}",
                *imap_params)
        elif folder == 'archive':
            await conn.execute(
                f"UPDATE imap_messages im SET is_read=TRUE WHERE im.tenant_id=$1 AND im.is_deleted IS NOT TRUE AND im.folder ILIKE '%archive%'{own_imap}",
                *imap_params)
        elif folder == 'junk':
            await conn.execute(
                f"UPDATE imap_messages im SET is_read=TRUE WHERE im.tenant_id=$1 AND im.is_deleted IS NOT TRUE AND (im.folder ILIKE '%junk%' OR im.folder ILIKE '%spam%'){own_imap}",
                *imap_params)
        elif folder == 'snoozed':
            await conn.execute(
                f"UPDATE imap_messages im SET is_read=TRUE WHERE im.tenant_id=$1 AND im.is_deleted IS NOT TRUE AND im.snoozed_until IS NOT NULL{own_imap}",
                *imap_params)
        elif folder == 'trash':
            await conn.execute(
                f"UPDATE imap_messages im SET is_read=TRUE WHERE im.tenant_id=$1 AND im.is_deleted=TRUE{own_imap}",
                *imap_params)

        if folder in ('inbox', 'ats_inbox'):
            if is_admin:
                await conn.execute(
                    "UPDATE candidate_messages SET is_read=TRUE WHERE tenant_id=$1 AND is_deleted IS NOT TRUE",
                    actor.tenant_id)
            else:
                await conn.execute(
                    f"UPDATE candidate_messages cm SET is_read=TRUE WHERE cm.tenant_id=$1 AND cm.is_deleted IS NOT TRUE AND {_own_ats_message_filter(2)}",
                    actor.tenant_id, actor.user_id)
        elif folder == 'whatsapp':
            if is_admin:
                await conn.execute(
                    "UPDATE candidate_messages SET is_read=TRUE WHERE tenant_id=$1 AND channel='whatsapp' AND is_deleted IS NOT TRUE",
                    actor.tenant_id)
            else:
                await conn.execute(
                    f"UPDATE candidate_messages cm SET is_read=TRUE WHERE cm.tenant_id=$1 AND cm.channel='whatsapp' AND cm.is_deleted IS NOT TRUE AND {_own_ats_message_filter(2)}",
                    actor.tenant_id, actor.user_id)
        elif folder == 'starred':
            if is_admin:
                await conn.execute(
                    "UPDATE candidate_messages SET is_read=TRUE WHERE tenant_id=$1 AND is_starred=TRUE AND is_deleted IS NOT TRUE",
                    actor.tenant_id)
            else:
                await conn.execute(
                    f"UPDATE candidate_messages cm SET is_read=TRUE WHERE cm.tenant_id=$1 AND cm.is_starred=TRUE AND cm.is_deleted IS NOT TRUE AND {_own_ats_message_filter(2)}",
                    actor.tenant_id, actor.user_id)
    return {"ok": True}


@router.get("/archive")
async def archive_list(limit: int = Query(200, le=500), offset: int = Query(0), actor: Actor = Depends(get_actor)):
    """Emails in Archive folder (INBOX.Outlook.Archive, INBOX.Archive, etc.)"""
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT
                im.id, im.candidate_id,
                COALESCE(NULLIF(im.from_name,''), NULLIF(im.from_email,''), 'Unknown Sender') AS candidate_name,
                im.from_email AS email, im.folder AS imap_folder, im.imap_uid AS imap_uid,
                NULL::text AS phone, 'email'::text AS channel, 'inbound'::text AS direction,
                COALESCE(im.subject,'(no subject)') AS subject,
                COALESCE(im.html_body, im.body, '') AS body,
                'received'::text AS status, im.received_at AS created_at, NULL::text AS deleted_at,
                ua.display_name AS sent_by_name, im.is_read, im.is_starred,
                im.to_email, im.cc,
                1::bigint AS msg_count, (CASE WHEN im.is_read THEN 0 ELSE 1 END)::bigint AS unread_count,
                CASE WHEN im.attachments IS NOT NULL AND jsonb_array_length(im.attachments)>0
                     THEN (SELECT jsonb_agg(jsonb_build_object('filename',a->>'filename','mime_type',a->>'mime_type','size',(a->>'size')::int)) FROM jsonb_array_elements(im.attachments) a)
                     ELSE '[]'::jsonb END AS attachments
            FROM imap_messages im
            JOIN user_email_accounts ua ON ua.id = im.account_id
            WHERE im.tenant_id=$1 AND ua.user_id=$2
              AND im.folder ILIKE '%archive%'
              AND im.is_deleted IS NOT TRUE
            ORDER BY im.received_at DESC LIMIT $3 OFFSET $4
        """, actor.tenant_id, actor.user_id, limit, offset)
        result = [dict(r) for r in rows]
        for m in result:
            if 'attachments' in m and isinstance(m['attachments'], str):
                try: m['attachments'] = __import__('json').loads(m['attachments'] or '[]')
                except: m['attachments'] = []
        for m in result:
            if 'attachments' in m and isinstance(m['attachments'], str):
                try: m['attachments'] = __import__('json').loads(m['attachments'] or '[]')
                except: m['attachments'] = []
        return result



@router.get("/junk")
async def junk_list(limit: int = Query(200, le=500), offset: int = Query(0), actor: Actor = Depends(get_actor)):
    """Emails in Junk/Spam folder"""
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT
                im.id, im.candidate_id,
                COALESCE(NULLIF(im.from_name,''), NULLIF(im.from_email,''), 'Unknown Sender') AS candidate_name,
                im.from_email AS email, im.folder AS imap_folder, im.imap_uid AS imap_uid,
                NULL::text AS phone, 'email'::text AS channel, 'inbound'::text AS direction,
                COALESCE(im.subject,'(no subject)') AS subject,
                COALESCE(im.html_body, im.body, '') AS body,
                'received'::text AS status, im.received_at AS created_at, NULL::text AS deleted_at,
                ua.display_name AS sent_by_name, im.is_read, im.is_starred,
                im.to_email, im.cc,
                1::bigint AS msg_count, (CASE WHEN im.is_read THEN 0 ELSE 1 END)::bigint AS unread_count,
                CASE WHEN im.attachments IS NOT NULL AND jsonb_array_length(im.attachments)>0
                     THEN (SELECT jsonb_agg(jsonb_build_object('filename',a->>'filename','mime_type',a->>'mime_type','size',(a->>'size')::int)) FROM jsonb_array_elements(im.attachments) a)
                     ELSE '[]'::jsonb END AS attachments
            FROM imap_messages im
            JOIN user_email_accounts ua ON ua.id = im.account_id
            WHERE im.tenant_id=$1 AND ua.user_id=$2
              AND (im.folder ILIKE '%junk%' OR im.folder ILIKE '%spam%')
              AND im.is_deleted IS NOT TRUE
            ORDER BY im.received_at DESC LIMIT $3 OFFSET $4
        """, actor.tenant_id, actor.user_id, limit, offset)
        result = [dict(r) for r in rows]
        for m in result:
            if 'attachments' in m and isinstance(m['attachments'], str):
                try: m['attachments'] = __import__('json').loads(m['attachments'] or '[]')
                except: m['attachments'] = []
        for m in result:
            if 'attachments' in m and isinstance(m['attachments'], str):
                try: m['attachments'] = __import__('json').loads(m['attachments'] or '[]')
                except: m['attachments'] = []
        return result



@router.post("/imap/{msg_id}/snooze")
async def snooze_imap(msg_id: str, body: dict = None, actor: Actor = Depends(get_actor)):
    """Snooze an IMAP email until a given time"""
    import re
    from datetime import datetime
    if not re.match(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', msg_id, re.I):
        raise HTTPException(400, "Invalid message ID")
    until_str = (body or {}).get('until', '')
    async with db.tenant_conn(actor.tenant_id) as conn:
        await _assert_imap_writable(conn, msg_id, actor)
        if until_str:
            try:
                until_dt = datetime.fromisoformat(until_str.replace('Z', '+00:00'))
                await conn.execute(
                    "UPDATE imap_messages SET snoozed_until=$1 WHERE id=$2 AND tenant_id=$3",
                    until_dt, msg_id, actor.tenant_id)
            except Exception as ex:
                print(f"[Snooze] Error: {ex}")
    return {"ok": True}


@router.post("/imap/{msg_id}/archive")
async def archive_imap(msg_id: str, actor: Actor = Depends(get_actor)):
    """Move IMAP email to the Archive folder.

    REAL BUG FIX (2026-08-12 sidebar/orphaned-endpoint audit): this
    previously set is_deleted=TRUE — the exact same effect as trash_imap_ep
    below — silently moving an "archived" email to Trash instead. Never
    caught because nothing in the frontend called this endpoint before now.
    Fixed to match the same folder convention move_imap_message and
    archive_list (GET /communications/archive, `folder ILIKE '%archive%'`)
    already use.
    """
    async with db.tenant_conn(actor.tenant_id) as conn:
        await _assert_imap_writable(conn, msg_id, actor)
        await conn.execute(
            "UPDATE imap_messages SET folder='INBOX.Outlook.Archive' WHERE id=$1 AND tenant_id=$2",
            msg_id, actor.tenant_id)
    return {"archived": True}


@router.get("/search")
async def search_emails(
    q: str = Query(""),
    from_addr: str = Query(""),
    to_addr: str = Query(""),
    has_attachment: bool = Query(False),
    date_from: str = Query(""),
    date_to: str = Query(""),
    opened: Optional[bool] = Query(None),
    replied: Optional[bool] = Query(None),
    pending_followup: bool = Query(False),
    high_priority: bool = Query(False),
    limit: int = Query(100, le=200),
    actor: Actor = Depends(get_actor)
):
    """Advanced email search across all IMAP folders — plus, real
    filters (2026-09-03 audit, gap #10) for opened/not-opened/replied/
    not-replied/pending-follow-up/high-priority. Those 6 concepts only
    ever exist on OUTBOUND (candidate_messages) rows — opened/replied
    with a non-None value switches the search to that table entirely
    (an inbound IMAP email has no "opened by recipient" concept at all);
    pending_followup/high_priority are additive filters layered on top
    of either mode."""
    if opened is not None or replied is not None:
        conditions = ["cm.tenant_id=$1", "cm.is_deleted IS NOT TRUE", "cm.channel='email'"]
        params = [actor.tenant_id]
        if actor.role not in _INBOX_ADMIN_ROLES:
            params.append(actor.user_id)
            conditions.append(_own_ats_message_filter(len(params)))
        if q:
            params.append(f"%{q}%")
            conditions.append(f"(cm.subject ILIKE ${len(params)} OR cm.body ILIKE ${len(params)} OR cm.to_email ILIKE ${len(params)})")
        if to_addr:
            params.append(f"%{to_addr}%")
            conditions.append(f"cm.to_email ILIKE ${len(params)}")
        if opened is True:
            conditions.append("cm.email_open_count > 0")
        elif opened is False:
            conditions.append("cm.email_open_count = 0")
        if replied is True:
            conditions.append("cm.replied_at IS NOT NULL")
        elif replied is False:
            conditions.append("cm.replied_at IS NULL AND cm.direction='outbound'")
        if date_from:
            try:
                from datetime import date as _date
                params.append(_date.fromisoformat(date_from))
            except Exception:
                params.append(date_from)
            conditions.append("cm.created_at::date >= $"+str(len(params)))
        if date_to:
            try:
                from datetime import date as _date
                params.append(_date.fromisoformat(date_to))
            except Exception:
                params.append(date_to)
            conditions.append("cm.created_at::date <= $"+str(len(params)))
        if pending_followup:
            conditions.append(
                """EXISTS (SELECT 1 FROM recruiter_tasks rt
                           WHERE rt.tenant_id=cm.tenant_id AND rt.candidate_id=cm.candidate_id
                             AND rt.status IN ('pending','in_progress'))""")
        if high_priority:
            conditions.append(
                """EXISTS (SELECT 1 FROM recruiter_tasks rt
                           WHERE rt.tenant_id=cm.tenant_id AND rt.candidate_id=cm.candidate_id
                             AND rt.status IN ('pending','in_progress')
                             AND rt.priority IN ('high','critical'))""")
        where = " AND ".join(conditions)
        params.append(limit)
        async with db.tenant_conn(actor.tenant_id) as conn:
            rows = await conn.fetch(f"""
                SELECT {MSG_COLS},
                       cm.replied_at, cm.reply_count, cm.bounced_at, cm.link_click_count,
                       cm.attachment_download_count, cm.client_id
                {MSG_JOINS}
                WHERE {where}
                ORDER BY cm.created_at DESC LIMIT ${len(params)}
            """, *params)
            return [dict(r) for r in rows]

    conditions = ["im.tenant_id=$1", "ua.user_id=$2", "im.is_deleted IS NOT TRUE"]
    params = [actor.tenant_id, actor.user_id]

    if q:
        params.append(f"%{q}%")
        conditions.append(f"(im.subject ILIKE ${len(params)} OR im.from_name ILIKE ${len(params)} OR im.from_email ILIKE ${len(params)})")
    if from_addr:
        params.append(f"%{from_addr}%")
        conditions.append(f"(im.from_email ILIKE ${len(params)} OR im.from_name ILIKE ${len(params)})")
    if to_addr:
        params.append(f"%{to_addr}%")
        conditions.append(f"im.to_email ILIKE ${len(params)}")
    if has_attachment:
        conditions.append("im.attachments IS NOT NULL AND jsonb_array_length(im.attachments) > 0")
    if date_from:
        try:
            from datetime import date as _date
            params.append(_date.fromisoformat(date_from))
        except Exception:
            params.append(date_from)
        conditions.append("im.received_at::date >= $"+str(len(params)))
    if date_to:
        try:
            from datetime import date as _date
            params.append(_date.fromisoformat(date_to))
        except Exception:
            params.append(date_to)
        conditions.append("im.received_at::date <= $"+str(len(params)))

    where = " AND ".join(conditions)
    params.append(limit)

    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(f"""
            SELECT
                im.id, im.candidate_id,
                COALESCE(NULLIF(im.from_name,''), NULLIF(im.from_email,''), 'Unknown Sender') AS candidate_name,
                im.from_email AS email, im.folder AS imap_folder, im.imap_uid AS imap_uid,
                NULL::text AS phone, 'email'::text AS channel, 'inbound'::text AS direction,
                COALESCE(im.subject,'(no subject)') AS subject,
                COALESCE(im.html_body, im.body, '') AS body,
                'received'::text AS status, im.received_at AS created_at, NULL::text AS deleted_at,
                ua.display_name AS sent_by_name, im.is_read, im.is_starred,
                im.to_email, im.cc,
                1::bigint AS msg_count, (CASE WHEN im.is_read THEN 0 ELSE 1 END)::bigint AS unread_count,
                CASE WHEN im.attachments IS NOT NULL AND jsonb_array_length(im.attachments)>0
                     THEN (SELECT jsonb_agg(jsonb_build_object('filename',a->>'filename','mime_type',a->>'mime_type','size',(a->>'size')::int)) FROM jsonb_array_elements(im.attachments) a)
                     ELSE '[]'::jsonb END AS attachments
            FROM imap_messages im
            JOIN user_email_accounts ua ON ua.id = im.account_id
            WHERE {where}
            ORDER BY im.received_at DESC LIMIT ${len(params)}
        """, *params)
        result = [dict(r) for r in rows]
        for m in result:
            if 'attachments' in m and isinstance(m['attachments'], str):
                try: m['attachments'] = __import__('json').loads(m['attachments'] or '[]')
                except: m['attachments'] = []
        return result


@router.post("/imap/{msg_id}/move")
async def move_imap_message(msg_id: str, body: dict = None, actor: Actor = Depends(get_actor)):
    """Move an IMAP message to a different folder (update DB folder record)"""
    import re
    # Validate UUID format to avoid asyncpg error
    if not re.match(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', msg_id, re.I):
        raise HTTPException(400, "Invalid message ID")
    target_folder = (body or {}).get('folder', 'INBOX.Outlook.Archive')
    async with db.tenant_conn(actor.tenant_id) as conn:
        await _assert_imap_writable(conn, msg_id, actor)
        # Update folder in DB (visual move — IMAP server move requires open connection)
        await conn.execute(
            "UPDATE imap_messages SET folder=$1 WHERE id=$2 AND tenant_id=$3",
            target_folder, msg_id, actor.tenant_id)
    return {"moved": True, "message_id": msg_id, "to_folder": target_folder}
