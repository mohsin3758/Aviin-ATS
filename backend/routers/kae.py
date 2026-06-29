"""P16 - KAE Module & Account Ownership."""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
import db
from deps import Actor, get_actor

router = APIRouter(prefix="/kae", tags=["kae"])

class ClientOwnerIn(BaseModel):
    client_id: str
    user_id: str
    owner_type: str = "kae"
    visibility_lvl: str = "L3"
    notes: Optional[str] = None

class VisibilityIn(BaseModel):
    user_id: str
    visibility_lvl: str

class KaeKpiIn(BaseModel):
    user_id: str
    period_month: int = Field(..., ge=1, le=12)
    period_year: int = Field(..., ge=2020, le=2099)
    revenue_target: float = 0
    revenue_actual: float = 0
    revenue_score: float = Field(0, ge=0, le=40)
    collection_target: float = 0
    collection_actual: float = 0
    collection_score: float = Field(0, ge=0, le=25)
    client_sat_score: float = Field(0, ge=0, le=20)
    new_pos_score: float = Field(0, ge=0, le=10)
    renewal_score: float = Field(0, ge=0, le=5)
    base_incentive: float = 0
    client_id: Optional[str] = None

class KaeApproveIn(BaseModel):
    status: str

class KaeRetentionIn(BaseModel):
    client_id: str
    user_id: str
    owner_since: str
    months_served: int = 0

@router.get("/owners")
async def list_owners(client_id: Optional[str]=None, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT co.*, u.full_name, u.email
            FROM client_owners co
            JOIN users u ON u.id=co.user_id
            WHERE co.is_active=true AND ($1::text IS NULL OR co.client_id::text=$1)
            ORDER BY co.assigned_at DESC
        """, client_id)
    return [dict(r) for r in rows]

@router.post("/owners")
async def assign_owner(body: ClientOwnerIn, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        if body.owner_type == 'kae':
            count = await conn.fetchval("""
                SELECT COUNT(*) FROM client_owners
                WHERE tenant_id=$1 AND client_id=$2 AND owner_type='kae' AND is_active=true
            """, actor.tenant_id, body.client_id)
            if count >= 3:
                raise HTTPException(400, "3-KAE limit reached for this client")
        row = await conn.fetchrow("""
            INSERT INTO client_owners
              (tenant_id,client_id,user_id,owner_type,visibility_lvl,assigned_by,notes)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
            ON CONFLICT (tenant_id,client_id,user_id) DO UPDATE SET
              owner_type=EXCLUDED.owner_type, visibility_lvl=EXCLUDED.visibility_lvl,
              is_active=true, notes=EXCLUDED.notes, assigned_at=now()
            RETURNING *
        """, actor.tenant_id, body.client_id, body.user_id,
             body.owner_type, body.visibility_lvl, actor.user_id, body.notes)
    return dict(row)

@router.delete("/owners/{owner_id}")
async def remove_owner(owner_id: str, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "UPDATE client_owners SET is_active=false WHERE id=$1 RETURNING id", owner_id)
        if not row:
            raise HTTPException(404, "Not found")
    return {"status": "removed"}

@router.get("/owners/by-client/{client_id}")
async def get_client_owners(client_id: str, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT co.*, u.full_name, u.email,
                   kr.months_served,
                   kae_retention_bonus(COALESCE(kr.months_served,0)) AS next_retention_bonus
            FROM client_owners co
            JOIN users u ON u.id=co.user_id
            LEFT JOIN kae_client_retention kr
                   ON kr.user_id=co.user_id AND kr.client_id=co.client_id AND kr.tenant_id=co.tenant_id
            WHERE co.tenant_id=$1 AND co.client_id::text=$2 AND co.is_active
            ORDER BY co.owner_type, co.assigned_at
        """, actor.tenant_id, client_id)
    return {"client_id": client_id, "owners": [dict(r) for r in rows],
            "kae_count": sum(1 for r in rows if r["owner_type"]=="kae"), "max_kae": 3}

