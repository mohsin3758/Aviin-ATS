"""Phase R2 - Communication Hub (webmail v3 - full featured)"""
import os, smtplib, threading
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional, List
import json
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
import httpx
import db
from deps import Actor, get_actor

router = APIRouter(prefix="/communications", tags=["communications"])
WAHA_BASE = os.getenv("WAHA_URL", "http://waha:3000")
WAHA_KEY = os.getenv("WAHA_API_KEY", "aviinATS2026secure")
WAHA_SESSION = "default"

MSG_COLS = """cm.id, cm.candidate_id,
    COALESCE(c.full_name, cm.to_email, 'External') AS candidate_name,
    COALESCE(c.email, cm.to_email) AS email, c.phone,
    cm.channel, cm.direction, cm.subject, cm.body, cm.status,
    cm.stage_at_send, cm.created_at, cm.deleted_at,
    cm.is_read, cm.is_starred, cm.to_email, cm.cc,
    u.full_name AS sent_by_name"""

MSG_JOINS = """FROM candidate_messages cm
    LEFT JOIN candidates c ON c.id=cm.candidate_id
    LEFT JOIN users u ON u.id=cm.sent_by"""


async def _get_smtp(conn, tenant_id: str):
    return await conn.fetchrow(
        "SELECT smtp_host,smtp_port,smtp_user,smtp_password,smtp_from,smtp_from_name,smtp_tls "
        "FROM email_settings WHERE tenant_id=$1 AND is_active=TRUE LIMIT 1", tenant_id)


def _send_email_bg(smtp, to_email, subject, body_html, cc=None, bcc=None):
    def go():
        try:
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject or "(no subject)"
            msg["From"] = f"{smtp['smtp_from_name']} <{smtp['smtp_from']}>"
            msg["To"] = to_email
            if cc: msg["Cc"] = cc if isinstance(cc,str) else ", ".join(cc)
            rcpts = [to_email]
            if cc: rcpts += ([cc] if isinstance(cc,str) else cc)
            if bcc: rcpts += ([bcc] if isinstance(bcc,str) else bcc)
            if "<" in (body_html or "") and ">" in (body_html or ""):
                msg.attach(MIMEText(body_html, "html"))
            else:
                msg.attach(MIMEText(body_html or "", "plain"))
            with smtplib.SMTP(smtp["smtp_host"], smtp["smtp_port"] or 587, timeout=10) as s:
                s.ehlo()
                if smtp["smtp_tls"] and (smtp["smtp_port"] or 587) == 587:
                    s.starttls(); s.ehlo()
                if smtp["smtp_user"]:
                    s.login(smtp["smtp_user"], smtp["smtp_password"])
                s.sendmail(smtp["smtp_from"], rcpts, msg.as_string())
            print(f"Email sent to {to_email}")
        except Exception as ex:
            print(f"Email error: {ex}")
    threading.Thread(target=go, daemon=True).start()


async def _send_wa(phone: str, message: str) -> bool:
    p = phone.strip().replace(" ","").replace("-","")
    if not p.startswith("+"): p = "+91" + p.lstrip("0")[-10:]
    chat_id = p.lstrip("+") + "@c.us"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(f"{WAHA_BASE}/api/sendText",
                headers={"X-Api-Key": WAHA_KEY, "Content-Type": "application/json"},
                json={"session": WAHA_SESSION, "chatId": chat_id, "text": message})
            return r.status_code < 400
    except Exception as ex:
        print(f"WhatsApp error: {ex}"); return False


async def _log(conn, tenant_id, cand_id, app_id, channel, subject, body, status,
               sent_by, tmpl_id=None, stage=None, to_email=None, cc=None):
    try:
        await conn.execute(
            """INSERT INTO candidate_messages
               (tenant_id,candidate_id,application_id,channel,direction,subject,body,
                status,sent_by,template_id,stage_at_send,is_read,to_email,cc)
               VALUES($1,$2,$3,$4,'outbound',$5,$6,$7,$8,$9,$10,TRUE,$11,$12)""",
            tenant_id, cand_id, app_id, channel, subject, body, status,
            sent_by, tmpl_id, stage, to_email, cc)
    except Exception as ex:
        print(f"Log error: {ex}")


# ── Models ─────────────────────────────────────────────────────────────────────

class SendMsg(BaseModel):
    candidate_id: Optional[str] = None
    to_email: Optional[str] = None      # free-form email recipient
    to_name: Optional[str] = None
    channel: str = "email"
    subject: Optional[str] = None
    message: str
    cc: Optional[str] = None
    bcc: Optional[str] = None
    application_id: Optional[str] = None
    template_id: Optional[str] = None
    stage: Optional[str] = None

class BulkMsg(BaseModel):
    requisition_id: Optional[str] = None
    stage: Optional[str] = None
    candidate_ids: Optional[List[str]] = None
    channel: str = "email"
    subject: Optional[str] = None
    message: str
    template_id: Optional[str] = None

class DraftBody(BaseModel):
    candidate_id: Optional[str] = None
    to_email: Optional[str] = None
    to_name: Optional[str] = None
    channel: str = "email"
    subject: Optional[str] = None
    body: str = ""
    cc: Optional[str] = None


# ── Folder endpoints ───────────────────────────────────────────────────────────

