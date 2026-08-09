"""
Background scheduler — replaces pg_cron (not available).
Runs inside the FastAPI process via APScheduler.
Jobs: retention bank release, loyalty milestones, KAE months, n8n triggers.
"""
import httpx
import logging
from datetime import date, datetime, timedelta, timezone
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
    """Release held retention bank amounts past their due_date.

    retention_bank has FORCE ROW LEVEL SECURITY with a policy that casts
    app.tenant_id to ::uuid — db.system_conn() deliberately sets
    app.tenant_id='' for admin/cross-tenant queries, and casting '' to
    ::uuid is a hard Postgres error, not zero rows. This UPDATE ran
    through system_conn() directly against a FORCE-RLS table, so it threw
    on every single invocation and was silently swallowed by the bare
    except below — retention bank has never actually auto-released for
    any tenant since this job was built. Same root cause + same fix
    already applied elsewhere in this codebase (send_weekly_kpi_summary,
    run_pipeline_auto_move): list tenant IDs via system_conn() (no RLS on
    `tenants` itself), then do the real UPDATE through a per-tenant
    tenant_conn().
    """
    logger.info("scheduler: processing retention bank releases")
    try:
        async with db.system_conn() as conn:
            tenant_ids = [r["id"] for r in await conn.fetch("SELECT id FROM tenants")]
        total_released = 0
        total_amount = 0.0
        for tid in tenant_ids:
            async with db.tenant_conn(str(tid)) as conn:
                rows = await conn.fetch("""
                    UPDATE retention_bank
                       SET status='released', released_at=now()
                     WHERE status='held'
                       AND release_due_date <= CURRENT_DATE
                    RETURNING user_id, amount, accrued_month, accrued_year
                """)
            if rows:
                total_released += len(rows)
                total_amount += float(sum(r["amount"] for r in rows))
        if total_released:
            logger.info(f"Released {total_released} retention bank entries")
            await _notify_n8n("retention-bank-released", {
                "count": total_released,
                "total": total_amount,
                "date": str(date.today()),
            })
    except Exception as e:
        logger.error(f"retention_bank_releases error: {e}")


