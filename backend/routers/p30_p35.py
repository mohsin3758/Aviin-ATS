"""P30-P35: n8n Automations, Candidate Tags, Question Bank, Duplicates."""
import json
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
import httpx
import db
from deps import Actor, get_actor

N8N_BASE = "http://n8n:5678"

# ── P30: n8n Automation Workflows ────────────────────────────
automation_router = APIRouter(prefix="/automations", tags=["automations"])

async def fire_webhook(path: str, payload: dict, tenant_id: str):
    """Fire n8n webhook and log execution."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(f"{N8N_BASE}/webhook/{path}", json=payload)
        success = r.status_code < 400
    except Exception as e:
        success = False
    async with db.system_conn() as conn:
        await conn.execute("""
            UPDATE automation_workflows
               SET last_fired_at=now(), fire_count=fire_count+1
             WHERE webhook_path=$1 AND tenant_id=$2
        """, path, tenant_id)

@automation_router.get("")
async def list_automations(actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            "SELECT * FROM automation_workflows WHERE tenant_id=$1 ORDER BY name",
            actor.tenant_id)
    return [dict(r) for r in rows]

@automation_router.post("/trigger/{webhook_path}")
async def trigger_automation(webhook_path: str, payload: dict,
                              background_tasks: BackgroundTasks,
                              actor: Actor=Depends(get_actor)):
    """Manually trigger a webhook (for testing)."""
    background_tasks.add_task(fire_webhook, webhook_path, payload, actor.tenant_id)
    return {"triggered": webhook_path, "payload": payload}

@automation_router.patch("/{automation_id}/toggle")
async def toggle_automation(automation_id: str, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            UPDATE automation_workflows SET is_active = NOT is_active
            WHERE id=$1 AND tenant_id=$2 RETURNING *
        """, automation_id, actor.tenant_id)
        if not row: raise HTTPException(404,"Not found")
    return dict(row)

@automation_router.get("/summary")
async def automation_summary(actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            SELECT COUNT(*) AS total,
                   COUNT(*) FILTER (WHERE is_active) AS active,
                   SUM(fire_count) AS total_fires,
                   MAX(last_fired_at) AS last_fired
            FROM automation_workflows WHERE tenant_id=$1
        """, actor.tenant_id)
    return dict(row)

# ── P33: Candidate Tags ───────────────────────────────────────
tags_router = APIRouter(prefix="/candidate-tags", tags=["candidate-tags"])

@tags_router.get("")
async def list_tags(actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT ct.*, COUNT(ctm.candidate_id) AS usage_count
            FROM candidate_tags ct
            LEFT JOIN candidate_tag_map ctm ON ctm.tag_id=ct.id
            WHERE ct.tenant_id=$1
            GROUP BY ct.id ORDER BY ct.name
        """, actor.tenant_id)
    return [dict(r) for r in rows]

@tags_router.post("")
async def create_tag(body: dict, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            INSERT INTO candidate_tags (tenant_id,name,color)
            VALUES ($1,$2,$3)
            ON CONFLICT (tenant_id,name) DO UPDATE SET color=EXCLUDED.color
            RETURNING *
        """, actor.tenant_id, body['name'], body.get('color','#3B82F6'))
    return dict(row)

@tags_router.post("/assign")
async def assign_tags(candidate_id: str, tag_ids: List[str],
                       actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        for tag_id in tag_ids:
            await conn.execute("""
                INSERT INTO candidate_tag_map (candidate_id,tag_id,tagged_by)
                VALUES ($1,$2,$3) ON CONFLICT DO NOTHING
            """, candidate_id, tag_id, actor.user_id)
    return {"assigned": len(tag_ids)}

@tags_router.delete("/remove")
async def remove_tag(candidate_id: str, tag_id: str, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute(
            "DELETE FROM candidate_tag_map WHERE candidate_id=$1 AND tag_id=$2",
            candidate_id, tag_id)
    return {"removed": True}

@tags_router.get("/candidate/{candidate_id}")
async def candidate_tags(candidate_id: str, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT ct.* FROM candidate_tags ct
            JOIN candidate_tag_map ctm ON ctm.tag_id=ct.id
            WHERE ctm.candidate_id=$1 AND ct.tenant_id=$2
        """, candidate_id, actor.tenant_id)
    return [dict(r) for r in rows]

# ── P34: Question Bank ────────────────────────────────────────
qbank_router = APIRouter(prefix="/question-bank", tags=["question-bank"])

@qbank_router.get("")
async def list_questions(category: Optional[str]=None, role_type: Optional[str]=None,
                          difficulty: Optional[str]=None, search: Optional[str]=None,
                          actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT id, category, role_type, difficulty, question, tags, usage_count, is_system
            FROM question_bank
            WHERE (tenant_id=$1 OR tenant_id IS NULL) AND is_active
              AND ($2::text IS NULL OR category=$2)
              AND ($3::text IS NULL OR role_type ILIKE '%'||$3||'%')
              AND ($4::text IS NULL OR difficulty=$4)
              AND ($5::text IS NULL OR question ILIKE '%'||$5||'%')
            ORDER BY usage_count DESC, difficulty, question
        """, actor.tenant_id, category, role_type, difficulty, search)
    return [dict(r) for r in rows]

@qbank_router.get("/{q_id}")
async def get_question(q_id: str, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("SELECT * FROM question_bank WHERE id=$1", q_id)
        if not row: raise HTTPException(404,"Not found")
        await conn.execute(
            "UPDATE question_bank SET usage_count=usage_count+1 WHERE id=$1", q_id)
    return dict(row)

@qbank_router.post("")
async def add_question(body: dict, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            INSERT INTO question_bank
              (tenant_id,category,role_type,difficulty,question,expected_answer,tags)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
            RETURNING *
        """, actor.tenant_id, body['category'], body.get('role_type'),
             body.get('difficulty','medium'), body['question'],
             body.get('expected_answer'), body.get('tags',[]))
    return dict(row)

