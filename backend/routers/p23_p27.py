"""P23-P27 combined router: skills, bulk-cv, email templates,
interview schedules, client portal, SLA, JD templates, audit log."""
import bcrypt, json
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
import db
from deps import Actor, get_actor
from permissions import require_permission
from routers.ner import parse_resume

# ── P23: Skills Taxonomy ─────────────────────────────────────
skills_router = APIRouter(prefix="/skills", tags=["skills"])

@skills_router.get("")
async def list_skills(category: Optional[str]=None, search: Optional[str]=None,
                       actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT * FROM skills_taxonomy
            WHERE (tenant_id=$1 OR tenant_id IS NULL)
              AND ($2::text IS NULL OR category=$2)
              AND ($3::text IS NULL OR skill_name ILIKE '%'||$3||'%'
                   OR $3 = ANY(aliases))
            ORDER BY category, skill_name
        """, actor.tenant_id, category, search)
    return [dict(r) for r in rows]

@skills_router.post("")
async def add_skill(body: dict, actor: Actor=Depends(require_permission("skills_taxonomy", "create"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            INSERT INTO skills_taxonomy (tenant_id,skill_name,category,aliases)
            VALUES ($1,$2,$3,$4)
            ON CONFLICT (tenant_id,skill_name) DO UPDATE SET
              category=EXCLUDED.category, aliases=EXCLUDED.aliases
            RETURNING *
        """, actor.tenant_id, body['skill_name'], body.get('category','other'),
             body.get('aliases',[]))
        # BUG FIX (2026-08-10 audit): refresh_cache() had zero callers -
        # adding/editing a skill here never refreshed the live resume-parser
        # cache, so a newly-added alias wouldn't be usable until the backend
        # process happened to restart. Best-effort: a stale cache is a minor
        # parsing-quality issue, not worth failing the whole request over.
        try:
            import services.skill_normalizer as skill_normalizer
            await skill_normalizer.refresh_cache(conn)
        except Exception:
            pass
    return dict(row)

@skills_router.get("/categories")
async def skill_categories(actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT category, COUNT(*) as count FROM skills_taxonomy
            WHERE tenant_id=$1 OR tenant_id IS NULL
            GROUP BY category ORDER BY count DESC
        """, actor.tenant_id)
    return [dict(r) for r in rows]

# ── P23: Bulk CV Upload ───────────────────────────────────────
bulk_router = APIRouter(prefix="/bulk-cv", tags=["bulk-cv"])

@bulk_router.post("/parse")
async def bulk_parse(files: List[UploadFile]=File(...), actor: Actor=Depends(require_permission("resume_inbox", "create"))):
    """Upload multiple CVs (text files), parse with regex NER, detect duplicates."""
    session_id = None
    results = []
    async with db.tenant_conn(actor.tenant_id) as conn:
        sess = await conn.fetchrow("""
            INSERT INTO cv_bulk_uploads (tenant_id,uploaded_by,total_files,status)
            VALUES ($1,$2,$3,'processing') RETURNING id
        """, actor.tenant_id, actor.user_id, len(files))
        session_id = str(sess['id'])

    for f in files:
        try:
            text = (await f.read()).decode('utf-8','ignore')
            parsed = parse_resume(text)
            # Duplicate check by email/phone
            email = parsed.get('extracted_email')
            phone = parsed.get('extracted_phone')
            is_dup = False
            async with db.tenant_conn(actor.tenant_id) as conn:
                if email:
                    dup = await conn.fetchval(
                        "SELECT id FROM candidates WHERE email=$1 AND tenant_id=$2",
                        email, actor.tenant_id)
                    is_dup = bool(dup)
            results.append({
                "file": f.filename, "status": "duplicate" if is_dup else "parsed",
                "name": ' '.join(parsed.get('extracted_titles',['Unknown'])[:1]) or f.filename,
                "email": email, "phone": phone,
                "skills": parsed.get('extracted_skills',[])[:10],
                "exp_years": parsed.get('total_years_exp',0),
                "education": parsed.get('education_level','Other'),
                "is_duplicate": is_dup,
            })
        except Exception as e:
            results.append({"file": f.filename, "status": "failed", "error": str(e)})

    done = len([r for r in results if r['status']=='parsed'])
    dups = len([r for r in results if r['status']=='duplicate'])
    failed = len([r for r in results if r['status']=='failed'])

    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute("""
            UPDATE cv_bulk_uploads SET
              parsed=$1, duplicates=$2, failed=$3, results=$4::jsonb,
              status='completed', completed_at=now()
            WHERE id=$5
        """, done, dups, failed, json.dumps(results), session_id)

    return {"session_id": session_id, "total": len(files),
            "parsed": done, "duplicates": dups, "failed": failed, "results": results}

@bulk_router.get("/sessions")
async def list_sessions(actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT b.*, u.full_name AS uploaded_by_name
            FROM cv_bulk_uploads b
            LEFT JOIN users u ON u.id=b.uploaded_by
            WHERE b.tenant_id=$1 ORDER BY b.created_at DESC LIMIT 20
        """, actor.tenant_id)
    return [dict(r) for r in rows]

