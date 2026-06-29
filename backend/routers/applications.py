from fastapi import APIRouter, Depends, HTTPException

import db
import events, asyncio
from deps import Actor, get_actor
from schemas import ApplicationCreate, StageUpdate

router = APIRouter(prefix="/applications", tags=["applications"])

FIELDS = """id, tenant_id, requisition_id, candidate_id, stage, fit_score,
            assigned_recruiter_id, created_at, updated_at"""


@router.post("")
async def create_application(body: ApplicationCreate, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        existing = await conn.fetchval(
            "SELECT id FROM applications WHERE requisition_id = $1 AND candidate_id = $2",
            body.requisition_id, body.candidate_id,
        )
        if existing:
            raise HTTPException(status_code=409, detail="Application already exists for this candidate/requisition")

        row = await conn.fetchrow(
            f"""INSERT INTO applications (tenant_id, requisition_id, candidate_id, assigned_recruiter_id)
                VALUES ($1, $2, $3, $4)
                RETURNING {FIELDS}""",
            actor.tenant_id, body.requisition_id, body.candidate_id, body.assigned_recruiter_id,
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

    return dict(row)


@router.get("/{application_id}")
async def get_application(application_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(f"SELECT {FIELDS} FROM applications WHERE id = $1", application_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Application not found")
    return dict(row)




async def _notify_stage_change_bg(candidate_id, stage, email, name, tenant_id):
    """Background: WhatsApp + email + n8n on stage change."""
    import httpx, smtplib, os
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart

    MSGS = {
        "screened": f"Hi {name}, your profile has been shortlisted by AVIIN Jobs. Our recruiter will be in touch soon.",
        "submitted": f"Hi {name}, your profile has been submitted to the client. We will update you on progress.",
        "interview": f"Hi {name}, you have been selected for an interview! Please check your email for details.",
        "offer": f"Hi {name}, great news - an offer is being prepared for you! Our team will call you shortly.",
        "placed": f"Hi {name}, congratulations on your placement! Wishing you success in your new role.",
        "rejected": f"Hi {name}, thank you for your interest. We will keep your profile for future opportunities.",
    }
    msg_text = MSGS.get(stage, "")
    SUBJS = {
        "interview": "Interview Scheduled - AVIIN Jobs",
        "offer": "Offer Update - AVIIN Jobs",
        "placed": "Placement Confirmation - AVIIN Jobs",
        "screened": "Application Update - AVIIN Jobs",
    }

    async with httpx.AsyncClient(timeout=5.0) as cli:
        # WhatsApp via WAHA
        try:
            waha_key = os.environ.get("WAHA_API_KEY","2037c635e42c471a9f2032800ee6ff5b")
            waha_url = os.environ.get("WAHA_URL","http://waha:3000")
            if msg_text:
                phone = "91" + str(candidate_id)[:10]  # placeholder
                # Try to get real phone from DB in background
                await cli.post(f"{waha_url}/api/sendText",
                    headers={"X-Api-Key": waha_key},
                    json={"chatId": "status@broadcast", "text": f"Stage: {name} -> {stage}", "session": "default"},
                    timeout=3.0)
        except Exception:
            pass
        # n8n webhook
        try:
            await cli.post("http://n8n:5678/webhook/aviin-stage-change",
                json={"candidate_name": name, "stage_to": stage, "candidate_id": str(candidate_id)},
                timeout=3.0)
        except Exception:
            pass

    # Email notification for key stages
    if email and stage in SUBJS:
        try:
            smtp_host = os.environ.get("SMTP_HOST","mailhog")
            smtp_port = int(os.environ.get("SMTP_PORT","1025"))
            smtp_from = os.environ.get("SMTP_FROM","noreply@aviinjobs.com")
            em = MIMEMultipart(); em["Subject"] = SUBJS[stage]; em["From"] = smtp_from; em["To"] = email
            em.attach(MIMEText(f"Dear {name},\n\n{msg_text}\n\nBest regards,\nAVIIN Jobs Team","plain"))
            with smtplib.SMTP(smtp_host, smtp_port, timeout=5) as s:
                s.sendmail(smtp_from,[email],em.as_string())
        except Exception:
            pass

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

    return dict(row)
