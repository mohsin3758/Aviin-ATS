"""Enhanced WhatsApp Bot — candidate self-service via WAHA."""
import httpx, os, asyncio
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
import db
from deps import Actor, get_actor, require_role

router = APIRouter(prefix="/whatsapp-bot", tags=["whatsapp-bot"])

WAHA_URL = os.getenv("WAHA_URL", "http://waha:3000")
WAHA_KEY  = os.getenv("WAHA_API_KEY", "")
SESSION   = "default"

HELP_LINES = [
    "*Aviin Tech Bot*",
    "",
    "Commands:",
    "STATUS — Check application status",
    "INTERVIEW — View upcoming interview",
    "OFFER — Check offer details",
    "CALLBACK — Request recruiter callback",
    "ACCEPT — Accept your offer",
    "DECLINE — Decline your offer",
]
HELP_MSG = "\n".join(HELP_LINES)

async def send_wa(phone: str, message: str, session: str = SESSION) -> bool:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                f"{WAHA_URL}/api/sendText",
                headers={"X-Api-Key": WAHA_KEY, "Content-Type": "application/json"},
                json={"session": session, "chatId": f"{phone}@c.us", "text": message}
            )
            return r.status_code < 400
    except Exception:
        return False


# ─── Inbound resume via WhatsApp ──────────────────────────────────────────────
# Built against WAHA's documented webhook contract for media messages
# (payload.hasMedia + payload.media.{url,mimetype,filename}) — verified
# end-to-end against real inbound WhatsApp messages with real resume
# attachments (2026-08-08, see CLAUDE.md). Fixed three real bugs found only
# by that live testing: the webhook URL WAHA stores can go stale after any
# backend container recreation (now points at the stable "backend" Docker
# service name, not a raw IP); WAHA's own media.url embeds its own
# self-referencing host ("localhost:3000", meaningless outside its own
# container) instead of a URL this container can actually reach; and
# WhatsApp's newer privacy-preserving "LID" sender identifiers (no phone
# number anywhere in the message payload at all) need a separate resolution
# call (see _resolve_phone).
_RESUME_MIME_HINTS = ("pdf", "msword", "wordprocessingml")


async def _download_waha_media(media: dict) -> Optional[bytes]:
    url = media.get("url")
    if not url:
        return None
    # WAHA embeds its own self-referencing host in the media URL (e.g.
    # "http://localhost:3000/...", correct from WAHA's own container's point
    # of view since it serves files on its own port 3000) — but that host is
    # meaningless from the backend container's network namespace, where
    # "localhost" is the backend's own loopback with nothing on port 3000.
    # Rewrite to the real internal Docker service address before fetching.
    from urllib.parse import urlsplit, urlunsplit
    parts = urlsplit(url)
    waha_parts = urlsplit(WAHA_URL)
    url = urlunsplit((waha_parts.scheme, waha_parts.netloc, parts.path, parts.query, parts.fragment))
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(url, headers={"X-Api-Key": WAHA_KEY})
            if r.status_code == 200:
                return r.content
            print(f"WAHA media download got status {r.status_code} for {url}")
    except Exception as ex:
        print(f"WAHA media download failed: {ex} (url={url})")
    return None