@router.get("/visibility")
async def list_visibility(actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT av.*, u.full_name, u.email FROM account_visibility av
            JOIN users u ON u.id=av.user_id
            ORDER BY av.visibility_lvl DESC, u.full_name
        """)
    return [dict(r) for r in rows]

@router.post("/visibility")
async def set_visibility(body: VisibilityIn, actor: Actor=Depends(get_actor)):
    if body.visibility_lvl not in ('L1','L2','L3','L4','L5'):
        raise HTTPException(400, "visibility_lvl must be L1..L5")
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute("SELECT set_visibility_level($1,$2,$3)",
            actor.tenant_id, body.user_id, body.visibility_lvl)
        row = await conn.fetchrow("""
            SELECT av.*, u.full_name FROM account_visibility av
            JOIN users u ON u.id=av.user_id
            WHERE av.tenant_id=$1 AND av.user_id=$2
        """, actor.tenant_id, body.user_id)
    return dict(row)

@router.get("/visibility/my")
async def my_visibility(actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT * FROM account_visibility WHERE tenant_id=$1 AND user_id=$2",
            actor.tenant_id, actor.user_id)
    if not row:
        return {"visibility_lvl":"L1","can_see_own_revenue":False,
                "can_see_account_revenue":False,"can_see_delivery_data":False,
                "can_see_account_pl":False,"can_see_company_pl":False}
    return dict(row)

@router.get("/scorecard")
async def list_kae_scorecards(month: Optional[int]=None, year: Optional[int]=None,
                               actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT k.*, u.full_name, u.email FROM kae_kpi_scores k
            JOIN users u ON u.id=k.user_id
            WHERE ($1::int IS NULL OR k.period_month=$1)
              AND ($2::int IS NULL OR k.period_year=$2)
            ORDER BY k.period_year DESC, k.period_month DESC, u.full_name
        """, month, year)
    return [dict(r) for r in rows]

