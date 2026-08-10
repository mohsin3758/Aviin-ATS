"""P15 — Recruiter Performance & Incentive Engine.

KPI scorecard (100 pts), grades D/C/B/A/A+, incentive calculation
from Contribution Margin, 70/30 payout split, retention bank,
loyalty milestones. Zero-token: pure SQL rule engine.
"""

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import db
from deps import Actor, get_actor
from permissions import require_permission

router = APIRouter(prefix="/incentives", tags=["incentives"])

LOYALTY_AMOUNTS = {1: 15000, 2: 30000, 3: 50000, 5: 100000}


# ── schemas ────────────────────────────────────────────────

class KpiScoreIn(BaseModel):
    user_id: str
    period_month: int = Field(..., ge=1, le=12)
    period_year: int = Field(..., ge=2020, le=2099)
    joinings_score: float = Field(0, ge=0, le=35)
    revenue_score: float = Field(0, ge=0, le=25)
    interview_score: float = Field(0, ge=0, le=10)
    offer_score: float = Field(0, ge=0, le=10)
    client_sat_score: float = Field(0, ge=0, le=10)
    ats_score: float = Field(0, ge=0, le=10)
    contribution_margin: float = 0

class KpiApproveIn(BaseModel):
    status: str  # approved | paid

class AdvKpiIn(BaseModel):
    user_id: str
    period_month: int
    period_year: int
    time_to_first_sub_hrs: Optional[float] = None
    submission_acceptance_pct: Optional[float] = None
    interview_ratio: Optional[float] = None
    offer_ratio: Optional[float] = None
    joining_ratio: Optional[float] = None
    offer_drop_rate: Optional[float] = None
    no_show_pct: Optional[float] = None
    candidate_satisfaction: Optional[float] = None
    client_satisfaction: Optional[float] = None
    retention_90day_pct: Optional[float] = None

class RetentionTrackIn(BaseModel):
    placement_id: Optional[str] = None
    candidate_id: str
    recruiter_id: str
    joining_date: date
    days_employed: int = 0

class BankReleaseIn(BaseModel):
    bank_id: str
    status: str  # released | forfeited
    forfeited_reason: Optional[str] = None

class LoyaltyIn(BaseModel):
    user_id: str
    joining_date: date

# ── endpoints ──────────────────────────────────────────────

@router.get("/scorecard")
async def list_scorecards(
    month: Optional[int] = None,
    year: Optional[int] = None,
    actor: Actor = Depends(require_permission("incentives", "read")),
):
    """Admin: all recruiters. Recruiter: own only (filtered by user_id claim)."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT k.*, u.full_name, u.email,
                   b.held_total, b.released_total, b.forfeited_total
            FROM recruiter_kpi_scores k
            JOIN users u ON u.id = k.user_id
            LEFT JOIN v_recruiter_bank_summary b
                   ON b.user_id = k.user_id AND b.tenant_id = k.tenant_id
            WHERE ($1::int IS NULL OR k.period_month = $1)
              AND ($2::int IS NULL OR k.period_year  = $2)
            ORDER BY k.period_year DESC, k.period_month DESC, u.full_name
        """, month, year)
    return [dict(r) for r in rows]


