"""Recruiter Personal Dashboard — personal stats for the logged-in recruiter."""

from datetime import date, datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
import db
from deps import Actor, get_actor, require_role

router = APIRouter(prefix="/recruiter", tags=["recruiter"])
# Manager-facing Workforce Intelligence surfaces (leaderboard, weight
# config) live in a second router in this same file — same multi-router-
# per-file convention already used in phase3.py — since they're a
# genuinely different audience from the personal /recruiter/* endpoints
# above, registered separately in app.py.
manager_router = APIRouter(prefix="/manager", tags=["manager"])


def _start_of_day_utc() -> datetime:
    now = datetime.now(timezone.utc)
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def _start_of_month_utc() -> datetime:
    now = datetime.now(timezone.utc)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _start_of_week_utc() -> datetime:
    now = datetime.now(timezone.utc)
    # Monday as start of week
    monday = now - timedelta(days=now.weekday())
    return monday.replace(hour=0, minute=0, second=0, microsecond=0)


@router.get("/my-stats")
async def my_stats(actor: Actor = Depends(get_actor)):
    """Personal stats for the logged-in recruiter.

    Requires JWT auth (actor.user_id must be set).
    Anonymous/x-tenant-id callers get zeroed stats.
    """
    uid = actor.user_id  # may be None for anonymous callers
    today_start = _start_of_day_utc()
    month_start = _start_of_month_utc()
    week_start = _start_of_week_utc()

    async with db.tenant_conn(actor.tenant_id) as conn:
        if uid is None:
            # Anonymous caller — return zeroed stats
            return {
                "my_submissions_today": 0,
                "my_submissions_month": 0,
                "my_interviews_this_week": 0,
                "my_offers_active": 0,
                "my_placements_month": 0,
                "my_pipeline": {},
                "my_candidates_added_today": 0,
            }

        # 1. Submissions today (any stage change / application update by this recruiter today)
        sub_today = await conn.fetchval(
            """SELECT COUNT(*) FROM applications
               WHERE assigned_recruiter_id = $1::uuid
                 AND updated_at >= $2""",
            uid, today_start,
        )

        # 2. Submissions this month
        sub_month = await conn.fetchval(
            """SELECT COUNT(*) FROM applications
               WHERE assigned_recruiter_id = $1::uuid
                 AND updated_at >= $2""",
            uid, month_start,
        )

        # 3. Interviews this week — LIKE match, not a fixed IN() list, so a
        # tenant's custom interview rounds (e.g. l3_interview) are counted
        # too. A hardcoded ('l1_interview','l2_interview') here silently
        # undercounted for any tenant with a custom round, the same bug
        # class already found and fixed in recruiter-performance/hiring-
        # funnel/pipeline endpoints elsewhere in this codebase.
        interviews_week = await conn.fetchval(
            """SELECT COUNT(*) FROM applications
               WHERE assigned_recruiter_id = $1::uuid
                 AND stage LIKE '%interview%'
                 AND updated_at >= $2""",
            uid, week_start,
        )

        # 4. Active offers
        offers_active = await conn.fetchval(
            """SELECT COUNT(*) FROM applications
               WHERE assigned_recruiter_id = $1::uuid
                 AND stage IN ('offer', 'offer_accepted')""",
            uid,
        )

        # 5. Placements this month
        placements_month = await conn.fetchval(
            """SELECT COUNT(*) FROM applications
               WHERE assigned_recruiter_id = $1::uuid
                 AND stage = 'placed'
                 AND updated_at >= $2""",
            uid, month_start,
        )

        # 6. My pipeline — stage → count for this recruiter's applications
        pipeline_rows = await conn.fetch(
            """SELECT stage, COUNT(*) AS cnt FROM applications
               WHERE assigned_recruiter_id = $1::uuid
               GROUP BY stage""",
            uid,
        )
        my_pipeline = {r["stage"]: int(r["cnt"]) for r in pipeline_rows}

        # 7. Candidates added today
        # candidates table has no created_by; proxy via applications created today
        # where this recruiter is assigned (closest available signal)
        cands_today = await conn.fetchval(
            """SELECT COUNT(*) FROM applications
               WHERE assigned_recruiter_id = $1::uuid
                 AND created_at >= $2""",
            uid, today_start,
        )

    return {
        "my_submissions_today": int(sub_today or 0),
        "my_submissions_month": int(sub_month or 0),
        "my_interviews_this_week": int(interviews_week or 0),
        "my_offers_active": int(offers_active or 0),
        "my_placements_month": int(placements_month or 0),
        "my_pipeline": my_pipeline,
        "my_candidates_added_today": int(cands_today or 0),
    }


