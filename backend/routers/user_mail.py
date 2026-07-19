"""Per-user SMTP/IMAP email account management"""
import imaplib
import email as email_lib
from email.header import decode_header, make_header
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders as email_encoders
import smtplib
import threading
import base64
from datetime import datetime
from typing import List, Optional, List
from fastapi import Form, File, UploadFile, APIRouter, Depends, HTTPException
from pydantic import BaseModel
import db
from deps import Actor, get_actor

router = APIRouter(prefix="/user-mail", tags=["user-mail"])

# ── Provider presets ───────────────────────────────────────────────────────────
PROVIDERS = {
    "gmail": {
        "name": "Gmail", "logo": "G",
        "smtp_host": "smtp.gmail.com", "smtp_port": 587, "smtp_tls": True,
        "imap_host": "imap.gmail.com", "imap_port": 993, "imap_ssl": True,
        "note": "Use an App Password (Google Account → Security → 2-Step → App passwords)",
        "help_url": "https://support.google.com/accounts/answer/185833"
    },
    "outlook": {
        "name": "Outlook / Office 365", "logo": "O",
        "smtp_host": "smtp.office365.com", "smtp_port": 587, "smtp_tls": True,
        "imap_host": "imap-mail.outlook.com", "imap_port": 993, "imap_ssl": True,
        "note": "Use your Microsoft account email and password",
        "help_url": "https://support.microsoft.com/en-us/office/pop-imap-and-smtp-settings"
    },
    "yahoo": {
        "name": "Yahoo Mail", "logo": "Y",
        "smtp_host": "smtp.mail.yahoo.com", "smtp_port": 587, "smtp_tls": True,
        "imap_host": "imap.mail.yahoo.com", "imap_port": 993, "imap_ssl": True,
        "note": "Generate App Password: Yahoo Security → Manage app passwords",
        "help_url": "https://help.yahoo.com/kb/generate-third-party-passwords-sln15241.html"
    },
    "hostinger": {
        "name": "Hostinger Mail", "logo": "H",
        "smtp_host": "smtp.hostinger.com", "smtp_port": 587, "smtp_tls": True,
        "imap_host": "imap.hostinger.com", "imap_port": 993, "imap_ssl": True,
        "note": "Use your Hostinger email address and hPanel email password",
        "help_url": "https://support.hostinger.com/en/articles/1583612"
    },
    "zoho": {
        "name": "Zoho Mail", "logo": "Z",
        "smtp_host": "smtp.zoho.in", "smtp_port": 587, "smtp_tls": True,
        "imap_host": "imap.zoho.in", "imap_port": 993, "imap_ssl": True,
        "note": "Use your Zoho email and password. Enable IMAP in Zoho settings.",
        "help_url": "https://www.zoho.com/mail/help/imap-access.html"
    },
    "godaddy": {
        "name": "GoDaddy Workspace", "logo": "GD",
        "smtp_host": "smtpout.secureserver.net", "smtp_port": 587, "smtp_tls": True,
        "imap_host": "imap.secureserver.net", "imap_port": 993, "imap_ssl": True,
        "note": "Use your GoDaddy Workspace Email credentials",
        "help_url": "https://in.godaddy.com/help/server-and-port-settings-7949"
    },
    "custom": {
        "name": "Custom SMTP/IMAP", "logo": "✉",
        "smtp_host": "", "smtp_port": 587, "smtp_tls": True,
        "imap_host": "", "imap_port": 993, "imap_ssl": True,
        "note": "Enter your mail server settings manually",
        "help_url": None
    }
}


import re as _re

def sanitize_email_html(html):
    import re as re2
    if not html:
        return ""
    # Extract body content from full HTML document
    m = re2.search(r"<body[^>]*>(.*?)</body>", html, re2.DOTALL | re2.IGNORECASE)
    if m:
        html = m.group(1)
    # Remove Office XML conditional comments
    html = re2.sub(r"<!--\[if.*?\[endif\]-->", "", html, flags=re2.DOTALL | re2.IGNORECASE)
    # Remove style blocks
    html = re2.sub(r"<style[^>]*>.*?</style>", "", html, flags=re2.DOTALL | re2.IGNORECASE)
    # Replace CID images with nothing
    # CID images embedded as base64 in _get_body
    # CID images are handled by _get_body (embedded as base64)
    return html.strip()

def _decode_header(h: str) -> str:
    try:
        return str(make_header(decode_header(h or "")))
    except Exception:
        return h or ""


