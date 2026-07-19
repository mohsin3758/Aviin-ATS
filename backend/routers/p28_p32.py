"""P28-P32: Audit Log, Reports, Job Board, n8n Workflows,
Salary Benchmarking, Notification Center."""
import csv, io
from typing import Optional
from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel
import db
from deps import Actor, get_actor

# ── P28: Audit Log ────────────────────────────────────────────
audit_router = APIRouter(prefix="/audit", tags=["audit"])

@audit_router.get("")
async def get_audit_log(resource: Optional[str]=None, user_id: Optional[str]=None,
                         limit: int=100, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT al.*, u.full_name AS user_name
            FROM audit_logs al
            LEFT JOIN users u ON u.id=al.user_id
            WHERE al.tenant_id=$1
              AND ($2::text IS NULL OR al.resource=$2)
              AND ($3::text IS NULL OR al.user_id::text=$3)
            ORDER BY al.created_at DESC LIMIT $4
        """, actor.tenant_id, resource, user_id, limit)
    return [dict(r) for r in rows]

@audit_router.post("/log")
async def write_audit(body: dict, actor: Actor=Depends(get_actor)):
    """Write an audit log entry (called from frontend for UI actions)."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute("""
            INSERT INTO audit_logs (tenant_id,user_id,user_email,action,resource,resource_id,new_data)
            VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
        """, actor.tenant_id, actor.user_id, actor.email,
             body.get('action','update'), body.get('resource','unknown'),
             body.get('resource_id'), '{}')
    return {"logged": True}

# ── P28: CSV/Excel Export ─────────────────────────────────────
export_router = APIRouter(prefix="/export", tags=["export"])

async def to_csv(rows: list, fields: list) -> str:
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=fields, extrasaction='ignore')
    writer.writeheader()
    for row in rows:
        writer.writerow({k: (str(v) if v is not None else '') for k,v in row.items() if k in fields})
    return output.getvalue()

@export_router.get("/candidates")
async def export_candidates(actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT c.full_name, c.email, c.phone, c.location,
                   c.total_exp_mo, c.current_employer, c.source,
                   array_to_string(c.skills,',') AS skills,
                   cpd.education_level,
                   cs.readiness_index, cs.readiness_grade,
                   c.created_at::date AS added_date
            FROM candidates c
            LEFT JOIN candidate_parsed_data cpd ON cpd.candidate_id=c.id AND cpd.tenant_id=c.tenant_id
            LEFT JOIN candidate_scores cs ON cs.candidate_id=c.id AND cs.tenant_id=c.tenant_id
            WHERE c.tenant_id=$1 ORDER BY c.created_at DESC
        """, actor.tenant_id)
    fields = ['full_name','email','phone','location','total_exp_mo','current_employer',
              'skills','education_level','readiness_index','readiness_grade','added_date','source']
    csv_data = await to_csv([dict(r) for r in rows], fields)
    return Response(content=csv_data, media_type='text/csv',
                    headers={"Content-Disposition":"attachment; filename=candidates.csv"})

@export_router.get("/requisitions")
async def export_requisitions(actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT r.title, r.status, r.employment_type, r.location,
                   r.positions_count, r.created_at::date AS opened_date,
                   COUNT(a.id) AS submissions,
                   COUNT(a.id) FILTER (WHERE a.stage='hired') AS hires
            FROM requisitions r
            LEFT JOIN applications a ON a.requisition_id=r.id AND a.tenant_id=r.tenant_id
            WHERE r.tenant_id=$1
            GROUP BY r.id ORDER BY r.created_at DESC
        """, actor.tenant_id)
    fields = ['title','status','employment_type','location','positions_count',
              'opened_date','submissions','hires']
    csv_data = await to_csv([dict(r) for r in rows], fields)
    return Response(content=csv_data, media_type='text/csv',
                    headers={"Content-Disposition":"attachment; filename=requisitions.csv"})

@export_router.get("/placements")
async def export_placements(actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT c.full_name AS candidate_name, c.email, c.phone,
                   r.title AS role, p.client_name, p.start_date, p.end_date,
                   p.rate, p.currency, u.full_name AS recruiter
            FROM placements p
            JOIN candidates c ON c.id=p.candidate_id
            JOIN requisitions r ON r.id=p.requisition_id
            LEFT JOIN users u ON u.id=p.placed_by
            WHERE p.tenant_id=$1 ORDER BY p.start_date DESC
        """, actor.tenant_id)
    fields = ['candidate_name','email','phone','role','client_name',
              'start_date','end_date','rate','currency','recruiter']
    csv_data = await to_csv([dict(r) for r in rows], fields)
    return Response(content=csv_data, media_type='text/csv',
                    headers={"Content-Disposition":"attachment; filename=placements.csv"})

