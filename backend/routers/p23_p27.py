"""P23-P27 combined router: skills, bulk-cv, email templates,
interview schedules, client portal, SLA, JD templates, audit log."""
import bcrypt, json
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
import db
from deps import Actor, get_actor
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
async def add_skill(body: dict, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            INSERT INTO skills_taxonomy (tenant_id,skill_name,category,aliases)
            VALUES ($1,$2,$3,$4)
            ON CONFLICT (tenant_id,skill_name) DO UPDATE SET
              category=EXCLUDED.category, aliases=EXCLUDED.aliases
            RETURNING *
        """, actor.tenant_id, body['skill_name'], body.get('category','other'),
             body.get('aliases',[]))
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
async def bulk_parse(files: List[UploadFile]=File(...), actor: Actor=Depends(get_actor)):
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
async def create_template(body: dict, actor: Actor=Depends(get_actor)):
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
async def update_template(tmpl_id: str, body: dict, actor: Actor=Depends(get_actor)):
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
    for k,v in variables.items():
        subject = subject.replace(f'{{{{{k}}}}}', str(v))
        body    = body.replace(f'{{{{{k}}}}}', str(v))
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
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT i.*, c.full_name AS candidate_name, c.email AS candidate_email,
                   u.full_name AS interviewer_name,
                   r.title AS role_title
            FROM interview_schedules i
            JOIN candidates c ON c.id=i.candidate_id
            LEFT JOIN users u ON u.id=i.interviewer_id
            LEFT JOIN requisitions r ON r.id=i.requisition_id
            WHERE i.tenant_id=$1
              AND ($2::text IS NULL OR i.candidate_id::text=$2)
              AND ($3::text IS NULL OR i.status=$3)
            ORDER BY i.scheduled_at DESC
        """, actor.tenant_id, candidate_id, status)
    return [dict(r) for r in rows]

@interview_router.post("")
async def schedule_interview(body: InterviewIn, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            INSERT INTO interview_schedules
              (tenant_id,application_id,candidate_id,requisition_id,interviewer_id,
               interview_type,scheduled_at,duration_mins,mode,meeting_link,location,notes)
            VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8,$9,$10,$11,NULLIF($12,''))
            RETURNING *
        """, actor.tenant_id, body.application_id, body.candidate_id,
             body.requisition_id, body.interviewer_id, body.interview_type,
             _to_dt(body.scheduled_at), body.duration_mins, body.mode,
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
                                   actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            UPDATE interview_schedules SET
              status=$1, feedback=$2, rating=$3
            WHERE id=$4 AND tenant_id=$5 RETURNING *
        """, body.get('status'), body.get('feedback'), body.get('rating'),
             interview_id, actor.tenant_id)
        if not row: raise HTTPException(404,"Not found")
    return dict(row)

@interview_router.get("/upcoming")
async def upcoming_interviews(actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT i.*, c.full_name AS candidate_name,
                   u.full_name AS interviewer_name, r.title AS role_title
            FROM interview_schedules i
            JOIN candidates c ON c.id=i.candidate_id
            LEFT JOIN users u ON u.id=i.interviewer_id
            LEFT JOIN requisitions r ON r.id=i.requisition_id
            WHERE i.tenant_id=$1 AND i.status='scheduled'
              AND i.scheduled_at >= now()
            ORDER BY i.scheduled_at ASC LIMIT 20
        """, actor.tenant_id)
    return [dict(r) for r in rows]

# ── P25: Client Portal ────────────────────────────────────────
client_portal_router = APIRouter(prefix="/client-portal", tags=["client-portal"])

@client_portal_router.post("/login")
async def client_login(email: str, password: str):
    async with db.system_conn() as conn:
        user = await conn.fetchrow(
            "SELECT * FROM client_portal_users WHERE email=$1 AND is_active", email)
        if not user or not bcrypt.checkpw(password.encode(), user['password_hash'].encode()):
            raise HTTPException(401, "Invalid credentials")
        await conn.execute(
            "UPDATE client_portal_users SET last_login_at=now() WHERE id=$1", user['id'])
    return {"id": str(user['id']), "email": user['email'],
            "full_name": user['full_name'], "company_name": user['company_name']}

@client_portal_router.get("/requisitions/{client_name}")
async def client_requisitions(client_name: str, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT r.id, r.title, r.status, r.created_at,
                   COUNT(a.id) AS total_submitted,
                   COUNT(a.id) FILTER (WHERE a.stage='interview') AS interviews,
                   COUNT(a.id) FILTER (WHERE a.stage='hired') AS hires
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
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            INSERT INTO client_feedback
              (tenant_id,application_id,candidate_id,requisition_id,
               decision,feedback_text,rating)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
            ON CONFLICT DO NOTHING RETURNING *
        """, actor.tenant_id, body.get('application_id'), body['candidate_id'],
             body.get('requisition_id'), body['decision'],
             body.get('feedback_text'), body.get('rating'))
    return dict(row) if row else {"status": "already submitted"}

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
async def add_note(candidate_id: str, body: dict, actor: Actor=Depends(get_actor)):
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
async def create_jd_template(body: dict, actor: Actor=Depends(get_actor)):
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
