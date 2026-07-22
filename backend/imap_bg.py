"""
IMAP IDLE v6 — Full attachment support
- IDLE on INBOX + INBOX.Sent (instant sync)
- New emails: fetch full RFC822 to extract attachment metadata immediately
- Background scanner: batch-process all existing emails to populate attachments column
"""
import imaplib
import email as email_lib
import threading
import time
import base64
import asyncio
import asyncpg
import json
from email.header import decode_header, make_header
from email.utils import parsedate_to_datetime
from datetime import datetime, timezone

_running = False
_threads = []
DB_URL = None


def _dec(h):
    try:
        return str(make_header(decode_header(h or '')))
    except Exception:
        return h or ''


def _decrypt(enc):
    try:
        return base64.b64decode(enc.encode()).decode()
    except Exception:
        return enc or ''


def _extract_att_meta(msg):
    """Extract attachment metadata (no base64 data) from a parsed email message."""
    attachments = []
    if not msg.is_multipart():
        return attachments
    for part in msg.walk():
        cd = str(part.get('Content-Disposition', ''))
        cid = part.get('Content-ID', '')
        if 'attachment' in cd and not cid:
            try:
                fn = part.get_filename() or ''
                fn = str(make_header(decode_header(fn))) if fn else ''
                if not fn:
                    continue
                payload = part.get_payload(decode=True)
                if payload:
                    attachments.append({
                        'filename': fn,
                        'mime_type': part.get_content_type(),
                        'size': len(payload)
                    })
            except Exception:
                pass
    return attachments


async def _store_email(conn, acc_id, tenant_id, uid_s, folder, msg, internal_dt=None):
    """Parse a full RFC822 message and store to DB with attachment metadata.

    Some real-world emails (forwarded chains, malformed clients) have no
    Date header at all - parsedate_to_datetime('') raises, and the old
    fallback here was datetime.now(), which stamped genuinely old backfilled
    mail with the sync time. Falls back to the IMAP server's own
    INTERNALDATE (actual mailbox delivery time) when the caller has it,
    which is far more accurate than "now".
    """
    subj = _dec(msg.get('Subject', ''))
    fr = _dec(msg.get('From', ''))
    fn = fr.split('<')[0].strip().strip('"') if '<' in fr else fr.split('@')[0].strip()
    fe = fr.split('<')[1].rstrip('>').strip() if '<' in fr else fr.strip()
    ra = None
    try:
        ra = parsedate_to_datetime(msg.get('Date', ''))
    except Exception:
        ra = None
    if ra is None:
        ra = internal_dt or datetime.now(timezone.utc)
    att_meta = _extract_att_meta(msg)
    await conn.execute(
        'INSERT INTO imap_messages'
        ' (account_id,tenant_id,imap_uid,folder,from_email,from_name,to_email,cc,subject,body,html_body,received_at,attachments)'
        ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)'
        ' ON CONFLICT (account_id,folder,imap_uid) DO UPDATE SET attachments=EXCLUDED.attachments',
        acc_id, tenant_id, uid_s, folder,
        fe[:500] if fe else None,
        fn[:200] if fn else None,
        msg.get('To', '')[:500],
        msg.get('Cc', '')[:500],
        subj[:500] or '(no subject)',
        '', None, ra,
        json.dumps(att_meta))
    return att_meta


