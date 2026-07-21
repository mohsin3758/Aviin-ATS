"""Configurable pipeline-stage display (Stage-Workflow Phase 2) + custom
stages (Phase 2b — sql/16_custom_stages.sql).

The original 13 stage keys stay permanent (relabel/recolor/reorder/hide
only — 'rejected' is the HITL/RBAC gate in applications.py, 'placed' is set
on offer acceptance in offers.py, and analytics/SLA dashboards filter on
the known set). Tenants can additionally ADD new custom stages: safe
because a new stage_key just doesn't participate in those specific
literal-string code paths — it behaves as a plain extra board column.
"""

import re

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
DEFAULT_KEYS = {d[0] for d in DEFAULTS}

FIELDS = "stage_key, label, color, display_order, is_visible, is_custom"


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
    async with db.tenant_conn(actor.tenant_id) as conn:
        existing = await conn.fetch(
            "SELECT stage_key FROM pipeline_stage_config WHERE tenant_id=$1", actor.tenant_id)
        known_keys = {r["stage_key"] for r in existing} | DEFAULT_KEYS
        unknown = {s.stage_key for s in body.stages} - known_keys
        if unknown:
            raise HTTPException(400, f"Unknown stage_key(s): {sorted(unknown)}. Add new stages via "
                                      f"POST /settings/pipeline-stages first, or check for a typo.")
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


class AddStageRequest(BaseModel):
    label: str
    color: str = "#6366F1"


def _slugify(label: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", label.strip().lower()).strip("_")
    slug = re.sub(r"_+", "_", slug)[:35] or "stage"
    if not slug[0].isalpha():
        slug = "s_" + slug
    return slug


@router.post("")
async def add_custom_stage(body: AddStageRequest, actor: Actor = Depends(get_actor)):
    label = body.label.strip()
    if not label:
        raise HTTPException(400, "Label is required")
    async with db.tenant_conn(actor.tenant_id) as conn:
        existing_keys = {r["stage_key"] for r in await conn.fetch(
            "SELECT stage_key FROM pipeline_stage_config WHERE tenant_id=$1", actor.tenant_id)}
        base_slug = _slugify(label)
        slug = base_slug
        n = 2
        while slug in existing_keys or slug in DEFAULT_KEYS:
            slug = f"{base_slug}_{n}"
            n += 1

        max_order = await conn.fetchval(
            "SELECT COALESCE(MAX(display_order), 0) FROM pipeline_stage_config WHERE tenant_id=$1",
            actor.tenant_id)

        await conn.execute(
            """INSERT INTO pipeline_stage_config
                 (tenant_id, stage_key, label, color, display_order, is_visible, is_custom)
               VALUES ($1,$2,$3,$4,$5,TRUE,TRUE)""",
            actor.tenant_id, slug, label, body.color, (max_order or 0) + 1,
        )
        rows = await conn.fetch(
            f"SELECT {FIELDS} FROM pipeline_stage_config WHERE tenant_id=$1 ORDER BY display_order",
            actor.tenant_id,
        )
    return [dict(r) for r in rows]


@router.delete("/{stage_key}")
async def delete_custom_stage(stage_key: str, actor: Actor = Depends(get_actor)):
    if stage_key in DEFAULT_KEYS:
        raise HTTPException(400, "The 13 built-in stages can be hidden but not deleted")
    async with db.tenant_conn(actor.tenant_id) as conn:
        in_use = await conn.fetchval(
            "SELECT COUNT(*) FROM applications WHERE tenant_id=$1 AND stage=$2",
            actor.tenant_id, stage_key)
        if in_use:
            raise HTTPException(400, f"{in_use} candidate(s) are currently in this stage — move them first")
        row = await conn.fetchrow(
            "DELETE FROM pipeline_stage_config WHERE tenant_id=$1 AND stage_key=$2 AND is_custom=TRUE RETURNING stage_key",
            actor.tenant_id, stage_key)
        if not row:
            raise HTTPException(404, "Custom stage not found")
    return {"deleted": stage_key}


@router.post("/reset")
async def reset_stage_config(actor: Actor = Depends(get_actor)):
    """Restore factory defaults (label/color/order/visibility only) — does not remove custom stages."""
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