def _get_body(msg) -> tuple:
    """Returns (plain_text, html_body) with CID images embedded as base64 data URIs"""
    import base64 as _b64
    plain, html = "", ""
    cid_map = {}  # map content-id -> data URI

    # First pass: collect all inline images/attachments with Content-ID
    if msg.is_multipart():
        for part in msg.walk():
            cid = part.get("Content-ID", "")
            if cid:
                cid_clean = cid.strip("<>")
                try:
                    payload = part.get_payload(decode=True)
                    if payload:
                        mime = part.get_content_type()
                        b64 = _b64.b64encode(payload).decode()
                        cid_map[cid_clean] = f"data:{mime};base64,{b64}"
                except Exception:
                    pass

    # Second pass: extract text content
    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            cd = str(part.get("Content-Disposition", ""))
            if "attachment" in cd and not part.get("Content-ID"):
                continue
            try:
                payload = part.get_payload(decode=True)
                if not payload:
                    continue
                charset = part.get_content_charset() or "utf-8"
                text = payload.decode(charset, errors="replace")
                if ct == "text/html" and not html:
                    html = sanitize_email_html(text)
                elif ct == "text/plain" and not plain:
                    plain = text
            except Exception:
                pass
    else:
        try:
            payload = msg.get_payload(decode=True)
            charset = msg.get_content_charset() or "utf-8"
            text = payload.decode(charset, errors="replace") if payload else ""
            if msg.get_content_type() == "text/html":
                html = sanitize_email_html(text)
            else:
                plain = text
        except Exception:
            pass

    # Replace cid: references with embedded base64 data
    if cid_map and html:
        import re as _re
        def replace_cid(match):
            cid = match.group(1)
            return cid_map.get(cid, cid_map.get(cid.split("@")[0], match.group(0)))
        for cid_key, data_uri in cid_map.items():
            html = html.replace('src="cid:'+cid_key+'"', 'src="'+data_uri+'"')
            html = html.replace("src='cid:"+cid_key+"'", 'src="'+data_uri+'"')

    # Third pass: collect real attachments (not inline CID images)
    attachments = []
    if msg.is_multipart():
        for part in msg.walk():
            cd = str(part.get("Content-Disposition", ""))
            cid = part.get("Content-ID", "")
            ct = part.get_content_type()
            # Real attachment: has Content-Disposition: attachment and no CID (not inline image)
            if "attachment" in cd and not cid:
                try:
                    fn = part.get_filename() or "attachment"
                    # Decode encoded filename
                    from email.header import decode_header as _dh2, make_header as _mh2
                    fn = str(_mh2(_dh2(fn)))
                    payload = part.get_payload(decode=True)
                    if payload:
                        import base64 as _b64a
                        attachments.append({
                            "filename": fn,
                            "mime_type": ct,
                            "size": len(payload),
                            "data": _b64a.b64encode(payload).decode()
                        })
                except Exception:
                    pass

    return plain, html, attachments


def _simple_encrypt(text: str) -> str:
    """Simple base64 obfuscation — replace with real encryption in production"""
    return base64.b64encode(text.encode()).decode()


def _simple_decrypt(text: str) -> str:
    try:
        return base64.b64decode(text.encode()).decode()
    except Exception:
        return text


# ── Models ─────────────────────────────────────────────────────────────────────
class AccountBody(BaseModel):
    provider: str = "custom"
    display_name: Optional[str] = None
    email: str
    smtp_host: str
    smtp_port: int = 587
    smtp_user: str
    smtp_password: str
    smtp_tls: bool = True
    imap_host: Optional[str] = None
    imap_port: int = 993
    imap_user: Optional[str] = None
    imap_password: Optional[str] = None
    imap_ssl: bool = True
    is_default: bool = False
    signature: Optional[str] = None
    signature_enabled: bool = True


# ── Routes ─────────────────────────────────────────────────────────────────────
@router.get("/providers")
async def list_providers():
    return PROVIDERS


