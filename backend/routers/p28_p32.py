"""P28-P32: Audit Log, Reports, Job Board, n8n Workflows,
Salary Benchmarking, Notification Center."""
import csv, io, os, json as _json
from typing import Optional
from fastapi import APIRouter, Depends, Response, HTTPException, Form, File, UploadFile
from pydantic import BaseModel
import db
from deps import Actor, get_actor, require_role_or_trusted_internal
from services import source_attribution

_MGMT_ROLES = ("admin", "super_admin", "manager", "lead_recruiter")

# ── P28: Audit Log ────────────────────────────────────────────
audit_router = APIRouter(prefix="/audit", tags=["audit"])

@audit_router.get("")
async def get_audit_log(resource: Optional[str]=None, user_id: Optional[str]=None,
                         limit: int=100, actor: Actor=Depends(get_actor)):
    # REAL BUG FIX (2026-08-12 sidebar/orphaned-endpoint audit): this read
    # from `audit_logs` (plural) — a table with ZERO real writers anywhere
    # in the backend except the dead POST /log endpoint removed below. The
    # real, tenant-wide audit trail every other router in this codebase
    # writes to (per HARD RULE #5/#6) is `audit_log` (singular, partitioned)
    # — confirmed live: 616 real rows in `audit_log` vs 0 in `audit_logs`.
    # The Audit Trail page has shown an empty table since it was built.
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT al.id, al.created_at, al.action,
                   al.entity_type AS resource, al.entity_id::text AS resource_id,
                   al.actor_user_id AS user_id, u.full_name AS user_name, u.email AS user_email
            FROM audit_log al
            LEFT JOIN users u ON u.id=al.actor_user_id
            WHERE al.tenant_id=$1
              AND ($2::text IS NULL OR al.entity_type=$2)
              AND ($3::text IS NULL OR al.actor_user_id::text=$3)
            ORDER BY al.created_at DESC LIMIT $4
        """, actor.tenant_id, resource, user_id, limit)
    return [dict(r) for r in rows]

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
              AND u.is_active IS NOT FALSE
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
                          exp_years: Optional[float]=None, actor: Actor=Depends(require_role_or_trusted_internal(*_MGMT_ROLES))):
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
                              location: str='Bengaluru', actor: Actor=Depends(require_role_or_trusted_internal(*_MGMT_ROLES))):
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
async def market_demand(actor: Actor=Depends(require_role_or_trusted_internal(*_MGMT_ROLES))):
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
import uuid as _uuid_public


def _require_valid_tenant_id(tenant_id: str) -> None:
    """These endpoints are fully public/anonymous — a malformed tenant_id
    used to hit the ::uuid cast inside RLS policies and surface as an
    unhandled 500 (asyncpg.exceptions.DataError) instead of a clean 400.
    Validated once here, at every public entry point, before any query."""
    try:
        _uuid_public.UUID(str(tenant_id))
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid tenant_id")


public_jobs_router = APIRouter(prefix="/public", tags=["public"])

@public_jobs_router.get("/tenant-info")
async def public_tenant_info(tenant_id: str):
    """Gap-audit fix (2026-09-02): the real tenant name, for the public
    careers pages to render instead of a hardcoded literal company name -
    confirmed via grep as 16 separate hardcoded occurrences across the
    2 public page components. A tiny, dedicated endpoint rather than
    folding this into /jobs, since the header/branding needs a real
    name even before any job list has loaded (or when there are zero
    open jobs at all)."""
    _require_valid_tenant_id(tenant_id)
    async with _db_public.tenant_conn(tenant_id) as conn:
        row = await conn.fetchrow("SELECT name FROM tenants WHERE id=$1::uuid", tenant_id)
    if not row:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return {"name": row["name"]}


@public_jobs_router.get("/jobs")
async def public_list_jobs(
    tenant_id: str,
    search: Optional[str] = None,
    location: Optional[str] = None,
    employment_type: Optional[str] = None,
    work_mode: Optional[str] = None,
    min_exp: Optional[int] = None,
    max_exp: Optional[int] = None,
    offset: int = 0,
    limit: int = 20,
):
    """No-auth public job board endpoint — uses db.tenant_conn for RLS.

    Gap-audit fixes (2026-09-02):
    - Real, server-driven pagination: the old hardcoded LIMIT 50 with no
      offset meant a tenant with 51+ real open requisitions silently lost
      every job past #50, with the frontend's own client-side pagination
      just re-slicing that already-truncated array. offset/limit are now
      real query params (limit capped at 50/page, matching the old ceiling
      as a sane per-page maximum, not a total-results ceiling), and the
      response carries a real total count via COUNT(*) OVER() so the
      frontend can build genuine page numbers instead of faking them.
    - Real employment_type / work_mode / experience-band filters, wired
      to the real employment_types[]/work_modes[]/experience_min/
      experience_max columns (built 2026-08-24) - these existed on every
      requisition already, just never exposed on the one page a
      candidate could actually filter by them. A "department" filter
      was in the original audit too, but genuinely no such column/
      taxonomy exists anywhere on requisitions - not fabricated here.
    - company_name via a real tenants join, replacing the hardcoded
      "AVIIN Jobs Services" this endpoint's own callers were building
      display strings around.
    """
    _require_valid_tenant_id(tenant_id)
    limit = max(1, min(limit, 50))
    offset = max(0, offset)
    async with _db_public.tenant_conn(tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT r.id, r.title, r.location, r.employment_type, r.description,
                   r.skills_required, r.positions_count, r.created_at,
                   r.budget_min, r.budget_max, r.employment_types, r.work_modes,
                   r.experience_min, r.experience_max, r.mandatory_skills,
                   t.name AS company_name,
                   COUNT(*) OVER() AS total_count
            FROM requisitions r
            JOIN tenants t ON t.id = r.tenant_id
            WHERE r.tenant_id=$1::uuid AND r.status='open' AND r.approval_status='approved'
              AND r.is_active IS NOT FALSE
              AND ($2::text IS NULL OR lower(r.title) LIKE '%'||lower($2)||'%')
              AND ($3::text IS NULL OR lower(r.location) LIKE '%'||lower($3)||'%')
              AND ($4::text IS NULL OR $4 = ANY(r.employment_types) OR r.employment_type = $4)
              AND ($5::text IS NULL OR $5 = ANY(r.work_modes) OR r.work_mode = $5)
              AND ($6::int IS NULL OR r.experience_max IS NULL OR r.experience_max >= $6)
              AND ($7::int IS NULL OR r.experience_min IS NULL OR r.experience_min <= $7)
            ORDER BY r.created_at DESC
            OFFSET $8 LIMIT $9
        """, tenant_id, search, location, employment_type, work_mode, min_exp, max_exp, offset, limit)
    total = rows[0]["total_count"] if rows else 0
    jobs = [dict(r) for r in rows]
    for j in jobs:
        j.pop("total_count", None)
    return {"jobs": jobs, "total": total, "offset": offset, "limit": limit}

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
    _require_valid_tenant_id(tenant_id)
    import xml.sax.saxutils as sx
    base = os.environ.get("NEXT_PUBLIC_APP_URL", "https://ats.aviintech.com")
    async with _db_public.tenant_conn(tenant_id) as conn:
        tenant_name = await conn.fetchval("SELECT name FROM tenants WHERE id=$1::uuid", tenant_id) or "AVIIN Jobs Services"
        rows = await conn.fetch("""
            SELECT r.id, r.title, r.location, r.employment_type, r.description,
                   r.skills_required, r.created_at, t.name AS company_name
            FROM requisitions r
            JOIN tenants t ON t.id = r.tenant_id
            WHERE r.tenant_id=$1::uuid AND r.status='open' AND r.approval_status='approved'
              AND r.is_active IS NOT FALSE
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
    <company><![CDATA[{r['company_name'] or tenant_name}]]></company>
    <city><![CDATA[{r['location'] or ''}]]></city>
    <country>IN</country>
    <description><![CDATA[{desc}\n\nSkills: {skills}]]></description>
    <jobtype><![CDATA[{r['employment_type'] or 'Full-time'}]]></jobtype>
  </job>""")

    # Gap-audit fix (2026-09-02): publisher name was hardcoded regardless
    # of which tenant's feed this is - real bug for a multi-tenant
    # deployment, same root cause as the frontend's own hardcoded
    # branding fixed in the same pass.
    xml_body = f"""<?xml version="1.0" encoding="UTF-8"?>
<source>
  <publisher>{esc(tenant_name)}</publisher>
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
    client-rendered apply UI on the same page.

    Gap-audit fixes (2026-09-02): company_name (real tenant join, see
    public_list_jobs above for the same fix), employment_types/
    work_modes/experience_min/max/mandatory_skills exposed (were already
    real, structured data - just never selected here), and a real
    "related jobs" list - up to 4 other genuinely open roles at this
    tenant that share at least one required skill with this one,
    excluding itself, ranked by how many skills they share. No AI/
    embedding call - a plain array-overlap COUNT, honest and free."""
    _require_valid_tenant_id(tenant_id)
    async with _db_public.tenant_conn(tenant_id) as conn:
        row = await conn.fetchrow("""
            SELECT r.id, r.title, r.location, r.employment_type, r.description,
                   r.skills_required, r.positions_count, r.created_at,
                   r.budget_min, r.budget_max, r.employment_types, r.work_modes,
                   r.experience_min, r.experience_max, r.mandatory_skills,
                   t.name AS company_name
            FROM requisitions r
            JOIN tenants t ON t.id = r.tenant_id
            WHERE r.id=$1::uuid AND r.tenant_id=$2::uuid AND r.status='open' AND r.approval_status='approved'
              AND r.is_active IS NOT FALSE
        """, job_id, tenant_id)
        if not row:
            raise HTTPException(status_code=404, detail="Job not found or closed")
        related_rows = await conn.fetch("""
            SELECT r.id, r.title, r.location, r.employment_type,
                   cardinality(ARRAY(SELECT unnest(r.skills_required) INTERSECT SELECT unnest($2::text[]))) AS overlap
            FROM requisitions r
            WHERE r.tenant_id=$3::uuid AND r.status='open' AND r.approval_status='approved'
              AND r.is_active IS NOT FALSE AND r.id <> $1::uuid
              AND r.skills_required && $2::text[]
            ORDER BY overlap DESC, r.created_at DESC
            LIMIT 4
        """, job_id, list(row["skills_required"] or []), tenant_id)
    out = dict(row)
    out["related_jobs"] = [
        {"id": str(r["id"]), "title": r["title"], "location": r["location"], "employment_type": r["employment_type"]}
        for r in related_rows
    ] if row["skills_required"] else []
    return out