async def check_loyalty_milestones():
    """Flag loyalty milestones that have passed their milestone_date.

    Same FORCE-RLS + system_conn()-''::uuid bug as process_retention_bank_
    releases() above (loyalty_milestones also has FORCE ROW LEVEL SECURITY)
    — loyalty milestones have never actually auto-promoted pending ->
    achieved for any tenant since this job was built. Same per-tenant fix.
    """
    logger.info("scheduler: checking loyalty milestones")
    try:
        async with db.system_conn() as conn:
            tenant_ids = [r["id"] for r in await conn.fetch("SELECT id FROM tenants")]
        all_rows = []
        for tid in tenant_ids:
            async with db.tenant_conn(str(tid)) as conn:
                rows = await conn.fetch("""
                    UPDATE loyalty_milestones
                       SET status='achieved', achieved_at=now()
                     WHERE status='pending'
                       AND milestone_date <= CURRENT_DATE
                    RETURNING user_id, milestone_years, bonus_amount
                """)
            all_rows.extend(rows)
        if all_rows:
            logger.info(f"Achieved {len(all_rows)} loyalty milestones")
            await _notify_n8n("loyalty-milestone-achieved", {
                "count": len(all_rows),
                "milestones": [{"user_id": str(r["user_id"]),
                                "years": r["milestone_years"],
                                "bonus": float(r["bonus_amount"])} for r in all_rows],
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


SLA_ESCALATION_GRACE_HOURS = 24  # tier 2 (auto-reassign) only fires if still
# unresolved this long after tier 1 (alert + manager notify) first fired —
# not immediately, per the user's explicit choice for approved item 05
# (layered policy, not instant auto-reassign).


async def process_sla_escalations():
    """Approved items 04+05 (AI Auto-Assignment Engine audit): find_sla_
    breaches()/find_stalled_assignments() were real since P1/P3 but only
    ever produced a dashboard card a human had to click — the ten
    automation_workflows rows for exactly this (SLA Breach Warning, Stale
    Requisition Alert) had fire_count=0 forever. Layered response per
    tenant: tier 1 fires the matching n8n webhook + notifies the
    recruiter's manager (once per alert); tier 2 auto-reassigns via
    do_reassign() only if the alert is still open SLA_ESCALATION_GRACE_HOURS
    after tier 1 fired.
    """
    logger.info("scheduler: processing SLA escalations")
    try:
        async with db.system_conn() as conn:
            tenants = await conn.fetch("SELECT id FROM tenants")
    except Exception as e:
        logger.error(f"SLA escalation: could not list tenants: {e}")
        return

    for t in tenants:
        tid = str(t["id"])
        try:
            async with db.tenant_conn(tid) as conn:
                await _process_tenant_sla_escalations(conn, tid)
        except Exception as e:
            logger.error(f"SLA escalation failed for tenant {tid}: {e}")


async def _process_tenant_sla_escalations(conn, tenant_id: str):
    stalled = await conn.fetch("SELECT * FROM find_stalled_assignments(48)")
    breaches = await conn.fetch("SELECT * FROM find_sla_breaches()")
    current_alert_ids = []

    for r in stalled:
        alert_id = f"stale_{r['assignment_id']}"
        current_alert_ids.append(alert_id)
        await _handle_escalation_alert(
            conn, tenant_id, alert_id, "stalled_assignment",
            requisition_id=r["requisition_id"], assignment_id=r["assignment_id"],
            title=f"{r['requisition_title']} — no update in {round(r['hours_since_update'])}h",
            recruiter_id=r["recruiter_id"],
        )

    for r in breaches:
        alert_id = f"sla_{r['requisition_id']}"
        current_alert_ids.append(alert_id)
        assignment = await conn.fetchrow(
            "SELECT id, recruiter_id FROM assignments WHERE requisition_id=$1 AND status='active'",
            r["requisition_id"],
        )
        await _handle_escalation_alert(
            conn, tenant_id, alert_id, "sla_breach",
            requisition_id=r["requisition_id"],
            assignment_id=assignment["id"] if assignment else None,
            title=f"{r['title']} — SLA breached ({round(r['hours_open'])}h open, limit {r['sla_hours']}h)",
            recruiter_id=assignment["recruiter_id"] if assignment else None,
            sla_hours=r["sla_hours"],
        )

    await conn.execute(
        """UPDATE sla_escalations SET resolved_at=now()
           WHERE tenant_id=$1 AND resolved_at IS NULL AND NOT (alert_id = ANY($2::text[]))""",
        tenant_id, current_alert_ids,
    )


def _grace_hours_for(alert_type: str, sla_hours) -> float:
    """Recommendation 1 (recruiter-assignment gap analysis): the tier-1 ->
    tier-2 grace period used to be one flat SLA_ESCALATION_GRACE_HOURS for
    every requisition regardless of priority. For sla_breach alerts,
    find_sla_breaches() now returns the *effective* hours it used (already
    priority-tier- and client-tier-adjusted via sql/37...sql), so scale the
    grace period off that: 10% of the target window, floored at 4h — a
    critical job's tighter target naturally yields a tighter grace period
    too, without a second config surface. stalled_assignment alerts have no
    such target (they're a "nobody touched this" signal, not a fill-time
    budget) so they keep the flat default."""
    if alert_type == "sla_breach" and sla_hours:
        return max(4, round(sla_hours * 0.1))
    return SLA_ESCALATION_GRACE_HOURS


async def _handle_escalation_alert(conn, tenant_id, alert_id, alert_type, requisition_id, assignment_id, title, recruiter_id, sla_hours=None):
    row = await conn.fetchrow(
        """INSERT INTO sla_escalations (tenant_id, alert_id, alert_type, requisition_id, assignment_id)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (tenant_id, alert_id) WHERE resolved_at IS NULL DO NOTHING
           RETURNING *""",
        tenant_id, alert_id, alert_type, requisition_id, assignment_id,
    )
    if row is None:
        row = await conn.fetchrow(
            "SELECT * FROM sla_escalations WHERE tenant_id=$1 AND alert_id=$2 AND resolved_at IS NULL",
            tenant_id, alert_id,
        )
    if row is None:
        return

    if row["tier1_fired_at"] is None:
        webhook_path = "sla-breach-warning" if alert_type == "sla_breach" else "stale-requisitions"
        await _notify_n8n(webhook_path, {"alert_id": alert_id, "title": title, "tenant_id": tenant_id})
        await conn.execute(
            "UPDATE automation_workflows SET last_fired_at=now(), fire_count=fire_count+1 WHERE tenant_id=$1 AND webhook_path=$2",
            tenant_id, webhook_path,
        )
        # Push the same alert to any configured Slack/Teams/Discord webhook
        # (routers/final_features.py) - these alerts previously only ever
        # produced a dashboard card someone had to go check; this makes
        # them push-visible without adding a new notification channel.
        try:
            from routers.final_features import notify_event
            icon = "🔴" if alert_type == "sla_breach" else "🟡"
            await notify_event(tenant_id, alert_type, f"{icon} {title}",
                                {"alert_type": alert_type, "requisition_id": str(requisition_id) if requisition_id else None})
        except Exception as e:
            logger.warning(f"SLA escalation webhook notify failed for {alert_id}: {e}")
        if recruiter_id:
            manager = await conn.fetchrow("SELECT reporting_to FROM users WHERE id=$1", recruiter_id)
            if manager and manager["reporting_to"]:
                # notifications has both an older (recipient_user_id/body) and a
                # newer (user_id/message) column generation from different
                # features; notifications_check requires recipient_user_id (or
                # recipient_role) to be set, and "message" isn't a real column
                # at all — matches the working pattern in nda.py/resume_intake_service.py.
                await conn.execute(
                    """INSERT INTO notifications (tenant_id,user_id,recipient_user_id,title,body,type,resource,resource_id,channel)
                       VALUES ($1,$2,$2,$3,$4,'warning',$5,$6,'inapp')""",
                    tenant_id, manager["reporting_to"], "SLA escalation", title,
                    "requisition" if requisition_id else None, str(requisition_id) if requisition_id else None,
                )
        await conn.execute("UPDATE sla_escalations SET tier1_fired_at=now() WHERE id=$1", row["id"])
        logger.info(f"SLA escalation tier 1 fired: {alert_id}")

    elif row["tier2_fired_at"] is None and assignment_id:
        grace_hours = _grace_hours_for(alert_type, sla_hours)
        hours_since_first = (datetime.now(timezone.utc) - row["first_detected_at"]).total_seconds() / 3600
        if hours_since_first >= grace_hours:
            try:
                result = await conn.fetchrow(
                    "SELECT * FROM do_reassign($1, $2, NULL)",
                    assignment_id, f"Auto-escalation: unresolved {grace_hours}h+ after SLA alert",
                )
                await conn.execute("UPDATE sla_escalations SET tier2_fired_at=now() WHERE id=$1", row["id"])
                logger.info(f"SLA escalation tier 2 auto-reassigned {assignment_id} -> {result['new_recruiter_id']}")
            except Exception as e:
                logger.warning(f"SLA escalation tier 2 reassign failed for {assignment_id}: {e}")


async def run_pipeline_auto_move():
    """Daily: evaluate all tenant stage rules and auto-move candidates."""
    logger.info("Running scheduled pipeline auto-move")
    try:
        async with db.system_conn() as sconn:
            # tenants has no ::uuid-cast FORCE RLS policy, safe to list via
            # system_conn (app.tenant_id=''). stage_rules/pipeline_movements
            # now DO (added alongside this fix — they had no RLS at all
            # before, a real tenant-isolation gap found while wiring manual
            # stage moves to write to pipeline_movements) — every read/write
            # against either now goes through a real per-tenant tenant_conn()
            # below instead, same fix class as send_weekly_kpi_summary.
            tenant_ids = [str(r["id"]) for r in await sconn.fetch("SELECT id FROM tenants")]

        import json as _json
        for tid in tenant_ids:
            try:
                async with db.tenant_conn(tid) as conn:
                    rules = await conn.fetch(
                        "SELECT id, name, stage_from, stage_to, conditions FROM stage_rules WHERE enabled=TRUE AND tenant_id=$1",
                        tid
                    )
                    if not rules:
                        continue

                    # Stages are deletable (Settings > Pipeline Stages); a
                    # rule pointing at a since-deleted stage_to must not
                    # write it, or the candidate would silently vanish from
                    # every Kanban board.
                    configured = {r["stage_key"] for r in await conn.fetch(
                        "SELECT stage_key FROM pipeline_stage_config WHERE tenant_id=$1", tid)}
                    valid_stages = configured if configured else {
                        "sourced","contacted","interested","nda","screened","submitted",
                        "l1_interview","l2_interview","offer","offer_accepted","placed","rejected","hold",
                    }
                    for rule in rules:
                        if rule["stage_to"] not in valid_stages:
                            logger.warning(f"Auto-move rule '{rule['name']}' targets deleted stage '{rule['stage_to']}' for tenant {tid} — skipped")
                            continue
                        conds = rule["conditions"] if isinstance(rule["conditions"], list) else _json.loads(rule["conditions"] or "[]")
                        apps = await conn.fetch(
                            "SELECT a.id, a.stage, a.candidate_id, a.fit_score, c.total_exp_mo, c.ai_match_score, c.expected_ctc, c.notice_period_days, c.full_name FROM applications a JOIN candidates c ON c.id=a.candidate_id WHERE a.stage=$1 AND a.tenant_id=$2",
                            rule["stage_from"], tid
                        )
                        moved = 0
                        for app in apps:
                            if all(_eval(app.get(co.get("field")), co.get("op",">"), co.get("value",0)) for co in conds):
                                await conn.execute("UPDATE applications SET stage=$1, updated_at=NOW() WHERE id=$2", rule["stage_to"], app["id"])
                                await conn.execute(
                                    "INSERT INTO pipeline_movements (id,tenant_id,candidate_id,application_id,stage_from,stage_to,reason,triggered_by) VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,'scheduled_auto_move','scheduler')",
                                    tid, app["candidate_id"], app["id"], rule["stage_from"], rule["stage_to"]
                                )
                                moved += 1
                        if moved:
                            logger.info(f"Auto-moved {moved} candidates via rule '{rule['name']}' for tenant {tid}")
            except Exception as e:
                logger.error(f"Auto-move failed for tenant {tid}: {e}")
    except Exception as e:
        logger.error(f"Scheduled auto-move error: {e}")

async def process_resume_backlog():
    """Every 1 min: clear pending resume-intake emails in small batches.

    Used to be entirely manual (the "Process Pending" button) - which is
    also how a large backlog built up in the first place, since nothing
    was ever pulling it down automatically. Runs the same batch logic as
    that button, just on a schedule instead of a click, so it keeps making
    steady progress unattended."""
    import os
    logger.info("scheduler: processing resume-intake backlog batch")
    try:
        from services.resume_intake_service import process_pending_batch
        ollama_url = os.environ.get('OLLAMA_URL', 'http://ollama:11434')
        ollama_model = os.environ.get('OLLAMA_MODEL', 'qwen2.5:1.5b-instruct-q4_K_M')
        async with db.system_conn() as conn:
            tenants = await conn.fetch("""
                SELECT DISTINCT im.tenant_id
                FROM imap_messages im
                JOIN user_email_accounts ua ON ua.id=im.account_id
                WHERE im.is_deleted IS NOT TRUE AND im.folder='INBOX' AND ua.is_active=TRUE
                  AND (im.auto_processed IS NOT TRUE)
                  AND im.attachments IS NOT NULL AND im.attachments!='[]'
            """)
        # system_conn() sets app.tenant_id='' - fine for the cross-tenant
        # discovery read above, but process_pending_batch() manages its own
        # per-tenant tenant_conn() calls internally now (see that
        # function's docstring - it used to share one connection for a
        # whole 50-item batch, which meant nothing committed until the
        # entire batch finished, sometimes 12+ minutes with OCR-heavy
        # PDFs mixed in).
        for t in tenants:
            # asyncpg decodes a uuid column into a Python uuid.UUID object,
            # not str - tenant_conn()'s set_config() call needs an actual
            # string, so pass tid (already stringified), not the raw UUID.
            tid = str(t["tenant_id"])
            try:
                result = await process_pending_batch(
                    tid, limit=50,
                    ollama_url=ollama_url, ollama_model=ollama_model)
                if result.get('processed') or result.get('errors'):
                    logger.info(f"Resume backlog tenant {tid}: {result}")
            except Exception as e:
                logger.error(f"Resume backlog processing failed for tenant {tid}: {e}")
    except Exception as e:
        logger.error(f"Scheduled resume backlog error: {e}")


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
    # Every 1 min — clear resume-intake backlog in small batches. Safe to
    # fire this often: process_pending_batch() takes a per-tenant Postgres
    # advisory lock, so if the previous run is still going (a batch full of
    # real OCR/Ollama parsing can take several minutes) this just no-ops
    # instead of overlapping. Was every 10 min, but many batches finish in
    # under 20s when dominated by duplicates/deleted messages, leaving most
    # of each 10-minute window idle instead of grabbing the next batch.
    scheduler.add_job(process_resume_backlog, "interval", minutes=1,
                      id="resume_backlog", replace_existing=True)
    scheduler.add_job(process_nurture_sequences, "interval", hours=4, id="nurture_sequences", replace_existing=True)
    scheduler.add_job(process_nurture_dispatch, "interval", minutes=15, id="nurture_dispatch", replace_existing=True)
    # Every 30 min — approved items 04+05: fire SLA-breach/stale-requisition
    # alerts automatically instead of waiting for a human to open the panel,
    # and auto-reassign after a grace period if still unresolved.
    scheduler.add_job(process_sla_escalations, "interval", minutes=30, id="sla_escalations", replace_existing=True)
    # Daily at 03:00 IST — data-minimization purge for device monitoring
    # (active-window log + browsing history). Consent/device/enrollment
    # rows are kept (they're the audit trail of who agreed to what), only
    # the granular activity data ages out.
    scheduler.add_job(purge_old_device_monitoring_data, "cron", hour=3, minute=0,
                      id="device_monitoring_purge", replace_existing=True)
    scheduler.start()
    logger.info("APScheduler started: retention_bank, loyalty, kae_retention, monthly_summary, pipeline_auto_move")

DEVICE_MONITORING_RETENTION_DAYS = 90


async def purge_old_device_monitoring_data():
    """Data minimization: delete device activity/browsing rows older than
    DEVICE_MONITORING_RETENTION_DAYS. Consent and device-enrollment records
    are NOT touched here — those are the compliance audit trail (who
    consented, when, to what policy version) and should outlive the raw
    activity data they authorized."""
    logger.info("scheduler: device monitoring purge running")
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(days=DEVICE_MONITORING_RETENTION_DAYS)
        async with db.system_conn() as conn:
            tenants = await conn.fetch("SELECT id FROM tenants")
        for tenant in tenants:
            tid = str(tenant["id"])
            async with db.tenant_conn(tid) as conn:
                a = await conn.execute(
                    "DELETE FROM device_activity_log WHERE tenant_id=$1 AND started_at < $2",
                    tid, cutoff,
                )
                b = await conn.execute(
                    "DELETE FROM device_browsing_history WHERE tenant_id=$1 AND visited_at < $2",
                    tid, cutoff,
                )
                logger.info(f"device monitoring purge tenant={tid}: activity={a} browsing={b}")
    except Exception as e:
        logger.error(f"purge_old_device_monitoring_data error: {e}")


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
    """Monday 9AM: send weekly KPI summary via webhook integrations.

    Was posting a raw {"text": ...} body straight to every webhook regardless
    of platform - a Slack-shaped payload, which happens to render as plain
    text on Discord too but is NOT what Teams' incoming-webhook connector
    expects (it wants the MessageCard shape send_webhook() already builds),
    and it never touched send_count/last_sent_at, so the Integrations page
    would never show this scheduled send as having happened. Now routes
    through the same notify_event() used by every other webhook trigger.

    Also fixes a second, deeper real bug caught by actually running this
    function (not just reading it): the original query read
    webhook_integrations directly through db.system_conn(), but that table
    has FORCE ROW LEVEL SECURITY with a policy that casts app.tenant_id to
    ::uuid - system_conn() deliberately sets app.tenant_id='' for
    "return everything" admin queries, and casting '' to uuid raises a hard
    Postgres error rather than returning no rows. This function had
    silently thrown (caught by the outer try/except, logged, never seen)
    every single time it ran, since it was written. Fixed by following the
    same pattern process_sla_escalations() already uses: list tenants from
    the tenants table (no such RLS-cast problem there) via system_conn(),
    then open a real per-tenant tenant_conn() before touching
    webhook_integrations.
    """
    logger.info("scheduler: weekly KPI summary")
    try:
        from routers.final_features import notify_event
        async with db.system_conn() as conn:
            tenants = await conn.fetch("SELECT id FROM tenants")
        message = f"📊 Weekly KPI Summary from AVIIN ATS — {date.today()}"
        for t in tenants:
            tid = str(t["id"])
            try:
                await notify_event(tid, "weekly_kpi", message)
            except Exception as e:
                logger.warning(f"Weekly KPI webhook send failed for tenant {tid}: {e}")
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
            # 'manual' is intentionally excluded from the scheduler - it's a
            # trigger a human fires deliberately via "Run Now" (see the
            # matching fix in final_features.py's run-now for that path);
            # auto-firing it here every 4h would silently message every
            # passive candidate once a day forever, defeating the entire
            # point of choosing "Manual Trigger" over one of the automatic
            # ones.
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
                            # step_idx=0/sent_at=NULL = "step 0 still due" -
                            # process_nurture_dispatch is what actually sends
                            # it. DO NOTHING on conflict: a candidate already
                            # mid-sequence keeps their real progress.
                            await conn.execute(
                                "INSERT INTO nurture_executions"
                                "  (tenant_id, sequence_id, candidate_id, step_idx, channel, enrolled_at, sent_at)"
                                " VALUES ($1, $2::uuid, $3, 0, $4, now(), NULL)"
                                " ON CONFLICT (sequence_id, candidate_id) DO NOTHING",
                                seq['tenant_id'], str(seq['id']), cand['candidate_id'],
                                steps[0].get('type', 'email') if steps else 'email')
                        except Exception:
                            pass
            except Exception as e:
                logger.warning(f"nurture seq {seq['id']}: {e}")
    except Exception as e:
        logger.error(f"process_nurture_sequences error: {e}")


def _render_nurture_template(template: str, ctx: dict) -> str:
    """Fill in {name}/{role}/{company}/... placeholders; strip anything
    left unresolved rather than send a literal "{ctc}" to a candidate."""
    import re as _re
    def _sub(m):
        return str(ctx.get(m.group(1), '')) if m.group(1) in ctx else ''
    return _re.sub(r'\{(\w+)\}', _sub, template)


async def process_nurture_dispatch():
    """Every 15 min: the actual send step. process_nurture_sequences (and
    run-now) only ever enrolled candidates (step_idx=0, sent_at=NULL) - no
    code anywhere read that enrollment and called a real send function, so
    no candidate has ever received an actual nurture email/WhatsApp/SMS.
    This walks every in-progress enrollment, sends whichever step is due
    (day offset measured from enrolled_at), and advances step_idx on
    success so the next step becomes due later."""
    import json as _json
    from routers.nda import _send_email_with_pdf
    from routers.whatsapp_bot import send_wa
    from services.sms_service import send_sms

    logger.info("scheduler: dispatching due nurture steps")
    try:
        async with db.system_conn() as conn:
            tenants = await conn.fetch("SELECT DISTINCT tenant_id FROM nurture_executions")
        for t in tenants:
            tid = str(t["tenant_id"])
            try:
                async with db.tenant_conn(tid) as conn:
                    rows = await conn.fetch("""
                        SELECT ne.id, ne.sequence_id, ne.candidate_id, ne.step_idx, ne.enrolled_at,
                               ns.name AS seq_name, ns.steps,
                               c.full_name, c.email, c.phone,
                               tt.name AS company_name
                        FROM nurture_executions ne
                        JOIN nurture_sequences ns ON ns.id = ne.sequence_id
                        JOIN candidates c ON c.id = ne.candidate_id
                        JOIN tenants tt ON tt.id = ne.tenant_id
                        WHERE ne.tenant_id=$1 AND ns.is_active=TRUE
                        LIMIT 100
                    """, tid)
                    for r in rows:
                        steps = r["steps"] if isinstance(r["steps"], list) else _json.loads(r["steps"] or "[]")
                        if r["step_idx"] >= len(steps):
                            continue
                        step = steps[r["step_idx"]]
                        due_at = r["enrolled_at"] + __import__("datetime").timedelta(days=int(step.get("day", 0)))
                        if __import__("datetime").datetime.now(__import__("datetime").timezone.utc) < due_at:
                            continue

                        role_row = await conn.fetchrow("""
                            SELECT req.title FROM applications a
                            JOIN requisitions req ON req.id = a.requisition_id
                            WHERE a.candidate_id=$1 AND a.tenant_id=$2
                            ORDER BY a.updated_at DESC LIMIT 1
                        """, r["candidate_id"], tid)
                        ctx = {
                            "name": r["full_name"] or "there",
                            "role": (role_row["title"] if role_row else "") or "",
                            "company": r["company_name"] or "AVIIN Jobs",
                        }
                        message = _render_nurture_template(step.get("template", ""), ctx)
                        channel = step.get("type", "email")

                        sent_ok = False
                        error = None
                        try:
                            if channel == "email" and r["email"]:
                                sent_ok = await _send_email_with_pdf(
                                    tid, r["email"], r["full_name"],
                                    f"Update from {ctx['company']}", message)
                                if not sent_ok:
                                    error = "SMTP send returned false (no active email_settings?)"
                            elif channel == "whatsapp" and r["phone"]:
                                # HARD RULE #7: WhatsApp always requires consent
                                # first - unlike email/SMS, this is the one
                                # channel with an explicit project-wide rule,
                                # so it's the one gated here even though the
                                # consent-collection UI itself doesn't exist
                                # yet (P26 audit finding) - the correct,
                                # conservative behavior until it does is to
                                # not send, not to send anyway.
                                consented = await conn.fetchval("""
                                    SELECT 1 FROM consent_records
                                    WHERE candidate_id=$1 AND tenant_id=$2
                                      AND (channel='whatsapp' OR data_category ILIKE '%whatsapp%')
                                      AND consent_given=TRUE LIMIT 1
                                """, r["candidate_id"], tid)
                                if consented:
                                    sent_ok = await send_wa(r["phone"], message)
                                    if not sent_ok:
                                        error = "WAHA send failed"
                                else:
                                    error = "Skipped: no WhatsApp consent record (HARD RULE #7)"
                            elif channel == "sms" and r["phone"]:
                                result = await send_sms(r["phone"], message)
                                sent_ok = result.get("status") == "sent"
                                error = None if sent_ok else f"SMS {result.get('status')}: {result.get('error', '')}"
                            else:
                                error = f"No {channel} contact info for candidate"
                        except Exception as send_exc:
                            error = str(send_exc)

                        if sent_ok:
                            await conn.execute("""
                                UPDATE nurture_executions
                                SET step_idx=step_idx+1, sent_at=now(), channel=$1, last_error=NULL
                                WHERE id=$2
                            """, channel, r["id"])
                        else:
                            await conn.execute(
                                "UPDATE nurture_executions SET last_error=$1 WHERE id=$2",
                                (error or "unknown error")[:500], r["id"])
            except Exception as e:
                logger.error(f"Nurture dispatch failed for tenant {tid}: {e}")
    except Exception as e:
        logger.error(f"process_nurture_dispatch error: {e}")