@router.get("/accounts")
async def list_accounts(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT id, provider, display_name, email,
                   smtp_host, smtp_port, smtp_user, smtp_password, smtp_tls,
                   imap_host, imap_port, imap_user, imap_password, imap_ssl,
                   is_default, is_active, verified, last_verified_at, created_at,
                   signature, signature_enabled, sig_new_mail, sig_reply
            FROM user_email_accounts
            WHERE user_id=$1 AND tenant_id=$2 AND is_active=TRUE
            ORDER BY is_default DESC, created_at ASC""",
            actor.user_id, actor.tenant_id)
        result = []
        for r in rows:
            d = dict(r)
            # Decrypt passwords — only returned to the account owner (already scoped by user_id)
            if d.get('smtp_password'):
                d['smtp_password'] = _simple_decrypt(d['smtp_password'])
            if d.get('imap_password'):
                d['imap_password'] = _simple_decrypt(d['imap_password'])
            result.append(d)
        return result


@router.post("/accounts")
async def add_account(body: AccountBody, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        # If set as default, clear other defaults for this user
        if body.is_default:
            await conn.execute(
                "UPDATE user_email_accounts SET is_default=FALSE WHERE user_id=$1 AND tenant_id=$2",
                actor.user_id, actor.tenant_id)
        # Encrypt passwords
        enc_smtp = _simple_encrypt(body.smtp_password)
        enc_imap = _simple_encrypt(body.imap_password) if body.imap_password else None
        row = await conn.fetchrow("""
            INSERT INTO user_email_accounts
              (user_id, tenant_id, provider, display_name, email,
               smtp_host, smtp_port, smtp_user, smtp_password, smtp_tls,
               imap_host, imap_port, imap_user, imap_password, imap_ssl,
               is_default, signature, signature_enabled)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
            RETURNING id""",
            actor.user_id, actor.tenant_id, body.provider,
            body.display_name or body.email, body.email,
            body.smtp_host, body.smtp_port, body.smtp_user, enc_smtp, body.smtp_tls,
            body.imap_host, body.imap_port,
            body.imap_user or body.smtp_user, enc_imap, body.imap_ssl,
            body.is_default, getattr(body, 'signature', None), getattr(body, 'signature_enabled', True))
        return {"id": str(row["id"]), "created": True}


@router.put("/accounts/{acc_id}")
async def update_account(acc_id: str, body: AccountBody, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        if body.is_default:
            await conn.execute(
                "UPDATE user_email_accounts SET is_default=FALSE WHERE user_id=$1 AND tenant_id=$2",
                actor.user_id, actor.tenant_id)
        enc_smtp = _simple_encrypt(body.smtp_password)
        enc_imap = _simple_encrypt(body.imap_password) if body.imap_password else None
        r = await conn.fetchrow("""
            UPDATE user_email_accounts
            SET provider=$1, display_name=$2, email=$3,
                smtp_host=$4, smtp_port=$5, smtp_user=$6, smtp_password=$7, smtp_tls=$8,
                imap_host=$9, imap_port=$10, imap_user=$11, imap_password=$12, imap_ssl=$13,
                is_default=$14, verified=FALSE,
                signature=$18, signature_enabled=$19
            WHERE id=$15 AND user_id=$16 AND tenant_id=$17 RETURNING id""",
            body.provider, body.display_name or body.email, body.email,
            body.smtp_host, body.smtp_port, body.smtp_user, enc_smtp, body.smtp_tls,
            body.imap_host, body.imap_port,
            body.imap_user or body.smtp_user, enc_imap, body.imap_ssl,
            body.is_default, acc_id, actor.user_id, actor.tenant_id,
            getattr(body, 'signature', None), getattr(body, 'signature_enabled', True))
        if not r: raise HTTPException(404, "Account not found")
        return {"updated": True}


@router.patch("/accounts/{acc_id}/set-default")
async def set_default(acc_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute(
            "UPDATE user_email_accounts SET is_default=FALSE WHERE user_id=$1 AND tenant_id=$2",
            actor.user_id, actor.tenant_id)
        r = await conn.fetchrow(
            "UPDATE user_email_accounts SET is_default=TRUE WHERE id=$1 AND user_id=$2 RETURNING id",
            acc_id, actor.user_id)
        if not r: raise HTTPException(404, "Account not found")
        return {"default_set": True}


@router.delete("/accounts/{acc_id}")
async def delete_account(acc_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute(
            "DELETE FROM user_email_accounts WHERE id=$1 AND user_id=$2 AND tenant_id=$3",
            acc_id, actor.user_id, actor.tenant_id)
        return {"deleted": True}




@router.patch("/accounts/{acc_id}/signature")
async def update_signature(acc_id: str, body: dict, actor: Actor = Depends(get_actor)):
    """Update just the signature for an account"""
    async with db.tenant_conn(actor.tenant_id) as conn:
        r = await conn.fetchrow(
            """UPDATE user_email_accounts
               SET signature=$1, signature_enabled=$2
               WHERE id=$3 AND user_id=$4 AND tenant_id=$5 RETURNING id""",
            body.get('signature'), body.get('signature_enabled', True),
            acc_id, actor.user_id, actor.tenant_id)
        if not r: raise HTTPException(404, "Account not found")
        return {"updated": True}

@router.post("/accounts/{acc_id}/verify")
async def verify_account(acc_id: str, actor: Actor = Depends(get_actor)):
    """Test SMTP and IMAP connections"""
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT * FROM user_email_accounts WHERE id=$1 AND user_id=$2 AND tenant_id=$3",
            acc_id, actor.user_id, actor.tenant_id)
        if not row: raise HTTPException(404, "Account not found")
        acc = dict(row)

    smtp_ok = False
    smtp_err = ""
    imap_ok = False
    imap_err = ""
    smtp_pw = _simple_decrypt(acc["smtp_password"])

    # Test SMTP
    def test_smtp():
        nonlocal smtp_ok, smtp_err
        try:
            with smtplib.SMTP(acc["smtp_host"], acc["smtp_port"], timeout=10) as s:
                s.ehlo()
                if acc["smtp_tls"]:
                    s.starttls(); s.ehlo()
                s.login(acc["smtp_user"], smtp_pw)
            smtp_ok = True
        except Exception as ex:
            smtp_err = str(ex)

    def test_imap():
        nonlocal imap_ok, imap_err
        if not acc.get("imap_host") or not acc.get("imap_password"):
            imap_err = "IMAP not configured"
            return
        imap_pw = _simple_decrypt(acc["imap_password"])
        try:
            if acc["imap_ssl"]:
                M = imaplib.IMAP4_SSL(acc["imap_host"], acc["imap_port"])
            else:
                M = imaplib.IMAP4(acc["imap_host"], acc["imap_port"])
            M.login(acc["imap_user"] or acc["smtp_user"], imap_pw)
            M.logout()
            imap_ok = True
        except Exception as ex:
            imap_err = str(ex)

    t1 = threading.Thread(target=test_smtp); t1.start(); t1.join(15)
    t2 = threading.Thread(target=test_imap); t2.start(); t2.join(15)

    # Update verification status
    async with db.tenant_conn(actor.tenant_id) as conn:
        if smtp_ok:
            await conn.execute(
                "UPDATE user_email_accounts SET verified=TRUE, last_verified_at=NOW() WHERE id=$1",
                acc_id)
    return {
        "smtp": {"ok": smtp_ok, "error": smtp_err},
        "imap": {"ok": imap_ok, "error": imap_err},
        "verified": smtp_ok
    }


@router.get("/accounts/{acc_id}/folders")
async def list_imap_folders(acc_id: str, actor: Actor = Depends(get_actor)):
    """Discover all IMAP folders for an account"""
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT * FROM user_email_accounts WHERE id=$1 AND user_id=$2 AND tenant_id=$3",
            acc_id, actor.user_id, actor.tenant_id)
        if not row: raise HTTPException(404, "Account not found")
    acc = dict(row)
    if not acc.get('imap_host') or not acc.get('imap_password'):
        raise HTTPException(400, "IMAP not configured")
    imap_pw = _simple_decrypt(acc['imap_password'])
    folders = []
    def do_list():
        try:
            if acc['imap_ssl']:
                M = imaplib.IMAP4_SSL(acc['imap_host'], acc['imap_port'])
            else:
                M = imaplib.IMAP4(acc['imap_host'], acc['imap_port'])
            M.login(acc['imap_user'] or acc['smtp_user'], imap_pw)
            _, folder_list = M.list()
            for item in (folder_list or []):
                try:
                    decoded = item.decode('utf-8', errors='replace')
                    # Parse IMAP folder list response
                    # Format: (\HasNoChildren) "/" "Folder Name"
                    parts = decoded.split('"/"')
                    if len(parts) >= 2:
                        name = parts[-1].strip().strip('"').strip()
                        if name and not name.startswith('['):
                            folders.append(name)
                    else:
                        # Try space separator
                        parts2 = decoded.rsplit(' ', 1)
                        if parts2:
                            name = parts2[-1].strip().strip('"')
                            if name:
                                folders.append(name)
                except Exception:
                    pass
            M.logout()
        except Exception as ex:
            print(f"Folder list error: {ex}")
    import asyncio
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, do_list)
    # Save discovered folders
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute(
            "UPDATE user_email_accounts SET discovered_folders=$1 WHERE id=$2",
            folders or ['INBOX'], acc_id)
    return {"folders": folders or ['INBOX'], "count": len(folders)}


@router.post("/accounts/{acc_id}/fetch-inbox")
async def fetch_imap_inbox(
    acc_id: str,
    folder: Optional[str] = None,
    limit: int = 0,          # 0 = all emails (no limit)
    since_days: Optional[int] = None,  # Only fetch emails from last N days
    full_sync: bool = False,  # True = re-fetch everything, False = incremental
    actor: Actor = Depends(get_actor)
):
    """Fetch emails from IMAP - supports ALL folders, incremental sync, no artificial limits"""
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT * FROM user_email_accounts WHERE id=$1 AND user_id=$2 AND tenant_id=$3",
            acc_id, actor.user_id, actor.tenant_id)
        if not row: raise HTTPException(404, "Account not found")
        acc = dict(row)

    if not acc.get('imap_host'):
        raise HTTPException(400, "IMAP not configured for this account")
    if not acc.get('imap_password'):
        raise HTTPException(400, "IMAP password not set")

    imap_pw = _simple_decrypt(acc['imap_password'])
    results = {"fetched": 0, "skipped": 0, "folders_synced": [], "errors": [], "total_in_folders": {}}

    def do_full_fetch():
        try:
            if acc['imap_ssl']:
                M = imaplib.IMAP4_SSL(acc['imap_host'], acc['imap_port'])
            else:
                M = imaplib.IMAP4(acc['imap_host'], acc['imap_port'])
            M.login(acc['imap_user'] or acc['smtp_user'], imap_pw)

            # Determine which folders to sync
            folders_to_sync = [folder] if folder else (acc.get('discovered_folders') or ['INBOX'])
            if not folder and not acc.get('discovered_folders'):
                # Auto-discover folders
                _, folder_list = M.list()
                for item in (folder_list or []):
                    try:
                        decoded = item.decode('utf-8', errors='replace')
                        parts = decoded.split('"/"')
                        if len(parts) >= 2:
                            name = parts[-1].strip().strip('"').strip()
                            if name and name not in ('Junk', '[Gmail]', 'Spam'):
                                folders_to_sync.append(name)
                    except Exception:
                        pass
                folders_to_sync = list(set(folders_to_sync)) or ['INBOX']

            # Sync each folder
            for folder_name in folders_to_sync:
                try:
                    M.select(folder_name, readonly=True)
                    # Build search criteria
                    search_parts = []
                    if since_days:
                        from datetime import date, timedelta
                        cutoff = (date.today() - timedelta(days=since_days)).strftime('%d-%b-%Y')
                        search_parts.append(f'SINCE {cutoff}')
                    search_criteria = ' '.join(search_parts) if search_parts else 'ALL'
                    _, msgnums = M.search(None, search_criteria)
                    all_uids = msgnums[0].split() if msgnums[0] else []
                    results['total_in_folders'][folder_name] = len(all_uids)

                    if not all_uids:
                        continue

                    # Apply limit if specified (0 = no limit)
                    if limit > 0:
                        uids_to_fetch = all_uids[-limit:]
                    else:
                        uids_to_fetch = all_uids

                    # Process in batches of 100 (avoids IMAP timeouts)
                    folder_fetched = 0
                    for batch_start in range(0, len(uids_to_fetch), 100):
                        batch = uids_to_fetch[batch_start:batch_start+100]
                        try:
                            _, data = M.fetch(b','.join(batch), '(RFC822.HEADER BODY[])')
                            results_batch = []
                            i = 0
                            while i < len(data):
                                try:
                                    if not data[i] or not isinstance(data[i], tuple):
                                        i += 1
                                        continue
                                    raw = data[i][1]
                                    if not raw:
                                        i += 1
                                        continue
                                    msg = email_lib.message_from_bytes(raw)
                                    uid = batch[i // 2 if len(data) > len(batch) else i // 1].decode()
                                    subj = _decode_header(msg.get('Subject',''))
                                    from_raw = _decode_header(msg.get('From',''))
                                    to_raw = msg.get('To','')
                                    cc_raw = msg.get('Cc','')
                                    date_str = msg.get('Date','')
                                    msg_id = msg.get('Message-ID','')
                                    plain, html, attachments = _get_body(msg)
                                    body = html or plain

                                    from_name = from_raw
                                    from_email = from_raw
                                    if '<' in from_raw and '>' in from_raw:
                                        parts = from_raw.split('<')
                                        from_name = parts[0].strip().strip('"').strip()
                                        from_email = parts[1].rstrip('>').strip()

                                    try:
                                        from email.utils import parsedate_to_datetime
                                        recv_at = parsedate_to_datetime(date_str)
                                    except Exception:
                                        from datetime import datetime, timezone
                                        recv_at = datetime.now(timezone.utc)

                                    results_batch.append({
                                        'uid': uid, 'msg_id': msg_id,
                                        'subject': subj, 'from_email': from_email,
                                        'from_name': from_name, 'to_email': to_raw,
                                        'cc': cc_raw, 'body': body, 'html_body': html,
                                        'received_at': recv_at
                                    })
                                    folder_fetched += 1
                                except Exception:
                                    pass
                                i += 1

                            results['_batch_' + folder_name] = results_batch
                        except Exception as ex:
                            results['errors'].append(f"{folder_name} batch error: {str(ex)[:100]}")
                    results['folders_synced'].append(folder_name)
                except Exception as ex:
                    results['errors'].append(f"{folder_name}: {str(ex)[:100]}")

            M.logout()
        except Exception as ex:
            results['errors'].append(f"Connection error: {str(ex)[:200]}")

    import asyncio
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, do_full_fetch)

    # Store results in DB
    async with db.tenant_conn(actor.tenant_id) as conn:
        # Get candidates for email matching
        cands = await conn.fetch("SELECT id, email FROM candidates WHERE tenant_id=$1 AND email IS NOT NULL", actor.tenant_id)
        email_to_cand = {(c['email'] or '').lower(): c['id'] for c in cands}

        for folder_name in results.get('folders_synced', []):
            batch_key = '_batch_' + folder_name
            batch = results.pop(batch_key, [])
            saved = 0
            for r in batch:
                try:
                    cand_id = email_to_cand.get((r['from_email'] or '').lower())
                    await conn.execute("""
                        INSERT INTO imap_messages
                          (account_id, tenant_id, imap_uid, folder, from_email, from_name,
                           to_email, cc, subject, body, html_body, received_at, candidate_id)
                        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
                        ON CONFLICT (account_id, imap_uid) DO NOTHING
                    """, acc_id, actor.tenant_id, r['uid'], folder_name,
                        r['from_email'], r['from_name'], r['to_email'],
                        r['cc'], r['subject'], r['body'], r['html_body'],
                        r['received_at'], cand_id)
                    saved += 1
                except Exception as ex:
                    pass
            results['fetched'] += saved

        # Update sync state
        total_synced = await conn.fetchval("SELECT COUNT(*) FROM imap_messages WHERE account_id=$1", acc_id)
        await conn.execute(
            "UPDATE user_email_accounts SET total_emails_synced=$1, sync_status='idle' WHERE id=$2",
            total_synced, acc_id)

    return {
        "fetched": results['fetched'],
        "total_in_mailbox": sum(results['total_in_folders'].values()),
        "total_stored": results.get('fetched', 0),
        "folders_synced": results['folders_synced'],
        "folder_counts": results['total_in_folders'],
        "errors": results['errors'][:5]
    }




@router.get("/accounts/{acc_id}/messages")
async def get_imap_messages(acc_id: str, limit: int = 100, actor: Actor = Depends(get_actor)):
    """Get stored IMAP messages for an account"""
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT m.*, c.full_name AS candidate_name
            FROM imap_messages m
            LEFT JOIN candidates c ON c.id=m.candidate_id
            WHERE m.account_id=$1 AND m.tenant_id=$2 AND m.is_deleted IS NOT TRUE
            ORDER BY m.received_at DESC LIMIT $3""",
            acc_id, actor.tenant_id, limit)
        unread = await conn.fetchval(
            "SELECT COUNT(*) FROM imap_messages WHERE account_id=$1 AND is_read IS NOT TRUE AND is_deleted IS NOT TRUE",
            acc_id)
        return {"messages": [dict(r) for r in rows], "unread": unread}


