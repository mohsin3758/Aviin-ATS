"""WhatsApp Screening Blueprint, Milestone 1 (Phases 0-2): quick-add/dedup,
enroll & throttle, opt-in & consent. See
C:\\Users\\mohsi\\.claude\\plans\\breezy-sprouting-island.md for the full
implementation plan this router was built from.

Stops at consent: a session reaching 'awaiting_screening' is as far as
this milestone goes. Milestone 2 wires Phase 3 (the skill-question loop)
onto that same status transition inside whatsapp_bot.py.
"""
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator

import db
import events
from deps import Actor
from permissions import require_permission
from schemas import _validate_phone
from services import activity_events, source_attribution
from services import candidate_ownership as ownership
from services.dedup_service import check_duplicate

router = APIRouter(prefix="/screening", tags=["screening"])

_BROAD_VISIBILITY_ROLES = ("admin", "super_admin", "manager", "kae", "kam")

TERMINAL_STATUSES = ("declined", "opted_out", "no_response", "bad_number")


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

    application_id = await conn.fetchval(
        """INSERT INTO applications (tenant_id, requisition_id, candidate_id, stage)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (tenant_id, requisition_id, candidate_id) DO UPDATE SET updated_at = now()
           RETURNING id""",
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


async def _enroll_row(conn, actor: Actor, row: ScreeningEnrollRow, requisition_id: str,
                       enrolled_via: str, default_stage: str, whatsapp_account_id: Optional[str],
                       language: str = "en") -> dict:
    if not row.candidate_id and not (row.full_name and row.phone):
        return {"status": "error", "detail": "Name and phone are required", "row": row.model_dump()}

    is_new_candidate = False
    if row.candidate_id:
        candidate_id = row.candidate_id
        existing = await conn.fetchval(
            "SELECT id FROM candidates WHERE id=$1 AND tenant_id=$2 AND is_active IS NOT FALSE",
            candidate_id, actor.tenant_id)
        if not existing:
            return {"status": "error", "detail": "Candidate not found", "candidate_id": candidate_id}
    else:
        parsed = {"name": row.full_name, "email": row.email, "phone": row.phone}
        dedup = await check_duplicate(conn, actor.tenant_id, parsed)
        if dedup.matched_candidate_id and dedup.should_merge:
            candidate_id = dedup.matched_candidate_id
        else:
            async with conn.transaction():
                candidate_id = await conn.fetchval(
                    """INSERT INTO candidates (tenant_id, full_name, email, phone, source)
                       VALUES ($1,$2,$3,$4,'whatsapp_screening') RETURNING id""",
                    actor.tenant_id, row.full_name, row.email, row.phone)
            is_new_candidate = True

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

        whatsapp_account_id = await conn.fetchval(
            """SELECT id FROM user_whatsapp_accounts
               WHERE tenant_id=$1 AND user_id=$2 AND status='working' AND is_active=TRUE""",
            actor.tenant_id, actor.user_id)
        if not whatsapp_account_id:
            raise HTTPException(
                400, "Connect your own WhatsApp number first (Settings > WhatsApp) before enrolling candidates")

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
                        default_stage, str(whatsapp_account_id), body.language)
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
async def summary(mine: bool = True, actor: Actor = Depends(require_permission("screening", "read"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        eff_recruiter = actor.user_id if (mine or actor.role not in _BROAD_VISIBILITY_ROLES) else None
        conditions = ["tenant_id = $1"]
        params: list = [actor.tenant_id]
        if eff_recruiter:
            params.append(eff_recruiter)
            conditions.append(f"created_by = ${len(params)}")
        rows = await conn.fetch(
            f"SELECT status, COUNT(*) AS n FROM screening_sessions WHERE {' AND '.join(conditions)} GROUP BY status",
            *params)
        # Decision #24: surface a declining-reply-rate number as an early
        # warning rather than only reacting after it's already banned.
        health_rows = await conn.fetch(
            """SELECT phone_number, recent_reply_rate FROM user_whatsapp_accounts
               WHERE tenant_id=$1 AND user_id=$2 AND recent_reply_rate IS NOT NULL""",
            actor.tenant_id, actor.user_id)
    warnings = [
        f"Your WhatsApp number ({r['phone_number'] or 'unnamed'}) has a low reply rate "
        f"({round(r['recent_reply_rate'] * 100)}%) over its last 20 screening sends — "
        "worth checking it hasn't been silently restricted."
        for r in health_rows if r["recent_reply_rate"] is not None and r["recent_reply_rate"] < 0.15
    ]
    return {"funnel": {r["status"]: r["n"] for r in rows}, "number_health_warnings": warnings}


@router.get("/sessions")
async def list_sessions(mine: bool = True, actor: Actor = Depends(require_permission("screening", "read"))):
    """Feeds the /screening dashboard's queue + Phase 7's one-click
    interview-invite action (surfaced here rather than on the shared
    candidate drawer, to keep this milestone's frontend footprint
    contained to files this feature already owns)."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        eff_recruiter = actor.user_id if (mine or actor.role not in _BROAD_VISIBILITY_ROLES) else None
        conditions = ["s.tenant_id = $1"]
        params: list = [actor.tenant_id]
        if eff_recruiter:
            params.append(eff_recruiter)
            conditions.append(f"s.created_by = ${len(params)}")
        rows = await conn.fetch(
            f"""SELECT s.id, s.status, s.recommendation, s.created_at, s.updated_at,
                       c.id AS candidate_id, c.full_name, c.phone, r.title AS requisition_title
                FROM screening_sessions s
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
    return {"session": dict(session), "answers": [dict(a) for a in answers]}


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
        sequence = await build_question_sequence(conn, actor.tenant_id, body.requisition_id, body.language)

    from routers.whatsapp_bot import send_wa
    opt_in = t(
        "opt_in", body.language, name="there", brand="Aviin Tech", role=req["title"] or "this role",
        client=req["client_name"] or "our client")
    lines = ["[TEST PREVIEW] This is what a real candidate would see.", "", "1) Opt-in message:", opt_in, ""]
    if sequence:
        lines.append("2) Questions that follow after YES:")
        lines.extend(f"{i}. {q['text']}" for i, q in enumerate(sequence, 1))
    else:
        lines.append("2) No mandatory skills set on this role yet -- it would go straight to the resume request.")
    delivered = await send_wa(own["phone_number"], "\n".join(lines), session=own["waha_session_name"])
    return {"sent": delivered, "question_count": len(sequence)}