async def _do_sync_folder_full(acc, folder):
    """Sync new emails in a folder — fetch full RFC822 to capture attachments."""
    conn = None
    total = 0
    resume_tasks = []
    try:
        conn = await asyncpg.connect(DB_URL)
        max_uid = int(await conn.fetchval(
            'SELECT COALESCE(MAX(imap_uid::bigint),0) FROM imap_messages WHERE account_id=$1 AND folder=$2',
            acc['id'], folder) or 0)
        imap_pw = _decrypt(acc.get('imap_password') or '')
        M = imaplib.IMAP4_SSL(acc['imap_host'], acc.get('imap_port', 993))
        M.login(acc.get('imap_user') or acc.get('smtp_user', ''), imap_pw)
        rv, _ = M.select(folder, readonly=True)
        if rv != 'OK':
            M.logout()
            return 0
        # Use UID search for stable UIDs (not sequence numbers which change on deletion)
        try:
            _, nums = M.uid('SEARCH', None, 'ALL')
        except Exception:
            _, nums = M.search(None, 'ALL')
        all_uids = nums[0].split() if nums[0] else []
        new_uids = [u for u in all_uids if int(u) > max_uid]
        for uid in new_uids:
            try:
                try:
                    _, data = M.uid('FETCH', uid, '(INTERNALDATE RFC822)')
                except Exception:
                    _, data = M.fetch(uid, '(INTERNALDATE RFC822)')
                if not data or not data[0] or not isinstance(data[0], tuple):
                    continue
                msg = email_lib.message_from_bytes(data[0][1])
                internal_dt = None
                try:
                    it = imaplib.Internaldate2tuple(data[0][0])
                    if it:
                        internal_dt = datetime.fromtimestamp(time.mktime(it), tz=timezone.utc)
                except Exception:
                    internal_dt = None
                uid_s = uid.decode()
                att_meta = await _store_email(conn, acc['id'], acc['tenant_id'], uid_s, folder, msg, internal_dt)
                total += 1
                if att_meta:
                    print(f'[IMAP] New email uid={uid_s} folder={folder} has {len(att_meta)} attachment(s): {[a["filename"] for a in att_meta]}')
                    # Auto-process resume if INBOX email has resume attachment.
                    # This USED TO fire via asyncio.ensure_future() (schedule and
                    # forget) - but _run_sync_folder below creates a fresh event
                    # loop for this whole function and closes it the moment this
                    # function returns, so every scheduled-but-not-yet-run task
                    # was silently abandoned. The entire auto-capture pipeline
                    # never actually executed via live sync; resumes only ever
                    # got processed when someone manually clicked "Process
                    # Pending". Collecting tasks and awaiting them via gather()
                    # below actually runs them before the loop closes.
                    if folder == 'INBOX':
                        resume_tasks.append(_auto_process_resume(conn, acc, uid_s, folder, msg, att_meta))
            except Exception as ex:
                print(f'[IMAP] Sync err uid={uid}: {ex}')
        M.logout()
        if total:
            print(f'[IMAP] Synced {total} new email(s) in {folder}')
        if resume_tasks:
            await asyncio.gather(*resume_tasks, return_exceptions=True)
        return total
    except Exception as ex:
        print(f'[IMAP] Folder sync err {folder}: {ex}')
        return 0
    finally:
        if conn:
            await conn.close()



async def _auto_process_resume(conn, acc, uid_s, folder, msg, att_meta):
    """Background coroutine — Phase 1-5 pipeline for new INBOX email with resume."""
    import os
    try:
        from services.resume_intake_service import is_resume_attachment, process_email_for_resume

        has_resume = any(
            is_resume_attachment(a.get('filename', ''), a.get('mime_type', ''))
            for a in att_meta)
        if not has_resume:
            return

        msg_row = await conn.fetchrow(
            "SELECT id FROM imap_messages WHERE account_id=$1 AND imap_uid=$2 AND folder=$3",
            acc['id'], uid_s, folder)
        if not msg_row:
            return

        # Decrypt password if needed
        imap_pw = acc.get('imap_password') or ''
        if hasattr(imap_pw, 'encode'):
            try:
                from routers.user_mail import _simple_decrypt
                imap_pw = _simple_decrypt(imap_pw)
            except Exception:
                pass

        fr = _dec(msg.get('From', ''))
        fe = fr.split('<')[1].rstrip('>').strip() if '<' in fr else fr.strip()
        fn_raw = fr.split('<')[0].strip().strip('"') if '<' in fr else ''
        subject = _dec(msg.get('Subject', ''))

        result = await process_email_for_resume(
            conn=conn,
            msg_id=str(msg_row['id']),
            tenant_id=str(acc['tenant_id']),
            account_id=str(acc['id']),
            imap_uid=uid_s,
            folder=folder,
            from_email=fe,
            from_name=fn_raw,
            subject=subject,
            attachments_meta=att_meta,
            imap_host=acc.get('imap_host', 'imap.hostinger.com'),
            imap_port=int(acc.get('imap_port') or 993),
            imap_user=acc.get('imap_user') or acc.get('smtp_user', ''),
            imap_password=imap_pw,
            ollama_url=os.environ.get('OLLAMA_URL', 'http://ollama:11434'),
            ollama_model=os.environ.get('OLLAMA_MODEL', 'qwen2.5:1.5b-instruct-q4_K_M'),
        )
        if result.get('status') == 'done':
            print(f'[ResumeIntake] {result.get("label","?")} → {result.get("name","?")} uid={uid_s}')
        else:
            print(f'[ResumeIntake] {result.get("status","?")} uid={uid_s}')
    except Exception as ex:
        print(f'[ResumeIntake] Error uid={uid_s}: {ex}')

