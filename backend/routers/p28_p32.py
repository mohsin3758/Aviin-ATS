"""P28-P32: Audit Log, Reports, Job Board, n8n Workflows,
Salary Benchmarking, Notification Center."""
import csv, io, os
from typing import Optional
from fastapi import APIRouter, Depends, Response, HTTPException
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
    # UTF-8 BOM (2026-08-10 audit, minor caveat) — without it Excel on
    # Windows mis-renders non-ASCII names; the newer pipeline-board CSV
    # export already does this, these four were the inconsistent ones.
    return "﻿" + output.getvalue()

@export_router.get("/candidates")
async def export_candidates(include_inactive: bool = False, actor: Actor=Depends(get_actor)):
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
            -- BUG FIX (2026-08-10 audit): the old unqualified join against
            -- candidate_scores (one row per candidate x requisition) fanned
            -- out into up to 22 identical duplicate rows per candidate.
            -- LATERAL picks only the single most-recently-scored row.
            LEFT JOIN LATERAL (
                SELECT readiness_index, readiness_grade
                FROM candidate_scores s
                WHERE s.candidate_id = c.id AND s.tenant_id = c.tenant_id
                ORDER BY s.scored_at DESC NULLS LAST LIMIT 1
            ) cs ON true
            WHERE c.tenant_id=$1 AND ($2::boolean OR c.is_active IS NOT FALSE)
            ORDER BY c.created_at DESC
        """, actor.tenant_id, include_inactive)
    fields = ['full_name','email','phone','location','total_exp_mo','current_employer',
              'skills','education_level','readiness_index','readiness_grade','added_date','source']
    csv_data = await to_csv([dict(r) for r in rows], fields)
    return Response(content=csv_data, media_type='text/csv',
                    headers={"Content-Disposition":"attachment; filename=candidates.csv"})

@export_router.get("/requisitions")
async def export_requisitions(include_inactive: bool = False, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT r.title, r.status, r.employment_type, r.location,
                   r.positions_count, r.created_at::date AS opened_date,
                   COUNT(a.id) AS submissions,
                   COUNT(a.id) FILTER (WHERE a.stage='placed') AS hires
            FROM requisitions r
            LEFT JOIN applications a ON a.requisition_id=r.id AND a.tenant_id=r.tenant_id
            -- BUG FIX (2026-08-10 audit): no is_active filter meant 240 of
            -- 283 exported rows (85%) were soft-deleted (mostly QA test
            -- garbage), dominating the real 43 live requisitions.
            WHERE r.tenant_id=$1 AND ($2::boolean OR r.is_active IS NOT FALSE)
            GROUP BY r.id ORDER BY r.created_at DESC
        """, actor.tenant_id, include_inactive)
    fields = ['title','status','employment_type','location','positions_count',
              'opened_date','submissions','hires']
    csv_data = await to_csv([dict(r) for r in rows], fields)
    return Response(content=csv_data, media_type='text/csv',
                    headers={"Content-Disposition":"attachment; filename=requisitions.csv"})

