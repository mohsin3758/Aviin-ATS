"""SMS Notifications router."""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import db
from deps import Actor, get_actor
from services.sms_service import send_sms, render_template, is_configured, SMS_TEMPLATES

router = APIRouter(prefix="/sms", tags=["sms"])

class SmsIn(BaseModel):
    to_phone: str
    message: Optional[str] = None
    template: Optional[str] = None
    variables: dict = {}

@router.post("/send")
async def send(body: SmsIn, actor: Actor = Depends(get_actor)):
    msg = body.message or render_template(body.template or "", body.variables)
    if not msg:
        raise HTTPException(400, "Provide message or template")
    result = await send_sms(body.to_phone, msg, body.template or "custom")
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute("""
            INSERT INTO sms_log (tenant_id,to_phone,message,template,status,provider_id,error,sent_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,CASE WHEN $5='sent' THEN now() ELSE NULL END)
        """, actor.tenant_id, body.to_phone, msg, body.template or "custom",
             result["status"], result.get("provider_id"), result.get("error"))
    return {**result, "preview": msg[:100]}

@router.post("/reminder/{interview_id}")
async def interview_reminder(interview_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        iv = await conn.fetchrow("""
            SELECT i.*, c.full_name AS cname, c.phone,
                   r.title AS role FROM interview_schedules i
            JOIN candidates c ON c.id=i.candidate_id
            LEFT JOIN requisitions r ON r.id=i.requisition_id
            WHERE i.id=$1 AND i.tenant_id=$2
        """, interview_id, actor.tenant_id)
        if not iv: raise HTTPException(404, "Interview not found")
        if not iv["phone"]: raise HTTPException(400, "No phone number")
        sched = iv["scheduled_at"]
        msg = render_template("interview_reminder", {
            "name": iv["cname"], "role": iv["role"] or "position",
            "date": sched.strftime("%d %b %Y"), "time": sched.strftime("%I:%M %p"),
            "link": iv["meeting_link"] or "check email",
        })
        result = await send_sms(iv["phone"], msg, "interview_reminder")
        await conn.execute("""
            INSERT INTO sms_log (tenant_id,to_phone,message,template,status,sent_at)
            VALUES ($1,$2,$3,'interview_reminder',$4,now())
        """, actor.tenant_id, iv["phone"], msg, result["status"])
    return {**result, "candidate": iv["cname"]}

@router.get("/log")
async def sms_log(limit: int = 50, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            "SELECT * FROM sms_log WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT $2",
            actor.tenant_id, limit)
    return [dict(r) for r in rows]

@router.get("/status")
async def sms_status(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        stats = await conn.fetchrow("""
            SELECT COUNT(*) total,
                   COUNT(*) FILTER (WHERE status='sent') sent,
                   COUNT(*) FILTER (WHERE status='failed') failed
            FROM sms_log WHERE tenant_id=$1
        """, actor.tenant_id)
    return {"configured": is_configured(), "templates": list(SMS_TEMPLATES.keys()), **dict(stats)}