@export_router.get("/kpi-report")
async def export_kpi_report(month: Optional[int]=None, year: Optional[int]=None,
                              actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT u.full_name AS recruiter, u.email,
                   k.period_month AS month, k.period_year AS year,
                   k.total_score, k.grade, k.contribution_margin,
                   k.calculated_incentive, k.immediate_payout,
                   k.retention_bank_amount, k.status
            FROM recruiter_kpi_scores k
            JOIN users u ON u.id=k.user_id
            WHERE k.tenant_id=$1
              AND ($2::int IS NULL OR k.period_month=$2)
              AND ($3::int IS NULL OR k.period_year=$3)
            ORDER BY k.period_year DESC, k.period_month DESC, k.total_score DESC
        """, actor.tenant_id, month, year)
    fields = ['recruiter','email','month','year','total_score','grade',
              'contribution_margin','calculated_incentive','immediate_payout',
              'retention_bank_amount','status']
    csv_data = await to_csv([dict(r) for r in rows], fields)
    return Response(content=csv_data, media_type='text/csv',
                    headers={"Content-Disposition":"attachment; filename=kpi_report.csv"})

# ── P29: Public Job Board API ─────────────────────────────────
jobs_router = APIRouter(prefix="/jobs", tags=["jobs"])

@jobs_router.get("")
async def public_jobs(location: Optional[str]=None, type: Optional[str]=None,
                       search: Optional[str]=None, actor: Actor=Depends(get_actor)):
    """Public-facing job listings."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT r.id, r.title, r.location, r.employment_type,
                   r.skills_required, r.created_at,
                   r.positions_count,
                   array_length(r.skills_required,1) AS skill_count
            FROM requisitions r
            WHERE r.tenant_id=$1 AND r.status='open'
              AND ($2::text IS NULL OR r.location ILIKE '%'||$2||'%')
              AND ($3::text IS NULL OR r.employment_type=$3)
              AND ($4::text IS NULL OR r.title ILIKE '%'||$4||'%'
                   OR $4 = ANY(r.skills_required))
            ORDER BY r.created_at DESC
        """, actor.tenant_id, location, type, search)
    return [dict(r) for r in rows]

@jobs_router.get("/{job_id}")
async def get_job(job_id: str, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            SELECT r.id, r.title, r.description, r.location, r.employment_type,
                   r.skills_required, r.positions_count, r.created_at
            FROM requisitions r WHERE r.id=$1 AND r.tenant_id=$2 AND r.status='open'
        """, job_id, actor.tenant_id)
    if not row: raise __import__('fastapi').HTTPException(404,"Job not found")
    return dict(row)

