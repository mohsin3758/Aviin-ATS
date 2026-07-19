"""Resume Intake Router — Phases 1-6 API endpoints"""
import json, os, base64
from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from typing import Optional
import db
from deps import Actor, get_actor

router = APIRouter(prefix='/resume-intake', tags=['resume-intake'])

OLLAMA_URL = os.getenv('OLLAMA_URL', 'http://ollama:11434')
OLLAMA_MODEL = os.getenv('OLLAMA_MODEL', 'qwen2.5:1.5b-instruct-q4_K_M')


def _parse_atts(atts):
    if isinstance(atts, str):
        try:
            return json.loads(atts or '[]')
        except Exception:
            return []
    return atts or []


# ─── Stats endpoint (Phase 6) ─────────────────────────────────────────────────
@router.get('/stats')
async def intake_stats(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        today = await conn.fetchrow("""
            SELECT
              COUNT(*) as total_today,
              COUNT(candidate_id) as candidates_today,
              COUNT(DISTINCT job_board) as sources_today
            FROM resume_files WHERE tenant_id=$1 AND created_at::date=CURRENT_DATE""",
            actor.tenant_id)
        by_source = await conn.fetch("""
            SELECT job_board_label as source, job_board,
                   COUNT(*) as total,
                   COUNT(candidate_id) as with_candidate,
                   COUNT(CASE WHEN parse_status='done' THEN 1 END) as parsed
            FROM resume_files WHERE tenant_id=$1 AND created_at > NOW()-INTERVAL '7 days'
            GROUP BY job_board_label, job_board ORDER BY total DESC""",
            actor.tenant_id)
        total_auto = await conn.fetchval(
            "SELECT COUNT(*) FROM candidates WHERE tenant_id=$1 AND auto_created=TRUE",
            actor.tenant_id)
        pending = await conn.fetchval("""
            SELECT COUNT(*) FROM imap_messages im
            JOIN user_email_accounts ua ON ua.id=im.account_id
            WHERE im.tenant_id=$1 AND ua.user_id=$2
              AND im.is_deleted IS NOT TRUE AND im.folder='INBOX'
              AND (im.auto_processed IS NOT TRUE)
              AND im.attachments IS NOT NULL AND im.attachments!='[]'""",
            actor.tenant_id, actor.user_id)
    return {
        'today': dict(today) if today else {},
        'total_auto_candidates': total_auto,
        'pending_emails': pending,
        'by_source': [dict(r) for r in by_source],
    }


# ─── Queue endpoint (Phase 6) ─────────────────────────────────────────────────
@router.get('/queue')
async def intake_queue(
    status: str = Query('all'),
    source: str = Query(None),
    req_id: str = Query(None),
    limit: int = Query(100, le=500),
    offset: int = Query(0),
    actor: Actor = Depends(get_actor)
):
    async with db.tenant_conn(actor.tenant_id) as conn:
        conditions = ['rf.tenant_id=$1']
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
        where = ' AND '.join(conditions)

        rows = await conn.fetch(f"""
            SELECT rf.id, rf.job_board, rf.job_board_label, rf.source_email,
                   rf.file_name, rf.file_path, rf.mime_type, rf.file_size,
                   rf.parse_status, rf.created_at, rf.parsed_data, rf.requisition_id,
                   c.id as candidate_id, c.full_name, c.email, c.phone,
                   c.skills, c.total_exp_mo, c.location, c.current_employer,
                   c.current_designation, c.source_label, c.auto_created, c.jd_match_score,
                   c.matched_requisition_id,
                   im.subject as email_subject, im.received_at as email_received_at,
                   im.imap_uid,
                   r.title as requisition_title,
                   mr.title as matched_jd_title
            FROM resume_files rf
            LEFT JOIN candidates c ON c.id=rf.candidate_id
            LEFT JOIN imap_messages im ON im.id=rf.imap_msg_id
            LEFT JOIN requisitions r ON r.id=rf.requisition_id
            LEFT JOIN requisitions mr ON mr.id=c.matched_requisition_id
            WHERE {where}
            ORDER BY rf.created_at DESC
            LIMIT ${p} OFFSET ${p+1}""",
            *params, limit, offset)

        total = await conn.fetchval(
            f"SELECT COUNT(*) FROM resume_files rf WHERE {where}", *params)

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
    from services.resume_intake_service import process_email_for_resume, is_resume_attachment
    import asyncpg

    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT im.id, im.imap_uid, im.folder, im.from_email, im.from_name,
                   im.subject, im.attachments, im.tenant_id,
                   ua.imap_host, ua.imap_port, ua.imap_user, ua.imap_password,
                   ua.email as smtp_email, ua.display_name,
                   ua.smtp_host, ua.smtp_port, ua.smtp_user, ua.smtp_password, ua.smtp_tls
            FROM imap_messages im
            JOIN user_email_accounts ua ON ua.id=im.account_id
            WHERE im.tenant_id=$1 AND im.is_deleted IS NOT TRUE
              AND im.folder='INBOX'
              AND (im.auto_processed IS NOT TRUE)
              AND im.attachments IS NOT NULL AND im.attachments!='[]'
            ORDER BY im.received_at DESC LIMIT 100""",
            actor.tenant_id)

        processed = skipped = created = errors = 0
        for row in rows:
            attachments = _parse_atts(row['attachments'])
            has_resume = any(
                is_resume_attachment(a.get('filename', ''), a.get('mime_type', ''))
                for a in attachments)
            if not has_resume:
                await conn.execute(
                    "UPDATE imap_messages SET auto_processed=TRUE,process_status='no_resume' WHERE id=$1",
                    row['id'])
                skipped += 1
                continue

            try:
                from services.resume_intake_service import _simple_decrypt as _dec
            except ImportError:
                _dec = lambda x: x

            imap_pw = row['imap_password'] or ''
            smtp_acc = {
                'email': row['smtp_email'],
                'display_name': row['display_name'] or 'AVIIN Jobs',
                'smtp_host': row['smtp_host'] or '',
                'smtp_port': row['smtp_port'] or 587,
                'smtp_user': row['smtp_user'] or '',
                'smtp_password': imap_pw,
                'smtp_tls': row['smtp_tls'] if row['smtp_tls'] is not None else True,
            } if row.get('smtp_host') else None

            try:
                result = await process_email_for_resume(
                    conn=conn,
                    msg_id=str(row['id']),
                    tenant_id=str(row['tenant_id']),
                    account_id=None,
                    imap_uid=row['imap_uid'],
                    folder=row['folder'],
                    from_email=row['from_email'] or '',
                    from_name=row['from_name'] or '',
                    subject=row['subject'] or '',
                    attachments_meta=attachments,
                    imap_host=row['imap_host'],
                    imap_port=row['imap_port'] or 993,
                    imap_user=row['imap_user'],
                    imap_password=imap_pw,
                    ollama_url=OLLAMA_URL,
                    ollama_model=OLLAMA_MODEL,
                    smtp_acc=smtp_acc,
                )
                processed += 1
                if result.get('status') == 'done' and result.get('candidate_id'):
                    created += 1
            except Exception as ex:
                errors += 1
                print(f'[ResumeIntake] Error processing {row["id"]}: {ex}')

    return {
        'processed': processed,
        'skipped_no_resume': skipped,
        'candidates_created_or_updated': created,
        'errors': errors,
    }


# ─── Single record detail ─────────────────────────────────────────────────────
@router.get('/{resume_file_id}')
async def get_resume_file(resume_file_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            SELECT rf.*, c.full_name, c.email, c.phone, c.skills, c.total_exp_mo,
                   c.location, c.current_employer, c.current_designation,
                   r.title as requisition_title
            FROM resume_files rf
            LEFT JOIN candidates c ON c.id=rf.candidate_id
            LEFT JOIN requisitions r ON r.id=rf.requisition_id
            WHERE rf.id=$1 AND rf.tenant_id=$2""",
            resume_file_id, actor.tenant_id)
    if not row:
        raise HTTPException(404, 'Resume file not found')
    d = dict(row)
    if isinstance(d.get('parsed_data'), str):
        try: d['parsed_data'] = json.loads(d['parsed_data'])
        except Exception: d['parsed_data'] = {}
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
    return FileResponse(str(abs_path), media_type=mime, filename=fn,
        headers={'Content-Disposition': 'attachment; filename="' + fn + '"'})

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

        data = abs_path.read_bytes()
        text = extract_text_from_attachment(data, rf['mime_type'] or '', rf['file_name'] or '')
        parsed = regex_parse_resume(text, '', rf['source_email'] or '')
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


@router.post('/{resume_file_id}/reject')
async def reject_resume(resume_file_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute(
            "UPDATE resume_files SET parse_status='rejected' WHERE id=$1 AND tenant_id=$2",
            resume_file_id, actor.tenant_id)
    return {'status': 'rejected'}


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
