"""Configurable pipeline-stage display (Stage-Workflow Phase 2).

Scope: label / color / board position / visibility only. The 13 underlying
stage_key values are fixed (see sql/13_pipeline_stage_config.sql for why —
they're load-bearing in the applications.stage CHECK constraint, the HITL
reject gate, the offer-acceptance auto-transition, and revenue/SLA reporting
across analytics.py/requisitions.py/recruiter_dashboard.py/pipeline_p2.py).
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import db
from deps import Actor, get_actor

router = APIRouter(prefix="/settings/pipeline-stages", tags=["pipeline-stages"])

DEFAULTS = [
    ("sourced",        "Sourced",        "#6366F1", 1),
    ("contacted",      "Contacted",      "#06B6D4", 2),
    ("interested",     "Interested",     "#3B82F6", 3),
    ("nda",            "NDA",            "#F59E0B", 4),
    ("screened",       "Screened",       "#0891B2", 5),
    ("submitted",      "Submitted",      "#64748B", 6),
    ("l1_interview",   "L1 Interview",   "#7C3AED", 7),
    ("l2_interview",   "L2 Interview",   "#9333EA", 8),
    ("offer",          "Offer",          "#CA8A04", 9),
    ("offer_accepted", "Offer Accepted", "#059669", 10),
    ("placed",         "Placed ✓",  "#16A34A", 11),
    ("hold",           "On Hold",        "#94A3B8", 12),
    ("rejected",       "Rejected",       "#DC2626", 13),
]
VALID_KEYS = {d[0] for d in DEFAULTS}

FIELDS = "stage_key, label, color, display_order, is_visible"


@router.get("")
async def get_stage_config(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            f"SELECT {FIELDS} FROM pipeline_stage_config WHERE tenant_id=$1 ORDER BY display_order",
            actor.tenant_id,
        )
        if not rows:
            for key, label, color, order in DEFAULTS:
                await conn.execute(
                    """INSERT INTO pipeline_stage_config
                         (tenant_id, stage_key, label, color, display_order, is_visible)
                       VALUES ($1,$2,$3,$4,$5,TRUE)
                       ON CONFLICT (tenant_id, stage_key) DO NOTHING""",
                    actor.tenant_id, key, label, color, order,
                )
            rows = await conn.fetch(
                f"SELECT {FIELDS} FROM pipeline_stage_config WHERE tenant_id=$1 ORDER BY display_order",
                actor.tenant_id,
            )
    return [dict(r) for r in rows]


class StageConfigRow(BaseModel):
    stage_key: str
    label: str
    color: str
    display_order: int
    is_visible: bool = True


class StageConfigUpdate(BaseModel):
    stages: list[StageConfigRow]


@router.put("")
async def save_stage_config(body: StageConfigUpdate, actor: Actor = Depends(get_actor)):
    unknown = {s.stage_key for s in body.stages} - VALID_KEYS
    if unknown:
        raise HTTPException(400, f"Unknown stage_key(s): {sorted(unknown)}. Stage keys are fixed — only "
                                  f"label/color/order/visibility are configurable.")
    async with db.tenant_conn(actor.tenant_id) as conn:
        for s in body.stages:
            await conn.execute(
                """INSERT INTO pipeline_stage_config
                     (tenant_id, stage_key, label, color, display_order, is_visible, updated_at)
                   VALUES ($1,$2,$3,$4,$5,$6,now())
                   ON CONFLICT (tenant_id, stage_key) DO UPDATE SET
                     label=EXCLUDED.label, color=EXCLUDED.color,
                     display_order=EXCLUDED.display_order, is_visible=EXCLUDED.is_visible,
                     updated_at=now()""",
                actor.tenant_id, s.stage_key, s.label, s.color, s.display_order, s.is_visible,
            )
        rows = await conn.fetch(
            f"SELECT {FIELDS} FROM pipeline_stage_config WHERE tenant_id=$1 ORDER BY display_order",
            actor.tenant_id,
        )
    return [dict(r) for r in rows]


@router.post("/reset")
async def reset_stage_config(actor: Actor = Depends(get_actor)):
    """Restore factory defaults (label/color/order/visibility only)."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        for key, label, color, order in DEFAULTS:
            await conn.execute(
                """INSERT INTO pipeline_stage_config
                     (tenant_id, stage_key, label, color, display_order, is_visible, updated_at)
                   VALUES ($1,$2,$3,$4,$5,TRUE,now())
                   ON CONFLICT (tenant_id, stage_key) DO UPDATE SET
                     label=EXCLUDED.label, color=EXCLUDED.color,
                     display_order=EXCLUDED.display_order, is_visible=TRUE, updated_at=now()""",
                actor.tenant_id, key, label, color, order,
            )
        rows = await conn.fetch(
            f"SELECT {FIELDS} FROM pipeline_stage_config WHERE tenant_id=$1 ORDER BY display_order",
            actor.tenant_id,
        )
    return [dict(r) for r in rows]
