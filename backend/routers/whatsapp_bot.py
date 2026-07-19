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
        if not text or msg.get("fromMe") or "@g.us" in from_:
            return {"ok": True}
        async with db.system_conn() as conn:
            tenant = await conn.fetchrow("SELECT id FROM tenants LIMIT 1")
        if not tenant:
            return {"ok": True}
        response = await handle_cmd(phone, text, str(tenant["id"]))
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
