import json
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel

import db
import events, asyncio
from deps import Actor, get_actor
from schemas import ApplicationCreate, StageUpdate
from permissions import require_permission
from routers.p30_p35 import fire_webhook
from services import candidate_ownership as ownership
from services import activity_events


def _stage_to_activity_event(stage: str) -> str | None:
    """Map a pipeline stage transition to a recruiter_activity_events type.

    Only meaningful funnel milestones are logged — not every stage
    (sourced/contacted/hold/custom non-interview stages would just be
    noise). Custom tenant interview rounds (l3_interview, etc.) are
    handled by substring match, not a hardcoded list, matching the
    LIKE '%interview%' pattern already established in this file's own
    my-stats/recruiter-performance endpoints for the same reason.
    'offer' is deliberately excluded here — offer generation already logs
    its own 'offer_generated' event at the point offers.py/phase3.py
    actually create the offer, so mapping it here too would double-count.
    """
    if stage in ("screened", "submitted", "rejected", "placed"):
        return stage
    if "interview" in stage:
        return stage
    return None

router = APIRouter(prefix="/applications", tags=["applications"])
rejection_reasons_router = APIRouter(prefix="/rejection-reasons", tags=["applications"])


class RejectionReasonIn(BaseModel):
    code: str
    label: str
    sort_order: int = 0


@rejection_reasons_router.get("")
async def list_rejection_reasons(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            "SELECT * FROM rejection_reasons WHERE tenant_id=$1 AND is_active ORDER BY sort_order, label",
            actor.tenant_id)
    return [dict(r) for r in rows]


@rejection_reasons_router.post("")
async def create_rejection_reason(body: RejectionReasonIn, actor: Actor = Depends(get_actor)):
    if actor.role not in ("admin", "manager"):
        raise HTTPException(403, "Only admin/manager can manage the rejection reason taxonomy")
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """INSERT INTO rejection_reasons (tenant_id, code, label, sort_order)
               VALUES ($1,$2,$3,$4)
               ON CONFLICT (tenant_id, code) DO UPDATE SET label=EXCLUDED.label, sort_order=EXCLUDED.sort_order, is_active=true
               RETURNING *""",
            actor.tenant_id, body.code, body.label, body.sort_order)
    return dict(row)


@rejection_reasons_router.delete("/{reason_id}")
async def delete_rejection_reason(reason_id: str, actor: Actor = Depends(get_actor)):
    if actor.role not in ("admin", "manager"):
        raise HTTPException(403, "Only admin/manager can manage the rejection reason taxonomy")
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchval(
            "UPDATE rejection_reasons SET is_active=false WHERE id=$1 AND tenant_id=$2 RETURNING id",
            reason_id, actor.tenant_id)
        if not row:
            raise HTTPException(404, "Rejection reason not found")
    return {"ok": True}

FIELDS = """id, tenant_id, requisition_id, candidate_id, stage, fit_score,
            assigned_recruiter_id, created_at, updated_at"""

_DEFAULT_STAGE_KEYS = frozenset({
    "sourced", "contacted", "interested", "nda", "screened", "submitted",
    "l1_interview", "l2_interview", "offer", "offer_accepted", "placed", "rejected", "hold",
})

# Approved item 08: which stage transitions auto-create a typed task for the
# assigned recruiter, and what that task is. Deliberately not every stage —
# e.g. "sourced"/"hold" have no single obvious next action.
_STAGE_AUTO_TASK = {
    "screened":        {"type": "screening_call",       "title": "Screening call: {name}"},
    "l1_interview":    {"type": "interview_coordination", "title": "Coordinate L1 interview: {name}"},
    "l2_interview":    {"type": "interview_coordination", "title": "Coordinate L2 interview: {name}"},
    "offer":           {"type": "offer_followup",        "title": "Offer follow-up: {name}"},
    "offer_accepted":  {"type": "joining_coordination",   "title": "Coordinate joining: {name}"},
}