@router.patch("/imap-messages/{msg_id}/read")
async def mark_imap_read(msg_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute(
            "UPDATE imap_messages SET is_read=TRUE WHERE id=$1 AND tenant_id=$2",
            msg_id, actor.tenant_id)
        return {"ok": True}


@router.patch("/imap-messages/{msg_id}/star")
async def star_imap(msg_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        r = await conn.fetchrow(
            "UPDATE imap_messages SET is_starred=NOT COALESCE(is_starred,FALSE) WHERE id=$1 AND tenant_id=$2 RETURNING is_starred",
            msg_id, actor.tenant_id)
        return {"starred": r["is_starred"] if r else False}


@router.patch("/imap-messages/{msg_id}/trash")
async def trash_imap(msg_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute(
            "UPDATE imap_messages SET is_deleted=TRUE WHERE id=$1 AND tenant_id=$2",
            msg_id, actor.tenant_id)
        return {"ok": True}


class DirectSend(BaseModel):
    acc_id: str
    to_email: str
    subject: Optional[str] = None
    body: str = ""
    to_name: Optional[str] = None
    cc: Optional[str] = None
    bcc: Optional[str] = None

@router.post("/send")
async def send_from_account(
    payload: DirectSend,
    actor: Actor = Depends(get_actor)
):
    acc_id = payload.acc_id
    to_email = payload.to_email
    subject = payload.subject
    body = payload.body
    to_name = payload.to_name
    cc = payload.cc
    bcc = payload.bcc
    """Send email using a specific user account's SMTP"""
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT * FROM user_email_accounts WHERE id=$1 AND user_id=$2 AND tenant_id=$3",
            acc_id, actor.user_id, actor.tenant_id)
        if not row: raise HTTPException(404, "Account not found")
    acc = dict(row)
    smtp_pw = _simple_decrypt(acc["smtp_password"])
    result = {"queued": False, "error": None}

    def go():
        try:
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject or "(no subject)"
            dn = acc.get("display_name") or acc["email"]
            msg["From"] = f"{dn} <{acc['email']}>"
            msg["To"] = to_email
            if cc: msg["Cc"] = cc
            rcpts = [to_email]
            if cc: rcpts += [x.strip() for x in cc.split(",")]
            if bcc: rcpts += [x.strip() for x in bcc.split(",")]
            if "<" in (body or "") and ">" in (body or ""):
                msg.attach(MIMEText(body, "html"))
            else:
                msg.attach(MIMEText(body or "", "plain"))
            with smtplib.SMTP(acc["smtp_host"], acc["smtp_port"], timeout=15) as s:
                s.ehlo()
                if acc["smtp_tls"]:
                    s.starttls(); s.ehlo()
                s.login(acc["smtp_user"], smtp_pw)
                s.sendmail(acc["email"], rcpts, msg.as_string())
            result["queued"] = True
            print(f"[user-mail] Sent from {acc['email']} to {to_email}")
            # Save copy to INBOX.Sent via IMAP APPEND
            try:
                import imaplib as _imap, time as _time
                imap_pw2 = _simple_decrypt(acc.get('imap_password') or acc.get('smtp_password') or '')
                imap_host2 = acc.get('imap_host') or acc['smtp_host'].replace('smtp.', 'imap.', 1)
                M_sent = _imap.IMAP4_SSL(imap_host2, int(acc.get('imap_port') or 993))
                M_sent.login(acc.get('imap_user') or acc['email'], imap_pw2)
                M_sent.append('INBOX.Sent', '\Seen', _imap.Time2Internaldate(_time.time()), msg.as_bytes())
                M_sent.logout()
                print(f'[user-mail] Saved copy to INBOX.Sent (send_from_account)')
            except Exception as _ie:
                print(f'[user-mail] IMAP APPEND failed: {_ie}')
        except Exception as ex:
            result["error"] = str(ex)
            print(f"[user-mail] Send error: {ex}")

    t = threading.Thread(target=go, daemon=True)
    t.start(); t.join(20)
    if not result["queued"]:
        raise HTTPException(502, result["error"] or "SMTP send failed")
    return {"sent": True, "from": acc["email"], "to": to_email}


@router.post("/send-with-attachments")
async def send_with_attachments(
    acc_id: str = Form(...),
    to_email: str = Form(...),
    subject: str = Form(""),
    body: str = Form(""),
    cc: str = Form(""),
    bcc: str = Form(""),
    read_receipt: str = Form("false"),
    schedule_at: str = Form(""),
    files: List[UploadFile] = File(default=[]),
    actor: Actor = Depends(get_actor)
):
    """Send email with optional file attachments using multipart/mixed"""
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT * FROM user_email_accounts WHERE id=$1 AND user_id=$2 AND tenant_id=$3",
            acc_id, actor.user_id, actor.tenant_id)
        if not row:
            raise HTTPException(404, "Account not found")
    acc = dict(row)
    smtp_pw = _simple_decrypt(acc.get("smtp_password") or "")
    result = {"queued": False, "error": None}

    # Read file data before threading
    file_data = []
    for f in files:
        content = await f.read()
        file_data.append({"name": f.filename, "content_type": f.content_type or "application/octet-stream", "data": content})

    def go():
        try:
            # Use multipart/mixed for attachments, multipart/alternative for body only
            if file_data:
                outer = MIMEMultipart("mixed")
            else:
                outer = MIMEMultipart("alternative")

            dn = acc.get("display_name") or acc.get("email", "")
            outer["Subject"] = subject or "(no subject)"
            outer["From"] = f"{dn} <{acc['email']}>"
            outer["To"] = to_email
            if cc:
                outer["Cc"] = cc
            if read_receipt == "true":
                outer["Disposition-Notification-To"] = acc["email"]
                outer["Return-Receipt-To"] = acc["email"]

            # Body part
            if file_data:
                alt = MIMEMultipart("alternative")
                if "<" in (body or "") and ">" in (body or ""):
                    alt.attach(MIMEText(body, "html", "utf-8"))
                else:
                    alt.attach(MIMEText(body or "", "plain", "utf-8"))
                outer.attach(alt)
            else:
                if "<" in (body or "") and ">" in (body or ""):
                    outer.attach(MIMEText(body, "html", "utf-8"))
                else:
                    outer.attach(MIMEText(body or "", "plain", "utf-8"))

            # Attachments
            for fd in file_data:
                part = MIMEBase("application", "octet-stream")
                part.set_payload(fd["data"])
                email_encoders.encode_base64(part)
                part.add_header("Content-Disposition", f'attachment; filename="{fd["name"]}"')
                part.add_header("Content-Type", fd["content_type"])
                outer.attach(part)

            rcpts = [to_email]
            if cc:
                rcpts += [x.strip() for x in cc.split(",") if x.strip()]
            if bcc:
                rcpts += [x.strip() for x in bcc.split(",") if x.strip()]

            with smtplib.SMTP(acc["smtp_host"], acc["smtp_port"], timeout=15) as s:
                s.ehlo()
                if acc.get("smtp_tls", True):
                    s.starttls()
                    s.ehlo()
                s.login(acc["smtp_user"], smtp_pw)
                s.sendmail(acc["email"], rcpts, outer.as_string())
            result["queued"] = True
            print(f"[user-mail] Sent from {acc['email']} to {to_email} ({len(file_data)} attachments)")
            # Save copy to INBOX.Sent via IMAP APPEND
            # Hostinger SMTP does not auto-save sent mail — client must do it
            try:
                import imaplib as _imap, time as _time
                imap_pw2 = _simple_decrypt(acc.get('imap_password') or acc.get('smtp_password') or '')
                imap_host2 = acc.get('imap_host') or acc['smtp_host'].replace('smtp.', 'imap.', 1)
                imap_port2 = int(acc.get('imap_port') or 993)
                M_sent = _imap.IMAP4_SSL(imap_host2, imap_port2)
                M_sent.login(acc.get('imap_user') or acc['email'], imap_pw2)
                M_sent.append('INBOX.Sent', '\Seen', _imap.Time2Internaldate(_time.time()), outer.as_bytes())
                M_sent.logout()
                print(f'[user-mail] Saved copy to INBOX.Sent')
            except Exception as _imap_ex:
                print(f'[user-mail] IMAP APPEND to Sent failed (non-fatal): {_imap_ex}')
        except Exception as ex:
            result["error"] = str(ex)
            print(f"[user-mail] Send error: {ex}")

    t = threading.Thread(target=go, daemon=True)
    t.start()
    t.join(30)
    if not result["queued"]:
        raise HTTPException(502, result["error"] or "SMTP send failed")
    return {"sent": True, "from": acc["email"], "to": to_email, "attachments": len(file_data)}

@router.get("/message-body/{acc_id}/{folder_enc}/{uid}")
async def fetch_message_body(acc_id: str, folder_enc: str, uid: str, actor: Actor = Depends(get_actor)):
    import urllib.parse, json as _json
    folder = urllib.parse.unquote(folder_enc)
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT html_body, body, attachments FROM imap_messages WHERE account_id=$1 AND folder=$2 AND imap_uid=$3",
            acc_id, folder, uid)
        # Return from cache if body and attachments (with data) are stored
        if row and (row["html_body"] or row["body"]) and row["attachments"] is not None:
            stored_atts = row["attachments"] if isinstance(row["attachments"], list) else _json.loads(row["attachments"] or "[]")
            # All attachments must have base64 data field to serve from cache
            all_have_data = all(a.get("data") for a in stored_atts) if stored_atts else True
            print("[BODY] uid=" + str(uid) + " atts=" + str(len(stored_atts)) + " all_have_data=" + str(all_have_data))
            if all_have_data:
                return {"html_body": row["html_body"] or "", "body": row["body"] or "", "cached": True, "attachments": stored_atts}
            # Missing data — re-fetch from IMAP
        acc_row = await conn.fetchrow(
            "SELECT * FROM user_email_accounts WHERE id=$1 AND user_id=$2 AND tenant_id=$3",
            acc_id, actor.user_id, actor.tenant_id)
        if not acc_row:
            raise HTTPException(404, "Account not found")
    acc = dict(acc_row)
    imap_pw = _simple_decrypt(acc.get("imap_password") or "")
    result = {"html_body": "", "body": "", "cached": False, "attachments": []}
    def fetch_body():
        try:
            if acc.get("imap_ssl", True):
                M = imaplib.IMAP4_SSL(acc["imap_host"], acc.get("imap_port", 993))
            else:
                M = imaplib.IMAP4(acc["imap_host"], acc.get("imap_port", 143))
            M.login(acc.get("imap_user") or acc.get("smtp_user", ""), imap_pw)
            M.select(folder, readonly=True)
            # Try UID-based fetch first (stable across deletions)
            try:
                _, data = M.uid('FETCH', uid.encode(), '(RFC822)')
            except Exception:
                data = None
            # Fallback to sequence number fetch
            if not data or not data[0] or not isinstance(data[0], tuple):
                try:
                    _, data = M.fetch(uid.encode(), "(RFC822)")
                except Exception:
                    data = None
            if data and data[0] and isinstance(data[0], tuple):
                msg = email_lib.message_from_bytes(data[0][1])
                plain, html, attachments = _get_body(msg)
                result["html_body"] = html or ""
                result["body"] = plain or ""
                # Strip base64 data from attachments before storing in DB (metadata only)
                result["attachments"] = attachments or []
            M.logout()
        except Exception as ex:
            print(f"[BODY FETCH] {ex}")
    import asyncio, json as _json2
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, fetch_body)
    if result["html_body"]:
        result["html_body"] = sanitize_email_html(result["html_body"])
    # Store body + full attachment data in DB (JSONB handles it fine for typical email sizes)
    if result["html_body"] or result["body"]:
        async with db.tenant_conn(actor.tenant_id) as conn:
            await conn.execute(
                "UPDATE imap_messages SET html_body=$1, body=$2, attachments=$3 WHERE account_id=$4 AND folder=$5 AND imap_uid=$6",
                result["html_body"] or None, result["body"], _json2.dumps(result["attachments"]), acc_id, folder, uid)
    return result