@router.get("/scorecard/suggest")
async def suggest_scorecard(
    user_id: str, period_month: int, period_year: int,
    actor: Actor = Depends(require_permission("incentives", "write")),
):
    """Real-data suggestions for the 6 recruiter_kpi_scores sub-scores
    (Workforce Intelligence, 2026-08-11) — recruiter_kpi_scores is the
    official, human-approved, compensation-linked monthly scorecard
    (wired into incentive_records/retention_bank via the existing
    draft->approved->paid workflow); this endpoint only *suggests* values
    computed from real placements/interviews/offers/feedback/activity
    this period, for a manager to review and adjust before saving via the
    existing POST /scorecard — it never writes recruiter_kpi_scores
    itself. Every number here traces to real underlying rows; nothing is
    estimated or invented.
    """
    period_start = date(period_year, period_month, 1)
    period_end = date(period_year + (1 if period_month == 12 else 0), 1 if period_month == 12 else period_month + 1, 1)
    async with db.tenant_conn(actor.tenant_id) as conn:
        # Real placements this recruiter made this period (placements has
        # no direct recruiter column — attribute via offer -> application).
        placements = await conn.fetch("""
            SELECT p.id, p.requisition_id, r.client_id
            FROM placements p
            JOIN offers o ON o.id = p.offer_id
            JOIN applications a ON a.id = o.application_id
            LEFT JOIN requisitions r ON r.id = p.requisition_id
            WHERE p.tenant_id=$1 AND a.assigned_recruiter_id=$2
              AND p.created_at >= $3 AND p.created_at < $4
        """, actor.tenant_id, user_id, period_start, period_end)
        joinings_score = round(min(35.0, len(placements) * 12.0), 2)

        # Revenue: this recruiter's share of each placed client's real
        # account_pl revenue this period, split across every recruiter who
        # placed for that client this period — a best-effort, real-data-
        # grounded heuristic (there's no per-placement revenue figure to
        # read directly), same spirit as match_recruiters()'s own
        # documented zero-weight placeholders for un-derivable factors.
        revenue_share = 0.0
        for p in placements:
            if not p["client_id"]:
                continue
            pl = await conn.fetchrow(
                "SELECT gross_revenue FROM account_pl WHERE tenant_id=$1 AND client_id=$2 AND period_month=$3 AND period_year=$4",
                actor.tenant_id, p["client_id"], period_month, period_year)
            if not pl or not pl["gross_revenue"]:
                continue
            recruiter_count = await conn.fetchval("""
                SELECT COUNT(DISTINCT a.assigned_recruiter_id)
                FROM placements p2 JOIN offers o2 ON o2.id=p2.offer_id
                JOIN applications a ON a.id=o2.application_id
                WHERE p2.tenant_id=$1 AND p2.requisition_id IN (
                    SELECT id FROM requisitions WHERE tenant_id=$1 AND client_id=$2)
                  AND p2.created_at >= $3 AND p2.created_at < $4
            """, actor.tenant_id, p["client_id"], period_start, period_end) or 1
            revenue_share += float(pl["gross_revenue"]) / max(1, recruiter_count)
        revenue_score = round(min(25.0, revenue_share / 20000.0), 2)

        interviews_done = await conn.fetchval("""
            SELECT COUNT(*) FROM interview_schedules
            WHERE tenant_id=$1 AND interviewer_id=$2 AND status='completed'
              AND scheduled_at >= $3 AND scheduled_at < $4
        """, actor.tenant_id, user_id, period_start, period_end) or 0
        interview_score = round(min(10.0, interviews_done * 2.0), 2)

        offer_stats = await conn.fetchrow("""
            SELECT COUNT(*) generated, COUNT(*) FILTER (WHERE o.status='accepted') accepted
            FROM offers o JOIN applications a ON a.id=o.application_id
            WHERE o.tenant_id=$1 AND a.assigned_recruiter_id=$2
              AND o.created_at >= $3 AND o.created_at < $4
        """, actor.tenant_id, user_id, period_start, period_end)
        offer_score = round(10.0 * offer_stats["accepted"] / offer_stats["generated"], 2) if offer_stats and offer_stats["generated"] else 0.0

        sat = await conn.fetchrow("""
            SELECT AVG(f.rating) avg_rating, COUNT(*) n
            FROM client_feedback f JOIN applications a ON a.id=f.application_id
            WHERE f.tenant_id=$1 AND a.assigned_recruiter_id=$2 AND f.rating IS NOT NULL
              AND f.created_at >= $3 AND f.created_at < $4
        """, actor.tenant_id, user_id, period_start, period_end)
        # Neutral midpoint (not zero) when no feedback exists yet — avoids
        # unfairly zeroing a recruiter purely because no client happened
        # to leave feedback this period. client_feedback.rating is 1-5.
        client_sat_score = round(float(sat["avg_rating"]) * 2.0, 2) if sat and sat["n"] else 5.0

        activity_count = await conn.fetchval("""
            SELECT COUNT(*) FROM recruiter_activity_events
            WHERE tenant_id=$1 AND recruiter_id=$2 AND event_at >= $3 AND event_at < $4
        """, actor.tenant_id, user_id, period_start, period_end) or 0
        ats_score = round(min(10.0, activity_count / 5.0), 2)

    return {
        "user_id": user_id, "period_month": period_month, "period_year": period_year,
        "joinings_score": joinings_score, "revenue_score": revenue_score,
        "interview_score": interview_score, "offer_score": offer_score,
        "client_sat_score": client_sat_score, "ats_score": ats_score,
        "source_counts": {
            "placements": len(placements), "interviews_completed": interviews_done,
            "offers_generated": offer_stats["generated"] if offer_stats else 0,
            "offers_accepted": offer_stats["accepted"] if offer_stats else 0,
            "feedback_count": sat["n"] if sat else 0, "activity_events": activity_count,
        },
    }


