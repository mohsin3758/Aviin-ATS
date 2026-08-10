"""Enhanced WhatsApp Bot — candidate self-service via WAHA."""
import httpx, os
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
import db
from deps import Actor, get_actor, require_role

router = APIRouter(prefix="/whatsapp-bot", tags=["whatsapp-bot"])

WAHA_URL = os.getenv("WAHA_URL", "http://waha:3000")
WAHA_KEY  = os.getenv("WAHA_API_KEY", "")
SESSION   = "default"

HELP_LINES = [
    "*AVIIN Jobs Bot*",
    "",
    "Commands:",
    "STATUS — Check application status",
    "INTERVIEW — View upcoming interview",
    "OFFER — Check offer details",
    "CALLBACK — Request recruiter callback",
    "ACCEPT — Accept your offer",
    "DECLINE — Decline your offer",
]
HELP_MSG = "\n".join(HELP_LINES)

async def send_wa(phone: str, message: str) -> bool:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                f"{WAHA_URL}/api/sendText",
                headers={"X-Api-Key": WAHA_KEY, "Content-Type": "application/json"},
                json={"session": SESSION, "chatId": f"{phone}@c.us", "text": message}
            )
            return r.status_code < 400
    except Exception:
        return False


# ─── Inbound resume via WhatsApp ──────────────────────────────────────────────
# Built against WAHA's documented webhook contract for media messages
# (payload.hasMedia + payload.media.{url,mimetype,filename}) — verified
# end-to-end against real inbound WhatsApp messages with real resume
# attachments (2026-08-08, see CLAUDE.md). Fixed three real bugs found only
# by that live testing: the webhook URL WAHA stores can go stale after any
# backend container recreation (now points at the stable "backend" Docker
# service name, not a raw IP); WAHA's own media.url embeds its own
# self-referencing host ("localhost:3000", meaningless outside its own
# container) instead of a URL this container can actually reach; and
# WhatsApp's newer privacy-preserving "LID" sender identifiers (no phone
# number anywhere in the message payload at all) need a separate resolution
# call (see _resolve_phone).
_RESUME_MIME_HINTS = ("pdf", "msword", "wordprocessingml")


async def _download_waha_media(media: dict) -> Optional[bytes]:
    url = media.get("url")
    if not url:
        return None
    # WAHA embeds its own self-referencing host in the media URL (e.g.
    # "http://localhost:3000/...", correct from WAHA's own container's point
    # of view since it serves files on its own port 3000) — but that host is
    # meaningless from the backend container's network namespace, where
    # "localhost" is the backend's own loopback with nothing on port 3000.
    # Rewrite to the real internal Docker service address before fetching.
    from urllib.parse import urlsplit, urlunsplit
    parts = urlsplit(url)
    waha_parts = urlsplit(WAHA_URL)
    url = urlunsplit((waha_parts.scheme, waha_parts.netloc, parts.path, parts.query, parts.fragment))
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(url, headers={"X-Api-Key": WAHA_KEY})
            if r.status_code == 200:
                return r.content
            print(f"WAHA media download got status {r.status_code} for {url}")
    except Exception as ex:
        print(f"WAHA media download failed: {ex} (url={url})")
    return None