async def _handle_inbound_resume(phone: str, media: dict, tenant_id: str, whatsapp_account_id: str = None) -> str:
    from routers.intelligence import auto_score_candidate_bg
    from services.resume_intake_service import _fire_and_forget
    """Download + parse an inbound WhatsApp resume attachment, upsert a
    candidate (same regex-NER pipeline as email intake), log a resume_files
    row, and return the WhatsApp reply text to send back."""
    from services.resume_intake_service import (
        extract_text_from_attachment, upsert_candidate, save_resume_file,
    )
    from services.document_classifier import classify_document
    from services.improved_parser import parse_resume_v2
    import json as _json

    mimetype = (media.get("mimetype") or "").lower()
    # REAL BUG FIX (2026-08-12): this used to default a missing filename to
    # "resume.pdf", which made the check below pass on filename alone even
    # when the real mimetype (e.g. image/jpeg) clearly wasn't a resume —
    # confirmed live via 10 real garbage "Status" candidates created from
    # WhatsApp Status-broadcast photos this way. A neutral, non-resume-
    # looking default means the check now relies on the real mimetype,
    # which WAHA reports accurately.
    filename = media.get("filename") or "attachment"
    if not any(h in mimetype for h in _RESUME_MIME_HINTS) and not filename.lower().endswith((".pdf", ".doc", ".docx")):
        return "We can only accept resumes as PDF or Word documents right now."

    data = await _download_waha_media(media)
    if not data:
        return "We couldn't download your file — please try sending it again."

    text = extract_text_from_attachment(data, mimetype, filename)
    if not text or len(text.strip()) < 50:
        return "We received your file but couldn't read its contents — please send a PDF or Word resume."

    doc_result = classify_document(text, filename)
    if not doc_result.is_resume and doc_result.decision == "REJECT":
        return "Thanks for sharing, but this doesn't look like a resume — please send your CV as a PDF or Word file."

    parsed = parse_resume_v2(text, from_name="", from_email="", filename=filename)
    parsed["phone"] = phone  # authoritative — this WhatsApp number is a verified real channel identity

    file_path = save_resume_file(data, tenant_id, filename)
    async with db.tenant_conn(tenant_id) as conn:
        candidate_id = await upsert_candidate(
            conn, tenant_id, parsed, "whatsapp", "WhatsApp Inbound",
            f"{phone}@whatsapp", file_path, text)
        await conn.execute(
            """INSERT INTO resume_files
                 (tenant_id, candidate_id, job_board, job_board_label, source_email,
                  file_name, file_path, mime_type, file_size,
                  parse_status, parsed_data, parse_confidence, routing_decision)
               VALUES ($1,$2,'whatsapp','WhatsApp Inbound',$3,$4,$5,$6,$7,'auto_accepted',$8,$9,'auto_accepted')""",
            tenant_id, candidate_id, f"{phone}@whatsapp", filename, file_path, mimetype, len(data),
            _json.dumps(parsed), round(float(parsed.get("_confidence", 0.7) or 0.7), 3))
        # Real fix (2026-08-10 audit): inbound WhatsApp was never logged to
        # candidate_messages, so the Conversations page's WhatsApp folder
        # could never show an inbound message even though real ones arrive
        # daily. Logged here (resume) and in handle_cmd (commands) below.
        await conn.execute("""
            INSERT INTO candidate_messages
              (tenant_id, candidate_id, channel, direction, body, status, from_whatsapp_account_id)
            VALUES ($1,$2,'whatsapp','inbound',$3,'received',$4)
        """, tenant_id, candidate_id, f"[Resume attachment: {filename}]", whatsapp_account_id)

    # 2026-09-02 gap-audit fix: WhatsApp-inbound resumes were the one real
    # intake path with no auto-scoring at all — confirmed via grep, zero
    # match_requisition/score_candidate references anywhere in this file.
    # Fire-and-forget, same convention as every other intake path (outside
    # the transaction above so an embed-service hiccup can never affect
    # whether the candidate/resume/message were actually saved).
    # Real bug fix (this session): a bare create_task() can be garbage-
    # collected before it runs; _fire_and_forget keeps a real reference
    # until it completes.
    _fire_and_forget(auto_score_candidate_bg(tenant_id, str(candidate_id)))

    first_name = (parsed.get("name") or "").split()[0] if parsed.get("name") else ""
    greeting = f"Thanks {first_name}!" if first_name else "Thanks!"
    return f"{greeting} We've received your resume and added it to our system. Our recruitment team will review it and reach out if there's a matching opportunity."


async def _handle_screening_resume(media: dict, tenant_id: str, session: dict, whatsapp_account_id: str = None) -> str:
    """WhatsApp Screening Blueprint, Milestone 3 (Phase 5). The one real
    difference from _handle_inbound_resume above: identity is already
    certain (mid-conversation with a known candidate_id) so this attaches
    directly instead of running the cold-inbound dedup pipeline built for
    a stranger's resume arriving with no context. Writes a SECOND, separate
    consent_records row (data_category='resume_processing', decision #20)
    distinct from the opt-in's screening_communication consent."""
    from services.resume_intake_service import extract_text_from_attachment, save_resume_file
    from services.document_classifier import classify_document
    from services.screening_scoring import score_and_advance
    import json as _json

    candidate_id = str(session["candidate_id"])
    mimetype = (media.get("mimetype") or "").lower()
    filename = media.get("filename") or "attachment"
    if not any(h in mimetype for h in _RESUME_MIME_HINTS) and not filename.lower().endswith((".pdf", ".doc", ".docx")):
        return "We can only accept resumes as PDF or Word documents right now — could you resend as one of those?"

    data = await _download_waha_media(media)
    if not data:
        return "We couldn't download your file — please try sending it again."

    text = extract_text_from_attachment(data, mimetype, filename)
    if not text or len(text.strip()) < 50:
        return "We received your file but couldn't read its contents — please send a PDF or Word resume."

    doc_result = classify_document(text, filename)
    if not doc_result.is_resume and doc_result.decision == "REJECT":
        return "Thanks for sharing, but this doesn't look like a resume — please send your CV as a PDF or Word file."

    file_path = save_resume_file(data, tenant_id, filename)
    async with db.tenant_conn(tenant_id) as conn:
        await conn.execute("UPDATE candidates SET resume_text=$1 WHERE id=$2", text, candidate_id)
        await conn.execute(
            """INSERT INTO resume_files
                 (tenant_id, candidate_id, job_board, job_board_label, source_email,
                  file_name, file_path, mime_type, file_size, parse_status, routing_decision)
               VALUES ($1,$2,'whatsapp','WhatsApp Screening',$3,$4,$5,$6,$7,'auto_accepted','auto_accepted')""",
            tenant_id, candidate_id, f"screening_session:{session['id']}", filename, file_path, mimetype, len(data))
        await conn.execute(
            """INSERT INTO consent_records (tenant_id,candidate_id,data_category,channel,consent_given,consent_text)
               VALUES ($1,$2,'resume_processing','whatsapp',TRUE,$3)""",
            tenant_id, candidate_id, "Resume shared via WhatsApp screening.")
        await conn.execute("""
            INSERT INTO candidate_messages
              (tenant_id, candidate_id, channel, direction, body, status, from_whatsapp_account_id)
            VALUES ($1,$2,'whatsapp','inbound',$3,'received',$4)
        """, tenant_id, candidate_id, f"[Resume attachment: {filename}]", whatsapp_account_id)

        full_session = await conn.fetchrow(
            "SELECT * FROM screening_sessions WHERE id=$1", session["id"])
        verification = await score_and_advance(conn, tenant_id, full_session)

    return verification["followup_message"]