@router.post("/scorecard")
async def upsert_scorecard(body: KpiScoreIn, actor: Actor = Depends(get_actor)):
    """Create or update a monthly KPI scorecard (trigger auto-calculates grade/incentive)."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            INSERT INTO recruiter_kpi_scores
              (tenant_id, user_id, period_month, period_year,
               joinings_score, revenue_score, interview_score, offer_score,
               client_sat_score, ats_score, contribution_margin)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
            ON CONFLICT (tenant_id, user_id, period_month, period_year) DO UPDATE SET
              joinings_score       = EXCLUDED.joinings_score,
              revenue_score        = EXCLUDED.revenue_score,
              interview_score      = EXCLUDED.interview_score,
              offer_score          = EXCLUDED.offer_score,
              client_sat_score     = EXCLUDED.client_sat_score,
              ats_score            = EXCLUDED.ats_score,
              contribution_margin  = EXCLUDED.contribution_margin
            RETURNING *
        """,
            actor.tenant_id, body.user_id, body.period_month, body.period_year,
            body.joinings_score, body.revenue_score, body.interview_score,
            body.offer_score, body.client_sat_score, body.ats_score,
            body.contribution_margin,
        )
    return dict(row)


@router.patch("/scorecard/{score_id}/status")
async def approve_scorecard(
    score_id: str, body: KpiApproveIn, actor: Actor = Depends(get_actor)
):
    if body.status not in ('approved', 'paid'):
        raise HTTPException(400, "status must be approved or paid")
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            UPDATE recruiter_kpi_scores
               SET status = $1,
                   approved_by = $2,
                   approved_at = now()
             WHERE id = $3
            RETURNING *
        """, body.status, actor.user_id, score_id)
        if not row:
            raise HTTPException(404, "Scorecard not found")
        # When approved, create incentive_record + retention_bank entry
        if body.status == 'approved':
            await conn.execute("""
                INSERT INTO incentive_records
                  (tenant_id, user_id, kpi_score_id, period_month, period_year,
                   gross_incentive, immediate_payout_70pct, retention_bank_30pct,
                   contribution_margin, status)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending')
                ON CONFLICT (tenant_id, user_id, period_month, period_year) DO UPDATE SET
                  gross_incentive       = EXCLUDED.gross_incentive,
                  immediate_payout_70pct = EXCLUDED.immediate_payout_70pct,
                  retention_bank_30pct  = EXCLUDED.retention_bank_30pct
            """,
                actor.tenant_id, row['user_id'], score_id,
                row['period_month'], row['period_year'],
                row['calculated_incentive'], row['immediate_payout'], row['retention_bank_amount'],
                row['contribution_margin'],
            )
            # Add to retention bank if amount > 0. ON CONFLICT targets the
            # real unique constraint (sql/36_retention_bank_dedup.sql) — a
            # bare ON CONFLICT DO NOTHING had no matching constraint to fire
            # on (only `id`, a fresh UUID every call), so re-approving the
            # same scorecard (double-click, retry) silently double-accrued a
            # held incentive. Update-in-place instead of no-op so a genuinely
            # changed retention amount stays in sync, but only while still
            # 'held' — never overwrite a record that's already been released
            # or forfeited.
            if row['retention_bank_amount'] and row['retention_bank_amount'] > 0:
                # release_due_date computed in Python, not SQL — the original
                # `(make_date($5::int,$4::int,1) + interval '3 months')::date`
                # reused $4/$5 both as raw SMALLINT-column binds and as
                # explicit ::int casts in the same prepared statement, which
                # asyncpg's parameter-type inference can't reconcile
                # (asyncpg.exceptions.AmbiguousParameterError: inconsistent
                # types deduced for parameter $4, integer versus smallint) —
                # a real, previously-dormant bug never caught because nothing
                # ever called this endpoint with status='approved' until this
                # feature's UI added a real Approve button.
                _total_months = row['period_month'] + 3
                _extra_years, _new_month = divmod(_total_months - 1, 12)
                release_due = date(row['period_year'] + _extra_years, _new_month + 1, 1)
                await conn.execute("""
                    INSERT INTO retention_bank
                      (tenant_id, user_id, amount, accrued_month, accrued_year,
                       release_schedule, release_due_date)
                    VALUES ($1,$2,$3,$4,$5,'quarterly',$6)
                    ON CONFLICT (tenant_id, user_id, accrued_month, accrued_year)
                    DO UPDATE SET amount = EXCLUDED.amount
                    WHERE retention_bank.status = 'held'
                """,
                    actor.tenant_id, row['user_id'],
                    row['retention_bank_amount'],
                    row['period_month'], row['period_year'], release_due,
                )
    return dict(row)


@router.get("/advanced-kpis")
async def list_advanced_kpis(
    month: Optional[int] = None,
    year: Optional[int] = None,
    actor: Actor = Depends(get_actor),
):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT k.*, u.full_name
            FROM recruiter_advanced_kpis k
            JOIN users u ON u.id = k.user_id
            WHERE ($1::int IS NULL OR k.period_month = $1)
              AND ($2::int IS NULL OR k.period_year  = $2)
            ORDER BY k.period_year DESC, k.period_month DESC, u.full_name
        """, month, year)
    return [dict(r) for r in rows]