async def _handle_inbound_resume(phone: str, media: dict, tenant_id: str) -> str:
    """Download + parse an inbound WhatsApp resume attachment, upsert a
    candidate (same regex-NER pipeline as email intake), log a resume_files
    row, and return the WhatsApp reply text to send back."""
    from services.resume_intake_service import (
        extract_text_from_attachment, upsert_candidate, save_resume_file,
    )
    from services.document_classifier import classify_document
    from services.improved_parser import parse_resume_v2
    import json as _json

    mimetype = (media.get("mimetype") or "").lower()
    filename = media.get("filename") or "resume.pdf"
    if not any(h in mimetype for h in _RESUME_MIME_HINTS) and not filename.lower().endswith((".pdf", ".doc", ".docx")):
        return "We can only accept resumes as PDF or Word documents right now."

    data = await _download_waha_media(media)
    if not data:
        return "We couldn't download your file — please try sending it again."

    text = extract_text_from_attachment(data, mimetype, filename)
    if not text or len(text.strip()) < 50:
        return "We received your file but couldn't read its contents — please send a PDF or Word resume."

    doc_result = classify_document(text, filename)
    if not doc_result.is_resume and doc_result.decision == "REJECT":
        return "Thanks for sharing, but this doesn't look like a resume — please send your CV as a PDF or Word file."

    parsed = parse_resume_v2(text, from_name="", from_email="", filename=filename)
    parsed["phone"] = phone  # authoritative — this WhatsApp number is a verified real channel identity

    file_path = save_resume_file(data, tenant_id, filename)
    async with db.tenant_conn(tenant_id) as conn:
        candidate_id = await upsert_candidate(
            conn, tenant_id, parsed, "whatsapp", "WhatsApp Inbound",
            f"{phone}@whatsapp", file_path, text)
        await conn.execute(
            """INSERT INTO resume_files
                 (tenant_id, candidate_id, job_board, job_board_label, source_email,
                  file_name, file_path, mime_type, file_size,
                  parse_status, parsed_data, parse_confidence, routing_decision)
               VALUES ($1,$2,'whatsapp','WhatsApp Inbound',$3,$4,$5,$6,$7,'auto_accepted',$8,$9,'auto_accepted')""",
            tenant_id, candidate_id, f"{phone}@whatsapp", filename, file_path, mimetype, len(data),
            _json.dumps(parsed), round(float(parsed.get("_confidence", 0.7) or 0.7), 3))
        # Real fix (2026-08-10 audit): inbound WhatsApp was never logged to
        # candidate_messages, so the Conversations page's WhatsApp folder
        # could never show an inbound message even though real ones arrive
        # daily. Logged here (resume) and in handle_cmd (commands) below.
        await conn.execute("""
            INSERT INTO candidate_messages
              (tenant_id, candidate_id, channel, direction, body, status)
            VALUES ($1,$2,'whatsapp','inbound',$3,'received')
        """, tenant_id, candidate_id, f"[Resume attachment: {filename}]")

    first_name = (parsed.get("name") or "").split()[0] if parsed.get("name") else ""
    greeting = f"Thanks {first_name}!" if first_name else "Thanks!"
    return f"{greeting} We've received your resume and added it to our system. Our recruitment team will review it and reach out if there's a matching opportunity."