async def _handle_question_answer(conn, tenant_id: str, cand, session) -> str:
    """WhatsApp Screening Blueprint, Milestone 2 (Phase 3-4). session's
    raw_answer is the reply to whatever current_question_key was last
    sent -- extract+store it, then send the next question or, once the
    sequence is exhausted, move to Phase 5 (resume request)."""
    from services.screening_extraction import record_answer
    from services.screening_questions import build_question_sequence, next_question
    from services.screening_i18n import t

    lang = session.get("language") or "en"
    name = cand["full_name"].split()[0]
    sequence = await build_question_sequence(conn, tenant_id, str(session["requisition_id"]), lang)
    current_q = next((q for q in sequence if q["key"] == session["current_question_key"]), None)
    if not current_q:
        # Out of sync (e.g. the requisition's mandatory_skills changed
        # mid-conversation) -- hand off rather than guess.
        return t("out_of_sync", lang, name=name)

    # WhatsApp automation research (2026-09-15), gap #10: a candidate going
    # off-script to ask a real question (e.g. "what's the salary range?")
    # instead of answering current_q gets a grounded local-Qwen answer,
    # then current_q is re-sent unchanged -- never recorded as an answer,
    # never advances the sequence.
    from services.screening_faq import looks_like_question, answer_question
    import json as _json
    raw = session["raw_answer"]
    if looks_like_question(raw):
        answer = await answer_question(conn, tenant_id, str(session["requisition_id"]), raw, lang)
        await conn.execute(
            """INSERT INTO screening_answers
                 (tenant_id, screening_session_id, question_key, question_text, raw_answer,
                  extracted_value, extraction_method)
               VALUES ($1,$2,$3,$4,$5,$6,'faq')""",
            tenant_id, session["id"], f"faq::{session['current_question_key']}:{session['id']}",
            raw, raw, _json.dumps({"answer": answer}))
        return f"{answer}\n\n{current_q['text']}"

    await record_answer(conn, tenant_id, session, current_q, session["raw_answer"])

    answered = await conn.fetch(
        "SELECT question_key FROM screening_answers WHERE screening_session_id=$1", session["id"])
    nq = next_question(sequence, {r["question_key"] for r in answered})
    if nq:
        await conn.execute(
            "UPDATE screening_sessions SET current_question_key=$1, updated_at=now() WHERE id=$2",
            nq["key"], session["id"])
        return nq["text"]

    await conn.execute(
        "UPDATE screening_sessions SET status='awaiting_resume', current_question_key=NULL, updated_at=now() WHERE id=$1",
        session["id"])
    return t("resume_request", lang)


async def _handle_followup_reply(conn, tenant_id: str, cand, session, cmd: str, text: str) -> str:
    """WhatsApp automation research (2026-09-15), gaps #2/#3/#6: the
    referral -> CSAT close-out (and, for a 'reject' outcome, one
    cross-requisition offer first) that runs after screening_sessions.
    status already reached 'completed' -- see _start_followups in
    services/screening_scoring.py for why status itself is never
    reopened."""
    import re
    from services.screening_i18n import t

    stage = session["followup_stage"]
    lang = session.get("language") or "en"
    name = cand["full_name"].split()[0]

    if stage == "cross_match_offered":
        if cmd == "YES":
            from routers.screening import _default_add_stage
            from services.screening_scoring import score_and_advance
            new_req_id = session["cross_match_requisition_id"]
            default_stage = await _default_add_stage(conn, tenant_id)
            existing_app = await conn.fetchrow(
                "SELECT id FROM applications WHERE tenant_id=$1 AND requisition_id=$2 AND candidate_id=$3",
                tenant_id, new_req_id, cand["id"])
            new_app_id = existing_app["id"] if existing_app else await conn.fetchval(
                """INSERT INTO applications (tenant_id, requisition_id, candidate_id, stage)
                   VALUES ($1,$2,$3,$4) RETURNING id""",
                tenant_id, new_req_id, cand["id"], default_stage)
            await conn.execute(
                """UPDATE screening_sessions SET requisition_id=$1, application_id=$2,
                     followup_stage=NULL, cross_match_requisition_id=NULL, updated_at=now()
                   WHERE id=$3""",
                new_req_id, new_app_id, session["id"])
            full_session = await conn.fetchrow("SELECT * FROM screening_sessions WHERE id=$1", session["id"])
            verification = await score_and_advance(conn, tenant_id, full_session)
            return verification["followup_message"]
        # Anything other than an explicit YES moves straight to the
        # referral ask rather than waiting on a second, unnecessary NO.
        await conn.execute(
            """UPDATE screening_sessions SET followup_stage='referral_asked',
                 cross_match_requisition_id=NULL, updated_at=now() WHERE id=$1""",
            session["id"])
        return t("referral_ask", lang)

    if stage == "referral_asked":
        if cmd != "SKIP":
            phone_m = re.search(r"(\+?\d[\d\-\s]{7,14}\d)", text)
            referred_phone = phone_m.group(1).strip() if phone_m else None
            referred_name = (text.replace(referred_phone, "").strip(" ,-–")
                              if referred_phone else text.strip())
            await conn.execute(
                """INSERT INTO screening_referrals
                     (tenant_id, screening_session_id, referring_candidate_id, raw_text,
                      referred_name, referred_phone)
                   VALUES ($1,$2,$3,$4,$5,$6)""",
                tenant_id, session["id"], cand["id"], text[:500], referred_name[:200] or None, referred_phone)
        await conn.execute(
            "UPDATE screening_sessions SET followup_stage='csat_asked', updated_at=now() WHERE id=$1",
            session["id"])
        return f"{t('referral_ack', lang)} {t('csat_ask', lang)}"

    if stage == "csat_asked":
        m = re.search(r"[1-5]", text)
        rating = int(m.group(0)) if m else None
        await conn.execute(
            "UPDATE screening_sessions SET followup_stage='done', csat_rating=$1, updated_at=now() WHERE id=$2",
            rating, session["id"])
        return t("csat_thanks", lang)

    return t("out_of_sync", lang, name=name)


