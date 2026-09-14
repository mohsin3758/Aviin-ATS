"""WhatsApp Screening Blueprint, Milestone 3-4 (Phase 6-7): scoring reuses
the existing Skill Verification rule engine unchanged (Rules 1-4) plus
the new Rule 5 (CTC/notice fit, added directly to shortlist_rules.py and
its one existing caller in routers/candidates.py), then recruiter
handoff on a 'shortlist' recommendation.

verify_candidate_skills (routers/candidates.py) is a FastAPI route
function, not a separate importable service -- called directly here with
a role=None "trusted automation" Actor (deps.py's own established
pattern for n8n/scheduler-style callers, per permissions.py's
require_permission docstring) rather than reimplementing its
verification-dict assembly a second time.

Only a 'shortlist' recommendation advances applications.stage (decision
in the blueprint's Phase 6 section: moving a candidate FORWARD is not the
high-stakes action Hard Rule #9 protects against -- only rejection stays
human-only). A 'reject' recommendation is tagged for a recruiter to
review, never auto-actioned.
"""
from deps import Actor


async def _advance_stage(conn, tenant_id: str, application_id, current_stage: str) -> str | None:
    """Never hardcode a pipeline stage key -- read the tenant's real,
    customizable pipeline_stage_config ordering (same caution this
    codebase already documents for every other stage-advance path)."""
    next_stage = await conn.fetchval(
        """SELECT stage_key FROM pipeline_stage_config
           WHERE tenant_id=$1 AND is_visible
             AND display_order > (
               SELECT display_order FROM pipeline_stage_config WHERE tenant_id=$1 AND stage_key=$2)
           ORDER BY display_order ASC LIMIT 1""",
        tenant_id, current_stage)
    if next_stage:
        await conn.execute(
            "UPDATE applications SET stage=$1, updated_at=now() WHERE id=$2", next_stage, application_id)
    return next_stage


async def score_and_advance(conn, tenant_id: str, session) -> dict:
    from routers.candidates import verify_candidate_skills

    actor = Actor(tenant_id=tenant_id, role=None)
    verification = await verify_candidate_skills(
        candidate_id=str(session["candidate_id"]), requisition_id=str(session["requisition_id"]), actor=actor)
    recommendation = verification.get("shortlist", {}).get("recommendation", "reject")

    await conn.execute(
        "UPDATE screening_sessions SET recommendation=$1, status='completed', updated_at=now() WHERE id=$2",
        recommendation, session["id"])

    if recommendation == "shortlist":
        app_row = await conn.fetchrow(
            "SELECT id, stage, assigned_recruiter_id FROM applications WHERE id=$1", session["application_id"])
        if app_row:
            await _advance_stage(conn, tenant_id, app_row["id"], app_row["stage"])
            recipient = app_row["assigned_recruiter_id"] or session["created_by"]
            if recipient:
                # Common notifications column shape used across this
                # codebase's 15+ real call sites (assignment_notify.py,
                # applications.py, ...) -- see sql/133's backfill note.
                await conn.execute(
                    """INSERT INTO notifications
                         (tenant_id, user_id, recipient_user_id, title, body, type, resource, resource_id, channel)
                       VALUES ($1,$2,$2,$3,$4,'success','application',$5,'inapp')""",
                    tenant_id, recipient, "Candidate qualified via WhatsApp screening",
                    f"A candidate completed WhatsApp screening and was recommended for shortlist — reasons: "
                    f"{'; '.join(verification['shortlist']['reasons'])}",
                    app_row["id"])
                await conn.execute(
                    """INSERT INTO recruiter_tasks
                         (tenant_id, requisition_id, application_id, candidate_name, recruiter_id,
                          task_type, title, priority)
                       VALUES ($1,$2,$3,$4,$5,'callback_request',$6,'high')""",
                    tenant_id, session["requisition_id"], app_row["id"], verification["candidate_name"],
                    recipient, f"{verification['candidate_name']} qualified via WhatsApp screening — send interview invite")

    return verification