def _run_sync_folder(acc, folder):
    loop = asyncio.new_event_loop()
    r = loop.run_until_complete(_do_sync_folder_full(acc, folder))
    loop.close()
    return r


async def _scan_attachments_batch(acc, batch_size=50):
    """
    Background scanner: fetch full RFC822 for emails where attachments IS NULL,
    extract metadata, and store. Returns count processed.
    """
    conn = None
    try:
        conn = await asyncpg.connect(DB_URL)
        # Get a batch of unscanned emails per folder
        rows = await conn.fetch(
            'SELECT id, imap_uid, folder FROM imap_messages '
            'WHERE account_id=$1 AND attachments IS NULL '
            'ORDER BY received_at DESC LIMIT $2',
            acc['id'], batch_size)
        if not rows:
            return 0

        imap_pw = _decrypt(acc.get('imap_password') or '')
        email_addr = acc.get('imap_user') or acc.get('smtp_user', '')
        M = imaplib.IMAP4_SSL(acc['imap_host'], acc.get('imap_port', 993))
        M.login(email_addr, imap_pw)

        # Group by folder for efficient IMAP access
        by_folder = {}
        for r in rows:
            f = r['folder']
            if f not in by_folder:
                by_folder[f] = []
            by_folder[f].append(r)

        processed = 0
        for folder, folder_rows in by_folder.items():
            try:
                rv, _ = M.select(folder, readonly=True)
                if rv != 'OK':
                    continue
                for row in folder_rows:
                    uid = row['imap_uid']
                    try:
                        _, data = M.uid('FETCH', uid.encode(), '(RFC822)')
                        if not data or not data[0] or not isinstance(data[0], tuple):
                            # Can't fetch — mark as empty to avoid re-scanning
                            await conn.execute(
                                'UPDATE imap_messages SET attachments=$1 WHERE id=$2',
                                '[]', row['id'])
                            continue
                        msg = email_lib.message_from_bytes(data[0][1])
                        att_meta = _extract_att_meta(msg)
                        await conn.execute(
                            'UPDATE imap_messages SET attachments=$1 WHERE id=$2',
                            json.dumps(att_meta), row['id'])
                        if att_meta:
                            print(f'[IMAP Scanner] uid={uid} folder={folder}: {len(att_meta)} attachment(s) found')
                        processed += 1
                    except Exception as ex:
                        # Mark as empty on error to avoid infinite retry
                        try:
                            await conn.execute(
                                'UPDATE imap_messages SET attachments=$1 WHERE id=$2',
                                '[]', row['id'])
                        except Exception:
                            pass
            except Exception as ex:
                print(f'[IMAP Scanner] Folder {folder} err: {ex}')

        M.logout()
        return processed
    except Exception as ex:
        print(f'[IMAP Scanner] Batch err: {ex}')
        return 0
    finally:
        if conn:
            await conn.close()