@export_router.get("/placements")
async def export_placements(actor: Actor=Depends(get_actor)):
    # BUG FIX (2026-08-10 audit): this endpoint has returned HTTP 500 on
    # every call since it was written — 4 of the 10 selected columns don't
    # exist on `placements` at all (p.placed_by, p.client_name, p.rate,
    # p.currency; real columns are client_id, bill_rate, pay_rate, and
    # there is no currency column — this product is India-only, INR
    # hardcoded per CLAUDE.md). Recruiter credit resolves via the real
    # offer -> application -> assigned_recruiter_id chain, since placements
    # itself has no recruiter column.
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT c.full_name AS candidate_name, c.email, c.phone,
                   r.title AS role, cl.name AS client_name, p.start_date, p.end_date,
                   p.bill_rate, p.pay_rate, u.full_name AS recruiter
            FROM placements p
            JOIN candidates c ON c.id=p.candidate_id
            JOIN requisitions r ON r.id=p.requisition_id
            LEFT JOIN clients cl ON cl.id=p.client_id
            LEFT JOIN offers o ON o.id=p.offer_id
            LEFT JOIN applications a ON a.id=o.application_id
            LEFT JOIN users u ON u.id=a.assigned_recruiter_id
            WHERE p.tenant_id=$1 ORDER BY p.start_date DESC
        """, actor.tenant_id)
    fields = ['candidate_name','email','phone','role','client_name',
              'start_date','end_date','bill_rate','pay_rate','recruiter']
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

# GET /jobs/{job_id} and POST /jobs/{job_id}/apply were removed here —
# both were unreachable (the internal Job Board page is read-only browse,
# no apply button; the real apply flow only ever ran through
# public_jobs_router's /public/jobs/{job_id} and /public/jobs/apply
# below, which don't require login, unlike these did). Two parallel,
# independently-coded "job board apply" implementations is exactly the
# kind of duplication that silently drifts out of sync — e.g. referral
# click-through tracking was added to /public/jobs/apply only, and
# would have missed anyone still on this dead path.

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
              -- BUG FIX (2026-08-10 audit): this only matched when the
              -- STORED benchmark title contained the caller's query -
              -- real titles like "Senior Python Developer, 3yr" never
              -- matched a stored "Python Developer 2-5yr" row, since the
              -- stored (shorter) title doesn't contain the longer query.
              -- Bidirectional match fixes both directions.
              AND ($2 ILIKE '%'||role_title||'%' OR role_title ILIKE '%'||$2||'%')
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
    # BUG FIX (2026-08-10 audit): missing the is_active filter every other
    # endpoint adopted when soft-delete shipped - this was counting
    # soft-deleted (mostly QA test) requisitions as real open demand.
    # Verified live pre-fix: reported 240 open reqs / 194 Python demand
    # where the real figures were 21 open / 9 Python.
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT skill, COUNT(*) AS demand_count
            FROM requisitions, unnest(skills_required) AS skill
            WHERE tenant_id=$1 AND status='open' AND is_active IS NOT FALSE
            GROUP BY skill ORDER BY demand_count DESC LIMIT 30
        """, actor.tenant_id)
        total_open = await conn.fetchval(
            "SELECT COUNT(*) FROM requisitions WHERE tenant_id=$1 AND status='open' AND is_active IS NOT FALSE",
            actor.tenant_id)
    return {"total_open_reqs": total_open,
            "top_skills": [dict(r) for r in rows]}

# ── P32: Notification Center ──────────────────────────────────
notif_router = APIRouter(prefix="/notifications", tags=["notifications"])

# BUG FIX (2026-08-10 audit): every one of these queries filtered on
# `user_id` (a legacy column almost nothing writes to anymore) instead of
# the real, documented recipient columns `recipient_user_id`/
# `recipient_role` every real write site actually populates. This let
# role-targeted notifications (207 real rows: manager/admin/recruiter)
# leak to EVERY user in the tenant regardless of who they were addressed
# to — confirmed live, a real recruiter's unread count included every
# manager- and admin-only alert. Fixed to the documented contract
# (sql/03_phase2_n8n_additions.sql's own comment: "frontend P4+ queries
# WHERE recipient_user_id = me OR recipient_role = my_role").
_RECIPIENT_SCOPE_SQL = "(recipient_user_id=$2 OR recipient_role=$3)"