@router.get("/attachment/{acc_id}/{folder_enc}/{uid}/{att_index}")
async def download_attachment(acc_id: str, folder_enc: str, uid: str, att_index: int, actor: Actor = Depends(get_actor)):
    """Return base64 data for a specific attachment — fetched from IMAP or DB cache"""
    import urllib.parse, json as _json2
    folder = urllib.parse.unquote(folder_enc)
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT attachments FROM imap_messages WHERE account_id=$1 AND folder=$2 AND imap_uid=$3",
            acc_id, folder, uid)
        acc_row = await conn.fetchrow(
            "SELECT * FROM user_email_accounts WHERE id=$1 AND user_id=$2 AND tenant_id=$3",
            acc_id, actor.user_id, actor.tenant_id)
        if not acc_row:
            raise HTTPException(404, "Account not found")
    acc = dict(acc_row)
    # Check if DB cache has the data
    if row and row["attachments"]:
        atts = row["attachments"] if isinstance(row["attachments"], list) else _json2.loads(row["attachments"] or "[]")
        if att_index < len(atts) and atts[att_index].get("data"):
            return {"data": atts[att_index]["data"], "filename": atts[att_index]["filename"], "mime_type": atts[att_index].get("mime_type", "application/octet-stream")}
    # Fetch from IMAP
    imap_pw = _simple_decrypt(acc.get("imap_password") or "")
    result = {"data": None, "filename": "", "mime_type": ""}
    def fetch_att():
        try:
            M = imaplib.IMAP4_SSL(acc["imap_host"], acc.get("imap_port", 993)) if acc.get("imap_ssl", True) else imaplib.IMAP4(acc["imap_host"], acc.get("imap_port", 143))
            M.login(acc.get("imap_user") or acc.get("smtp_user", ""), imap_pw)
            M.select(folder, readonly=True)
            # Try UID-based fetch first (stable across deletions)
            try:
                _, data = M.uid('FETCH', uid.encode(), '(RFC822)')
            except Exception:
                data = None
            # Fallback to sequence number fetch
            if not data or not data[0] or not isinstance(data[0], tuple):
                try:
                    _, data = M.fetch(uid.encode(), "(RFC822)")
                except Exception:
                    data = None
            if data and data[0] and isinstance(data[0], tuple):
                msg = email_lib.message_from_bytes(data[0][1])
                plain, html, attachments = _get_body(msg)
                if att_index < len(attachments):
                    a = attachments[att_index]
                    result["data"] = a["data"]
                    result["filename"] = a["filename"]
                    result["mime_type"] = a.get("mime_type", "application/octet-stream")
                # Store full data in DB
                import asyncio as _aio2
                async def _store():
                    async with db.tenant_conn(actor.tenant_id) as conn2:
                        await conn2.execute(
                            "UPDATE imap_messages SET attachments=$1 WHERE account_id=$2 AND folder=$3 AND imap_uid=$4",
                            _json2.dumps(attachments), acc_id, folder, uid)
                _aio2.run(_store())
            M.logout()
        except Exception as ex:
            print(f"[ATT FETCH] {ex}")
    import asyncio
    await asyncio.get_event_loop().run_in_executor(None, fetch_att)
    if not result["data"]:
        raise HTTPException(404, "Attachment not found")
    return result