def _attachment_scanner(acc):
    """Background thread: scan all existing emails for attachments in batches."""
    email_addr = acc.get('imap_user') or acc.get('smtp_user', 'unknown')
    print(f'[IMAP Scanner] Starting attachment scan for {email_addr}')

    total_scanned = 0
    while _running:
        try:
            loop = asyncio.new_event_loop()
            processed = loop.run_until_complete(_scan_attachments_batch(acc, batch_size=30))
            loop.close()

            if processed == 0:
                print(f'[IMAP Scanner] Done! Scanned {total_scanned} total emails for {email_addr}')
                return  # All emails scanned, exit thread
            total_scanned += processed
            print(f'[IMAP Scanner] Progress: {total_scanned} emails scanned for {email_addr}')
            # Small delay between batches to avoid hammering IMAP
            time.sleep(2)
        except Exception as ex:
            print(f'[IMAP Scanner] Error: {ex}')
            time.sleep(10)


def _idle_folder(acc, folder, label):
    """IDLE listener on a single IMAP folder — instant delivery via push."""
    email_addr = acc.get('imap_user') or acc.get('smtp_user', 'unknown')
    imap_pw = _decrypt(acc.get('imap_password') or '')
    host = acc['imap_host']
    port = acc.get('imap_port', 993)
    REFRESH = 25 * 60

    print(f'[IMAP {label}] IDLE listener starting for {email_addr} on {folder}')

    while _running:
        M = None
        try:
            M = imaplib.IMAP4_SSL(host, port)
            M.login(email_addr, imap_pw)
            rv, _ = M.select(folder, readonly=True)
            if rv != 'OK':
                print(f'[IMAP {label}] Cannot select {folder} — retry in 30s')
                try:
                    M.logout()
                except Exception:
                    pass
                time.sleep(30)
                continue

            _, caps = M.capability()
            cap_bytes = caps[0] if caps else b''
            if b'IDLE' not in cap_bytes:
                print(f'[IMAP {label}] No IDLE — polling {folder} every 30s')
                M.logout()
                while _running:
                    _run_sync_folder(acc, folder)
                    time.sleep(30)
                return

            print(f'[IMAP {label}] IDLE active on {folder}')

            while _running:
                _run_sync_folder(acc, folder)

                done_event = threading.Event()
                exists_event = threading.Event()

                def _timer_done():
                    done_event.set()
                    try:
                        M.send(b'DONE\r\n')
                    except Exception:
                        pass

                refresh_timer = threading.Timer(REFRESH, _timer_done)
                tag = M._new_tag()
                M.send(tag + b' IDLE\r\n')
                cont = M.readline()
                if b'+' not in cont:
                    refresh_timer.cancel()
                    raise Exception(f'IDLE rejected: {cont}')

                M.sock.settimeout(None)

                def _reader():
                    while not done_event.is_set():
                        try:
                            line = M.readline()
                            if not line:
                                done_event.set()
                                break
                            if b'EXISTS' in line:
                                print(f'[IMAP {label}] \U0001f4ec New email on {folder}: {line.decode().strip()}')
                                exists_event.set()
                                done_event.set()
                                try:
                                    M.send(b'DONE\r\n')
                                except Exception:
                                    pass
                                break
                            if b'BYE' in line:
                                done_event.set()
                                break
                        except Exception as re:
                            if not done_event.is_set():
                                print(f'[IMAP {label}] Reader err: {re}')
                            done_event.set()
                            break

                reader_t = threading.Thread(target=_reader, daemon=True)
                reader_t.start()
                refresh_timer.start()
                done_event.wait()
                refresh_timer.cancel()

                try:
                    M.sock.settimeout(5)
                    M.send(b'DONE\r\n')
                except Exception:
                    pass
                try:
                    M.readline()
                except Exception:
                    pass
                reader_t.join(timeout=3)

                if exists_event.is_set():
                    _run_sync_folder(acc, folder)

        except Exception as ex:
            print(f'[IMAP {label}] Error: {ex}')
            if M:
                try:
                    M.logout()
                except Exception:
                    pass
            try:
                _run_sync_folder(acc, folder)
            except Exception:
                pass
            if _running:
                print(f'[IMAP {label}] Reconnecting in 10s...')
                time.sleep(10)

    print(f'[IMAP {label}] Stopped for {email_addr}')