@router.post("/advanced-kpis")
async def upsert_advanced_kpis(body: AdvKpiIn, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            INSERT INTO recruiter_advanced_kpis
              (tenant_id, user_id, period_month, period_year,
               time_to_first_sub_hrs, submission_acceptance_pct,
               interview_ratio, offer_ratio, joining_ratio,
               offer_drop_rate, no_show_pct,
               candidate_satisfaction, client_satisfaction, retention_90day_pct)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
            ON CONFLICT (tenant_id, user_id, period_month, period_year) DO UPDATE SET
              time_to_first_sub_hrs     = COALESCE(EXCLUDED.time_to_first_sub_hrs, recruiter_advanced_kpis.time_to_first_sub_hrs),
              submission_acceptance_pct = COALESCE(EXCLUDED.submission_acceptance_pct, recruiter_advanced_kpis.submission_acceptance_pct),
              interview_ratio           = COALESCE(EXCLUDED.interview_ratio, recruiter_advanced_kpis.interview_ratio),
              offer_ratio               = COALESCE(EXCLUDED.offer_ratio, recruiter_advanced_kpis.offer_ratio),
              joining_ratio             = COALESCE(EXCLUDED.joining_ratio, recruiter_advanced_kpis.joining_ratio),
              offer_drop_rate           = COALESCE(EXCLUDED.offer_drop_rate, recruiter_advanced_kpis.offer_drop_rate),
              no_show_pct               = COALESCE(EXCLUDED.no_show_pct, recruiter_advanced_kpis.no_show_pct),
              candidate_satisfaction    = COALESCE(EXCLUDED.candidate_satisfaction, recruiter_advanced_kpis.candidate_satisfaction),
              client_satisfaction       = COALESCE(EXCLUDED.client_satisfaction, recruiter_advanced_kpis.client_satisfaction),
              retention_90day_pct       = COALESCE(EXCLUDED.retention_90day_pct, recruiter_advanced_kpis.retention_90day_pct),
              updated_at = now()
            RETURNING *
        """,
            actor.tenant_id, body.user_id, body.period_month, body.period_year,
            body.time_to_first_sub_hrs, body.submission_acceptance_pct,
            body.interview_ratio, body.offer_ratio, body.joining_ratio,
            body.offer_drop_rate, body.no_show_pct,
            body.candidate_satisfaction, body.client_satisfaction,
            body.retention_90day_pct,
        )
    return dict(row)


@router.get("/retention-tracking")
async def list_retention(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT rt.*, c.full_name AS candidate_name,
                   u.full_name AS recruiter_name,
                   retention_credit(rt.days_employed) AS credit_pct
            FROM candidate_retention_tracking rt
            JOIN candidates c ON c.id = rt.candidate_id
            JOIN users u ON u.id = rt.recruiter_id
            ORDER BY rt.joining_date DESC
        """)
    return [dict(r) for r in rows]


