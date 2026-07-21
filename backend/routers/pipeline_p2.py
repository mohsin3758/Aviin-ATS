"""Phase 2 Pipeline: KPIs, Intelligence Bar, Stage Rules, Auto-Move, Bulk Actions, n8n webhooks."""
import json, uuid
import asyncio, logging

STAGE_EMAIL_TEMPLATES = {
    "screened": ("Application Shortlisted - AVIIN Jobs", "Dear {name},\n\nYour profile has been shortlisted. A recruiter will contact you soon.\n\nBest,\nAVIIN Jobs"),
    "submitted": ("Profile Submitted to Client - AVIIN Jobs", "Dear {name},\n\nYour profile has been submitted to the client for review. We will update you shortly.\n\nBest,\nAVIIN Jobs"),
    "interview": ("Interview Scheduled - AVIIN Jobs", "Dear {name},\n\nCongratulations! You have been selected for an interview. Check your email for interview details.\n\nBest,\nAVIIN Jobs"),
    "offer": ("Offer Letter - AVIIN Jobs", "Dear {name},\n\nWe are pleased to inform you that an offer has been prepared for you! Our team will contact you with details.\n\nBest,\nAVIIN Jobs"),
    "placed": ("Placement Confirmed - AVIIN Jobs", "Dear {name},\n\nCongratulations on your successful placement! Wishing you great success in your new role.\n\nBest,\nAVIIN Jobs"),
}

async def send_stage_email(email: str, name: str, stage: str):
    if not email or stage not in STAGE_EMAIL_TEMPLATES:
        return
    import smtplib, os
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    subject, body = STAGE_EMAIL_TEMPLATES[stage]
    body = body.format(name=name)
    try:
        msg = MIMEMultipart()
        msg["Subject"] = subject
        msg["From"] = os.environ.get("SMTP_FROM","noreply@aviinjobs.com")
        msg["To"] = email
        msg.attach(MIMEText(body,"plain"))
        with smtplib.SMTP(os.environ.get("SMTP_HOST","mailhog"), int(os.environ.get("SMTP_PORT","1025")), timeout=5) as s:
            s.sendmail(msg["From"],[email],msg.as_string())
        log.info(f"Stage email sent: {subject} -> {email}")
    except Exception as e:
        log.warning(f"Stage email failed: {e}")

from datetime import datetime
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
import db
from deps import Actor, get_actor

log = logging.getLogger(__name__)

metrics_router  = APIRouter(prefix="/pipeline", tags=["pipeline-p2"])
rules_router    = APIRouter(prefix="/pipeline-rules", tags=["pipeline-p2"])
intel_router    = APIRouter(prefix="/pipeline", tags=["pipeline-p2"])

STAGES = ["sourced","contacted","interested","nda","screened","submitted","l1_interview","l2_interview","offer","offer_accepted","placed","rejected","hold"]
N8N_WEBHOOK = "http://n8n:5678/webhook/aviin-stage-change"

# ── Models ────────────────────────────────────────────────────────────────────
class RuleCondition(BaseModel):
    field: str; op: str; value: Any

class StageRule(BaseModel):
    name: str; stage_from: str; stage_to: str
    conditions: List[RuleCondition] = []
    action: str = "move"; enabled: bool = True

class RuleUpdate(BaseModel):
    name: Optional[str]=None; enabled: Optional[bool]=None
    conditions: Optional[List[RuleCondition]]=None
    stage_from: Optional[str]=None; stage_to: Optional[str]=None

class BulkAction(BaseModel):
    application_ids: List[str]
    action: str              # "move_stage" | "reject" | "move_placed"
    target_stage: Optional[str] = None

# ── Background: n8n notify ────────────────────────────────────────────────────
async def notify_n8n(payload: dict):
    """Fire-and-forget webhook to n8n — never crashes the main flow."""
    try:
        import httpx
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(N8N_WEBHOOK, json=payload)
    except Exception as e:
        log.warning(f"n8n notify failed (non-fatal): {e}")

