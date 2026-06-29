"""Headcount Planning Module."""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import db
from deps import Actor, get_actor

router = APIRouter(prefix="/headcount", tags=["headcount"])

class HcIn(BaseModel):
    department: str
    client_name: Optional[str] = None
    fiscal_year: str
    quarter: Optional[int] = None
    planned_hires: int = 0
    planned_budget: float = 0
    skills_needed: list = []
    priority: str = "medium"
    notes: Optional[str] = None

@router.get("")
async def list_plans(fiscal_year: Optional[str]=None, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT hp.*,
                   ROUND((hp.actual_hires::numeric/NULLIF(hp.planned_hires,0))*100,1) AS hire_pct,
                   ROUND((hp.actual_spend/NULLIF(hp.planned_budget,0))*100,1) AS budget_pct
            FROM headcount_plans hp
            WHERE hp.tenant_id=$1 AND ($2::text IS NULL OR hp.fiscal_year=$2)
            ORDER BY hp.priority DESC, hp.department
        """, actor.tenant_id, fiscal_year)
    return [dict(r) for r in rows]

@router.get("/summary")
async def summary(fiscal_year: Optional[str]=None, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            SELECT COUNT(*) plans,
                   SUM(planned_hires) total_planned,
                   SUM(actual_hires) total_hired,
                   SUM(planned_budget) total_budget,
                   SUM(actual_spend) total_spend,
                   COUNT(*) FILTER (WHERE status='approved') approved,
                   COUNT(*) FILTER (WHERE priority='critical') critical_count
            FROM headcount_plans
            WHERE tenant_id=$1 AND ($2::text IS NULL OR fiscal_year=$2)
        """, actor.tenant_id, fiscal_year)
    return dict(row)

@router.post("")
async def create_plan(body: HcIn, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            INSERT INTO headcount_plans
              (tenant_id,department,client_name,fiscal_year,quarter,planned_hires,
               planned_budget,skills_needed,priority,notes)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            ON CONFLICT (tenant_id,department,fiscal_year,quarter) DO UPDATE SET
              planned_hires=EXCLUDED.planned_hires, planned_budget=EXCLUDED.planned_budget,
              priority=EXCLUDED.priority
            RETURNING *
        """, actor.tenant_id, body.department, body.client_name, body.fiscal_year,
             body.quarter, body.planned_hires, body.planned_budget,
             body.skills_needed, body.priority, body.notes)
    return dict(row)

@router.patch("/{plan_id}/actuals")
async def update_actuals(plan_id: str, actual_hires: int=0, actual_spend: float=0,
                          actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            UPDATE headcount_plans SET actual_hires=$1, actual_spend=$2,
              status=CASE WHEN $1>=planned_hires THEN 'closed' ELSE status END
            WHERE id=$3 AND tenant_id=$4 RETURNING *
        """, actual_hires, actual_spend, plan_id, actor.tenant_id)
        if not row: raise HTTPException(404,"Not found")
    return dict(row)

@router.patch("/{plan_id}/approve")
async def approve_plan(plan_id: str, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            UPDATE headcount_plans SET status='approved', approved_by=$1
            WHERE id=$2 AND tenant_id=$3 RETURNING *
        """, actor.user_id, plan_id, actor.tenant_id)
        if not row: raise HTTPException(404,"Not found")
    return dict(row)