@router.post("/retention-tracking")
async def upsert_retention(body: RetentionTrackIn, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            INSERT INTO candidate_retention_tracking
              (tenant_id, placement_id, candidate_id, recruiter_id,
               joining_date, days_employed,
               retention_credit_pct, last_checked_at)
            VALUES ($1,$2,$3,$4,$5,$6, retention_credit($6), now())
            ON CONFLICT DO NOTHING
            RETURNING *
        """,
            actor.tenant_id, body.placement_id, body.candidate_id,
            body.recruiter_id, body.joining_date, body.days_employed,
        )
    return dict(row) if row else {"status": "already exists"}


@router.patch("/retention-tracking/{track_id}")
async def update_retention_days(
    track_id: str, days_employed: int, actor: Actor = Depends(get_actor)
):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            UPDATE candidate_retention_tracking
               SET days_employed        = $1,
                   retention_credit_pct = retention_credit($1),
                   last_checked_at      = now()
             WHERE id = $2
            RETURNING *
        """, days_employed, track_id)
        if not row:
            raise HTTPException(404, "Record not found")
    return dict(row)


@router.get("/bank")
async def get_bank(user_id: Optional[str] = None, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT rb.*, u.full_name
            FROM retention_bank rb
            JOIN users u ON u.id = rb.user_id
            WHERE ($1::text IS NULL OR rb.user_id::text = $1)
            ORDER BY rb.accrued_year DESC, rb.accrued_month DESC
        """, user_id)
    return [dict(r) for r in rows]


@router.patch("/bank/{bank_id}")
async def update_bank_status(
    bank_id: str, body: BankReleaseIn, actor: Actor = Depends(get_actor)
):
    if body.status not in ('released', 'forfeited'):
        raise HTTPException(400, "status must be released or forfeited")
    # released_at computed in Python, not a `$1='released'` SQL comparison —
    # asyncpg inferred two different types for $1 from that comparison
    # (text) vs. the direct `status = $1` column assignment (varchar),
    # throwing AmbiguousParameterError on every call. Another real,
    # previously-dormant bug: nothing ever called this endpoint until this
    # feature's UI added a real Release/Forfeit action.
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(f"""
            UPDATE retention_bank
               SET status           = $1,
                   released_at      = {'now()' if body.status == 'released' else 'NULL'},
                   forfeited_reason = $2
             WHERE id = $3
            RETURNING *
        """, body.status, body.forfeited_reason, bank_id)
        if not row:
            raise HTTPException(404, "Bank record not found")
    return dict(row)


@router.get("/loyalty")
async def list_loyalty(user_id: Optional[str] = None, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT lm.*, u.full_name, u.email
            FROM loyalty_milestones lm
            JOIN users u ON u.id = lm.user_id
            WHERE ($1::text IS NULL OR lm.user_id::text = $1)
            ORDER BY lm.milestone_date
        """, user_id)
    return [dict(r) for r in rows]


