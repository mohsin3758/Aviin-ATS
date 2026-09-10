"""Resume Intake Router — Phases 1-6 API endpoints"""
import json, os
from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from typing import Optional
import db
from deps import Actor, get_actor

router = APIRouter(prefix='/resume-intake', tags=['resume-intake'])

OLLAMA_URL = os.getenv('OLLAMA_URL', 'http://ollama:11434')
OLLAMA_MODEL = os.getenv('OLLAMA_MODEL', 'qwen2.5:1.5b-instruct-q4_K_M')


# ─── Stats endpoint (Phase 6) ─────────────────────────────────────────────────
@router.get('/stats')
async def intake_stats(owned: str = Query(None), actor: Actor = Depends(get_actor)):
    # REAL BUG FIX (2026-08-31): reported live — every number on this page
    # ("Resumes Today"/"Candidates Created"/"Total Auto-Created"/"Pending
    # Processing", plus the source-breakdown chips just below them) stayed
    # byte-identical whether "All Resumes" or "My Resumes" was selected,
    # while the actual row list correctly changed. Root cause: this
    # endpoint never accepted the same real owned=mine param
    # intake_queue() already uses — the frontend's tab click never even
    # sent it. Same "mine = received in my own connected mailbox OR I
    # currently own the resulting candidate" definition, reused via a
    # shared condition string rather than 3 near-duplicate copies.
    mine_cond, mine_params = '', []
    if owned == 'mine':
        mine_cond = (
            " AND (EXISTS (SELECT 1 FROM imap_messages im2 JOIN user_email_accounts ua2 ON ua2.id=im2.account_id "
            "WHERE im2.id=rf.imap_msg_id AND ua2.user_id=$2) "
            "OR EXISTS (SELECT 1 FROM candidate_ownership co2 WHERE co2.tenant_id=$1 AND co2.candidate_id=rf.candidate_id "
            "AND co2.status='active' AND co2.ownership_expires_at > now() AND co2.recruiter_id=$2))"
        )
        mine_params = [actor.user_id]
    async with db.tenant_conn(actor.tenant_id) as conn:
        # Same is_active gap as by_source below — "Resumes Today"/
        # "Candidates Created" were counting resumes whose candidate has
        # since been soft-deleted.
        today = await conn.fetchrow(f"""
            SELECT
              COUNT(*) as total_today,
              COUNT(candidate_id) as candidates_today,
              COUNT(DISTINCT job_board) as sources_today
            FROM resume_files rf
            LEFT JOIN candidates c ON c.id = rf.candidate_id
            WHERE rf.tenant_id=$1 AND rf.created_at::date=CURRENT_DATE
              AND (rf.candidate_id IS NULL OR c.is_active IS NOT FALSE){mine_cond}""",
            actor.tenant_id, *mine_params)
        # Real bug fix (2026-08-30): had no is_active filter on the linked
        # candidate — a resume whose candidate has since been soft-deleted
        # still counted toward this badge's total, even though the actual
        # queue list (intake_queue() below) already correctly excludes it
        # via `(rf.candidate_id IS NULL OR c.is_active IS NOT FALSE)`.
        # Confirmed live: this tenant's real "Manual Add Candidate" badge
        # read 101 while filtering to that source showed only 2 real rows
        # — the other 99 were all soft-deleted test-suite candidates whose
        # resume_files row was never cleaned up. Same is_active-on-a-
        # joined-table gap class documented repeatedly elsewhere in this
        # project, just never checked in this specific summary query.
        by_source = await conn.fetch(f"""
            SELECT job_board_label as source, job_board,
                   COUNT(*) as total,
                   COUNT(candidate_id) as with_candidate,
                   COUNT(CASE WHEN parse_status='done' THEN 1 END) as parsed
            FROM resume_files rf
            LEFT JOIN candidates c ON c.id = rf.candidate_id
            WHERE rf.tenant_id=$1 AND rf.created_at > NOW()-INTERVAL '7 days'
              AND (rf.candidate_id IS NULL OR c.is_active IS NOT FALSE){mine_cond}
            GROUP BY job_board_label, job_board ORDER BY total DESC""",
            actor.tenant_id, *mine_params)
        if owned == 'mine':
            total_auto = await conn.fetchval("""
                SELECT COUNT(*) FROM candidates c
                WHERE c.tenant_id=$1 AND c.auto_created=TRUE AND c.is_active IS NOT FALSE
                  AND (EXISTS (SELECT 1 FROM resume_files rf2 JOIN imap_messages im2 ON im2.id=rf2.imap_msg_id
                               JOIN user_email_accounts ua2 ON ua2.id=im2.account_id
                               WHERE rf2.candidate_id=c.id AND ua2.user_id=$2)
                       OR EXISTS (SELECT 1 FROM candidate_ownership co2 WHERE co2.tenant_id=$1 AND co2.candidate_id=c.id
                                  AND co2.status='active' AND co2.ownership_expires_at > now() AND co2.recruiter_id=$2))""",
                actor.tenant_id, actor.user_id)
        else:
            total_auto = await conn.fetchval(
                "SELECT COUNT(*) FROM candidates WHERE tenant_id=$1 AND auto_created=TRUE AND is_active IS NOT FALSE",
                actor.tenant_id)
        # "Pending Processing" (unprocessed inbox attachments) is real per-
        # mailbox data — in the "All" view it should mean every connected
        # mailbox tenant-wide, not just the caller's own (the old,
        # unconditional ua.user_id=$2 filter made it silently identical
        # regardless of tab). "My" keeps the original, correct self-scope.
        if owned == 'mine':
            pending = await conn.fetchval("""
                SELECT COUNT(*) FROM imap_messages im
                JOIN user_email_accounts ua ON ua.id=im.account_id
                WHERE im.tenant_id=$1 AND ua.user_id=$2 AND ua.is_active=TRUE
                  AND im.is_deleted IS NOT TRUE AND im.folder='INBOX'
                  AND (im.auto_processed IS NOT TRUE)
                  AND im.attachments IS NOT NULL AND im.attachments!='[]'""",
                actor.tenant_id, actor.user_id)
        else:
            pending = await conn.fetchval("""
                SELECT COUNT(*) FROM imap_messages im
                JOIN user_email_accounts ua ON ua.id=im.account_id
                WHERE im.tenant_id=$1 AND ua.is_active=TRUE
                  AND im.is_deleted IS NOT TRUE AND im.folder='INBOX'
                  AND (im.auto_processed IS NOT TRUE)
                  AND im.attachments IS NOT NULL AND im.attachments!='[]'""",
                actor.tenant_id)
        # Real bug fix (2026-09-08): parse_status='done' (set by the
        # Re-parse action) was a real, sizeable backlog — 2,099 rows on
        # this tenant at the time this was found — with no status-filter
        # button anywhere in the UI to reach it, and the "Review Needed"
        # KPI card's own sub-label ("status=done") was structurally
        # impossible to populate for anyone since that filter state could
        # only ever be set via a hand-typed URL param, never a click.
        # This is the real, independently-scoped count that card now
        # reads, instead of the old `statusFilter==='done' ? items.length
        # : undefined` hack (which showed nothing for basically everyone).
        pending_review = await conn.fetchval(f"""
            SELECT COUNT(*) FROM resume_files rf
            LEFT JOIN candidates c ON c.id = rf.candidate_id
            WHERE rf.tenant_id=$1 AND rf.parse_status='done'
              AND (rf.candidate_id IS NULL OR c.is_active IS NOT FALSE){mine_cond}""",
            actor.tenant_id, *mine_params)
        # Real gap fix (2026-09-08): 1,403 real resumes (18% of this
        # tenant's queue at the time this was found) have no candidate_id
        # at all — no dedicated way anywhere to see "these are the ones
        # still needing a decision on whether they even become a
        # candidate." A genuinely unlinked resume, by definition, has no
        # candidate row for the mine_cond ownership half to match against
        # — only the mailbox-ownership half of that condition can ever
        # apply here, so mine_cond (built above for the candidate_ownership
        # EXISTS clause) is reused as-is; it degrades correctly.
        unlinked = await conn.fetchval(f"""
            SELECT COUNT(*) FROM resume_files rf
            WHERE rf.tenant_id=$1 AND rf.candidate_id IS NULL
              AND rf.parse_status NOT IN ('rejected','non_resume_doc','not_a_resume'){mine_cond}""",
            actor.tenant_id, *mine_params)
    return {
        'today': dict(today) if today else {},
        'total_auto_candidates': total_auto,
        'pending_emails': pending,
        'pending_review': pending_review,
        'unlinked': unlinked,
        'by_source': [dict(r) for r in by_source],
    }