async def handle_cmd(phone: str, text: str, tenant_id: str) -> str:
    cmd = text.strip().upper().split()[0] if text.strip() else "HELP"
    async with db.tenant_conn(tenant_id) as conn:
        cand = await conn.fetchrow(
            "SELECT * FROM candidates WHERE phone LIKE '%'||$1||'%' AND tenant_id=$2 LIMIT 1",
            phone[-10:], tenant_id)
        if not cand:
            return "Hi! We don't have your number on file. Contact your recruiter."
        name = cand["full_name"].split()[0]
        # Real fix (2026-08-10 audit): see the matching note in
        # _handle_inbound_resume — inbound commands were never logged either.
        await conn.execute("""
            INSERT INTO candidate_messages
              (tenant_id, candidate_id, channel, direction, body, status)
            VALUES ($1,$2,'whatsapp','inbound',$3,'received')
        """, tenant_id, cand["id"], text[:2000])
        if cmd == "STATUS":
            apps = await conn.fetch(
                "SELECT a.stage, r.title FROM applications a "
                "JOIN requisitions r ON r.id=a.requisition_id "
                "WHERE a.candidate_id=$1 AND a.tenant_id=$2 ORDER BY a.updated_at DESC LIMIT 3",
                cand["id"], tenant_id)
            if not apps:
                return f"Hi {name}! No active applications. Contact your recruiter."
            lines = [f"Hi {name}! Your applications:"]
            for a in apps:
                lines.append(f"- {a['title']} : {a['stage'].upper()}")
            return "\n".join(lines)
        elif cmd == "INTERVIEW":
            iv = await conn.fetchrow(
                "SELECT i.scheduled_at, i.interview_type, i.mode, i.meeting_link, r.title "
                "FROM interview_schedules i "
                "JOIN candidates c ON c.id=i.candidate_id "
                "LEFT JOIN requisitions r ON r.id=i.requisition_id "
                "WHERE c.phone LIKE '%'||$1||'%' AND i.status='scheduled' "
                "AND i.scheduled_at > now() AND i.tenant_id=$2 ORDER BY i.scheduled_at LIMIT 1",
                phone[-10:], tenant_id)
            if not iv:
                return f"Hi {name}! No upcoming interviews scheduled."
            sched = iv["scheduled_at"]
            lines = [
                f"Hi {name}! Your interview:",
                f"Date: {sched.strftime('%d %b %Y at %I:%M %p')}",
                f"Role: {iv['title'] or 'TBD'}",
                f"Type: {iv['interview_type']} ({iv['mode']})",
                f"Link: {iv['meeting_link'] or 'Will be shared separately'}",
            ]
            return "\n".join(lines)
        elif cmd == "OFFER":
            # Real fix (2026-08-10 audit): OFFER was advertised in HELP_LINES
            # and the frontend's COMMANDS list but had no branch here at all -
            # fell through to the help menu, which told the candidate to type
            # OFFER, which showed them the help menu again.
            off = await conn.fetchrow("""
                SELECT o.status, o.ctc_offered, o.currency, o.joining_date, r.title
                FROM offers o
                JOIN applications a ON a.id = o.application_id
                JOIN requisitions r ON r.id = a.requisition_id
                WHERE a.candidate_id=$1 AND o.tenant_id=$2
                ORDER BY o.created_at DESC LIMIT 1
            """, cand["id"], tenant_id)
            if not off:
                return f"Hi {name}! No offer on file yet. Contact your recruiter for updates."
            if off["status"] in ("draft", "pending_approval", "approved"):
                return f"Hi {name}! Your offer for {off['title']} is being finalized internally. We'll share full details once it's issued."
            lines = [f"Hi {name}! Your offer for {off['title']}:", f"Status: {off['status'].upper()}"]
            if off["ctc_offered"]:
                lines.append(f"CTC: {off['currency'] or 'INR'} {off['ctc_offered']:,.0f}")
            if off["joining_date"]:
                lines.append(f"Joining: {off['joining_date'].strftime('%d %b %Y')}")
            if off["status"] == "issued":
                lines.append("Reply ACCEPT or DECLINE to respond.")
            return "\n".join(lines)
        elif cmd == "CALLBACK":
            # Real fix: used to be a no-op reassurance with nothing written
            # anywhere. Now creates a real recruiter_tasks row, same pattern
            # as the auto-created tasks on stage changes (applications.py).
            app_row = await conn.fetchrow("""
                SELECT a.id AS application_id, a.requisition_id, a.assigned_recruiter_id, r.title
                FROM applications a JOIN requisitions r ON r.id=a.requisition_id
                WHERE a.candidate_id=$1 AND a.tenant_id=$2
                ORDER BY a.updated_at DESC LIMIT 1
            """, cand["id"], tenant_id)
            await conn.execute("""
                INSERT INTO recruiter_tasks
                  (tenant_id, requisition_id, application_id, candidate_name, req_title,
                   recruiter_id, task_type, title, priority)
                VALUES ($1,$2,$3,$4,$5,$6,'callback_request',$7,'high')
            """, tenant_id, app_row["requisition_id"] if app_row else None,
                 app_row["application_id"] if app_row else None, cand["full_name"],
                 app_row["title"] if app_row else None,
                 app_row["assigned_recruiter_id"] if app_row else None,
                 f"Callback requested by {cand['full_name']} via WhatsApp")
            return f"Hi {name}! A recruiter will call you within 2 hours. Office: Mon-Sat 9AM-7PM IST"
        elif cmd in ("ACCEPT", "DECLINE"):
            # Real fix: used to write nothing anywhere despite telling the
            # candidate their response "has been noted". Per explicit
            # decision (2026-08-10): a WhatsApp reply is not a verified
            # identity the way an e-signed link is, so this notifies the
            # recruiter to confirm and act rather than directly flipping a
            # real offer's status (keeps a human in the loop for this
            # high-stakes action, same spirit as HARD RULE #10).
            action = "ACCEPTED" if cmd == "ACCEPT" else "DECLINED"
            app_row = await conn.fetchrow("""
                SELECT a.assigned_recruiter_id, r.title
                FROM applications a JOIN requisitions r ON r.id=a.requisition_id
                WHERE a.candidate_id=$1 AND a.tenant_id=$2
                ORDER BY a.updated_at DESC LIMIT 1
            """, cand["id"], tenant_id)
            recipient = app_row["assigned_recruiter_id"] if app_row else None
            if not recipient:
                manager = await conn.fetchrow(
                    "SELECT id FROM users WHERE tenant_id=$1 AND role='manager' LIMIT 1", tenant_id)
                recipient = manager["id"] if manager else None
            if recipient:
                await conn.execute("""
                    INSERT INTO notifications
                      (tenant_id, user_id, recipient_user_id, title, body, type, resource, channel)
                    VALUES ($1,$2,$2,$3,$4,'warning','candidate','inapp')
                """, tenant_id, recipient, f"Offer {action.lower()} via WhatsApp",
                     f"{cand['full_name']} replied {action} to their offer for {app_row['title'] if app_row else 'their role'} via WhatsApp — please confirm and action manually.")
            return f"Hi {name}! Your response ({action.lower()}) has been noted. Team will contact you within 24h."
        else:
            return HELP_MSG