# ── KPI Metrics ───────────────────────────────────────────────────────────────
@metrics_router.get("/metrics")
async def get_pipeline_metrics(req_id: str = None, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        total      = await conn.fetchval("SELECT COUNT(*) FROM candidates") or 0
        if req_id:
            stage_rows = await conn.fetch(
                "SELECT stage, COUNT(*) as cnt FROM applications WHERE requisition_id=$1::uuid GROUP BY stage",
                req_id)
            total = await conn.fetchval(
                "SELECT COUNT(DISTINCT candidate_id) FROM applications WHERE requisition_id=$1::uuid",
                req_id) or 0
        else:
            stage_rows = await conn.fetch("SELECT stage, COUNT(*) as cnt FROM applications WHERE 1=1 GROUP BY stage")

        # Pre-seed from this tenant's live stage config (includes custom
        # stages), not the fixed STAGES list — same bug class fixed in
        # get_stage_analytics: any stage_key not in a hardcoded list was
        # silently dropped from by_stage even though stage_rows had the
        # real count.
        stage_keys = [r["stage_key"] for r in await conn.fetch(
            "SELECT stage_key FROM pipeline_stage_config WHERE tenant_id=$1", actor.tenant_id)]
        by_stage = {s: 0 for s in (stage_keys or STAGES)}
        for r in stage_rows:
            by_stage[r["stage"]] = int(r["cnt"])

        screened  = by_stage.get("screened",0)
        interview = by_stage.get("interview",0)
        offer     = by_stage.get("offer",0)
        placed    = by_stage.get("placed",0)
        rejected  = by_stage.get("rejected",0)

        rev = await conn.fetchval("""
            SELECT COALESCE(SUM(c.expected_ctc),0) FROM candidates c
            JOIN applications a ON a.candidate_id=c.id
            WHERE a.stage NOT IN ('placed','rejected')""") or 0

        stuck = await conn.fetchval("""
            SELECT COUNT(*) FROM applications
            WHERE stage NOT IN ('placed','rejected')
            AND updated_at < NOW() - INTERVAL '7 days'""") or 0

        upcoming = by_stage.get('interview', 0)  # matches Kanban interview column

        high_pri = await conn.fetchval("""
            SELECT COUNT(*) FROM applications
            WHERE fit_score > 0.7 AND stage NOT IN ('placed','rejected')""") or 0

        return {
            "total_candidates":    int(total),
            "by_stage":            by_stage,
            # Realistic rates: how many reached each milestone vs total pipeline
            "interview_rate": round(((interview+offer+placed+rejected) / max(sum(by_stage.values()),1)) * 100, 1),
            "offer_rate":     round(((offer+placed) / max(interview+offer+placed+rejected,1)) * 100, 1),
            "join_rate":      round((placed / max(offer+placed,1)) * 100, 1),
            "revenue_potential":   float(rev),
            "open_offers":         int(by_stage.get("offer",0)),
            "upcoming_interviews": int(upcoming),
            "stuck_candidates":    int(stuck),
            "high_priority":       int(high_pri),
            "filtered_by_req": bool(req_id),
        }

# ── Intelligence Chips ────────────────────────────────────────────────────────
@intel_router.get("/intelligence")
async def get_intelligence(req_id: str = None, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        req_filter = f"AND a.requisition_id={repr(req_id)}::uuid" if req_id else ""
        def q(cond): return f"""
            SELECT a.id, a.candidate_id, a.stage, a.fit_score,
                   c.full_name as candidate_name, c.skills, c.total_exp_mo
            FROM applications a JOIN candidates c ON c.id=a.candidate_id
            WHERE {cond} {req_filter} LIMIT 50"""

        # Strong Hire: high AI fit score (>= 0.65) in any active stage
        strong  = await conn.fetch(q("a.fit_score >= 0.65 AND a.stage NOT IN ('placed','rejected','hold')"))
        # Offer Ready: cleared L1 interview (in L2) OR cleared all rounds (stage=offer)
        offer_r = await conn.fetch(q("a.stage IN ('l2_interview','offer') AND a.stage NOT IN ('placed','rejected')"))
        # Join Ready: active offer given - likely to join
        join_r  = await conn.fetch(q("a.stage IN ('offer','offer_accepted')"))
        # Stuck: no stage movement in 7+ days (needs recruiter follow-up)
        stuck   = await conn.fetch(q("a.updated_at < NOW() - INTERVAL '7 days' AND a.stage NOT IN ('placed','rejected','hold')"))
        # At Risk: low fit score still in pipeline (might not convert)
        at_risk = await conn.fetch(q("a.fit_score < 0.40 AND a.stage NOT IN ('placed','rejected','sourced','hold')"))
        l1_int  = await conn.fetch(q("a.stage='l1_interview'"))
        l2_int  = await conn.fetch(q("a.stage='l2_interview'"))

        def fmt(rows):
            return [{"id":str(r["id"]),"candidate_id":str(r["candidate_id"]),
                     "stage":r["stage"],"candidate_name":r["candidate_name"],
                     "fit_score":float(r["fit_score"]) if r["fit_score"] else None} for r in rows]

        return {
            "strong_hire":  fmt(strong),
            "offer_ready":  fmt(offer_r),
            "join_ready":   fmt(join_r),
            "stuck":        fmt(stuck),
            "at_risk":      fmt(at_risk),
            "l1_interview":   fmt(l1_int),
            "l2_interview":   fmt(l2_int),
            "in_interview":   fmt(l1_int),
            "counts": {
                "strong_hire":  len(strong),
                "offer_ready":  len(offer_r),
                "join_ready":   len(join_r),
                "stuck":        len(stuck),
                "at_risk":      len(at_risk),
                "l1_interview":   len(l1_int),
                "l2_interview":   len(l2_int),
                "in_interview":   len(l1_int),
            }
        }

# ── Score Sync: populate fit_score from candidate_scores ─────────────────────
@metrics_router.post("/sync-scores")
async def sync_scores(actor: Actor = Depends(get_actor)):
    """Copy readiness_index from candidate_scores into applications.fit_score."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        result = await conn.execute("""
            UPDATE applications a
            SET fit_score = sub.score
            FROM (
                SELECT candidate_id, MAX(readiness_index) / 100.0 as score
                FROM candidate_scores
                WHERE readiness_index > 0
                GROUP BY candidate_id
            ) sub
            WHERE sub.candidate_id = a.candidate_id
              AND a.fit_score IS DISTINCT FROM sub.score
        """)
        updated = int(result.split()[-1]) if result else 0

        # Also trigger bulk AI scoring via intelligence service for unscored
        unscored = await conn.fetch("""
            SELECT DISTINCT a.candidate_id, a.requisition_id
            FROM applications a
            WHERE a.fit_score IS NULL
            LIMIT 50
        """)
        return {"synced": updated, "unscored_count": len(unscored)}

# ── Auto-Move Engine ──────────────────────────────────────────────────────────
def _eval(val, op, threshold):
    if val is None: return False
    try:
        v, t = float(val), float(threshold)
        return (op==">" and v>t) or (op=="<" and v<t) or (op==">=" and v>=t) or (op=="<=" and v<=t) or (op=="==" and v==t) or (op=="!=" and v!=t)
    except: return str(val)==str(threshold) if op=="==" else str(val)!=str(threshold)

@metrics_router.post("/auto-move")
async def trigger_auto_move(bg: BackgroundTasks, actor: Actor = Depends(get_actor)):
    moved = []
    errors = []
    VALID_STAGES = {"sourced","contacted","interested","nda","screened","submitted","l1_interview","l2_interview","offer","offer_accepted","placed","rejected","hold"}
    async with db.tenant_conn(actor.tenant_id) as conn:
        rules = await conn.fetch("""
            SELECT id, name, stage_from, stage_to, conditions FROM stage_rules
            WHERE enabled=TRUE AND tenant_id=$1""", actor.tenant_id)

        if not rules:
            return {"moved": 0, "detail": "No enabled rules. Create rules in the Auto Rules panel."}

        for rule in rules:
            if rule["stage_to"] not in VALID_STAGES:
                errors.append({"rule": rule["name"], "error": "invalid stage_to: " + rule["stage_to"]})
                continue
            conds = rule["conditions"] if isinstance(rule["conditions"], list) else json.loads(rule["conditions"] or "[]")
            apps = await conn.fetch("""
                SELECT a.id, a.candidate_id, a.stage, a.fit_score,
                       c.total_exp_mo, c.ai_match_score, c.expected_ctc,
                       c.notice_period_days, c.full_name, c.email, c.phone
                FROM applications a JOIN candidates c ON c.id=a.candidate_id
                WHERE a.stage=$1 AND a.tenant_id=$2""", rule["stage_from"], actor.tenant_id)

            for app in apps:
                if not all(_eval(app.get(co.get("field")), co.get("op",">"), co.get("value",0)) for co in conds):
                    continue
                try:
                    async with conn.transaction():
                        await conn.execute(
                            "UPDATE applications SET stage=$1, updated_at=NOW() WHERE id=$2",
                            rule["stage_to"], app["id"])
                        await conn.execute("""
                            INSERT INTO pipeline_movements
                              (id,tenant_id,candidate_id,application_id,stage_from,stage_to,reason,triggered_by)
                            VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,'auto_rule',$6)""",
                            actor.tenant_id, app["candidate_id"], app["id"],
                            rule["stage_from"], rule["stage_to"], "rule:" + rule["name"])
                    payload = {
                        "candidate_name": app["full_name"], "email": app["email"],
                        "phone": app["phone"], "stage_from": rule["stage_from"],
                        "stage_to": rule["stage_to"], "rule_name": rule["name"],
                        "timestamp": datetime.utcnow().isoformat()
                    }
                    bg.add_task(notify_n8n, payload)
                    asyncio.create_task(send_stage_email(app.get("email",""), app["full_name"], rule["stage_to"]))
                    moved.append({"candidate": app["full_name"], "from": rule["stage_from"], "to": rule["stage_to"]})
                except Exception as _e:
                    errors.append({"candidate": app["full_name"], "rule": rule["name"], "error": str(_e)[:80]})

    return {"moved": len(moved), "details": moved, "errors": errors, "n8n_notified": len(moved)}

# ── Bulk Actions ──────────────────────────────────────────────────────────────
@metrics_router.post("/bulk-action")
async def bulk_action(action: BulkAction, bg: BackgroundTasks, actor: Actor = Depends(get_actor)):
    if not action.application_ids:
        raise HTTPException(400, "No application IDs provided")

    results = {"success": 0, "failed": 0, "details": []}

    async with db.tenant_conn(actor.tenant_id) as conn:
        for app_id in action.application_ids:
            try:
                # Verify ownership
                app = await conn.fetchrow("""
                    SELECT a.id, a.stage, a.candidate_id, c.full_name, c.email, c.phone
                    FROM applications a JOIN candidates c ON c.id=a.candidate_id
                    WHERE a.id=$1 AND a.tenant_id=$2""", app_id, actor.tenant_id)
                if not app:
                    results["failed"] += 1; continue

                if action.action == "move_stage" and action.target_stage:
                    old_stage = app["stage"]
                    await conn.execute("UPDATE applications SET stage=$1, updated_at=NOW() WHERE id=$2",
                                       action.target_stage, app_id)
                    await conn.execute("""
                        INSERT INTO pipeline_movements (id,tenant_id,candidate_id,application_id,stage_from,stage_to,reason,triggered_by)
                        VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,'bulk_action','user')""",
                        actor.tenant_id, app["candidate_id"], app_id, old_stage, action.target_stage)
                    payload = {"candidate_name":app["full_name"],"email":app["email"],"phone":app["phone"],
                               "stage_from":old_stage,"stage_to":action.target_stage,
                               "rule_name":"bulk_action","timestamp":datetime.utcnow().isoformat()}
                    bg.add_task(notify_n8n, payload)

                elif action.action == "reject":
                    old_stage = app["stage"]
                    await conn.execute("UPDATE applications SET stage='rejected', updated_at=NOW() WHERE id=$1", app_id)
                    await conn.execute("""
                        INSERT INTO pipeline_movements (id,tenant_id,candidate_id,application_id,stage_from,stage_to,reason,triggered_by)
                        VALUES (gen_random_uuid(),$1,$2,$3,$4,'rejected','bulk_reject','user')""",
                        actor.tenant_id, app["candidate_id"], app_id, old_stage)

                results["success"] += 1
                results["details"].append({"name": app["full_name"], "status": "ok"})
            except Exception as e:
                results["failed"] += 1
                results["details"].append({"id": app_id, "error": str(e)})

    return results

# ── Filters: available skills and sources ────────────────────────────────────
@intel_router.get("/filter-options")
async def get_filter_options(actor: Actor = Depends(get_actor)):
    """Return distinct sources and skill list for filter UI."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        sources = await conn.fetch("SELECT DISTINCT source FROM candidates WHERE source IS NOT NULL ORDER BY source")
        # Get top skills from all candidates
        skills_raw = await conn.fetch("SELECT skills FROM candidates WHERE skills IS NOT NULL AND cardinality(skills)>0 LIMIT 500")
        skill_set = set()
        for row in skills_raw:
            if row["skills"]:
                for sk in row["skills"]:
                    skill_set.add(sk.strip())
        return {
            "sources": [r["source"] for r in sources],
            "skills":  sorted(list(skill_set))[:100],
            "stages":  STAGES,
        }