# ── P24: Email Templates ──────────────────────────────────────

def _to_date(val):
    """Convert string to date object for asyncpg."""
    if val is None or val == "": return None
    if hasattr(val, 'toordinal'): return val
    from datetime import date, datetime
    try:
        if 'T' in str(val): return datetime.fromisoformat(str(val).replace('Z','')).date()
        return date.fromisoformat(str(val))
    except: return None

def _to_dt(val):
    """Convert string to datetime for asyncpg."""
    if val is None or val == "": return None
    if hasattr(val, 'timestamp'): return val
    from datetime import datetime
    try: return datetime.fromisoformat(str(val).replace('Z',''))
    except: return None

email_router = APIRouter(prefix="/email-templates", tags=["email-templates"])

@email_router.get("")
async def list_templates(category: Optional[str]=None, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT * FROM email_templates
            WHERE tenant_id=$1 AND is_active
              AND ($2::text IS NULL OR category=$2)
            ORDER BY category, name
        """, actor.tenant_id, category)
    return [dict(r) for r in rows]

@email_router.get("/{tmpl_id}")
async def get_template(tmpl_id: str, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT * FROM email_templates WHERE id=$1 AND tenant_id=$2",
            tmpl_id, actor.tenant_id)
        if not row: raise HTTPException(404,"Template not found")
    return dict(row)

@email_router.post("")
async def create_template(body: dict, actor: Actor=Depends(require_permission("email_templates", "create"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            INSERT INTO email_templates (tenant_id,name,category,subject,body_html,variables)
            VALUES ($1,$2,$3,$4,$5,$6)
            ON CONFLICT (tenant_id,name) DO UPDATE SET
              subject=EXCLUDED.subject, body_html=EXCLUDED.body_html
            RETURNING *
        """, actor.tenant_id, body['name'], body['category'],
             body['subject'], body['body_html'], body.get('variables',[]))
    return dict(row)