@router.get("/inbox")
async def inbox(limit: int = Query(50, le=500), offset: int = Query(0), channel: Optional[str] = None,
                actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        # ---- Outbound ATS messages ----
        w = "WHERE cm.tenant_id=$1 AND cm.is_deleted IS NOT TRUE"
        p = [actor.tenant_id]
        if channel and channel not in ('imap', 'inbound'):
            p.append(channel); w += f" AND cm.channel=${len(p)}"
        p.append(limit)
        outbound = await conn.fetch(f"""
            SELECT DISTINCT ON (COALESCE(cm.candidate_id::text, cm.to_email))
                {MSG_COLS},
                (SELECT COUNT(*) FROM candidate_messages cm2
                 WHERE cm2.tenant_id=cm.tenant_id
                 AND COALESCE(cm2.candidate_id::text,cm2.to_email)=COALESCE(cm.candidate_id::text,cm.to_email)
                 AND cm2.is_deleted IS NOT TRUE) AS msg_count,
                (SELECT COUNT(*) FROM candidate_messages cm3
                 WHERE cm3.tenant_id=cm.tenant_id
                 AND COALESCE(cm3.candidate_id::text,cm3.to_email)=COALESCE(cm.candidate_id::text,cm.to_email)
                 AND cm3.is_deleted IS NOT TRUE AND cm3.is_read IS NOT TRUE) AS unread_count
            {MSG_JOINS}
            {w}
            ORDER BY COALESCE(cm.candidate_id::text, cm.to_email), cm.created_at DESC
            LIMIT ${len(p)}""", *p)

        # ---- Inbound IMAP messages ----
        imap_rows = []
        if not channel or channel in ('email', 'imap', 'inbound'):
            imap_rows = await conn.fetch("""
                SELECT
                    im.id,
                    im.candidate_id,
                    COALESCE(NULLIF(im.from_name,''), NULLIF(im.from_email,''), 'Unknown Sender') AS candidate_name,
                    im.from_email AS email,
                    im.folder AS imap_folder,
                    im.imap_uid AS imap_uid,
                    NULL::text AS phone,
                    'email'::text AS channel,
                    'inbound'::text AS direction,
                    COALESCE(im.subject, '(no subject)') AS subject,
                    COALESCE(im.html_body, im.body, '') AS body,
                    'received'::text AS status,
                    im.received_at AS created_at,
                    NULL::text AS deleted_at,
                    ua.display_name AS sent_by_name,
                    im.is_read,
                    im.is_starred,
                    im.to_email,
                    im.cc,
                    1::bigint AS msg_count,
                    (CASE WHEN im.is_read THEN 0 ELSE 1 END)::bigint AS unread_count,
                    im.snoozed_until,
                    CASE 
                        WHEN im.attachments IS NOT NULL AND jsonb_array_length(im.attachments) > 0
                        THEN (SELECT jsonb_agg(jsonb_build_object('filename', a->>'filename', 'mime_type', a->>'mime_type', 'size', (a->>'size')::int))
                              FROM jsonb_array_elements(im.attachments) a)
                        ELSE '[]'::jsonb
                    END AS attachments
                FROM imap_messages im
                JOIN user_email_accounts ua ON ua.id = im.account_id
                WHERE im.tenant_id = $1 AND ua.user_id = $2
                  AND im.is_deleted IS NOT TRUE
                  AND im.folder = 'INBOX'
                ORDER BY im.received_at DESC
                LIMIT $3 OFFSET $4
            """, actor.tenant_id, actor.user_id, limit, offset)

        all_msgs = [dict(r) for r in outbound] + [dict(r) for r in imap_rows]
        # Parse JSONB attachments field (asyncpg returns as string)
        for m in all_msgs:
            if 'attachments' in m and isinstance(m['attachments'], str):
                try:
                    m['attachments'] = json.loads(m['attachments'])
                except Exception:
                    m['attachments'] = []
        all_msgs.sort(key=lambda x: str(x.get('created_at') or ''), reverse=True)
        return all_msgs[:limit]


@router.get("/thread/{cand_id}")
async def get_thread(cand_id: str, actor: Actor = Depends(get_actor)):
    """All messages for a candidate thread"""
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(f"""
            SELECT {MSG_COLS} {MSG_JOINS}
            WHERE cm.candidate_id=$1 AND cm.tenant_id=$2 AND cm.is_deleted IS NOT TRUE
            ORDER BY cm.created_at ASC""", cand_id, actor.tenant_id)
        cand = await conn.fetchrow(
            "SELECT full_name,email,phone FROM candidates WHERE id=$1", cand_id)
        # Mark all as read
        await conn.execute(
            "UPDATE candidate_messages SET is_read=TRUE WHERE candidate_id=$1 AND tenant_id=$2",
            cand_id, actor.tenant_id)
        return {"candidate": dict(cand) if cand else None,
                "messages": [dict(r) for r in rows], "total": len(rows)}



@router.get("/inbox-count")
async def inbox_count(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        ats_cnt = await conn.fetchval("SELECT COUNT(*) FROM candidate_messages WHERE tenant_id=$1 AND is_deleted IS NOT TRUE", actor.tenant_id)
        imap_cnt = await conn.fetchval("""SELECT COUNT(*) FROM imap_messages im JOIN user_email_accounts ua ON ua.id=im.account_id WHERE im.tenant_id=$1 AND ua.user_id=$2 AND im.is_deleted IS NOT TRUE AND im.folder = 'INBOX'""", actor.tenant_id, actor.user_id)
        by_folder = await conn.fetch("""SELECT im.folder, COUNT(*) as cnt FROM imap_messages im JOIN user_email_accounts ua ON ua.id=im.account_id WHERE im.tenant_id=$1 AND ua.user_id=$2 GROUP BY im.folder ORDER BY cnt DESC""", actor.tenant_id, actor.user_id)
        return {"total": (ats_cnt or 0)+(imap_cnt or 0), "ats": ats_cnt or 0, "imap": imap_cnt or 0, "by_folder": [dict(r) for r in by_folder]}

@router.get("/sent")
async def sent(limit: int = Query(200, le=500), actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        ats_rows = await conn.fetch(f"""
            SELECT {MSG_COLS} {MSG_JOINS}
            WHERE cm.tenant_id=$1 AND cm.direction='outbound' AND cm.is_deleted IS NOT TRUE
              AND cm.channel != 'email'
            ORDER BY cm.created_at DESC LIMIT $2""", actor.tenant_id, limit)
        imap_sent = await conn.fetch("""
            SELECT
                im.id, im.candidate_id,
                COALESCE(NULLIF(im.from_name,''), NULLIF(im.from_email,''), 'Unknown Sender') AS candidate_name,
                im.to_email AS email,
                im.folder AS imap_folder, im.imap_uid AS imap_uid,
                NULL::text AS phone, 'email'::text AS channel, 'outbound'::text AS direction,
                COALESCE(im.subject, '(no subject)') AS subject,
                COALESCE(im.html_body, im.body, '') AS body,
                'sent'::text AS status,
                im.received_at AS created_at, NULL::text AS deleted_at,
                ua.display_name AS sent_by_name,
                TRUE AS is_read,
                im.is_starred,
                im.to_email AS to_email,
                im.cc,
                1::bigint AS msg_count,
                0::bigint AS unread_count,
                CASE WHEN im.attachments IS NOT NULL AND jsonb_array_length(im.attachments) > 0
                     THEN (SELECT jsonb_agg(jsonb_build_object('filename', a->>'filename', 'mime_type', a->>'mime_type', 'size', (a->>'size')::int))
                           FROM jsonb_array_elements(im.attachments) a)
                     ELSE '[]'::jsonb END AS attachments
            FROM imap_messages im
            JOIN user_email_accounts ua ON ua.id = im.account_id
            WHERE im.tenant_id = $1 AND ua.user_id = $2
              AND im.folder LIKE '%Sent%'
              AND im.is_deleted IS NOT TRUE
            ORDER BY im.received_at DESC LIMIT $3
            """, actor.tenant_id, actor.user_id, limit)
        all_msgs = [dict(r) for r in ats_rows] + [dict(r) for r in imap_sent]
        for m in all_msgs:
            if 'attachments' in m and isinstance(m['attachments'], str):
                try: m['attachments'] = json.loads(m['attachments'] or '[]')
                except: m['attachments'] = []
        all_msgs.sort(key=lambda x: str(x.get('created_at') or ''), reverse=True)
        return all_msgs[:limit]


@router.get("/trash")
async def trash_list(limit: int = Query(200, le=500), actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(f"""
            SELECT {MSG_COLS} {MSG_JOINS}
            WHERE cm.tenant_id=$1 AND cm.is_deleted=TRUE
            ORDER BY cm.deleted_at DESC LIMIT $2""", actor.tenant_id, limit)
        return [dict(r) for r in rows]


@router.get("/starred")
async def starred(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        ats_rows = await conn.fetch(f"""
            SELECT {MSG_COLS} {MSG_JOINS}
            WHERE cm.tenant_id=$1 AND cm.is_starred=TRUE AND cm.is_deleted IS NOT TRUE
            ORDER BY cm.created_at DESC LIMIT 200""", actor.tenant_id)
        imap_rows = await conn.fetch("""
            SELECT
                im.id, im.candidate_id,
                COALESCE(NULLIF(im.from_name,''), NULLIF(im.from_email,''), 'Unknown Sender') AS candidate_name,
                im.from_email AS email,
                im.folder AS imap_folder, im.imap_uid AS imap_uid,
                NULL::text AS phone, 'email'::text AS channel, 'inbound'::text AS direction,
                COALESCE(im.subject, '(no subject)') AS subject,
                COALESCE(im.html_body, im.body, '') AS body,
                'received'::text AS status,
                im.received_at AS created_at, NULL::text AS deleted_at,
                ua.display_name AS sent_by_name,
                im.is_read, im.is_starred,
                im.to_email, im.cc,
                1::bigint AS msg_count,
                (CASE WHEN im.is_read THEN 0 ELSE 1 END)::bigint AS unread_count,
                CASE WHEN im.attachments IS NOT NULL AND jsonb_array_length(im.attachments) > 0
                     THEN (SELECT jsonb_agg(jsonb_build_object('filename', a->>'filename', 'mime_type', a->>'mime_type', 'size', (a->>'size')::int))
                           FROM jsonb_array_elements(im.attachments) a)
                     ELSE '[]'::jsonb END AS attachments
            FROM imap_messages im
            JOIN user_email_accounts ua ON ua.id = im.account_id
            WHERE im.tenant_id = $1 AND ua.user_id = $2
              AND im.is_starred = TRUE AND im.is_deleted IS NOT TRUE
            ORDER BY im.received_at DESC LIMIT 200
            """, actor.tenant_id, actor.user_id)
        all_msgs = [dict(r) for r in ats_rows] + [dict(r) for r in imap_rows]
        for m in all_msgs:
            if 'attachments' in m and isinstance(m['attachments'], str):
                try: m['attachments'] = json.loads(m['attachments'] or '[]')
                except: m['attachments'] = []
        all_msgs.sort(key=lambda x: str(x.get('created_at') or ''), reverse=True)
        return all_msgs


@router.patch("/messages/{msg_id}/trash")
async def trash_message(msg_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        # Try candidate_messages first
        r = await conn.fetchrow(
            "UPDATE candidate_messages SET is_deleted=TRUE,deleted_at=NOW() WHERE id=$1 AND tenant_id=$2 RETURNING id",
            msg_id, actor.tenant_id)
        if r:
            return {"trashed": True}
        # Fallback: try imap_messages (IMAP emails use same trash endpoint)
        r2 = await conn.fetchrow(
            "UPDATE imap_messages SET is_deleted=TRUE WHERE id=$1 AND tenant_id=$2 RETURNING id",
            msg_id, actor.tenant_id)
        if not r2: raise HTTPException(404, "Message not found")
        return {"trashed": True}


@router.patch("/messages/{msg_id}/restore")
async def restore_message(msg_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        r = await conn.fetchrow(
            "UPDATE candidate_messages SET is_deleted=FALSE,deleted_at=NULL WHERE id=$1 AND tenant_id=$2 RETURNING id",
            msg_id, actor.tenant_id)
        if r:
            return {"restored": True}
        r2 = await conn.fetchrow(
            "UPDATE imap_messages SET is_deleted=FALSE WHERE id=$1 AND tenant_id=$2 RETURNING id",
            msg_id, actor.tenant_id)
        if not r2: raise HTTPException(404, "Message not found")
        return {"restored": True}


@router.delete("/messages/{msg_id}")
async def delete_perm(msg_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute(
            "DELETE FROM candidate_messages WHERE id=$1 AND tenant_id=$2",
            msg_id, actor.tenant_id)
        return {"deleted": True}


@router.patch("/messages/{msg_id}/read")
async def mark_read(msg_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute("UPDATE candidate_messages SET is_read=TRUE WHERE id=$1 AND tenant_id=$2", msg_id, actor.tenant_id)
        await conn.execute("UPDATE imap_messages SET is_read=TRUE WHERE id=$1 AND tenant_id=$2", msg_id, actor.tenant_id)
        return {"ok": True}


@router.patch("/messages/{msg_id}/unread")
async def mark_unread(msg_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute("UPDATE candidate_messages SET is_read=FALSE WHERE id=$1 AND tenant_id=$2", msg_id, actor.tenant_id)
        await conn.execute("UPDATE imap_messages SET is_read=FALSE WHERE id=$1 AND tenant_id=$2", msg_id, actor.tenant_id)
        return {"ok": True}


@router.patch("/messages/{msg_id}/star")
async def toggle_star(msg_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        r = await conn.fetchrow("UPDATE candidate_messages SET is_starred=NOT COALESCE(is_starred,FALSE) WHERE id=$1 AND tenant_id=$2 RETURNING is_starred", msg_id, actor.tenant_id)
        if not r:
            r = await conn.fetchrow("UPDATE imap_messages SET is_starred=NOT COALESCE(is_starred,FALSE) WHERE id=$1 AND tenant_id=$2 RETURNING is_starred", msg_id, actor.tenant_id)
        if not r: raise HTTPException(404, "Not found")
        return {"starred": r["is_starred"]}


# ── Drafts ─────────────────────────────────────────────────────────────────────

@router.get("/drafts")
async def list_drafts(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT d.id, d.candidate_id, c.full_name AS candidate_name,
                   COALESCE(c.email, d.to_email) AS email,
                   d.to_email, d.channel, d.subject, d.body, d.cc,
                   d.created_at, d.updated_at
            FROM message_drafts d
            LEFT JOIN candidates c ON c.id=d.candidate_id
            WHERE d.tenant_id=$1 ORDER BY d.updated_at DESC""", actor.tenant_id)
        cnt = await conn.fetchval(
            "SELECT COUNT(*) FROM message_drafts WHERE tenant_id=$1", actor.tenant_id)
        return {"drafts": [dict(r) for r in rows], "count": cnt}


@router.post("/drafts")
async def save_draft(body: DraftBody, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            INSERT INTO message_drafts (tenant_id,candidate_id,to_email,channel,subject,body,cc)
            VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id""",
            actor.tenant_id, body.candidate_id or None, body.to_email,
            body.channel, body.subject, body.body, body.cc)
        return {"id": str(row["id"]), "saved": True}


@router.put("/drafts/{draft_id}")
async def update_draft(draft_id: str, body: DraftBody, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        r = await conn.fetchrow("""
            UPDATE message_drafts
            SET candidate_id=$1,to_email=$2,channel=$3,subject=$4,body=$5,cc=$6,updated_at=NOW()
            WHERE id=$7 AND tenant_id=$8 RETURNING id""",
            body.candidate_id or None, body.to_email, body.channel,
            body.subject, body.body, body.cc, draft_id, actor.tenant_id)
        if not r: raise HTTPException(404, "Draft not found")
        return {"id": draft_id, "saved": True}


@router.delete("/drafts/{draft_id}")
async def delete_draft(draft_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute(
            "DELETE FROM message_drafts WHERE id=$1 AND tenant_id=$2", draft_id, actor.tenant_id)
        return {"deleted": True}


# ── Send ────────────────────────────────────────────────────────────────────────

@router.post("/send")
async def send_msg(body: SendMsg, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        results = {}
        smtp = await _get_smtp(conn, actor.tenant_id)

        # Resolve recipient
        if body.candidate_id:
            cand = await conn.fetchrow(
                "SELECT full_name,email,phone FROM candidates WHERE id=$1 AND tenant_id=$2",
                body.candidate_id, actor.tenant_id)
            if not cand: raise HTTPException(404, "Candidate not found")
            to_email = cand["email"]
            to_name = cand["full_name"]
            to_phone = cand["phone"]
        elif body.to_email:
            to_email = body.to_email
            to_name = body.to_name or body.to_email
            to_phone = None
        else:
            raise HTTPException(400, "Provide candidate_id or to_email")

        if body.channel in ("email", "both"):
            if not to_email: results["email"] = "no_email"
            elif not smtp: results["email"] = "smtp_not_configured"
            else:
                subj = body.subject or "AVIIN Jobs Services"
                _send_email_bg(smtp, to_email, subj, body.message, body.cc, body.bcc)
                await _log(conn, actor.tenant_id, body.candidate_id, body.application_id,
                           "email", subj, body.message, "sent", str(actor.user_id),
                           body.template_id, body.stage, to_email, body.cc)
                results["email"] = "sent"

        if body.channel in ("whatsapp", "both"):
            phone = to_phone if body.candidate_id else None
            if not phone: results["whatsapp"] = "no_phone"
            else:
                ok = await _send_wa(phone, body.message)
                st = "sent" if ok else "failed"
                await _log(conn, actor.tenant_id, body.candidate_id, body.application_id,
                           "whatsapp", None, body.message, st, str(actor.user_id),
                           body.template_id, body.stage, to_email, None)
                results["whatsapp"] = st

        return {"success": True, "results": results, "to": to_name}


@router.post("/bulk-send")
async def bulk_send(body: BulkMsg, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        if body.candidate_ids:
            cands = await conn.fetch(
                "SELECT id,full_name,email,phone FROM candidates WHERE id=ANY($1::uuid[]) AND tenant_id=$2",
                body.candidate_ids, actor.tenant_id)
        elif body.stage and body.requisition_id:
            cands = await conn.fetch("""SELECT DISTINCT c.id,c.full_name,c.email,c.phone
                FROM applications a JOIN candidates c ON c.id=a.candidate_id
                WHERE a.stage=$1 AND a.requisition_id=$2::uuid AND a.tenant_id=$3""",
                body.stage, body.requisition_id, actor.tenant_id)
        elif body.stage:
            cands = await conn.fetch("""SELECT DISTINCT c.id,c.full_name,c.email,c.phone
                FROM applications a JOIN candidates c ON c.id=a.candidate_id
                WHERE a.stage=$1 AND a.tenant_id=$2""", body.stage, actor.tenant_id)
        else:
            raise HTTPException(400, "Provide stage or candidate_ids")
        smtp = await _get_smtp(conn, actor.tenant_id)
        sent = failed = skipped = 0
        for cand in cands:
            if body.channel in ("email","both"):
                if not cand["email"] or not smtp: skipped += 1
                else:
                    subj = body.subject or "AVIIN Jobs - Update"
                    _send_email_bg(smtp, cand["email"], subj, body.message)
                    await _log(conn, actor.tenant_id, str(cand["id"]), None, "email", subj,
                               body.message, "sent", str(actor.user_id), body.template_id, body.stage,
                               cand["email"], None)
                    sent += 1
            if body.channel in ("whatsapp","both"):
                if not cand["phone"]: skipped += 1
                else:
                    ok = await _send_wa(cand["phone"], body.message)
                    st = "sent" if ok else "failed"
                    await _log(conn, actor.tenant_id, str(cand["id"]), None, "whatsapp", None,
                               body.message, st, str(actor.user_id), body.template_id, body.stage,
                               None, None)
                    if ok: sent += 1
                    else: failed += 1
        return {"sent": sent, "failed": failed, "skipped": skipped, "total": len(cands)}


# ── Stats ───────────────────────────────────────────────────────────────────────

@router.get("/stats")
async def stats(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        inbox_cnt = await conn.fetchval(
            "SELECT COUNT(DISTINCT COALESCE(candidate_id::text,to_email)) FROM candidate_messages WHERE tenant_id=$1 AND is_deleted IS NOT TRUE",
            actor.tenant_id)
        imap_unread_cnt = await conn.fetchval("SELECT COUNT(*) FROM imap_messages im JOIN user_email_accounts ua ON ua.id=im.account_id WHERE im.tenant_id=$1 AND ua.user_id=$2 AND im.is_read IS NOT TRUE AND im.is_deleted IS NOT TRUE AND im.folder = 'INBOX'", actor.tenant_id, actor.user_id)
        unread_cnt_ats = await conn.fetchval(
            "SELECT COUNT(*) FROM candidate_messages WHERE tenant_id=$1 AND is_read IS NOT TRUE AND is_deleted IS NOT TRUE",
            actor.tenant_id)
        unread_cnt = (unread_cnt_ats or 0) + (imap_unread_cnt or 0)
        sent_cnt_ats = await conn.fetchval(
            "SELECT COUNT(*) FROM candidate_messages WHERE tenant_id=$1 AND direction='outbound' AND is_deleted IS NOT TRUE AND channel != 'email'",
            actor.tenant_id)
        sent_cnt_imap = await conn.fetchval(
            "SELECT COUNT(*) FROM imap_messages im JOIN user_email_accounts ua ON ua.id=im.account_id WHERE im.tenant_id=$1 AND ua.user_id=$2 AND im.folder LIKE '%Sent%' AND im.is_deleted IS NOT TRUE",
            actor.tenant_id, actor.user_id)
        sent_cnt = (sent_cnt_ats or 0) + (sent_cnt_imap or 0)
        draft_cnt = await conn.fetchval(
            "SELECT COUNT(*) FROM message_drafts WHERE tenant_id=$1", actor.tenant_id)
        trash_cnt = await conn.fetchval(
            "SELECT COUNT(*) FROM candidate_messages WHERE tenant_id=$1 AND is_deleted=TRUE", actor.tenant_id)
        starred_cnt_ats = await conn.fetchval(
            "SELECT COUNT(*) FROM candidate_messages WHERE tenant_id=$1 AND is_starred=TRUE AND is_deleted IS NOT TRUE",
            actor.tenant_id)
        starred_cnt_imap = await conn.fetchval(
            "SELECT COUNT(*) FROM imap_messages WHERE tenant_id=$1 AND is_starred=TRUE AND is_deleted IS NOT TRUE",
            actor.tenant_id)
        starred_cnt = (starred_cnt_ats or 0) + (starred_cnt_imap or 0)
        wa_cnt = await conn.fetchval(
            "SELECT COUNT(*) FROM candidate_messages WHERE tenant_id=$1 AND channel='whatsapp' AND is_deleted IS NOT TRUE",
            actor.tenant_id)
        return {"folder_counts": {
            "inbox": inbox_cnt, "sent": sent_cnt, "drafts": draft_cnt,
            "trash": trash_cnt, "starred": starred_cnt, "whatsapp": wa_cnt,
            "unread": unread_cnt
        }}


@router.get("/candidate/{cid}")
async def cand_thread_compat(cid: str, actor: Actor = Depends(get_actor)):
    return await get_thread(cid, actor)


@router.get("/whatsapp/status")
async def wa_status(actor: Actor = Depends(get_actor)):
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{WAHA_BASE}/api/sessions/{WAHA_SESSION}", headers={"X-Api-Key": WAHA_KEY})
            if r.status_code == 200: return {"connected": True, "session": r.json()}
            return {"connected": False, "status_code": r.status_code}
    except Exception as e:
        return {"connected": False, "error": str(e)}


@router.post("/whatsapp/start-session")
async def wa_start(actor: Actor = Depends(get_actor)):
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(f"{WAHA_BASE}/api/sessions/start",
                headers={"X-Api-Key": WAHA_KEY},
                json={"name": WAHA_SESSION, "config": {"debug": False}})
            return {"started": r.status_code < 400, "response": r.json() if r.content else {}}
    except Exception as e:
        return {"started": False, "error": str(e)}


@router.get("/whatsapp/qr")
async def wa_qr(actor: Actor = Depends(get_actor)):
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(f"{WAHA_BASE}/api/{WAHA_SESSION}/auth/qr",
                headers={"X-Api-Key": WAHA_KEY}, params={"format": "image"})
            if r.status_code == 200:
                import base64
                return {"qr_base64": base64.b64encode(r.content).decode(),
                        "content_type": r.headers.get("content-type","image/png")}
            return {"error": "QR not available"}
    except Exception as e:
        return {"error": str(e)}


@router.patch("/imap/{msg_id}/read")
async def mark_imap_read_ep(msg_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute("UPDATE imap_messages SET is_read=TRUE WHERE id=$1 AND tenant_id=$2", msg_id, actor.tenant_id)
        return {"ok": True}

@router.patch("/imap/{msg_id}/star")
async def star_imap_ep(msg_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        r = await conn.fetchrow("UPDATE imap_messages SET is_starred=NOT COALESCE(is_starred,FALSE) WHERE id=$1 AND tenant_id=$2 RETURNING is_starred", msg_id, actor.tenant_id)
        return {"starred": r["is_starred"] if r else False}

@router.patch("/imap/{msg_id}/trash")
async def trash_imap_ep(msg_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute("UPDATE imap_messages SET is_deleted=TRUE WHERE id=$1 AND tenant_id=$2", msg_id, actor.tenant_id)
        return {"ok": True}

@router.get("/imap-messages")
async def get_imap_messages(limit: int = Query(200, le=500), folder: str = Query(None), actor: Actor = Depends(get_actor)):
    """Return IMAP emails with Phase H resume processing tags. Admins see all tenant emails."""
    import json as _json
    async with db.tenant_conn(actor.tenant_id) as conn:
        is_admin = actor.role in ("admin", "super_admin", "lead_recruiter", "manager")
        folder_sql = ""
        if folder:
            folder_sql = f"AND im.folder='{folder}'"
        elif is_admin:
            folder_sql = "AND im.folder LIKE '%INBOX%'"

        if is_admin:
            rows = await conn.fetch(f"""
                SELECT
                  im.id, im.subject, im.from_email, im.from_name, im.to_email,
                  im.received_at, im.is_read, im.is_starred, im.is_deleted,
                  im.auto_processed, im.process_status, im.attachments,
                  im.candidate_id, im.folder,
                  ua.email AS account_email,
                  rf.id                                AS resume_file_id,
                  rf.routing_decision,
                  rf.parse_confidence,
                  rf.parsed_data->>'name'              AS rf_candidate_name,
                  rf.parsed_data->'skills'             AS rf_skills,
                  c.id                                 AS candidate_id_linked,
                  c.full_name                          AS candidate_full_name,
                  c.total_exp_mo,
                  c.skills                             AS candidate_skills
                FROM imap_messages im
                JOIN user_email_accounts ua ON ua.id = im.account_id
                LEFT JOIN LATERAL (
                    SELECT rf2.* FROM resume_files rf2
                    WHERE rf2.tenant_id = im.tenant_id
                      AND (
                        rf2.imap_msg_id = im.id
                        OR (rf2.source_email = im.from_email
                            AND rf2.imap_msg_id IS NOT NULL
                            AND ABS(EXTRACT(EPOCH FROM (rf2.created_at - im.received_at))) < 86400)
                      )
                    ORDER BY (rf2.imap_msg_id = im.id) DESC, rf2.created_at DESC LIMIT 1
                ) rf ON true
                LEFT JOIN candidates c ON c.id = rf.candidate_id
                WHERE im.tenant_id=$1 AND im.is_deleted IS NOT TRUE {folder_sql}
                ORDER BY im.received_at DESC LIMIT $2
            """, actor.tenant_id, limit)
        else:
            rows = await conn.fetch(f"""
                SELECT
                  im.id, im.subject, im.from_email, im.from_name, im.to_email,
                  im.received_at, im.is_read, im.is_starred, im.is_deleted,
                  im.auto_processed, im.process_status, im.attachments,
                  im.candidate_id, im.folder,
                  ua.email AS account_email,
                  rf.id                                AS resume_file_id,
                  rf.routing_decision,
                  rf.parse_confidence,
                  rf.parsed_data->>'name'              AS rf_candidate_name,
                  rf.parsed_data->'skills'             AS rf_skills,
                  c.id                                 AS candidate_id_linked,
                  c.full_name                          AS candidate_full_name,
                  c.total_exp_mo,
                  c.skills                             AS candidate_skills
                FROM imap_messages im
                JOIN user_email_accounts ua ON ua.id = im.account_id AND ua.user_id=$2
                LEFT JOIN LATERAL (
                    SELECT rf2.* FROM resume_files rf2
                    WHERE rf2.tenant_id = im.tenant_id
                      AND (
                        rf2.imap_msg_id = im.id
                        OR (rf2.source_email = im.from_email
                            AND rf2.imap_msg_id IS NOT NULL
                            AND ABS(EXTRACT(EPOCH FROM (rf2.created_at - im.received_at))) < 86400)
                      )
                    ORDER BY (rf2.imap_msg_id = im.id) DESC, rf2.created_at DESC LIMIT 1
                ) rf ON true
                LEFT JOIN candidates c ON c.id = rf.candidate_id
                WHERE im.tenant_id=$1 AND im.is_deleted IS NOT TRUE {folder_sql}
                ORDER BY im.received_at DESC LIMIT $3
            """, actor.tenant_id, actor.user_id, limit)

        def build_tag(r):
            d = dict(r)
            has_resume = d.get("resume_file_id") is not None
            skills = []
            if d.get("candidate_skills"):
                skills = list(d["candidate_skills"])[:3]
            elif d.get("rf_skills"):
                try:
                    raw = d["rf_skills"]
                    sk = _json.loads(raw) if isinstance(raw, str) else raw
                    skills = [s for s in (sk or []) if isinstance(s, str) and len(s) < 35][:3]
                except Exception:
                    pass
            exp_mo = d.get("total_exp_mo") or 0
            d["resume_tag"] = {
                "detected": has_resume,
                "routing": d.get("routing_decision"),
                "confidence": float(d.get("parse_confidence") or 0),
                "candidate_name": d.get("candidate_full_name") or d.get("rf_candidate_name"),
                "skills": skills,
                "exp": f"{exp_mo // 12}yr" if exp_mo else None,
            } if has_resume else None
            return d

        msgs = [build_tag(r) for r in rows]
        unread = sum(1 for m in msgs if not m.get("is_read"))
        return {"messages": msgs, "unread": unread, "total": len(msgs)}


@router.get("/email-templates")
async def list_templates(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            "SELECT id,name,category,subject,body_html,variables,is_active "
            "FROM email_templates WHERE tenant_id=$1 AND is_active=TRUE ORDER BY name",
            actor.tenant_id)
        return [dict(r) for r in rows]


@router.get("/nurture-sequences")
async def list_nurture(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            "SELECT id,name,trigger_event,steps,is_active,created_at "
            "FROM nurture_sequences WHERE tenant_id=$1 ORDER BY name", actor.tenant_id)
        return [dict(r) for r in rows]


@router.post("/mark-all-read")
async def mark_all_read(body: dict = None, actor: Actor = Depends(get_actor)):
    """Mark all emails as read in a folder"""
    folder = (body or {}).get('folder', 'inbox')
    async with db.tenant_conn(actor.tenant_id) as conn:
        if folder in ('inbox', 'starred', 'archive', 'junk', 'snoozed'):
            await conn.execute(
                "UPDATE imap_messages SET is_read=TRUE WHERE tenant_id=$1 AND is_deleted IS NOT TRUE",
                actor.tenant_id)
        await conn.execute(
            "UPDATE candidate_messages SET is_read=TRUE WHERE tenant_id=$1 AND is_deleted IS NOT TRUE",
            actor.tenant_id)
    return {"ok": True}


@router.get("/archive")
async def archive_list(limit: int = Query(200, le=500), offset: int = Query(0), actor: Actor = Depends(get_actor)):
    """Emails in Archive folder (INBOX.Outlook.Archive, INBOX.Archive, etc.)"""
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT
                im.id, im.candidate_id,
                COALESCE(NULLIF(im.from_name,''), NULLIF(im.from_email,''), 'Unknown Sender') AS candidate_name,
                im.from_email AS email, im.folder AS imap_folder, im.imap_uid AS imap_uid,
                NULL::text AS phone, 'email'::text AS channel, 'inbound'::text AS direction,
                COALESCE(im.subject,'(no subject)') AS subject,
                COALESCE(im.html_body, im.body, '') AS body,
                'received'::text AS status, im.received_at AS created_at, NULL::text AS deleted_at,
                ua.display_name AS sent_by_name, im.is_read, im.is_starred,
                im.to_email, im.cc,
                1::bigint AS msg_count, (CASE WHEN im.is_read THEN 0 ELSE 1 END)::bigint AS unread_count,
                CASE WHEN im.attachments IS NOT NULL AND jsonb_array_length(im.attachments)>0
                     THEN (SELECT jsonb_agg(jsonb_build_object('filename',a->>'filename','mime_type',a->>'mime_type','size',(a->>'size')::int)) FROM jsonb_array_elements(im.attachments) a)
                     ELSE '[]'::jsonb END AS attachments
            FROM imap_messages im
            JOIN user_email_accounts ua ON ua.id = im.account_id
            WHERE im.tenant_id=$1 AND ua.user_id=$2
              AND im.folder ILIKE '%archive%'
              AND im.is_deleted IS NOT TRUE
            ORDER BY im.received_at DESC LIMIT $3 OFFSET $4
        """, actor.tenant_id, actor.user_id, limit, offset)
        result = [dict(r) for r in rows]
        for m in result:
            if 'attachments' in m and isinstance(m['attachments'], str):
                try: m['attachments'] = __import__('json').loads(m['attachments'] or '[]')
                except: m['attachments'] = []
        for m in result:
            if 'attachments' in m and isinstance(m['attachments'], str):
                try: m['attachments'] = __import__('json').loads(m['attachments'] or '[]')
                except: m['attachments'] = []
        return result



@router.get("/junk")
async def junk_list(limit: int = Query(200, le=500), offset: int = Query(0), actor: Actor = Depends(get_actor)):
    """Emails in Junk/Spam folder"""
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT
                im.id, im.candidate_id,
                COALESCE(NULLIF(im.from_name,''), NULLIF(im.from_email,''), 'Unknown Sender') AS candidate_name,
                im.from_email AS email, im.folder AS imap_folder, im.imap_uid AS imap_uid,
                NULL::text AS phone, 'email'::text AS channel, 'inbound'::text AS direction,
                COALESCE(im.subject,'(no subject)') AS subject,
                COALESCE(im.html_body, im.body, '') AS body,
                'received'::text AS status, im.received_at AS created_at, NULL::text AS deleted_at,
                ua.display_name AS sent_by_name, im.is_read, im.is_starred,
                im.to_email, im.cc,
                1::bigint AS msg_count, (CASE WHEN im.is_read THEN 0 ELSE 1 END)::bigint AS unread_count,
                CASE WHEN im.attachments IS NOT NULL AND jsonb_array_length(im.attachments)>0
                     THEN (SELECT jsonb_agg(jsonb_build_object('filename',a->>'filename','mime_type',a->>'mime_type','size',(a->>'size')::int)) FROM jsonb_array_elements(im.attachments) a)
                     ELSE '[]'::jsonb END AS attachments
            FROM imap_messages im
            JOIN user_email_accounts ua ON ua.id = im.account_id
            WHERE im.tenant_id=$1 AND ua.user_id=$2
              AND (im.folder ILIKE '%junk%' OR im.folder ILIKE '%spam%')
              AND im.is_deleted IS NOT TRUE
            ORDER BY im.received_at DESC LIMIT $3 OFFSET $4
        """, actor.tenant_id, actor.user_id, limit, offset)
        result = [dict(r) for r in rows]
        for m in result:
            if 'attachments' in m and isinstance(m['attachments'], str):
                try: m['attachments'] = __import__('json').loads(m['attachments'] or '[]')
                except: m['attachments'] = []
        for m in result:
            if 'attachments' in m and isinstance(m['attachments'], str):
                try: m['attachments'] = __import__('json').loads(m['attachments'] or '[]')
                except: m['attachments'] = []
        return result



@router.post("/imap/{msg_id}/snooze")
async def snooze_imap(msg_id: str, body: dict = None, actor: Actor = Depends(get_actor)):
    """Snooze an IMAP email until a given time"""
    import re
    from datetime import datetime
    if not re.match(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', msg_id, re.I):
        raise HTTPException(400, "Invalid message ID")
    until_str = (body or {}).get('until', '')
    async with db.tenant_conn(actor.tenant_id) as conn:
        if until_str:
            try:
                until_dt = datetime.fromisoformat(until_str.replace('Z', '+00:00'))
                await conn.execute(
                    "UPDATE imap_messages SET snoozed_until=$1 WHERE id=$2 AND tenant_id=$3",
                    until_dt, msg_id, actor.tenant_id)
            except Exception as ex:
                print(f"[Snooze] Error: {ex}")
    return {"ok": True}


@router.post("/imap/{msg_id}/archive")
async def archive_imap(msg_id: str, actor: Actor = Depends(get_actor)):
    """Move IMAP email to archive by updating folder"""
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT account_id, imap_uid, folder FROM imap_messages WHERE id=$1 AND tenant_id=$2",
            msg_id, actor.tenant_id)
        if not row:
            raise HTTPException(404, "Message not found")
        # Mark as archived in DB (use a special flag or update folder)
        await conn.execute(
            "UPDATE imap_messages SET is_deleted=TRUE, deleted_at=NOW() WHERE id=$1 AND tenant_id=$2",
            msg_id, actor.tenant_id)
    return {"archived": True}


@router.get("/search")
async def search_emails(
    q: str = Query(""),
    from_addr: str = Query(""),
    to_addr: str = Query(""),
    has_attachment: bool = Query(False),
    date_from: str = Query(""),
    date_to: str = Query(""),
    limit: int = Query(100, le=200),
    actor: Actor = Depends(get_actor)
):
    """Advanced email search across all IMAP folders"""
    conditions = ["im.tenant_id=$1", "ua.user_id=$2", "im.is_deleted IS NOT TRUE"]
    params = [actor.tenant_id, actor.user_id]

    if q:
        params.append(f"%{q}%")
        conditions.append(f"(im.subject ILIKE ${len(params)} OR im.from_name ILIKE ${len(params)} OR im.from_email ILIKE ${len(params)})")
    if from_addr:
        params.append(f"%{from_addr}%")
        conditions.append(f"(im.from_email ILIKE ${len(params)} OR im.from_name ILIKE ${len(params)})")
    if to_addr:
        params.append(f"%{to_addr}%")
        conditions.append(f"im.to_email ILIKE ${len(params)}")
    if has_attachment:
        conditions.append("im.attachments IS NOT NULL AND jsonb_array_length(im.attachments) > 0")
    if date_from:
        try:
            from datetime import date as _date
            params.append(_date.fromisoformat(date_from))
        except Exception:
            params.append(date_from)
        conditions.append("im.received_at::date >= $"+str(len(params)))
    if date_to:
        try:
            from datetime import date as _date
            params.append(_date.fromisoformat(date_to))
        except Exception:
            params.append(date_to)
        conditions.append("im.received_at::date <= $"+str(len(params)))

    where = " AND ".join(conditions)
    params.append(limit)

    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(f"""
            SELECT
                im.id, im.candidate_id,
                COALESCE(NULLIF(im.from_name,''), NULLIF(im.from_email,''), 'Unknown Sender') AS candidate_name,
                im.from_email AS email, im.folder AS imap_folder, im.imap_uid AS imap_uid,
                NULL::text AS phone, 'email'::text AS channel, 'inbound'::text AS direction,
                COALESCE(im.subject,'(no subject)') AS subject,
                COALESCE(im.html_body, im.body, '') AS body,
                'received'::text AS status, im.received_at AS created_at, NULL::text AS deleted_at,
                ua.display_name AS sent_by_name, im.is_read, im.is_starred,
                im.to_email, im.cc,
                1::bigint AS msg_count, (CASE WHEN im.is_read THEN 0 ELSE 1 END)::bigint AS unread_count,
                CASE WHEN im.attachments IS NOT NULL AND jsonb_array_length(im.attachments)>0
                     THEN (SELECT jsonb_agg(jsonb_build_object('filename',a->>'filename','mime_type',a->>'mime_type','size',(a->>'size')::int)) FROM jsonb_array_elements(im.attachments) a)
                     ELSE '[]'::jsonb END AS attachments
            FROM imap_messages im
            JOIN user_email_accounts ua ON ua.id = im.account_id
            WHERE {where}
            ORDER BY im.received_at DESC LIMIT ${len(params)}
        """, *params)
        result = [dict(r) for r in rows]
        for m in result:
            if 'attachments' in m and isinstance(m['attachments'], str):
                try: m['attachments'] = __import__('json').loads(m['attachments'] or '[]')
                except: m['attachments'] = []
        return result


@router.post("/imap/{msg_id}/move")
async def move_imap_message(msg_id: str, body: dict = None, actor: Actor = Depends(get_actor)):
    """Move an IMAP message to a different folder (update DB folder record)"""
    import re
    # Validate UUID format to avoid asyncpg error
    if not re.match(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', msg_id, re.I):
        raise HTTPException(400, "Invalid message ID")
    target_folder = (body or {}).get('folder', 'INBOX.Outlook.Archive')
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT id, folder FROM imap_messages WHERE id=$1 AND tenant_id=$2",
            msg_id, actor.tenant_id)
        if not row:
            raise HTTPException(404, "Message not found")
        # Update folder in DB (visual move — IMAP server move requires open connection)
        await conn.execute(
            "UPDATE imap_messages SET folder=$1 WHERE id=$2 AND tenant_id=$3",
            target_folder, msg_id, actor.tenant_id)
    return {"moved": True, "message_id": msg_id, "to_folder": target_folder}