# ── Pipeline Audit Log ────────────────────────────────────────────────────────
@metrics_router.get("/audit")
async def get_audit(actor: Actor = Depends(get_actor), limit: int = 50):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT pm.*, c.full_name as candidate_name
            FROM pipeline_movements pm
            JOIN candidates c ON c.id=pm.candidate_id
            ORDER BY pm.created_at DESC LIMIT $1""", limit)
        return [{"id":str(r["id"]),"candidate":r["candidate_name"],
                 "from":r["stage_from"],"to":r["stage_to"],
                 "reason":r["reason"],"by":r["triggered_by"],
                 "at":r["created_at"].isoformat() if r["created_at"] else None} for r in rows]

# ── Rules CRUD ────────────────────────────────────────────────────────────────
@rules_router.get("")
async def list_rules(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("SELECT * FROM stage_rules ORDER BY created_at DESC")
        return [{"id":str(r["id"]),"name":r["name"],"stage_from":r["stage_from"],
                 "stage_to":r["stage_to"],"conditions":r["conditions"],
                 "action":r["action"],"enabled":r["enabled"]} for r in rows]

@rules_router.post("")
async def create_rule(rule: StageRule, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rid = str(uuid.uuid4())
        await conn.execute("""INSERT INTO stage_rules (id,tenant_id,name,stage_from,stage_to,conditions,action,enabled)
            VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)""",
            rid, actor.tenant_id, rule.name, rule.stage_from, rule.stage_to,
            json.dumps([c.dict() for c in rule.conditions]), rule.action, rule.enabled)
        return {"id": rid, **rule.dict()}

@rules_router.put("/{rule_id}")
async def update_rule(rule_id: str, upd: RuleUpdate, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        fields, vals, i = [], [], 1
        if upd.name is not None: fields.append(f"name=${i}"); vals.append(upd.name); i+=1
        if upd.enabled is not None: fields.append(f"enabled=${i}"); vals.append(upd.enabled); i+=1
        if upd.stage_from is not None: fields.append(f"stage_from=${i}"); vals.append(upd.stage_from); i+=1
        if upd.stage_to is not None: fields.append(f"stage_to=${i}"); vals.append(upd.stage_to); i+=1
        if upd.conditions is not None:
            fields.append(f"conditions=${i}::jsonb")
            vals.append(json.dumps([c.dict() for c in upd.conditions])); i+=1
        if not fields: raise HTTPException(400, "Nothing to update")
        vals += [rule_id, actor.tenant_id]
        await conn.execute(f"UPDATE stage_rules SET {', '.join(fields)} WHERE id=${i} AND tenant_id=${i+1}", *vals)
        return {"ok": True}

@rules_router.delete("/{rule_id}")
async def delete_rule(rule_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute("DELETE FROM stage_rules WHERE id=$1 AND tenant_id=$2", rule_id, actor.tenant_id)
        return {"ok": True}

# ── Stage Analytics (Round 2) ────────────────────────────────────────────────
SLA_DAYS = {"sourced":2,"contacted":2,"interested":2,"nda":1,"screened":3,"submitted":3,"l1_interview":5,"l2_interview":5,"offer":3,"offer_accepted":3,"placed":999,"rejected":999,"hold":999,"interview":7}

@metrics_router.get("/stage-analytics")
async def get_stage_analytics(req_id: str = None, actor: Actor = Depends(get_actor)):
    """Per-stage: count, avg days, stale, conversion rate, SLA status."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        if req_id:
            rows = await conn.fetch("""
                SELECT stage, COUNT(*) as count,
                    AVG(EXTRACT(EPOCH FROM (NOW()-updated_at))/86400)::numeric(6,1) as avg_days_in_stage,
                    COUNT(*) FILTER (WHERE updated_at < NOW() - INTERVAL '7 days') as stale_count
                FROM applications WHERE requisition_id=$1::uuid GROUP BY stage
            """, req_id)
        else:
            rows = await conn.fetch("""
                SELECT stage, COUNT(*) as count,
                    AVG(EXTRACT(EPOCH FROM (NOW()-updated_at))/86400)::numeric(6,1) as avg_days_in_stage,
                    COUNT(*) FILTER (WHERE updated_at < NOW() - INTERVAL '7 days') as stale_count
                FROM applications GROUP BY stage
            """)

        velocity = {r["stage"]: dict(r) for r in rows}

        # Conversion rates: how many moved FROM this stage to next
        if req_id:
            moved = await conn.fetch("""
                SELECT pm.stage_from, pm.stage_to, COUNT(*) as cnt
                FROM pipeline_movements pm
                JOIN applications a ON a.id=pm.application_id
                WHERE pm.tenant_id = $1 AND a.requisition_id=$2::uuid
                GROUP BY pm.stage_from, pm.stage_to
            """, actor.tenant_id, req_id)
        else:
            moved = await conn.fetch("""
                SELECT stage_from, stage_to, COUNT(*) as cnt
                FROM pipeline_movements
                WHERE tenant_id = $1
                GROUP BY stage_from, stage_to
            """, actor.tenant_id)

        moves_from: dict = {}
        for m in moved:
            sf = m["stage_from"]
            moves_from.setdefault(sf, 0)
            moves_from[sf] += int(m["cnt"])

        # Stage order/label/color from this tenant's live config (includes
        # any custom stages) instead of the fixed 13-value STAGES list, which
        # was silently dropping l1_interview/l2_interview/nda/contacted/
        # interested/offer_accepted/hold/custom stages from this response.
        stage_cfg_rows = await conn.fetch(
            "SELECT stage_key, label, color FROM pipeline_stage_config "
            "WHERE tenant_id=$1 AND is_visible=TRUE ORDER BY display_order", actor.tenant_id)
        stage_cfg = [(r["stage_key"], r["label"], r["color"]) for r in stage_cfg_rows]
        if not stage_cfg:
            stage_cfg = [(st, st.replace("_", " ").title(), "#64748b") for st in STAGES]

        # Total entered each stage = current + moved out
        result = []
        for st, label, color in stage_cfg:
            v = velocity.get(st, {})
            count = int(v.get("count", 0))
            avg_days = float(v.get("avg_days_in_stage", 0) or 0)
            stale = int(v.get("stale_count", 0) or 0)
            out = moves_from.get(st, 0)
            total_entered = count + out
            conv_rate = round((out / total_entered * 100) if total_entered > 0 else 0, 1)
            sla_limit = SLA_DAYS.get(st, 7)
            sla_status = "ok" if avg_days <= sla_limit else ("warn" if avg_days <= sla_limit * 1.5 else "breach")
            result.append({
                "stage": st,
                "label": label,
                "color": color,
                "count": count,
                "avg_days": round(avg_days, 1),
                "stale_count": stale,
                "conversion_rate": conv_rate,
                "sla_limit_days": sla_limit,
                "sla_status": sla_status,
                "moved_out": out,
            })
        return result