@email_router.put("/{tmpl_id}")
async def update_template(tmpl_id: str, body: dict, actor: Actor=Depends(require_permission("email_templates", "update"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            UPDATE email_templates SET
              subject=COALESCE($1,subject), body_html=COALESCE($2,body_html)
            WHERE id=$3 AND tenant_id=$4 AND NOT is_system RETURNING *
        """, body.get('subject'), body.get('body_html'), tmpl_id, actor.tenant_id)
        if not row: raise HTTPException(404,"Not found or system template")
    return dict(row)

@email_router.post("/{tmpl_id}/preview")
async def preview_template(tmpl_id: str, variables: dict, actor: Actor=Depends(get_actor)):
    """Render template with sample variables."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT * FROM email_templates WHERE id=$1 AND tenant_id=$2",
            tmpl_id, actor.tenant_id)
        if not row: raise HTTPException(404,"Not found")
    subject = row['subject']
    body = row['body_html']
    # BUG FIX (2026-08-10 audit): substituted {{double_brace}} while every
    # real template row uses {single_brace} — preview always returned the
    # template byte-for-byte unsubstituted, regardless of what was passed.
    for k,v in variables.items():
        subject = subject.replace(f'{{{k}}}', str(v))
        body    = body.replace(f'{{{k}}}', str(v))
    return {"subject": subject, "body_html": body}

# ── P24: Interview Schedules ──────────────────────────────────
interview_router = APIRouter(prefix="/interviews", tags=["interviews"])

class InterviewIn(BaseModel):
    application_id: Optional[str]=None
    candidate_id: str
    requisition_id: Optional[str]=None
    interviewer_id: Optional[str]=None
    interview_type: str="technical"
    scheduled_at: str
    duration_mins: int=45
    mode: str="video"
    meeting_link: Optional[str]=None
    location: Optional[str]=None
    notes: Optional[str]=None

@interview_router.get("")
async def list_interviews(candidate_id: Optional[str]=None,
                           status: Optional[str]=None,
                           actor: Actor=Depends(get_actor)):
    # REAL BUG FIX (2026-08-17): no is_active filter — soft-deleted
    # candidates' old (and sometimes still-future-dated) interview rows
    # kept appearing on this real, recruiter-facing list forever.
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT i.*, c.full_name AS candidate_name, c.email AS candidate_email,
                   u.full_name AS interviewer_name,
                   r.title AS role_title
            FROM interview_schedules i
            JOIN candidates c ON c.id=i.candidate_id
            LEFT JOIN users u ON u.id=i.interviewer_id
            LEFT JOIN requisitions r ON r.id=i.requisition_id
            WHERE i.tenant_id=$1 AND c.is_active IS NOT FALSE
              AND ($2::text IS NULL OR i.candidate_id::text=$2)
              AND ($3::text IS NULL OR i.status=$3)
            ORDER BY i.scheduled_at DESC
        """, actor.tenant_id, candidate_id, status)
    return [dict(r) for r in rows]

# Gap-audit item 10: interviewer load-balancing. No dedicated "interviewer"
# role exists (only admin/manager/recruiter) - eligible pool is any active
# staff member, ranked by how many OTHER interviews they already have near
# the requested time, hard-excluding anyone with a real time conflict.
INTERVIEWER_ELIGIBLE_ROLES = ("recruiter", "manager", "admin", "super_admin", "lead_recruiter")


async def _suggest_interviewer(conn, tenant_id: str, scheduled_at, duration_mins: int) -> Optional[dict]:
    rows = await conn.fetch(
        """
        SELECT u.id, u.full_name,
               count(i.id) FILTER (
                 WHERE i.status NOT IN ('cancelled','completed')
                   AND i.scheduled_at BETWEEN $2::timestamptz - interval '3 days' AND $2::timestamptz + interval '3 days'
               ) AS nearby_load,
               bool_or(
                 i.status NOT IN ('cancelled','completed')
                 AND tstzrange(i.scheduled_at, i.scheduled_at + make_interval(mins => i.duration_mins))
                     && tstzrange($2::timestamptz, $2::timestamptz + make_interval(mins => $3::int))
               ) AS has_conflict
        FROM users u
        LEFT JOIN interview_schedules i ON i.interviewer_id = u.id AND i.tenant_id = $1
        WHERE u.tenant_id = $1 AND u.is_active AND u.role = ANY($4)
        GROUP BY u.id, u.full_name
        HAVING NOT COALESCE(bool_or(
                 i.status NOT IN ('cancelled','completed')
                 AND tstzrange(i.scheduled_at, i.scheduled_at + make_interval(mins => i.duration_mins))
                     && tstzrange($2::timestamptz, $2::timestamptz + make_interval(mins => $3::int))
               ), false)
        ORDER BY nearby_load ASC, u.full_name ASC
        LIMIT 1
        """,
        tenant_id, scheduled_at, duration_mins, list(INTERVIEWER_ELIGIBLE_ROLES),
    )
    return dict(rows[0]) if rows else None


async def _has_conflict(conn, tenant_id: str, interviewer_id: str, scheduled_at, duration_mins: int,
                         exclude_interview_id: Optional[str] = None) -> bool:
    """Real overlap check for a SPECIFIC interviewer — used to hard-block a
    double-booking regardless of whether interviewer_id was auto-picked
    (which already avoids conflicts by construction, so this is a cheap
    no-op there) or supplied explicitly by the caller (2026-08-10 audit:
    this path had no conflict check at all — reproduced two identical
    double-bookings for the same interviewer, same slot, both returning
    200). exclude_interview_id lets a reschedule of interview X ignore X's
    own existing row.
    """
    row = await conn.fetchrow(
        """
        SELECT bool_or(
                 tstzrange(i.scheduled_at, i.scheduled_at + make_interval(mins => i.duration_mins))
                 && tstzrange($3::timestamptz, $3::timestamptz + make_interval(mins => $4::int))
               ) AS has_conflict
        FROM interview_schedules i
        WHERE i.tenant_id = $1 AND i.interviewer_id = $2
          AND i.status NOT IN ('cancelled','completed')
          AND ($5::uuid IS NULL OR i.id <> $5::uuid)
        """,
        tenant_id, interviewer_id, scheduled_at, duration_mins, exclude_interview_id,
    )
    return bool(row and row["has_conflict"])


@interview_router.get("/suggest-interviewer")
async def suggest_interviewer(scheduled_at: str, duration_mins: int = 45, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        suggestion = await _suggest_interviewer(conn, actor.tenant_id, _to_dt(scheduled_at), duration_mins)
    if not suggestion:
        raise HTTPException(status_code=404, detail="No eligible interviewer available at that time (all conflict or none active)")
    return suggestion


@interview_router.post("")
async def schedule_interview(body: InterviewIn, actor: Actor=Depends(require_permission("interviews", "create"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        interviewer_id = body.interviewer_id
        scheduled_dt = _to_dt(body.scheduled_at)
        if not interviewer_id:
            auto = await _suggest_interviewer(conn, actor.tenant_id, scheduled_dt, body.duration_mins)
            if auto:
                interviewer_id = auto["id"]
        elif await _has_conflict(conn, actor.tenant_id, interviewer_id, scheduled_dt, body.duration_mins):
            raise HTTPException(409, "This interviewer already has an overlapping interview at that time")
        row = await conn.fetchrow("""
            INSERT INTO interview_schedules
              (tenant_id,application_id,candidate_id,requisition_id,interviewer_id,
               interview_type,scheduled_at,duration_mins,mode,meeting_link,location,notes)
            VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8,$9,$10,$11,NULLIF($12,''))
            RETURNING *
        """, actor.tenant_id, body.application_id, body.candidate_id,
             body.requisition_id, interviewer_id, body.interview_type,
             scheduled_dt, body.duration_mins, body.mode,
             body.meeting_link, body.location, body.notes)
        # Log activity
        await conn.execute("""
            INSERT INTO candidate_activities
              (tenant_id,candidate_id,user_id,activity_type,title,description)
            VALUES ($1,$2,$3,'interview_scheduled',$4,$5)
        """, actor.tenant_id, body.candidate_id, actor.user_id,
             f'{body.interview_type.title()} interview scheduled',
             f'Scheduled for {body.scheduled_at}, {body.duration_mins} min {body.mode}')
    return dict(row)

@interview_router.patch("/{interview_id}/status")
async def update_interview_status(interview_id: str, body: dict,
                                   actor: Actor=Depends(require_permission("interviews", "update"))):
    # BUG FIX (2026-08-10 audit): unconditional SET wiped feedback/rating to
    # NULL on every call, including a bare status-only update (e.g. marking
    # Completed with no feedback field in the request body) — COALESCE
    # preserves whatever was already on file when the caller doesn't send a
    # replacement value. status has no such guard: a genuine status change
    # (e.g. correcting Completed -> Cancelled) should always take effect.
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            UPDATE interview_schedules SET
              status=COALESCE($1,status), feedback=COALESCE($2,feedback), rating=COALESCE($3,rating)
            WHERE id=$4 AND tenant_id=$5 RETURNING *
        """, body.get('status'), body.get('feedback'), body.get('rating'),
             interview_id, actor.tenant_id)
        if not row: raise HTTPException(404,"Not found")
        if body.get('status') == 'completed':
            from services import activity_events
            _recruiter_id = row["interviewer_id"] or actor.user_id
            if _recruiter_id:
                await activity_events.log_recruiter_activity(
                    conn, actor.tenant_id, str(_recruiter_id),
                    f"{row['interview_type'] or 'interview'}_completed",
                    candidate_id=str(row["candidate_id"]) if row["candidate_id"] else None,
                    application_id=str(row["application_id"]) if row["application_id"] else None,
                    requisition_id=str(row["requisition_id"]) if row["requisition_id"] else None,
                )
    return dict(row)

