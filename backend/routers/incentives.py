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
    actor: Actor = Depends(get_actor),
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
            # Add to retention bank if amount > 0
            if row['retention_bank_amount'] and row['retention_bank_amount'] > 0:
                await conn.execute("""
                    INSERT INTO retention_bank
                      (tenant_id, user_id, amount, accrued_month, accrued_year,
                       release_schedule, release_due_date)
                    VALUES ($1,$2,$3,$4,$5,'quarterly',
                            (make_date($5::int, $4::int, 1) + interval '3 months')::date)
                    ON CONFLICT DO NOTHING
                """,
                    actor.tenant_id, row['user_id'],
                    row['retention_bank_amount'],
                    row['period_month'], row['period_year'],
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
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            UPDATE retention_bank
               SET status           = $1,
                   released_at      = CASE WHEN $1='released' THEN now() ELSE NULL END,
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
            from datetime import timedelta
            from dateutil.relativedelta import relativedelta
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