# ── Enriched Pipeline (Round 2 — Card V3) ────────────────────────────────────
@metrics_router.get("/enriched/{requisition_id}")
async def get_enriched_pipeline(requisition_id: str, actor: Actor = Depends(get_actor)):
    """Return pipeline grouped by stage with full candidate data (V3 card)."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        apps = await conn.fetch("""
            SELECT
                a.id, a.candidate_id, a.stage, a.fit_score, a.assigned_recruiter_id,
                a.created_at as applied_at, a.updated_at,
                c.full_name as candidate_name, c.email, c.phone,
                c.skills, c.total_exp_mo, c.current_employer, c.location,
                c.source, c.expected_ctc, c.current_ctc, c.notice_period_days,
                c.ai_match_score, c.color_indicator,
                cs.readiness_index, cs.readiness_grade,
                cs.skill_match_score, cs.experience_score,
                u.full_name as recruiter_name
            FROM applications a
            JOIN candidates c ON c.id = a.candidate_id
            LEFT JOIN candidate_scores cs
                ON cs.candidate_id = a.candidate_id
                AND cs.requisition_id = a.requisition_id
                AND cs.tenant_id = a.tenant_id
            LEFT JOIN users u ON u.id = a.assigned_recruiter_id
            WHERE a.requisition_id = $1
            ORDER BY a.fit_score DESC NULLS LAST, a.updated_at DESC
        """, requisition_id)

        result: dict = {s: [] for s in STAGES}
        for app in apps:
            stage = app["stage"] if app["stage"] in STAGES else "sourced"
            fit = float(app["fit_score"]) if app["fit_score"] else None
            readiness = float(app["readiness_index"]) if app["readiness_index"] else None
            score = fit or (readiness / 100.0 if readiness else None)

            # Color indicator: green/yellow/red
            if score and score >= 0.70:
                color = "green"
            elif score and score >= 0.40:
                color = "yellow"
            elif score:
                color = "red"
            else:
                color = "grey"

            days_in_stage = 0
            if app["updated_at"]:
                from datetime import datetime, timezone
                now = datetime.now(timezone.utc)
                updated = app["updated_at"]
                if updated.tzinfo is None:
                    updated = updated.replace(tzinfo=timezone.utc)
                days_in_stage = (now - updated).days

            result[stage].append({
                "id": str(app["id"]),
                "candidate_id": str(app["candidate_id"]),
                "candidate_name": app["candidate_name"],
                "email": app["email"],
                "phone": app["phone"],
                "skills": list(app["skills"] or []),
                "total_exp_mo": int(app["total_exp_mo"] or 0),
                "current_employer": app["current_employer"],
                "location": app["location"],
                "source": app["source"],
                "expected_ctc": float(app["expected_ctc"]) if app["expected_ctc"] else None,
                "current_ctc": float(app["current_ctc"]) if app["current_ctc"] else None,
                "notice_period_days": int(app["notice_period_days"]) if app["notice_period_days"] else None,
                "fit_score": float(app["fit_score"]) if app["fit_score"] else None,
                "readiness_index": float(app["readiness_index"]) if app["readiness_index"] else None,
                "readiness_grade": app["readiness_grade"],
                "skill_match_score": float(app["skill_match_score"]) if app["skill_match_score"] else None,
                "ai_match_score": float(app["ai_match_score"]) if app["ai_match_score"] else None,
                "color_indicator": color,
                "recruiter_name": app["recruiter_name"],
                "days_in_stage": days_in_stage,
                "stage": stage,
            })
        return result

# ── Recruiter Copilot (Round 3) ───────────────────────────────────────────────
@intel_router.get("/copilot")
async def get_copilot(actor: Actor = Depends(get_actor)):
    """Daily recruiter priorities: submit today, follow up, at risk, upcoming interviews."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        # Submit today: screened candidates with high scores not yet submitted
        submit = await conn.fetch("""
            SELECT a.id, a.candidate_id, a.stage, a.fit_score, a.updated_at,
                   c.full_name, c.email, c.phone, c.total_exp_mo, c.current_employer, c.expected_ctc
            FROM applications a JOIN candidates c ON c.id=a.candidate_id
            WHERE a.stage IN ('screened')
            ORDER BY a.fit_score DESC NULLS LAST, a.updated_at ASC LIMIT 10
        """)

        # Follow up needed: active candidates idle > 3 days
        followup = await conn.fetch("""
            SELECT a.id, a.candidate_id, a.stage, a.fit_score, a.updated_at,
                   c.full_name, c.email, c.phone, c.total_exp_mo, c.current_employer,
                   EXTRACT(EPOCH FROM (NOW()-a.updated_at))/86400 as idle_days
            FROM applications a JOIN candidates c ON c.id=a.candidate_id
            WHERE a.stage NOT IN ('placed','rejected')
            AND a.updated_at < NOW() - INTERVAL '3 days'
            ORDER BY a.updated_at ASC LIMIT 10
        """)

        # At risk: low scores in late stages
        at_risk = await conn.fetch("""
            SELECT a.id, a.candidate_id, a.stage, a.fit_score, a.updated_at,
                   c.full_name, c.email, c.phone, c.total_exp_mo, c.current_employer
            FROM applications a JOIN candidates c ON c.id=a.candidate_id
            WHERE a.stage IN ('submitted','interview','offer')
            AND (a.fit_score < 0.40 OR a.updated_at < NOW() - INTERVAL '5 days')
            ORDER BY a.fit_score ASC NULLS FIRST LIMIT 10
        """)

        # Upcoming: in interview stage recently updated
        upcoming = await conn.fetch("""
            SELECT a.id, a.candidate_id, a.stage, a.fit_score, a.updated_at,
                   c.full_name, c.email, c.phone, c.total_exp_mo, c.current_employer
            FROM applications a JOIN candidates c ON c.id=a.candidate_id
            WHERE a.stage = 'interview'
            ORDER BY a.updated_at DESC LIMIT 8
        """)

        # Open offers
        offers = await conn.fetch("""
            SELECT a.id, a.candidate_id, a.stage, a.fit_score, a.updated_at,
                   c.full_name, c.email, c.phone, c.total_exp_mo, c.current_employer,
                   EXTRACT(EPOCH FROM (NOW()-a.updated_at))/86400 as offer_age_days
            FROM applications a JOIN candidates c ON c.id=a.candidate_id
            WHERE a.stage = 'offer'
            ORDER BY a.updated_at ASC LIMIT 8
        """)

        def fmt(rows, extra_field=None):
            result = []
            for r in rows:
                d = {
                    "id": str(r["id"]),
                    "candidate_id": str(r["candidate_id"]),
                    "name": r["full_name"],
                    "email": r["email"],
                    "phone": r["phone"],
                    "stage": r["stage"],
                    "fit_score": float(r["fit_score"]) if r["fit_score"] else None,
                    "exp_mo": int(r["total_exp_mo"] or 0),
                    "company": r["current_employer"],
                    "expected_ctc": float(r["expected_ctc"]) if r.get("expected_ctc") else None,
                }
                if extra_field and extra_field in r.keys():
                    d[extra_field] = float(r[extra_field]) if r[extra_field] else 0
                result.append(d)
            return result

        return {
            "submit_today":       fmt(submit),
            "follow_up":          fmt(followup, "idle_days"),
            "at_risk":            fmt(at_risk),
            "upcoming_interviews":fmt(upcoming),
            "open_offers":        fmt(offers, "offer_age_days"),
            "summary": {
                "submit_count":    len(submit),
                "followup_count":  len(followup),
                "at_risk_count":   len(at_risk),
                "interview_count": len(upcoming),
                "offer_count":     len(offers),
            }
        }

