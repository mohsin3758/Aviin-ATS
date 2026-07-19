import os
"""Phase 3: Auto Interview Engine, Auto Offer Engine, Self-Scheduling, WhatsApp Integration."""
import json, uuid, secrets, logging
from datetime import datetime, timezone, timedelta
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
import db
from deps import Actor, get_actor

log = logging.getLogger(__name__)

auto_interview_router = APIRouter(prefix="/auto-interview", tags=["phase3"])
auto_offer_router     = APIRouter(prefix="/auto-offer",     tags=["phase3"])
schedule_router       = APIRouter(prefix="/self-schedule",  tags=["phase3"])

# ── Helpers ───────────────────────────────────────────────────────────────────
async def send_whatsapp(phone: str, message: str):
    """Send WhatsApp via WAHA (graceful no-op if not connected)."""
    try:
        import httpx
        phone_clean = phone.replace("+","").replace(" ","").replace("-","")
        if not phone_clean.startswith("91"): phone_clean = "91" + phone_clean
        payload = {"chatId": f"{phone_clean}@c.us", "text": message, "session": "default"}
        headers = {"X-Api-Key": "2037c635e42c471a9f2032800ee6ff5b", "Content-Type": "application/json"}
        async with httpx.AsyncClient(timeout=5.0) as cli:
            r = await cli.post("http://waha:3000/api/sendText", json=payload, headers=headers)
            return r.status_code == 200 or r.status_code == 201
    except Exception as e:
        log.warning(f"WhatsApp send failed (non-fatal): {e}")
        return False


async def send_email(to: str, subject: str, body: str):
    """Send email via SMTP. Graceful no-op if unconfigured."""
    import smtplib, os
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    smtp_host = os.environ.get("SMTP_HOST","mailhog")
    smtp_port = int(os.environ.get("SMTP_PORT","1025"))
    smtp_from = os.environ.get("SMTP_FROM","noreply@aviinjobs.com")
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = smtp_from
        msg["To"] = to
        msg.attach(MIMEText(body, "plain"))
        with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as s:
            s.ehlo()
            if smtp_port == 587:
                s.starttls()
                s.ehlo()
            u = os.environ.get("SMTP_USER","")
            if u: s.login(u, os.environ.get("SMTP_PASS",""))
            s.sendmail(smtp_from, [to], msg.as_string())
        log.info(f"Email sent: {subject} -> {to}")
        return True
    except Exception as e:
        log.warning(f"Email failed (non-fatal): {e}")
        return False

async def generate_ics(title: str, start: datetime, duration_mins: int, location: str, description: str, attendees: list) -> str:
    """Generate iCal ICS content."""
    end = start + timedelta(minutes=duration_mins)
    fmt = lambda dt: dt.strftime("%Y%m%dT%H%M%SZ")
    att_lines = "\n".join(f"ATTENDEE;CN={a}:mailto:{a}" for a in attendees if "@" in a)
    uid = str(uuid.uuid4())
    return f"""BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//AVIIN ATS//Recruitment//EN
BEGIN:VEVENT
UID:{uid}
DTSTART:{fmt(start.astimezone(timezone.utc))}
DTEND:{fmt(end.astimezone(timezone.utc))}
SUMMARY:{title}
DESCRIPTION:{description.replace(chr(10),"\\n")}
LOCATION:{location or "Video Call"}
{att_lines}
STATUS:CONFIRMED
SEQUENCE:0
END:VEVENT
END:VCALENDAR"""

async def call_ollama(prompt: str, max_tokens: int = 500) -> Optional[str]:
    """Call local Ollama Qwen2.5. Returns None on failure."""
    try:
        import httpx
        async with httpx.AsyncClient(timeout=30.0) as cli:
            r = await cli.post("http://ollama:11434/api/generate", json={
                "model": "qwen2.5:1.5b-instruct-q4_K_M",
                "prompt": prompt, "stream": False,
                "options": {"num_predict": max_tokens, "temperature": 0.7}
            })
            if r.status_code == 200:
                return r.json().get("response", "").strip()
    except Exception as e:
        log.warning(f"Ollama call failed: {e}")
    return None