@router.get("/eml/{acc_id}/{folder_enc}/{uid}")
async def download_eml(acc_id: str, folder_enc: str, uid: str, actor: Actor = Depends(get_actor)):
    """Return raw RFC822 email as base64 for .eml download"""
    import urllib.parse, base64 as _b64
    folder = urllib.parse.unquote(folder_enc)
    async with db.tenant_conn(actor.tenant_id) as conn:
        acc_row = await conn.fetchrow(
            "SELECT * FROM user_email_accounts WHERE id=$1 AND user_id=$2 AND tenant_id=$3",
            acc_id, actor.user_id, actor.tenant_id)
        if not acc_row:
            raise HTTPException(404, "Account not found")
    acc = dict(acc_row)
    imap_pw = _simple_decrypt(acc.get("imap_password") or "")
    result = {"data": None, "filename": f"email_{uid}.eml"}

    def fetch_raw():
        try:
            M = imaplib.IMAP4_SSL(acc["imap_host"], acc.get("imap_port", 993)) if acc.get("imap_ssl", True) else imaplib.IMAP4(acc["imap_host"], acc.get("imap_port", 143))
            M.login(acc.get("imap_user") or acc.get("smtp_user", ""), imap_pw)
            M.select(folder, readonly=True)
            # Try UID-based fetch first (stable across deletions)
            try:
                _, data = M.uid('FETCH', uid.encode(), '(RFC822)')
            except Exception:
                data = None
            # Fallback to sequence number fetch
            if not data or not data[0] or not isinstance(data[0], tuple):
                try:
                    _, data = M.fetch(uid.encode(), "(RFC822)")
                except Exception:
                    data = None
            if data and data[0] and isinstance(data[0], tuple):
                result["data"] = _b64.b64encode(data[0][1]).decode()
            M.logout()
        except Exception as ex:
            print(f"[EML] {ex}")

    import asyncio
    await asyncio.get_event_loop().run_in_executor(None, fetch_raw)
    if not result["data"]:
        raise HTTPException(404, "Email not found")
    return result