# ── AI Insights (Round 3 — uses candidate_scores + Ollama) ───────────────────
@intel_router.get("/insights/{candidate_id}")
async def get_ai_insights(candidate_id: str, requisition_id: Optional[str]=None, actor: Actor = Depends(get_actor)):
    """Explainable AI scores + Ollama-generated recommendation."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        # Get scores
        scores = await conn.fetchrow("""
            SELECT cs.*, c.full_name, c.skills, c.total_exp_mo, c.expected_ctc,
                   c.notice_period_days, c.current_employer, c.source
            FROM candidate_scores cs
            JOIN candidates c ON c.id = cs.candidate_id
            WHERE cs.candidate_id = $1
            """ + ("AND cs.requisition_id = $2" if requisition_id else "") + """
            ORDER BY cs.scored_at DESC LIMIT 1
        """, *([candidate_id, requisition_id] if requisition_id else [candidate_id]))

        if not scores:
            # Return basic info without scores
            cand = await conn.fetchrow("SELECT full_name, skills, total_exp_mo FROM candidates WHERE id=$1", candidate_id)
            return {"has_scores": False, "candidate_name": cand["full_name"] if cand else "Unknown"}

        # Build breakdown
        skill_details = scores["skill_match_details"] or {}
        cosine = float(skill_details.get("cosine_similarity", 0)) if isinstance(skill_details, dict) else 0

        score_map = {
            "Skill Match": float(scores["skill_match_score"] or 0),
            "Experience": float(scores["experience_score"] or 0),
            "Stability": float(scores["stability_score"] or 0),
            "Education": float(scores["education_score"] or 0),
            "Salary Fit": float(scores["compensation_fit_score"] or 0),
            "Fraud Risk": float(scores["fraud_risk_score"] or 0),
        }
        readiness = float(scores["readiness_index"] or 0)
        grade = scores["readiness_grade"] or "?"
        exp_mo = int(scores["total_exp_mo"] or 0)
        exp_y = round(exp_mo / 12, 1)
        ctc = scores["expected_ctc"]

        # Rule-based recommendation (Tier 0)
        if readiness >= 80: rec = "Strong Hire"
        elif readiness >= 60: rec = "Hire"
        elif readiness >= 40: rec = "Hold — needs further review"
        else: rec = "Reject"

        # Rule-based explanation (Tier 0 — no LLM needed for core text)
        explanations = []
        if score_map["Skill Match"] < 30:
            explanations.append("Low skill match — resume keywords differ from JD requirements")
        elif score_map["Skill Match"] > 70:
            explanations.append("Strong skill alignment with job requirements")
        if score_map["Experience"] > 80:
            explanations.append(f"Experience well-matched ({exp_y}y)")
        elif score_map["Experience"] < 40:
            explanations.append(f"Experience gap detected ({exp_y}y for this role)")
        if score_map["Stability"] > 80:
            explanations.append("Stable career trajectory — low attrition risk")
        elif score_map["Stability"] < 40:
            explanations.append("Frequent job changes — potential retention concern")
        if score_map["Fraud Risk"] > 50:
            explanations.append("Fraud risk flag — verify credentials")
        if ctc:
            explanations.append(f"Expected CTC: ₹{ctc/100000:.1f}L")

        # Ollama LLM explanation (Tier 2 — optional, non-blocking)
        llm_summary = None
        try:
            import httpx, json as _json
            prompt = f"""You are a recruitment AI. Summarize this candidate in 2 sentences for a recruiter.