async def _handle_screening_reply(conn, tenant_id: str, cand, session, cmd: str, text: str) -> str:
    """WhatsApp Screening Blueprint, Milestones 1-2 (Phases 2-4: opt-in &
    consent, then the skill/generic question loop). A candidate with an
    active screening_sessions row has every reply captured here instead
    of the STATUS/INTERVIEW/etc command chain below — one focused
    conversation at a time, per decision #6 (one active session per
    candidate)."""
    from services.screening_i18n import t

    session_id = session["id"]
    status = session["status"]
    lang = session.get("language") or "en"
    name = cand["full_name"].split()[0]
    text_upper = text.strip().upper()

    if cmd == "STOP":
        # DPDP 2023 requires this be easy, at any phase — no withdrawal
        # path existed anywhere in this codebase before this (decision #12).
        await conn.execute(
            """INSERT INTO consent_records (tenant_id,candidate_id,data_category,channel,consent_given,consent_text)
               VALUES ($1,$2,'screening_communication','whatsapp',FALSE,$3)""",
            tenant_id, cand["id"], f"{cand['full_name']} replied STOP to WhatsApp screening.")
        await conn.execute(
            "UPDATE screening_sessions SET status='opted_out', followup_stage=NULL, updated_at=now() WHERE id=$1",
            session_id)
        return t("stopped_ack", lang)

    if cmd in ("AGENT", "HELP"):
        sess_full = await conn.fetchrow(
            """SELECT s.requisition_id, s.application_id, r.title
               FROM screening_sessions s JOIN requisitions r ON r.id = s.requisition_id
               WHERE s.id=$1""", session_id)
        await conn.execute("""
            INSERT INTO recruiter_tasks
              (tenant_id, requisition_id, application_id, candidate_name, req_title,
               task_type, title, priority)
            VALUES ($1,$2,$3,$4,$5,'callback_request',$6,'high')
        """, tenant_id, sess_full["requisition_id"], sess_full["application_id"], cand["full_name"],
             sess_full["title"], f"{cand['full_name']} asked for a human during WhatsApp screening")
        return t("agent_ack", lang, name=name)

    # WhatsApp automation research (2026-09-15): status stays 'completed'
    # throughout the referral/cross-match/CSAT close-out (score_and_advance
    # already fired the real recruiter notification/stage-advance before
    # any of this) -- followup_stage is what actually routes an in-flight
    # closing reply, checked before the status-based chain below since
    # 'completed' matches none of those branches.
    if session.get("followup_stage") in ("cross_match_offered", "referral_asked", "csat_asked"):
        return await _handle_followup_reply(conn, tenant_id, cand, session, cmd, text)

    if status in ("pending_optin", "sent"):
        if cmd == "YES":
            consent_id = await conn.fetchval(
                """INSERT INTO consent_records (tenant_id,candidate_id,data_category,channel,consent_given,consent_text)
                   VALUES ($1,$2,'screening_communication','whatsapp',TRUE,$3) RETURNING id""",
                tenant_id, cand["id"], f"{cand['full_name']} replied YES to WhatsApp screening opt-in.")
            from services.screening_questions import build_question_sequence
            sequence = await build_question_sequence(conn, tenant_id, str(session["requisition_id"]), lang)
            if not sequence:
                await conn.execute(
                    """UPDATE screening_sessions SET status='awaiting_resume', consent_id=$1, updated_at=now()
                       WHERE id=$2""", consent_id, session_id)
                return t("resume_request", lang)
            q1 = sequence[0]
            await conn.execute(
                """UPDATE screening_sessions SET status='in_progress', consent_id=$1, current_question_key=$2,
                   updated_at=now() WHERE id=$3""", consent_id, q1["key"], session_id)
            return f"Thanks {name}! {q1['text']}"

        if cmd == "NO" or "NOT INTERESTED" in text_upper:
            # No consent row written — they said no, nothing further is processed.
            await conn.execute(
                "UPDATE screening_sessions SET status='declined', updated_at=now() WHERE id=$1", session_id)
            return t("declined_ack", lang, name=name)

        return t("gentle_reprompt", lang, name=name)

    if status == "in_progress":
        session_with_answer = dict(session)
        session_with_answer["raw_answer"] = text
        return await _handle_question_answer(conn, tenant_id, cand, session_with_answer)

    if status == "awaiting_resume":
        return t("awaiting_resume_nudge", lang, name=name)

    return t("out_of_sync", lang, name=name)


