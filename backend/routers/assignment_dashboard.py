"""Assignment Dashboard (2026-08-24).

Built from a two-round research pass (internal gap audit + external
industry comparison vs Bullhorn/CEIPAL/JobDiva/Vincere/Crelate patterns,
plus real staffing-ops benchmarks). Read-heavy — reuses existing tables
end to end (assignments, assignment_event, requisitions, clients, users,
submittals, client_feedback, recruiter_leave, sla_tier_config) rather
than introducing a parallel "assignment summary" table that could drift
from the real source of truth.

Scope explicitly EXCLUDES co-recruiter/secondary-assignee support — that
needs relaxing assignments_one_active_per_requisition (added 2026-08-10
to fix a real self-amplifying data-corruption bug) and was flagged in
research as needing its own separate decision, not folded in here.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
import asyncpg

import db
import events
from deps import Actor, get_actor, require_role
from permissions import require_permission
from pydantic import BaseModel
from typing import Optional

router = APIRouter(prefix="/assignment-dashboard", tags=["assignment-dashboard"])

# Roles that see every recruiter's assignments by default (matches the
# same role set already granted assign/auto-assign access on
# POST /assignments and POST /requisitions/{id}/assign). Everyone else
# is hard-scoped to their own — no query param can override this, same
# enforcement shape as job_visibility_scope elsewhere in this codebase.
_BROAD_VISIBILITY_ROLES = ("admin", "super_admin", "manager", "kae")

# Industry benchmark thresholds (research pass, 2026-08-24): 15-20 open
# reqs/recruiter is the commonly cited "healthy" range, 20-30+ is the
# documented burnout band (skipped intake meetings, shallow screening).
# Distinct from the existing RATIO-based workload_label (available/total
# capacity) — a recruiter with max_active_reqs=8 and 6 active shows the
# same ratio as one with max_active_reqs=25 and 19 active, even though
# only the second is past the industry burnout line on absolute count.
_CAPACITY_HEALTHY_MAX = 20
_CAPACITY_STRETCH_MAX = 30


def _capacity_tier(active_assignments: int) -> str:
    if active_assignments <= _CAPACITY_HEALTHY_MAX:
        return "healthy"
    if active_assignments <= _CAPACITY_STRETCH_MAX:
        return "stretch"
    return "overloaded"


def _effective_sla_hours(priority: str, client_tier: str, cfg: dict) -> int:
    hrs = {
        "critical": cfg.get("critical_hours"), "high": cfg.get("high_hours"),
        "low": cfg.get("low_hours"),
    }.get(priority, cfg.get("medium_hours")) or 168
    mult = {"strategic": 0.8, "low_touch": 1.2}.get(client_tier, 1.0)
    return round(hrs * mult)


def _visible_recruiter_id(actor: Actor, requested: Optional[str]) -> Optional[str]:
    """None means 'no filter' (see everyone) -- only ever returned for the
    broad-visibility roles. A restricted role gets their own id forced
    regardless of what they asked for."""
    if actor.role is not None and actor.role not in _BROAD_VISIBILITY_ROLES:
        return actor.user_id
    return requested


@router.get("/list")
async def list_assignments(
    client_id: Optional[str] = None,
    department: Optional[str] = None,
    recruiter_id: Optional[str] = None,
    priority: Optional[str] = None,
    status: Optional[str] = "active",
    method: Optional[str] = None,  # 'ai' | 'manual'
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    mine: bool = False,
    actor: Actor = Depends(require_permission("assignment_dashboard", "read")),
):
    eff_recruiter = actor.user_id if mine else _visible_recruiter_id(actor, recruiter_id)

    conditions = ["asg.tenant_id = $1"]
    params: list = [actor.tenant_id]
    if status:
        params.append(status); conditions.append(f"asg.status = ${len(params)}")
    if eff_recruiter:
        params.append(eff_recruiter); conditions.append(f"asg.recruiter_id = ${len(params)}")
    if client_id:
        params.append(client_id); conditions.append(f"r.client_id = ${len(params)}")
    if department:
        params.append(department); conditions.append(f"COALESCE(u.department,'Unassigned Desk') = ${len(params)}")
    if priority:
        params.append(priority); conditions.append(f"r.priority = ${len(params)}")
    if date_from:
        params.append(date_from); conditions.append(f"asg.assigned_at >= ${len(params)}::date")
    if date_to:
        params.append(date_to); conditions.append(f"asg.assigned_at < (${len(params)}::date + interval '1 day')")

    where = " AND ".join(conditions)

    async with db.tenant_conn(actor.tenant_id) as conn:
        cfg_row = await conn.fetchrow("SELECT * FROM sla_tier_config LIMIT 1")
        cfg = dict(cfg_row) if cfg_row else {}

        rows = await conn.fetch(
            f"""
            WITH latest_event AS (
              SELECT DISTINCT ON (assignment_id)
                     assignment_id, metadata->>'reason' AS reason, actor_user_id, created_at AS event_at
              FROM assignment_event
              WHERE tenant_id = $1
              ORDER BY assignment_id, created_at DESC
            ),
            sub_counts AS (
              SELECT a.assigned_recruiter_id AS recruiter_id, a.requisition_id, COUNT(DISTINCT s.id) AS submission_count
              FROM applications a
              JOIN submittals s ON s.application_id = a.id AND s.tenant_id = $1
              WHERE a.tenant_id = $1 AND a.is_active IS NOT FALSE
              GROUP BY a.assigned_recruiter_id, a.requisition_id
            )
            SELECT asg.id, asg.requisition_id, asg.recruiter_id, asg.status, asg.match_score,
                   asg.assigned_at, asg.updated_at,
                   r.title AS requisition_title, r.priority, r.positions_count, r.employment_type,
                   r.location, r.sla_hours AS req_sla_hours_override, r.created_at AS req_opened_at,
                   r.client_id, cl.name AS client_name, cl.priority_tier AS client_priority_tier,
                   u.full_name AS recruiter_name, u.email AS recruiter_email,
                   COALESCE(u.department, 'Unassigned Desk') AS department,
                   le.reason AS assign_method_raw, le.actor_user_id AS assigned_by,
                   assigner.full_name AS assigned_by_name,
                   COALESCE(sc.submission_count, 0) AS submission_count,
                   EXISTS (
                     SELECT 1 FROM recruiter_leave rl
                     WHERE rl.tenant_id = $1 AND rl.recruiter_id = asg.recruiter_id
                       AND now()::date BETWEEN rl.start_date AND rl.end_date
                   ) AS recruiter_on_leave
            FROM assignments asg
            JOIN requisitions r ON r.id = asg.requisition_id
            LEFT JOIN clients cl ON cl.id = r.client_id
            JOIN users u ON u.id = asg.recruiter_id
            LEFT JOIN latest_event le ON le.assignment_id = asg.id
            LEFT JOIN users assigner ON assigner.id = le.actor_user_id
            LEFT JOIN sub_counts sc ON sc.recruiter_id = asg.recruiter_id AND sc.requisition_id = asg.requisition_id
            WHERE {where}
            ORDER BY asg.assigned_at DESC
            LIMIT 500
            """,
            *params,
        )

    now = datetime.now(timezone.utc)
    out = []
    for r in rows:
        d = dict(r)
        eff_hours = d["req_sla_hours_override"] or _effective_sla_hours(d["priority"], d["client_priority_tier"], cfg)
        hours_open = round((now - d["req_opened_at"]).total_seconds() / 3600, 1)
        d["effective_sla_hours"] = eff_hours
        d["hours_open"] = hours_open
        d["sla_breached"] = hours_open > eff_hours
        d["hours_since_assigned"] = round((now - d["assigned_at"]).total_seconds() / 3600, 1)
        # assign_method_raw comes from assignment_event.metadata->>'reason',
        # written as literal 'auto_assigned' / 'manually_assigned' by both
        # create_assignment() and assign_with_explanation()'s callers.
        # 'auto_assigned'/'manually_assigned' from an initial assign;
        # 'auto_assigned_re'/'manually_assigned_re' from a reassignment
        # (do_reassign(), fixed 2026-08-24 to write its own event for the
        # NEW assignment row — previously had none at all, confirmed live).
        d["assign_method"] = "AI" if d.pop("assign_method_raw") in ("auto_assigned", "auto_assigned_re") else "Manual"
        if method and d["assign_method"].lower() != method.lower():
            continue
        d.pop("req_sla_hours_override", None)
        out.append(d)
    return out


@router.get("/summary")
async def summary(
    group_by: str = "recruiter",  # 'recruiter' | 'client' | 'desk'
    actor: Actor = Depends(require_permission("assignment_dashboard", "read")),
):
    if group_by not in ("recruiter", "client", "desk"):
        raise HTTPException(400, "group_by must be one of: recruiter, client, desk")

    async with db.tenant_conn(actor.tenant_id) as conn:
        cfg_row = await conn.fetchrow("SELECT * FROM sla_tier_config LIMIT 1")
        cfg = dict(cfg_row) if cfg_row else {}

        assign_rows = await conn.fetch(
            """
            SELECT asg.id, asg.recruiter_id, asg.assigned_at,
                   r.id AS requisition_id, r.title, r.priority, r.positions_count,
                   r.sla_hours AS req_sla_hours_override, r.created_at AS req_opened_at,
                   r.client_id, cl.name AS client_name, cl.priority_tier AS client_priority_tier,
                   u.full_name AS recruiter_name, COALESCE(u.department, 'Unassigned Desk') AS department,
                   le.metadata->>'reason' AS assign_reason
            FROM assignments asg
            JOIN requisitions r ON r.id = asg.requisition_id
            LEFT JOIN clients cl ON cl.id = r.client_id
            JOIN users u ON u.id = asg.recruiter_id
            LEFT JOIN LATERAL (
              SELECT metadata FROM assignment_event
              WHERE assignment_id = asg.id AND tenant_id = $1
              ORDER BY created_at DESC LIMIT 1
            ) le ON true
            WHERE asg.tenant_id = $1 AND asg.status = 'active'
            """,
            actor.tenant_id,
        )

        capacity_rows = await conn.fetch("SELECT * FROM v_recruiter_capacity WHERE tenant_id = $1", actor.tenant_id)

        # Client responsiveness (real gap surfaced by the external research
        # pass, not internal-only): time from a real submittal to the
        # client's actual feedback, both genuinely timestamped tables.
        responsiveness_rows = await conn.fetch(
            """
            SELECT r.client_id,
                   AVG(EXTRACT(EPOCH FROM (cf.created_at - s.submitted_at)) / 3600) AS avg_response_hours,
                   COUNT(*) AS responded_count
            FROM client_feedback cf
            JOIN submittals s ON s.application_id = cf.application_id AND s.tenant_id = $1
            JOIN applications a ON a.id = cf.application_id
            JOIN requisitions r ON r.id = a.requisition_id
            WHERE cf.tenant_id = $1 AND cf.created_at > s.submitted_at
            GROUP BY r.client_id
            """,
            actor.tenant_id,
        )
    resp_by_client = {str(r["client_id"]): round(r["avg_response_hours"], 1) for r in responsiveness_rows if r["client_id"]}

    now = datetime.now(timezone.utc)
    try:
        from routers.sla_predictions import forecast as _sla_forecast
        forecast_result = await _sla_forecast(actor)
        risk_by_req = {f["requisition_id"]: f["risk_level"] for f in forecast_result.get("forecasts", [])}
    except Exception:
        risk_by_req = {}

    buckets: dict = {}
    for row in assign_rows:
        d = dict(row)
        key = {
            "recruiter": str(d["recruiter_id"]),
            "desk": d["department"],
            "client": str(d["client_id"]) if d["client_id"] else "no_client",
        }[group_by]
        b = buckets.setdefault(key, {
            "key": key,
            "label": {"recruiter": d["recruiter_name"], "desk": d["department"],
                      "client": d["client_name"] or "No Client"}[group_by],
            "total_assigned": 0, "total_positions": 0, "ai_assigned": 0, "manual_assigned": 0,
            "sla_breached_count": 0, "sla_at_risk_predicted": 0,
        })
        b["total_assigned"] += 1
        b["total_positions"] += d["positions_count"] or 0
        if d["assign_reason"] in ("auto_assigned", "auto_assigned_re"):
            b["ai_assigned"] += 1
        else:
            b["manual_assigned"] += 1
        eff_hours = d["req_sla_hours_override"] or _effective_sla_hours(d["priority"], d["client_priority_tier"], cfg)
        hours_open = (now - d["req_opened_at"]).total_seconds() / 3600
        if hours_open > eff_hours:
            b["sla_breached_count"] += 1
        if risk_by_req.get(str(d["requisition_id"])) in ("at_risk", "overdue"):
            b["sla_at_risk_predicted"] += 1

    if group_by == "recruiter":
        cap_by_recruiter = {str(c["recruiter_id"]): dict(c) for c in capacity_rows}
        for key, b in buckets.items():
            cap = cap_by_recruiter.get(key, {})
            b["capacity_weekly"] = cap.get("capacity_weekly")
            b["max_active_reqs"] = cap.get("max_active_reqs")
            b["utilization_pct"] = float(cap["utilization_pct"]) if cap.get("utilization_pct") is not None else None
            b["ratio_workload_label"] = None
            if cap.get("available_capacity") is not None and cap.get("max_active_reqs"):
                ratio = cap["available_capacity"] / cap["max_active_reqs"]
                b["ratio_workload_label"] = "Low" if ratio >= 0.6 else "Medium" if ratio >= 0.3 else "High"
            b["capacity_tier"] = _capacity_tier(b["total_assigned"])
        # Include recruiters with zero current assignments too — a real
        # "0 assigned" row is a genuine, useful signal (an idle desk slot),
        # not something to silently omit.
        assigned_ids = set(buckets.keys())
        for c in capacity_rows:
            rid = str(c["recruiter_id"])
            if rid not in assigned_ids:
                buckets[rid] = {
                    "key": rid, "label": c["full_name"], "total_assigned": 0, "total_positions": 0,
                    "ai_assigned": 0, "manual_assigned": 0, "sla_breached_count": 0, "sla_at_risk_predicted": 0,
                    "capacity_weekly": c["capacity_weekly"], "max_active_reqs": c["max_active_reqs"],
                    "utilization_pct": float(c["utilization_pct"]) if c["utilization_pct"] is not None else None,
                    "ratio_workload_label": "Low", "capacity_tier": "healthy",
                }

    if group_by == "client":
        for key, b in buckets.items():
            b["avg_client_response_hours"] = resp_by_client.get(key)

    if group_by == "desk":
        recruiters_by_desk: dict = {}
        for c in capacity_rows:
            dept = "Unassigned Desk"
            recruiters_by_desk.setdefault(dept, set())
        for row in assign_rows:
            recruiters_by_desk.setdefault(row["department"], set()).add(str(row["recruiter_id"]))
        for key, b in buckets.items():
            b["recruiters_count"] = len(recruiters_by_desk.get(key, set()))

    result = sorted(buckets.values(), key=lambda x: -x["total_assigned"])
    return {"group_by": group_by, "rows": result}


@router.get("/history/{requisition_id}")
async def assignment_history(requisition_id: str, actor: Actor = Depends(require_permission("assignment_dashboard", "read"))):
    """Full chronological timeline for one requisition, spanning every
    assignments row it's ever had (reassignment creates a NEW row via
    do_reassign() — 'history' for a requisition means walking all of
    them, not just the currently-active one) plus every assignment_event
    tied to those rows. The audit trail (assignment_event) has been
    complete since P1/P3 but had zero frontend consumer until now."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        req = await conn.fetchrow(
            "SELECT id, title FROM requisitions WHERE id=$1 AND tenant_id=$2", requisition_id, actor.tenant_id
        )
        if not req:
            raise HTTPException(404, "Requisition not found")
        events_rows = await conn.fetch(
            """
            SELECT ae.id, ae.assignment_id, ae.event_type, ae.reason, ae.metadata, ae.created_at,
                   actor_u.full_name AS actor_name,
                   asg.recruiter_id, recruiter_u.full_name AS recruiter_name
            FROM assignment_event ae
            JOIN assignments asg ON asg.id = ae.assignment_id
            LEFT JOIN users actor_u ON actor_u.id = ae.actor_user_id
            LEFT JOIN users recruiter_u ON recruiter_u.id = asg.recruiter_id
            WHERE ae.tenant_id = $1 AND asg.requisition_id = $2
            ORDER BY ae.created_at ASC
            """,
            actor.tenant_id, requisition_id,
        )
    import json as _json
    out = []
    for e in events_rows:
        d = dict(e)
        meta = d.get("metadata")
        d["metadata"] = _json.loads(meta) if isinstance(meta, str) else meta
        out.append(d)
    return {"requisition_id": requisition_id, "requisition_title": req["title"], "timeline": out}