@router.get("/my-day")
async def my_day(actor: Actor = Depends(get_actor)):
    """Unified daily action queue for the logged-in recruiter. The data all
    already existed (recruiter_tasks, interview_schedules, applications) but
    was scattered across four separate pages - this assembles the three
    things a recruiter actually needs at a glance into one response, same
    as a typical ATS "today" home screen (Bullhorn/CEIPAL/JobDiva)."""
    uid = actor.user_id
    if uid is None:
        return {"tasks_due": [], "interviews_today": [], "candidates_needing_action": []}

    today_start = _start_of_day_utc()
    today_end = today_start + timedelta(days=1)

    async with db.tenant_conn(actor.tenant_id) as conn:
        tasks_due = await conn.fetch(
            """SELECT id, task_type, title, priority, due_at, candidate_name, req_title, requisition_id, application_id
               FROM recruiter_tasks
               WHERE recruiter_id = $1 AND status IN ('pending','in_progress')
                 AND (due_at IS NULL OR due_at < $2)
               ORDER BY (due_at IS NULL), due_at ASC,
                        CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1
                                      WHEN 'medium' THEN 2 ELSE 3 END
               LIMIT 20""",
            uid, today_end,
        )

        interviews_today = await conn.fetch(
            """SELECT i.id, i.scheduled_at, i.duration_mins, i.mode, i.status, i.interview_type,
                      c.full_name AS candidate_name, r.title AS req_title,
                      (i.interviewer_id = $1) AS im_interviewer
               FROM interview_schedules i
               JOIN candidates c ON c.id = i.candidate_id
               LEFT JOIN requisitions r ON r.id = i.requisition_id
               LEFT JOIN applications a ON a.id = i.application_id
               WHERE i.tenant_id = $2
                 AND (i.interviewer_id = $1 OR a.assigned_recruiter_id = $1)
                 AND i.scheduled_at >= $3 AND i.scheduled_at < $4
                 AND i.status NOT IN ('cancelled', 'completed')
               ORDER BY i.scheduled_at ASC""",
            uid, actor.tenant_id, today_start, today_end,
        )

        # "Needs action" = assigned to me, not in a terminal stage, and
        # nobody has touched it in 3+ days - the ones quietly going stale.
        stale = await conn.fetch(
            """SELECT a.id AS application_id, a.stage, a.updated_at, c.full_name AS candidate_name,
                      r.title AS req_title, EXTRACT(day FROM now() - a.updated_at)::int AS days_stale
               FROM applications a
               JOIN candidates c ON c.id = a.candidate_id
               LEFT JOIN requisitions r ON r.id = a.requisition_id
               WHERE a.tenant_id = $1 AND a.assigned_recruiter_id = $2
                 AND a.stage NOT IN ('placed', 'rejected', 'hold')
                 AND a.updated_at < now() - interval '3 days'
               ORDER BY a.updated_at ASC
               LIMIT 15""",
            actor.tenant_id, uid,
        )

    return {
        "tasks_due": [dict(r) for r in tasks_due],
        "interviews_today": [dict(r) for r in interviews_today],
        "candidates_needing_action": [dict(r) for r in stale],
    }


# ── Workforce Intelligence (2026-08-11) ─────────────────────────────────