async def _handle_joining_reply(conn, tenant_id: str, cand, offer, cmd: str, text: str) -> str:
    """WhatsApp automation research (2026-09-15), gap #7: a staffing
    agency's placement fee triggers on the candidate actually JOINING, not
    on the interview -- offer.status='accepted' + joining_date already
    exist (sql/01); this is the day-of confirmation half of the sequence
    (services/offer_joining.py sends the reminder/ask, this captures the
    reply). Not tied to any screening_sessions row -- an offer can exist
    for a candidate sourced entirely outside WhatsApp screening."""
    from services.screening_i18n import t
    lang = await conn.fetchval(
        """SELECT language FROM screening_sessions
           WHERE candidate_id=$1 AND tenant_id=$2 ORDER BY created_at DESC LIMIT 1""",
        cand["id"], tenant_id) or "en"
    name = cand["full_name"].split()[0]
    confirmed = cmd == "YES"
    await conn.execute(
        "UPDATE offers SET joining_confirmed_at=now(), joining_confirmation_response=$1 WHERE id=$2",
        text[:500], offer["id"])
    if not confirmed:
        await conn.execute(
            """INSERT INTO recruiter_tasks
                 (tenant_id, requisition_id, application_id, candidate_name, req_title,
                  task_type, title, priority)
               VALUES ($1,$2,$3,$4,$5,'callback_request',$6,'high')""",
            tenant_id, offer["requisition_id"], offer["application_id"], cand["full_name"], offer["title"],
            f"{cand['full_name']} reported a joining delay/issue via WhatsApp: \"{text[:200]}\"")
    return t("joining_ack", lang, name=name)