@public_jobs_router.post("/jobs/apply")
async def public_apply(
    tenant_id: str = Form(...),
    job_id: str = Form(...),
    full_name: str = Form(''),
    email: str = Form(''),
    phone: Optional[str] = Form(None),
    location: Optional[str] = Form(None),
    current_employer: Optional[str] = Form(None),
    experience_months: int = Form(0),
    consent_given: bool = Form(False),
    ref: Optional[str] = Form(None),
    dsrc: Optional[str] = Form(None),
    resume: Optional[UploadFile] = File(None),
):
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

    Resume upload (2026-08-11 audit — this was the one real gap found in
    an otherwise-fully-manual form): switched from a plain JSON body to
    multipart/form-data so an optional resume file can ride along.
    Parsing reuses the exact same extract -> classify -> parse pipeline
    as WhatsApp/email intake (services.resume_intake_service /
    document_classifier / improved_parser) — never reimplemented. A bad
    or non-resume upload never blocks the application itself (the
    manually-typed fields are always the primary source of truth here);
    it's purely additive enrichment, same spirit as upsert_candidate's
    own COALESCE-only-fills-gaps convention on an existing candidate.
    """
    if not tenant_id or not job_id:
        raise HTTPException(status_code=400, detail="tenant_id and job_id required")
    _require_valid_tenant_id(tenant_id)
    if not consent_given:
        raise HTTPException(status_code=400, detail="Consent to store and process your details is required to apply")

    parsed: dict = {}
    resume_bytes: Optional[bytes] = None
    resume_filename: Optional[str] = None
    resume_mime: Optional[str] = None
    if resume is not None and resume.filename:
        resume_bytes = await resume.read()
        resume_filename = resume.filename
        resume_mime = resume.content_type or ''
        # Real gap found + fixed (2026-09-02 QA sweep): this is a public,
        # unauthenticated endpoint - nginx's own 50MB client_max_body_size
        # was the only prior ceiling, well above what a real resume needs
        # and inconsistent with the authenticated internal document-upload
        # endpoint's own established 10MB cap (candidates.py). Checked
        # BEFORE the parsing try/except below, not folded into its
        # "best-effort, silently degrade" handling, so an oversized file
        # gets a real, clear 400 instead of silently vanishing.
        if len(resume_bytes) > 10 * 1024 * 1024:
            raise HTTPException(400, "Resume file too large (max 10MB)")
        try:
            from services.resume_intake_service import extract_text_from_attachment, save_resume_file
            from services.document_classifier import classify_document
            from services.improved_parser import parse_resume_v2
            text = extract_text_from_attachment(resume_bytes, resume_mime, resume_filename)
            doc_result = classify_document(text, resume_filename, resume_mime)
            if doc_result.is_resume:
                parsed = parse_resume_v2(text, from_name=full_name, from_email=email, filename=resume_filename)
                parsed["_resume_text"] = text
        except Exception:
            # Best-effort enrichment only — a parsing failure must never
            # block a real applicant from submitting.
            parsed = {}

    async with _db_public.tenant_conn(tenant_id) as conn:
        # Same approval-chain gate as the public listing endpoints — a
        # not-yet-approved requisition's real job_id shouldn't be directly
        # applyable even if somehow known/guessed.
        job = await conn.fetchrow(
            "SELECT id FROM requisitions WHERE id=$1::uuid AND tenant_id=$2::uuid AND status='open' AND approval_status='approved' AND is_active IS NOT FALSE",
            job_id, tenant_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found or closed")
        email = email.lower()
        cand = await conn.fetchrow(
            "SELECT id FROM candidates WHERE email=$1 AND tenant_id=$2::uuid",
            email, tenant_id)
        is_new_candidate = cand is None
        if not cand:
            skills = parsed.get("skills") or []
            resume_text = parsed.get("_resume_text")
            cand = await conn.fetchrow("""
                INSERT INTO candidates
                  (tenant_id, full_name, email, phone, location, current_employer, total_exp_mo, source,
                   skills, resume_text)
                VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, 'job_board', $8, $9) RETURNING id
            """, tenant_id,
                 full_name, email,
                 phone, location,
                 current_employer,
                 experience_months, skills, resume_text)
            await conn.execute(
                "INSERT INTO consent_records (tenant_id,candidate_id,data_category,channel,consent_given,consent_text) "
                "VALUES ($1::uuid,$2,'resume_processing','public_job_board',TRUE,$3)",
                tenant_id, cand['id'],
                f"Applicant checked the DPDP 2023 consent box on the public job application form for job {job_id}.",
            )
            await source_attribution.record_source_attribution(conn, tenant_id, str(cand['id']), 'job_board')
            # 2026-09-02 gap-audit fix: public apply never auto-scored at
            # all before this — same fire-and-forget convention as every
            # other real intake path.
            import asyncio
            from routers.intelligence import auto_score_candidate_bg
            asyncio.create_task(auto_score_candidate_bg(tenant_id, str(cand['id'])))
        elif parsed.get("_resume_text"):
            # Existing candidate re-applying with a resume — same
            # gap-fill-only convention as upsert_candidate(), never
            # overwrites a value that's already on file.
            await conn.execute("""
                UPDATE candidates SET
                  resume_text = CASE WHEN (resume_text IS NULL OR resume_text='') THEN $2 ELSE resume_text END,
                  skills = CASE WHEN skills = '{}' AND $3::text[] <> '{}' THEN $3 ELSE skills END
                WHERE id=$1""",
                cand['id'], parsed.get("_resume_text"), parsed.get("skills") or [])

        if resume_bytes:
            file_path = save_resume_file(resume_bytes, tenant_id, resume_filename)
            await conn.execute("""
                INSERT INTO resume_files
                  (tenant_id, candidate_id, job_board, job_board_label, source_email,
                   file_name, file_path, mime_type, file_size,
                   parse_status, parsed_data, parse_confidence, routing_decision)
                VALUES ($1,$2,'public_apply','Public Career Page',$3,$4,$5,$6,$7,$8,$9,$10,$11)""",
                tenant_id, cand['id'], email, resume_filename, file_path, resume_mime, len(resume_bytes),
                'auto_accepted' if parsed else 'not_a_resume',
                _json.dumps(parsed) if parsed else '{}',
                round(float(parsed.get("_confidence", 0.7) or 0.7), 3) if parsed else 0.0,
                'auto_accepted' if parsed else 'rejected')

        # 2026-08-25 bug fix: this hardcoded 'sourced' unconditionally, the
        # exact same bug already fixed on 2 other creation paths
        # (applications.py, resume_intake_service.py) — for any tenant
        # where 'sourced' is hidden/not the configured default, a public
        # applicant silently landed in an invisible stage. Now resolved via
        # the same real shared helper both those fixes now also use.
        from routers.pipeline_stages import resolve_default_add_stage
        initial_stage = await resolve_default_add_stage(conn, tenant_id)
        await conn.execute("""
            INSERT INTO applications (tenant_id, candidate_id, requisition_id, stage)
            VALUES ($1::uuid, $2, $3::uuid, $4)
            ON CONFLICT DO NOTHING
        """, tenant_id, cand['id'], job_id, initial_stage)
        if ref:
            ref_row = await conn.fetchrow("""
                UPDATE referral_links SET candidate_ids = array_append(candidate_ids, $1::uuid)
                WHERE tenant_id=$2::uuid AND unique_code=$3 AND NOT ($1::uuid = ANY(candidate_ids))
                RETURNING referrer_user_id
            """, cand['id'], tenant_id, ref)
            # 2026-08-25 gap fix (recruiter-CRM research): a recruiter who
            # shares this job's link to source a candidate never got real
            # ownership credit for it — only click/candidate_ids tracking.
            # Wired into the existing 30-day FCFS ownership service, same
            # "claim only on genuine creation, never on an update" rule
            # every other intake path already follows.
            if ref_row and is_new_candidate:
                referrer_email = await conn.fetchval(
                    "SELECT email FROM users WHERE id=$1", ref_row['referrer_user_id'])
                if referrer_email:
                    from services.candidate_ownership import claim_ownership
                    await claim_ownership(
                        conn, tenant_id, cand['id'], str(ref_row['referrer_user_id']),
                        referrer_email, 'job_share_link')

        # Gap-audit fix (2026-09-02): credit the distribution channel
        # (job_shares.apply_count) that led to this application, when the
        # candidate arrived via a tracked auto-post click (the ?dsrc=
        # query param the /job-sharing/go/{...} redirect appends). Same
        # "most recent share row for this platform" resolution the click
        # counter itself uses - best-effort, never blocks the real
        # application if it can't find a matching row.
        if dsrc:
            try:
                await conn.execute("""
                    UPDATE job_shares SET apply_count = apply_count + 1
                    WHERE id = (
                        SELECT id FROM job_shares
                        WHERE tenant_id=$1::uuid AND requisition_id=$2::uuid AND platform=$3
                        ORDER BY posted_at DESC LIMIT 1
                    )
                """, tenant_id, job_id, dsrc)
            except Exception:
                pass

        # Gap-audit fix (2026-09-02): give every real applicant a genuine
        # self-service way to check their own status afterward, instead
        # of only ever being reachable if a recruiter later manually
        # generates and sends the link (the pre-existing, real, working
        # my-status page/candidate_status_tokens mechanism - reused
        # as-is, not rebuilt). Best-effort on both the token write and
        # the confirmation email - neither can ever block a real
        # application from succeeding.
        status_url = None
        try:
            import secrets as _secrets
            status_token = _secrets.token_urlsafe(32)
            await conn.execute("""
                INSERT INTO candidate_status_tokens (tenant_id, candidate_id, token)
                VALUES ($1::uuid, $2, $3) ON CONFLICT DO NOTHING
            """, tenant_id, cand['id'], status_token)
            base = os.environ.get("NEXT_PUBLIC_APP_URL", "https://ats.aviintech.com")
            status_url = f"{base}/my-status?token={status_token}"
        except Exception:
            status_url = None

        if status_url and email:
            try:
                from routers.phase3 import send_email as _send_status_email
                import asyncio as _asyncio2
                tenant_name = await conn.fetchval("SELECT name FROM tenants WHERE id=$1::uuid", tenant_id)
                _asyncio2.create_task(_send_status_email(
                    email,
                    f"Application received — {tenant_name or 'your application'}",
                    f"Thanks for applying! We've received your application.\n\n"
                    f"You can check your application status any time at:\n{status_url}\n\n"
                    f"This link stays valid for 30 days.",
                ))
            except Exception:
                pass

        # Low-severity finding (2026-08-11 audit): returning the real
        # internal candidate_id here, and always with the same shape
        # whether the email matched an existing candidate or created a
        # new one, let an anonymous caller confirm whether a given email
        # is already a candidate and learn their internal id. The
        # frontend never reads candidate_id from this response (confirmed
        # via grep) — dropped from the public payload entirely.
    return {"applied": True, "status_url": status_url}

