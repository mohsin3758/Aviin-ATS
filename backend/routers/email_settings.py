from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
import db, smtplib, imaplib
from deps import Actor, get_actor

router = APIRouter(prefix="/settings/email", tags=["email-settings"])

class EmailBody(BaseModel):
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = 587
    smtp_user: Optional[str] = None
    smtp_password: Optional[str] = None
    smtp_from: Optional[str] = None
    smtp_from_name: Optional[str] = "AVIIN ATS"
    smtp_tls: Optional[bool] = True
    imap_host: Optional[str] = None
    imap_port: Optional[int] = 993
    imap_user: Optional[str] = None
    imap_password: Optional[str] = None
    is_active: Optional[bool] = None
    notification_mode: Optional[str] = 'manual'  # 'auto' or 'manual'
    stage_templates: Optional[dict] = None  # {stage: {subject, message}}

@router.get("")
async def get_settings(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("SELECT * FROM email_settings WHERE tenant_id=$1", actor.tenant_id)
        if not row:
            return {"configured": False}
        d = dict(row)
        if d.get("smtp_password"): d["smtp_password"] = "***configured***"
        if d.get("imap_password"): d["imap_password"] = "***configured***"
        d["configured"] = bool(d.get("smtp_host"))
        if d.get("stage_templates") is None:
            d["stage_templates"] = {}
        if isinstance(d.get("stage_templates"), str):
            import json as _j; d["stage_templates"] = _j.loads(d["stage_templates"] or "{}")
        d["notification_mode"] = d.get("notification_mode") or "manual"
        return d

@router.put("")
async def save_settings(body: EmailBody, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        existing = await conn.fetchval("SELECT id FROM email_settings WHERE tenant_id=$1", actor.tenant_id)
        d = {k: v for k, v in body.model_dump().items() if v is not None}
        if d.get("smtp_password") == "***configured***":
            d.pop("smtp_password", None)
        if d.get("imap_password") == "***configured***":
            d.pop("imap_password", None)
        if existing:
            if d:
                import json as _json2
                # Handle stage_templates separately (needs JSONB cast)
                _st2 = d.pop('stage_templates', None)
                _nm2 = d.pop('notification_mode', None)
                if d:
                    fields = ', '.join(f'{k}=${i+2}' for i, k in enumerate(d.keys()))
                    await conn.execute(
                        f'UPDATE email_settings SET {fields}, updated_at=NOW() WHERE tenant_id=$1',
                        actor.tenant_id, *d.values()
                    )
                if _nm2 is not None:
                    await conn.execute(
                        'UPDATE email_settings SET notification_mode=$2, updated_at=NOW() WHERE tenant_id=$1',
                        actor.tenant_id, _nm2
                    )
                if _st2 is not None:
                    await conn.execute(
                        "UPDATE email_settings SET stage_templates=$2::jsonb, updated_at=NOW() WHERE tenant_id=$1",
                        actor.tenant_id, _json2.dumps(_st2)
                    )
        else:
            b = body.model_dump()
            import json as _json
            _st = body.stage_templates
            _st_json = _json.dumps(_st) if _st else '{}'
            await conn.execute("""
                INSERT INTO email_settings
                (tenant_id, smtp_host, smtp_port, smtp_user, smtp_password,
                 smtp_from, smtp_from_name, smtp_tls,
                 imap_host, imap_port, imap_user, imap_password, is_active,
                 notification_mode, stage_templates)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)
            """, actor.tenant_id, b.get("smtp_host"), b.get("smtp_port", 587),
                b.get("smtp_user"), b.get("smtp_password"), b.get("smtp_from"),
                b.get("smtp_from_name", "AVIIN ATS"), b.get("smtp_tls", True),
                b.get("imap_host"), b.get("imap_port", 993),
                b.get("imap_user"), b.get("imap_password"), b.get("is_active", False),
                b.get("notification_mode", "manual"), _st_json)
    return {"success": True, "message": "Email settings saved"}

@router.post("/test")
async def test_connection(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("SELECT * FROM email_settings WHERE tenant_id=$1", actor.tenant_id)
        if not row:
            raise HTTPException(400, "No email settings configured. Save settings first.")
        smtp_ok, smtp_err, imap_ok, imap_err = False, None, False, None
        try:
            with smtplib.SMTP(row["smtp_host"], row["smtp_port"], timeout=10) as s:
                s.ehlo()
                if row["smtp_tls"] and row["smtp_port"] == 587:
                    s.starttls()
                    s.ehlo()
                if row["smtp_user"] and row["smtp_password"]:
                    s.login(row["smtp_user"], row["smtp_password"])
                smtp_ok = True
        except Exception as e:
            smtp_err = str(e)
        if row.get("imap_host"):
            try:
                M = imaplib.IMAP4_SSL(row["imap_host"], row["imap_port"])
                M.login(row["imap_user"], row["imap_password"])
                M.logout()
                imap_ok = True
            except Exception as e:
                imap_err = str(e)
        status = "success" if smtp_ok else "failed"
        await conn.execute(
            "UPDATE email_settings SET last_tested_at=NOW(), last_test_status=$2, last_test_error=$3 WHERE tenant_id=$1",
            actor.tenant_id, status, smtp_err
        )
        return {"smtp": {"ok": smtp_ok, "error": smtp_err}, "imap": {"ok": imap_ok, "error": imap_err}, "overall": smtp_ok}

@router.post("/send-test")
async def send_test_email(to_email: str = Query(None, description="Recipient email address"), actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("SELECT * FROM email_settings WHERE tenant_id=$1", actor.tenant_id)
        if not row or not row["smtp_host"]:
            raise HTTPException(400, "No SMTP configured. Save settings first.")
        admin = await conn.fetchrow(
            "SELECT email FROM users WHERE tenant_id=$1 AND role='admin' LIMIT 1", actor.tenant_id)
        to = to_email if to_email else row["smtp_user"]
        try:
            import email.mime.text as mt
            import email.mime.multipart as mm
            msg = mm.MIMEMultipart()
            msg["Subject"] = "AVIIN ATS - Email Configuration Test"
            msg["From"] = f"{row['smtp_from_name']} <{row['smtp_from']}>"
            msg["To"] = to
            body = (
                f"Hello,\n\nThis is a test email from AVIIN ATS.\n\n"
                f"SMTP Host: {row['smtp_host']}:{row['smtp_port']}\n"
                f"From: {row['smtp_from']}\n\n"
                f"Your email configuration is working!\n\n"
                f"Best regards,\nAVIIN ATS\nhttps://ats.aviinjobs.com"
            )
            msg.attach(mt.MIMEText(body, "plain"))
            with smtplib.SMTP(row["smtp_host"], row["smtp_port"], timeout=10) as s:
                s.ehlo()
                if row["smtp_tls"] and row["smtp_port"] == 587:
                    s.starttls()
                    s.ehlo()
                s.login(row["smtp_user"], row["smtp_password"])
                s.sendmail(row["smtp_from"], [to], msg.as_string())
            return {"success": True, "sent_to": to, "message": f"Test email sent to {to}"}
        except Exception as e:
            raise HTTPException(500, f"Send failed: {str(e)}")