@router.post("/scorecard")
async def upsert_kae_scorecard(body: KaeKpiIn, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        ret_bonus = 0
        if body.client_id:
            months = await conn.fetchval("""
                SELECT COALESCE(months_served,0) FROM kae_client_retention
                WHERE tenant_id=$1 AND user_id=$2 AND client_id=$3
            """, actor.tenant_id, body.user_id, body.client_id) or 0
            ret_bonus = await conn.fetchval("SELECT kae_retention_bonus($1)", months)
        g_pct = (body.revenue_actual/body.revenue_target*100-100) if body.revenue_target>0 else 0
        g_bonus = await conn.fetchval("SELECT kae_growth_bonus($1)", g_pct)
        c_bonus = await conn.fetchval("SELECT kae_collection_bonus($1)", body.collection_actual)
        s_val   = (body.client_sat_score/20*5) if body.client_sat_score>0 else 0
        s_bonus = await conn.fetchval("SELECT kae_satisfaction_bonus($1)", s_val)
        row = await conn.fetchrow("""
            INSERT INTO kae_kpi_scores
              (tenant_id,user_id,period_month,period_year,
               revenue_target,revenue_actual,revenue_score,
               collection_target,collection_actual,collection_score,
               client_sat_score,new_pos_score,renewal_score,
               base_incentive,retention_bonus,growth_bonus,collection_bonus,satisfaction_bonus)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
            ON CONFLICT (tenant_id,user_id,period_month,period_year) DO UPDATE SET
              revenue_target=EXCLUDED.revenue_target,revenue_actual=EXCLUDED.revenue_actual,
              revenue_score=EXCLUDED.revenue_score,collection_target=EXCLUDED.collection_target,
              collection_actual=EXCLUDED.collection_actual,collection_score=EXCLUDED.collection_score,
              client_sat_score=EXCLUDED.client_sat_score,new_pos_score=EXCLUDED.new_pos_score,
              renewal_score=EXCLUDED.renewal_score,base_incentive=EXCLUDED.base_incentive,
              retention_bonus=EXCLUDED.retention_bonus,growth_bonus=EXCLUDED.growth_bonus,
              collection_bonus=EXCLUDED.collection_bonus,satisfaction_bonus=EXCLUDED.satisfaction_bonus
            RETURNING *
        """, actor.tenant_id, body.user_id, body.period_month, body.period_year,
             body.revenue_target, body.revenue_actual, body.revenue_score,
             body.collection_target, body.collection_actual, body.collection_score,
             body.client_sat_score, body.new_pos_score, body.renewal_score,
             body.base_incentive, float(ret_bonus or 0), float(g_bonus or 0),
             float(c_bonus or 0), float(s_bonus or 0))
    return dict(row)

@router.patch("/scorecard/{score_id}/status")
async def approve_kae_scorecard(score_id: str, body: KaeApproveIn, actor: Actor=Depends(get_actor)):
    if body.status not in ('approved','paid'):
        raise HTTPException(400, "status must be approved or paid")
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            UPDATE kae_kpi_scores SET status=$1,approved_by=$2,approved_at=now()
            WHERE id=$3 RETURNING *
        """, body.status, actor.user_id, score_id)
        if not row:
            raise HTTPException(404, "Not found")
        if body.status == 'approved':
            await conn.execute("""
                INSERT INTO kae_incentives
                  (tenant_id,user_id,kae_kpi_score_id,period_month,period_year,
                   base_incentive,retention_bonus,growth_bonus,collection_bonus,
                   satisfaction_bonus,total_incentive,status)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending')
                ON CONFLICT (tenant_id,user_id,period_month,period_year) DO UPDATE SET
                  total_incentive=EXCLUDED.total_incentive
            """, actor.tenant_id, row['user_id'], score_id,
                 row['period_month'], row['period_year'],
                 row['base_incentive'], row['retention_bonus'], row['growth_bonus'],
                 row['collection_bonus'], row['satisfaction_bonus'], row['total_incentive'])
    return dict(row)

@router.get("/retention")
async def list_kae_retention(user_id: Optional[str]=None, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT kr.*, u.full_name,
                   kae_retention_bonus(kr.months_served) AS current_bonus
            FROM kae_client_retention kr
            JOIN users u ON u.id=kr.user_id
            WHERE ($1::text IS NULL OR kr.user_id::text=$1)
            ORDER BY kr.months_served DESC
        """, user_id)
    return [dict(r) for r in rows]

@router.post("/retention")
async def upsert_kae_retention(body: KaeRetentionIn, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            INSERT INTO kae_client_retention
              (tenant_id,user_id,client_id,owner_since,months_served,last_checked_at)
            VALUES ($1,$2,$3,$4,$5,now())
            ON CONFLICT (tenant_id,user_id,client_id) DO UPDATE SET
              months_served=EXCLUDED.months_served, last_checked_at=now()
            RETURNING *, kae_retention_bonus(months_served) AS current_bonus
        """, actor.tenant_id, body.user_id, body.client_id, body.owner_since, body.months_served)
    return dict(row)

@router.get("/summary")
async def kae_summary(month: Optional[int]=None, year: Optional[int]=None,
                       actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        stats = await conn.fetchrow("""
            SELECT COUNT(*) AS total_scorecards, ROUND(AVG(total_score),1) AS avg_score,
                   COALESCE(SUM(total_incentive),0) AS total_incentive,
                   COALESCE(SUM(collection_actual),0) AS total_collected,
                   COALESCE(SUM(revenue_actual),0) AS total_revenue,
                   COUNT(*) FILTER (WHERE grade IN ('A+','A')) AS top_performers
            FROM kae_kpi_scores
            WHERE ($1::int IS NULL OR period_month=$1) AND ($2::int IS NULL OR period_year=$2)
        """, month, year)
        own = await conn.fetchrow("""
            SELECT COUNT(DISTINCT client_id) AS total_clients_with_kae,
                   COUNT(*) FILTER (WHERE owner_type='kae') AS total_kae_assignments
            FROM client_owners WHERE is_active
        """)
    return {**dict(stats), **dict(own)}