def _auto_task_for_stage(stage_key: str) -> Optional[dict]:
    """Static map above only ever covered the 5 original built-in stages —
    but stages can now be freely renamed/added/deleted per tenant (Settings
    > Pipeline Stages), so a fixed dict silently stops auto-creating tasks
    the moment a tenant adds a custom interview round (e.g. l3_interview,
    already real on this tenant) instead of just using l1/l2. Falls back to
    a generic interview-coordination task for any stage key containing
    "interview" that isn't already in the static map above."""
    if stage_key in _STAGE_AUTO_TASK:
        return _STAGE_AUTO_TASK[stage_key]
    if "interview" in stage_key:
        label = stage_key.replace("_", " ").title()
        return {"type": "interview_coordination", "title": f"Coordinate {label}: {{name}}"}
    return None



@router.get("")
async def list_applications(
    limit: int = 200,
    stage: str = None,
    actor: Actor = Depends(get_actor)
):
    """List applications across all requisitions, with candidate + job title."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        if stage:
            rows = await conn.fetch(
                """SELECT a.id, a.stage, a.fit_score, a.created_at,
                          c.full_name as candidate_name, c.email, c.phone,
                          r.title as job_title, r.id as requisition_id
                   FROM applications a
                   JOIN candidates c ON c.id = a.candidate_id
                   JOIN requisitions r ON r.id = a.requisition_id
                   WHERE a.stage = $1 AND c.is_active IS NOT FALSE
                   ORDER BY a.created_at DESC LIMIT $2""",
                stage, limit)
        else:
            rows = await conn.fetch(
                """SELECT a.id, a.stage, a.fit_score, a.created_at,
                          c.full_name as candidate_name, c.email, c.phone,
                          r.title as job_title, r.id as requisition_id
                   FROM applications a
                   JOIN candidates c ON c.id = a.candidate_id
                   JOIN requisitions r ON r.id = a.requisition_id
                   WHERE c.is_active IS NOT FALSE
                   ORDER BY a.created_at DESC LIMIT $1""",
                limit)
    return [dict(r) for r in rows]

@router.post("")
async def create_application(body: ApplicationCreate, background_tasks: BackgroundTasks,
                              actor: Actor = Depends(require_permission("applications", "create"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        existing = await conn.fetchval(
            "SELECT id FROM applications WHERE requisition_id = $1 AND candidate_id = $2",
            body.requisition_id, body.candidate_id,
        )
        if existing:
            raise HTTPException(status_code=409, detail="Application already exists for this candidate/requisition")

        # Individual recruiter ownership (2026-08-11): when no recruiter is
        # explicitly given (an admin/manager choosing someone specific is
        # always respected — matches the ownership rule's "authorized
        # transfer" escape hatch), default to the candidate's real active
        # owner instead of silently defaulting to whoever happens to be
        # logged in and creating this application.
        default_recruiter_id = actor.user_id
        if not body.assigned_recruiter_id:
            owner = await ownership.get_ownership(conn, actor.tenant_id, body.candidate_id)
            if owner and owner["status"] == "active" and owner["ownership_expires_at"] > datetime.now(timezone.utc):
                default_recruiter_id = owner["recruiter_id"]

        # Per-role submission cap. NULL limit (the default) = unlimited, no
        # behavior change unless an admin sets one on the requisition.
        recruiter_for_limit = body.assigned_recruiter_id or default_recruiter_id
        if recruiter_for_limit:
            req_row = await conn.fetchrow(
                "SELECT submission_limit_per_recruiter FROM requisitions WHERE id=$1", body.requisition_id)
            limit = req_row["submission_limit_per_recruiter"] if req_row else None
            if limit is not None:
                used = await conn.fetchval(
                    "SELECT count(*) FROM applications WHERE requisition_id=$1 AND assigned_recruiter_id=$2",
                    body.requisition_id, recruiter_for_limit)
                if used >= limit:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Submission limit reached for this role ({limit} per recruiter) — {used} already submitted",
                    )

        # allow stage override (default 'sourced')
        initial_stage = body.stage or 'sourced'
        # Default assigned_recruiter_id to the creating user when not given —
        # "who submitted this" needs to be attributable for the submission
        # limit above to mean anything on a second call; leaving it NULL
        # here while the limit check above counted it against actor.user_id
        # would silently never count against anyone.
        row = await conn.fetchrow(
            f"""INSERT INTO applications (tenant_id, requisition_id, candidate_id, assigned_recruiter_id, stage)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING {FIELDS}""",
            actor.tenant_id, body.requisition_id, body.candidate_id, recruiter_for_limit, initial_stage,
        )

        await events.write_outbox(
            conn, actor.tenant_id, "application.created",
            {
                "application_id": str(row["id"]),
                "requisition_id": body.requisition_id,
                "candidate_id": body.candidate_id,
            },
            f"application.created:{row['id']}",
        )

    # Closes another of the 8 dead automation_workflows rows found in the
    # 2026-08-10 audit — a brand-new application is a real, single,
    # unambiguous trigger point, and this is the one function every
    # application-creation path in the app already funnels through.
    background_tasks.add_task(fire_webhook, "new-application", {
        "application_id": str(row["id"]),
        "requisition_id": body.requisition_id,
        "candidate_id": body.candidate_id,
    }, actor.tenant_id)

    return dict(row)


@router.get("/{application_id}")
async def get_application(application_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(f"SELECT {FIELDS} FROM applications WHERE id = $1", application_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Application not found")
    return dict(row)


@router.get("/{application_id}/rejection")
async def get_application_rejection(application_id: str, actor: Actor = Depends(get_actor)):
    """Most recent structured rejection reason for this application, if any."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT * FROM application_rejections WHERE application_id=$1 AND tenant_id=$2 ORDER BY rejected_at DESC LIMIT 1",
            application_id, actor.tenant_id)
    return dict(row) if row else None


