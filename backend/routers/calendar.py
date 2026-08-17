"""Calendar — .ics export + Google Calendar event creation."""
import secrets
import uuid as _uuid
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
import db
from deps import Actor, get_actor

router = APIRouter(prefix="/calendar", tags=["calendar"])
feed_router = APIRouter(prefix="/calendar-feed", tags=["calendar-feed"])

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
        if not row:
            # BUG FIX (2026-08-10 audit): the deterministic event_uid means
            # a second call for the same interview always hit ON CONFLICT
            # DO NOTHING with no fallback read — download_url came back
            # null with no error shown, so the Download .ics button
            # silently did nothing on the second click. Fetch the existing
            # row instead of leaving the caller with nothing.
            row = await conn.fetchrow(
                "SELECT * FROM calendar_events WHERE tenant_id=$1 AND event_uid=$2",
                actor.tenant_id, uid,
            )
    return {"ics": ics, "attendees": att,
            "download_url": f"/calendar/{str(row['id'])}/download" if row else None}

@router.get("")
async def list_events(actor: Actor = Depends(get_actor)):
    # REAL BUG FIX (2026-08-17): no filter at all for the candidate behind
    # the linked interview -- soft-deleting a candidate (this codebase's
    # universal cleanup convention) never removed their calendar event,
    # so a downloadable-.ics "New Event"-style page stayed full of fake/
    # QA-test interviews forever. Every real calendar_events row (via
    # POST /calendar/from-interview) carries an interview_id; joined
    # through to the candidate the same way the pipeline board/My Day/
    # predictions fixes earlier today did.
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            """SELECT ce.id, ce.title, ce.start_at, ce.end_at, ce.status, ce.attendees
               FROM calendar_events ce
               LEFT JOIN interview_schedules i ON i.id = ce.interview_id
               LEFT JOIN applications a ON a.id = i.application_id
               LEFT JOIN candidates c ON c.id = a.candidate_id
               WHERE ce.tenant_id=$1
                 AND (ce.interview_id IS NULL OR c.is_active IS NOT FALSE)
               ORDER BY ce.start_at DESC LIMIT 50""",
            actor.tenant_id)
    return [dict(r) for r in rows]


# ─── Subscribable calendar feed (Time Champ gap-analysis, 2026-08-11) ─────
# A one-time-download .ics has no way to stay current — Google/Outlook/
# Apple Calendar all support subscribing to a live URL instead (standard
# iCal feed, no OAuth needed, works with any calendar app). Generated
# fresh on every poll from real upcoming interviews, not cached.

@router.post("/feed-token")
async def get_or_create_feed_token(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        existing = await conn.fetchrow(
            "SELECT token FROM calendar_feed_tokens WHERE tenant_id=$1 AND user_id=$2",
            actor.tenant_id, actor.user_id)
        if existing:
            token = existing["token"]
        else:
            token = secrets.token_urlsafe(24)
            await conn.execute(
                "INSERT INTO calendar_feed_tokens (tenant_id, user_id, token) VALUES ($1,$2,$3)",
                actor.tenant_id, actor.user_id, token)
    return {"token": token, "feed_url": f"/calendar-feed/{token}.ics"}


@router.post("/feed-token/reset")
async def reset_feed_token(actor: Actor = Depends(get_actor)):
    """Invalidate the old subscribe URL and mint a fresh one (e.g. if the
    old link was shared unintentionally)."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        token = secrets.token_urlsafe(24)
        await conn.execute(
            """INSERT INTO calendar_feed_tokens (tenant_id, user_id, token) VALUES ($1,$2,$3)
               ON CONFLICT (tenant_id, user_id) DO UPDATE SET token=$3""",
            actor.tenant_id, actor.user_id, token)
    return {"token": token, "feed_url": f"/calendar-feed/{token}.ics"}


@feed_router.get("/{token}.ics")
async def calendar_feed(token: str):
    async with db.system_conn() as conn:
        owner = await conn.fetchrow("SELECT * FROM get_calendar_feed_owner($1)", token)
        if not owner:
            raise HTTPException(404, "Invalid feed token")
    async with db.tenant_conn(str(owner["tenant_id"])) as conn:
        rows = await conn.fetch(
            """SELECT i.*, c.full_name AS candidate_name, r.title AS role_title
               FROM interview_schedules i
               JOIN candidates c ON c.id = i.candidate_id
               LEFT JOIN requisitions r ON r.id = i.requisition_id
               LEFT JOIN applications a ON a.id = i.application_id
               WHERE i.tenant_id=$1 AND i.status != 'cancelled'
                 AND i.scheduled_at >= now() - interval '1 day'
                 AND i.scheduled_at <= now() + interval '90 days'
                 AND (i.interviewer_id=$2 OR a.assigned_recruiter_id=$2)
               ORDER BY i.scheduled_at""",
            str(owner["tenant_id"]), str(owner["user_id"]))

    events_ics = []
    for iv in rows:
        start = iv["scheduled_at"]
        end = start + timedelta(minutes=iv["duration_mins"] or 45)
        title = f"Interview: {iv['candidate_name']} for {iv['role_title'] or 'position'}"
        desc = f"Type: {iv['interview_type']} | Mode: {iv['mode']}"
        if iv["meeting_link"]:
            desc += f"\\nLink: {iv['meeting_link']}"
        dts = start.strftime("%Y%m%dT%H%M%SZ")
        dte = end.strftime("%Y%m%dT%H%M%SZ")
        events_ics.append(f"""BEGIN:VEVENT
UID:iv-{iv['id']}@aviinjobs.com
DTSTAMP:{datetime.utcnow().strftime('%Y%m%dT%H%M%SZ')}
DTSTART:{dts}
DTEND:{dte}
SUMMARY:{title}
DESCRIPTION:{desc}
LOCATION:{iv['location'] or ''}
STATUS:CONFIRMED
END:VEVENT""")

    body = "\r\n".join([
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AVIIN ATS//EN",
        "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:AVIIN ATS Interviews",
        "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    ] + events_ics + ["END:VCALENDAR"])
    return Response(content=body, media_type="text/calendar")
