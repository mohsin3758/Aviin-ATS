"""P17 - Account Financial Framework & CEO Dashboard."""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
import db
from deps import Actor, get_actor

router = APIRouter(prefix="/account-pl", tags=["account-pl"])

class AccountPlIn(BaseModel):
    client_id: str
    client_name: Optional[str] = None
    period_month: int = Field(..., ge=1, le=12)
    period_year: int = Field(..., ge=2020, le=2099)
    gross_revenue: float = 0
    management_cost: float = 0
    finance_cost: float = 0
    ops_cost: float = 0
    recruiter_incentives: float = 0
    sourcing_cost: float = 0
    referral_cost: float = 0
    kae_incentive: float = 0
    growth_reserve: float = 0
    op_reserve: float = 0
    delivery_cost: float = 0
    total_incentives: float = 0
    operational_cost: float = 0
    active_positions: int = 0
    filled_positions: int = 0

class CollectionIn(BaseModel):
    client_id: str
    client_name: Optional[str] = None
    invoice_ref: Optional[str] = None
    invoice_date: Optional[str] = None
    invoice_amount: float
    collected_amount: float = 0
    due_date: Optional[str] = None
    collected_date: Optional[str] = None
    collection_stage: str = 'invoice_raised'
    kae_user_id: Optional[str] = None
    notes: Optional[str] = None

class BuEligibilityIn(BaseModel):
    client_id: str
    client_name: Optional[str] = None
    min_monthly_revenue: float = 0
    min_cm_pct: float = 0
    months_active: int = 0
    active_positions: int = 0
    is_eligible: bool = False
    eligible_since: Optional[str] = None
    bu_head_user_id: Optional[str] = None
    notes: Optional[str] = None


# -- Account P&L endpoints --

@router.get("")
async def list_account_pl(month: Optional[int]=None, year: Optional[int]=None,
                           actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT * FROM v_account_pl
            WHERE ($1::int IS NULL OR period_month=$1)
              AND ($2::int IS NULL OR period_year=$2)
            ORDER BY gross_revenue DESC
        """, month, year)
    return [dict(r) for r in rows]

@router.post("")
async def upsert_account_pl(body: AccountPlIn, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            INSERT INTO account_pl
              (tenant_id,client_id,client_name,period_month,period_year,
               gross_revenue,management_cost,finance_cost,ops_cost,
               recruiter_incentives,sourcing_cost,referral_cost,kae_incentive,
               growth_reserve,op_reserve,delivery_cost,total_incentives,
               operational_cost,active_positions,filled_positions)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
            ON CONFLICT (tenant_id,client_id,period_month,period_year) DO UPDATE SET
              gross_revenue=EXCLUDED.gross_revenue,
              management_cost=EXCLUDED.management_cost,finance_cost=EXCLUDED.finance_cost,
              ops_cost=EXCLUDED.ops_cost,recruiter_incentives=EXCLUDED.recruiter_incentives,
              sourcing_cost=EXCLUDED.sourcing_cost,referral_cost=EXCLUDED.referral_cost,
              kae_incentive=EXCLUDED.kae_incentive,growth_reserve=EXCLUDED.growth_reserve,
              op_reserve=EXCLUDED.op_reserve,delivery_cost=EXCLUDED.delivery_cost,
              total_incentives=EXCLUDED.total_incentives,operational_cost=EXCLUDED.operational_cost,
              active_positions=EXCLUDED.active_positions,filled_positions=EXCLUDED.filled_positions
            RETURNING *
        """, actor.tenant_id, body.client_id, body.client_name,
             body.period_month, body.period_year, body.gross_revenue,
             body.management_cost, body.finance_cost, body.ops_cost,
             body.recruiter_incentives, body.sourcing_cost, body.referral_cost,
             body.kae_incentive, body.growth_reserve, body.op_reserve,
             body.delivery_cost, body.total_incentives, body.operational_cost,
             body.active_positions, body.filled_positions)
    return dict(row)