# ─── Queue endpoint (Phase 6) ─────────────────────────────────────────────────
@router.get('/queue')
async def intake_queue(
    status: str = Query('all'),
    source: str = Query(None),
    req_id: str = Query(None),
    owned: str = Query(None),  # 'mine' — 2026-08-30, matching candidates.py's owned=mine
    # New Resume Inbox filters (2026-09-07 sender-attribution spec): match
    # on the Golden-Rule-resolved Source Recruiter (name or email), the
    # raw Sender Email, the receiving KAE (name or email), and a real
    # received-date range — "KAE should instantly know which recruiter
    # submitted this profile... without opening the resume or tracking
    # sheet" is exactly what these expose as real columns + filters.
    recruiter: str = Query(None),
    sender_email: str = Query(None),
    kae: str = Query(None),
    date_from: str = Query(None),
    date_to: str = Query(None),
    # Real gap fix (2026-09-08): "1,403 resumes have no candidate record
    # at all — no dedicated way to filter to just those" — a resume that
    # never became a candidate (parsing gave up, or nobody's decided yet)
    # is exactly the kind of item most likely to need a human's attention.
    unlinked: bool = Query(False),
    limit: int = Query(100, le=500),
    offset: int = Query(0),
    actor: Actor = Depends(get_actor)
):
    async with db.tenant_conn(actor.tenant_id) as conn:
        # (candidate_id may be NULL — a resume not yet linked to a
        # candidate must still show up for review)
        conditions = ['rf.tenant_id=$1', '(rf.candidate_id IS NULL OR c.is_active IS NOT FALSE)']
        if unlinked:
            conditions.append('rf.candidate_id IS NULL')
        params = [actor.tenant_id]
        p = 2
        if status == 'all':
            # In the 'all' view, hide JD files — they're not candidates
            conditions.append("rf.parse_status != 'non_resume_doc'")
        elif status != 'all':
            conditions.append(f'rf.parse_status=${p}')
            params.append(status); p += 1
        if source:
            conditions.append(f'rf.job_board=${p}')
            params.append(source); p += 1
        if req_id:
            conditions.append(f'(rf.requisition_id=${p}::uuid OR rf.candidate_id IN (SELECT id FROM candidates WHERE matched_requisition_id=${p}::uuid AND tenant_id=$1))')
            params.append(req_id); p += 1
        if owned == 'mine':
            # Real feature (2026-08-30): "each recruiter should have their
            # own resume box, not everyone's" — reported live. A resume is
            # "mine" if it arrived in MY connected mailbox (real, per-
            # message attribution via user_email_accounts), OR the
            # candidate is currently one I own (candidate_ownership, the
            # same 30-day FCFS system the Candidates page's own
            # owned=mine filter already uses) — covers every intake
            # channel, not just personal mailboxes.
            conditions.append(
                f"(EXISTS (SELECT 1 FROM imap_messages im2 JOIN user_email_accounts ua2 ON ua2.id=im2.account_id "
                f"WHERE im2.id=rf.imap_msg_id AND ua2.user_id=${p}) "
                f"OR EXISTS (SELECT 1 FROM candidate_ownership co2 WHERE co2.tenant_id=$1 AND co2.candidate_id=rf.candidate_id "
                f"AND co2.status='active' AND co2.ownership_expires_at > now() AND co2.recruiter_id=${p}))"
            )
            params.append(actor.user_id); p += 1
        if recruiter:
            conditions.append(
                f"EXISTS (SELECT 1 FROM candidate_ownership co3 WHERE co3.tenant_id=$1 AND co3.candidate_id=rf.candidate_id "
                f"AND (co3.recruiter_name ILIKE ${p} OR co3.recruiter_email ILIKE ${p}))")
            params.append(f"%{recruiter}%"); p += 1
        if sender_email:
            conditions.append(f'rf.source_email ILIKE ${p}')
            params.append(f"%{sender_email}%"); p += 1
        if kae:
            conditions.append(
                f"EXISTS (SELECT 1 FROM imap_messages im3 JOIN user_email_accounts ua3 ON ua3.id=im3.account_id "
                f"JOIN users u3 ON u3.id=ua3.user_id WHERE im3.id=rf.imap_msg_id "
                f"AND (u3.full_name ILIKE ${p} OR u3.email ILIKE ${p}))")
            params.append(f"%{kae}%"); p += 1
        if date_from:
            conditions.append(f'rf.created_at >= ${p}::date')
            params.append(date_from); p += 1
        if date_to:
            conditions.append(f"rf.created_at < (${p}::date + interval '1 day')")
            params.append(date_to); p += 1
        where = ' AND '.join(conditions)

        rows = await conn.fetch(f"""
            SELECT rf.id, rf.job_board, rf.job_board_label, rf.source_email,
                   rf.file_name, rf.file_path, rf.mime_type, rf.file_size,
                   rf.parse_status, rf.created_at, rf.parsed_data, rf.requisition_id,
                   rf.error_msg, rf.parse_confidence, rf.reject_reason, rf.reject_notes,
                   c.id as candidate_id, c.full_name, c.email, c.phone,
                   c.skills, c.total_exp_mo, c.location, c.current_employer,
                   c.current_designation, c.source_label, c.auto_created, c.jd_match_score,
                   c.matched_requisition_id,
                   im.subject as email_subject, im.received_at as email_received_at,
                   im.imap_uid,
                   r.title as requisition_title,
                   mr.title as matched_jd_title,
                   pl.stage as pipeline_stage, pl.pipeline_job,
                   sc.readiness_index AS live_match_score,
                   recv_u.full_name AS kae_name, recv_u.email AS kae_email,
                   -- Kept for backward compat with any existing caller —
                   -- received_by_name now means the same thing as kae_name.
                   recv_u.full_name AS received_by_name,
                   own.recruiter_name AS source_recruiter_name,
                   own.recruiter_email AS source_recruiter_email,
                   (own.recruiter_id IS NOT NULL) AS source_recruiter_registered,
                   own.recruiter_name AS owner_recruiter_name
            FROM resume_files rf
            LEFT JOIN candidates c ON c.id=rf.candidate_id
            LEFT JOIN imap_messages im ON im.id=rf.imap_msg_id
            LEFT JOIN requisitions r ON r.id=rf.requisition_id AND r.is_active IS NOT FALSE
            LEFT JOIN requisitions mr ON mr.id=c.matched_requisition_id AND mr.is_active IS NOT FALSE
            LEFT JOIN user_email_accounts recv_ua ON recv_ua.id = im.account_id
            LEFT JOIN users recv_u ON recv_u.id = recv_ua.user_id
            LEFT JOIN LATERAL (
                SELECT a.stage, ar.title AS pipeline_job
                FROM applications a JOIN requisitions ar ON ar.id=a.requisition_id
                WHERE a.candidate_id=c.id ORDER BY a.updated_at DESC LIMIT 1
            ) pl ON c.id IS NOT NULL
            LEFT JOIN LATERAL (
                SELECT cs.readiness_index
                FROM candidate_scores cs
                WHERE cs.candidate_id=c.id
                  AND (c.matched_requisition_id IS NULL OR cs.requisition_id=c.matched_requisition_id)
                ORDER BY cs.scored_at DESC LIMIT 1
            ) sc ON c.id IS NOT NULL
            LEFT JOIN LATERAL (
                -- Golden Rule (2026-09-07): the real, sender-resolved
                -- current owner — LEFT JOIN + COALESCE so a Temporary
                -- Sender Record (recruiter_id IS NULL, an unregistered
                -- internal sender) still shows a real name, matching
                -- candidate_ownership.py's own get_ownership() exactly.
                SELECT co.recruiter_id, co.recruiter_email,
                       COALESCE(u.full_name, co.recruiter_name) AS recruiter_name
                FROM candidate_ownership co
                LEFT JOIN users u ON u.id = co.recruiter_id
                WHERE co.tenant_id=$1 AND co.candidate_id=c.id
            ) own ON c.id IS NOT NULL
            WHERE {where}
            ORDER BY rf.created_at DESC
            LIMIT ${p} OFFSET ${p+1}""",
            *params, limit, offset)

        total = await conn.fetchval(
            f"SELECT COUNT(*) FROM resume_files rf LEFT JOIN candidates c ON c.id=rf.candidate_id WHERE {where}",
            *params)

    items = []
    for r in rows:
        d = dict(r)
        if isinstance(d.get('parsed_data'), str):
            try: d['parsed_data'] = json.loads(d['parsed_data'])
            except Exception: d['parsed_data'] = {}
        if isinstance(d.get('skills'), (list, tuple)):
            d['skills'] = list(d['skills'])
        items.append(d)
    return {'total': total, 'items': items}