def _get_sent_folder(acc):
    folders = acc.get('discovered_folders') or []
    for f in folders:
        if 'Sent' in str(f):
            return str(f)
    return 'INBOX.Sent'


async def _get_accounts():
    conn = None
    try:
        conn = await asyncpg.connect(DB_URL)
        rows = await conn.fetch(
            'SELECT ua.id, ua.imap_host, ua.imap_port, ua.imap_user, ua.imap_password, '
            'ua.imap_ssl, ua.smtp_user, ua.discovered_folders, ua.tenant_id '
            'FROM user_email_accounts ua '
            'WHERE ua.imap_host IS NOT NULL AND ua.imap_password IS NOT NULL '
            'AND ua.is_active = TRUE AND ua.tenant_id IS NOT NULL')
        return [dict(r) for r in rows]
    except Exception as ex:
        print(f'[IMAP] Accounts err: {ex}')
        return []
    finally:
        if conn:
            await conn.close()


async def _count_unscanned():
    conn = None
    try:
        conn = await asyncpg.connect(DB_URL)
        n = await conn.fetchval('SELECT COUNT(*) FROM imap_messages WHERE attachments IS NULL')
        return n or 0
    except Exception:
        return 0
    finally:
        if conn:
            await conn.close()


def start(db_url: str, interval: int = 10):
    global _running, _threads, DB_URL
    if _running:
        return
    DB_URL = db_url
    _running = True

    def _launch():
        time.sleep(3)
        loop = asyncio.new_event_loop()
        accounts = loop.run_until_complete(_get_accounts())
        unscanned = loop.run_until_complete(_count_unscanned())
        loop.close()

        print(f'[IMAP] {len(accounts)} account(s) — {unscanned} emails need attachment scan')

        for acc in accounts:
            sent_folder = _get_sent_folder(acc)

            # Thread 1: IDLE on INBOX — instant inbound delivery
            t1 = threading.Thread(
                target=_idle_folder,
                args=(acc, 'INBOX', 'INBOX'),
                daemon=True,
                name=f'imap-inbox-{acc.get("imap_user", "?")}')
            t1.start()
            _threads.append(t1)

            # Thread 2: IDLE on Sent folder — instant outbound sync
            t2 = threading.Thread(
                target=_idle_folder,
                args=(acc, sent_folder, 'Sent'),
                daemon=True,
                name=f'imap-sent-{acc.get("imap_user", "?")}')
            t2.start()
            _threads.append(t2)

            # Thread 3: Background attachment scanner (runs until all emails are scanned)
            if unscanned > 0:
                t3 = threading.Thread(
                    target=_attachment_scanner,
                    args=(acc,),
                    daemon=True,
                    name=f'imap-scanner-{acc.get("imap_user", "?")}')
                t3.start()
                _threads.append(t3)
                print(f'[IMAP] Attachment scanner launched — will process {unscanned} emails in background')

        if not accounts:
            print('[IMAP] No accounts yet — retry in 60s')
            time.sleep(60)
            if _running:
                _launch()

    threading.Thread(target=_launch, daemon=True, name='imap-launcher').start()
    print('[IMAP] Started (IDLE + background attachment scanner)')
    # Phase C: Pre-load skill taxonomy cache for normalization
    async def _init_skills():
        try:
            import asyncpg, os
            conn = await asyncpg.connect(os.environ.get('DATABASE_URL', 'postgresql://app_user:apppw@db:5432/ats'))
            await conn.execute("SET app.tenant_id='a92d7fd7-fb72-47d8-881e-2493c61717ce'")
            from services.skill_normalizer import init_cache
            await init_cache(conn)
            await conn.close()
        except Exception as e:
            print(f'[SkillNorm] Cache init failed (non-fatal): {e}')
    asyncio.ensure_future(_init_skills())


def stop():
    global _running
    _running = False