@router.get("/summary")
async def account_pl_summary(month: Optional[int]=None, year: Optional[int]=None,
                              actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            SELECT COUNT(*) AS account_count,
                   COALESCE(SUM(gross_revenue),0) AS total_revenue,
                   COALESCE(SUM(contribution_margin),0) AS total_cm,
                   ROUND(AVG(cm_pct),2) AS avg_cm_pct,
                   COALESCE(SUM(delivery_pool),0) AS total_delivery_pool,
                   COALESCE(SUM(recruiter_incentives),0) AS total_recruiter_incentives,
                   COUNT(*) FILTER (WHERE contribution_margin<0) AS loss_making_accounts
            FROM account_pl
            WHERE ($1::int IS NULL OR period_month=$1)
              AND ($2::int IS NULL OR period_year=$2)
        """, month, year)
    return dict(row)

@router.get("/{account_id}")
async def get_account_pl(account_id: str, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("SELECT * FROM v_account_pl WHERE id=$1", account_id)
        if not row:
            raise HTTPException(404, "Not found")
        allocs = await conn.fetch(
            "SELECT * FROM delivery_pool_allocations WHERE account_pl_id=$1 ORDER BY amount DESC",
            account_id)
    return {**dict(row), "allocations": [dict(a) for a in allocs]}

@router.patch("/{account_id}/finalize")
async def finalize_account_pl(account_id: str, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            UPDATE account_pl SET is_finalized=true,finalized_by=$1,finalized_at=now()
            WHERE id=$2 RETURNING *
        """, actor.user_id, account_id)
        if not row:
            raise HTTPException(404, "Not found")
    return dict(row)


# -- Collections --


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

coll_router = APIRouter(prefix="/collections", tags=["collections"])

@coll_router.get("")
async def list_collections(status: Optional[str]=None, client_id: Optional[str]=None,
                            actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT * FROM v_collection_aging
            WHERE ($1::text IS NULL OR status=$1)
              AND ($2::text IS NULL OR client_id::text=$2)
            ORDER BY aging_days DESC NULLS LAST, invoice_amount DESC
        """, status, client_id)
    return [dict(r) for r in rows]

@coll_router.post("")
async def create_collection(body: CollectionIn, actor: Actor=Depends(get_actor)):
    from datetime import date as _d, datetime as _dt
    def _date(v):
        if v is None or v == "": return None
        if hasattr(v, "toordinal"): return v
        try:
            if "T" in str(v): return _dt.fromisoformat(str(v)).date()
            return _d.fromisoformat(str(v))
        except: return None
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            INSERT INTO collection_records
              (tenant_id,client_id,client_name,invoice_ref,
               invoice_date,
               invoice_amount,collected_amount,due_date,collected_date,
               collection_stage,kae_user_id,notes)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
            RETURNING *
        """, actor.tenant_id, body.client_id, body.client_name,
             body.invoice_ref,
             _date(body.invoice_date),
             body.invoice_amount, body.collected_amount,
             _date(body.due_date), _date(body.collected_date),
             body.collection_stage, body.kae_user_id, body.notes)
    return dict(row)

@coll_router.patch("/{coll_id}")
async def update_collection(coll_id: str, body: CollectionIn, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            UPDATE collection_records SET
              collected_amount=$1, collected_date=$2::date,
              collection_stage=$3, notes=$4, updated_at=now()
            WHERE id=$5 RETURNING *
        """, body.collected_amount, _to_date(body.collected_date),
             body.collection_stage, body.notes, coll_id)
        if not row:
            raise HTTPException(404, "Not found")
    return dict(row)

@coll_router.get("/summary")
async def collections_summary(actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            SELECT COUNT(*) AS total_invoices,
                   COALESCE(SUM(invoice_amount),0) AS total_invoiced,
                   COALESCE(SUM(collected_amount),0) AS total_collected,
                   COALESCE(SUM(outstanding_amount),0) AS total_outstanding,
                   COUNT(*) FILTER (WHERE status='overdue') AS overdue_count,
                   COALESCE(SUM(invoice_amount) FILTER (WHERE status='overdue'),0) AS overdue_amount,
                   COUNT(*) FILTER (WHERE aging_days > 90) AS beyond_90d
            FROM collection_records
        """)
    return dict(row)


# -- BU Eligibility --

bu_router = APIRouter(prefix="/bu-tracker", tags=["bu-tracker"])