async def handle_cmd(phone: str, text: str, tenant_id: str, whatsapp_account_id: str = None) -> str:
    cmd = text.strip().upper().split()[0] if text.strip() else "HELP"
    async with db.tenant_conn(tenant_id) as conn:
        cand = await conn.fetchrow(
            "SELECT * FROM candidates WHERE phone LIKE '%'||$1||'%' AND tenant_id=$2 LIMIT 1",
            phone[-10:], tenant_id)
        if not cand:
            return "Hi! We don't have your number on file. Contact your recruiter."
        name = cand["full_name"].split()[0]
        # Real fix (2026-08-10 audit): see the matching note in
        # _handle_inbound_resume — inbound commands were never logged either.
        await conn.execute("""
            INSERT INTO candidate_messages
              (tenant_id, candidate_id, channel, direction, body, status, from_whatsapp_account_id)
            VALUES ($1,$2,'whatsapp','inbound',$3,'received',$4)
        """, tenant_id, cand["id"], text[:2000], whatsapp_account_id)
        active_screening = await conn.fetchrow(
            """SELECT id, status, requisition_id, candidate_id, current_question_key, language,
                      followup_stage, cross_match_requisition_id
               FROM screening_sessions
               WHERE candidate_id=$1 AND tenant_id=$2
                 AND (status IN ('pending_optin','sent','in_progress','awaiting_resume')
                      OR followup_stage IN ('cross_match_offered','referral_asked','csat_asked'))
               ORDER BY created_at DESC LIMIT 1""",
            cand["id"], tenant_id)
        if active_screening:
            return await _handle_screening_reply(conn, tenant_id, cand, active_screening, cmd, text)
        joining_offer = await conn.fetchrow(
            """SELECT o.id, o.application_id, a.requisition_id, r.title
               FROM offers o
               JOIN applications a ON a.id = o.application_id
               JOIN requisitions r ON r.id = a.requisition_id
               WHERE a.candidate_id=$1 AND o.tenant_id=$2
                 AND o.joining_confirmation_sent_at IS NOT NULL
                 AND o.joining_confirmed_at IS NULL
                 AND o.joining_confirmation_sent_at > now() - interval '3 days'
               ORDER BY o.joining_confirmation_sent_at DESC LIMIT 1""",
            cand["id"], tenant_id)
        if joining_offer:
            return await _handle_joining_reply(conn, tenant_id, cand, joining_offer, cmd, text)
        if cmd == "STATUS":
            apps = await conn.fetch(
                "SELECT a.stage, r.title FROM applications a "
                "JOIN requisitions r ON r.id=a.requisition_id "
                "WHERE a.candidate_id=$1 AND a.tenant_id=$2 ORDER BY a.updated_at DESC LIMIT 3",
                cand["id"], tenant_id)
            if not apps:
                return f"Hi {name}! No active applications. Contact your recruiter."
            lines = [f"Hi {name}! Your applications:"]
            for a in apps:
                lines.append(f"- {a['title']} : {a['stage'].upper()}")
            return "\n".join(lines)
        elif cmd == "INTERVIEW":
            iv = await conn.fetchrow(
                "SELECT i.scheduled_at, i.interview_type, i.mode, i.meeting_link, r.title "
                "FROM interview_schedules i "
                "JOIN candidates c ON c.id=i.candidate_id "
                "LEFT JOIN requisitions r ON r.id=i.requisition_id "
                "WHERE c.phone LIKE '%'||$1||'%' AND i.status='scheduled' "
                "AND i.scheduled_at > now() AND i.tenant_id=$2 ORDER BY i.scheduled_at LIMIT 1",
                phone[-10:], tenant_id)
            if not iv:
                return f"Hi {name}! No upcoming interviews scheduled."
            sched = iv["scheduled_at"]
            lines = [
                f"Hi {name}! Your interview:",
                f"Date: {sched.strftime('%d %b %Y at %I:%M %p')}",
                f"Role: {iv['title'] or 'TBD'}",
                f"Type: {iv['interview_type']} ({iv['mode']})",
                f"Link: {iv['meeting_link'] or 'Will be shared separately'}",
            ]
            return "\n".join(lines)
        elif cmd == "OFFER":
            # Real fix (2026-08-10 audit): OFFER was advertised in HELP_LINES
            # and the frontend's COMMANDS list but had no branch here at all -
            # fell through to the help menu, which told the candidate to type
            # OFFER, which showed them the help menu again.
            off = await conn.fetchrow("""
                SELECT o.status, o.ctc_offered, o.currency, o.joining_date, r.title
                FROM offers o
                JOIN applications a ON a.id = o.application_id
                JOIN requisitions r ON r.id = a.requisition_id
                WHERE a.candidate_id=$1 AND o.tenant_id=$2
                ORDER BY o.created_at DESC LIMIT 1
            """, cand["id"], tenant_id)
            if not off:
                return f"Hi {name}! No offer on file yet. Contact your recruiter for updates."
            if off["status"] in ("draft", "pending_approval", "approved"):
                return f"Hi {name}! Your offer for {off['title']} is being finalized internally. We'll share full details once it's issued."
            lines = [f"Hi {name}! Your offer for {off['title']}:", f"Status: {off['status'].upper()}"]
            if off["ctc_offered"]:
                lines.append(f"CTC: {off['currency'] or 'INR'} {off['ctc_offered']:,.0f}")
            if off["joining_date"]:
                lines.append(f"Joining: {off['joining_date'].strftime('%d %b %Y')}")
            if off["status"] == "issued":
                lines.append("Reply ACCEPT or DECLINE to respond.")
            return "\n".join(lines)
        elif cmd == "CALLBACK":
            # Real fix: used to be a no-op reassurance with nothing written
            # anywhere. Now creates a real recruiter_tasks row, same pattern
            # as the auto-created tasks on stage changes (applications.py).
            app_row = await conn.fetchrow("""
                SELECT a.id AS application_id, a.requisition_id, a.assigned_recruiter_id, r.title
                FROM applications a JOIN requisitions r ON r.id=a.requisition_id
                WHERE a.candidate_id=$1 AND a.tenant_id=$2
                ORDER BY a.updated_at DESC LIMIT 1
            """, cand["id"], tenant_id)
            await conn.execute("""
                INSERT INTO recruiter_tasks
                  (tenant_id, requisition_id, application_id, candidate_name, req_title,
                   recruiter_id, task_type, title, priority)
                VALUES ($1,$2,$3,$4,$5,$6,'callback_request',$7,'high')
            """, tenant_id, app_row["requisition_id"] if app_row else None,
                 app_row["application_id"] if app_row else None, cand["full_name"],
                 app_row["title"] if app_row else None,
                 app_row["assigned_recruiter_id"] if app_row else None,
                 f"Callback requested by {cand['full_name']} via WhatsApp")
            return f"Hi {name}! A recruiter will call you within 2 hours. Office: Mon-Sat 9AM-7PM IST"
        elif cmd in ("ACCEPT", "DECLINE"):
            # Real fix: used to write nothing anywhere despite telling the
            # candidate their response "has been noted". Per explicit
            # decision (2026-08-10): a WhatsApp reply is not a verified
            # identity the way an e-signed link is, so this notifies the
            # recruiter to confirm and act rather than directly flipping a
            # real offer's status (keeps a human in the loop for this
            # high-stakes action, same spirit as HARD RULE #10).
            action = "ACCEPTED" if cmd == "ACCEPT" else "DECLINED"
            app_row = await conn.fetchrow("""
                SELECT a.assigned_recruiter_id, r.title
                FROM applications a JOIN requisitions r ON r.id=a.requisition_id
                WHERE a.candidate_id=$1 AND a.tenant_id=$2
                ORDER BY a.updated_at DESC LIMIT 1
            """, cand["id"], tenant_id)
            recipient = app_row["assigned_recruiter_id"] if app_row else None
            if not recipient:
                manager = await conn.fetchrow(
                    "SELECT id FROM users WHERE tenant_id=$1 AND role='manager' LIMIT 1", tenant_id)
                recipient = manager["id"] if manager else None
            if recipient:
                await conn.execute("""
                    INSERT INTO notifications
                      (tenant_id, user_id, recipient_user_id, title, body, type, resource, channel)
                    VALUES ($1,$2,$2,$3,$4,'warning','candidate','inapp')
                """, tenant_id, recipient, f"Offer {action.lower()} via WhatsApp",
                     f"{cand['full_name']} replied {action} to their offer for {app_row['title'] if app_row else 'their role'} via WhatsApp — please confirm and action manually.")
            return f"Hi {name}! Your response ({action.lower()}) has been noted. Team will contact you within 24h."
        else:
            return HELP_MSG

