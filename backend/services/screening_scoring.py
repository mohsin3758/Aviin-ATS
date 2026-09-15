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


async def _start_followups(conn, tenant_id: str, session, recommendation: str) -> str:
    """WhatsApp automation research (2026-09-15), gaps #6 and #2/#3:
    a 'reject' outcome gets one shot at a genuine cross-requisition offer
    first (only relevant for a staffing agency running many concurrent
    client reqs against one shared candidate pool); everyone who finishes
    screening -- qualified or not -- gets the referral ask afterward,
    then a closing CSAT question. followup_stage drives this as its own
    small state machine layered on top of status='completed', which
    score_and_advance already set above and does NOT reopen -- the
    dashboard/funnel keep seeing a clean 'completed', and the real
    business action (recruiter notification, stage advance) already fired
    before any of this, not gated behind a candidate answering these
    courtesy follow-ups."""
    from services.screening_i18n import t
    from services.screening_matching import find_open_requisition_match

    lang = session.get("language") or "en"
    if recommendation == "reject":
        match = await find_open_requisition_match(conn, tenant_id, str(session["candidate_id"]))
        if match:
            await conn.execute(
                "UPDATE screening_sessions SET followup_stage='cross_match_offered', "
                "cross_match_requisition_id=$1, updated_at=now() WHERE id=$2",
                match["id"], session["id"])
            return t("cross_match_offer", lang, role=match["title"] or "this role",
                      client=match["client_name"] or "our client")

    await conn.execute(
        "UPDATE screening_sessions SET followup_stage='referral_asked', updated_at=now() WHERE id=$1",
        session["id"])
    return t("referral_ask", lang)


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


async def _summarize_transcript(conn, tenant_id: str, session_id: str) -> str | None:
    """WhatsApp automation research (2026-09-15), gap: a recruiter opening
    a completed screening today only sees the raw Q&A list -- reading all
    of it before a callback is the real friction Humanly.io's auto-
    generated notes solve. One local-Qwen call, once, at completion --
    never recomputed per dashboard page view. Best-effort: a summarization
    failure must never break the real scoring/notification path above it."""
    import ai_router

    answers = await conn.fetch(
        """SELECT question_text, raw_answer FROM screening_answers
           WHERE screening_session_id=$1 AND extraction_method NOT IN ('faq','correction_flagged')
           ORDER BY created_at""",
        session_id)
    if not answers:
        return None
    transcript = "\n".join(f"Q: {a['question_text']}\nA: {a['raw_answer']}" for a in answers if a["raw_answer"])
    if not transcript.strip():
        return None
    prompt = (
        "Summarize this WhatsApp candidate screening Q&A in 2-3 short sentences for a recruiter who hasn't "
        "read the transcript yet -- experience, key skills/tools mentioned, and CTC/notice period if given. "
        "Plain prose, no bullet points, no preamble.\n\n" + transcript[:4000]
    )
    try:
        result = await ai_router.generate(conn, tenant_id, f"screening_summary:{session_id}", prompt)
        return (result.get("text") or "").strip()[:800] or None
    except Exception:
        return None


async def score_and_advance(conn, tenant_id: str, session) -> dict:
    from routers.candidates import verify_candidate_skills

    actor = Actor(tenant_id=tenant_id, role=None)
    verification = await verify_candidate_skills(
        candidate_id=str(session["candidate_id"]), requisition_id=str(session["requisition_id"]), actor=actor)
    recommendation = verification.get("shortlist", {}).get("recommendation", "reject")

    summary = await _summarize_transcript(conn, tenant_id, str(session["id"]))
    await conn.execute(
        "UPDATE screening_sessions SET recommendation=$1, status='completed', transcript_summary=$2, updated_at=now() WHERE id=$3",
        recommendation, summary, session["id"])

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

    verification["followup_message"] = await _start_followups(conn, tenant_id, session, recommendation)
    return verification
