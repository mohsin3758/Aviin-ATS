"""Calendar — .ics export + Google Calendar event creation."""
import uuid as _uuid
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
import db
from deps import Actor, get_actor

router = APIRouter(prefix="/calendar", tags=["calendar"])

def make_ics(title, start, end, desc="", loc="", uid="", attendees=[]):
    dts  = start.strftime("%Y%m%dT%H%M%SZ")
    dte  = end.strftime("%Y%m%dT%H%M%SZ")
    dtstamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    uid  = uid or str(_uuid.uuid4()) + "@aviinjobs.com"
    att  = "\n".join(f"ATTENDEE;RSVP=TRUE:mailto:{a}" for a in attendees if a)
    return f"""BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//AVIIN ATS//EN
METHOD:REQUEST
BEGIN:VEVENT
UID:{uid}
DTSTAMP:{dtstamp}
DTSTART:{dts}
DTEND:{dte}
SUMMARY:{title}
DESCRIPTION:{desc.replace(chr(10),'\\n')}
LOCATION:{loc}
STATUS:CONFIRMED
{att}
END:VEVENT
END:VCALENDAR""".strip()

class CalIn(BaseModel):
    interview_id: Optional[str] = None
    title: str
    start_at: str
    duration_mins: int = 45
    description: Optional[str] = ""
    location: Optional[str] = ""
    meeting_link: Optional[str] = ""
    attendees: list = []

@router.post("")
async def create_event(body: CalIn, actor: Actor = Depends(get_actor)):
    start = datetime.fromisoformat(body.start_at.replace("Z",""))
    end   = start + timedelta(minutes=body.duration_mins)
    uid   = str(_uuid.uuid4()) + "@aviinjobs.com"
    desc  = (body.description or "") + (f"\nMeeting: {body.meeting_link}" if body.meeting_link else "")
    ics   = make_ics(body.title, start, end, desc, body.location or body.meeting_link or "",
                     uid, body.attendees)
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            INSERT INTO calendar_events
              (tenant_id,interview_id,user_id,event_uid,title,description,
               start_at,end_at,location,meeting_link,attendees,ics_content)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *
        """, actor.tenant_id, body.interview_id, actor.user_id, uid,
             body.title, desc, start, end, body.location, body.meeting_link,
             body.attendees, ics)
    return {**dict(row), "ics_url": f"/calendar/{str(row['id'])}/download"}

@router.get("/{event_id}/download")
async def download_ics(event_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT * FROM calendar_events WHERE id=$1 AND tenant_id=$2",
            event_id, actor.tenant_id)
        if not row: raise HTTPException(404, "Not found")
    return Response(content=row["ics_content"], media_type="text/calendar",
                    headers={"Content-Disposition": f"attachment; filename=interview.ics"})

@router.post("/from-interview/{interview_id}")
async def from_interview(interview_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        iv = await conn.fetchrow("""
            SELECT i.*, c.full_name cn, c.email ce,
                   u.full_name iname, u.email ie, r.title role
            FROM interview_schedules i
            JOIN candidates c ON c.id=i.candidate_id
            LEFT JOIN users u ON u.id=i.interviewer_id
            LEFT JOIN requisitions r ON r.id=i.requisition_id
            WHERE i.id=$1 AND i.tenant_id=$2
        """, interview_id, actor.tenant_id)
        if not iv: raise HTTPException(404, "Not found")
        start = iv["scheduled_at"]
        end   = start + timedelta(minutes=iv["duration_mins"] or 45)
        title = f"Interview: {iv['cn']} for {iv['role'] or 'position'}"
        desc  = f"Type: {iv['interview_type']} | Mode: {iv['mode']}"
        if iv["meeting_link"]: desc += f"\nLink: {iv['meeting_link']}"
        uid   = f"iv-{interview_id}@aviinjobs.com"
        att   = [e for e in [iv["ce"], iv["ie"]] if e]
        ics   = make_ics(title, start, end, desc, iv["location"] or "", uid, att)
        row = await conn.fetchrow("""
            INSERT INTO calendar_events
              (tenant_id,interview_id,user_id,event_uid,title,description,
               start_at,end_at,location,meeting_link,attendees,ics_content)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
            ON CONFLICT DO NOTHING RETURNING *
        """, actor.tenant_id, interview_id, actor.user_id, uid, title, desc,
             start, end, iv["location"], iv["meeting_link"], att, ics)
    return {"ics": ics, "attendees": att,
            "download_url": f"/calendar/{str(row['id'])}/download" if row else None}

@router.get("")
async def list_events(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            "SELECT id,title,start_at,end_at,status,attendees FROM calendar_events WHERE tenant_id=$1 ORDER BY start_at DESC LIMIT 50",
            actor.tenant_id)
    return [dict(r) for r in rows]
