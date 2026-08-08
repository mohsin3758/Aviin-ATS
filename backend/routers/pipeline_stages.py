"""Configurable pipeline-stage display (Stage-Workflow Phase 2) + custom
stages (Phase 2b — sql/16_custom_stages.sql) + full stage deletion for
built-in stages (Phase 2c, 2026-08-09).

Of the 13 default stage keys, exactly three are structurally load-bearing
and can only ever be hidden, never deleted — the fixed entry point, and
the two fixed terminal states every ATS-style pipeline needs:
  - 'sourced': every application-creation INSERT across the codebase
    (applications.py, candidates.py bulk-add, resume_intake_service.py,
    p28_p32.py, ops_gaps.py — 5 separate sites) defaults new applications
    to this exact stage. Deleting it wouldn't stop those inserts, it would
    make every newly-created candidate invisible from the moment they're
    added — worse than the other cases below since it hits 100% of new
    candidates, not just those who reach one specific downstream step.
  - 'rejected': the HITL/RBAC gate in applications.py's PATCH .../stage
    checks `body.stage == "rejected"` by literal string, and deleting the
    config row would make that check pass-through-then-fail the stage-
    validity check below it, so admin/manager could never reject anyone
    again (a confusing 400, not a policy choice the tenant made on purpose).
  - 'placed': offers.py sets `stage='placed'` via a raw UPDATE on offer
    acceptance, bypassing this config entirely (Actor context isn't
    available there) — deleting the row wouldn't stop that write, it
    would just make placed candidates silently vanish from every Kanban
    board (no config row => filtered out of is_visible), which is a bug,
    not a hide.
Every other built-in stage (contacted, interested, nda, screened,
submitted, l1_interview, l2_interview, offer, offer_accepted, hold) is
deletable. Read-only analytics/SLA queries reference them by literal
stage-value string against `applications.stage` and don't care whether a
display-config row exists, so those keep working regardless. But several
*writers* auto-advance a candidate's stage as a side effect of an
unrelated action, via a raw UPDATE that bypasses applications.py's
validated PATCH .../stage entirely — NDA signing bumps to 'screened'
(nda.py), submitting to a KAE bumps to 'submitted' (kae_submission.py),
scheduling an interview bumps to 'l1_interview' (phase3.py), and issuing
an offer bumps to 'offer' (phase3.py) — plus three separate rule-engine
auto-movers (this router's /auto-move, /check-rules/{id}, and
scheduler.py's nightly run_pipeline_auto_move) that write whatever
stage_to a saved automation rule points at, which can reference a stage
that's since been deleted. Every one of those call sites now calls
is_valid_stage() first and skips the stage bump (the primary action —
NDA sign, submission, scheduling, offer, rule match — still completes)
rather than writing a candidate into a stage with no display config,
where they'd silently vanish from every Kanban board. Custom stages
tenants add themselves have never had any restriction and remain fully
deletable under the same rule.
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

# See module docstring for why exactly these three, and only these three,
# built-in stages can never be deleted (hide-only).
PROTECTED_KEYS = {"sourced", "rejected", "placed"}

FIELDS = "stage_key, label, color, display_order, is_visible, is_custom"


async def is_valid_stage(conn, tenant_id: str, stage_key: str) -> bool:
    """Shared by every stage-writing call site outside applications.py's
    own validated PATCH .../stage — same fallback-to-defaults rule: a
    brand-new tenant with zero config rows yet gets the 13 defaults for
    free, otherwise the stage must have a real, undeleted config row."""
    has_row = await conn.fetchval(
        "SELECT 1 FROM pipeline_stage_config WHERE tenant_id=$1 AND stage_key=$2",
        tenant_id, stage_key)
    if has_row:
        return True
    has_any_config = await conn.fetchval(
        "SELECT 1 FROM pipeline_stage_config WHERE tenant_id=$1 LIMIT 1", tenant_id)
    return (not has_any_config) and stage_key in DEFAULT_KEYS


def _out(rows) -> list[dict]:
    """Attach `deletable` so the frontend never has to duplicate the
    protected-key rule — same source of truth as the DELETE endpoint."""
    out = []
    for r in rows:
        d = dict(r)
        d["deletable"] = d["stage_key"] not in PROTECTED_KEYS
        out.append(d)
    return out


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
    return _out(rows)


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
    return _out(rows)


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
    return _out(rows)


@router.delete("/{stage_key}")
async def delete_stage(stage_key: str, actor: Actor = Depends(get_actor)):
    if stage_key in PROTECTED_KEYS:
        why = ("rejecting a candidate is a HITL-gated action keyed to this exact stage — "
               "deleting it would make Reject stop working entirely, not just hide it")
        if stage_key == "placed":
            why = ("offer acceptance sets this stage directly and doesn't check this config — "
                   "deleting it would make placed candidates silently disappear from the board "
                   "instead of just being hidden")
        elif stage_key == "sourced":
            why = ("every new candidate is created in this stage by default — deleting it would "
                   "make every newly-added candidate silently disappear from the board")
        raise HTTPException(400, f"'{stage_key}' can be hidden but not deleted: {why}. Use the Hide toggle instead.")
    async with db.tenant_conn(actor.tenant_id) as conn:
        in_use = await conn.fetchval(
            "SELECT COUNT(*) FROM applications WHERE tenant_id=$1 AND stage=$2",
            actor.tenant_id, stage_key)
        if in_use:
            raise HTTPException(400, f"{in_use} candidate(s) are currently in this stage — move them first")
        row = await conn.fetchrow(
            "DELETE FROM pipeline_stage_config WHERE tenant_id=$1 AND stage_key=$2 RETURNING stage_key",
            actor.tenant_id, stage_key)
        if not row:
            raise HTTPException(404, "Stage not found")
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
    return _out(rows)