# GET /interviews/upcoming removed (2026-08-10 audit) — zero frontend/test
# callers ever existed; the real "upcoming interviews" surface is
# GET /auto-interview/list (phase3.py), which every UI actually uses.

@interview_router.post("/{interview_id}/send-reminder")
async def send_interview_reminder(interview_id: str, actor: Actor=Depends(require_permission("interviews", "create"))):
    """Send an email reminder for a scheduled interview."""
    import smtplib, asyncpg, os as _os
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            SELECT i.*, c.full_name AS candidate_name, c.email AS candidate_email,
                   u.full_name AS interviewer_name
            FROM interview_schedules i
            JOIN candidates c ON c.id=i.candidate_id
            LEFT JOIN users u ON u.id=i.interviewer_id
            WHERE i.id=$1 AND i.tenant_id=$2
        """, interview_id, actor.tenant_id)
        if not row:
            raise HTTPException(404, "Interview not found")
        if row['status'] != 'scheduled':
            raise HTTPException(400, "Interview is not in scheduled state")
        # Update reminder_sent_at
        sent_row = await conn.fetchrow(
            "UPDATE interview_schedules SET reminder_sent_at=now() WHERE id=$1 AND tenant_id=$2 RETURNING reminder_sent_at",
            interview_id, actor.tenant_id)
    # Send email via tenant SMTP
    sent = False
    email = row['candidate_email']
    if email:
        try:
            _db_url = _os.environ.get("DATABASE_URL", "postgresql://app_user:apppw@db:5432/ats")
            _conn = await asyncpg.connect(_db_url)
            try:
                _cfg = await _conn.fetchrow(
                    "SELECT smtp_host,smtp_port,smtp_user,smtp_password,smtp_from,smtp_from_name,smtp_tls "
                    "FROM email_settings WHERE tenant_id=$1 AND is_active=TRUE LIMIT 1", actor.tenant_id)
                if _cfg and _cfg['smtp_host']:
                    _h = _cfg['smtp_host']; _p = _cfg['smtp_port'] or 587
                    _u = _cfg['smtp_user'] or ''; _pw = _cfg['smtp_password'] or ''
                    _f = _cfg['smtp_from'] or _u; _fn = _cfg['smtp_from_name'] or 'AVIIN ATS'
                    _tls = _cfg['smtp_tls'] if _cfg['smtp_tls'] is not None else True
                    sched_str = str(row['scheduled_at'])
                    _em = MIMEMultipart()
                    _em['Subject'] = f"Interview Reminder: {row['interview_type'].title()} Interview"
                    _em['From'] = f"{_fn} <{_f}>"
                    _em['To'] = email
                    body_parts = [
                        f"Dear {row['candidate_name']},",
                        "",
                        f"This is a reminder for your upcoming {row['interview_type'].title()} interview.",
                        "",
                        f"Date & Time : {sched_str}",
                        f"Duration    : {row['duration_mins']} minutes",
                        f"Mode        : {row['mode'].replace('_', ' ').title()}",
                    ]
                    if row['meeting_link']:
                        body_parts.append(f"Meeting Link: {row['meeting_link']}")
                    if row['location']:
                        body_parts.append(f"Location    : {row['location']}")
                    if row['notes']:
                        body_parts += ["", f"Notes: {row['notes']}"]
                    body_parts += ["", "Best regards,", "AVIIN Jobs Services", "https://ats.aviinjobs.com"]
                    _em.attach(MIMEText(chr(10).join(body_parts), "plain"))
                    with smtplib.SMTP(_h, _p, timeout=10) as _s:
                        _s.ehlo()
                        if _tls and _p == 587:
                            _s.starttls(); _s.ehlo()
                        if _u:
                            _s.login(_u, _pw)
                        _s.sendmail(_f, [email], _em.as_string())
                    sent = True
            finally:
                await _conn.close()
        except Exception as exc:
            print(f"Reminder email error: {exc}")
    # BUG FIX (2026-08-10 audit): this used to return the interview's own
    # scheduled_at (start time), mislabeled as when the reminder was sent.
    return {"sent": sent, "reminder_sent_at": str(sent_row['reminder_sent_at']), "channel": "email" if sent else "none"}

# ── P25: Client Portal ────────────────────────────────────────
client_portal_router = APIRouter(prefix="/client-portal", tags=["client-portal"])

class ClientLoginBody(BaseModel):
    email: str
    password: str

@client_portal_router.post("/login")
async def client_login(body: ClientLoginBody):
    """BUG FIX (2026-08-10 audit): this 500'd on every call, for any input -
    email/password were bare function params (bound as query params by
    FastAPI, not body, so credentials would travel in the URL and land in
    access logs) and the lookup crashed on db.system_conn()'s ''::uuid
    against a FORCE-RLS table. Real Pydantic body + a SECURITY DEFINER
    email-lookup function (sql/44...sql), same pattern as the token
    resolution above."""
    async with db.system_conn() as conn:
        user = await conn.fetchrow("SELECT * FROM get_client_portal_user_by_email($1)", body.email)
        if not user or not bcrypt.checkpw(body.password.encode(), user['password_hash'].encode()):
            raise HTTPException(401, "Invalid credentials")
        async with db.tenant_conn(str(user['tenant_id'])) as tconn:
            await tconn.execute(
                "UPDATE client_portal_users SET last_login_at=now() WHERE id=$1", user['id'])
    return {"id": str(user['id']), "email": user['email'],
            "full_name": user['full_name'], "company_name": user['company_name']}

@client_portal_router.get("/requisitions/{client_name}")
async def client_requisitions(client_name: str, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT r.id, r.title, r.status, r.created_at,
                   COUNT(a.id) AS total_submitted,
                   COUNT(a.id) FILTER (WHERE a.stage LIKE '%interview%') AS interviews,
                   COUNT(a.id) FILTER (WHERE a.stage='placed') AS hires
            FROM requisitions r
            LEFT JOIN applications a ON a.requisition_id=r.id AND a.tenant_id=r.tenant_id
            WHERE r.tenant_id=$1 AND r.client_name ILIKE '%'||$2||'%'
            GROUP BY r.id ORDER BY r.created_at DESC
        """, actor.tenant_id, client_name)
    return [dict(r) for r in rows]