async def _resolve_phone(from_: str) -> str:
    """WhatsApp's newer privacy-preserving LID identifiers (e.g.
    "184018024837218@lid") replace the real phone-based JID entirely in the
    message payload — there is no phone number anywhere in the webhook data
    for these senders, confirmed by inspecting a real payload end-to-end.
    WAHA exposes a real resolution endpoint for this (undocumented in its
    OpenAPI listing, found by probing): GET /api/{session}/lids/{lid} ->
    {"lid": "...", "pn": "<real>@c.us"}."""
    if "@lid" not in from_:
        return from_.replace("@c.us", "").replace("@g.us", "")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{WAHA_URL}/api/{SESSION}/lids/{from_}",
                                  headers={"X-Api-Key": WAHA_KEY})
            if r.status_code == 200:
                pn = r.json().get("pn", "")
                if pn:
                    return pn.replace("@c.us", "")
    except Exception as ex:
        print(f"LID resolution failed: {ex} (lid={from_})")
    return from_.replace("@lid", "")  # last resort — not a real phone number


@router.post("/webhook")
async def webhook(request: Request):
    try:
        data = await request.json()
        msg  = data.get("payload", {})
        text = (msg.get("body") or "").strip()
        from_  = msg.get("from", "")
        phone  = await _resolve_phone(from_)
        has_media = bool(msg.get("hasMedia"))
        # WhatsApp automation research (2026-09-15), gap #1: a native
        # "share location" message is its own distinct payload type, not
        # text or media -- built against WAHA/whatsapp-web.js's documented
        # Location object shape (payload.location = {latitude, longitude}),
        # NOT yet verified against a real live location message the way
        # every other WAHA quirk in this file has been (same honesty
        # convention as the blueprint's own "unverified" flags elsewhere).
        location = msg.get("location") or {}
        has_location = bool(location) and (location.get("latitude") is not None or location.get("lat") is not None)
        # Media messages often have an empty/caption-only body — check media
        # BEFORE the text-emptiness bail below, or a resume with no caption
        # would be silently dropped.
        # REAL BUG FIX (2026-08-12): "status@broadcast" is WhatsApp's
        # reserved system JID for Status updates (the 24h disappearing
        # photo/video feature), not a real contact — WAHA fires webhook
        # events for these too. Confirmed live: 10 real garbage candidates
        # named "Status" with empty phone (no digits in "status@broadcast"
        # to normalize) were created from other people's Status photos,
        # processed as if they were resume submissions. Excluded the same
        # way group messages (@g.us) already are.
        if (not text and not has_media and not has_location) or msg.get("fromMe") or "@g.us" in from_ or "broadcast" in from_:
            return {"ok": True}
        # Real bug fix (2026-08-10 audit): no ORDER BY meant this returned
        # whatever row Postgres physically stored first, which flips
        # unpredictably (any UPDATE on the "first" tenant's own row can move
        # it later in physical storage). Confirmed live: this had silently
        # started returning the wrong tenant, misrouting every real inbound
        # WhatsApp message. The bot has no real number->tenant mapping
        # (single-tenant by design, a separate, bigger limitation not fixed
        # here) - ORDER BY created_at picks the same, real primary tenant
        # deterministically instead of depending on physical row order.
        async with db.system_conn() as conn:
            tenant = await conn.fetchrow("SELECT id FROM tenants ORDER BY created_at ASC LIMIT 1")
        if not tenant:
            return {"ok": True}
        tenant_id = str(tenant["id"])

        # Real per-user WhatsApp numbers (2026-08-27): WAHA's own webhook
        # payload already names which session received this message - a
        # personal account's inbound traffic is routed and attributed
        # here, without needing a second webhook URL per user.
        session_name = data.get("session") or SESSION
        wa_account_id = None
        bot_enabled = True
        if session_name != SESSION:
            async with db.tenant_conn(tenant_id) as _wconn:
                acct = await _wconn.fetchrow(
                    """SELECT id, bot_auto_reply_enabled FROM user_whatsapp_accounts
                       WHERE tenant_id=$1 AND waha_session_name=$2""",
                    tenant_id, session_name)
            if acct:
                wa_account_id = str(acct["id"])
                bot_enabled = acct["bot_auto_reply_enabled"]

        if not bot_enabled:
            # "Personal numbers are just a normal inbox" (explicit user
            # choice, per-account toggle) - log the raw message, no
            # command parsing, no auto-reply, no resume auto-processing.
            # The recruiter reads and answers it themselves.
            async with db.tenant_conn(tenant_id) as _lconn:
                cand = await _lconn.fetchrow(
                    "SELECT id FROM candidates WHERE phone LIKE '%'||$1||'%' AND tenant_id=$2 LIMIT 1",
                    phone[-10:], tenant_id)
                if cand:
                    body = f"[Media attachment]" if has_media else text[:2000]
                    await _lconn.execute(
                        """INSERT INTO candidate_messages
                             (tenant_id, candidate_id, channel, direction, body, status, from_whatsapp_account_id)
                           VALUES ($1,$2,'whatsapp','inbound',$3,'received',$4)""",
                        tenant_id, cand["id"], body, wa_account_id)
            return {"ok": True}

        if has_location:
            async with db.tenant_conn(tenant_id) as _lconn:
                _cand = await _lconn.fetchrow(
                    "SELECT id, full_name FROM candidates WHERE phone LIKE '%'||$1||'%' AND tenant_id=$2 LIMIT 1",
                    phone[-10:], tenant_id)
                _session = await _lconn.fetchrow(
                    """SELECT id, candidate_id, requisition_id, status, current_question_key, language
                       FROM screening_sessions
                       WHERE candidate_id=$1 AND tenant_id=$2 AND status='in_progress'
                         AND current_question_key='generic_location'
                       ORDER BY created_at DESC LIMIT 1""",
                    _cand["id"], tenant_id) if _cand else None
                if _cand and _session:
                    lat = location.get("latitude", location.get("lat"))
                    lng = location.get("longitude", location.get("lng"))
                    session_with_answer = dict(_session)
                    session_with_answer["raw_answer"] = f"@{lat},{lng}"
                    reply = await _handle_question_answer(_lconn, tenant_id, dict(_cand), session_with_answer)
                    await _lconn.execute("""
                        INSERT INTO candidate_messages
                          (tenant_id, candidate_id, channel, direction, body, status, from_whatsapp_account_id)
                        VALUES ($1,$2,'whatsapp','inbound',$3,'received',$4)
                    """, tenant_id, _cand["id"], f"[Location shared: {lat},{lng}]", wa_account_id)
                    await send_wa(phone, reply, session_name)
            return {"ok": True}

        if has_media:
            # WhatsApp Screening Blueprint, Milestone 3 (Phase 5): a
            # candidate awaiting their resume request is already a known
            # identity — route to the direct-attach path instead of the
            # cold-inbound dedup pipeline below, which is built for a
            # stranger's resume arriving with no context.
            async with db.tenant_conn(tenant_id) as _rconn:
                _cand = await _rconn.fetchrow(
                    "SELECT id FROM candidates WHERE phone LIKE '%'||$1||'%' AND tenant_id=$2 LIMIT 1",
                    phone[-10:], tenant_id)
                _session = await _rconn.fetchrow(
                    """SELECT id, candidate_id, status, language FROM screening_sessions
                       WHERE candidate_id=$1 AND tenant_id=$2
                         AND status IN ('pending_optin','sent','in_progress','awaiting_resume')
                       ORDER BY created_at DESC LIMIT 1""",
                    _cand["id"], tenant_id) if _cand else None
            if _session and _session["status"] == "awaiting_resume":
                reply = await _handle_screening_resume(msg.get("media") or {}, tenant_id, dict(_session), wa_account_id)
            elif _session:
                # Known limitation, stated honestly in the blueprint itself:
                # no speech-to-text in this stack. A media message arriving
                # mid-screening (voice note, photo, ...) before the resume
                # step still needs a defined response, not a silent fall-
                # through to the cold-inbound resume pipeline built for a
                # stranger with no context.
                from services.screening_i18n import t
                reply = t("media_not_supported", _session["language"] or "en")
            else:
                reply = await _handle_inbound_resume(phone, msg.get("media") or {}, tenant_id, wa_account_id)
            await send_wa(phone, reply, session_name)
            return {"ok": True}
        response = await handle_cmd(phone, text, tenant_id, wa_account_id)
        await send_wa(phone, response, session_name)
    except Exception as e:
        print(f"WhatsApp webhook error: {e}")
    return {"ok": True}

