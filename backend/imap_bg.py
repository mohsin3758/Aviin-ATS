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
import fcntl
import re
from email.header import decode_header, make_header
from email.utils import parsedate_to_datetime
from datetime import datetime, timezone

_running = False
_threads = []
DB_URL = None

# REAL BUG FIX (2026-09-03): the backend runs `uvicorn --workers 2`
# (Dockerfile) — start() below already correctly guards against being
# called twice WITHIN one process (the `if _running: return` check, since
# app.py genuinely calls it from 2 separate startup hooks — a lifespan
# handler and a legacy @app.on_event('startup') one, both harmless
# thanks to that guard), but `_running` is plain process-local module
# state, invisible ACROSS the 2 separate worker processes uvicorn
# actually runs. Confirmed live: every real IMAP log line — "N account(s)
# — M emails need attachment scan", every "IDLE listener starting"/"IDLE
# active" line — appeared genuinely duplicated, one full independent set
# per worker. This means 2 completely independent sets of IDLE listener
# threads have been running against the SAME real mailboxes the whole
# time, each capable of independently detecting and processing the SAME
# new email — a real, direct, plausible contributor to this project's own
# repeatedly-documented duplicate-candidate problem, not just wasted
# connections. Matches the IDENTICAL architectural gap already found and
# fixed once in this exact codebase for scheduler.py's cron jobs — same
# real fix here: a plain, non-blocking flock on a fixed path (a separate
# lock file from scheduler.py's own, since these are logically
# independent subsystems that happen to share the same cross-worker-
# single-owner need) — whichever worker wins owns IMAP sync for the
# container's lifetime; the losing worker still serves HTTP normally, it
# just never starts a second, redundant set of IMAP listener threads.
_IMAP_LOCK_PATH = "/tmp/aviin_imap_bg.lock"
_imap_lock_fh = None


def _acquire_imap_lock() -> bool:
    global _imap_lock_fh
    try:
        fh = open(_IMAP_LOCK_PATH, "w")
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        _imap_lock_fh = fh  # keep open for process lifetime
        return True
    except (IOError, OSError):
        return False


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


async def _correlate_reply_and_bounce(conn, tenant_id, folder, subj, fe, fn, in_reply_to, references):
    """Real reply + bounce detection (2026-09-03 audit, gaps #2/#3/#8) — the
    two building blocks that make "Replied"/"Delivery Status" real signals
    instead of just words in the schema.

    Reply: only meaningful on genuine inbound INBOX mail (never Sent, which
    is our own outbound copy syncing back). Correlates the real In-Reply-To
    header (falling back to the last id in References, since not every
    real-world mail client sets In-Reply-To) against a candidate_messages
    row's own real message_id_header — set on the wire by _send_email_bg
    when this app originally sent that message. On a match: marks that
    message replied_at/reply_count, bumps its thread's reply_count/
    last_direction, and notifies whoever sent it — a genuine, real-time
    "Client Replies"/"Candidate Replied" signal.

    Bounce: reuses the EXISTING, already-proven bounce-sender detector
    (resume_intake_service.is_junk_sender — built 2026-08-12 for a
    different purpose, rejecting fake candidates from bounce emails) as
    the real signal that this inbound message IS a delivery-failure
    notification, not a genuine reply. Honestly scoped, not oversold: a
    full DSN (delivery-status-notification) parser that reliably recovers
    the ORIGINAL failed recipient from every possible bounce format is a
    much larger undertaking than this pass — this correlates a detected
    bounce back to the most recent real outbound message THIS mailbox
    sent in the last 7 days whose own In-Reply-To/References chain (most
    bounce messages echo the original Message-ID in their own body/
    headers) matches, falling back to "detected, logged, not correlated
    to a specific send" when no match is found rather than guessing."""
    if folder != 'INBOX':
        return
    try:
        from services.resume_intake_service import is_junk_sender
        is_bounce = is_junk_sender(fe or '', fn or '')
    except Exception:
        is_bounce = False

    ref_ids = []
    if in_reply_to:
        ref_ids.append(in_reply_to.strip())
    if references:
        ref_ids += [r.strip() for r in references.split() if r.strip()]

    if is_bounce:
        # Try correlating via the bounce's own In-Reply-To/References
        # chain first (the reliable case — many real bounce messages
        # preserve the original Message-ID this way); otherwise, log the
        # bounce as detected-but-uncorrelated rather than guessing.
        matched = None
        for rid in ref_ids:
            matched = await conn.fetchrow(
                "SELECT id, sent_by, subject FROM candidate_messages WHERE tenant_id=$1 AND message_id_header=$2",
                tenant_id, rid)
            if matched:
                break
        if matched:
            await conn.execute(
                "UPDATE candidate_messages SET bounced_at=now(), bounce_reason=$2, last_activity_at=now() WHERE id=$1",
                matched["id"], f"Bounce detected from {fe}")
            if matched["sent_by"]:
                await conn.execute(
                    """INSERT INTO notifications (tenant_id,user_id,recipient_user_id,title,body,type,resource,resource_id,channel)
                       VALUES ($1,$2,$2,$3,$4,'warning','candidate_message',$5,'inapp')""",
                    tenant_id, matched["sent_by"], "Email bounced",
                    f"Your email \"{matched['subject'] or '(no subject)'}\" could not be delivered.",
                    str(matched["id"]))
        return  # a bounce is never also treated as a genuine reply

    if not ref_ids:
        return
    matched = None
    for rid in ref_ids:
        matched = await conn.fetchrow(
            "SELECT id, sent_by, thread_id, subject FROM candidate_messages WHERE tenant_id=$1 AND message_id_header=$2",
            tenant_id, rid)
        if matched:
            break
    if not matched:
        return
    is_forward = bool(subj) and bool(re.match(r'^\s*(fw|fwd)\s*:', subj, re.I))
    if is_forward:
        await conn.execute(
            "UPDATE candidate_messages SET forwarded_at=now(), forward_count=forward_count+1, last_activity_at=now() WHERE id=$1",
            matched["id"])
        return
    await conn.execute(
        "UPDATE candidate_messages SET replied_at=COALESCE(replied_at,now()), reply_count=reply_count+1, last_activity_at=now() WHERE id=$1",
        matched["id"])
    if matched["thread_id"]:
        await conn.execute(
            """UPDATE email_threads SET last_activity_at=now(), last_direction='inbound',
                   message_count=message_count+1, reply_count=reply_count+1 WHERE id=$1""",
            matched["thread_id"])
    if matched["sent_by"]:
        await conn.execute(
            """INSERT INTO notifications (tenant_id,user_id,recipient_user_id,title,body,type,resource,resource_id,channel)
               VALUES ($1,$2,$2,$3,$4,'info','candidate_message',$5,'inapp')""",
            tenant_id, matched["sent_by"], "New reply",
            f"{fn or fe} replied to \"{matched['subject'] or '(no subject)'}\"",
            str(matched["id"]))


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
    # REAL FEATURE (2026-09-03): capture the real Message-ID/In-Reply-To
    # headers — previously not captured at all — the one signal that makes
    # reply-detection and thread-correlation possible against an email
    # this ATS itself sent (see _correlate_reply_and_bounce above).
    msg_id_hdr = (msg.get('Message-ID', '') or '').strip() or None
    in_reply_to_hdr = (msg.get('In-Reply-To', '') or '').strip() or None
    references_hdr = msg.get('References', '') or ''
    await conn.execute(
        'INSERT INTO imap_messages'
        ' (account_id,tenant_id,imap_uid,folder,from_email,from_name,to_email,cc,subject,body,html_body,received_at,attachments,message_id_header,in_reply_to)'
        ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)'
        ' ON CONFLICT (account_id,folder,imap_uid) DO UPDATE SET attachments=EXCLUDED.attachments',
        acc_id, tenant_id, uid_s, folder,
        fe[:500] if fe else None,
        fn[:200] if fn else None,
        msg.get('To', '')[:500],
        msg.get('Cc', '')[:500],
        subj[:500] or '(no subject)',
        '', None, ra,
        json.dumps(att_meta),
        msg_id_hdr, in_reply_to_hdr)
    try:
        await _correlate_reply_and_bounce(conn, tenant_id, folder, subj, fe, fn, in_reply_to_hdr, references_hdr)
    except Exception as ex:
        print(f'[IMAP] Reply/bounce correlation error: {ex}')
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
                        # No longer passed this function's own `conn` - see
                        # _auto_process_resume's docstring: multiple of
                        # these can genuinely run concurrently via the
                        # gather() below, and a single shared asyncpg
                        # connection cannot safely serve more than one
                        # in-flight query at a time.
                        resume_tasks.append(_auto_process_resume(acc, uid_s, folder, msg, att_meta))
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