@notif_router.get("")
async def get_notifications(is_read: Optional[bool]=None, limit: int=30,
                              actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(f"""
            SELECT * FROM notifications
            WHERE tenant_id=$1 AND {_RECIPIENT_SCOPE_SQL}
              AND ($4::bool IS NULL OR is_read=$4)
            ORDER BY created_at DESC LIMIT $5
        """, actor.tenant_id, actor.user_id, actor.role, is_read, limit)
    return [dict(r) for r in rows]

@notif_router.get("/unread-count")
async def unread_count(actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        count = await conn.fetchval(f"""
            SELECT COUNT(*) FROM notifications
            WHERE tenant_id=$1 AND {_RECIPIENT_SCOPE_SQL} AND NOT is_read
        """, actor.tenant_id, actor.user_id, actor.role)
    return {"unread": count}

@notif_router.post("/{notif_id}/read")
async def mark_read(notif_id: str, actor: Actor=Depends(get_actor)):
    # BUG FIX: previously had no recipient check at all — any authenticated
    # user could mark any other user's notification read. Now scoped the
    # same way the list/count endpoints are.
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute("""
            UPDATE notifications SET is_read=true, read_at=now()
            WHERE id=$1 AND tenant_id=$2 AND (recipient_user_id=$3 OR recipient_role=$4)
        """, notif_id, actor.tenant_id, actor.user_id, actor.role)
    return {"marked_read": True}

@notif_router.post("/read-all")
async def mark_all_read(actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute(f"""
            UPDATE notifications SET is_read=true, read_at=now()
            WHERE tenant_id=$1 AND {_RECIPIENT_SCOPE_SQL} AND NOT is_read
        """, actor.tenant_id, actor.user_id, actor.role)
    return {"marked_all_read": True}

@notif_router.post("")
async def create_notification(body: dict, actor: Actor=Depends(get_actor)):
    # notifications_check requires recipient_user_id or recipient_role to be
    # set — same bug class as scheduler.py's SLA-escalation insert, fixed the
    # same way (matches the working nda.py/resume_intake_service.py pattern).
    # BUG FIX: body.get('message') read a field name that doesn't exist on
    # this table (the real column is `body`) — this endpoint has zero real
    # callers today per the audit, but fixed for correctness rather than
    # left as a landmine for whoever wires it up next.
    target_user = body.get('user_id')
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            INSERT INTO notifications (tenant_id,user_id,recipient_user_id,recipient_role,title,body,type,resource,resource_id,channel)
            VALUES ($1,$2,$2,$3,$4,$5,$6,$7,$8,'inapp') RETURNING *
        """, actor.tenant_id, target_user, body.get('recipient_role') if not target_user else None,
             body['title'], body.get('body') or body.get('message'), body.get('type', 'info'),
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

@public_jobs_router.get("/jobs/feed.xml")
async def public_jobs_feed(tenant_id: str):
    """Free, automatic job distribution: standard XML job-feed format
    (Indeed's documented free organic-feed schema, also accepted by Jooble
    and most other aggregators that support publisher feeds). Register
    this URL once with each aggregator's free publisher program and every
    future open requisition gets picked up automatically on their next
    crawl - no manual posting, no per-job action, no paid API/account.
    This is the actual mechanism "free multi-board auto-posting" runs on
    everywhere it's genuinely free; there is no zero-click free posting
    path that skips it."""
    import xml.sax.saxutils as sx
    base = os.environ.get("NEXT_PUBLIC_APP_URL", "https://ats.aviinjobs.com")
    async with _db_public.tenant_conn(tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT r.id, r.title, r.location, r.employment_type, r.description,
                   r.skills_required, r.created_at, t.name AS company_name
            FROM requisitions r
            JOIN tenants t ON t.id = r.tenant_id
            WHERE r.tenant_id=$1::uuid AND r.status='open'
            ORDER BY r.created_at DESC LIMIT 500
        """, tenant_id)

    def esc(s): return sx.escape(str(s or ''))
    jobs_xml = []
    for r in rows:
        desc = r["description"] or f"{r['title']} opportunity"
        skills = ', '.join(r["skills_required"] or [])
        jobs_xml.append(f"""  <job>
    <title><![CDATA[{r['title']}]]></title>
    <date>{r['created_at'].strftime('%a, %d %b %Y %H:%M:%S GMT')}</date>
    <referencenumber>{r['id']}</referencenumber>
    <url><![CDATA[{base}/careers/{r['id']}]]></url>
    <company><![CDATA[{r['company_name'] or 'AVIIN Jobs Services'}]]></company>
    <city><![CDATA[{r['location'] or ''}]]></city>
    <country>IN</country>
    <description><![CDATA[{desc}\n\nSkills: {skills}]]></description>
    <jobtype><![CDATA[{r['employment_type'] or 'Full-time'}]]></jobtype>
  </job>""")

    xml_body = f"""<?xml version="1.0" encoding="UTF-8"?>
<source>
  <publisher>AVIIN Jobs Services</publisher>
  <publisherurl><![CDATA[{base}/careers]]></publisherurl>
  <lastBuildDate>{__import__('datetime').datetime.utcnow().strftime('%a, %d %b %Y %H:%M:%S GMT')}</lastBuildDate>
{chr(10).join(jobs_xml)}
</source>"""
    return Response(content=xml_body, media_type="application/xml")


@public_jobs_router.get("/jobs/{job_id}")
async def public_get_job(job_id: str, tenant_id: str):
    """Single-job fetch for the per-job careers page
    (careers/[jobId]/page.tsx) - used both by generateMetadata (so
    Facebook/LinkedIn/Twitter's crawlers, which don't execute JS, see a
    real title/description in the page's initial HTML) and by the
    client-rendered apply UI on the same page."""
    async with _db_public.tenant_conn(tenant_id) as conn:
        row = await conn.fetchrow("""
            SELECT r.id, r.title, r.location, r.employment_type, r.description,
                   r.skills_required, r.positions_count, r.created_at
            FROM requisitions r
            WHERE r.id=$1::uuid AND r.tenant_id=$2::uuid AND r.status='open'
        """, job_id, tenant_id)
    if not row:
        raise HTTPException(status_code=404, detail="Job not found or closed")
    return dict(row)


@public_jobs_router.post("/jobs/apply")
async def public_apply(body: dict):
    """No-auth public job application — uses db.tenant_conn for RLS.

    HARD RULE #12: this is a genuinely public, anonymous endpoint that
    stores name/email/phone/employer directly from an unauthenticated
    applicant — the worst-case path for a missing consent_records row
    (found in the 2026-08-09 BGV audit: this was the ONLY candidate-
    creation path with zero consent trail at all, out of 8 checked).
    Both public apply forms (careers/page.tsx and the per-job detail
    page) now require a real checkbox before submitting and send
    consent_given=true — reject outright if it's missing rather than
    silently defaulting it, since this is the one path where genuine,
    explicit, candidate-given consent is both meaningful and achievable.
    """
    tenant_id = body.get('tenant_id', '')
    job_id = body.get('job_id', '')
    if not tenant_id or not job_id:
        raise HTTPException(status_code=400, detail="tenant_id and job_id required")
    if not body.get('consent_given'):
        raise HTTPException(status_code=400, detail="Consent to store and process your details is required to apply")
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
            await conn.execute(
                "INSERT INTO consent_records (tenant_id,candidate_id,data_category,channel,consent_given,consent_text) "
                "VALUES ($1::uuid,$2,'resume_processing','public_job_board',TRUE,$3)",
                tenant_id, cand['id'],
                f"Applicant checked the DPDP 2023 consent box on the public job application form for job {job_id}.",
            )
        await conn.execute("""
            INSERT INTO applications (tenant_id, candidate_id, requisition_id, stage)
            VALUES ($1::uuid, $2, $3::uuid, 'sourced')
            ON CONFLICT DO NOTHING
        """, tenant_id, cand['id'], job_id)
        ref_code = body.get('ref')
        if ref_code:
            await conn.execute("""
                UPDATE referral_links SET candidate_ids = array_append(candidate_ids, $1::uuid)
                WHERE tenant_id=$2::uuid AND unique_code=$3 AND NOT ($1::uuid = ANY(candidate_ids))
            """, cand['id'], tenant_id, ref_code)
    return {"applied": True, "candidate_id": str(cand['id'])}