async def _notify_stage_change_bg(candidate_id, stage, email, name, tenant_id, custom_msg=None, requisition_id=None, application_id=None):
    """Background: WhatsApp + email + n8n on stage change."""
    import httpx, smtplib, os
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart

    # JD auto-send: "contacted" is the moment a candidate is actually being
    # reached out to about a specific role, so that's where the JD content
    # rides along on both channels — not every stage, which would just be
    # repeating it.
    jd_block = ""
    if stage == "contacted" and requisition_id:
        try:
            async with db.tenant_conn(tenant_id) as _jconn:
                _req = await _jconn.fetchrow(
                    "SELECT title, description, location, employment_type FROM requisitions WHERE id=$1",
                    requisition_id)
            if _req and _req["description"]:
                jd_block = (
                    f"\n\n--- Job Description: {_req['title']} ---\n"
                    f"{_req['location'] or ''}{' · ' if _req['location'] else ''}{(_req['employment_type'] or '').replace('_',' ').title()}\n\n"
                    f"{_req['description']}"
                )
        except Exception as _jex:
            print(f"JD auto-send fetch failed: {_jex}")

    MSGS = {
        "contacted":      f"We have reviewed your profile and would like to connect with you regarding an exciting opportunity. Our recruitment team will reach out shortly to discuss the role in detail.",
        "interested":     f"Thank you for your interest! We are pleased to inform you that we are moving forward with your application. Our team will be in touch very soon to discuss the next steps.",
        "nda":            f"As part of our recruitment process, we require you to review and sign an NDA/Pre-contract agreement before we can share further details about this opportunity. Please respond at your earliest convenience.",
        "screened":       f"Congratulations! Your profile has been shortlisted and you have successfully cleared our initial screening process. Our recruiter will contact you shortly to discuss the next steps.",
        "submitted":      f"We are pleased to inform you that your profile has been submitted to our client for consideration. We will keep you posted and revert as soon as we receive feedback.",
        "l1_interview":   f"Congratulations! You have been selected for the L1 Interview. Our team will share the interview schedule shortly. Please ensure your availability and prepare well. All the best!",
        "l2_interview":   f"Excellent news! You have successfully cleared the L1 Interview and have been selected for the L2 Final Interview. Our team will reach out with the schedule shortly. All the best!",
        "interview":      f"Congratulations! You have been selected for an interview. Our team will share the details shortly. All the best!",
        "offer":          f"Great news! Our client is preparing an offer for you. Our team will be in touch shortly to discuss the offer details. Congratulations on making it this far!",
        "offer_accepted": f"Congratulations on accepting the offer! We are thrilled to have you placed. Our team will coordinate with you for the documentation and onboarding process. Please confirm your joining date at the earliest.",
        "placed":         f"Congratulations on your successful placement! It has been a pleasure being a part of your career journey. We wish you great success in your new role. Feel free to reach out anytime.",
        "hold":           f"We wanted to keep you informed that your application is currently on hold. We appreciate your patience and will update you as soon as there is any movement. Thank you for your understanding.",
        "rejected":       f"Thank you for your interest and the time you invested in this process. After careful consideration, we are unable to move forward with your application for this particular role at this time. We encourage you to stay connected as we regularly have new opportunities.",
    }
    msg_text = custom_msg if custom_msg else MSGS.get(stage, "")
    # Note: stage_templates from DB will override msg_text inside the email block if configured
    SUBJS = {
        "contacted":      "AVIIN Jobs - We Have Reviewed Your Profile",
        "interested":     "AVIIN Jobs - Moving Forward with Your Application",
        "nda":            "AVIIN Jobs - NDA / Pre-Contract Agreement Required",
        "screened":       "AVIIN Jobs - Profile Shortlisted",
        "submitted":      "AVIIN Jobs - Your Profile Has Been Submitted to Client",
        "l1_interview":   "AVIIN Jobs - L1 Interview Scheduled - Congratulations!",
        "l2_interview":   "AVIIN Jobs - L2 Final Interview - You Are Almost There!",
        "interview":      "AVIIN Jobs - Interview Scheduled",
        "offer":          "AVIIN Jobs - Offer in Progress - Congratulations!",
        "offer_accepted": "AVIIN Jobs - Offer Accepted - Welcome Aboard!",
        "placed":         "AVIIN Jobs - Placement Confirmation - Congratulations!",
        "hold":           "AVIIN Jobs - Application Status Update",
        "rejected":       "AVIIN Jobs - Update on Your Application",
    }

    # WhatsApp via WAHA — HARD RULE #7/#12: consent-gated, real recipient,
    # real per-stage template (previously broadcast a placeholder to a fixed
    # "status@broadcast" chat with a fake candidate_id-derived phone number).
    try:
        from routers.whatsapp import _ensure_consent, _waha_headers, _check_waha, WAHA_BASE, WAHA_SESSION
        async with db.tenant_conn(tenant_id) as conn:
            has_consent = await _ensure_consent(conn, tenant_id, str(candidate_id))
            cand_row = await conn.fetchrow("SELECT phone FROM candidates WHERE id=$1", candidate_id)
            wa_row = await conn.fetchrow(
                "SELECT stage_templates FROM whatsapp_settings WHERE tenant_id=$1", tenant_id)
        phone = cand_row["phone"] if cand_row else None
        wa_templates = {}
        if wa_row and wa_row["stage_templates"]:
            wa_templates = wa_row["stage_templates"]
            if isinstance(wa_templates, str):
                wa_templates = json.loads(wa_templates)
        wa_text = (wa_templates.get(stage, {}) or {}).get("message") or msg_text
        if wa_text:
            wa_text = wa_text.replace("{name}", str(name)) + jd_block

        if has_consent and phone and wa_text:
            session_info = await _check_waha()
            if session_info.get("status") in ("WORKING", "CONNECTED"):
                digits = "".join(c for c in phone if c.isdigit())
                if len(digits) == 10:
                    digits = "91" + digits  # bare 10-digit Indian mobile — assume +91
                chat_id = digits + "@c.us"
                async with httpx.AsyncClient(timeout=10.0) as cli:
                    await cli.post(f"{WAHA_BASE}/api/sendText", headers=_waha_headers(),
                        json={"session": WAHA_SESSION, "chatId": chat_id, "text": wa_text})
                print(f"Stage WhatsApp [{stage}] sent to {chat_id} ({name})")
            else:
                print(f"Stage WhatsApp [{stage}] skipped: WAHA session not connected")
        elif not has_consent:
            print(f"Stage WhatsApp [{stage}] skipped for {name}: no WhatsApp consent on file (HARD RULE #7)")
        elif not phone:
            print(f"Stage WhatsApp [{stage}] skipped for {name}: no phone number on file")
    except Exception as _ex:
        print(f"Stage WhatsApp failed [{stage}]: {_ex}")

    # n8n webhook — real, working, by far the most-used integration in the
    # whole system (500+ real executions per the 2026-08-10 audit) but was
    # never a row in automation_workflows, so Settings > Automations had
    # zero visibility into it and it had no fire_count/last_fired_at
    # tracking at all. Switched to fire_webhook() (the same tenant-aware,
    # success-gated helper every other automation trigger now uses) so
    # this one is finally visible on the dashboard too, not just working
    # silently in the background.
    try:
        await fire_webhook("aviin-stage-change",
            {"candidate_name": name, "stage_to": stage, "candidate_id": str(candidate_id)},
            tenant_id)
    except Exception:
        pass

    # Email notification for key stages - reads SMTP from email_settings DB.
    # Uses db.tenant_conn (not a raw asyncpg connection) because it also
    # needs to read document_templates, which has FORCE ROW LEVEL SECURITY.
    if email and stage in SUBJS and msg_text:
        try:
            from email import encoders as _encoders
            from email.mime.base import MIMEBase as _MIMEBase
            from pathlib import Path as _Path

            async with db.tenant_conn(tenant_id) as _conn:
                _cfg = await _conn.fetchrow(
                    "SELECT smtp_host,smtp_port,smtp_user,smtp_password,smtp_from,smtp_from_name,smtp_tls,stage_templates "
                    "FROM email_settings WHERE tenant_id=$1 AND is_active=TRUE LIMIT 1", tenant_id)
                if _cfg and _cfg["smtp_host"]:
                    _h=_cfg["smtp_host"]; _p=_cfg["smtp_port"] or 587
                    _u=_cfg["smtp_user"] or ""; _pw=_cfg["smtp_password"] or ""
                    _f=_cfg["smtp_from"] or _u; _fn=_cfg["smtp_from_name"] or "AVIIN ATS"
                    _tls=_cfg["smtp_tls"] if _cfg["smtp_tls"] is not None else True
                    _em=MIMEMultipart()
                    _raw_tmpls = _cfg["stage_templates"]
                    if isinstance(_raw_tmpls, str):
                        _raw_tmpls = json.loads(_raw_tmpls or "{}")
                    _tmpl=(_raw_tmpls or {}).get(stage,{})
                    _subj=_tmpl.get("subject") or SUBJS.get(stage,"AVIIN Jobs - Update")
                    if not msg_text or msg_text==MSGS.get(stage,""):
                        _tmpl_msg=_tmpl.get("message","")
                        if _tmpl_msg: msg_text=_tmpl_msg
                    _em["Subject"]=_subj
                    _em["From"]=f"{_fn} <{_f}>"
                    _em["To"]=email
                    _body = "Dear " + str(name) + "," + chr(10) + chr(10) + str(msg_text) + jd_block + chr(10) + chr(10) + "Best regards," + chr(10) + "AVIIN Jobs Services" + chr(10) + "https://ats.aviinjobs.com"

                    # Log to candidate_messages so it shows in Conversations
                    # and so open-tracking has a row to key against — stage-
                    # change emails weren't logged there at all before this.
                    _logged = await _conn.fetchrow(
                        """INSERT INTO candidate_messages
                             (tenant_id,candidate_id,application_id,channel,direction,subject,body,
                              status,stage_at_send,is_read,to_email)
                           VALUES ($1,$2,$3,'email','outbound',$4,$5,'sent',$6,TRUE,$7)
                           RETURNING tracking_token""",
                        tenant_id, candidate_id, application_id, _subj, _body, stage, email)
                    _tracked_body = _body
                    if _logged and _logged["tracking_token"]:
                        import html as _html
                        _pixel = f'<img src="https://ats.aviinjobs.com/track/open/{_logged["tracking_token"]}.gif" width="1" height="1" style="display:none" alt="" />'
                        _tracked_body = (
                            f'<html><body style="font-family:sans-serif;font-size:14px;color:#1e293b;">'
                            f'{_html.escape(_body).replace(chr(10), "<br>")}{_pixel}</body></html>'
                        )
                        _em.attach(MIMEText(_tracked_body, "html"))
                    else:
                        _em.attach(MIMEText(_body, "plain"))

                    _attach_choice = _tmpl.get("attachment")
                    if _attach_choice in ("nda_template", "contract_template"):
                        _doc_type = "nda" if _attach_choice == "nda_template" else "contract"
                        _doc = await _conn.fetchrow(
                            "SELECT file_path, file_name, mime_type FROM document_templates WHERE tenant_id=$1 AND doc_type=$2",
                            tenant_id, _doc_type)
                        if _doc:
                            _abs_path = _Path("/app") / _doc["file_path"].lstrip("/")
                            if _abs_path.exists():
                                _maintype, _, _subtype = (_doc["mime_type"] or "application/octet-stream").partition("/")
                                _part = _MIMEBase(_maintype or "application", _subtype or "octet-stream")
                                _part.set_payload(_abs_path.read_bytes())
                                _encoders.encode_base64(_part)
                                _part.add_header("Content-Disposition", f'attachment; filename="{_doc["file_name"]}"')
                                _em.attach(_part)
                            else:
                                print(f"Stage email [{stage}]: {_doc_type} template file missing from disk")
                        else:
                            print(f"Stage email [{stage}]: no {_doc_type} template uploaded — sending without attachment")

                    with smtplib.SMTP(_h, _p, timeout=10) as _s:
                        _s.ehlo()
                        if _tls and _p==587: _s.starttls(); _s.ehlo()
                        if _u: _s.login(_u, _pw)
                        _s.sendmail(_f, [email], _em.as_string())
                    print(f"Stage email [{stage}] sent to {email} ({name})")
                else:
                    print("Stage email: no active SMTP config found")
        except Exception as _ex:
            print(f"Stage email failed [{stage}] to {email}: {_ex}")

