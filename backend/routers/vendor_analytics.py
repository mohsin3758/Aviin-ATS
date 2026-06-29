"""P22 - Recruiter & Vendor Analytics.

Vendor agency management, source attribution, per-recruiter funnel,
diversity metrics, source channel ROI. Zero-token SQL aggregations.
"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import db
from deps import Actor, get_actor

router = APIRouter(prefix="/vendor-analytics", tags=["vendor-analytics"])

class VendorIn(BaseModel):
    name: str
    contact_person: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    specialization: list = []
    empanelled_since: Optional[str] = None
    rating: Optional[float] = None
    status: str = "active"
    commission_pct: float = 0
    payment_terms: Optional[str] = None
    notes: Optional[str] = None

class AttributionIn(BaseModel):
    candidate_id: str
    vendor_id: Optional[str] = None
    source_channel: str = "direct"
    source_cost: float = 0

class AttributionOutcome(BaseModel):
    placed: bool
    placement_value: float = 0

# ── Vendors ──────────────────────────────────────────────

@router.get("/vendors")
async def list_vendors(actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT va.*,
                   COUNT(sa.id)                               AS total_cvs,
                   COUNT(sa.id) FILTER (WHERE sa.placed)      AS placements,
                   COALESCE(SUM(sa.source_cost),0)            AS total_paid,
                   COALESCE(SUM(sa.placement_value),0)        AS total_revenue,
                   ROUND(AVG(sa.roi),1)                       AS avg_roi
            FROM vendor_agencies va
            LEFT JOIN source_attribution sa ON sa.vendor_id=va.id AND sa.tenant_id=va.tenant_id
            WHERE va.tenant_id=$1
            GROUP BY va.id
            ORDER BY va.status, va.rating DESC NULLS LAST
        """, actor.tenant_id)
    return [dict(r) for r in rows]

@router.post("/vendors")
async def create_vendor(body: VendorIn, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            INSERT INTO vendor_agencies
              (tenant_id,name,contact_person,email,phone,specialization,
               empanelled_since,rating,status,commission_pct,payment_terms,notes)
            VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8,$9,$10,$11,$12)
            ON CONFLICT (tenant_id,name) DO UPDATE SET
              contact_person=EXCLUDED.contact_person,email=EXCLUDED.email,
              phone=EXCLUDED.phone,rating=EXCLUDED.rating,status=EXCLUDED.status,
              commission_pct=EXCLUDED.commission_pct
            RETURNING *
        """, actor.tenant_id, body.name, body.contact_person, body.email,
             body.phone, body.specialization, body.empanelled_since,
             body.rating, body.status, body.commission_pct, body.payment_terms, body.notes)
    return dict(row)

@router.put("/vendors/{vendor_id}")
async def update_vendor(vendor_id: str, body: VendorIn, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            UPDATE vendor_agencies SET
              name=$1,contact_person=$2,email=$3,rating=$4,status=$5,commission_pct=$6
            WHERE id=$7 RETURNING *
        """, body.name, body.contact_person, body.email,
             body.rating, body.status, body.commission_pct, vendor_id)
        if not row:
            raise HTTPException(404, "Vendor not found")
    return dict(row)

# ── Source Attribution ─────────────────────────────────

@router.get("/attribution")
async def list_attribution(actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT sa.*, ca.full_name AS candidate_name, va.name AS vendor_name
            FROM source_attribution sa
            JOIN candidates ca ON ca.id=sa.candidate_id
            LEFT JOIN vendor_agencies va ON va.id=sa.vendor_id
            WHERE sa.tenant_id=$1
            ORDER BY sa.cv_shared_at DESC
        """, actor.tenant_id)
    return [dict(r) for r in rows]

@router.post("/attribution")
async def create_attribution(body: AttributionIn, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            INSERT INTO source_attribution
              (tenant_id,candidate_id,vendor_id,source_channel,source_cost)
            VALUES ($1,$2,$3,$4,$5)
            ON CONFLICT (tenant_id,candidate_id) DO UPDATE SET
              vendor_id=EXCLUDED.vendor_id,
              source_channel=EXCLUDED.source_channel,
              source_cost=EXCLUDED.source_cost
            RETURNING *
        """, actor.tenant_id, body.candidate_id, body.vendor_id,
             body.source_channel, body.source_cost)
    return dict(row)

@router.patch("/attribution/{attr_id}/outcome")
async def record_attribution_outcome(
    attr_id: str, body: AttributionOutcome, actor: Actor=Depends(get_actor)
):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            UPDATE source_attribution SET
              placed=$1, placed_at=CASE WHEN $1 THEN now() ELSE NULL END,
              placement_value=$2,
              roi=CASE WHEN source_cost>0
                  THEN ROUND(($2-source_cost)/source_cost*100,2)
                  ELSE NULL END
            WHERE id=$3 RETURNING *
        """, body.placed, body.placement_value, attr_id)
        if not row:
            raise HTTPException(404, "Attribution not found")
    return dict(row)

# ── Analytics Views ────────────────────────────────────

@router.get("/recruiter-funnel")
async def recruiter_funnel(actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            "SELECT * FROM v_recruiter_funnel WHERE tenant_id=$1 ORDER BY placements DESC",
            actor.tenant_id)
    return [dict(r) for r in rows]

@router.get("/source-performance")
async def source_performance(actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            "SELECT * FROM v_source_performance WHERE tenant_id=$1 ORDER BY placement_rate DESC",
            actor.tenant_id)
    return [dict(r) for r in rows]

@router.get("/diversity")
async def diversity_metrics(actor: Actor=Depends(get_actor)):
    """Location diversity, source diversity, experience band distribution."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        by_location = await conn.fetch("""
            SELECT COALESCE(location,'Unknown') AS location, COUNT(*) AS count
            FROM candidates WHERE tenant_id=$1
            GROUP BY location ORDER BY count DESC LIMIT 10
        """, actor.tenant_id)
        by_source = await conn.fetch("""
            SELECT COALESCE(source,'direct') AS source, COUNT(*) AS count
            FROM candidates WHERE tenant_id=$1
            GROUP BY source ORDER BY count DESC
        """, actor.tenant_id)
        by_exp = await conn.fetch("""
            SELECT
              CASE WHEN total_exp_mo<12 THEN '0-1yr'
                   WHEN total_exp_mo<36 THEN '1-3yr'
                   WHEN total_exp_mo<60 THEN '3-5yr'
                   WHEN total_exp_mo<120 THEN '5-10yr'
                   ELSE '10yr+' END AS band,
              COUNT(*) AS count
            FROM candidates WHERE tenant_id=$1
            GROUP BY band ORDER BY band
        """, actor.tenant_id)
    return {
        "by_location": [dict(r) for r in by_location],
        "by_source":   [dict(r) for r in by_source],
        "by_exp_band": [dict(r) for r in by_exp],
    }

@router.get("/summary")
async def vendor_summary(actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        vendors = await conn.fetchrow("""
            SELECT COUNT(*) AS total_vendors,
                   COUNT(*) FILTER (WHERE status='active') AS active_vendors
            FROM vendor_agencies WHERE tenant_id=$1
        """, actor.tenant_id)
        attr = await conn.fetchrow("""
            SELECT COUNT(*) AS total_cvs,
                   COUNT(*) FILTER (WHERE placed) AS placed,
                   COALESCE(SUM(source_cost),0) AS total_spend,
                   ROUND(AVG(roi),1) AS avg_roi
            FROM source_attribution WHERE tenant_id=$1
        """, actor.tenant_id)
    return {**dict(vendors), **dict(attr)}
