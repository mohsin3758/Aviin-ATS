import json
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException

import db
import events, asyncio
from deps import Actor, get_actor
from schemas import ApplicationCreate, StageUpdate

router = APIRouter(prefix="/applications", tags=["applications"])

FIELDS = """id, tenant_id, requisition_id, candidate_id, stage, fit_score,
            assigned_recruiter_id, created_at, updated_at"""



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
                   WHERE a.stage = $1
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
                   ORDER BY a.created_at DESC LIMIT $1""",
                limit)
    return [dict(r) for r in rows]

@router.post("")
async def create_application(body: ApplicationCreate, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        existing = await conn.fetchval(
            "SELECT id FROM applications WHERE requisition_id = $1 AND candidate_id = $2",
            body.requisition_id, body.candidate_id,
        )
        if existing:
            raise HTTPException(status_code=409, detail="Application already exists for this candidate/requisition")

        # allow stage override (default 'sourced')
        initial_stage = body.stage or 'sourced'
        row = await conn.fetchrow(
            f"""INSERT INTO applications (tenant_id, requisition_id, candidate_id, assigned_recruiter_id, stage)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING {FIELDS}""",
            actor.tenant_id, body.requisition_id, body.candidate_id, body.assigned_recruiter_id, initial_stage,
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

    # Send notification using candidate info fetched inside conn block
    try:
        if _notif_cand and _notif_cand["email"] and body.send_email:
            import asyncio
            asyncio.create_task(_notify_stage_change_bg(
                _notif_cand["cid"], body.stage,
                _notif_cand["email"], _notif_cand["full_name"],
                actor.tenant_id,
                custom_msg=body.custom_message
            ))
    except Exception as _ex:
        print(f"Stage notification error: {_ex}")
    return dict(row)


@router.get("/{application_id}")
async def get_application(application_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(f"SELECT {FIELDS} FROM applications WHERE id = $1", application_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Application not found")
    # Send notification using candidate info fetched inside conn block
    try:
        if _notif_cand and _notif_cand["email"] and body.send_email:
            import asyncio
            asyncio.create_task(_notify_stage_change_bg(
                _notif_cand["cid"], body.stage,
                _notif_cand["email"], _notif_cand["full_name"],
                actor.tenant_id,
                custom_msg=body.custom_message
            ))
    except Exception as _ex:
        print(f"Stage notification error: {_ex}")
    return dict(row)




async def _notify_stage_change_bg(candidate_id, stage, email, name, tenant_id, custom_msg=None):
    """Background: WhatsApp + email + n8n on stage change."""
    import httpx, smtplib, os
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart

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
            wa_text = wa_text.replace("{name}", str(name))

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

    # n8n webhook
    try:
        async with httpx.AsyncClient(timeout=5.0) as cli:
            await cli.post("http://n8n:5678/webhook/aviin-stage-change",
                json={"candidate_name": name, "stage_to": stage, "candidate_id": str(candidate_id)},
                timeout=3.0)
    except Exception:
        pass

    # Email notification for key stages - reads SMTP from email_settings DB
    if email and stage in SUBJS and msg_text:
        try:
            import asyncpg, os as _os
            _db_url = _os.environ.get("DATABASE_URL","postgresql://app_user:apppw@db:5432/ats")
            _conn = await asyncpg.connect(_db_url)
            try:
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
                    _body = "Dear " + str(name) + "," + chr(10) + chr(10) + str(msg_text) + chr(10) + chr(10) + "Best regards," + chr(10) + "AVIIN Jobs Services" + chr(10) + "https://ats.aviinjobs.com"
                    _em.attach(MIMEText(_body,"plain"))
                    with smtplib.SMTP(_h, _p, timeout=10) as _s:
                        _s.ehlo()
                        if _tls and _p==587: _s.starttls(); _s.ehlo()
                        if _u: _s.login(_u, _pw)
                        _s.sendmail(_f, [email], _em.as_string())
                    print(f"Stage email [{stage}] sent to {email} ({name})")
                else:
                    print("Stage email: no active SMTP config found")
            finally:
                await _conn.close()
        except Exception as _ex:
            print(f"Stage email failed [{stage}] to {email}: {_ex}")

@router.patch("/{application_id}/stage")
async def update_stage(application_id: str, body: StageUpdate, actor: Actor = Depends(get_actor)):
    # HARD RULE #10: rejecting a candidate is a HITL-gated, high-stakes action.
    if body.stage == "rejected" and actor.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Rejecting a candidate requires manager/admin role (HITL)")

    async with db.tenant_conn(actor.tenant_id) as conn:
        old = await conn.fetchrow("SELECT stage FROM applications WHERE id = $1", application_id)
        if old is None:
            raise HTTPException(status_code=404, detail="Application not found")

        row = await conn.fetchrow(
            f"""UPDATE applications SET stage = $1, updated_at = now()
                WHERE id = $2 RETURNING {FIELDS}""",
            body.stage, application_id,
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
        # Fetch candidate info INSIDE conn block (before connection is released)
        _notif_cand = await conn.fetchrow(
            "SELECT c.id as cid, c.email, c.full_name FROM applications a "
            "JOIN candidates c ON c.id=a.candidate_id WHERE a.id=$1", application_id)

        if body.stage == "rejected":
            await events.write_assignment_event(
                conn, actor.tenant_id, "candidate.rejected",
                reason=body.reason, actor_user_id=actor.user_id,
                metadata={"application_id": application_id, "from_stage": old["stage"]},
            )
            await events.write_audit(
                conn, actor.tenant_id, actor.user_id, "reject", "application", application_id,
                before={"stage": old["stage"]}, after={"stage": "rejected", "reason": body.reason},
            )

    # Send notification using candidate info fetched inside conn block
    try:
        if _notif_cand and _notif_cand["email"] and body.send_email:
            import asyncio
            asyncio.create_task(_notify_stage_change_bg(
                _notif_cand["cid"], body.stage,
                _notif_cand["email"], _notif_cand["full_name"],
                actor.tenant_id,
                custom_msg=body.custom_message
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