class BulkReassignBody(BaseModel):
    assignment_ids: list[str]
    new_recruiter_id: Optional[str] = None  # omit -> auto-pick per assignment via do_reassign()
    reason: Optional[str] = None


@router.post("/bulk-reassign")
async def bulk_reassign(body: BulkReassignBody, actor: Actor = Depends(require_role("admin", "manager"))):
    """Loops the existing, already-correct do_reassign() SQL function
    (writes assignment_event + audit_log + event_outbox per HARD RULE
    #5/#6, HITL-gated same as the single-assignment /reassign endpoint) —
    one failure never aborts the rest of the batch."""
    results, errors = [], []
    async with db.tenant_conn(actor.tenant_id) as conn:
        for assignment_id in body.assignment_ids:
            try:
                old = await conn.fetchrow(
                    "SELECT id, status, recruiter_id FROM assignments WHERE id=$1 AND tenant_id=$2", assignment_id, actor.tenant_id
                )
                if not old:
                    errors.append({"assignment_id": assignment_id, "error": "not found"}); continue
                if old["status"] != "active":
                    errors.append({"assignment_id": assignment_id, "error": f"not active (status={old['status']})"}); continue
                result = await conn.fetchrow(
                    "SELECT * FROM do_reassign($1, $2, $3)", assignment_id, body.reason or "Bulk reassignment", body.new_recruiter_id,
                )
                await events.write_audit(
                    conn, actor.tenant_id, actor.user_id, "reassign", "assignment", assignment_id,
                    before={"recruiter_id": str(old["recruiter_id"]), "status": "active"},
                    after={"recruiter_id": str(result["new_recruiter_id"]), "status": "reassigned", "bulk": True},
                )
                results.append({
                    "old_assignment_id": str(result["old_assignment_id"]),
                    "new_assignment_id": str(result["new_assignment_id"]),
                    "new_recruiter_name": result["new_recruiter_name"],
                })
            except asyncpg.exceptions.RaiseError as exc:
                errors.append({"assignment_id": assignment_id, "error": str(exc)})
    return {"succeeded": len(results), "failed": len(errors), "results": results, "errors": errors}


@router.get("/export.csv")
async def export_csv(
    client_id: Optional[str] = None, department: Optional[str] = None, recruiter_id: Optional[str] = None,
    priority: Optional[str] = None, status: Optional[str] = "active",
    actor: Actor = Depends(require_permission("assignment_dashboard", "export")),
):
    from routers.p28_p32 import to_csv
    rows = await list_assignments(
        client_id=client_id, department=department, recruiter_id=recruiter_id,
        priority=priority, status=status, method=None, date_from=None, date_to=None, mine=False, actor=actor,
    )
    fields = ["requisition_title", "client_name", "recruiter_name", "department", "priority",
              "positions_count", "status", "assign_method", "assigned_at", "assigned_by_name",
              "hours_since_assigned", "effective_sla_hours", "sla_breached", "submission_count",
              "recruiter_on_leave", "match_score"]
    csv_data = await to_csv(rows, fields)
    return Response(content=csv_data, media_type="text/csv",
                     headers={"Content-Disposition": "attachment; filename=assignment_dashboard.csv"})