async def _resolve_phone(from_: str) -> str:
    """WhatsApp's newer privacy-preserving LID identifiers (e.g.
    "184018024837218@lid") replace the real phone-based JID entirely in the
    message payload — there is no phone number anywhere in the webhook data
    for these senders, confirmed by inspecting a real payload end-to-end.
    WAHA exposes a real resolution endpoint for this (undocumented in its
    OpenAPI listing, found by probing): GET /api/{session}/lids/{lid} ->
    {"lid": "...", "pn": "<real>@c.us"}."""
    if "@lid" not in from_:
        return from_.replace("@c.us", "").replace("@g.us", "")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{WAHA_URL}/api/{SESSION}/lids/{from_}",
                                  headers={"X-Api-Key": WAHA_KEY})
            if r.status_code == 200:
                pn = r.json().get("pn", "")
                if pn:
                    return pn.replace("@c.us", "")
    except Exception as ex:
        print(f"LID resolution failed: {ex} (lid={from_})")
    return from_.replace("@lid", "")  # last resort — not a real phone number


@router.post("/webhook")
async def webhook(request: Request):
    try:
        data = await request.json()
        msg  = data.get("payload", {})
        text = (msg.get("body") or "").strip()
        from_  = msg.get("from", "")
        phone  = await _resolve_phone(from_)
        has_media = bool(msg.get("hasMedia"))
        # Media messages often have an empty/caption-only body — check media
        # BEFORE the text-emptiness bail below, or a resume with no caption
        # would be silently dropped.
        if (not text and not has_media) or msg.get("fromMe") or "@g.us" in from_:
            return {"ok": True}
        # Real bug fix (2026-08-10 audit): no ORDER BY meant this returned
        # whatever row Postgres physically stored first, which flips
        # unpredictably (any UPDATE on the "first" tenant's own row can move
        # it later in physical storage). Confirmed live: this had silently
        # started returning the wrong tenant, misrouting every real inbound
        # WhatsApp message. The bot has no real number->tenant mapping
        # (single-tenant by design, a separate, bigger limitation not fixed
        # here) - ORDER BY created_at picks the same, real primary tenant
        # deterministically instead of depending on physical row order.
        async with db.system_conn() as conn:
            tenant = await conn.fetchrow("SELECT id FROM tenants ORDER BY created_at ASC LIMIT 1")
        if not tenant:
            return {"ok": True}
        tenant_id = str(tenant["id"])
        if has_media:
            reply = await _handle_inbound_resume(phone, msg.get("media") or {}, tenant_id)
            await send_wa(phone, reply)
            return {"ok": True}
        response = await handle_cmd(phone, text, tenant_id)
        await send_wa(phone, response)
    except Exception as e:
        print(f"WhatsApp webhook error: {e}")
    return {"ok": True}

@router.post("/send")
async def send_message(phone: str, message: str, actor: Actor = Depends(require_role("admin", "manager"))):
    """Raw connectivity-test send (arbitrary phone, no candidate_id) - not a
    candidate-consent path, but the same 'send arbitrary WhatsApp to
    arbitrary number' danger class as /waha/send, so held to the same bar."""
    success = await send_wa(phone, message)
    return {"sent": success, "phone": phone}

@router.get("/status")
async def bot_status(actor: Actor = Depends(get_actor)):
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{WAHA_URL}/api/sessions/default", headers={"X-Api-Key": WAHA_KEY})
            if r.status_code == 200:
                waha_ok = r.json().get("status") == "WORKING"
            else:
                waha_ok = False
    except Exception:
        waha_ok = False
    return {"waha_connected": waha_ok, "commands": ["HELP","STATUS","INTERVIEW","CALLBACK","ACCEPT","DECLINE"]}
