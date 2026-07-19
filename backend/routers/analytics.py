"""Read-only analytics views (sql/04_phase3_ai_engine.sql).

All four views are WITH (security_invoker = true), so RLS applies to
the calling role (app_user) exactly as for ordinary table queries.
"""

from fastapi import APIRouter, Depends

import db
from deps import Actor, get_actor

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/redeployment-queue")
async def redeployment_queue(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("SELECT * FROM v_redeployment_queue ORDER BY end_date")
    return [dict(r) for r in rows]


@router.get("/agency-funnel")
async def agency_funnel(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("SELECT * FROM v_agency_funnel ORDER BY client_name")
    return [dict(r) for r in rows]


@router.get("/recruiter-capacity")
async def recruiter_capacity(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("SELECT * FROM v_recruiter_capacity ORDER BY full_name")
    return [dict(r) for r in rows]


@router.get("/skill-gap")
async def skill_gap(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("SELECT * FROM v_skill_gap")
    return [dict(r) for r in rows]


@router.get("/active-placements")
async def active_placements(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT p.id, c.full_name AS candidate_name, cl.name AS client_name,
                   r.title AS req_title, p.start_date, p.end_date,
                   p.bill_rate, p.pay_rate, p.status
            FROM placements p
            JOIN candidates c ON c.id = p.candidate_id
            JOIN clients cl ON cl.id = p.client_id
            JOIN requisitions r ON r.id = p.requisition_id
            ORDER BY p.status, p.end_date NULLS LAST
        """)
    return [dict(r) for r in rows]


# ─── Hiring Funnel ────────────────────────────────────────────────────────────
@router.get("/hiring-funnel")
async def hiring_funnel(actor: Actor = Depends(get_actor)):
    """Count of applications per stage + stage-to-stage conversion rates."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT stage, COUNT(*) AS cnt
            FROM applications
            GROUP BY stage
            ORDER BY
                ARRAY_POSITION(ARRAY[
                    'sourced','contacted','interested','nda','screened',
                    'submitted','l1_interview','l2_interview','offer',
                    'offer_accepted','placed','rejected','hold'
                ], stage)
        """)
    stages = [dict(r) for r in rows]
    # Add conversion %: each stage vs previous non-terminal stage
    FUNNEL = ['sourced','contacted','interested','nda','screened',
              'submitted','l1_interview','l2_interview','offer',
              'offer_accepted','placed']
    by_stage = {r['stage']: r['cnt'] for r in stages}
    funnel = []
    for s in FUNNEL:
        cnt = by_stage.get(s, 0)
        funnel.append({'stage': s, 'count': cnt})
    # Conversion: each stage count / first stage count
    top = funnel[0]['count'] if funnel and funnel[0]['count'] else 1
    for item in funnel:
        item['conversion_pct'] = round(item['count'] / top * 100, 1)
    return {
        'funnel': funnel,
        'rejected': by_stage.get('rejected', 0),
        'hold': by_stage.get('hold', 0),
        'total_active': sum(by_stage.get(s, 0) for s in FUNNEL),
    }


# ─── Source Breakdown ─────────────────────────────────────────────────────────
@router.get("/source-breakdown")
async def source_breakdown(actor: Actor = Depends(get_actor)):
    """Candidates grouped by source with placement rate."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT
                COALESCE(c.source, 'unknown') AS source,
                COUNT(DISTINCT c.id)                 AS total_candidates,
                COUNT(DISTINCT a.id)                 AS total_applications,
                COUNT(DISTINCT a.id) FILTER (WHERE a.stage IN ('placed','offer_accepted')) AS placed,
                COUNT(DISTINCT a.id) FILTER (WHERE a.stage = 'rejected') AS rejected
            FROM candidates c
            LEFT JOIN applications a ON a.candidate_id = c.id
            GROUP BY COALESCE(c.source, 'unknown')
            ORDER BY total_candidates DESC
        """)
    result = []
    for r in rows:
        row = dict(r)
        apps = row['total_applications'] or 1
        row['placement_rate'] = round(row['placed'] / apps * 100, 1)
        result.append(row)
    return result


# ─── Time-to-Hire ─────────────────────────────────────────────────────────────
@router.get("/time-to-hire")
async def time_to_hire(days: int = 90, actor: Actor = Depends(get_actor)):
    """Avg days from application created to placed/offer_accepted, last N days."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        overall = await conn.fetchrow("""
            SELECT
                ROUND(AVG(EXTRACT(EPOCH FROM (updated_at - created_at))/86400)::numeric, 1)
                    AS avg_days_to_hire,
                COUNT(*) AS total_placed
            FROM applications
            WHERE stage IN ('placed','offer_accepted')
              AND updated_at >= now() - ($1 || ' days')::interval
        """, str(days))

        by_req = await conn.fetch("""
            SELECT r.title,
                   COUNT(a.id) AS placed_count,
                   ROUND(AVG(EXTRACT(EPOCH FROM (a.updated_at - a.created_at))/86400)::numeric,1)
                       AS avg_days
            FROM applications a
            JOIN requisitions r ON r.id = a.requisition_id
            WHERE a.stage IN ('placed','offer_accepted')
              AND a.updated_at >= now() - ($1 || ' days')::interval
            GROUP BY r.id, r.title
            ORDER BY placed_count DESC
            LIMIT 10
        """, str(days))

        monthly = await conn.fetch("""
            SELECT
                TO_CHAR(updated_at, 'YYYY-MM') AS month,
                COUNT(*) AS placements,
                ROUND(AVG(EXTRACT(EPOCH FROM (updated_at - created_at))/86400)::numeric,1) AS avg_days
            FROM applications
            WHERE stage IN ('placed','offer_accepted')
              AND updated_at >= now() - '12 months'::interval
            GROUP BY TO_CHAR(updated_at, 'YYYY-MM')
            ORDER BY month
        """)

    return {
        'period_days': days,
        'avg_days_to_hire': overall['avg_days_to_hire'],
        'total_placed': overall['total_placed'],
        'by_requisition': [dict(r) for r in by_req],
        'monthly_trend': [dict(r) for r in monthly],
    }


# ─── Stage Velocity (avg days per stage before moving on) ────────────────────
@router.get("/stage-velocity")
async def stage_velocity(actor: Actor = Depends(get_actor)):
    """Current pending count per stage + open reqs summary."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        stage_counts = await conn.fetch("""
            SELECT stage, COUNT(*) AS count
            FROM applications
            WHERE stage NOT IN ('placed','rejected','offer_accepted')
            GROUP BY stage
        """)
        open_reqs = await conn.fetchval(
            "SELECT COUNT(*) FROM requisitions WHERE status='open'")
        interviews_today = await conn.fetchval("""
            SELECT COUNT(*) FROM interview_schedules
            WHERE status='scheduled'
              AND scheduled_at::date = CURRENT_DATE
        """)
        offers_pending = await conn.fetchval(
            "SELECT COUNT(*) FROM offers WHERE status IN ('draft','pending_approval','approved','issued')")

    return {
        'stage_counts': [dict(r) for r in stage_counts],
        'open_requisitions': open_reqs,
        'interviews_today': interviews_today,
        'offers_pending': offers_pending,
    }
