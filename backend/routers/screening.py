"""WhatsApp Screening Blueprint, Milestone 1 (Phases 0-2): quick-add/dedup,
enroll & throttle, opt-in & consent. See
C:\\Users\\mohsi\\.claude\\plans\\breezy-sprouting-island.md for the full
implementation plan this router was built from.

Stops at consent: a session reaching 'awaiting_screening' is as far as
this milestone goes. Milestone 2 wires Phase 3 (the skill-question loop)
onto that same status transition inside whatsapp_bot.py.
"""
from datetime import date as _date
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator

import db
import events
from deps import Actor
from permissions import require_permission
from routers.whatsapp_bot import check_number_exists
from schemas import _validate_phone
from services import activity_events, source_attribution
from services import candidate_ownership as ownership
from services.dedup_service import check_duplicate

router = APIRouter(prefix="/screening", tags=["screening"])

_BROAD_VISIBILITY_ROLES = ("admin", "super_admin", "manager", "kae", "kam")

TERMINAL_STATUSES = ("declined", "opted_out", "no_response", "bad_number", "completed")


class ScreeningEnrollRow(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    candidate_id: Optional[str] = None  # bulk-select entry point: reuse this candidate directly

    _validate_phone_ = field_validator("phone", mode="before")(_validate_phone)


class ScreeningEnrollRequest(BaseModel):
    requisition_id: str
    enrolled_via: Literal["quick_add", "csv_import", "bulk_select"]
    rows: list[ScreeningEnrollRow]
    language: str = "en"


async def _default_add_stage(conn, tenant_id: str) -> str:
    return await conn.fetchval(
        "SELECT stage_key FROM pipeline_stage_config WHERE tenant_id=$1 AND is_default_add AND is_visible",
        tenant_id) or "sourced"


async def enroll_candidate_for_screening(conn, tenant_id: str, candidate_id: str, requisition_id: str,
                                          enrolled_via: str, default_stage: str,
                                          whatsapp_account_id: Optional[str], created_by: Optional[str],
                                          language: str = "en") -> dict:
    """The shared tail end of enrollment (create the applications row +
    screening_sessions row) once a candidate_id is already known — the one
    place all 3 entry points (quick-add, CSV/Excel import, bulk-select)
    converge, per decision #27. Callers own dedup/candidate-creation
    themselves first, since that differs per entry point (see _enroll_row
    below for quick-add/bulk-select; import_router.py for CSV/Excel)."""
    active_session = await conn.fetchval(
        f"""SELECT id FROM screening_sessions WHERE candidate_id=$1
            AND status NOT IN ({",".join(f"'{s}'" for s in TERMINAL_STATUSES)})""",
        candidate_id)
    if active_session:
        return {"status": "skipped", "detail": "Already has an active screening session",
                "candidate_id": str(candidate_id), "session_id": str(active_session)}

    # Confirmed live (2026-09-14): despite sql/01_phase1_schema.sql
    # declaring UNIQUE(tenant_id, requisition_id, candidate_id), no such
    # constraint actually exists on the production applications table --
    # only FKs, the PK, and the stage CHECK do (pg_constraint checked
    # directly). ON CONFLICT against it fails outright. Matching the same
    # explicit check-then-insert pattern candidates.py's bulk-assign
    # endpoint already uses for this identical situation, rather than
    # adding a new constraint sight-unseen against unknown existing data.
    existing_app = await conn.fetchrow(
        "SELECT id FROM applications WHERE tenant_id=$1 AND requisition_id=$2 AND candidate_id=$3",
        tenant_id, requisition_id, candidate_id)
    if existing_app:
        application_id = existing_app["id"]
        await conn.execute("UPDATE applications SET updated_at=now() WHERE id=$1", application_id)
    else:
        application_id = await conn.fetchval(
            """INSERT INTO applications (tenant_id, requisition_id, candidate_id, stage)
               VALUES ($1,$2,$3,$4) RETURNING id""",
            tenant_id, requisition_id, candidate_id, default_stage)

    session_id = await conn.fetchval(
        """INSERT INTO screening_sessions
             (tenant_id, candidate_id, requisition_id, application_id, whatsapp_account_id,
              enrolled_via, created_by, language)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id""",
        tenant_id, candidate_id, requisition_id, application_id, whatsapp_account_id,
        enrolled_via, created_by, language)

    await events.write_outbox(
        conn, tenant_id, "screening.enrolled",
        {"session_id": str(session_id), "candidate_id": str(candidate_id), "requisition_id": requisition_id},
        f"screening.enrolled:{session_id}")

    return {"status": "enrolled", "candidate_id": str(candidate_id), "session_id": str(session_id)}


async def maybe_auto_enroll_for_new_application(tenant_id: str, candidate_id: str, requisition_id: str,
                                                 actor_user_id: Optional[str]) -> None:
    """WhatsApp auto-trigger point (2026-09-18, explicit user decision:
    opt-in per requisition, not blanket-on for every role). Fired as a
    FastAPI BackgroundTask from POST /applications right after a new
    candidate-to-requisition link is created (applications.py) -- runs
    AFTER the response is already sent, on its own fresh connection, and
    must never raise: this is a best-effort side effect of assigning a
    role, never something that should be able to fail/block the actual
    assignment. Skips silently (not an error) when: the requisition
    hasn't opted in, the assigning recruiter has no working WhatsApp
    account connected (same hard requirement /screening/enroll itself
    enforces -- auto-enrolling from someone else's number would be
    wrong), or enroll_candidate_for_screening's own check finds the
    candidate already has an active session.
    """
    try:
        async with db.tenant_conn(tenant_id) as conn:
            enabled = await conn.fetchval(
                "SELECT auto_screening_enabled FROM requisitions WHERE id=$1 AND tenant_id=$2",
                requisition_id, tenant_id)
            if not enabled or not actor_user_id:
                return
            whatsapp_account_id = await conn.fetchval(
                """SELECT id FROM user_whatsapp_accounts
                   WHERE tenant_id=$1 AND user_id=$2 AND status='working' AND is_active=TRUE""",
                tenant_id, actor_user_id)
            if not whatsapp_account_id:
                return
            default_stage = await _default_add_stage(conn, tenant_id)
            async with conn.transaction():
                await enroll_candidate_for_screening(
                    conn, tenant_id, candidate_id, requisition_id, "auto_role_assignment",
                    default_stage, str(whatsapp_account_id), actor_user_id)
    except Exception:
        # Best-effort background side effect -- never let a screening/
        # WhatsApp failure surface against the (already-completed)
        # application-creation request.
        pass


async def _enroll_row(conn, actor: Actor, row: ScreeningEnrollRow, requisition_id: str,
                       enrolled_via: str, default_stage: str, whatsapp_account_id: Optional[str],
                       waha_session_name: Optional[str], language: str = "en") -> dict:
    if not row.candidate_id and not (row.full_name and row.phone):
        return {"status": "error", "detail": "Name and phone are required", "row": row.model_dump()}

    is_new_candidate = False
    if row.candidate_id:
        candidate_id = row.candidate_id
        existing = await conn.fetchrow(
            "SELECT id, phone FROM candidates WHERE id=$1 AND tenant_id=$2 AND is_active IS NOT FALSE",
            candidate_id, actor.tenant_id)
        if not existing:
            return {"status": "error", "detail": "Candidate not found", "candidate_id": candidate_id}
        phone_for_check = existing["phone"]
    else:
        parsed = {"name": row.full_name, "email": row.email, "phone": row.phone}
        dedup = await check_duplicate(conn, actor.tenant_id, parsed)
        if dedup.matched_candidate_id and dedup.should_merge:
            candidate_id = dedup.matched_candidate_id
            phone_for_check = await conn.fetchval(
                "SELECT phone FROM candidates WHERE id=$1", candidate_id)
        else:
            async with conn.transaction():
                candidate_id = await conn.fetchval(
                    """INSERT INTO candidates (tenant_id, full_name, email, phone, source)
                       VALUES ($1,$2,$3,$4,'whatsapp_screening') RETURNING id""",
                    actor.tenant_id, row.full_name, row.email, row.phone)
            is_new_candidate = True
            phone_for_check = row.phone

    # REAL BUG FIX (2026-09-19): a malformed/nonexistent phone number made
    # WAHA reject the send outright at dispatch time, but the session just
    # sat at pending_optin retried silently forever -- confirmed live on a
    # real Skill Matrix "Send" click (candidate had an 11-digit typo'd
    # number). Checking here, before any application/screening_session row
    # is created, gives an honest instant error instead of a false success
    # toast for a message that will never arrive. Fails OPEN (proceeds
    # normally) when the check itself couldn't complete (returns None) --
    # see check_number_exists's own docstring for why.
    if phone_for_check and waha_session_name:
        exists = await check_number_exists(phone_for_check, waha_session_name)
        if exists is False:
            return {"status": "error", "detail": "This phone number is not on WhatsApp — check for a typo",
                    "candidate_id": str(candidate_id)}

    if is_new_candidate:
        if actor.user_id and actor.email:
            await ownership.claim_ownership(
                conn, actor.tenant_id, str(candidate_id), str(actor.user_id), actor.email, "screening_enroll")
        if actor.user_id:
            await activity_events.log_recruiter_activity(
                conn, actor.tenant_id, str(actor.user_id), activity_events.SOURCED, candidate_id=str(candidate_id))
        await source_attribution.record_source_attribution(
            conn, actor.tenant_id, str(candidate_id), "whatsapp_screening")

    return await enroll_candidate_for_screening(
        conn, actor.tenant_id, candidate_id, requisition_id, enrolled_via, default_stage,
        whatsapp_account_id, actor.user_id, language)


@router.post("/enroll")
async def enroll(body: ScreeningEnrollRequest, actor: Actor = Depends(require_permission("screening", "write"))):
    if not body.rows:
        raise HTTPException(400, "No rows to enroll")

    async with db.tenant_conn(actor.tenant_id) as conn:
        req = await conn.fetchrow(
            "SELECT id, is_active FROM requisitions WHERE id=$1 AND tenant_id=$2",
            body.requisition_id, actor.tenant_id)
        if not req:
            raise HTTPException(404, "Requisition not found")
        if req["is_active"] is False:
            raise HTTPException(400, "This requisition has been closed and can no longer accept new candidates")

        wa_account = await conn.fetchrow(
            """SELECT id, waha_session_name FROM user_whatsapp_accounts
               WHERE tenant_id=$1 AND user_id=$2 AND status='working' AND is_active=TRUE""",
            actor.tenant_id, actor.user_id)
        if not wa_account:
            raise HTTPException(
                400, "Connect your own WhatsApp number first (Settings > WhatsApp) before enrolling candidates")
        whatsapp_account_id = wa_account["id"]
        waha_session_name = wa_account["waha_session_name"]

        default_stage = await _default_add_stage(conn, actor.tenant_id)

        results = []
        for row in body.rows:
            # Each row is independent -- one bad row must not poison the
            # others sharing this transaction-per-connection. The try/except
            # MUST wrap the `async with conn.transaction()`, not sit inside
            # it -- swallowing the exception before the transaction's own
            # __aexit__ sees it meant it tried to COMMIT an already-aborted
            # transaction, masking the real error behind a confusing
            # InFailedSQLTransactionError (confirmed live 2026-09-14).
            try:
                async with conn.transaction():
                    result = await _enroll_row(
                        conn, actor, row, body.requisition_id, body.enrolled_via,
                        default_stage, str(whatsapp_account_id), waha_session_name, body.language)
            except Exception as exc:
                result = {"status": "error", "detail": str(exc)}
            results.append(result)

    return {
        "enrolled": sum(1 for r in results if r["status"] == "enrolled"),
        "skipped": sum(1 for r in results if r["status"] == "skipped"),
        "errors": sum(1 for r in results if r["status"] == "error"),
        "results": results,
    }


@router.get("/summary")
async def summary(
    mine: bool = True,
    client_id: Optional[str] = Query(None),
    requisition_id: Optional[str] = Query(None),
    recruiter_id: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    actor: Actor = Depends(require_permission("screening", "read")),
):
    """Recruitment Overview Dashboard (2026-09-19): client_id/
    requisition_id/recruiter_id/date_from/date_to are new, additive
    filters -- the existing /screening page keeps calling this with just
    `mine`, unchanged. An explicit recruiter_id wins over the `mine`
    toggle's own derived recruiter (the dashboard cares about "show me
    recruiter X's funnel" regardless of who's viewing, not the logged-in
    viewer's own default). date_from/date_to use real date objects, not
    bare strings, against the ::date-cast bind -- the exact asyncpg bug
    class already found and fixed once today in recruiter_attribution.
    py's _date_filter()."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        eff_recruiter = recruiter_id or (actor.user_id if (mine or actor.role not in _BROAD_VISIBILITY_ROLES) else None)
        conditions = ["ss.tenant_id = $1"]
        params: list = [actor.tenant_id]
        joins = ""
        if eff_recruiter:
            params.append(eff_recruiter)
            conditions.append(f"ss.created_by = ${len(params)}")
        if requisition_id:
            params.append(requisition_id)
            conditions.append(f"ss.requisition_id = ${len(params)}")
        if client_id:
            joins = "JOIN requisitions r ON r.id = ss.requisition_id"
            params.append(client_id)
            conditions.append(f"r.client_id = ${len(params)}")
        if date_from:
            params.append(_date.fromisoformat(date_from))
            conditions.append(f"ss.created_at >= ${len(params)}::date")
        if date_to:
            params.append(_date.fromisoformat(date_to))
            conditions.append(f"ss.created_at < (${len(params)}::date + interval '1 day')")
        rows = await conn.fetch(
            f"SELECT ss.status, COUNT(*) AS n FROM screening_sessions ss {joins}"
            f" WHERE {' AND '.join(conditions)} GROUP BY ss.status",
            *params)
        # WhatsApp automation research (2026-09-14), decision #24: a real
        # green/yellow/red shadow quality rating, not just a reply-rate
        # text warning -- a 'red' number is also auto-paused from sending
        # by dispatch_pending_screening_messages, not only reported here.
        health_rows = await conn.fetch(
            """SELECT ua.id, ua.phone_number, ua.recent_reply_rate, ua.recent_optout_rate, ua.quality_rating,
                      (SELECT COUNT(*) FROM screening_sessions s
                       WHERE s.whatsapp_account_id = ua.id AND s.status = 'pending_optin') AS pending_count
               FROM user_whatsapp_accounts ua
               WHERE ua.tenant_id=$1 AND ua.user_id=$2 AND ua.quality_rating_updated_at IS NOT NULL""",
            actor.tenant_id, actor.user_id)
    # WhatsApp automation research (2026-09-15), gap #8: a 'red' number is
    # already excluded from dispatch_pending_screening_messages entirely
    # (auto-pause) -- the real remaining gap this surfaces is that nothing
    # ever told a recruiter HOW MANY candidates are now silently stuck
    # waiting behind it, or gave them a way to move those (never-yet-
    # contacted, so switching numbers is invisible to the candidate) to a
    # healthy number instead. True mid-conversation "failover" isn't
    # meaningful here -- we use one number PER RECRUITER, not a shared
    # pool behind one business number the way an official-API BSP does,
    # so a candidate already mid-conversation can't be silently moved to
    # a different number they've never texted.
    number_health = [
        {
            "id": str(r["id"]),
            "phone_number": r["phone_number"] or "unnamed",
            "quality_rating": r["quality_rating"],
            "reply_rate": r["recent_reply_rate"],
            "optout_rate": r["recent_optout_rate"],
            "paused": r["quality_rating"] == "red",
            "pending_count": r["pending_count"],
        }
        for r in health_rows
    ]
    warnings = [
        (f"Your WhatsApp number ({h['phone_number']}) is RED-rated and has been automatically "
         f"paused from sending new opt-ins — reply rate {round((h['reply_rate'] or 0) * 100)}%, "
         f"opt-out rate {round((h['optout_rate'] or 0) * 100)}%. "
         + (f"{h['pending_count']} candidate(s) are waiting to be contacted — reassign them to a "
            f"healthy number below." if h["pending_count"] else "Review before manually resuming."))
        if h["quality_rating"] == "red" else
        (f"Your WhatsApp number ({h['phone_number']}) is YELLOW-rated (reply rate "
         f"{round((h['reply_rate'] or 0) * 100)}%) — still sending, but worth watching.")
        for h in number_health if h["quality_rating"] in ("red", "yellow")
    ]
    return {
        "funnel": {r["status"]: r["n"] for r in rows},
        "number_health": number_health,
        "number_health_warnings": warnings,
    }


@router.get("/sessions")
async def list_sessions(
    mine: bool = True,
    status: Optional[str] = Query(None),
    client_id: Optional[str] = Query(None),
    requisition_id: Optional[str] = Query(None),
    recruiter_id: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    actor: Actor = Depends(require_permission("screening", "read")),
):
    """Feeds the /screening dashboard's queue + Phase 7's one-click
    interview-invite action (surfaced here rather than on the shared
    candidate drawer, to keep this milestone's frontend footprint
    contained to files this feature already owns).

    status/client_id/requisition_id/recruiter_id/date_from/date_to
    (2026-09-19, Recruitment Dashboard drill-down): additive filters so a
    click on a dashboard funnel card lands on the exact real rows behind
    that number -- same filter-building/param precedence as /summary
    (recruiter_id wins over mine's own derived recruiter), copied here
    rather than shared, since this query's base table alias (`s`) and
    joins differ from /summary's aggregate query."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        eff_recruiter = recruiter_id or (actor.user_id if (mine or actor.role not in _BROAD_VISIBILITY_ROLES) else None)
        conditions = ["s.tenant_id = $1"]
        params: list = [actor.tenant_id]
        joins = ""
        if eff_recruiter:
            params.append(eff_recruiter)
            conditions.append(f"s.created_by = ${len(params)}")
        if status:
            params.append(status)
            conditions.append(f"s.status = ${len(params)}")
        if requisition_id:
            params.append(requisition_id)
            conditions.append(f"s.requisition_id = ${len(params)}")
        if client_id:
            joins = "JOIN requisitions rc ON rc.id = s.requisition_id"
            params.append(client_id)
            conditions.append(f"rc.client_id = ${len(params)}")
        if date_from:
            params.append(_date.fromisoformat(date_from))
            conditions.append(f"s.created_at >= ${len(params)}::date")
        if date_to:
            params.append(_date.fromisoformat(date_to))
            conditions.append(f"s.created_at < (${len(params)}::date + interval '1 day')")
        rows = await conn.fetch(
            f"""SELECT s.id, s.status, s.recommendation, s.created_at, s.updated_at,
                       c.id AS candidate_id, c.full_name, c.phone, r.title AS requisition_title
                FROM screening_sessions s {joins}
                JOIN candidates c ON c.id = s.candidate_id
                JOIN requisitions r ON r.id = s.requisition_id
                WHERE {' AND '.join(conditions)}
                ORDER BY s.updated_at DESC LIMIT 100""",
            *params)
    return {"sessions": [dict(r) for r in rows]}


@router.get("/sessions/{session_id}")
async def session_detail(session_id: str, actor: Actor = Depends(require_permission("screening", "read"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        session = await conn.fetchrow(
            """SELECT s.*, c.full_name, c.phone, r.title AS requisition_title
               FROM screening_sessions s
               JOIN candidates c ON c.id = s.candidate_id
               JOIN requisitions r ON r.id = s.requisition_id
               WHERE s.id=$1 AND s.tenant_id=$2""",
            session_id, actor.tenant_id)
        if not session:
            raise HTTPException(404, "Session not found")
        answers = await conn.fetch(
            """SELECT question_key, question_text, raw_answer, extracted_value, extraction_method, created_at
               FROM screening_answers WHERE screening_session_id=$1 ORDER BY created_at""",
            session_id)
        # Gaps #2/#3: surfaced here rather than a separate endpoint --
        # this is where a recruiter is already looking at one candidate's
        # full conversation.
        referrals = await conn.fetch(
            """SELECT raw_text, referred_name, referred_phone, created_at
               FROM screening_referrals WHERE screening_session_id=$1 ORDER BY created_at""",
            session_id)
    return {"session": dict(session), "answers": [dict(a) for a in answers],
            "referrals": [dict(r) for r in referrals]}


class ReassignPendingRequest(BaseModel):
    from_whatsapp_account_id: str
    to_whatsapp_account_id: str


@router.post("/reassign-pending")
async def reassign_pending(body: ReassignPendingRequest,
                            actor: Actor = Depends(require_permission("screening", "write"))):
    """WhatsApp automation research (2026-09-15), gap #8: the only sessions
    this can safely move are 'pending_optin' ones -- the candidate has
    received NOTHING yet, so switching which of the tenant's numbers sends
    the opt-in is invisible to them. A session already mid-conversation
    can't be moved this way (see the number_health comment in /summary
    for why "failover" doesn't map cleanly onto one-number-per-recruiter)."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        target = await conn.fetchrow(
            """SELECT id FROM user_whatsapp_accounts
               WHERE id=$1 AND tenant_id=$2 AND status='working' AND is_active=TRUE""",
            body.to_whatsapp_account_id, actor.tenant_id)
        if not target:
            raise HTTPException(400, "Target WhatsApp number isn't connected/working")
        moved = await conn.fetchval(
            """WITH moved AS (
                 UPDATE screening_sessions SET whatsapp_account_id=$1, updated_at=now()
                 WHERE tenant_id=$2 AND whatsapp_account_id=$3 AND status='pending_optin'
                 RETURNING id)
               SELECT COUNT(*) FROM moved""",
            body.to_whatsapp_account_id, actor.tenant_id, body.from_whatsapp_account_id)
    return {"moved": moved}


@router.get("/segment-preview")
async def segment_preview(requisition_id: str, actor: Actor = Depends(require_permission("screening", "read"))):
    """WhatsApp automation research (2026-09-15), gap: tag/segment-based
    broadcast (Wati/AiSensy pattern) for "a fresh JD just opened, who in
    our existing pool already fits it?" -- reuses candidates.skills
    (already real data from every intake path, not a new tag system)
    against the target role's mandatory_skills. Preview only; enrolling
    the ones a recruiter actually picks reuses the existing bulk-select
    entry point (POST /screening/enroll with enrolled_via='bulk_select'),
    not a new send path."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        req = await conn.fetchrow(
            "SELECT mandatory_skills FROM requisitions WHERE id=$1 AND tenant_id=$2",
            requisition_id, actor.tenant_id)
        if not req:
            raise HTTPException(404, "Requisition not found")
        if not req["mandatory_skills"]:
            return {"candidates": []}
        rows = await conn.fetch(
            """SELECT c.id, c.full_name, c.phone, c.skills, c.location
               FROM candidates c
               WHERE c.tenant_id=$1 AND c.is_active IS NOT FALSE AND c.phone IS NOT NULL
                 AND c.skills && $2::text[]
                 AND NOT EXISTS (
                   SELECT 1 FROM applications a WHERE a.tenant_id=$1 AND a.candidate_id=c.id
                     AND a.requisition_id=$3)
               ORDER BY c.updated_at DESC LIMIT 200""",
            actor.tenant_id, req["mandatory_skills"], requisition_id)
    return {"candidates": [dict(r) for r in rows]}


@router.get("/questions-preview")
async def questions_preview(requisition_id: str, language: str = "en",
                             actor: Actor = Depends(require_permission("screening", "read"))):
    """Phase 0: "Picking a Role... shows a live preview of the questions
    that will be sent" -- generated from build_question_sequence, the same
    function the real conversation uses, so the preview can never drift
    from what actually gets asked."""
    from services.screening_questions import build_question_sequence
    async with db.tenant_conn(actor.tenant_id) as conn:
        sequence = await build_question_sequence(conn, actor.tenant_id, requisition_id, language)
    return {"questions": [q["text"] for q in sequence]}


class TestSendRequest(BaseModel):
    requisition_id: str
    language: str = "en"


@router.post("/test-send")
async def test_send(body: TestSendRequest, actor: Actor = Depends(require_permission("screening", "write"))):
    """Sends the opt-in wording AND the full question sequence to the
    REQUESTING RECRUITER'S OWN number -- decision #14, a sanity check for
    a brand-new role's auto-generated wording before it reaches real
    candidates. Deliberately doesn't require an existing screening_session
    (a v1 gap fixed here: this needs to work BEFORE anyone is enrolled,
    which is the whole point of a pre-bulk-send preview)."""
    from services.screening_i18n import t
    from services.screening_questions import build_question_sequence

    async with db.tenant_conn(actor.tenant_id) as conn:
        req = await conn.fetchrow(
            """SELECT r.title, cl.name AS client_name FROM requisitions r
               LEFT JOIN clients cl ON cl.id = r.client_id
               WHERE r.id=$1 AND r.tenant_id=$2""",
            body.requisition_id, actor.tenant_id)
        if not req:
            raise HTTPException(404, "Requisition not found")
        own = await conn.fetchrow(
            """SELECT waha_session_name, phone_number FROM user_whatsapp_accounts
               WHERE tenant_id=$1 AND user_id=$2 AND status='working'""",
            actor.tenant_id, actor.user_id)
        if not own or not own["phone_number"]:
            raise HTTPException(400, "Connect your own WhatsApp number first (Settings > WhatsApp)")
        recruiter_name = await conn.fetchval("SELECT full_name FROM users WHERE id=$1", actor.user_id)
        sequence = await build_question_sequence(conn, actor.tenant_id, body.requisition_id, body.language)

    from routers.whatsapp_bot import send_wa
    opt_in = t(
        "opt_in", body.language, name="there", recruiter=recruiter_name or "our recruiting team",
        role=req["title"] or "this role", client=req["client_name"] or "our client")
    lines = [
        "[TEST PREVIEW] This is what a real candidate would see -- shown here all at once for you to review the",
        "wording. In the real conversation, question 2 onward is sent only after the candidate answers the one",
        "before it, never all together.", "",
        "1) Opt-in message:", opt_in, "",
    ]
    if sequence:
        lines.append("2) Questions that follow, one at a time, after YES:")
        lines.extend(f"{i}. {q['text']}" for i, q in enumerate(sequence, 1))
    else:
        lines.append("2) No mandatory skills set on this role yet -- it would go straight to the resume request.")
    delivered = await send_wa(own["phone_number"], "\n".join(lines), session=own["waha_session_name"])
    return {"sent": delivered, "question_count": len(sequence)}