@qbank_router.get("/generate/{requisition_id}")
async def generate_question_set(requisition_id: str, count: int=10,
                                  actor: Actor=Depends(get_actor)):
    """Auto-generate interview question set from requisition skills (zero-token)."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        req = await conn.fetchrow(
            "SELECT title, skills_required FROM requisitions WHERE id=$1 AND tenant_id=$2",
            requisition_id, actor.tenant_id)
        if not req: raise HTTPException(404,"Requisition not found")
        # Match questions to skills
        rows = await conn.fetch("""
            SELECT id, category, difficulty, question, tags
            FROM question_bank
            WHERE (tenant_id=$1 OR tenant_id IS NULL) AND is_active
              AND (
                tags && $2::text[]
                OR role_type ILIKE '%'||$3||'%'
                OR category='hr'
              )
            ORDER BY
              CASE WHEN category='tech' THEN 0
                   WHEN category='domain' THEN 1
                   WHEN category='hr' THEN 2
                   ELSE 3 END,
              usage_count DESC
            LIMIT $4
        """, actor.tenant_id, req['skills_required'][:5],
             req['title'].split()[0], count)
    return {
        "requisition": req['title'],
        "skills": req['skills_required'],
        "questions": [dict(r) for r in rows],
        "count": len(rows)
    }

# ── P35: Duplicate Detection ──────────────────────────────────
dup_router = APIRouter(prefix="/duplicates", tags=["duplicates"])

@dup_router.post("/scan")
async def scan_duplicates(background_tasks: BackgroundTasks,
                           actor: Actor=Depends(get_actor)):
    """Scan all candidates for duplicates by email and phone."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        # Email duplicates
        email_dups = await conn.fetch("""
            SELECT c1.id AS id1, c2.id AS id2, 'email' AS field
            FROM candidates c1
            JOIN candidates c2 ON c1.email=c2.email
              AND c1.id < c2.id AND c2.tenant_id=c1.tenant_id
            WHERE c1.tenant_id=$1 AND c1.email IS NOT NULL
              AND c1.is_active IS NOT FALSE AND c2.is_active IS NOT FALSE
        """, actor.tenant_id)
        # Phone duplicates
        phone_dups = await conn.fetch("""
            SELECT c1.id AS id1, c2.id AS id2, 'phone' AS field
            FROM candidates c1
            JOIN candidates c2 ON c1.phone=c2.phone
              AND c1.id < c2.id AND c2.tenant_id=c1.tenant_id
            WHERE c1.tenant_id=$1 AND c1.phone IS NOT NULL AND c1.phone != ''
              AND c1.is_active IS NOT FALSE AND c2.is_active IS NOT FALSE
        """, actor.tenant_id)
        # Insert into log
        count = 0
        for row in list(email_dups) + list(phone_dups):
            try:
                await conn.execute("""
                    INSERT INTO duplicate_candidates
                      (tenant_id,candidate_id_1,candidate_id_2,match_field)
                    VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING
                """, actor.tenant_id, row['id1'], row['id2'], row['field'])
                count += 1
            except Exception as e:
                print(f"[duplicates/scan] insert failed for {row['id1']}/{row['id2']}: {e}")
    return {"duplicates_found": count, "status": "scan_complete"}

@dup_router.get("")
async def list_duplicates(status: Optional[str]='pending', actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT dc.*, c1.full_name AS name1, c1.email AS email1,
                   c2.full_name AS name2, c2.email AS email2
            FROM duplicate_candidates dc
            JOIN candidates c1 ON c1.id=dc.candidate_id_1
            JOIN candidates c2 ON c2.id=dc.candidate_id_2
            WHERE dc.tenant_id=$1 AND ($2::text IS NULL OR dc.status=$2)
            ORDER BY dc.detected_at DESC
        """, actor.tenant_id, status)
    return [dict(r) for r in rows]

@dup_router.patch("/{dup_id}/dismiss")
async def dismiss_duplicate(dup_id: str, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            UPDATE duplicate_candidates SET status='dismissed', resolved_at=now(),
              resolved_by=$1 WHERE id=$2 AND tenant_id=$3 RETURNING *
        """, actor.user_id, dup_id, actor.tenant_id)
        if not row: raise HTTPException(404,"Not found")
    return dict(row)

@dup_router.patch("/{dup_id}/merge")
async def merge_duplicate(dup_id: str, actor: Actor=Depends(get_actor)):
    """Keep candidate_id_1, transfer candidate_id_2's applications, deactivate it."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        dup = await conn.fetchrow(
            "SELECT candidate_id_1, candidate_id_2 FROM duplicate_candidates WHERE id=$1 AND tenant_id=$2",
            dup_id, actor.tenant_id)
        if not dup: raise HTTPException(404, "Not found")
        keep_id, discard_id = dup["candidate_id_1"], dup["candidate_id_2"]
        await conn.execute("""
            UPDATE applications SET candidate_id=$1
            WHERE candidate_id=$2 AND tenant_id=$3
              AND requisition_id NOT IN (
                  SELECT requisition_id FROM applications WHERE candidate_id=$1)
        """, keep_id, discard_id, actor.tenant_id)
        await conn.execute(
            "UPDATE candidates SET is_active=false WHERE id=$1 AND tenant_id=$2",
            discard_id, actor.tenant_id)
        row = await conn.fetchrow("""
            UPDATE duplicate_candidates SET status='merged', resolved_at=now(),
              resolved_by=$1 WHERE id=$2 AND tenant_id=$3 RETURNING *
        """, actor.user_id, dup_id, actor.tenant_id)
    return dict(row)