@client_portal_router.get("/shortlist/{requisition_id}")
async def client_shortlist(requisition_id: str, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT a.id AS application_id, a.stage, a.created_at AS submitted_at,
                   c.id AS candidate_id, c.full_name, c.email,
                   c.total_exp_mo, c.skills, c.location, c.current_employer,
                   cs.readiness_index, cs.readiness_grade,
                   cf.decision AS client_decision, cf.feedback_text
            FROM applications a
            JOIN candidates c ON c.id=a.candidate_id
            LEFT JOIN candidate_scores cs ON cs.candidate_id=c.id AND cs.tenant_id=c.tenant_id
            LEFT JOIN client_feedback cf ON cf.application_id=a.id
            WHERE a.requisition_id=$1 AND a.tenant_id=$2
            ORDER BY cs.readiness_index DESC NULLS LAST
        """, requisition_id, actor.tenant_id)
    return [dict(r) for r in rows]

@client_portal_router.post("/feedback")
async def submit_feedback(body: dict, actor: Actor=Depends(get_actor)):
    # BUG FIX (2026-08-10 audit): ON CONFLICT DO NOTHING had no matching
    # unique/exclusion constraint to ever actually fire on, so every submit
    # inserted a fresh row - proven live, one candidate listed 3x on the
    # same client view. sql/44...sql adds a real UNIQUE(tenant_id,
    # application_id); this now genuinely upserts a revised decision
    # instead of stacking duplicates.
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            INSERT INTO client_feedback
              (tenant_id,application_id,candidate_id,requisition_id,
               decision,feedback_text,rating)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
            ON CONFLICT (tenant_id, application_id) DO UPDATE SET
              decision=EXCLUDED.decision, feedback_text=EXCLUDED.feedback_text,
              rating=EXCLUDED.rating, created_at=now()
            RETURNING *
        """, actor.tenant_id, body.get('application_id'), body['candidate_id'],
             body.get('requisition_id'), body['decision'],
             body.get('feedback_text'), body.get('rating'))
        await _notify_recruiter_of_feedback(conn, actor.tenant_id, body.get('application_id'), body['decision'], body.get('feedback_text'))
    return dict(row) if row else {"status": "already submitted"}