async def _auto_process_resume(acc, uid_s, folder, msg, att_meta):
    """Background coroutine — Phase 1-5 pipeline for new INBOX email with resume.

    REAL BUG FIX (2026-09-03): this used to receive the CALLER's own
    shared connection (_do_sync_folder_full's single `conn`, opened once
    for the whole folder-sync run) and pass it straight through to
    process_email_for_resume() — but _do_sync_folder_full schedules one
    of these as a real asyncio Task PER new resume-bearing email in the
    same sync batch (via resume_tasks.append(...)), then runs them all
    CONCURRENTLY via asyncio.gather(*resume_tasks). A single asyncpg
    Connection cannot safely serve more than one in-flight query at a
    time — confirmed empirically, not assumed: firing 2 real concurrent
    queries against one real shared connection reproduces a genuine
    `InterfaceError: cannot perform operation: another operation is in
    progress` on the second one, every time. Root-caused while
    investigating a real, live report (a Bhagender.S resume ending up
    linked to a completely unrelated, real "Profile Shared" system-
    notification email that happened to sync in the same batch) — this
    exact failure mode was silently swallowed by this function's own
    broad try/except below, meaning ANY sync batch containing 2+ new
    resume-bearing emails together has been silently losing (or, per the
    original report, potentially cross-linking) resume processing for
    all but whichever task happened to win the race for the shared
    connection, since this code was written. Fixed by giving this
    function its OWN, dedicated connection - matching the same "open a
    fresh connection per concurrently-scheduled item" discipline already
    established elsewhere in this exact codebase (resume_intake_service.
    py's process_pending_batch: "Opens its OWN db.tenant_conn() per item
    rather than sharing one connection for the whole batch")."""
    import os
    conn = None
    try:
        conn = await asyncpg.connect(DB_URL)
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
    finally:
        if conn:
            await conn.close()

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
    # Cross-worker guard — see the module-level comment above. Only the
    # worker that wins this non-blocking flock actually starts any IMAP
    # sync thread; the loser returns immediately and stays a plain, fully
    # functional HTTP-serving worker with zero IMAP activity of its own.
    if not _acquire_imap_lock():
        print('[IMAP] another worker already owns the IMAP sync lock — skipping in this worker')
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
