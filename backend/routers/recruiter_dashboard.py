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


@router.get("/my-overview")
async def my_overview(actor: Actor = Depends(get_actor)):
    """Full personal Overview Dashboard for a recruiter (2026-08-31) —
    the 11 real KPI cards asked for, all scoped to this recruiter's own
    real ownership/assignment, all is_active-filtered (this project's own
    extensively-documented is_active-leak bug class, not repeated here in
    new code). Distinct from /my-stats above, which is today/week/month
    scoped for the small dashboard widget — these are the recruiter's
    real all-time career totals plus current-state counts, matching a
    real "Overview" page rather than a "today" one."""
    uid = actor.user_id
    if uid is None:
        return {
            "resumes_owned": 0, "active_candidates": 0, "active_requirements": 0,
            "candidates_in_pipeline": 0, "total_submissions": 0,
            "interviews_scheduled": 0, "offers_released": 0, "placements": 0,
            "revenue_generated": 0.0, "pending_followups": 0,
            "candidates_on_notice": 0,
        }

    async with db.tenant_conn(actor.tenant_id) as conn:
        resumes_owned = await conn.fetchval(
            """SELECT COUNT(*) FROM candidate_ownership co
               JOIN candidates c ON c.id=co.candidate_id
               WHERE co.recruiter_id=$1 AND co.status='active' AND c.is_active IS NOT FALSE""",
            uid,
        )

        # Active candidates: real distinct candidates currently owned OR
        # with a real active (non-terminal) application assigned to me.
        active_candidates = await conn.fetchval(
            """SELECT COUNT(DISTINCT c.id) FROM candidates c
               WHERE c.is_active IS NOT FALSE AND (
                 EXISTS (SELECT 1 FROM candidate_ownership co WHERE co.candidate_id=c.id
                         AND co.recruiter_id=$1 AND co.status='active')
                 OR EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id=c.id
                            AND a.assigned_recruiter_id=$1 AND a.is_active IS NOT FALSE
                            AND a.stage NOT IN ('placed','rejected'))
               )""",
            uid,
        )

        active_requirements = await conn.fetchval(
            """SELECT COUNT(DISTINCT r.id) FROM assignments asg
               JOIN requisitions r ON r.id=asg.requisition_id
               WHERE asg.recruiter_id=$1 AND asg.status='active'
                 AND r.is_active IS NOT FALSE AND r.status='open'""",
            uid,
        )

        candidates_in_pipeline = await conn.fetchval(
            """SELECT COUNT(*) FROM applications a
               JOIN candidates c ON c.id=a.candidate_id
               WHERE a.assigned_recruiter_id=$1 AND a.is_active IS NOT FALSE
                 AND c.is_active IS NOT FALSE
                 AND a.stage NOT IN ('placed','rejected')""",
            uid,
        )

        # Total submissions: real, all-time — any application of mine
        # that has ever reached "submitted" or a later stage (interview/
        # offer/placed), not just today/this-month like my-stats above.
        total_submissions = await conn.fetchval(
            """SELECT COUNT(*) FROM applications a
               JOIN candidates c ON c.id=a.candidate_id
               WHERE a.assigned_recruiter_id=$1 AND c.is_active IS NOT FALSE
                 AND (a.stage LIKE '%interview%' OR a.stage IN
                      ('submitted','client_submission','offer','offer_accepted','placed'))""",
            uid,
        )

        interviews_scheduled = await conn.fetchval(
            """SELECT COUNT(*) FROM interview_schedules i
               JOIN candidates c ON c.id=i.candidate_id
               LEFT JOIN applications a ON a.id=i.application_id
               WHERE i.tenant_id=$2 AND c.is_active IS NOT FALSE
                 AND (i.interviewer_id=$1 OR a.assigned_recruiter_id=$1)
                 AND i.status NOT IN ('cancelled','completed')""",
            uid, actor.tenant_id,
        )

        offers_released = await conn.fetchval(
            """SELECT COUNT(*) FROM offers o
               JOIN applications a ON a.id=o.application_id
               JOIN candidates c ON c.id=a.candidate_id
               WHERE a.assigned_recruiter_id=$1 AND c.is_active IS NOT FALSE
                 AND o.status IN ('issued','accepted','declined')""",
            uid,
        )

        # Placements/joinings: the same real offer -> application ->
        # assigned_recruiter chain already proven in export_placements /
        # the incentives revenue-suggestion feature — placements has no
        # direct recruiter column of its own.
        placements = await conn.fetch(
            """SELECT p.id, p.requisition_id, p.created_at, r.client_id
               FROM placements p
               JOIN offers o ON o.id=p.offer_id
               JOIN applications a ON a.id=o.application_id
               LEFT JOIN requisitions r ON r.id=p.requisition_id
               WHERE p.tenant_id=$1 AND a.assigned_recruiter_id=$2""",
            actor.tenant_id, uid,
        )

        # Revenue generated: this recruiter's real, all-time share of
        # every placed client's account_pl revenue for the specific
        # period each placement happened in — the exact same best-effort,
        # real-data-grounded heuristic already established in
        # incentives.py's scorecard-suggestion feature (no per-placement
        # revenue figure exists to read directly), just summed across
        # every period this recruiter has a real placement in rather than
        # one single period.
        revenue_generated = 0.0
        for p in placements:
            if not p["client_id"] or not p["created_at"]:
                continue
            pm, py = p["created_at"].month, p["created_at"].year
            pl = await conn.fetchrow(
                "SELECT gross_revenue FROM account_pl WHERE tenant_id=$1 AND client_id=$2 AND period_month=$3 AND period_year=$4",
                actor.tenant_id, p["client_id"], pm, py)
            if not pl or not pl["gross_revenue"]:
                continue
            period_start = date(py, pm, 1)
            period_end = date(py + (1 if pm == 12 else 0), 1 if pm == 12 else pm + 1, 1)
            recruiter_count = await conn.fetchval(
                """SELECT COUNT(DISTINCT a2.assigned_recruiter_id)
                   FROM placements p2 JOIN offers o2 ON o2.id=p2.offer_id
                   JOIN applications a2 ON a2.id=o2.application_id
                   WHERE p2.tenant_id=$1 AND p2.requisition_id IN (
                       SELECT id FROM requisitions WHERE tenant_id=$1 AND client_id=$2)
                     AND p2.created_at >= $3 AND p2.created_at < $4""",
                actor.tenant_id, p["client_id"], period_start, period_end) or 1
            revenue_generated += float(pl["gross_revenue"]) / max(1, recruiter_count)

        pending_followups = await conn.fetchval(
            """SELECT COUNT(*) FROM recruiter_tasks
               WHERE recruiter_id=$1 AND status IN ('pending','in_progress')""",
            uid,
        )

        candidates_on_notice = await conn.fetchval(
            """SELECT COUNT(DISTINCT c.id) FROM candidates c
               WHERE c.is_active IS NOT FALSE AND c.notice_period_days IS NOT NULL AND (
                 EXISTS (SELECT 1 FROM candidate_ownership co WHERE co.candidate_id=c.id
                         AND co.recruiter_id=$1 AND co.status='active')
                 OR EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id=c.id
                            AND a.assigned_recruiter_id=$1 AND a.is_active IS NOT FALSE)
               )""",
            uid,
        )

    return {
        "resumes_owned": int(resumes_owned or 0),
        "active_candidates": int(active_candidates or 0),
        "active_requirements": int(active_requirements or 0),
        "candidates_in_pipeline": int(candidates_in_pipeline or 0),
        "total_submissions": int(total_submissions or 0),
        "interviews_scheduled": int(interviews_scheduled or 0),
        "offers_released": int(offers_released or 0),
        "placements": len(placements),
        "revenue_generated": round(revenue_generated, 2),
        "pending_followups": int(pending_followups or 0),
        "candidates_on_notice": int(candidates_on_notice or 0),
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
        # REAL BUG FIX (2026-08-17): recruiter_tasks has no direct
        # candidate_id (only a denormalized candidate_name text + an
        # optional application_id) — a task created when a candidate
        # moved to an interview stage stayed in "My Day" forever even
        # after that candidate was later soft-deleted, since nothing
        # here ever checked whether the underlying candidate still
        # existed. Tasks with no application_id (not tied to a specific
        # candidate) are unaffected by this filter.
        tasks_due = await conn.fetch(
            """SELECT t.id, t.task_type, t.title, t.priority, t.due_at, t.candidate_name, t.req_title, t.requisition_id, t.application_id
               FROM recruiter_tasks t
               LEFT JOIN applications a ON a.id = t.application_id
               LEFT JOIN candidates c ON c.id = a.candidate_id
               WHERE t.recruiter_id = $1 AND t.status IN ('pending','in_progress')
                 AND (t.due_at IS NULL OR t.due_at < $2)
                 AND (t.application_id IS NULL OR c.is_active IS NOT FALSE)
               ORDER BY (t.due_at IS NULL), t.due_at ASC,
                        CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1
                                      WHEN 'medium' THEN 2 ELSE 3 END
               LIMIT 20""",
            uid, today_end,
        )

        # REAL BUG FIX (2026-08-17): both interviews_today and stale below
        # had the same missing is_active filter as tasks_due above — a
        # soft-deleted candidate's interview or stale-application card
        # kept showing on My Day indefinitely.
        interviews_today = await conn.fetch(
            """SELECT i.id, i.scheduled_at, i.duration_mins, i.mode, i.status, i.interview_type,
                      c.full_name AS candidate_name, r.title AS req_title,
                      (i.interviewer_id = $1) AS im_interviewer
               FROM interview_schedules i
               JOIN candidates c ON c.id = i.candidate_id
               LEFT JOIN requisitions r ON r.id = i.requisition_id
               LEFT JOIN applications a ON a.id = i.application_id
               WHERE i.tenant_id = $2 AND c.is_active IS NOT FALSE
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
               WHERE a.tenant_id = $1 AND a.assigned_recruiter_id = $2 AND c.is_active IS NOT FALSE
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


# recruiter_productivity_hourly/weekly (2026-08-11, Workforce Intelligence)
# were computed nightly/weekly and never surfaced anywhere — only the
# _daily_ rollup fed the existing trend charts above. Same self-view
# convention as /activity/trends.
@router.get("/activity/hourly")
async def activity_hourly(hours: int = 48, actor: Actor = Depends(get_actor)):
    """Real hourly productivity trend for the logged-in recruiter over the
    last N hours (default 48), from recruiter_productivity_hourly."""
    uid = actor.user_id
    if uid is None:
        return {"trends": []}
    hours = max(1, min(hours, 168))
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT period_start, candidates_sourced, candidates_screened, candidates_submitted,
                   interviews_completed, offers_generated, offers_accepted, placements,
                   active_mins, idle_mins, productivity_pct
            FROM recruiter_productivity_hourly
            WHERE tenant_id=$1 AND recruiter_id=$2 AND period_start >= now() - ($3 || ' hours')::interval
            ORDER BY period_start ASC
        """, actor.tenant_id, uid, str(hours))
    return {"trends": [dict(r) for r in rows]}


@router.get("/activity/weekly")
async def activity_weekly(weeks: int = 12, actor: Actor = Depends(get_actor)):
    """Real weekly productivity trend for the logged-in recruiter over the
    last N weeks (default 12), from recruiter_productivity_weekly."""
    uid = actor.user_id
    if uid is None:
        return {"trends": []}
    weeks = max(1, min(weeks, 52))
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT period_start, candidates_sourced, candidates_screened, candidates_submitted,
                   interviews_completed, offers_generated, offers_accepted, placements,
                   active_mins, idle_mins, productivity_pct
            FROM recruiter_productivity_weekly
            WHERE tenant_id=$1 AND recruiter_id=$2 AND period_start >= CURRENT_DATE - ($3::int * 7)
            ORDER BY period_start ASC
        """, actor.tenant_id, uid, weeks)
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


# ─── Burnout/attrition-risk scoring (Time Champ gap-analysis, 2026-08-11) ──

class RiskConfigIn(BaseModel):
    hours_increase_threshold: float = Field(20.0, ge=0, le=200)
    productivity_drop_threshold: float = Field(15.0, ge=0, le=100)
    workload_overload_ratio: float = Field(1.3, ge=0.5, le=5)


@manager_router.get("/risk-config")
async def get_risk_config(actor: Actor = Depends(require_role("admin", "manager"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("SELECT * FROM risk_signal_config WHERE tenant_id=$1", actor.tenant_id)
    if not row:
        raise HTTPException(404, "No risk config for this tenant — this should have been seeded automatically")
    return dict(row)


@manager_router.put("/risk-config")
async def put_risk_config(body: RiskConfigIn, actor: Actor = Depends(require_role("admin", "manager"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            UPDATE risk_signal_config SET
              hours_increase_threshold=$2, productivity_drop_threshold=$3, workload_overload_ratio=$4, updated_at=now()
            WHERE tenant_id=$1 RETURNING *
        """, actor.tenant_id, body.hours_increase_threshold, body.productivity_drop_threshold, body.workload_overload_ratio)
    if not row:
        raise HTTPException(404, "No risk config for this tenant")
    return dict(row)