# ── Public client-portal endpoints (no auth, token-based) ─────────────────
# CRITICAL FIX (2026-08-10 audit): the token used to be unsigned
# base64url(tenant_id:req_id), forgeable by anyone since both halves are
# derivable from public data (tenant_id is hardcoded in the public careers
# page bundle, req_id is enumerable via GET /public/jobs). Proven live: a
# forged token pulled 151 real candidates off production with a plain curl
# request, zero credentials. Now a real, random, server-minted, DB-backed
# token (client_portal_tokens, sql/43...sql) with expiry + revocation.
# get_client_portal_token()/record_client_portal_access() are SECURITY
# DEFINER functions (owned by postgres) - same "anonymous token resolves
# tenant_id" pattern already used for NDA/offer e-sign and device
# enrollment, since this endpoint doesn't know its own tenant_id up front.
import secrets as _cp_secrets
import db as _cpdb


async def _notify_recruiter_of_feedback(conn, tenant_id: str, application_id: str, decision: str, feedback_text: str):
    """BUG FIX (2026-08-10 audit): client feedback used to be write-only —
    zero notification/outbox/email anywhere, so a client's decision never
    reached any internal user. Writes a real notification to the assigned
    recruiter (or a manager if unassigned), same correct column convention
    established elsewhere in this codebase (recipient_user_id/body)."""
    if not application_id:
        return
    app_row = await conn.fetchrow("""
        SELECT a.assigned_recruiter_id, c.full_name AS candidate_name, r.title
        FROM applications a
        JOIN candidates c ON c.id = a.candidate_id
        JOIN requisitions r ON r.id = a.requisition_id
        WHERE a.id = $1 AND a.tenant_id = $2
    """, application_id, tenant_id)
    if not app_row:
        return
    recipient = app_row["assigned_recruiter_id"]
    if not recipient:
        manager = await conn.fetchrow(
            "SELECT id FROM users WHERE tenant_id=$1 AND role='manager' LIMIT 1", tenant_id)
        recipient = manager["id"] if manager else None
    if not recipient:
        return
    body_text = f"Client marked {app_row['candidate_name']} as '{decision}' for {app_row['title']}."
    if feedback_text:
        body_text += f" Note: {feedback_text}"
    await conn.execute("""
        INSERT INTO notifications
          (tenant_id, user_id, recipient_user_id, title, body, type, resource, resource_id, channel)
        VALUES ($1,$2,$2,$3,$4,'info','application',$5,'inapp')
    """, tenant_id, recipient, "Client feedback received", body_text, application_id)

