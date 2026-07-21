"""
Background scheduler — replaces pg_cron (not available).
Runs inside the FastAPI process via APScheduler.
Jobs: retention bank release, loyalty milestones, KAE months, n8n triggers.
"""
import httpx
import logging
from datetime import date, datetime
from apscheduler.schedulers.asyncio import AsyncIOScheduler
import db

logger = logging.getLogger(__name__)

N8N_BASE = "http://n8n:5678"
scheduler = AsyncIOScheduler(timezone="Asia/Kolkata")


async def _notify_n8n(path: str, payload: dict):
    """Fire-and-forget n8n webhook."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(f"{N8N_BASE}/webhook/{path}", json=payload)
    except Exception as e:
        logger.warning(f"n8n notify failed ({path}): {e}")


async def process_retention_bank_releases():
    """Release held retention bank amounts past their due_date."""
    logger.info("scheduler: processing retention bank releases")
    try:
        async with db.system_conn() as conn:
            rows = await conn.fetch("""
                UPDATE retention_bank
                   SET status='released', released_at=now()
                 WHERE status='held'
                   AND release_due_date <= CURRENT_DATE
                RETURNING tenant_id, user_id, amount, accrued_month, accrued_year
            """)
            if rows:
                logger.info(f"Released {len(rows)} retention bank entries")
                await _notify_n8n("retention-bank-released", {
                    "count": len(rows),
                    "total": float(sum(r["amount"] for r in rows)),
                    "date": str(date.today()),
                })
    except Exception as e:
        logger.error(f"retention_bank_releases error: {e}")


async def check_loyalty_milestones():
    """Flag loyalty milestones that have passed their milestone_date."""
    logger.info("scheduler: checking loyalty milestones")
    try:
        async with db.system_conn() as conn:
            rows = await conn.fetch("""
                UPDATE loyalty_milestones
                   SET status='achieved', achieved_at=now()
                 WHERE status='pending'
                   AND milestone_date <= CURRENT_DATE
                RETURNING tenant_id, user_id, milestone_years, bonus_amount
            """)
            if rows:
                logger.info(f"Achieved {len(rows)} loyalty milestones")
                await _notify_n8n("loyalty-milestone-achieved", {
                    "count": len(rows),
                    "milestones": [{"user_id": str(r["user_id"]),
                                    "years": r["milestone_years"],
                                    "bonus": float(r["bonus_amount"])} for r in rows],
                })
    except Exception as e:
        logger.error(f"check_loyalty_milestones error: {e}")


async def refresh_kae_retention_months():
    """Increment months_served for active KAE-client relationships."""
    logger.info("scheduler: refreshing KAE retention months")
    try:
        async with db.system_conn() as conn:
            await conn.execute("""
                UPDATE kae_client_retention
                   SET months_served = GREATEST(0,
                       EXTRACT(MONTH FROM AGE(CURRENT_DATE, owner_since))::int +
                       EXTRACT(YEAR FROM AGE(CURRENT_DATE, owner_since))::int * 12),
                       last_checked_at = now()
            """)
    except Exception as e:
        logger.error(f"refresh_kae_retention error: {e}")


async def send_monthly_incentive_summary():
    """Trigger n8n to send monthly incentive summary emails."""
    logger.info("scheduler: sending monthly incentive summary")
    try:
        today = date.today()
        await _notify_n8n("monthly-incentive-summary", {
            "month": today.month,
            "year": today.year,
            "triggered_at": datetime.now().isoformat(),
        })
    except Exception as e:
        logger.error(f"monthly_summary error: {e}")




def _eval(actual, op, expected):
    """Evaluate one stage_rules condition. actual is the application/candidate
    field value, op/expected come from the rule's stored conditions JSON."""
    if actual is None:
        return False
    try:
        if op == ">":  return actual > expected
        if op == "<":  return actual < expected
        if op == ">=": return actual >= expected
        if op == "<=": return actual <= expected
        if op in ("==", "="): return actual == expected
        if op in ("!=", "<>"): return actual != expected
        return False
    except TypeError:
        return False