# ─── Process pending emails (Phase 1-5 trigger) ───────────────────────────────
@router.post('/process-pending')
async def process_pending(actor: Actor = Depends(get_actor)):
    from services.resume_intake_service import process_pending_batch
    return await process_pending_batch(
        actor.tenant_id, limit=50,
        ollama_url=OLLAMA_URL, ollama_model=OLLAMA_MODEL)


# ─── Single record detail ─────────────────────────────────────────────────────
@router.get('/{resume_file_id}')
async def get_resume_file(resume_file_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            SELECT rf.*, c.full_name, c.email, c.phone, c.skills, c.total_exp_mo,
                   c.location, c.current_employer, c.current_designation,
                   c.resume_text,
                   c.current_ctc, c.expected_ctc, c.notice_period_days,
                   c.job_type, c.nda_received, c.truecaller_verified, c.monthly_contract_salary,
                   r.title as requisition_title,
                   pl.stage as pipeline_stage, pl.pipeline_job,
                   sc.readiness_index AS live_match_score,
                   im.received_at AS email_received_at,
                   recv_u.full_name AS kae_name, recv_u.email AS kae_email,
                   own.recruiter_id AS source_recruiter_id,
                   own.recruiter_name AS source_recruiter_name,
                   own.recruiter_email AS source_recruiter_email,
                   (own.recruiter_id IS NOT NULL) AS source_recruiter_registered
            FROM resume_files rf
            LEFT JOIN candidates c ON c.id=rf.candidate_id
            LEFT JOIN requisitions r ON r.id=rf.requisition_id AND r.is_active IS NOT FALSE
            LEFT JOIN imap_messages im ON im.id=rf.imap_msg_id
            LEFT JOIN user_email_accounts recv_ua ON recv_ua.id = im.account_id
            LEFT JOIN users recv_u ON recv_u.id = recv_ua.user_id
            LEFT JOIN LATERAL (
                SELECT a.stage, ar.title AS pipeline_job
                FROM applications a JOIN requisitions ar ON ar.id=a.requisition_id
                WHERE a.candidate_id=c.id ORDER BY a.updated_at DESC LIMIT 1
            ) pl ON c.id IS NOT NULL
            LEFT JOIN LATERAL (
                SELECT cs.readiness_index
                FROM candidate_scores cs
                WHERE cs.candidate_id=c.id
                  AND (c.matched_requisition_id IS NULL OR cs.requisition_id=c.matched_requisition_id)
                ORDER BY cs.scored_at DESC LIMIT 1
            ) sc ON c.id IS NOT NULL
            LEFT JOIN LATERAL (
                SELECT co.recruiter_id, co.recruiter_email,
                       COALESCE(u.full_name, co.recruiter_name) AS recruiter_name
                FROM candidate_ownership co
                LEFT JOIN users u ON u.id = co.recruiter_id
                WHERE co.tenant_id=$2 AND co.candidate_id=c.id
            ) own ON c.id IS NOT NULL
            WHERE rf.id=$1 AND rf.tenant_id=$2""",
            resume_file_id, actor.tenant_id)
    if not row:
        raise HTTPException(404, 'Resume file not found')
    d = dict(row)
    if isinstance(d.get('parsed_data'), str):
        try: d['parsed_data'] = json.loads(d['parsed_data'])
        except Exception: d['parsed_data'] = {}
    # Duplicate Candidate Rule: original source recruiter (immutable) +
    # any other real senders who also tried to submit this same candidate
    # while it was already owned (2026-09-07) — only meaningful once a
    # candidate record actually exists.
    d['original_source'] = None
    d['other_senders'] = []
    if d.get('candidate_id'):
        from services import candidate_ownership as _ownership
        async with db.tenant_conn(actor.tenant_id) as conn2:
            d['original_source'] = await _ownership.get_original_source(conn2, actor.tenant_id, str(d['candidate_id']))
            d['other_senders'] = await _ownership.get_other_senders(conn2, actor.tenant_id, str(d['candidate_id']))
    return d


# ─── Reparse with AI ─────────────────────────────────────────────────────────

@router.get("/{resume_file_id}/download")
async def download_resume_file(resume_file_id: str, actor: Actor = Depends(get_actor)):
    from fastapi.responses import FileResponse
    from pathlib import Path
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT file_name, file_path, mime_type FROM resume_files WHERE id=$1 AND tenant_id=$2",
            resume_file_id, actor.tenant_id
        )
    if not row:
        raise HTTPException(404, 'Resume file not found')
    fp = (row['file_path'] or '').lstrip('/')
    abs_path = Path('/app') / fp
    if not abs_path.exists():
        raise HTTPException(404, 'File missing from disk')
    mime = row['mime_type'] or 'application/octet-stream'
    fn = row['file_name'] or abs_path.name
    # Real bug fix (2026-08-30): a stored file_name can genuinely contain
    # embedded control characters (confirmed live — a real filename had a
    # literal \r\n in it, presumably carried over from an email subject/
    # attachment name with a line break). Embedding that raw into an HTTP
    # header value is invalid HTTP (a header can't contain a bare CR/LF)
    # — uvicorn correctly refuses to send it, which surfaced to the
    # browser as a bare "Download failed: 502" with no useful detail.
    # Strip any control character (C0 range) before it ever reaches a
    # header, for every filename, not just this one already-broken row.
    fn = ''.join(ch for ch in fn if ord(ch) >= 32)
    # Real bug fix (2026-09-06): a filename containing a genuinely valid,
    # printable-but-non-Latin-1 character (confirmed live — "Chandra_
    # Associate Managing Consultant – SAP FICO.pdf", a Unicode EN DASH
    # U+2013, not a plain ASCII hyphen) crashed with "Download failed:
    # 500" — HTTP headers are transmitted as latin-1, and U+2013 can't be
    # latin-1-encoded at all, so the explicit
    # headers={'Content-Disposition': ...} override below raised a raw,
    # unhandled UnicodeEncodeError the instant uvicorn tried to send it.
    # The fix is simply to STOP overriding it: Starlette's own
    # FileResponse(filename=...) already builds a correct
    # Content-Disposition header on its own — RFC 5987's
    # filename*=utf-8''<percent-encoded> whenever the name needs it,
    # falling back to a plain filename="..." otherwise — the manual
    # override here was silently bypassing that correct, already-built-in
    # logic for every single download, not just this one filename.
    return FileResponse(str(abs_path), media_type=mime, filename=fn)

@router.post('/{resume_file_id}/reparse')
async def reparse_resume(resume_file_id: str, actor: Actor = Depends(get_actor)):
    from services.resume_intake_service import (
        extract_text_from_attachment, regex_parse_resume,
        parse_with_ollama, merge_parsed, upsert_candidate)
    from pathlib import Path

    async with db.tenant_conn(actor.tenant_id) as conn:
        rf = await conn.fetchrow(
            "SELECT * FROM resume_files WHERE id=$1 AND tenant_id=$2",
            resume_file_id, actor.tenant_id)
        if not rf:
            raise HTTPException(404, 'Not found')

        abs_path = Path('/app') / rf['file_path'].lstrip('/')
        if not abs_path.exists():
            raise HTTPException(400, 'File not on disk')

        # REAL BUG FOUND 2026-08-31: regex_parse_resume() falls back to
        # synthesizing a "name" from from_email's local-part
        # (source_email.split('@')[0].title()) whenever no real name is
        # found in the resume text - a reasonable last resort ONLY when
        # source_email genuinely is the candidate's own address. But
        # resume_files.source_email is stamped with the RAW original
        # sender/mailbox regardless of whether that sender was one of our
        # own staff - the is_internal_sender guard at original email
        # intake (process_email_for_resume) only ever blanked the NAME
        # HINT used for that one parse, never the value written to
        # source_email itself, and this Reparse action re-derives a name
        # from that stored value with no awareness the guard should still
        # apply. Confirmed live: 35 real, distinct candidates whose
        # resumes arrived via one real recruiter's mailbox and whose text
        # didn't yield an easy name match all got silently renamed to
        # that recruiter's own name ("Faisal K") on reparse. Fixed by
        # checking whether source_email is a real, currently-configured
        # internal account for this tenant before ever using it as a
        # name-derivation source - if so, treat it the same as "no email
        # hint available" (matches the exact protection the original
        # intake path already gives this same value).
        source_email = rf['source_email'] or ''
        name_fallback_email = source_email
        if source_email:
            is_internal = await conn.fetchval(
                "SELECT EXISTS(SELECT 1 FROM users WHERE tenant_id=$1 AND lower(email)=lower($2) "
                "UNION SELECT 1 FROM user_email_accounts WHERE tenant_id=$1 AND lower(email)=lower($2))",
                actor.tenant_id, source_email)
            if is_internal:
                name_fallback_email = ''
        data = abs_path.read_bytes()
        text = extract_text_from_attachment(data, rf['mime_type'] or '', rf['file_name'] or '')
        parsed = regex_parse_resume(text, '', name_fallback_email)
        llm = await parse_with_ollama(text, OLLAMA_URL, OLLAMA_MODEL)
        if llm:
            parsed = merge_parsed(parsed, llm)

        candidate_id = await upsert_candidate(
            conn, str(actor.tenant_id), parsed,
            rf['job_board'] or 'direct', rf['job_board_label'] or 'Direct',
            rf['source_email'] or '', rf['file_path'] or '', text)

        await conn.execute("""
            UPDATE resume_files SET parsed_data=$1,parse_status='done',candidate_id=$2
            WHERE id=$3""",
            json.dumps(parsed), candidate_id, resume_file_id)

    return {'status': 'reparsed', 'candidate_id': candidate_id, 'parsed': parsed}


# ─── Approve / reject ────────────────────────────────────────────────────────
@router.post('/{resume_file_id}/approve')
async def approve_resume(resume_file_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute(
            "UPDATE resume_files SET parse_status='approved' WHERE id=$1 AND tenant_id=$2",
            resume_file_id, actor.tenant_id)
    return {'status': 'approved'}


_VALID_REJECT_REASONS = {'not_a_resume', 'duplicate', 'poor_quality', 'wrong_role', 'spam', 'other'}


@router.post('/{resume_file_id}/reject')
async def reject_resume(resume_file_id: str, body: dict = None, actor: Actor = Depends(get_actor)):
    # Real gap fix (2026-09-08): Reject was a single click with zero
    # record of why — every real "Rejected" resume in this tenant carried
    # no reason at all. body is genuinely optional (a bare POST with no
    # body — e.g. an older client, or a bulk-reject caller — still works
    # exactly as before), but when a reason is given it's validated
    # against the same real CHECK constraint the DB itself enforces, so a
    # caller gets a clean 400 instead of a raw constraint-violation 500.
    body = body or {}
    reason = body.get('reason')
    notes = (body.get('notes') or '').strip() or None
    if reason and reason not in _VALID_REJECT_REASONS:
        raise HTTPException(400, f"Unknown reject reason '{reason}'")
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute(
            """UPDATE resume_files SET parse_status='rejected', reject_reason=$3, reject_notes=$4,
               rejected_by=$5, rejected_at=now() WHERE id=$1 AND tenant_id=$2""",
            resume_file_id, actor.tenant_id, reason, notes, actor.user_id)
    return {'status': 'rejected', 'reason': reason}


@router.post('/{resume_file_id}/update-and-approve')
async def update_and_approve(resume_file_id: str, body: dict, actor: Actor = Depends(get_actor)):
    """Edit parsed data and approve the resume — updates candidate record too."""
    from services.resume_intake_service import upsert_candidate
    async with db.tenant_conn(actor.tenant_id) as conn:
        rf = await conn.fetchrow(
            'SELECT * FROM resume_files WHERE id=$1 AND tenant_id=$2',
            resume_file_id, actor.tenant_id)
        if not rf:
            raise HTTPException(404, 'Not found')

        # Parse form data
        skills = body.get('skills', [])
        if isinstance(skills, str):
            skills = [s.strip() for s in skills.split(',') if s.strip()]
        try:
            exp_mo = int(float(body.get('experience_years') or 0) * 12)
        except Exception:
            exp_mo = 0

        parsed = {
            'name': body.get('name'),
            'email': body.get('email'),
            'phone': body.get('phone'),
            'location': body.get('location'),
            'current_company': body.get('current_company'),
            'current_designation': body.get('current_designation'),
            'experience_years': body.get('experience_years'),
            'skills': skills,
            'education': body.get('education'),
            'expected_ctc': body.get('expected_ctc'),
            'notice_period': body.get('notice_period'),
            'linkedin_url': body.get('linkedin_url'),
        }

        candidate_id = await upsert_candidate(
            conn, str(actor.tenant_id), parsed,
            rf['job_board'] or 'direct', rf['job_board_label'] or 'Direct',
            rf['source_email'] or '', rf['file_path'] or '',
            rf.get('resume_text', '') or '')

        # Force-update ALL edited fields
        if candidate_id and body.get('name'):
            await conn.execute(
                """UPDATE candidates SET
                  full_name = $2,
                  email = COALESCE($3, email),
                  phone = COALESCE($4, phone),
                  location = $5,
                  current_employer = $6,
                  current_designation = $7,
                  total_exp_mo = CASE WHEN $8 > 0 THEN $8 ELSE total_exp_mo END,
                  skills = CASE WHEN $9::text[] <> '{}'::text[] THEN $9 ELSE skills END,
                  updated_at = NOW(), parsed_at = NOW()
                WHERE id=$1 AND tenant_id=$10""",
                candidate_id, body.get('name'), body.get('email'),
                body.get('phone'), body.get('location'),
                body.get('current_company'), body.get('current_designation'),
                exp_mo, skills, str(actor.tenant_id))

        await conn.execute(
            """UPDATE resume_files SET parse_status='approved', candidate_id=$1,
               parsed_data=$2 WHERE id=$3""",
            candidate_id, json.dumps(parsed), resume_file_id)

    return {'status': 'approved', 'candidate_id': candidate_id}


@router.post('/candidates/{cand_id}/merge/{merge_id}')
async def merge_candidates(cand_id: str, merge_id: str, actor: Actor = Depends(get_actor)):
    """Merge merge_id into cand_id. cand_id is the canonical record kept."""
    import re
    uuid_re = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.I)
    if not uuid_re.match(cand_id) or not uuid_re.match(merge_id):
        raise HTTPException(422, 'Invalid UUID format')
    from services.dedup_service import merge_duplicate_candidates
    async with db.tenant_conn(actor.tenant_id) as conn:
        result = await merge_duplicate_candidates(conn, str(actor.tenant_id), cand_id, merge_id)
        if 'error' not in result:
            # Real bug fix (2026-09-08), same dedup_status gap as the
            # check above — a completed merge is the clearest possible
            # "this is resolved" signal; re-link (already handled by
            # merge_duplicate_candidates) means every resume_files row
            # now pointing at the survivor was just part of a real merge.
            await conn.execute(
                "UPDATE resume_files SET dedup_status='merged' WHERE tenant_id=$1 AND candidate_id=$2",
                actor.tenant_id, cand_id)
    if 'error' in result:
        raise HTTPException(404, result['error'])
    return result


@router.get('/candidates/{cand_id}/duplicates')
async def find_duplicates(cand_id: str, actor: Actor = Depends(get_actor)):
    """Find potential duplicates for a candidate using Phase F dedup logic."""
    import re
    if not re.match(r'^[0-9a-f-]{32,36}$', cand_id, re.I):
        raise HTTPException(422, 'Invalid UUID format')
    from services.dedup_service import check_duplicate, name_similarity
    async with db.tenant_conn(actor.tenant_id) as conn:
        cand = await conn.fetchrow(
            'SELECT * FROM candidates WHERE id=$1 AND tenant_id=$2', cand_id, actor.tenant_id)
        if not cand:
            raise HTTPException(404, 'Candidate not found')
        parsed = {
            'name': cand['full_name'],
            'email': cand['email'],
            'phone': cand['phone'],
            'linkedin_url': cand['linkedin_url'],
            'current_company': cand['current_employer'],
        }
        result = await check_duplicate(conn, str(actor.tenant_id), parsed)
        # Real bug fix (2026-09-08): dedup_status is a real, dedicated
        # resume_files column — but nothing anywhere ever wrote to it
        # (confirmed live: all 7,701 rows on this tenant sat at the
        # default 'new' forever). The one real signal that exists is
        # this check actually running — persist its outcome onto every
        # resume_files row tied to this candidate, so a later reviewer
        # (or a future "already vetted" filter) doesn't have to guess
        # whether a dup check ever happened.
        found_real_dup = result.matched_candidate_id and result.matched_candidate_id != cand_id
        await conn.execute(
            "UPDATE resume_files SET dedup_status=$1 WHERE tenant_id=$2 AND candidate_id=$3",
            'checked_duplicate' if found_real_dup else 'checked_unique',
            actor.tenant_id, cand_id)
        # If we matched ourselves, look for others
        if result.matched_candidate_id == cand_id:
            return {'duplicates': [], 'decision': 'SELF_MATCH'}
        return {
            'decision': result.decision,
            'score': result.score,
            'matched_candidate_id': result.matched_candidate_id,
            'evidence': result.evidence,
        }



# ── Phase G: Backfill candidate_parsed_data ────────────────────────────────
@router.post('/populate-parsed-data')
async def populate_parsed_data(actor: Actor = Depends(get_actor)):
    """
    Phase G backfill: Populate candidate_parsed_data from all existing resume_files.
    For each candidate, uses the file with the highest parse_confidence.
    Safe to run multiple times (upsert).
    """
    from services.cpd_service import backfill_candidate_parsed_data
    async with db.tenant_conn(actor.tenant_id) as conn:
        result = await backfill_candidate_parsed_data(conn, str(actor.tenant_id))
    return {
        'status': 'done',
        **result,
    }