@jobs_router.post("/{job_id}/apply")
async def apply_for_job(job_id: str, body: dict, actor: Actor=Depends(get_actor)):
    """Direct job application from job board."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        # Find or create candidate
        cand = await conn.fetchrow(
            "SELECT id FROM candidates WHERE email=$1 AND tenant_id=$2",
            body.get('email'), actor.tenant_id)
        if not cand:
            cand = await conn.fetchrow("""
                INSERT INTO candidates (tenant_id,full_name,email,phone,total_exp_mo,source)
                VALUES ($1,$2,$3,$4,$5,'job_board') RETURNING id
            """, actor.tenant_id, body.get('full_name'), body.get('email'),
                 body.get('phone'), body.get('experience_months',0))
        # Create application
        app = await conn.fetchrow("""
            INSERT INTO applications (tenant_id,candidate_id,requisition_id,stage)
            VALUES ($1,$2,$3,'applied')
            ON CONFLICT DO NOTHING RETURNING id
        """, actor.tenant_id, cand['id'], job_id)
    return {"applied": True, "candidate_id": str(cand['id'])}

# ── P31: Salary Benchmarking ──────────────────────────────────
salary_router = APIRouter(prefix="/salary-benchmark", tags=["salary-benchmark"])

@salary_router.get("")
async def get_benchmarks(role: Optional[str]=None, location: Optional[str]=None,
                          exp_years: Optional[float]=None, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT * FROM salary_benchmarks
            WHERE (tenant_id IS NULL OR tenant_id=$1)
              AND ($2::text IS NULL OR role_title ILIKE '%'||$2||'%')
              AND ($3::text IS NULL OR location ILIKE '%'||$3||'%')
              AND ($4::numeric IS NULL OR (exp_min<=$4 AND (exp_max IS NULL OR exp_max>=$4)))
            ORDER BY role_title, exp_min
        """, actor.tenant_id, role, location, exp_years)
    return [dict(r) for r in rows]

@salary_router.get("/suggest")
async def salary_suggestion(role: str, exp_years: float,
                              location: str='Bengaluru', actor: Actor=Depends(get_actor)):
    """Instant salary suggestion — zero-token rule engine."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            SELECT role_title, location, exp_min, exp_max,
                   salary_min, salary_median, salary_max
            FROM salary_benchmarks
            WHERE (tenant_id IS NULL OR tenant_id=$1)
              AND role_title ILIKE '%'||$2||'%'
              AND exp_min<=$3 AND (exp_max IS NULL OR exp_max>=$3)
              AND location ILIKE '%'||$4||'%'
            ORDER BY ABS(($3-(exp_min+COALESCE(exp_max,exp_min))/2)) ASC
            LIMIT 1
        """, actor.tenant_id, role, exp_years, location)
    if not row:
        # Fallback: generic estimate
        base = 500000 + (exp_years * 150000)
        return {"role": role, "exp_years": exp_years, "location": location,
                "salary_min": int(base*0.7), "salary_median": int(base),
                "salary_max": int(base*1.5), "source": "estimate",
                "note": "No benchmark data found — using estimate"}
    return dict(row)

@salary_router.get("/market-demand")
async def market_demand(actor: Actor=Depends(get_actor)):
    """Skills demand from open requisitions — zero-token market intelligence."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT skill, COUNT(*) AS demand_count
            FROM requisitions, unnest(skills_required) AS skill
            WHERE tenant_id=$1 AND status='open'
            GROUP BY skill ORDER BY demand_count DESC LIMIT 30
        """, actor.tenant_id)
        total_open = await conn.fetchval(
            "SELECT COUNT(*) FROM requisitions WHERE tenant_id=$1 AND status='open'",
            actor.tenant_id)
    return {"total_open_reqs": total_open,
            "top_skills": [dict(r) for r in rows]}

# ── P32: Notification Center ──────────────────────────────────
notif_router = APIRouter(prefix="/notifications", tags=["notifications"])

