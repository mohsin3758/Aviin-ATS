"""Per-stage WhatsApp message templates (Stage-Workflow Phase 3).

Mirrors email_settings.py's notification_mode/stage_templates pattern.
Actual sending (WAHA + consent gate) lives in whatsapp.py / the
_stage_change_whatsapp() helper called from applications.py.
"""

import json

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional

import db
from deps import Actor, get_actor

router = APIRouter(prefix="/settings/whatsapp", tags=["whatsapp-settings"])


class WhatsAppSettingsBody(BaseModel):
    notification_mode: Optional[str] = "manual"  # 'auto' or 'manual'
    stage_templates: Optional[dict] = None        # {stage: {message}}


@router.get("")
async def get_settings(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT notification_mode, stage_templates FROM whatsapp_settings WHERE tenant_id=$1",
            actor.tenant_id)
    if not row:
        return {"notification_mode": "manual", "stage_templates": {}}
    d = dict(row)
    if isinstance(d.get("stage_templates"), str):
        d["stage_templates"] = json.loads(d["stage_templates"] or "{}")
    if d.get("stage_templates") is None:
        d["stage_templates"] = {}
    return d


@router.put("")
async def save_settings(body: WhatsAppSettingsBody, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute(
            """INSERT INTO whatsapp_settings (tenant_id, notification_mode, stage_templates, updated_at)
               VALUES ($1, $2, $3::jsonb, now())
               ON CONFLICT (tenant_id) DO UPDATE SET
                 notification_mode = COALESCE($2, whatsapp_settings.notification_mode),
                 stage_templates = COALESCE($3::jsonb, whatsapp_settings.stage_templates),
                 updated_at = now()""",
            actor.tenant_id, body.notification_mode,
            json.dumps(body.stage_templates) if body.stage_templates is not None else None,
        )
    return {"success": True, "message": "WhatsApp stage settings saved"}