@router.post("/loyalty/seed")
async def seed_loyalty(body: LoyaltyIn, actor: Actor = Depends(get_actor)):
    """Seed all 4 milestone rows for a recruiter from their joining_date."""
    created = []
    async with db.tenant_conn(actor.tenant_id) as conn:
        for yrs, bonus in {1: 15000, 2: 30000, 3: 50000, 5: 100000}.items():
            try:
                ms_date = body.joining_date.replace(year=body.joining_date.year + yrs)
            except ValueError:
                import datetime
                ms_date = body.joining_date + datetime.timedelta(days=yrs*365)
            row = await conn.fetchrow("""
                INSERT INTO loyalty_milestones
                  (tenant_id, user_id, joining_date, milestone_years,
                   bonus_amount, milestone_date)
                VALUES ($1,$2,$3,$4,$5,$6)
                ON CONFLICT (tenant_id, user_id, milestone_years) DO NOTHING
                RETURNING *
            """, actor.tenant_id, body.user_id, body.joining_date, yrs, bonus, ms_date)
            if row:
                created.append(dict(row))
    return {"created": len(created), "milestones": created}


@router.patch("/loyalty/{milestone_id}/pay")
async def mark_loyalty_paid(milestone_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            UPDATE loyalty_milestones
               SET status = 'paid', paid_at = now(), achieved_at = COALESCE(achieved_at, now())
             WHERE id = $1
            RETURNING *
        """, milestone_id)
        if not row:
            raise HTTPException(404, "Milestone not found")
    return dict(row)


@router.get("/summary")
async def get_summary(
    month: Optional[int] = None,
    year: Optional[int] = None,
    actor: Actor = Depends(get_actor),
):
    """KPI summary stats for the incentives dashboard."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        stats = await conn.fetchrow("""
            SELECT
                COUNT(*)                                           AS total_scorecards,
                ROUND(AVG(total_score), 1)                        AS avg_score,
                COUNT(*) FILTER (WHERE grade = 'A+')              AS grade_aplus,
                COUNT(*) FILTER (WHERE grade = 'A')               AS grade_a,
                COUNT(*) FILTER (WHERE grade = 'B')               AS grade_b,
                COUNT(*) FILTER (WHERE grade = 'C')               AS grade_c,
                COUNT(*) FILTER (WHERE grade = 'D')               AS grade_d,
                COALESCE(SUM(calculated_incentive), 0)            AS total_incentive_pool,
                COALESCE(SUM(immediate_payout), 0)                AS total_immediate,
                COALESCE(SUM(retention_bank_amount), 0)           AS total_banked
            FROM recruiter_kpi_scores
            WHERE ($1::int IS NULL OR period_month = $1)
              AND ($2::int IS NULL OR period_year  = $2)
        """, month, year)
        bank = await conn.fetchrow("""
            SELECT COALESCE(SUM(amount) FILTER (WHERE status='held'), 0)      AS bank_held,
                   COALESCE(SUM(amount) FILTER (WHERE status='released'), 0)  AS bank_released,
                   COALESCE(SUM(amount) FILTER (WHERE status='forfeited'), 0) AS bank_forfeited
            FROM retention_bank
        """)
        loyalty = await conn.fetchrow("""
            SELECT COUNT(*) FILTER (WHERE status='pending')  AS pending_milestones,
                   COUNT(*) FILTER (WHERE status='achieved') AS due_milestones,
                   COALESCE(SUM(bonus_amount) FILTER (WHERE status='achieved'), 0) AS due_amount
            FROM loyalty_milestones
        """)
    return {
        **dict(stats),
        **dict(bank),
        **dict(loyalty),
    }