@bu_router.get("")
async def list_bu(actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT be.*, u.full_name AS bu_head_name
            FROM bu_eligibility be
            LEFT JOIN users u ON u.id=be.bu_head_user_id
            ORDER BY be.is_eligible DESC, be.min_monthly_revenue DESC
        """)
    return [dict(r) for r in rows]

@bu_router.post("")
async def upsert_bu(body: BuEligibilityIn, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            INSERT INTO bu_eligibility
              (tenant_id,client_id,client_name,min_monthly_revenue,min_cm_pct,
               months_active,active_positions,is_eligible,eligible_since,
               bu_head_user_id,notes,last_evaluated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10,$11,now())
            ON CONFLICT (tenant_id,client_id) DO UPDATE SET
              min_monthly_revenue=EXCLUDED.min_monthly_revenue,
              min_cm_pct=EXCLUDED.min_cm_pct,
              months_active=EXCLUDED.months_active,
              active_positions=EXCLUDED.active_positions,
              is_eligible=EXCLUDED.is_eligible,
              eligible_since=EXCLUDED.eligible_since,
              bu_head_user_id=EXCLUDED.bu_head_user_id,
              notes=EXCLUDED.notes,
              last_evaluated_at=now()
            RETURNING *
        """, actor.tenant_id, body.client_id, body.client_name,
             body.min_monthly_revenue, body.min_cm_pct, body.months_active,
             body.active_positions, body.is_eligible, body.eligible_since,
             body.bu_head_user_id, body.notes)
    return dict(row)

@bu_router.patch("/{bu_id}/create-bu")
async def mark_bu_created(bu_id: str, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            UPDATE bu_eligibility SET bu_created=true,bu_created_at=now()
            WHERE id=$1 RETURNING *
        """, bu_id)
        if not row:
            raise HTTPException(404, "Not found")
    return dict(row)


# -- CEO Dashboard --

ceo_router = APIRouter(prefix="/ceo-dashboard", tags=["ceo-dashboard"])

@ceo_router.get("")
async def ceo_dashboard(month: Optional[int]=None, year: Optional[int]=None,
                         actor: Actor=Depends(get_actor)):
    """Aggregated CEO view: revenue, CM, collections, BU status, top accounts."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        pl = await conn.fetchrow("""
            SELECT COALESCE(SUM(gross_revenue),0) AS total_revenue,
                   COALESCE(SUM(contribution_margin),0) AS total_cm,
                   ROUND(AVG(cm_pct),2) AS avg_cm_pct,
                   COUNT(*) AS account_count,
                   COUNT(*) FILTER (WHERE contribution_margin<0) AS loss_making
            FROM account_pl
            WHERE ($1::int IS NULL OR period_month=$1) AND ($2::int IS NULL OR period_year=$2)
        """, month, year)
        coll = await conn.fetchrow("""
            SELECT COALESCE(SUM(invoice_amount),0) AS total_invoiced,
                   COALESCE(SUM(collected_amount),0) AS total_collected,
                   COALESCE(SUM(outstanding_amount),0) AS total_outstanding,
                   COUNT(*) FILTER (WHERE status='overdue') AS overdue_count
            FROM collection_records
        """)
        bu = await conn.fetchrow("""
            SELECT COUNT(*) AS total_accounts,
                   COUNT(*) FILTER (WHERE is_eligible) AS eligible_count,
                   COUNT(*) FILTER (WHERE bu_created) AS bu_created_count
            FROM bu_eligibility
        """)
        kpi = await conn.fetchrow("""
            SELECT COUNT(*) AS total_kpis,
                   ROUND(AVG(total_score),1) AS avg_recruiter_score,
                   COALESCE(SUM(calculated_incentive),0) AS total_recruiter_incentives
            FROM recruiter_kpi_scores
            WHERE ($1::int IS NULL OR period_month=$1) AND ($2::int IS NULL OR period_year=$2)
        """, month, year)
        top_accounts = await conn.fetch("""
            SELECT client_name, gross_revenue, contribution_margin, cm_pct, fill_rate_pct
            FROM v_account_pl
            WHERE ($1::int IS NULL OR period_month=$1) AND ($2::int IS NULL OR period_year=$2)
            ORDER BY gross_revenue DESC LIMIT 10
        """, month, year)
    return {
        "pl_summary": dict(pl),
        "collection_summary": dict(coll),
        "bu_summary": dict(bu),
        "kpi_summary": dict(kpi),
        "top_accounts": [dict(r) for r in top_accounts],
    }