@router.patch("/{application_id}/stage")
async def update_stage(
    application_id: str,
    body: StageUpdate,
    actor: Actor = Depends(get_actor),
    _perm: Actor = Depends(require_permission("pipeline", "update")),
):
    # HARD RULE #10: rejecting a candidate is a HITL-gated, high-stakes action.
    if body.stage == "rejected" and actor.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Rejecting a candidate requires manager/admin role (HITL)")

    async with db.tenant_conn(actor.tenant_id) as conn:
        old = await conn.fetchrow("SELECT stage, candidate_id FROM applications WHERE id = $1", application_id)
        if old is None:
            raise HTTPException(status_code=404, detail="Application not found")

        # Broadened candidate-ownership enforcement (2026-08-11): a
        # non-owner recruiter can't move a candidate someone else
        # actively owns through the pipeline. Admin/manager and the
        # owner themselves are unaffected; unowned/expired candidates
        # are unrestricted.
        await ownership.check_ownership_or_raise(conn, actor.tenant_id, str(old["candidate_id"]), actor)

        # Stage keys are no longer a fixed Literal (sql/16_custom_stages.sql
        # lets tenants add custom stages) — validate against this tenant's
        # configured stages instead, at the app layer. Falls back to the
        # original 13 if this tenant's config hasn't been lazy-seeded yet
        # (brand-new tenant that's never opened Settings > Pipeline Stages),
        # so this check can never become an accidental blocker.
        valid_stage = await conn.fetchval(
            "SELECT 1 FROM pipeline_stage_config WHERE tenant_id=$1 AND stage_key=$2",
            actor.tenant_id, body.stage)
        if not valid_stage:
            has_any_config = await conn.fetchval(
                "SELECT 1 FROM pipeline_stage_config WHERE tenant_id=$1 LIMIT 1", actor.tenant_id)
            if has_any_config or body.stage not in _DEFAULT_STAGE_KEYS:
                raise HTTPException(status_code=400, detail=f"Unknown stage '{body.stage}' — add it under Settings > Pipeline Stages first")

        # board_rank is a per-column drag-reorder position — moving to a
        # different stage always lands at the top of that column (matches
        # the frontend's optimistic prepend), so any old rank from the
        # previous column would be meaningless here and is cleared.
        row = await conn.fetchrow(
            f"""UPDATE applications SET stage = $1, board_rank = NULL, updated_at = now()
                WHERE id = $2 RETURNING {FIELDS}""",
            body.stage, application_id,
        )

        # Approved item 08 (AI Auto-Assignment Engine audit): recruiter_tasks
        # was real (CRUD + UI) but 100% manual — no stage transition ever
        # auto-created one. Only fires when the application already has an
        # assigned recruiter (nothing to hand a task to otherwise), and only
        # for stages where there's a genuinely distinct next action — not
        # every stage (sourced/contacted/hold etc. would just be task-list
        # noise with nothing concrete to do).
        _auto_task = _auto_task_for_stage(body.stage)
        if _auto_task and row["assigned_recruiter_id"]:
            _cand = await conn.fetchrow("SELECT full_name FROM candidates WHERE id=$1", row["candidate_id"])
            # Recommendation 3 (recruiter-assignment gap analysis): inherit
            # the parent requisition's real priority instead of a hardcoded
            # 'medium' — a critical-priority job's follow-up tasks previously
            # got no more urgency than a low-priority job's.
            _req_priority = await conn.fetchval(
                "SELECT priority FROM requisitions WHERE id=$1", row["requisition_id"]) or "medium"
            await conn.execute(
                """INSERT INTO recruiter_tasks
                     (tenant_id, requisition_id, application_id, candidate_name, recruiter_id, task_type, title, priority, status)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')""",
                actor.tenant_id, row["requisition_id"], application_id,
                _cand["full_name"] if _cand else None, row["assigned_recruiter_id"],
                _auto_task["type"], _auto_task["title"].format(name=_cand["full_name"] if _cand else "candidate"),
                _req_priority,
            )

        await events.write_outbox(
            conn, actor.tenant_id, "application.stage_changed",
            {
                "application_id": application_id,
                "from": old["stage"],
                "to": body.stage,
                "reason": body.reason,
            },
            f"application.stage_changed:{application_id}:{row['updated_at'].isoformat()}",
        )

        # This is the endpoint every manual stage move goes through (drag-
        # and-drop on the Kanban board, the drawer's stage buttons) — until
        # now it never wrote pipeline_movements or candidate_activities,
        # only the rule-engine auto-mover and the bulk-action endpoint did.
        # Result: the Pipeline Audit Log / stage-conversion-rate analytics
        # (both read pipeline_movements) were blind to the single most
        # common recruiter action, and a candidate's own Activity Timeline
        # never showed their real stage history. Skip on a same-stage no-op.
        if old["stage"] != body.stage:
            await conn.execute(
                """INSERT INTO pipeline_movements
                     (tenant_id, candidate_id, application_id, stage_from, stage_to, reason, triggered_by)
                   VALUES ($1,$2,$3,$4,$5,'manual_move',$6)""",
                actor.tenant_id, row["candidate_id"], application_id, old["stage"], body.stage,
                str(actor.user_id) if actor.user_id else "system",
            )
            await conn.execute(
                """INSERT INTO candidate_activities
                     (tenant_id, candidate_id, user_id, activity_type, title, description)
                   VALUES ($1,$2,$3,'status_change','Stage changed',$4)""",
                actor.tenant_id, row["candidate_id"], actor.user_id,
                f"{old['stage'].replace('_',' ').title()} → {body.stage.replace('_',' ').title()}",
            )
            _event_type = _stage_to_activity_event(body.stage)
            if _event_type and row["assigned_recruiter_id"]:
                await activity_events.log_recruiter_activity(
                    conn, actor.tenant_id, str(row["assigned_recruiter_id"]), _event_type,
                    candidate_id=str(row["candidate_id"]), application_id=application_id,
                    requisition_id=str(row["requisition_id"]) if row["requisition_id"] else None,
                )

        # Fetch candidate info INSIDE conn block (before connection is released)
        _notif_cand = await conn.fetchrow(
            "SELECT c.id as cid, c.email, c.full_name FROM applications a "
            "JOIN candidates c ON c.id=a.candidate_id WHERE a.id=$1", application_id)

        if body.stage == "rejected":
            if not body.reason_code:
                raise HTTPException(status_code=400, detail="reason_code is required when rejecting a candidate (see GET /rejection-reasons)")
            reason_row = await conn.fetchrow(
                "SELECT code, label FROM rejection_reasons WHERE tenant_id=$1 AND code=$2 AND is_active",
                actor.tenant_id, body.reason_code)
            if not reason_row:
                raise HTTPException(status_code=400, detail=f"Unknown rejection reason_code '{body.reason_code}' — see GET /rejection-reasons")

            await conn.execute(
                """INSERT INTO application_rejections
                     (tenant_id, application_id, candidate_id, requisition_id, reason_code, reason_label, notes, rejected_by)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8)""",
                actor.tenant_id, application_id, row["candidate_id"], row["requisition_id"],
                reason_row["code"], reason_row["label"], body.reason, actor.user_id,
            )

            await events.write_assignment_event(
                conn, actor.tenant_id, "candidate.rejected",
                reason=body.reason, actor_user_id=actor.user_id,
                metadata={"application_id": application_id, "from_stage": old["stage"], "reason_code": reason_row["code"]},
            )
            await events.write_audit(
                conn, actor.tenant_id, actor.user_id, "reject", "application", application_id,
                before={"stage": old["stage"]},
                after={"stage": "rejected", "reason_code": reason_row["code"], "reason_label": reason_row["label"], "notes": body.reason},
            )

            # Structured feedback shared directly with the recruiter — a
            # real notification, not just a free-text audit-log entry they'd
            # have to go dig up. Falls back to the manager role if the
            # application has no assigned recruiter. Matches the working
            # notifications-insert convention (nda.py/scheduler.py) — the
            # message/status-column mismatch bug documented earlier in
            # CLAUDE.md means this exact column set matters.
            _rej_cand = await conn.fetchrow("SELECT full_name FROM candidates WHERE id=$1", row["candidate_id"])
            _rej_req = await conn.fetchrow("SELECT title FROM requisitions WHERE id=$1", row["requisition_id"]) if row["requisition_id"] else None
            _notif_title = f"Candidate rejected: {_rej_cand['full_name'] if _rej_cand else 'Candidate'}"
            _notif_body = f"{_rej_req['title'] if _rej_req else 'Role'} — {reason_row['label']}" + (f". {body.reason}" if body.reason else "")
            if row["assigned_recruiter_id"]:
                await conn.execute(
                    """INSERT INTO notifications (tenant_id,user_id,recipient_user_id,title,body,type,resource,resource_id,channel)
                       VALUES ($1,$2,$2,$3,$4,'warning','application',$5,'inapp')""",
                    actor.tenant_id, row["assigned_recruiter_id"], _notif_title, _notif_body, application_id,
                )
            else:
                await conn.execute(
                    """INSERT INTO notifications (tenant_id,recipient_role,title,body,type,resource,resource_id,channel)
                       VALUES ($1,'manager',$2,$3,'warning','application',$4,'inapp')""",
                    actor.tenant_id, _notif_title, _notif_body, application_id,
                )
            try:
                from routers.final_features import notify_event
                await notify_event(actor.tenant_id, "candidate_rejected", f"❌ {_notif_title} — {_notif_body}",
                                    {"application_id": application_id, "reason_code": reason_row["code"]})
            except Exception:
                pass  # webhook delivery is best-effort, never blocks the actual stage change

    # Send notification using candidate info fetched inside conn block
    try:
        if _notif_cand and _notif_cand["email"] and body.send_email:
            import asyncio
            asyncio.create_task(_notify_stage_change_bg(
                _notif_cand["cid"], body.stage,
                _notif_cand["email"], _notif_cand["full_name"],
                actor.tenant_id,
                custom_msg=body.custom_message,
                requisition_id=row["requisition_id"],
                application_id=application_id,
            ))
    except Exception as _ex:
        print(f"Stage notification error: {_ex}")
    return dict(row)

@router.get("/{application_id}/notes")
async def get_app_notes(application_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT app_notes FROM applications WHERE id = $1", application_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Application not found")
    notes = row["app_notes"] or []
    if isinstance(notes, str):
        notes = json.loads(notes)
    return notes

@router.post("/{application_id}/notes")
async def add_app_note(application_id: str, body: dict, actor: Actor = Depends(get_actor)):
    import uuid as _uuid
    from datetime import datetime, timezone
    text = body.get("note", "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Note text required")
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT app_notes FROM applications WHERE id = $1", application_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Application not found")
        notes = row["app_notes"] or []
        if isinstance(notes, str):
            notes = json.loads(notes)
        new_note = {
            "id": str(_uuid.uuid4()),
            "text": text,
            "author": body.get("author", "Recruiter"),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        notes = [new_note] + list(notes)
        await conn.execute(
            "UPDATE applications SET app_notes = $1 WHERE id = $2",
            json.dumps(notes), application_id,
        )
    return new_note
