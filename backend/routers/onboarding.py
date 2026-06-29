"""Employee Onboarding Module."""
import json
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import db
from deps import Actor, get_actor


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

router = APIRouter(prefix="/onboarding", tags=["onboarding"])

class OnboardIn(BaseModel):
    candidate_id: str
    placement_id: Optional[str] = None
    template_id: Optional[str] = None
    client_name: Optional[str] = None
    joining_date: Optional[str] = None
    hr_spoc: Optional[str] = None
    hr_phone: Optional[str] = None
    notes: Optional[str] = None

class TaskUpdate(BaseModel):
    task_id: int
    completed: bool
    notes: Optional[str] = None

@router.get("/templates")
async def list_templates(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            "SELECT * FROM onboarding_templates WHERE tenant_id=$1 AND is_active ORDER BY name",
            actor.tenant_id)
    return [dict(r) for r in rows]

@router.post("")
async def create_onboarding(body: OnboardIn, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        # Get template tasks
        tasks = []
        total = 0
        if body.template_id:
            tpl = await conn.fetchrow(
                "SELECT tasks FROM onboarding_templates WHERE id=$1 AND tenant_id=$2",
                body.template_id, actor.tenant_id)
            if tpl:
                raw = tpl["tasks"]
                tasks = [{"completed": False, "completed_at": None, "notes": "", **t}
                         for t in (raw if isinstance(raw, list) else json.loads(raw))]
                total = len(tasks)
        row = await conn.fetchrow("""
            INSERT INTO candidate_onboarding
              (tenant_id,candidate_id,placement_id,template_id,client_name,
               joining_date,hr_spoc,hr_phone,notes,tasks,total_count,status)
            VALUES ($1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10::jsonb,$11,'not_started')
            ON CONFLICT DO NOTHING RETURNING *
        """, actor.tenant_id, body.candidate_id, body.placement_id, body.template_id,
             body.client_name, _to_date(body.joining_date), body.hr_spoc, body.hr_phone,
             body.notes, json.dumps(tasks), total)
    return dict(row) if row else {"error": "already exists"}

@router.get("")
async def list_onboarding(status: Optional[str] = None, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT co.*, c.full_name AS candidate_name, c.email AS candidate_email,
                   c.phone AS candidate_phone
            FROM candidate_onboarding co
            JOIN candidates c ON c.id=co.candidate_id
            WHERE co.tenant_id=$1 AND ($2::text IS NULL OR co.status=$2)
            ORDER BY co.joining_date ASC NULLS LAST, co.created_at DESC
        """, actor.tenant_id, status)
    return [dict(r) for r in rows]

@router.get("/{onboard_id}")
async def get_onboarding(onboard_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            SELECT co.*, c.full_name cn, c.email ce, c.phone cp
            FROM candidate_onboarding co
            JOIN candidates c ON c.id=co.candidate_id
            WHERE co.id=$1 AND co.tenant_id=$2
        """, onboard_id, actor.tenant_id)
        if not row: raise HTTPException(404, "Not found")
    return dict(row)

@router.patch("/{onboard_id}/task")
async def update_task(onboard_id: str, body: TaskUpdate, actor: Actor = Depends(get_actor)):
    """Mark a task complete/incomplete."""
    from datetime import datetime
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT tasks, total_count FROM candidate_onboarding WHERE id=$1 AND tenant_id=$2",
            onboard_id, actor.tenant_id)
        if not row: raise HTTPException(404, "Not found")
        tasks = row["tasks"] if isinstance(row["tasks"], list) else json.loads(row["tasks"])
        for t in tasks:
            if t.get("id") == body.task_id:
                t["completed"] = body.completed
                t["completed_at"] = datetime.utcnow().isoformat() if body.completed else None
                if body.notes: t["notes"] = body.notes
        done = sum(1 for t in tasks if t.get("completed"))
        total = row["total_count"] or len(tasks)
        status = ("completed" if done == total and total > 0
                  else "in_progress" if done > 0 else "not_started")
        updated = await conn.fetchrow("""
            UPDATE candidate_onboarding SET tasks=$1::jsonb, completed_count=$2,
              status=$3, updated_at=now() WHERE id=$4 RETURNING *
        """, json.dumps(tasks), done, status, onboard_id)
    return dict(updated)

@router.get("/summary/stats")
async def onboarding_stats(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            SELECT COUNT(*) total,
                   COUNT(*) FILTER (WHERE status='completed') completed,
                   COUNT(*) FILTER (WHERE status='in_progress') in_progress,
                   COUNT(*) FILTER (WHERE status='not_started') not_started,
                   COUNT(*) FILTER (WHERE joining_date <= CURRENT_DATE+7) joining_soon
            FROM candidate_onboarding WHERE tenant_id=$1
        """, actor.tenant_id)
    return dict(row)
