"""Read-only analytics views (sql/04_phase3_ai_engine.sql).

All four views are WITH (security_invoker = true), so RLS applies to
the calling role (app_user) exactly as for ordinary table queries.
"""

from fastapi import APIRouter, Depends

import db
from deps import Actor, get_actor, require_role_or_trusted_internal
from permissions import require_permission

router = APIRouter(prefix="/analytics", tags=["analytics"])

# 2026-08-28: these 5 endpoints back the sidebar's ANALYTICS/FINANCE groups
# and the Dashboard's team-wide widgets - tenant-wide business intelligence
# (which contractors end soon, agency-wide funnel numbers, every recruiter's
# individual workload, company skill-gap, every active placement's bill/pay
# rate) that had no role gate at all despite the sidebar having an
# established roles:[...] convention already used elsewhere. Confirmed via
# a real report that a plain recruiter/KAE could see this - both through
# the Dashboard's "Recruiter Capacity" widget (individually-identifying
# workload data for every OTHER staff member, not just their own) and, more
# seriously, by simply navigating to /command-center or /finance directly
# (sidebar links with no roles: restriction, backed by these exact
# endpoints with no role check either - an IDOR-class gap, not just a UI
# oversight). Gated to the same management tier used consistently elsewhere
# in this codebase (require_role_or_trusted_internal("admin","manager") etc.) - recruiter_capacity
# is self-scoped rather than blocked outright, since a recruiter's own
# capacity is legitimately theirs to see (surfaced as "My Capacity" on the
# Dashboard for non-management roles).
_MGMT_ROLES = ("admin", "super_admin", "manager", "lead_recruiter")


@router.get("/redeployment-queue")
async def redeployment_queue(actor: Actor = Depends(require_role_or_trusted_internal(*_MGMT_ROLES))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("SELECT * FROM v_redeployment_queue ORDER BY end_date")
    return [dict(r) for r in rows]


@router.get("/agency-funnel")
async def agency_funnel(actor: Actor = Depends(require_role_or_trusted_internal(*_MGMT_ROLES))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("SELECT * FROM v_agency_funnel ORDER BY client_name")
    return [dict(r) for r in rows]


@router.get("/recruiter-capacity")
async def recruiter_capacity(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        if actor.role in _MGMT_ROLES or actor.role is None:
            rows = await conn.fetch("SELECT * FROM v_recruiter_capacity ORDER BY full_name")
        else:
            rows = await conn.fetch(
                "SELECT * FROM v_recruiter_capacity WHERE recruiter_id = $1", actor.user_id)
    return [dict(r) for r in rows]


@router.get("/skill-gap")
async def skill_gap(actor: Actor = Depends(require_role_or_trusted_internal(*_MGMT_ROLES))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("SELECT * FROM v_skill_gap")
    return [dict(r) for r in rows]


@router.get("/active-placements")
async def active_placements(actor: Actor = Depends(require_role_or_trusted_internal(*_MGMT_ROLES))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT p.id, p.candidate_id, p.client_id,
                   c.full_name AS candidate_name, cl.name AS client_name,
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
async def hiring_funnel(actor: Actor = Depends(require_permission("analytics", "read"))):
    """Count of applications per stage + stage-to-stage conversion rates."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT a.stage, COUNT(*) AS cnt FROM applications a
            JOIN candidates c ON c.id = a.candidate_id
            WHERE c.is_active IS NOT FALSE
            GROUP BY a.stage
        """)
        # Stages are tenant-configurable and can include custom rounds
        # (this tenant has a real l3_interview) — the previous hardcoded
        # FUNNEL list silently dropped any custom stage from the funnel
        # and total_active count (2026-08-09 Analytics audit). Built from
        # this tenant's real, ordered config instead; falls back to the
        # original 11 defaults only if config hasn't been lazy-seeded yet.
        configured = await conn.fetch(
            "SELECT stage_key FROM pipeline_stage_config WHERE tenant_id=$1 "
            "AND stage_key NOT IN ('rejected','hold') ORDER BY display_order",
            actor.tenant_id)
    FUNNEL = [r['stage_key'] for r in configured] if configured else [
        'sourced','contacted','interested','nda','screened',
        'submitted','l1_interview','l2_interview','offer','offer_accepted','placed',
    ]
    by_stage = {r['stage']: r['cnt'] for r in rows}
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
            WHERE c.is_active IS NOT FALSE
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
                ROUND(AVG(EXTRACT(EPOCH FROM (a.updated_at - a.created_at))/86400)::numeric, 1)
                    AS avg_days_to_hire,
                COUNT(*) AS total_placed
            FROM applications a
            JOIN candidates c ON c.id = a.candidate_id
            WHERE a.stage IN ('placed','offer_accepted')
              AND c.is_active IS NOT FALSE
              AND a.updated_at >= now() - ($1 || ' days')::interval
        """, str(days))

        by_req = await conn.fetch("""
            SELECT r.title,
                   COUNT(a.id) AS placed_count,
                   ROUND(AVG(EXTRACT(EPOCH FROM (a.updated_at - a.created_at))/86400)::numeric,1)
                       AS avg_days
            FROM applications a
            JOIN requisitions r ON r.id = a.requisition_id
            JOIN candidates c ON c.id = a.candidate_id
            WHERE a.stage IN ('placed','offer_accepted')
              AND c.is_active IS NOT FALSE
              AND a.updated_at >= now() - ($1 || ' days')::interval
            GROUP BY r.id, r.title
            ORDER BY placed_count DESC
            LIMIT 10
        """, str(days))

        monthly = await conn.fetch("""
            SELECT
                TO_CHAR(a.updated_at, 'YYYY-MM') AS month,
                COUNT(*) AS placements,
                ROUND(AVG(EXTRACT(EPOCH FROM (a.updated_at - a.created_at))/86400)::numeric,1) AS avg_days
            FROM applications a
            JOIN candidates c ON c.id = a.candidate_id
            WHERE a.stage IN ('placed','offer_accepted')
              AND c.is_active IS NOT FALSE
              AND a.updated_at >= now() - '12 months'::interval
            GROUP BY TO_CHAR(a.updated_at, 'YYYY-MM')
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
            SELECT a.stage, COUNT(*) AS count
            FROM applications a
            JOIN candidates c ON c.id = a.candidate_id
            WHERE a.stage NOT IN ('placed','rejected','offer_accepted')
              AND c.is_active IS NOT FALSE
            GROUP BY a.stage
        """)
        open_reqs = await conn.fetchval(
            "SELECT COUNT(*) FROM requisitions WHERE status='open' AND is_active IS NOT FALSE")
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