@notif_router.get("")
async def get_notifications(is_read: Optional[bool]=None, limit: int=30,
                              actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT * FROM notifications
            WHERE tenant_id=$1 AND (user_id IS NULL OR user_id=$2)
              AND ($3::bool IS NULL OR is_read=$3)
            ORDER BY created_at DESC LIMIT $4
        """, actor.tenant_id, actor.user_id, is_read, limit)
    return [dict(r) for r in rows]

@notif_router.get("/unread-count")
async def unread_count(actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        count = await conn.fetchval("""
            SELECT COUNT(*) FROM notifications
            WHERE tenant_id=$1 AND (user_id IS NULL OR user_id=$2) AND NOT is_read
        """, actor.tenant_id, actor.user_id)
    return {"unread": count}

@notif_router.post("/{notif_id}/read")
async def mark_read(notif_id: str, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute("""
            UPDATE notifications SET is_read=true, read_at=now()
            WHERE id=$1 AND tenant_id=$2
        """, notif_id, actor.tenant_id)
    return {"marked_read": True}

@notif_router.post("/read-all")
async def mark_all_read(actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute("""
            UPDATE notifications SET is_read=true, read_at=now()
            WHERE tenant_id=$1 AND (user_id IS NULL OR user_id=$2) AND NOT is_read
        """, actor.tenant_id, actor.user_id)
    return {"marked_all_read": True}

@notif_router.post("")
async def create_notification(body: dict, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            INSERT INTO notifications (tenant_id,user_id,title,message,type,resource,resource_id)
            VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
        """, actor.tenant_id, body.get('user_id'), body['title'],
             body.get('message'), body.get('type','info'),
             body.get('resource'), body.get('resource_id'))
    return dict(row)


# ── Public Jobs Board (no auth) ───────────────────────────────────────────────
import db as _db_public

public_jobs_router = APIRouter(prefix="/public", tags=["public"])

@public_jobs_router.get("/jobs")
async def public_list_jobs(
    tenant_id: str,
    search: Optional[str] = None,
    location: Optional[str] = None,
):
    """No-auth public job board endpoint — uses db.tenant_conn for RLS."""
    async with _db_public.tenant_conn(tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT r.id, r.title, r.location, r.employment_type, r.description,
                   r.skills_required, r.positions_count, r.created_at
            FROM requisitions r
            WHERE r.tenant_id=$1::uuid AND r.status='open'
              AND ($2::text IS NULL OR lower(r.title) LIKE '%'||lower($2)||'%')
              AND ($3::text IS NULL OR lower(r.location) LIKE '%'||lower($3)||'%')
            ORDER BY r.created_at DESC LIMIT 50
        """, tenant_id, search, location)
    return [dict(r) for r in rows]

@public_jobs_router.post("/jobs/apply")
async def public_apply(body: dict):
    """No-auth public job application — uses db.tenant_conn for RLS."""
    tenant_id = body.get('tenant_id', '')
    job_id = body.get('job_id', '')
    if not tenant_id or not job_id:
        raise HTTPException(status_code=400, detail="tenant_id and job_id required")
    async with _db_public.tenant_conn(tenant_id) as conn:
        job = await conn.fetchrow(
            "SELECT id FROM requisitions WHERE id=$1::uuid AND tenant_id=$2::uuid AND status='open'",
            job_id, tenant_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found or closed")
        email = body.get('email', '').lower()
        cand = await conn.fetchrow(
            "SELECT id FROM candidates WHERE email=$1 AND tenant_id=$2::uuid",
            email, tenant_id)
        if not cand:
            cand = await conn.fetchrow("""
                INSERT INTO candidates
                  (tenant_id, full_name, email, phone, location, current_employer, total_exp_mo, source)
                VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, 'job_board') RETURNING id
            """, tenant_id,
                 body.get('full_name', ''), email,
                 body.get('phone'), body.get('location'),
                 body.get('current_employer'),
                 int(body.get('experience_months', 0)))
        await conn.execute("""
            INSERT INTO applications (tenant_id, candidate_id, requisition_id, stage)
            VALUES ($1::uuid, $2, $3::uuid, 'sourced')
            ON CONFLICT DO NOTHING
        """, tenant_id, cand['id'], job_id)
    return {"applied": True, "candidate_id": str(cand['id'])}