async def run_pipeline_auto_move():
    """Daily: evaluate all tenant stage rules and auto-move candidates."""
    logger.info("Running scheduled pipeline auto-move")
    try:
        async with db.pool.acquire() as conn:
            tenants = await conn.fetch("SELECT DISTINCT tenant_id FROM stage_rules WHERE enabled=TRUE")
            for t in tenants:
                tid = str(t["tenant_id"])
                try:
                    rules = await conn.fetch(
                        "SELECT id, name, stage_from, stage_to, conditions FROM stage_rules WHERE enabled=TRUE AND tenant_id=$1",
                        t["tenant_id"]
                    )
                    import json as _json
                    for rule in rules:
                        conds = rule["conditions"] if isinstance(rule["conditions"], list) else _json.loads(rule["conditions"] or "[]")
                        apps = await conn.fetch(
                            "SELECT a.id, a.stage, a.candidate_id, a.fit_score, c.total_exp_mo, c.ai_match_score, c.expected_ctc, c.notice_period_days, c.full_name FROM applications a JOIN candidates c ON c.id=a.candidate_id WHERE a.stage=$1 AND a.tenant_id=$2",
                            rule["stage_from"], t["tenant_id"]
                        )
                        moved = 0
                        for app in apps:
                            if all(_eval(app.get(co.get("field")), co.get("op",">"), co.get("value",0)) for co in conds):
                                await conn.execute("UPDATE applications SET stage=$1, updated_at=NOW() WHERE id=$2", rule["stage_to"], app["id"])
                                await conn.execute(
                                    "INSERT INTO pipeline_movements (id,tenant_id,candidate_id,application_id,stage_from,stage_to,reason,triggered_by) VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,'scheduled_auto_move','scheduler')",
                                    t["tenant_id"], app["candidate_id"], app["id"], rule["stage_from"], rule["stage_to"]
                                )
                                moved += 1
                        if moved:
                            logger.info(f"Auto-moved {moved} candidates via rule '{rule['name']}' for tenant {tid}")
                except Exception as e:
                    logger.error(f"Auto-move failed for tenant {tid}: {e}")
    except Exception as e:
        logger.error(f"Scheduled auto-move error: {e}")

