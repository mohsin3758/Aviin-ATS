"""Enhanced WhatsApp Bot — candidate self-service via WAHA."""
import httpx, os
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
import db
from deps import Actor, get_actor

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
# (payload.hasMedia + payload.media.{url,mimetype,filename}) — this session's
# WAHA instance has no connected session (status: FAILED, needs a QR re-scan
# by the team) so this could not be exercised against a real inbound
# WhatsApp message; the downstream parse/classify/upsert pipeline was
# verified directly against a real downloadable PDF instead. See CLAUDE.md.
_RESUME_MIME_HINTS = ("pdf", "msword", "wordprocessingml")


async def _download_waha_media(media: dict) -> Optional[bytes]:
    url = media.get("url")
    if not url:
        return None
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(url, headers={"X-Api-Key": WAHA_KEY})
            if r.status_code == 200:
                return r.content
    except Exception as ex:
        print(f"WAHA media download failed: {ex}")
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
        elif cmd == "CALLBACK":
            return f"Hi {name}! A recruiter will call you within 2 hours. Office: Mon-Sat 9AM-7PM IST"
        elif cmd in ("ACCEPT", "DECLINE"):
            action = "accepted" if cmd == "ACCEPT" else "declined"
            return f"Hi {name}! Your response ({action}) has been noted. Team will contact you within 24h."
        else:
            return HELP_MSG

@router.post("/webhook")
async def webhook(request: Request):
    try:
        data = await request.json()
        msg  = data.get("payload", {})
        text = (msg.get("body") or "").strip()
        from_  = msg.get("from", "")
        phone  = from_.replace("@c.us","").replace("@g.us","")
        has_media = bool(msg.get("hasMedia"))
        # Media messages often have an empty/caption-only body — check media
        # BEFORE the text-emptiness bail below, or a resume with no caption
        # would be silently dropped.
        if (not text and not has_media) or msg.get("fromMe") or "@g.us" in from_:
            return {"ok": True}
        async with db.system_conn() as conn:
            tenant = await conn.fetchrow("SELECT id FROM tenants LIMIT 1")
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
async def send_message(phone: str, message: str, actor: Actor = Depends(get_actor)):
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