@client_portal_router.post("/generate-link")
async def generate_client_portal_link(requisition_id: str, actor: Actor = Depends(get_actor)):
    """Mint (or reuse) a real, random share token for a requisition. Replaces
    the old client-side base64(tenant_id:req_id) construction entirely -
    the frontend no longer builds tokens itself, it asks the backend for one."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        req = await conn.fetchval(
            "SELECT id FROM requisitions WHERE id=$1 AND tenant_id=$2", requisition_id, actor.tenant_id)
        if not req:
            raise HTTPException(404, "Requisition not found")
        existing = await conn.fetchrow("""
            SELECT id, token FROM client_portal_tokens
            WHERE tenant_id=$1 AND requisition_id=$2
              AND revoked_at IS NULL AND expires_at > now()
            ORDER BY created_at DESC LIMIT 1
        """, actor.tenant_id, requisition_id)
        if existing:
            return {"token": existing["token"], "reused": True}
        token = _cp_secrets.token_urlsafe(32)
        await conn.execute("""
            INSERT INTO client_portal_tokens (tenant_id, requisition_id, token, created_by)
            VALUES ($1, $2, $3, $4)
        """, actor.tenant_id, requisition_id, token, actor.user_id)
    return {"token": token, "reused": False}

@client_portal_router.post("/revoke/{requisition_id}")
async def revoke_client_portal_links(requisition_id: str, actor: Actor = Depends(get_actor)):
    """Revoke every active share link for a requisition - the only way to
    invalidate a leaked link now that tokens are real DB rows, not a
    reversible encoding with nothing to revoke."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        result = await conn.execute("""
            UPDATE client_portal_tokens SET revoked_at=now()
            WHERE tenant_id=$1 AND requisition_id=$2 AND revoked_at IS NULL
        """, actor.tenant_id, requisition_id)
    return {"status": "ok", "revoked": result}

@client_portal_router.get("/view/{token}")
async def public_shortlist(token: str):
    """No-auth shortlist view, resolved via a real random token."""
    async with _cpdb.system_conn() as sysconn:
        row = await sysconn.fetchrow("SELECT * FROM get_client_portal_token($1)", token)
        if not row:
            raise HTTPException(404, "Invalid or expired link")
        await sysconn.execute("SELECT record_client_portal_access($1)", token)
    tenant_id, req_id = str(row["tenant_id"]), str(row["requisition_id"])
    async with _cpdb.tenant_conn(tenant_id) as conn:
        req_row = await conn.fetchrow(
            "SELECT id, title, client_name, status FROM requisitions WHERE id=$1::uuid AND tenant_id=$2::uuid",
            req_id, tenant_id)
        if not req_row:
            raise HTTPException(404, "Requisition not found")
        rows = await conn.fetch("""
            SELECT a.id AS application_id, a.stage, a.created_at AS submitted_at,
                   c.id AS candidate_id, c.full_name, c.total_exp_mo, c.skills,
                   c.location, c.current_employer, c.current_designation,
                   cs.readiness_index, cs.readiness_grade,
                   cf.decision AS client_decision, cf.feedback_text
            FROM applications a
            JOIN candidates c ON c.id=a.candidate_id
            LEFT JOIN candidate_scores cs ON cs.candidate_id=c.id AND cs.tenant_id=c.tenant_id
            LEFT JOIN client_feedback cf ON cf.application_id=a.id
            WHERE a.requisition_id=$1 AND a.tenant_id=$2 AND a.stage <> 'rejected'
              AND c.is_active IS NOT FALSE
            ORDER BY cs.readiness_index DESC NULLS LAST
        """, req_id, tenant_id)
    return {
        "requisition": dict(req_row),
        "candidates": [dict(r) for r in rows],
    }

@client_portal_router.post("/feedback-public")
async def public_feedback(body: dict):
    """No-auth feedback submission, resolved via a real random token."""
    token = body.get('token', '')
    async with _cpdb.system_conn() as sysconn:
        row = await sysconn.fetchrow("SELECT * FROM get_client_portal_token($1)", token)
        if not row:
            raise HTTPException(404, "Invalid or expired link")
        await sysconn.execute("SELECT record_client_portal_access($1)", token)
    tenant_id, req_id = str(row["tenant_id"]), str(row["requisition_id"])
    application_id = body.get('application_id')
    async with _cpdb.tenant_conn(tenant_id) as conn:
        # BUG FIX (2026-08-10 audit): nothing previously checked that the
        # submitted application actually belongs to the token's own
        # requisition - a valid link for req A could attribute feedback to
        # any candidate in the tenant. RLS/FKs bounded it to the tenant, but
        # not to the right requisition.
        if application_id:
            owns = await conn.fetchval(
                "SELECT 1 FROM applications WHERE id=$1::uuid AND requisition_id=$2::uuid AND tenant_id=$3::uuid",
                application_id, req_id, tenant_id)
            if not owns:
                raise HTTPException(400, "Application does not belong to this requisition's shortlist")
        # Same duplicate-row fix as submit_feedback() above.
        await conn.execute("""
            INSERT INTO client_feedback
              (tenant_id, application_id, candidate_id, requisition_id, decision, feedback_text, rating)
            VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7)
            ON CONFLICT (tenant_id, application_id) DO UPDATE SET
              decision=EXCLUDED.decision, feedback_text=EXCLUDED.feedback_text,
              rating=EXCLUDED.rating, created_at=now()
        """, tenant_id, application_id, body['candidate_id'],
             req_id, body['decision'], body.get('feedback_text'), body.get('rating'))
        await _notify_recruiter_of_feedback(conn, tenant_id, application_id, body['decision'], body.get('feedback_text'))
    return {"status": "ok"}

# ── P26: SLA Dashboard ────────────────────────────────────────
sla_router = APIRouter(prefix="/sla", tags=["sla"])

@sla_router.get("")
async def sla_dashboard(status: Optional[str]=None, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT * FROM v_sla_dashboard
            WHERE tenant_id=$1
              AND ($2::text IS NULL OR status=$2)
            ORDER BY sla_breached DESC, age_days DESC
        """, actor.tenant_id, status)
    return [dict(r) for r in rows]