async def send_interview_reminders():
    """Daily 8am: email candidates with interviews in the next 24 hours."""
    logger.info("scheduler: sending interview reminders")
    import smtplib, asyncpg, os as _os
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    try:
        async with db.system_conn() as conn:
            tenants = await conn.fetch("SELECT id FROM tenants WHERE is_active=TRUE")
        for tenant in tenants:
            tid = str(tenant["id"])
            try:
                async with db.tenant_conn(tid) as conn:
                    rows = await conn.fetch("""
                        SELECT i.id, i.interview_type, i.scheduled_at, i.duration_mins,
                               i.mode, i.meeting_link, i.location, i.notes,
                               c.full_name AS candidate_name, c.email AS candidate_email
                        FROM interview_schedules i
                        JOIN candidates c ON c.id=i.candidate_id
                        WHERE i.tenant_id=$1
                          AND i.status='scheduled'
                          AND i.reminder_sent_at IS NULL
                          AND i.scheduled_at BETWEEN now() AND now() + INTERVAL '24 hours'
                    """, tid)
                    if not rows:
                        continue
                    # Get SMTP config
                    _db_url = _os.environ.get("DATABASE_URL", "postgresql://app_user:apppw@db:5432/ats")
                    _conn = await asyncpg.connect(_db_url)
                    try:
                        _cfg = await _conn.fetchrow(
                            "SELECT smtp_host,smtp_port,smtp_user,smtp_password,smtp_from,smtp_from_name,smtp_tls "
                            "FROM email_settings WHERE tenant_id=$1 AND is_active=TRUE LIMIT 1", tid)
                    finally:
                        await _conn.close()
                    if not (_cfg and _cfg['smtp_host']):
                        continue
                    _h = _cfg['smtp_host']; _p = _cfg['smtp_port'] or 587
                    _u = _cfg['smtp_user'] or ''; _pw = _cfg['smtp_password'] or ''
                    _f = _cfg['smtp_from'] or _u; _fn = _cfg['smtp_from_name'] or 'AVIIN ATS'
                    _tls = _cfg['smtp_tls'] if _cfg['smtp_tls'] is not None else True
                    sent_ids = []
                    for iv in rows:
                        if not iv['candidate_email']:
                            continue
                        try:
                            body_parts = [
                                f"Dear {iv['candidate_name']},",
                                "",
                                f"This is a reminder for your {iv['interview_type'].title()} interview scheduled tomorrow.",
                                "",
                                f"Date & Time : {iv['scheduled_at']}",
                                f"Duration    : {iv['duration_mins']} minutes",
                                f"Mode        : {iv['mode'].replace('_',' ').title()}",
                            ]
                            if iv['meeting_link']:
                                body_parts.append(f"Meeting Link: {iv['meeting_link']}")
                            if iv['location']:
                                body_parts.append(f"Location    : {iv['location']}")
                            body_parts += ["", "Best regards,", "AVIIN Jobs Services"]
                            _em = MIMEMultipart()
                            _em['Subject'] = f"Interview Reminder: {iv['interview_type'].title()} Interview Tomorrow"
                            _em['From'] = f"{_fn} <{_f}>"
                            _em['To'] = iv['candidate_email']
                            _em.attach(MIMEText(chr(10).join(body_parts), "plain"))
                            with smtplib.SMTP(_h, _p, timeout=10) as _s:
                                _s.ehlo()
                                if _tls and _p == 587:
                                    _s.starttls(); _s.ehlo()
                                if _u:
                                    _s.login(_u, _pw)
                                _s.sendmail(_f, [iv['candidate_email']], _em.as_string())
                            sent_ids.append(str(iv['id']))
                        except Exception as ex:
                            logger.error(f"Reminder email failed for {iv['id']}: {ex}")
                    if sent_ids:
                        async with db.tenant_conn(tid) as conn2:
                            await conn2.execute(
                                "UPDATE interview_schedules SET reminder_sent_at=now() WHERE id=ANY($1::uuid[])",
                                sent_ids)
                        logger.info(f"Sent {len(sent_ids)} interview reminders for tenant {tid}")
            except Exception as e:
                logger.error(f"Reminder job failed for tenant {tid}: {e}")
    except Exception as e:
        logger.error(f"send_interview_reminders error: {e}")


def start_scheduler():
    """Register and start all jobs."""
    # Daily at 02:00 IST
    scheduler.add_job(process_retention_bank_releases, "cron", hour=2, minute=0,

                      id="retention_bank_release", replace_existing=True)
    # Daily at 02:15 IST
    scheduler.add_job(check_loyalty_milestones, "cron", hour=2, minute=15,
                      id="loyalty_milestones", replace_existing=True)
    # Weekly Sunday at 03:00 IST
    scheduler.add_job(refresh_kae_retention_months, "cron", day_of_week="sun", hour=3,
                      id="kae_retention_refresh", replace_existing=True)
    # Monthly 1st at 04:00 IST
    scheduler.add_job(run_gdpr_archive, "cron", day_of_week="sun", hour=1, minute=30,
                  id="gdpr_archive", replace_existing=True)
    scheduler.add_job(send_weekly_kpi_summary, "cron", day_of_week="mon", hour=9,
                  id="weekly_kpi_summary", replace_existing=True)
    scheduler.add_job(send_monthly_incentive_summary, "cron", day=1, hour=4,
                      id="monthly_incentive_summary", replace_existing=True)
    # Daily at 01:00 IST — pipeline auto-move (evaluate stage rules for all tenants)
    scheduler.add_job(run_pipeline_auto_move, "cron", hour=1, minute=0,
                      id="pipeline_auto_move", replace_existing=True)
    # Daily at 08:00 — interview reminder emails
    scheduler.add_job(send_interview_reminders, "cron", hour=8, minute=0,
                      id="interview_reminders", replace_existing=True)
    scheduler.add_job(process_nurture_sequences, "interval", hours=4, id="nurture_sequences", replace_existing=True)
    scheduler.start()
    logger.info("APScheduler started: retention_bank, loyalty, kae_retention, monthly_summary, pipeline_auto_move")