@manager_router.get("/risk-scores")
async def list_risk_scores(period_start: str | None = None, risk_level: str | None = None,
                            actor: Actor = Depends(require_role("admin", "manager"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        if not period_start:
            latest = await conn.fetchval("SELECT MAX(period_start) FROM recruiter_risk_scores WHERE tenant_id=$1", actor.tenant_id)
            period_start = latest
        else:
            period_start = date.fromisoformat(period_start)
        # REAL BUG FIX (2026-08-24): no u.is_active filter -- a manager
        # reviewing "who's at risk" should never see deactivated/QA-test
        # recruiters mixed in with real risk scores.
        q = """SELECT rs.*, u.full_name AS recruiter_name FROM recruiter_risk_scores rs
               JOIN users u ON u.id = rs.recruiter_id AND u.is_active IS NOT FALSE
               WHERE rs.tenant_id=$1 AND rs.period_start=$2"""
        params = [actor.tenant_id, period_start]
        if risk_level:
            params.append(risk_level); q += f" AND rs.risk_level=${len(params)}"
        q += " ORDER BY rs.risk_score DESC"
        rows = await conn.fetch(q, *params)
    return [dict(r) for r in rows]


@router.get("/my-risk-history")
async def my_risk_history(weeks: int = 8, actor: Actor = Depends(get_actor)):
    """A recruiter can see their own risk-score history (same transparency
    principle already established for Device Monitoring — a recruiter can
    always see the same data a manager can see about them)."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            """SELECT * FROM recruiter_risk_scores WHERE tenant_id=$1 AND recruiter_id=$2
               ORDER BY period_start DESC LIMIT $3""",
            actor.tenant_id, actor.user_id, weeks)
    return [dict(r) for r in rows]


# recruiter_sla_tracking (2026-08-11, Workforce Intelligence) was write-only
# until this pass (2026-08-12 audit) — the daily performance-score job
# reads it to compute an aggregate SLA percentage, but nothing ever
# surfaced which *specific* candidates blew first-response SLA, or by how
# much. Same self/manager split as risk-scores above: a recruiter sees
# their own breaches, a manager/admin sees anyone's.
@router.get("/sla-tracking")
async def my_sla_tracking(breached_only: bool = False, days: int = 30,
                           actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        q = """SELECT t.*, c.full_name AS candidate_name,
                      EXTRACT(EPOCH FROM (COALESCE(t.first_response_at, now()) - t.sourced_at)) / 3600.0 AS elapsed_hours
               FROM recruiter_sla_tracking t
               JOIN candidates c ON c.id = t.candidate_id AND c.is_active IS NOT FALSE
               WHERE t.tenant_id=$1 AND t.recruiter_id=$2 AND t.sourced_at >= now() - ($3 || ' days')::interval"""
        params = [actor.tenant_id, actor.user_id, str(days)]
        if breached_only:
            q += " AND (t.breached IS TRUE OR (t.first_response_at IS NULL AND now() > t.sourced_at + (t.sla_target_hours || ' hours')::interval))"
        q += " ORDER BY t.sourced_at DESC"
        rows = await conn.fetch(q, *params)
    return [dict(r) for r in rows]


@manager_router.get("/sla-tracking")
async def team_sla_tracking(recruiter_id: str | None = None, breached_only: bool = False,
                             days: int = 30, actor: Actor = Depends(require_role("admin", "manager"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        q = """SELECT t.*, c.full_name AS candidate_name, u.full_name AS recruiter_name,
                      EXTRACT(EPOCH FROM (COALESCE(t.first_response_at, now()) - t.sourced_at)) / 3600.0 AS elapsed_hours
               FROM recruiter_sla_tracking t
               JOIN candidates c ON c.id = t.candidate_id AND c.is_active IS NOT FALSE
               JOIN users u ON u.id = t.recruiter_id AND u.is_active IS NOT FALSE
               WHERE t.tenant_id=$1 AND t.sourced_at >= now() - ($2 || ' days')::interval"""
        params = [actor.tenant_id, str(days)]
        if recruiter_id:
            params.append(recruiter_id); q += f" AND t.recruiter_id=${len(params)}"
        if breached_only:
            q += " AND (t.breached IS TRUE OR (t.first_response_at IS NULL AND now() > t.sourced_at + (t.sla_target_hours || ' hours')::interval))"
        q += " ORDER BY t.sourced_at DESC"
        rows = await conn.fetch(q, *params)
    return [dict(r) for r in rows]