# ── Auto Interview Engine ─────────────────────────────────────────────────────
class InterviewScheduleIn(BaseModel):
    application_id: str
    scheduled_at: str          # ISO datetime
    duration_mins: int = 60
    mode: str = "video"        # video | phone | in_person
    meeting_link: Optional[str] = None
    location: Optional[str] = None
    interviewer_id: Optional[str] = None
    send_whatsapp: bool = True
    notes: Optional[str] = None

@auto_interview_router.post("/schedule")
async def auto_schedule_interview(body: InterviewScheduleIn, bg: BackgroundTasks, actor: Actor = Depends(get_actor)):
    """Schedule interview, generate ICS, send WhatsApp invite, move to interview stage."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        # Get application + candidate details
        app = await conn.fetchrow("""
            SELECT a.id, a.candidate_id, a.requisition_id, a.stage,
                   c.full_name, c.email, c.phone,
                   r.title as job_title
            FROM applications a
            JOIN candidates c ON c.id=a.candidate_id
            LEFT JOIN requisitions r ON r.id=a.requisition_id
            WHERE a.id=$1 AND a.tenant_id=$2
        """, body.application_id, actor.tenant_id)

        if not app:
            raise HTTPException(404, "Application not found")

        scheduled_dt = datetime.fromisoformat(body.scheduled_at.replace("Z","+00:00"))

        # Generate ICS
        attendees = [app["email"]] if app["email"] else []
        ics = await generate_ics(
            title=f"Interview: {app['full_name']} - {app['job_title'] or 'Position'}",
            start=scheduled_dt,
            duration_mins=body.duration_mins,
            location=body.meeting_link or body.location or "Video Call",
            description=f"Interview for {app['job_title']}\nCandidate: {app['full_name']}\nMode: {body.mode}",
            attendees=attendees
        )

        # Store in interview_schedules
        sched_id = str(uuid.uuid4())
        await conn.execute("""
            INSERT INTO interview_schedules
            (id,tenant_id,application_id,candidate_id,requisition_id,interviewer_id,
             interview_type,scheduled_at,duration_mins,mode,meeting_link,location,status,notes)
            VALUES ($1,$2,$3,$4,$5,$6,'technical',$7,$8,$9,$10,$11,'scheduled',$12)
        """, sched_id, actor.tenant_id, body.application_id, app["candidate_id"],
             app["requisition_id"], body.interviewer_id, scheduled_dt,
             body.duration_mins, body.mode,
             body.meeting_link, body.location, body.notes)

        # Store ICS in calendar_events
        cal_id = str(uuid.uuid4())
        await conn.execute("""
            INSERT INTO calendar_events
            (id,tenant_id,interview_id,title,description,start_at,end_at,
             location,meeting_link,attendees,ics_content,status)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'confirmed')
        """, cal_id, actor.tenant_id, sched_id,
             f"Interview: {app['full_name']}",
             f"Interview for {app['job_title'] or 'Position'}",
             scheduled_dt,
             scheduled_dt + timedelta(minutes=body.duration_mins),
             body.location or "Video Call",
             body.meeting_link,
             [app["email"]] if app["email"] else [],
             ics)

        # Move to interview stage if not already
        if app["stage"] != "interview":
            await conn.execute("UPDATE applications SET stage='l1_interview', updated_at=NOW() WHERE id=$1", body.application_id)

        # Update invite_sent_at
        await conn.execute("UPDATE interview_schedules SET invite_sent_at=NOW() WHERE id=$1", sched_id)

        # WhatsApp message (background task)
        if body.send_whatsapp and app["phone"]:
            dt_fmt = scheduled_dt.strftime("%d %b %Y at %I:%M %p")
            msg = (f"Hi {app['full_name']}, your interview for {app['job_title'] or 'the position'} "
                   f"is scheduled on {dt_fmt}. Mode: {body.mode.replace('_',' ').title()}. "
                   + (f"Join here: {body.meeting_link}" if body.meeting_link else "")
                   + " - AVIIN Jobs")
            bg.add_task(send_whatsapp, app["phone"], msg)

        return {
            "schedule_id": sched_id,
            "calendar_id": cal_id,
            "candidate": app["full_name"],
            "scheduled_at": body.scheduled_at,
            "ics_content": ics,
            "whatsapp_queued": bool(body.send_whatsapp and app["phone"]),
            "stage_moved": app["stage"] != "interview",
        }

@auto_interview_router.get("/list")
async def list_interviews(actor: Actor = Depends(get_actor)):
    """List all scheduled interviews with candidate details."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT s.id, s.application_id, s.scheduled_at, s.duration_mins,
                   s.mode, s.meeting_link, s.location, s.status, s.rating, s.feedback,
                   c.full_name as candidate_name, c.email, c.phone,
                   r.title as job_title,
                   EXTRACT(EPOCH FROM (s.scheduled_at - NOW()))/3600 as hours_until,
                   ce.id as calendar_id
            FROM interview_schedules s
            JOIN candidates c ON c.id=s.candidate_id
            LEFT JOIN requisitions r ON r.id=s.requisition_id
            LEFT JOIN calendar_events ce ON ce.interview_id=s.id AND ce.tenant_id=s.tenant_id
            WHERE s.tenant_id=$1
            ORDER BY s.scheduled_at DESC LIMIT 100
        """, actor.tenant_id)
        return [{
            "id": str(r["id"]), "candidate": r["candidate_name"],
            "email": r["email"], "phone": r["phone"],
            "job_title": r["job_title"], "scheduled_at": r["scheduled_at"].isoformat() if r["scheduled_at"] else None,
            "duration_mins": r["duration_mins"], "mode": r["mode"],
            "meeting_link": r["meeting_link"], "location": r["location"],
            "status": r["status"], "rating": r["rating"],
            "hours_until": round(float(r["hours_until"] or 0), 1),
            "calendar_id": str(r["calendar_id"]) if r["calendar_id"] else None,
        } for r in rows]

@auto_interview_router.post("/send-reminder/{schedule_id}")
async def send_interview_reminder(schedule_id: str, bg: BackgroundTasks, actor: Actor = Depends(get_actor)):
    """Manually trigger WhatsApp reminder for an interview."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        s = await conn.fetchrow("""
            SELECT s.*, c.full_name, c.phone, r.title as job_title
            FROM interview_schedules s
            JOIN candidates c ON c.id=s.candidate_id
            LEFT JOIN requisitions r ON r.id=s.requisition_id
            WHERE s.id=$1 AND s.tenant_id=$2
        """, schedule_id, actor.tenant_id)
        if not s: raise HTTPException(404, "Schedule not found")
        if not s["phone"]: raise HTTPException(400, "Candidate has no phone number")

        dt_fmt = s["scheduled_at"].strftime("%d %b at %I:%M %p") if s["scheduled_at"] else "TBD"
        msg = (f"Reminder: Hi {s['full_name']}, your interview for {s['job_title'] or 'the position'} "
               f"is tomorrow {dt_fmt}. " + (f"Join: {s['meeting_link']}" if s["meeting_link"] else "") +
               " Good luck! - AVIIN Jobs")
        bg.add_task(send_whatsapp, s["phone"], msg)
        await conn.execute("UPDATE interview_schedules SET reminder_sent_at=NOW() WHERE id=$1", schedule_id)
        return {"sent": True, "to": s["phone"], "candidate": s["full_name"]}

# ── Auto Offer Engine ─────────────────────────────────────────────────────────
class OfferIn(BaseModel):
    application_id: str
    ctc_offered: float
    joining_date: str          # YYYY-MM-DD
    currency: str = "INR"
    generate_letter: bool = True

@auto_offer_router.post("/generate")
async def auto_generate_offer(body: OfferIn, actor: Actor = Depends(get_actor)):
    """Generate offer using Ollama Qwen2.5, store in offers table, send WhatsApp."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        app = await conn.fetchrow("""
            SELECT a.id, a.candidate_id, a.stage,
                   c.full_name, c.email, c.phone, c.expected_ctc,
                   c.notice_period_days, c.total_exp_mo,
                   r.title as job_title
            FROM applications a
            JOIN candidates c ON c.id=a.candidate_id
            LEFT JOIN requisitions r ON r.id=a.requisition_id
            WHERE a.id=$1 AND a.tenant_id=$2
        """, body.application_id, actor.tenant_id)

        if not app: raise HTTPException(404, "Application not found")

        # Generate offer letter text via Ollama
        offer_text = None
        exp_y = round((app["total_exp_mo"] or 0) / 12, 1)
        ctc_formatted = f"Rs. {body.ctc_offered/100000:.2f} Lakhs per annum" if body.ctc_offered else "As discussed"
        company = "AVIIN Jobs"

        if body.generate_letter:
            prompt = f"""Write a professional job offer letter for the following:
Company: {company}
Candidate Name: {app['full_name']}
Position: {app['job_title'] or 'Software Engineer'}
CTC: {ctc_formatted}
Joining Date: {body.joining_date}
Experience: {exp_y} years

Write a warm, professional offer letter (200-250 words). Include: congratulations, role details, CTC, joining date, and excitement about them joining. Sign off as "HR Team, {company}". Do NOT include salary breakdowns or legal boilerplate. Just the main offer letter body."""

            offer_text = await call_ollama(prompt, max_tokens=400)

        if not offer_text:
            # Template fallback
            offer_text = f"""Dear {app['full_name']},

We are delighted to offer you the position of {app['job_title'] or 'Associate'} at {company}.

After careful consideration of your profile and impressive performance during the interview process, we believe you will be a valuable addition to our team.

Offer Details:
- Position: {app['job_title'] or 'Associate'}
- CTC: {ctc_formatted}
- Joining Date: {body.joining_date}

Please confirm your acceptance by replying to this letter within 3 working days.

We look forward to welcoming you to the {company} family!

Warm regards,
HR Team, {company}"""

        # Create offer record
        offer_id = str(uuid.uuid4())
        from datetime import date as _date
        joining_date_obj = _date.fromisoformat(body.joining_date) if body.joining_date else None
        # Upsert: delete existing offer for this application then insert fresh
        await conn.execute("DELETE FROM offers WHERE application_id=$1 AND tenant_id=$2",
                           body.application_id, actor.tenant_id)
        await conn.execute("""
            INSERT INTO offers (id,tenant_id,application_id,status,ctc_offered,currency,joining_date,offer_letter_text)
            VALUES ($1,$2,$3,'issued',$4,$5,$6,$7)
        """, offer_id, actor.tenant_id, body.application_id,
             body.ctc_offered, body.currency, joining_date_obj, offer_text)

        # Move to offer stage
        await conn.execute("UPDATE applications SET stage='offer', updated_at=NOW() WHERE id=$1", body.application_id)

        return {
            "offer_id": offer_id,
            "candidate": app["full_name"],
            "ctc": body.ctc_offered,
            "joining_date": body.joining_date,
            "offer_letter": offer_text,
            "generated_by": "ollama_qwen2.5" if offer_text and body.generate_letter else "template",
            "stage_moved": True,
        }

@auto_offer_router.get("/list")
async def list_offers(actor: Actor = Depends(get_actor)):
    """List all offers with candidate and application details."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT o.id, o.status, o.ctc_offered, o.currency, o.joining_date,
                   o.created_at, o.updated_at,
                   c.full_name as candidate_name, c.email, c.phone, c.expected_ctc,
                   r.title as job_title, a.id as application_id
            FROM offers o
            JOIN applications a ON a.id=o.application_id
            JOIN candidates c ON c.id=a.candidate_id
            LEFT JOIN requisitions r ON r.id=a.requisition_id
            WHERE o.tenant_id=$1
            ORDER BY o.created_at DESC LIMIT 100
        """, actor.tenant_id)
        return [{
            "id": str(r["id"]), "status": r["status"],
            "candidate": r["candidate_name"], "email": r["email"], "phone": r["phone"],
            "job_title": r["job_title"], "ctc_offered": float(r["ctc_offered"] or 0),
            "expected_ctc": float(r["expected_ctc"] or 0),
            "currency": r["currency"], "joining_date": str(r["joining_date"]) if r["joining_date"] else None,
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
            "application_id": str(r["application_id"]),
        } for r in rows]

# ── Self-Scheduling Links ─────────────────────────────────────────────────────
@schedule_router.post("/generate/{application_id}")
async def generate_schedule_link(application_id: str, actor: Actor = Depends(get_actor)):
    """Generate a unique self-scheduling link for a candidate."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        app = await conn.fetchrow("""
            SELECT a.candidate_id, c.full_name
            FROM applications a JOIN candidates c ON c.id=a.candidate_id
            WHERE a.id=$1 AND a.tenant_id=$2
        """, application_id, actor.tenant_id)
        if not app: raise HTTPException(404, "Application not found")

        token = secrets.token_urlsafe(32)
        expires = datetime.now(timezone.utc) + timedelta(days=7)

        await conn.execute("""
            INSERT INTO candidate_status_tokens (id,tenant_id,candidate_id,token,expires_at)
            VALUES (gen_random_uuid(),$1,$2,$3,$4)
        """, actor.tenant_id, app["candidate_id"], token, expires)

        return {
            "token": token,
            "candidate": app["full_name"],
            "link": f"/schedule/{token}",
            "expires_at": expires.isoformat(),
        }

@schedule_router.get("/slots")
async def get_available_slots(actor: Actor = Depends(get_actor)):
    """Get available interview time slots for the next 7 days."""
    from datetime import date
    slots = []
    now = datetime.now(timezone.utc)
    for day_offset in range(1, 8):
        day = now + timedelta(days=day_offset)
        if day.weekday() < 5:  # Mon-Fri only
            for hour in [10, 11, 14, 15, 16]:
                slot_dt = day.replace(hour=hour, minute=0, second=0, microsecond=0)
                slots.append({
                    "datetime": slot_dt.isoformat(),
                    "label": slot_dt.strftime("%a %d %b, %I:%M %p"),
                    "available": True,
                })
    return {"slots": slots}

@schedule_router.get("/public/{token}")
async def get_public_schedule(token: str):
    """Public endpoint — no auth, uses SECURITY DEFINER to bypass RLS UUID cast."""
    async with db.system_conn() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM get_schedule_by_token($1)", token
        )
    if not row:
        raise HTTPException(404, "Link expired or invalid")

        # Get upcoming slots
        slots = []
        now = datetime.now(timezone.utc)
        for day_offset in range(1, 8):
            day = now + timedelta(days=day_offset)
            if day.weekday() < 5:
                for hour in [10, 11, 14, 15, 16]:
                    slot_dt = day.replace(hour=hour, minute=0, second=0, microsecond=0)
                    slots.append({"datetime": slot_dt.isoformat(), "label": slot_dt.strftime("%a %d %b, %I:%M %p IST")})

        stage_labels = {
            "sourced":"Application Received","screened":"Under Review",
            "submitted":"Shortlisted","interview":"Interview Stage",
            "offer":"Offer Extended","placed":"Placed","rejected":"Not Selected",
        }
        return {
            "candidate_name": row["full_name"],
            "job_title": row["job_title"],
            "current_stage": row["stage"],
            "stage_label": stage_labels.get(row["stage"] or "","Application Received"),
            "application_id": str(row["application_id"]) if row["application_id"] else None,
            "available_slots": slots[:10],
        }

@schedule_router.post("/book/{token}")
async def book_slot(token: str, slot_datetime: str, mode: str = "video"):
    """Candidate books an interview slot via public link — no auth, uses SECURITY DEFINER."""
    async with db.system_conn() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM get_schedule_by_token($1)", token
        )
    if not row:
        raise HTTPException(404, "Link expired or invalid")

    scheduled_dt = datetime.fromisoformat(slot_datetime.replace("Z", "+00:00"))
    ics = await generate_ics(
        title=f"Interview: {row['full_name']} - {row['job_title'] or 'Position'}",
        start=scheduled_dt, duration_mins=60,
        location="Video Call",
        description=f"Self-scheduled interview for {row['job_title'] or 'Position'}",
        attendees=[row["email"]] if row["email"] else []
    )

    sched_id = str(uuid.uuid4())
    async with db.tenant_conn(str(row["tenant_id"])) as conn:
        await conn.execute("""
            INSERT INTO interview_schedules
            (id,tenant_id,application_id,candidate_id,interview_type,scheduled_at,
             duration_mins,mode,status)
            VALUES ($1,$2,$3,$4,'self_scheduled',$5,60,$6,'scheduled')
        """, sched_id, row["tenant_id"], row["application_id"], row["candidate_id"],
             scheduled_dt, mode)

    return {
        "booked": True,
        "schedule_id": sched_id,
        "datetime": slot_datetime,
        "ics_content": ics,
        "message": f"Interview confirmed for {scheduled_dt.strftime('%d %b at %I:%M %p')}. You will receive a calendar invite.",
    }


# ── WAHA Proxy Endpoints (for frontend WhatsApp Setup page) ──────────────────
waha_router = APIRouter(prefix="/waha", tags=["waha"])
WAHA_BASE = "http://waha:3000"
WAHA_KEY  = os.getenv("WAHA_API_KEY", "aviinATS2026secure")

@waha_router.get("/status")
async def waha_status():
    """Get WAHA session status."""
    try:
        import httpx
        async with httpx.AsyncClient(timeout=5.0) as cli:
            r = await cli.get(f"{WAHA_BASE}/api/sessions/default",
                              headers={"X-Api-Key": WAHA_KEY})
            if r.status_code == 200:
                d = r.json()
                return {"connected": d.get("status") == "WORKING",
                        "status": d.get("status","UNKNOWN"),
                        "engine": d.get("engine",{}).get("engine","WEBJS")}
            return {"connected": False, "status": "ERROR", "code": r.status_code}
    except Exception as e:
        return {"connected": False, "status": "OFFLINE", "error": str(e)}

@waha_router.post("/start")
async def waha_start():
    """Start WAHA session."""
    try:
        import httpx
        BACKEND_URL = os.getenv("BACKEND_INTERNAL_URL", "http://aviin_backend:8080")
        webhook_url = f"{BACKEND_URL}/whatsapp-bot/webhook"
        async with httpx.AsyncClient(timeout=10.0) as cli:
            # Ensure session exists with correct webhook
            await cli.post(f"{WAHA_BASE}/api/sessions",
                          headers={"X-Api-Key": WAHA_KEY},
                          json={"name": "default", "config": {"webhooks": [{"url": webhook_url, "events": ["message", "session.status"]}]}})
            # Start session
            r = await cli.post(f"{WAHA_BASE}/api/sessions/default/start",
                               headers={"X-Api-Key": WAHA_KEY})
            started = r.status_code in (200,201,422)
            # Get status
            s = await cli.get(f"{WAHA_BASE}/api/sessions/default",
                              headers={"X-Api-Key": WAHA_KEY})
            status = s.json().get("status","UNKNOWN") if s.status_code==200 else "STARTING"
            return {"started": started, "status": status, "webhook": webhook_url}
    except Exception as e:
        return {"started": False, "error": str(e)}

@waha_router.get("/qr")
async def waha_qr():
    """Get WAHA QR code for scanning.

    WAHA WEBJS uses /api/{session}/auth/qr (not /api/sessions/{session}/auth/qr).
    Returns {"qr": "data:image/png;base64,...", "format": "image"} or
            {"qr": "...", "format": "text"} for text QR codes.
    """
    try:
        import httpx, base64
        async with httpx.AsyncClient(timeout=10.0) as cli:
            # Try paths in order of likelihood
            # WAHA WEBJS: /api/{session}/auth/qr  (NOT /api/sessions/{session}/auth/qr)
            qr_paths = [
                f"{WAHA_BASE}/api/default/auth/qr",
                f"{WAHA_BASE}/api/sessions/default/auth/qr",
            ]
            last_status = 0
            for qr_path in qr_paths:
                r = await cli.get(qr_path, headers={"X-Api-Key": WAHA_KEY})
                last_status = r.status_code
                if r.status_code == 200:
                    ct = r.headers.get("content-type", "")
                    # PNG/image response
                    if "image" in ct or (r.content and r.content[:4] == b'\x89PNG'):
                        b64 = base64.b64encode(r.content).decode()
                        mime = ct if "image" in ct else "image/png"
                        return {"qr": f"data:{mime};base64,{b64}", "format": "image"}
                    # JSON response containing qr data
                    try:
                        d = r.json()
                        if isinstance(d, dict):
                            qr_val = d.get("qr") or d.get("value") or d.get("data") or d.get("qrCode", "")
                            if qr_val:
                                if qr_val.startswith("data:"):
                                    return {"qr": qr_val, "format": "image"}
                                return {"qr": qr_val, "format": "text"}
                    except Exception:
                        # Raw content - encode as base64
                        if r.content:
                            b64 = base64.b64encode(r.content).decode()
                            return {"qr": f"data:image/png;base64,{b64}", "format": "image"}
            # Fallback: screenshot
            r2 = await cli.get(f"{WAHA_BASE}/api/screenshot",
                               headers={"X-Api-Key": WAHA_KEY})
            if r2.status_code == 200:
                ct = r2.headers.get("content-type", "image/png")
                if "image" in ct:
                    b64 = base64.b64encode(r2.content).decode()
                    return {"qr": f"data:{ct};base64,{b64}", "format": "screenshot"}
            # Get session status for diagnostics
            s = await cli.get(f"{WAHA_BASE}/api/sessions/default",
                              headers={"X-Api-Key": WAHA_KEY})
            session_status = s.json().get("status", "UNKNOWN") if s.status_code == 200 else "UNKNOWN"
            return {"qr": "", "status": "QR_NOT_AVAILABLE",
                    "session_status": session_status, "last_http": last_status}
    except Exception as e:
        return {"qr": "", "error": str(e)}

@waha_router.post("/send")
async def waha_send(phone: str, message: str):
    """Send WhatsApp message via WAHA."""
    try:
        import httpx
        phone_clean = phone.replace("+","").replace(" ","").replace("-","")
        if not phone_clean.startswith("91"): phone_clean = "91" + phone_clean
        async with httpx.AsyncClient(timeout=8.0) as cli:
            r = await cli.post(f"{WAHA_BASE}/api/sendText",
                               headers={"X-Api-Key": WAHA_KEY, "Content-Type": "application/json"},
                               json={"chatId": f"{phone_clean}@c.us", "text": message, "session": "default"})
            return {"sent": r.status_code in (200,201), "status": r.status_code}
    except Exception as e:
        return {"sent": False, "error": str(e)}


@auto_offer_router.get("/candidate/{candidate_id}")
async def offers_by_candidate(candidate_id: str, actor: Actor = Depends(get_actor)):
    """List all offers for a specific candidate."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT o.id, o.status, o.ctc_offered, o.currency, o.joining_date,
                   o.offer_letter_text, o.created_at, o.updated_at,
                   r.title as job_title, a.id as application_id, a.stage as app_stage
            FROM offers o
            JOIN applications a ON a.id=o.application_id
            JOIN candidates c ON c.id=a.candidate_id
            LEFT JOIN requisitions r ON r.id=a.requisition_id
            WHERE o.tenant_id=$1 AND c.id=$2::uuid
            ORDER BY o.created_at DESC
        """, actor.tenant_id, candidate_id)
        return [{
            "id": str(r["id"]),
            "status": r["status"],
            "job_title": r["job_title"],
            "ctc_offered": float(r["ctc_offered"] or 0),
            "currency": r["currency"],
            "joining_date": str(r["joining_date"]) if r["joining_date"] else None,
            "offer_letter_text": r["offer_letter_text"],
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
            "application_id": str(r["application_id"]),
            "app_stage": r["app_stage"],
        } for r in rows]