async def run_gdpr_archive():
    """Weekly GDPR: anonymize candidates inactive for 90+ days."""
    logger.info("scheduler: GDPR archive job running")
    try:
        async with db.system_conn() as conn:
            tenants = await conn.fetch("SELECT id FROM tenants")
        for tenant in tenants:
            tid = str(tenant["id"])
            async with db.tenant_conn(tid) as conn:
                stale = await conn.fetch("""
                    SELECT id FROM candidates
                    WHERE tenant_id=$1
                      AND created_at < now()-INTERVAL '90 days'
                      AND NOT EXISTS (SELECT 1 FROM applications WHERE candidate_id=candidates.id AND tenant_id=$1)
                """, tid)
                for row in stale:
                    await conn.execute("""
                        UPDATE candidates SET
                          email='archived_'||LEFT(id::text,8)||'@redacted.com',
                          phone=NULL, full_name='ANONYMIZED', resume_text=NULL
                        WHERE id=$1 AND tenant_id=$2
                    """, row["id"], tid)
        logger.info(f"GDPR archive complete")
    except Exception as e:
        logger.error(f"GDPR archive error: {e}")

async def send_weekly_kpi_summary():
    """Monday 9AM: send weekly KPI summary via webhook integrations."""
    logger.info("scheduler: weekly KPI summary")
    try:
        import httpx
        async with db.system_conn() as conn:
            hooks = await conn.fetch("""
                SELECT wi.*, t.id AS tenant_id FROM webhook_integrations wi
                JOIN tenants t ON t.id=wi.tenant_id
                WHERE wi.is_active AND ('weekly_kpi'=ANY(wi.events) OR wi.events='{}'::text[])
            """)
        for h in hooks:
            try:
                async with httpx.AsyncClient(timeout=10) as client:
                    await client.post(h["webhook_url"],
                        json={"text": f"📊 Weekly KPI Summary from AVIIN ATS — {__import__('datetime').date.today()}"})
            except Exception:
                pass
    except Exception as e:
        logger.error(f"Weekly KPI error: {e}")



async def process_nurture_sequences():
    """Run active nurture sequences."""
    import json as _json
    stage_map = {
        'offer_made': 'offer', 'offer_accepted': 'offer_accepted',
        'interview_scheduled': 'l1_interview', 'candidate_placed': 'placed',
        'candidate_rejected': 'rejected', 'application_received': 'sourced',
    }
    try:
        async with db.system_conn() as conn:
            seqs = await conn.fetch(
                "SELECT id, tenant_id, name, trigger_event, steps FROM nurture_sequences WHERE is_active=true")
        for seq in seqs:
            stage = stage_map.get(seq['trigger_event'])
            if not stage:
                continue
            steps = seq['steps'] if isinstance(seq['steps'], list) else _json.loads(seq['steps'] or '[]')
            if not steps:
                continue
            try:
                async with db.tenant_conn(seq['tenant_id']) as conn:
                    cands = await conn.fetch(
                        "SELECT a.candidate_id FROM applications a"
                        " JOIN candidates c ON c.id=a.candidate_id"
                        " WHERE a.tenant_id=$1 AND a.stage=$2 AND c.email IS NOT NULL"
                        " AND NOT EXISTS (SELECT 1 FROM nurture_executions ne"
                        "  WHERE ne.sequence_id=$3::uuid AND ne.candidate_id=a.candidate_id"
                        "  AND ne.sent_at > now() - interval '24 hours') LIMIT 20",
                        seq['tenant_id'], stage, str(seq['id']))
                    for cand in cands:
                        try:
                            await conn.execute(
                                "INSERT INTO nurture_executions"
                                "  (tenant_id, sequence_id, candidate_id, step_idx, channel, sent_at)"
                                " VALUES ($1, $2::uuid, $3, 0, $4, now())"
                                " ON CONFLICT (sequence_id, candidate_id) DO NOTHING",
                                seq['tenant_id'], str(seq['id']), cand['candidate_id'],
                                steps[0].get('type', 'email') if steps else 'email')
                        except Exception:
                            pass
            except Exception as e:
                logger.warning(f"nurture seq {seq['id']}: {e}")
    except Exception as e:
        logger.error(f"process_nurture_sequences error: {e}")