@router.get("/activity/today")
async def activity_today(actor: Actor = Depends(get_actor)):
    """Today's real recruiter_productivity_daily row + current performance
    score/grade for the logged-in recruiter, plus a live (not-yet-
    aggregated) fallback count from recruiter_activity_events for today
    specifically — the daily rollup job runs at 02:30 IST for the
    *previous* day, so "today" has no aggregate row yet until tomorrow."""
    uid = actor.user_id
    if uid is None:
        return {"today": None, "score": None}
    async with db.tenant_conn(actor.tenant_id) as conn:
        live = await conn.fetchrow("""
            SELECT
              COUNT(*) FILTER (WHERE event_type='sourced') candidates_sourced,
              COUNT(*) FILTER (WHERE event_type='screened') candidates_screened,
              COUNT(*) FILTER (WHERE event_type='submitted') candidates_submitted,
              COUNT(*) FILTER (WHERE event_type LIKE '%_completed') interviews_completed,
              COUNT(*) FILTER (WHERE event_type='offer_generated') offers_generated,
              COUNT(*) FILTER (WHERE event_type='offer_accepted') offers_accepted,
              COUNT(*) FILTER (WHERE event_type='placed') placements
            FROM recruiter_activity_events
            WHERE tenant_id=$1 AND recruiter_id=$2 AND event_at::date = CURRENT_DATE
        """, actor.tenant_id, uid)
        score = await conn.fetchrow(
            "SELECT * FROM recruiter_performance_scores WHERE tenant_id=$1 AND recruiter_id=$2 ORDER BY score_date DESC LIMIT 1",
            actor.tenant_id, uid)
    return {"today": dict(live) if live else None, "score": dict(score) if score else None}


@router.get("/activity/trends")
async def activity_trends(days: int = 30, actor: Actor = Depends(get_actor)):
    """Real daily productivity trend for the logged-in recruiter over the
    last N days (default 30), from recruiter_productivity_daily."""
    uid = actor.user_id
    if uid is None:
        return {"trends": []}
    days = max(1, min(days, 90))
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT period_start, candidates_sourced, candidates_screened, candidates_submitted,
                   interviews_completed, offers_generated, offers_accepted, placements,
                   active_mins, idle_mins, productivity_pct
            FROM recruiter_productivity_daily
            WHERE tenant_id=$1 AND recruiter_id=$2 AND period_start >= CURRENT_DATE - $3::int
            ORDER BY period_start ASC
        """, actor.tenant_id, uid, days)
    return {"trends": [dict(r) for r in rows]}


@manager_router.get("/activity-leaderboard")
async def activity_leaderboard(actor: Actor = Depends(require_role("admin", "manager"))):
    """Team activity leaderboard — reads v_recruiter_activity_summary,
    same "SELECT * FROM v_*_summary ORDER BY metric DESC" template as
    kae.py's v_kae_summary-backed leaderboard."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            "SELECT * FROM v_recruiter_activity_summary WHERE tenant_id=$1 ORDER BY overall_score DESC NULLS LAST",
            actor.tenant_id)
    return [dict(r) for r in rows]


class ScoreWeightConfigIn(BaseModel):
    output_weight: float = Field(0.30, ge=0, le=1)
    quality_weight: float = Field(0.20, ge=0, le=1)
    velocity_weight: float = Field(0.15, ge=0, le=1)
    productivity_weight: float = Field(0.15, ge=0, le=1)
    sla_weight: float = Field(0.10, ge=0, le=1)
    interview_conv_weight: float = Field(0.10, ge=0, le=1)
    grade_a_plus_threshold: float = 95
    grade_a_threshold: float = 85
    grade_b_threshold: float = 75
    grade_c_threshold: float = 65


@manager_router.get("/score-weights")
async def get_score_weights(actor: Actor = Depends(require_role("admin", "manager"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("SELECT * FROM score_weight_config WHERE tenant_id=$1", actor.tenant_id)
    if not row:
        raise HTTPException(404, "No weight config for this tenant — this should have been seeded automatically")
    return dict(row)


@manager_router.put("/score-weights")
async def put_score_weights(body: ScoreWeightConfigIn, actor: Actor = Depends(require_role("admin", "manager"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            UPDATE score_weight_config SET
              output_weight=$2, quality_weight=$3, velocity_weight=$4, productivity_weight=$5,
              sla_weight=$6, interview_conv_weight=$7,
              grade_a_plus_threshold=$8, grade_a_threshold=$9, grade_b_threshold=$10, grade_c_threshold=$11,
              updated_at=now()
            WHERE tenant_id=$1 RETURNING *
        """, actor.tenant_id, body.output_weight, body.quality_weight, body.velocity_weight,
             body.productivity_weight, body.sla_weight, body.interview_conv_weight,
             body.grade_a_plus_threshold, body.grade_a_threshold, body.grade_b_threshold, body.grade_c_threshold)
    if not row:
        raise HTTPException(404, "No weight config for this tenant")
    return dict(row)