@sla_router.get("/summary")
async def sla_summary(actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            SELECT
                COUNT(*) AS total_requisitions,
                COUNT(*) FILTER (WHERE sla_breached) AS breached,
                COUNT(*) FILTER (WHERE NOT sla_breached AND status='open') AS on_track,
                ROUND(AVG(age_days),1) AS avg_age_days,
                ROUND(AVG(time_to_first_sub_hrs),1) AS avg_time_to_first_sub_hrs,
                ROUND(AVG(time_to_fill_days),1) AS avg_time_to_fill_days,
                COUNT(*) FILTER (WHERE total_submissions=0 AND age_days>7) AS stale_no_submission
            FROM v_sla_dashboard WHERE tenant_id=$1
        """, actor.tenant_id)
    return dict(row)

@sla_router.get("/audit-log")
async def audit_log(resource: Optional[str]=None, limit: int=50,
                     actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT al.*, u.full_name AS user_name
            FROM audit_logs al
            LEFT JOIN users u ON u.id=al.user_id
            WHERE al.tenant_id=$1
              AND ($2::text IS NULL OR al.resource=$2)
            ORDER BY al.created_at DESC LIMIT $3
        """, actor.tenant_id, resource, limit)
    return [dict(r) for r in rows]

# ── P26: Activity Timeline ────────────────────────────────────
activity_router = APIRouter(prefix="/activities", tags=["activities"])

@activity_router.get("/{candidate_id}")
async def candidate_timeline(candidate_id: str, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT ca.*, u.full_name AS user_name
            FROM candidate_activities ca
            LEFT JOIN users u ON u.id=ca.user_id
            WHERE ca.tenant_id=$1 AND ca.candidate_id=$2
            ORDER BY ca.created_at DESC
        """, actor.tenant_id, candidate_id)
    return [dict(r) for r in rows]

@activity_router.post("/{candidate_id}/note")
async def add_note(candidate_id: str, body: dict, actor: Actor=Depends(require_permission("candidate_engagement", "create"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            INSERT INTO candidate_activities
              (tenant_id,candidate_id,user_id,activity_type,title,description)
            VALUES ($1,$2,$3,'note',$4,$5) RETURNING *
        """, actor.tenant_id, candidate_id, actor.user_id,
             body.get('title','Note'), body.get('description',''))
    return dict(row)

# ── P27: JD Templates ────────────────────────────────────────
jd_tmpl_router = APIRouter(prefix="/jd-templates", tags=["jd-templates"])

@jd_tmpl_router.get("")
async def list_jd_templates(category: Optional[str]=None, search: Optional[str]=None,
                              actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT id,title,category,role_level,skills_required,
                   experience_min,experience_max,usage_count,is_system,is_active,created_at
            FROM jd_templates
            WHERE (tenant_id=$1 OR tenant_id IS NULL) AND is_active
              AND ($2::text IS NULL OR category=$2)
              AND ($3::text IS NULL OR title ILIKE '%'||$3||'%')
            ORDER BY usage_count DESC, title
        """, actor.tenant_id, category, search)
    return [dict(r) for r in rows]

@jd_tmpl_router.get("/{tmpl_id}")
async def get_jd_template(tmpl_id: str, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT * FROM jd_templates WHERE id=$1", tmpl_id)
        if not row: raise HTTPException(404,"Not found")
        await conn.execute(
            "UPDATE jd_templates SET usage_count=usage_count+1 WHERE id=$1", tmpl_id)
    return dict(row)

@jd_tmpl_router.post("")
async def create_jd_template(body: dict, actor: Actor=Depends(require_permission("jd_templates", "create"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            INSERT INTO jd_templates
              (tenant_id,title,category,role_level,skills_required,
               experience_min,experience_max,jd_text)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            ON CONFLICT (tenant_id,title) DO UPDATE SET jd_text=EXCLUDED.jd_text
            RETURNING *
        """, actor.tenant_id, body['title'], body.get('category','IT'),
             body.get('role_level','mid'), body.get('skills_required',[]),
             body.get('experience_min',0), body.get('experience_max'),
             body['jd_text'])
    return dict(row)

@jd_tmpl_router.get("/categories/list")
async def jd_categories(actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT category, COUNT(*) AS count FROM jd_templates
            WHERE tenant_id=$1 OR tenant_id IS NULL
            GROUP BY category ORDER BY count DESC
        """, actor.tenant_id)
    return [dict(r) for r in rows]