Candidate: {scores['full_name']}, {exp_y}y exp at {scores['current_employer'] or 'N/A'}.
Readiness: {readiness:.0f}% (Grade {grade}). Skill match: {score_map['Skill Match']:.0f}%. Recommendation: {rec}.
Be concise and helpful. Focus on hire/no-hire reasoning."""
            async with httpx.AsyncClient(timeout=8.0) as client:
                resp = await client.post("http://ollama:11434/api/generate",
                    json={"model":"qwen2.5:1.5b-instruct-q4_K_M","prompt":prompt,"stream":False})
                if resp.status_code == 200:
                    llm_summary = resp.json().get("response","").strip()[:300]
        except Exception:
            pass  # Graceful degradation

        return {
            "has_scores": True,
            "candidate_name": scores["full_name"],
            "readiness_index": readiness,
            "readiness_grade": grade,
            "recommendation": rec,
            "score_breakdown": score_map,
            "cosine_similarity": cosine,
            "explanations": explanations,
            "llm_summary": llm_summary,
            "candidate_info": {
                "skills": list(scores["skills"] or []),
                "exp_years": exp_y,
                "company": scores["current_employer"],
                "expected_ctc": float(ctc) if ctc else None,
                "notice_days": scores["notice_period_days"],
                "source": scores["source"],
            }
        }

# ── Post-move Rule Check (Round 3 — auto-trigger after manual move) ───────────
@metrics_router.post("/check-rules/{application_id}")
async def check_rules_for_application(application_id: str, bg: BackgroundTasks, actor: Actor = Depends(get_actor)):
    """After a manual move: check if any rules apply to the new stage and auto-move if matched."""
    moved = []
    async with db.tenant_conn(actor.tenant_id) as conn:
        # Get current state of this application
        app = await conn.fetchrow("""
            SELECT a.id, a.stage, a.candidate_id, a.fit_score,
                   c.total_exp_mo, c.ai_match_score, c.expected_ctc,
                   c.notice_period_days, c.full_name, c.email, c.phone
            FROM applications a JOIN candidates c ON c.id=a.candidate_id
            WHERE a.id=$1 AND a.tenant_id=$2
        """, application_id, actor.tenant_id)

        if not app:
            return {"moved": 0, "stage": None}

        # Find rules where stage_from = current stage
        rules = await conn.fetch("""
            SELECT id, name, stage_from, stage_to, conditions FROM stage_rules
            WHERE enabled=TRUE AND stage_from=$1 AND tenant_id=$2
        """, app["stage"], actor.tenant_id)

        for rule in rules:
            conds = rule["conditions"] if isinstance(rule["conditions"], list) else json.loads(rule["conditions"] or "[]")
            if all(_eval(app.get(co.get("field")), co.get("op",">"), co.get("value",0)) for co in conds):
                # Rule matches — auto-move
                await conn.execute("UPDATE applications SET stage=$1, updated_at=NOW() WHERE id=$2", rule["stage_to"], app["id"])
                await conn.execute("""
                    INSERT INTO pipeline_movements (id,tenant_id,candidate_id,application_id,stage_from,stage_to,reason,triggered_by)
                    VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,'post_move_rule',$6)
                """, actor.tenant_id, app["candidate_id"], app["id"], app["stage"], rule["stage_to"], f"rule:{rule['name']}")
                payload = {
                    "candidate_name": app["full_name"], "email": app["email"], "phone": app["phone"],
                    "stage_from": app["stage"], "stage_to": rule["stage_to"],
                    "rule_name": rule["name"], "timestamp": datetime.utcnow().isoformat()
                }
                bg.add_task(notify_n8n, payload)
                moved.append({"candidate": app["full_name"], "from": app["stage"], "to": rule["stage_to"], "rule": rule["name"]})
                break  # One rule at a time

    return {"moved": len(moved), "details": moved, "current_stage": app["stage"] if app else None}


# ── Active Requisitions sorted by application count ───────────────────────────
@metrics_router.get("/active-requisitions")
async def get_active_requisitions(actor: Actor = Depends(get_actor)):
    """Return requisitions sorted by application count - most active first."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT r.id, r.title,
                   COALESCE(r.location, '') as location,
                   COALESCE(r.status, 'open') as status,
                   COUNT(a.id) as app_count
            FROM requisitions r
            LEFT JOIN applications a ON a.requisition_id=r.id
            WHERE r.tenant_id = $1
            GROUP BY r.id, r.title, r.location, r.status
            HAVING COUNT(a.id) > 0
            ORDER BY app_count DESC, r.created_at DESC
            LIMIT 20
        """, actor.tenant_id)
        return [{"id":str(r["id"]),"title":r["title"],
                 "location":r["location"],"status":r["status"],
                 "app_count":int(r["app_count"])} for r in rows]

# ── Per-requisition stage counts (bulk, for job cards) ────────────────────────
@metrics_router.get("/req-stage-counts")
async def req_stage_counts(actor: Actor = Depends(get_actor)):
    """Return stage breakdown for every open requisition in one query."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT
                r.id::text AS req_id,
                COUNT(a.id)                                                         AS total,
                COUNT(a.id) FILTER (WHERE a.stage = 'sourced')              AS sourced,
                COUNT(a.id) FILTER (WHERE a.stage = 'contacted')            AS contacted,
                COUNT(a.id) FILTER (WHERE a.stage = 'interested')           AS interested,
                COUNT(a.id) FILTER (WHERE a.stage = 'nda')                  AS nda,
                COUNT(a.id) FILTER (WHERE a.stage = 'screened')             AS screened,
                COUNT(a.id) FILTER (WHERE a.stage = 'submitted')            AS submitted,
                COUNT(a.id) FILTER (WHERE a.stage IN ('l1_interview','l2_interview')) AS interview,
                COUNT(a.id) FILTER (WHERE a.stage = 'contacted')            AS contacted,
                COUNT(a.id) FILTER (WHERE a.stage = 'interested')           AS interested,
                COUNT(a.id) FILTER (WHERE a.stage = 'nda')                  AS nda,
                COUNT(a.id) FILTER (WHERE a.stage = 'submitted')            AS submitted,
                COUNT(a.id) FILTER (WHERE a.stage = 'hold')                 AS on_hold,
                COUNT(a.id) FILTER (WHERE a.stage IN ('offer','offer_accepted'))      AS offer,
                COUNT(a.id) FILTER (WHERE a.stage = 'placed')               AS placed,
                COUNT(a.id) FILTER (WHERE a.stage = 'rejected')             AS rejected,
                (SELECT COUNT(*) FROM candidates c
                 WHERE c.matched_requisition_id = r.id
                   AND c.tenant_id = r.tenant_id)                          AS inbox_count
            FROM requisitions r
            LEFT JOIN applications a ON a.requisition_id = r.id
            WHERE r.tenant_id = $1 AND r.status = 'open'
            GROUP BY r.id
        """, actor.tenant_id)
        return {
            r["req_id"]: {
                "total":     int(r["total"]),
                "sourced":   int(r["sourced"]),
                "contacted": int(r["contacted"]),
                "interested":int(r["interested"]),
                "nda":       int(r["nda"]),
                "screened":  int(r["screened"]),
                "submitted": int(r["submitted"]),
                "contacted": int(r["contacted"]),
                "interested":int(r["interested"]),
                "nda":       int(r["nda"]),
                "submitted": int(r["submitted"]),
                "on_hold":   int(r["on_hold"]),
                "interview": int(r["interview"]),
                "offer":     int(r["offer"]),
                "placed":    int(r["placed"]),
                "rejected":  int(r["rejected"]),
                "inbox_count": int(r["inbox_count"]),
            }
            for r in rows
        }