@router.post("/send")
async def send_message(phone: str, message: str, actor: Actor = Depends(require_role("admin", "manager"))):
    """Raw connectivity-test send (arbitrary phone, no candidate_id) - not a
    candidate-consent path, but the same 'send arbitrary WhatsApp to
    arbitrary number' danger class as /waha/send, so held to the same bar."""
    success = await send_wa(phone, message)
    return {"sent": success, "phone": phone}

@router.get("/status")
async def bot_status(actor: Actor = Depends(get_actor)):
    """Real bug fix (2026-08-30): this always reported the SHARED
    "default" WAHA session's status regardless of who was looking at it -
    misleading for any real user with their OWN personal WhatsApp account
    (built 2026-08-27), who'd see "WAHA Connected" even with zero personal
    connection of their own, no indication this wasn't about them at all.
    Now checks the actor's own personal session first (if they have one,
    connected or not) and reports which one is actually being shown -
    falling back to the shared session only when they have no personal
    account at all, still clearly labeled as such."""
    own_session = None
    own_connected = False
    async with db.tenant_conn(actor.tenant_id) as conn:
        own = await conn.fetchrow(
            "SELECT waha_session_name, status FROM user_whatsapp_accounts WHERE tenant_id=$1 AND user_id=$2",
            actor.tenant_id, actor.user_id)
    session_to_check = SESSION
    is_personal = False
    if own:
        session_to_check = own["waha_session_name"]
        is_personal = True
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{WAHA_URL}/api/sessions/{session_to_check}", headers={"X-Api-Key": WAHA_KEY})
            if r.status_code == 200:
                waha_ok = r.json().get("status") in ("WORKING", "CONNECTED")
            else:
                waha_ok = False
    except Exception:
        waha_ok = False
    return {
        "waha_connected": waha_ok,
        "commands": ["HELP","STATUS","INTERVIEW","CALLBACK","ACCEPT","DECLINE"],
        "is_personal_number": is_personal,
        "session_label": "your own WhatsApp number" if is_personal else "the shared company number",
    }
