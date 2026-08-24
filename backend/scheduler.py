"""
Background scheduler — replaces pg_cron (not available).
Runs inside the FastAPI process via APScheduler.
Jobs: retention bank release, loyalty milestones, KAE months, n8n triggers.
"""
import fcntl
import httpx
import logging
from datetime import date, datetime, timedelta, timezone
from apscheduler.schedulers.asyncio import AsyncIOScheduler
import ai_router
import db

logger = logging.getLogger(__name__)

N8N_BASE = "http://n8n:5678"
scheduler = AsyncIOScheduler(timezone="Asia/Kolkata")

# The backend runs `uvicorn --workers 2` (Dockerfile), so start_scheduler()
# is called once per worker process at FastAPI lifespan startup — with no
# guard, every cron job (retention bank, SLA escalations, interview
# reminders, etc.) would fire twice, once per worker, at every trigger.
# A plain flock on a fixed path is enough since both workers share one
# container filesystem: whichever worker wins the non-blocking lock owns
# the scheduler for the container's lifetime; the file handle is kept open
# in a module global deliberately, never closed, so the lock is held for
# as long as that worker process runs. The losing worker still serves HTTP
# requests normally — it just never registers any cron job.
_SCHEDULER_LOCK_PATH = "/tmp/aviin_scheduler.lock"
_scheduler_lock_fh = None


def _acquire_scheduler_lock() -> bool:
    global _scheduler_lock_fh
    try:
        fh = open(_SCHEDULER_LOCK_PATH, "w")
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        _scheduler_lock_fh = fh  # keep open for process lifetime
        return True
    except (IOError, OSError):
        return False


async def _notify_n8n(path: str, payload: dict) -> bool:
    """Fire-and-forget n8n webhook. Returns whether it actually reached a
    real, matching n8n workflow — previously returned nothing, and every
    caller's fire_count/last_fired_at update ran unconditionally regardless
    of the response, so a 404 (no workflow registered for that path — a
    genuine, confirmed state for 8 of the 10 automation_workflows rows per
    the 2026-08-10 audit) looked identical to success. httpx doesn't raise
    on a 4xx/5xx by itself, so this checks status explicitly."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(f"{N8N_BASE}/webhook/{path}", json=payload)
        if resp.status_code >= 400:
            logger.warning(f"n8n webhook '{path}' returned {resp.status_code} — not counting as fired")
            return False
        return True
    except Exception as e:
        logger.warning(f"n8n notify failed ({path}): {e}")
        return False


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
        n8n_ok = await _notify_n8n(webhook_path, {"alert_id": alert_id, "title": title, "tenant_id": tenant_id})
        # Only counts as a real fire if n8n actually accepted it — this used
        # to run unconditionally, so fire_count measured "how many times we
        # attempted a POST" (160 real attempts, both these paths, before
        # this fix) rather than "how many times n8n actually executed a
        # workflow" (0, since neither had a matching workflow imported —
        # confirmed directly from n8n's own internal state, 2026-08-10 audit).
        if n8n_ok:
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
            # 2026-08-10: this whole function runs inside one long-lived
            # transaction opened by db.tenant_conn() (_process_tenant_
            # sla_escalations processes every alert for a tenant on one
            # connection). A bare try/except here does NOT protect against
            # that - once any statement inside raises a real Postgres
            # error (not just a Python exception), the whole transaction
            # is marked aborted and every later statement on this
            # connection fails too, silently truncating this tenant's
            # entire escalation run for the tick. Concretely hit by the
            # real bug fixed alongside this (sql/42...sql's new unique
            # index on assignments can now legitimately reject a
            # do_reassign() call whose target already has a duplicate
            # active sibling from before the fix). A nested
            # conn.transaction() is a real SAVEPOINT in asyncpg when a
            # transaction is already open, so a failure here rolls back
            # only this one alert, not the tenant's whole batch.
            try:
                async with conn.transaction():
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


async def _reminder_notify(conn, tenant_id, recipient_user_id, title, body, resource=None, resource_id=None, ntype="info"):
    """Shared insert matching the established notifications-table shape
    (tenant_id/user_id/recipient_user_id/title/body/type/resource/
    resource_id/channel — see _handle_escalation_alert above, same
    'user_id AND recipient_user_id both set' requirement from the
    notifications_check constraint).

    Phase 2: also delivers externally, severity-driven — 'warning' gets a
    real email + browser push on top of the in-app row, 'critical' adds
    WhatsApp too. Reuses phase3.py's send_whatsapp()/send_email() helpers
    (already the established, working senders for interview invites —
    WAHA + SMTP, both graceful no-ops if unconfigured/unreachable) plus
    the new push_service.send_push() (real W3C Push API + self-generated
    VAPID keypair — no external/paid service, unlike calendar 2-way sync
    which stays blocked on real OAuth credentials this project doesn't
    have) rather than a third copy of the same send logic. Deliberately
    does NOT insert a second
    notifications row per channel — GET /notifications has no channel
    filter at all (confirmed by reading the real query), so a second row
    here would show as a duplicate, confusing bell entry; email/WhatsApp
    are pure delivery side effects of the one canonical in-app row, same
    pattern already established elsewhere in this codebase for stage-
    change emails (logged to candidate_messages, never to notifications).
    Never lets a delivery failure take down the in-app notification that
    already landed above — each channel is its own best-effort try/except."""
    await conn.execute(
        """INSERT INTO notifications (tenant_id,user_id,recipient_user_id,title,body,type,resource,resource_id,channel)
           VALUES ($1,$2,$2,$3,$4,$5,$6,$7,'inapp')""",
        tenant_id, recipient_user_id, title, body, ntype, resource, resource_id,
    )
    if ntype in ("warning", "critical") and recipient_user_id:
        try:
            u = await conn.fetchrow("SELECT email, phone FROM users WHERE id=$1", recipient_user_id)
        except Exception as e:
            u = None
            logger.warning(f"Reminder delivery: could not resolve recipient {recipient_user_id}: {e}")
        if u:
            if u["email"]:
                try:
                    from routers.phase3 import send_email
                    await send_email(u["email"], title, body)
                except Exception as e:
                    logger.warning(f"Reminder email delivery failed for {recipient_user_id}: {e}")
            try:
                from services import push_service
                if push_service.is_configured():
                    subs = await conn.fetch(
                        "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE tenant_id=$1 AND user_id=$2",
                        tenant_id, recipient_user_id,
                    )
                    for s in subs:
                        await push_service.send_push(
                            {"endpoint": s["endpoint"], "keys": {"p256dh": s["p256dh"], "auth": s["auth"]}},
                            title, body, f"/reminders" if resource == "recruiter_task" else "/notifications",
                        )
            except Exception as e:
                logger.warning(f"Reminder push delivery failed for {recipient_user_id}: {e}")
            if ntype == "critical" and u["phone"]:
                try:
                    from routers.phase3 import send_whatsapp
                    await send_whatsapp(u["phone"], f"*{title}*\n{body}")
                except Exception as e:
                    logger.warning(f"Reminder WhatsApp delivery failed for {recipient_user_id}: {e}")


async def process_task_escalations():
    """Every 30 min: generalized 4-level escalation for any overdue
    follow-up/reminder task (recruiter_tasks) — tier1=assigned user,
    tier2=reporting manager, tier3=the linked client's KAE/KAM (only when
    a task actually names a client_id), tier4=admin. Reuses the exact
    tier1_fired_at/tier2_fired_at pattern _handle_escalation_alert already
    established for SLA breaches, generalized to 4 tiers in a new
    task_escalations table so it doesn't collide with that requisition-
    specific one. Grace periods are tenant-tunable (escalation_config);
    critical-priority tasks escalate at critical_multiplier speed.
    """
    logger.info("scheduler: processing task escalations")
    try:
        async with db.system_conn() as sconn:
            tenant_ids = [str(r["id"]) for r in await sconn.fetch("SELECT id FROM tenants")]
        for tid in tenant_ids:
            try:
                async with db.tenant_conn(tid) as conn:
                    cfg = await conn.fetchrow("SELECT * FROM escalation_config WHERE tenant_id=$1", tid)
                    if not cfg:
                        continue
                    mult = float(cfg["critical_multiplier"]) if True else 1.0
                    overdue = await conn.fetch(
                        """SELECT t.*, u.reporting_to
                           FROM recruiter_tasks t
                           LEFT JOIN users u ON u.id = t.recruiter_id
                           WHERE t.tenant_id=$1 AND t.status IN ('pending','in_progress')
                             AND t.due_at IS NOT NULL AND t.due_at < now()""",
                        tid,
                    )
                    for t in overdue:
                        try:
                            async with conn.transaction():
                                await _escalate_one_task(conn, tid, t, cfg, mult)
                        except Exception as e:
                            logger.warning(f"Task escalation failed for task {t['id']}: {e}")
            except Exception as e:
                logger.error(f"Task escalation failed for tenant {tid}: {e}")
    except Exception as e:
        logger.error(f"process_task_escalations error: {e}")


async def _escalate_one_task(conn, tid, t, cfg, mult):
    speed = mult if t["priority"] == "critical" else 1.0
    esc = await conn.fetchrow(
        """INSERT INTO task_escalations (tenant_id, task_id)
           VALUES ($1,$2) ON CONFLICT (tenant_id, task_id) DO UPDATE SET tenant_id=EXCLUDED.tenant_id
           RETURNING *""",
        tid, t["id"],
    )
    hours_overdue = (datetime.now(timezone.utc) - t["due_at"]).total_seconds() / 3600
    title = f"Overdue follow-up: {t['title']}"
    body = f"Due {t['due_at'].strftime('%d %b %Y %H:%M')} — {t.get('follow_up_reason') or t.get('description') or 'no notes'}"

    if esc["tier1_fired_at"] is None and hours_overdue >= cfg["tier1_grace_hours"] * speed:
        if t["recruiter_id"]:
            await _reminder_notify(conn, tid, t["recruiter_id"], title, body, "recruiter_task", str(t["id"]), "warning")
        await conn.execute("UPDATE task_escalations SET tier1_fired_at=now() WHERE id=$1", esc["id"])
        return

    if esc["tier1_fired_at"] and esc["tier2_fired_at"] is None and hours_overdue >= cfg["tier2_grace_hours"] * speed:
        if t["reporting_to"]:
            await _reminder_notify(conn, tid, t["reporting_to"],
                                    f"[Escalation] {title}", f"Unresolved {hours_overdue:.0f}h. {body}",
                                    "recruiter_task", str(t["id"]), "warning")
        await conn.execute("UPDATE task_escalations SET tier2_fired_at=now() WHERE id=$1", esc["id"])
        return

    if esc["tier2_fired_at"] and esc["tier3_fired_at"] is None and hours_overdue >= cfg["tier3_grace_hours"] * speed:
        if t["client_id"]:
            owners = await conn.fetch(
                """SELECT user_id FROM client_owners
                   WHERE tenant_id=$1 AND client_id=$2 AND is_active
                     AND owner_type IN ('kae','account_manager')""",
                tid, t["client_id"],
            )
            for o in owners:
                await _reminder_notify(conn, tid, o["user_id"],
                                        f"[Escalation] {title}", f"Unresolved {hours_overdue:.0f}h, client follow-up. {body}",
                                        "recruiter_task", str(t["id"]), "critical")
        await conn.execute("UPDATE task_escalations SET tier3_fired_at=now() WHERE id=$1", esc["id"])
        return

    if esc["tier3_fired_at"] and esc["tier4_fired_at"] is None and hours_overdue >= cfg["tier4_grace_hours"] * speed:
        admins = await conn.fetch("SELECT id FROM users WHERE tenant_id=$1 AND role IN ('admin','super_admin') AND is_active", tid)
        for a in admins:
            await _reminder_notify(conn, tid, a["id"],
                                    f"[Critical Escalation] {title}", f"Unresolved {hours_overdue:.0f}h — no action taken. {body}",
                                    "recruiter_task", str(t["id"]), "critical")
        await conn.execute("UPDATE task_escalations SET tier4_fired_at=now() WHERE id=$1", esc["id"])


async def process_reminder_sends():
    """Every 15 min: fires the pre-due reminder_at notification for a
    follow-up task (distinct from escalation, which only fires AFTER a
    task is already overdue). One-shot per task via reminder_sent_at."""
    logger.info("scheduler: processing task reminders")
    try:
        async with db.system_conn() as sconn:
            tenant_ids = [str(r["id"]) for r in await sconn.fetch("SELECT id FROM tenants")]
        for tid in tenant_ids:
            try:
                async with db.tenant_conn(tid) as conn:
                    due = await conn.fetch(
                        """SELECT * FROM recruiter_tasks
                           WHERE tenant_id=$1 AND status IN ('pending','in_progress')
                             AND reminder_at IS NOT NULL AND reminder_at <= now()
                             AND reminder_sent_at IS NULL""",
                        tid,
                    )
                    for t in due:
                        try:
                            async with conn.transaction():
                                if t["recruiter_id"]:
                                    body = f"Due {t['due_at'].strftime('%d %b %Y %H:%M') if t['due_at'] else 'soon'} — {t.get('follow_up_reason') or t.get('description') or ''}"
                                    await _reminder_notify(conn, tid, t["recruiter_id"], f"Reminder: {t['title']}", body,
                                                            "recruiter_task", str(t["id"]),
                                                            "critical" if t["priority"] == "critical" else "info")
                                await conn.execute("UPDATE recruiter_tasks SET reminder_sent_at=now() WHERE id=$1", t["id"])
                        except Exception as e:
                            logger.warning(f"Reminder send failed for task {t['id']}: {e}")
            except Exception as e:
                logger.error(f"Reminder processing failed for tenant {tid}: {e}")
    except Exception as e:
        logger.error(f"process_reminder_sends error: {e}")


async def process_document_expiry_alerts():
    """Daily 06:00 IST: 90/30/7/1-day tiered alerts for any tracked
    document (NDA/contract/visa/certification/offer_letter/kyc) approaching
    expiry. Zero-token, pure date-math — no AI call needed for "is this
    document expiring soon"."""
    logger.info("scheduler: processing document expiry alerts")
    try:
        async with db.system_conn() as sconn:
            tenant_ids = [str(r["id"]) for r in await sconn.fetch("SELECT id FROM tenants")]
        today = date.today()
        for tid in tenant_ids:
            try:
                async with db.tenant_conn(tid) as conn:
                    docs = await conn.fetch(
                        """SELECT d.*, c.full_name AS candidate_name
                           FROM document_expiry_tracking d
                           LEFT JOIN candidates c ON c.id = d.candidate_id
                           WHERE d.tenant_id=$1 AND d.status='active'
                             AND d.expires_at >= $2 AND d.expires_at <= $2 + INTERVAL '90 days'""",
                        tid, today,
                    )
                    admins = None
                    for d in docs:
                        days_left = (d["expires_at"] - today).days
                        tier = None
                        if days_left <= 1 and d["alert_1d_sent_at"] is None:
                            tier = ("alert_1d_sent_at", 1)
                        elif days_left <= 7 and d["alert_7d_sent_at"] is None:
                            tier = ("alert_7d_sent_at", 7)
                        elif days_left <= 30 and d["alert_30d_sent_at"] is None:
                            tier = ("alert_30d_sent_at", 30)
                        elif days_left <= 90 and d["alert_90d_sent_at"] is None:
                            tier = ("alert_90d_sent_at", 90)
                        if not tier:
                            continue
                        try:
                            async with conn.transaction():
                                if admins is None:
                                    admins = await conn.fetch(
                                        "SELECT id FROM users WHERE tenant_id=$1 AND role IN ('admin','manager','hr_manager') AND is_active",
                                        tid,
                                    )
                                title = f"{d['document_type'].upper()} expiring in {days_left}d — {d['candidate_name'] or d['document_name']}"
                                for a in admins:
                                    await _reminder_notify(conn, tid, a["id"], title, d["document_name"],
                                                            "document_expiry", str(d["id"]),
                                                            "critical" if days_left <= 7 else "warning")
                                await conn.execute(
                                    f"UPDATE document_expiry_tracking SET {tier[0]}=now() WHERE id=$1", d["id"])
                        except Exception as e:
                            logger.warning(f"Document expiry alert failed for {d['id']}: {e}")
                    await conn.execute(
                        "UPDATE document_expiry_tracking SET status='expired', updated_at=now() WHERE tenant_id=$1 AND status='active' AND expires_at < $2",
                        tid, today,
                    )
            except Exception as e:
                logger.error(f"Document expiry processing failed for tenant {tid}: {e}")
    except Exception as e:
        logger.error(f"process_document_expiry_alerts error: {e}")


async def process_configurable_interview_reminders():
    """Every 15 min: multi-lead-time interview reminders (candidate +
    interviewer), tenant-configurable via interview_reminder_config
    (default 24h/2h/30min) — additive to, not a replacement for, the
    existing daily-8am send_interview_reminders() email job below, which
    stays untouched. interview_reminder_log's unique constraint makes
    this naturally idempotent across ticks."""
    logger.info("scheduler: processing configurable interview reminders")
    try:
        async with db.system_conn() as sconn:
            tenant_ids = [str(r["id"]) for r in await sconn.fetch("SELECT id FROM tenants")]
        for tid in tenant_ids:
            try:
                async with db.tenant_conn(tid) as conn:
                    cfg = await conn.fetchrow("SELECT lead_times_hours FROM interview_reminder_config WHERE tenant_id=$1", tid)
                    lead_times = list(cfg["lead_times_hours"]) if cfg else [24, 2, 0.5]
                    for lead in lead_times:
                        interviews = await conn.fetch(
                            """SELECT i.*, c.full_name AS candidate_name, u.full_name AS interviewer_name
                               FROM interview_schedules i
                               LEFT JOIN candidates c ON c.id = i.candidate_id
                               LEFT JOIN users u ON u.id = i.interviewer_id
                               WHERE i.tenant_id=$1 AND i.status='scheduled'
                                 AND i.scheduled_at BETWEEN now() AND now() + ($2::text || ' hours')::interval
                                 AND NOT EXISTS (
                                   SELECT 1 FROM interview_reminder_log l
                                   WHERE l.tenant_id=$1 AND l.interview_id=i.id AND l.lead_time_hours=$3)""",
                            tid, str(lead), lead,
                        )
                        for i in interviews:
                            try:
                                async with conn.transaction():
                                    when = f"{lead}h" if lead >= 1 else f"{int(lead*60)}min"
                                    title = f"Interview in {when}: {i['candidate_name'] or 'Candidate'}"
                                    body = f"{i['interview_type']} at {i['scheduled_at'].strftime('%d %b %H:%M')}"
                                    if i["interviewer_id"]:
                                        await _reminder_notify(conn, tid, i["interviewer_id"], title, body,
                                                                "interview", str(i["id"]), "warning")
                                    await conn.execute(
                                        "INSERT INTO interview_reminder_log (tenant_id, interview_id, lead_time_hours) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
                                        tid, i["id"], lead,
                                    )
                            except Exception as e:
                                logger.warning(f"Interview reminder failed for {i['id']}: {e}")
            except Exception as e:
                logger.error(f"Interview reminder processing failed for tenant {tid}: {e}")
    except Exception as e:
        logger.error(f"process_configurable_interview_reminders error: {e}")


async def _create_ai_task(conn, tid, recruiter_id, requisition_id, application_id, title, description, reason, priority="medium"):
    """Shared insert for every AI-suggested signal below — one real
    recruiter_task (ai_suggested=true), same task list/dashboard/
    escalation machinery as any manually-created one."""
    await conn.execute(
        """INSERT INTO recruiter_tasks
             (tenant_id, recruiter_id, requisition_id, application_id, task_type,
              title, description, follow_up_reason, priority, due_at, status, ai_suggested)
           VALUES ($1,$2,$3,$4,'general',$5,$6,$7,$8, now() + INTERVAL '1 day', 'pending', true)""",
        tid, recruiter_id, requisition_id, application_id, title, description, reason, priority,
    )


async def generate_ai_suggested_reminders():
    """Daily 07:00 IST: zero-token, rule-based (no LLM call — HARD RULE #1)
    "AI-suggested" follow-up tasks from 4 real signals already computed
    elsewhere in this codebase — creates a real recruiter_task
    (ai_suggested=true) per signal rather than a separate "suggestion"
    concept, so it shows up in the exact same task list/dashboard/
    escalation machinery everything else does — a suggestion a recruiter
    ignores escalates exactly like a manually-created one would.

    Phase 2: widened from 1 signal (candidate staleness) to 4, matching
    4 of the spec's named examples with a genuine, already-existing data
    source each — deliberately still not all 6 named in the original
    spec (client-response-time has no tracked "client replied" timestamp
    anywhere in this schema to key off, so that one signal stays
    unbuilt rather than faked from a proxy)."""
    logger.info("scheduler: generating AI-suggested follow-up reminders")
    try:
        async with db.system_conn() as sconn:
            tenant_ids = [str(r["id"]) for r in await sconn.fetch("SELECT id FROM tenants")]
        for tid in tenant_ids:
            try:
                async with db.tenant_conn(tid) as conn:
                    # Signal 1: candidate untouched 5+ days in an active stage.
                    stale = await conn.fetch(
                        """SELECT a.id AS application_id, a.candidate_id, a.requisition_id,
                                  a.assigned_recruiter_id, c.full_name, a.updated_at
                           FROM applications a
                           JOIN candidates c ON c.id = a.candidate_id
                           WHERE a.tenant_id=$1 AND a.is_active IS NOT FALSE AND c.is_active IS NOT FALSE
                             AND a.stage NOT IN ('placed','rejected','offer_accepted')
                             AND a.assigned_recruiter_id IS NOT NULL
                             AND a.updated_at < now() - INTERVAL '5 days'
                             AND NOT EXISTS (
                               SELECT 1 FROM recruiter_tasks t
                               WHERE t.tenant_id=$1 AND t.application_id=a.id AND t.ai_suggested
                                 AND t.status IN ('pending','in_progress')
                                 AND t.created_at > a.updated_at)""",
                        tid,
                    )
                    for s in stale:
                        try:
                            days = (datetime.now(timezone.utc) - s["updated_at"]).days
                            async with conn.transaction():
                                await _create_ai_task(
                                    conn, tid, s["assigned_recruiter_id"], s["requisition_id"], s["application_id"],
                                    f"Follow up: {s['full_name']}",
                                    f"AI-suggested — no activity for {days} days.",
                                    f"Candidate not contacted for {days} days.",
                                )
                        except Exception as e:
                            logger.warning(f"AI-suggested (staleness) reminder failed for application {s['application_id']}: {e}")

                    # Signal 2: offer stuck pre-issue (draft/pending_approval/approved)
                    # 3+ days — the recruiter/approver most likely just forgot it.
                    stuck_offers = await conn.fetch(
                        """SELECT o.id AS offer_id, o.application_id, o.status, o.created_at,
                                  a.requisition_id, a.assigned_recruiter_id, c.full_name
                           FROM offers o
                           JOIN applications a ON a.id = o.application_id
                           JOIN candidates c ON c.id = a.candidate_id
                           WHERE o.tenant_id=$1 AND a.is_active IS NOT FALSE AND c.is_active IS NOT FALSE
                             AND o.status IN ('draft','pending_approval','approved')
                             AND o.created_at < now() - INTERVAL '3 days'
                             AND NOT EXISTS (
                               SELECT 1 FROM recruiter_tasks t
                               WHERE t.tenant_id=$1 AND t.application_id=a.id AND t.ai_suggested
                                 AND t.status IN ('pending','in_progress')
                                 AND t.follow_up_reason LIKE 'Offer stuck%')""",
                        tid,
                    )
                    for o in stuck_offers:
                        try:
                            days = (datetime.now(timezone.utc) - o["created_at"]).days
                            async with conn.transaction():
                                await _create_ai_task(
                                    conn, tid, o["assigned_recruiter_id"], o["requisition_id"], o["application_id"],
                                    f"Offer delayed: {o['full_name']}",
                                    f"AI-suggested — offer has sat in '{o['status']}' for {days} days without moving forward.",
                                    f"Offer stuck at '{o['status']}' for {days} days.",
                                    priority="high",
                                )
                        except Exception as e:
                            logger.warning(f"AI-suggested (offer delay) reminder failed for offer {o['offer_id']}: {e}")

                    # Signal 3: interview completed 2+ days ago, no feedback/rating
                    # captured yet — blocks the next pipeline decision.
                    pending_feedback = await conn.fetch(
                        """SELECT i.id AS interview_id, i.application_id, i.interviewer_id, i.scheduled_at,
                                  a.requisition_id, a.assigned_recruiter_id, c.full_name
                           FROM interview_schedules i
                           JOIN applications a ON a.id = i.application_id
                           JOIN candidates c ON c.id = a.candidate_id
                           WHERE i.tenant_id=$1 AND a.is_active IS NOT FALSE AND c.is_active IS NOT FALSE
                             AND i.status = 'completed'
                             AND (i.feedback IS NULL OR i.feedback = '') AND i.rating IS NULL
                             AND i.scheduled_at < now() - INTERVAL '2 days'
                             AND NOT EXISTS (
                               SELECT 1 FROM recruiter_tasks t
                               WHERE t.tenant_id=$1 AND t.application_id=a.id AND t.ai_suggested
                                 AND t.status IN ('pending','in_progress')
                                 AND t.follow_up_reason LIKE 'Interview feedback%')""",
                        tid,
                    )
                    for f in pending_feedback:
                        try:
                            days = (datetime.now(timezone.utc) - f["scheduled_at"]).days
                            recruiter = f["interviewer_id"] or f["assigned_recruiter_id"]
                            async with conn.transaction():
                                await _create_ai_task(
                                    conn, tid, recruiter, f["requisition_id"], f["application_id"],
                                    f"Feedback pending: {f['full_name']}",
                                    f"AI-suggested — interview completed {days} days ago with no feedback/rating captured.",
                                    f"Interview feedback missing for {days} days.",
                                    priority="high",
                                )
                        except Exception as e:
                            logger.warning(f"AI-suggested (interview feedback) reminder failed for interview {f['interview_id']}: {e}")

                    # Signal 4: candidate reached offer_accepted 3+ days ago with no
                    # NDA on file at all — a real, common pre-onboarding gap.
                    missing_docs = await conn.fetch(
                        """SELECT a.id AS application_id, a.candidate_id, a.requisition_id,
                                  a.assigned_recruiter_id, c.full_name, a.updated_at
                           FROM applications a
                           JOIN candidates c ON c.id = a.candidate_id
                           WHERE a.tenant_id=$1 AND a.is_active IS NOT FALSE AND c.is_active IS NOT FALSE
                             AND a.stage = 'offer_accepted'
                             AND a.updated_at < now() - INTERVAL '3 days'
                             AND NOT EXISTS (SELECT 1 FROM nda_documents n WHERE n.tenant_id=$1 AND n.application_id=a.id)
                             AND NOT EXISTS (
                               SELECT 1 FROM recruiter_tasks t
                               WHERE t.tenant_id=$1 AND t.application_id=a.id AND t.ai_suggested
                                 AND t.status IN ('pending','in_progress')
                                 AND t.follow_up_reason LIKE 'NDA/document%')""",
                        tid,
                    )
                    for m in missing_docs:
                        try:
                            days = (datetime.now(timezone.utc) - m["updated_at"]).days
                            async with conn.transaction():
                                await _create_ai_task(
                                    conn, tid, m["assigned_recruiter_id"], m["requisition_id"], m["application_id"],
                                    f"Missing NDA: {m['full_name']}",
                                    f"AI-suggested — offer accepted {days} days ago, no NDA document on file yet.",
                                    f"NDA/document missing {days} days after offer acceptance.",
                                    priority="high",
                                )
                        except Exception as e:
                            logger.warning(f"AI-suggested (missing document) reminder failed for application {m['application_id']}: {e}")
            except Exception as e:
                logger.error(f"AI-suggested reminders failed for tenant {tid}: {e}")
    except Exception as e:
        logger.error(f"generate_ai_suggested_reminders error: {e}")


async def send_interview_reminders():
    """Daily 8am: email candidates with interviews in the next 24 hours."""
    logger.info("scheduler: sending interview reminders")
    import smtplib, asyncpg, os as _os
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    try:
        async with db.system_conn() as conn:
            # BUG FIX (2026-08-10 audit): `tenants` has no `is_active` column
            # at all (confirmed: id, name, slug, created_at,
            # permission_enforcement_enabled) — this WHERE clause raised
            # `column "is_active" does not exist` on every single run since
            # this job was written, caught by the outer try/except below and
            # silently logged, meaning this cron has never once reached the
            # per-tenant loop. Every other scheduler job queries tenants with
            # a bare `SELECT id FROM tenants` (see process_retention_bank_
            # releases, check_loyalty_milestones, etc.) — matched here.
            tenants = await conn.fetch("SELECT id FROM tenants")
        for tenant in tenants:
            tid = str(tenant["id"])
            try:
                async with db.tenant_conn(tid) as conn:
                    rows = await conn.fetch("""
                        SELECT i.id, i.interview_type, i.scheduled_at, i.duration_mins,
                               i.mode, i.meeting_link, i.location, i.notes,
                               c.full_name AS candidate_name, c.email AS candidate_email,
                               u.full_name AS interviewer_name, u.email AS interviewer_email
                        FROM interview_schedules i
                        JOIN candidates c ON c.id=i.candidate_id
                        LEFT JOIN users u ON u.id=i.interviewer_id
                        WHERE i.tenant_id=$1
                          AND i.status='scheduled'
                          AND i.reminder_sent_at IS NULL
                          AND i.scheduled_at BETWEEN now() AND now() + INTERVAL '24 hours'
                    """, tid)
                    if not rows:
                        continue
                    # Two more dead automation_workflows rows closed here
                    # (2026-08-10 audit item 4) — this cron is the one real,
                    # existing "interview reminder" trigger point in the
                    # codebase, so both the candidate-facing and recruiter-
                    # facing n8n reminders fire from here rather than
                    # inventing a second job. Fired independent of whether
                    # SMTP is configured for this tenant (the email below can
                    # legitimately be skipped; the n8n reminder shouldn't be
                    # held hostage to that). Bounded, tolerated risk of one
                    # duplicate fire if this tenant has no SMTP configured —
                    # reminder_sent_at (the real dedup guard) is only set
                    # once the email step below succeeds, and this is a
                    # low-stakes notification, not a HARD RULE #10 action.
                    for iv in rows:
                        payload_base = {
                            "interview_id": str(iv["id"]), "interview_type": iv["interview_type"],
                            "scheduled_at": iv["scheduled_at"].isoformat(), "mode": iv["mode"],
                            "candidate_name": iv["candidate_name"],
                        }
                        if iv["candidate_email"]:
                            ok = await _notify_n8n("interview-reminder-candidate",
                                {**payload_base, "candidate_email": iv["candidate_email"]})
                            if ok:
                                await conn.execute(
                                    "UPDATE automation_workflows SET last_fired_at=now(), fire_count=fire_count+1 "
                                    "WHERE tenant_id=$1 AND webhook_path='interview-reminder-candidate'", tid)
                        if iv["interviewer_email"]:
                            ok = await _notify_n8n("interview-reminder-recruiter",
                                {**payload_base, "interviewer_name": iv["interviewer_name"],
                                 "interviewer_email": iv["interviewer_email"]})
                            if ok:
                                await conn.execute(
                                    "UPDATE automation_workflows SET last_fired_at=now(), fire_count=fire_count+1 "
                                    "WHERE tenant_id=$1 AND webhook_path='interview-reminder-recruiter'", tid)
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


async def process_duplicate_scan():
    """Daily 03:30 IST: run the P35 duplicate-candidate scan for every
    tenant. BUG FIX (2026-08-10 audit) — the scan was manual-button-only
    (POST /duplicates/scan), so the list only ever reflected whoever last
    remembered to click it. Same email/phone matching logic as the manual
    endpoint, just run on a schedule instead of requiring a human trigger.
    """
    logger.info("scheduler: running duplicate-candidate scan")
    try:
        async with db.system_conn() as conn:
            tenant_ids = [str(r["id"]) for r in await conn.fetch("SELECT id FROM tenants")]
        for tid in tenant_ids:
            try:
                async with db.tenant_conn(tid) as conn:
                    email_dups = await conn.fetch("""
                        SELECT c1.id AS id1, c2.id AS id2, 'email' AS field
                        FROM candidates c1
                        JOIN candidates c2 ON c1.email=c2.email
                          AND c1.id < c2.id AND c2.tenant_id=c1.tenant_id
                        WHERE c1.tenant_id=$1 AND c1.email IS NOT NULL
                          AND c1.is_active IS NOT FALSE AND c2.is_active IS NOT FALSE
                    """, tid)
                    phone_dups = await conn.fetch("""
                        SELECT c1.id AS id1, c2.id AS id2, 'phone' AS field
                        FROM candidates c1
                        JOIN candidates c2 ON c1.phone=c2.phone
                          AND c1.id < c2.id AND c2.tenant_id=c1.tenant_id
                        WHERE c1.tenant_id=$1 AND c1.phone IS NOT NULL AND c1.phone != ''
                          AND c1.is_active IS NOT FALSE AND c2.is_active IS NOT FALSE
                    """, tid)
                    inserted = 0
                    for row in list(email_dups) + list(phone_dups):
                        result = await conn.execute("""
                            INSERT INTO duplicate_candidates
                              (tenant_id,candidate_id_1,candidate_id_2,match_field)
                            VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING
                        """, tid, row["id1"], row["id2"], row["field"])
                        if result and result.endswith(" 1"):
                            inserted += 1
                    if inserted:
                        logger.info(f"Duplicate scan: {inserted} new pairs for tenant {tid}")
            except Exception as e:
                logger.error(f"Duplicate scan failed for tenant {tid}: {e}")
    except Exception as e:
        logger.error(f"process_duplicate_scan error: {e}")


async def fill_missing_embeddings():
    """Every 10 min: computes resume_embedding / jd_embedding (BGE-small,
    vector(384), Tier 1 of the zero-token cascade) for any candidate or
    requisition that doesn't have one yet.

    REAL GAP FOUND 2026-08-20: `embed_writer.py` (the script that fills
    these two columns) was never wired into scheduler.py, docker-compose,
    or any crontab — it only ever ran when someone manually typed
    `docker compose exec backend python embed_writer.py`. Confirmed live:
    3 of 4 real requisitions had a jd_embedding, the 4th (created that
    same day) did not — meaning any candidate or requisition created
    since the last manual run silently had NO real semantic signal in
    match_candidates()/match-open-jobs, just the keyword-overlap half of
    the fit_score formula (cosine_similarity always computed to 0 via the
    function's own COALESCE fallback, not an error). Found while building
    the Jobs & Requisitions list's new on-demand "Find AI Matches" button
    — that button calls match_candidates() directly, so it would have
    silently shipped as "AI Match" in name only for any freshly-posted
    job. Reuses embed_writer.py's exact same fill logic, just through
    ai_router.embed_text() (the shared Tier-1 embed entry point, same
    HARD RULE #3/#4 module every other embed call in the app already
    goes through) and this file's own established per-tenant
    system_conn()/tenant_conn() pattern instead of a standalone asyncpg
    pool. Capped at 50 rows per type per tenant per tick so a large
    backlog can't block one scheduler tick for long — the next tick
    picks up where this one left off. One candidate/requisition failing
    to embed (a transient embed-service hiccup, e.g.) never blocks the
    rest of the batch or the next tenant.
    """
    logger.info("scheduler: filling missing resume/JD embeddings")
    try:
        async with db.system_conn() as conn:
            tenant_ids = [str(r["id"]) for r in await conn.fetch("SELECT id FROM tenants")]
        total_cand = total_req = 0
        for tid in tenant_ids:
            try:
                async with db.tenant_conn(tid) as conn:
                    cand_rows = await conn.fetch(
                        "SELECT id, resume_text FROM candidates "
                        "WHERE resume_embedding IS NULL AND resume_text IS NOT NULL "
                        "AND is_active IS NOT FALSE ORDER BY created_at DESC LIMIT 50")
                    for r in cand_rows:
                        try:
                            vec = await ai_router.embed_text(r["resume_text"])
                            await conn.execute(
                                "UPDATE candidates SET resume_embedding=$1::vector WHERE id=$2",
                                ai_router._vector_literal(vec), r["id"])
                            total_cand += 1
                        except Exception as e:
                            logger.error(f"embed fill failed for candidate {r['id']}: {e}")

                    req_rows = await conn.fetch(
                        "SELECT id, title, description, skills_required FROM requisitions "
                        "WHERE jd_embedding IS NULL AND is_active IS NOT FALSE "
                        "ORDER BY created_at DESC LIMIT 50")
                    for r in req_rows:
                        try:
                            text = (f"{r['title']}. {r['description'] or ''} Skills: "
                                    f"{', '.join(r['skills_required'] or [])}.")
                            vec = await ai_router.embed_text(text)
                            await conn.execute(
                                "UPDATE requisitions SET jd_embedding=$1::vector WHERE id=$2",
                                ai_router._vector_literal(vec), r["id"])
                            total_req += 1
                        except Exception as e:
                            logger.error(f"embed fill failed for requisition {r['id']}: {e}")
            except Exception as e:
                logger.error(f"embed fill failed for tenant {tid}: {e}")
        if total_cand or total_req:
            logger.info(f"scheduler: embedded {total_cand} candidates, {total_req} requisitions")
    except Exception as e:
        logger.error(f"fill_missing_embeddings error: {e}")


async def process_ownership_expiry():
    """Daily 04:00 IST: flip candidate_ownership.status from 'active' to
    'expired' for locks past their 30-day window (2026-08-11, individual
    recruiter ownership). Not strictly required for correctness — every
    real check already compares ownership_expires_at live — but keeps
    `status` queryable without a date comparison in every list/filter
    query, and writes the matching history row so an expiry is visible
    in a candidate's ownership timeline even if nobody re-claims it."""
    logger.info("scheduler: expiring lapsed candidate ownership locks")
    try:
        async with db.system_conn() as conn:
            tenant_ids = [str(r["id"]) for r in await conn.fetch("SELECT id FROM tenants")]
        for tid in tenant_ids:
            try:
                async with db.tenant_conn(tid) as conn:
                    lapsed = await conn.fetch(
                        """SELECT candidate_id, recruiter_id, recruiter_email, source
                           FROM candidate_ownership
                           WHERE tenant_id=$1 AND status='active' AND ownership_expires_at < now()""",
                        tid,
                    )
                    for row in lapsed:
                        await conn.execute(
                            "UPDATE candidate_ownership SET status='expired', updated_at=now() "
                            "WHERE tenant_id=$1 AND candidate_id=$2",
                            tid, row["candidate_id"],
                        )
                        await conn.execute(
                            """INSERT INTO candidate_ownership_history
                               (tenant_id, candidate_id, recruiter_id, recruiter_email, action, source)
                               VALUES ($1,$2,$3,$4,'expired',$5)""",
                            tid, row["candidate_id"], row["recruiter_id"], row["recruiter_email"], row["source"],
                        )
                    if lapsed:
                        logger.info(f"Ownership expiry: {len(lapsed)} lock(s) expired for tenant {tid}")
            except Exception as e:
                logger.error(f"Ownership expiry failed for tenant {tid}: {e}")
    except Exception as e:
        logger.error(f"process_ownership_expiry error: {e}")


async def flag_leave_conflicting_assignments():
    """Daily 04:15 IST (2026-08-24, Assignment Dashboard research pass):
    recruiter_leave already correctly excludes someone from NEW auto-
    assign scoring while on leave — but going on leave has always had
    zero effect on assignments they ALREADY hold. A recruiter with 5
    active assignments who goes on leave tomorrow previously left those
    5 requisitions silently unattended, with nothing flagging it. Real,
    industry-named pattern: staffing "desk" coverage requires knowing
    when a desk goes uncovered, not silently ignoring it.

    Deliberately does NOT auto-reassign — that's a real decision a
    manager should make (who covers, if anyone), not something this job
    should do unilaterally. It flags: one real in-app notification to
    the recruiter's manager (reporting_to) — or a tenant-wide 'manager'
    role broadcast if reporting_to is unset — per real, currently-in-
    conflict leave record, using conflict_notified_at as a one-time-only
    dedup marker so a 10-day leave with 3 active assignments doesn't
    re-notify daily for its whole duration."""
    logger.info("scheduler: checking for recruiter leave vs active-assignment conflicts")
    try:
        async with db.system_conn() as conn:
            tenant_ids = [str(r["id"]) for r in await conn.fetch("SELECT id FROM tenants")]
        for tid in tenant_ids:
            try:
                async with db.tenant_conn(tid) as conn:
                    conflicts = await conn.fetch(
                        """SELECT rl.id AS leave_id, rl.recruiter_id, rl.start_date, rl.end_date, rl.leave_type,
                                  u.full_name AS recruiter_name, u.reporting_to,
                                  COUNT(a.id) AS active_assignment_count
                           FROM recruiter_leave rl
                           JOIN users u ON u.id = rl.recruiter_id
                           JOIN assignments a ON a.recruiter_id = rl.recruiter_id AND a.status = 'active'
                           JOIN requisitions r ON r.id = a.requisition_id AND r.is_active IS NOT FALSE
                           WHERE rl.tenant_id = $1 AND rl.conflict_notified_at IS NULL
                             AND now()::date BETWEEN rl.start_date AND rl.end_date
                           GROUP BY rl.id, rl.recruiter_id, rl.start_date, rl.end_date, rl.leave_type,
                                    u.full_name, u.reporting_to""",
                        tid,
                    )
                    for c in conflicts:
                        title = f"{c['recruiter_name']} is on leave with {c['active_assignment_count']} active assignment(s)"
                        body = (f"{c['leave_type']} leave {c['start_date']}–{c['end_date']}. "
                                f"{c['active_assignment_count']} requisition(s) currently assigned to them have no coverage plan.")
                        if c["reporting_to"]:
                            await conn.execute(
                                """INSERT INTO notifications (tenant_id, user_id, recipient_user_id, title, body, type, resource, resource_id, channel)
                                   VALUES ($1,$2,$2,$3,$4,'warning','recruiter_leave',$5,'inapp')""",
                                tid, c["reporting_to"], title, body, str(c["recruiter_id"]),
                            )
                        else:
                            await conn.execute(
                                """INSERT INTO notifications (tenant_id, recipient_role, title, body, type, resource, resource_id, channel)
                                   VALUES ($1,'manager',$2,$3,'warning','recruiter_leave',$4,'inapp')""",
                                tid, title, body, str(c["recruiter_id"]),
                            )
                        await conn.execute(
                            "UPDATE recruiter_leave SET conflict_notified_at = now() WHERE id = $1", c["leave_id"],
                        )
                    if conflicts:
                        logger.info(f"Leave-conflict flagging: {len(conflicts)} conflict(s) notified for tenant {tid}")
            except Exception as e:
                logger.error(f"Leave-conflict flagging failed for tenant {tid}: {e}")
    except Exception as e:
        logger.error(f"flag_leave_conflicting_assignments error: {e}")


_PRODUCTIVITY_COUNT_COLUMNS = {
    "sourced": "candidates_sourced",
    "screened": "candidates_screened",
    "submitted": "candidates_submitted",
    "offer_generated": "offers_generated",
    "offer_accepted": "offers_accepted",
    "placed": "placements",
}


def _productivity_count_sql(alias: str = "e") -> str:
    """Build the FILTER-based count expressions shared by all 3 aggregation
    granularities. interview completion events are named dynamically
    (f"{interview_type}_completed") to handle custom tenant interview
    rounds, so they're matched by suffix here rather than an exact key —
    same reasoning as the LIKE '%interview%' pattern already used
    elsewhere in this codebase (recruiter_dashboard.my-stats,
    recruiter-performance, v_sla_dashboard) for the same custom-stage
    problem."""
    parts = [
        f"COUNT(*) FILTER (WHERE {alias}.event_type = '{ev}') AS {col}"
        for ev, col in _PRODUCTIVITY_COUNT_COLUMNS.items()
    ]
    parts.append(f"COUNT(*) FILTER (WHERE {alias}.event_type LIKE '%_completed') AS interviews_completed")
    return ",\n          ".join(parts)


async def aggregate_hourly_productivity(compute_hour: datetime | None = None):
    """Roll up the just-completed hour's recruiter_activity_events into
    recruiter_productivity_hourly, plus real device_activity_log active/
    idle minutes for that window when any exist (NULL otherwise — this
    tenant's device monitoring has zero enrolled devices today, so these
    columns are expected to stay NULL until real adoption happens; never
    fabricated to look non-empty)."""
    logger.info("scheduler: aggregating hourly recruiter productivity")
    if compute_hour is None:
        now = datetime.now(timezone.utc)
        compute_hour = (now - timedelta(hours=1)).replace(minute=0, second=0, microsecond=0)
    hour_end = compute_hour + timedelta(hours=1)
    try:
        async with db.system_conn() as conn:
            tenant_ids = [str(r["id"]) for r in await conn.fetch("SELECT id FROM tenants")]
        for tid in tenant_ids:
            try:
                async with db.tenant_conn(tid) as conn:
                    rows = await conn.fetch(f"""
                        SELECT e.recruiter_id,
                          {_productivity_count_sql()}
                        FROM recruiter_activity_events e
                        WHERE e.tenant_id=$1 AND e.event_at >= $2 AND e.event_at < $3
                        GROUP BY e.recruiter_id
                    """, tid, compute_hour, hour_end)
                    for r in rows:
                        device = await conn.fetchrow("""
                            SELECT
                              SUM(EXTRACT(EPOCH FROM (ended_at - started_at)) / 60) FILTER (WHERE NOT is_idle) AS active_mins,
                              SUM(EXTRACT(EPOCH FROM (ended_at - started_at)) / 60) FILTER (WHERE is_idle) AS idle_mins
                            FROM device_activity_log
                            WHERE tenant_id=$1 AND user_id=$2 AND started_at >= $3 AND started_at < $4
                        """, tid, r["recruiter_id"], compute_hour, hour_end)
                        active = device["active_mins"] if device else None
                        idle = device["idle_mins"] if device else None
                        prod_pct = None
                        if active is not None and (active + (idle or 0)) > 0:
                            prod_pct = round(100 * float(active) / (float(active) + float(idle or 0)), 2)
                        await conn.execute("""
                            INSERT INTO recruiter_productivity_hourly
                              (tenant_id, recruiter_id, period_start, candidates_sourced, candidates_screened,
                               candidates_submitted, interviews_completed, offers_generated, offers_accepted,
                               placements, active_mins, idle_mins, productivity_pct)
                            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
                            ON CONFLICT (tenant_id, recruiter_id, period_start) DO UPDATE SET
                              candidates_sourced=$4, candidates_screened=$5, candidates_submitted=$6,
                              interviews_completed=$7, offers_generated=$8, offers_accepted=$9, placements=$10,
                              active_mins=$11, idle_mins=$12, productivity_pct=$13, updated_at=now()
                        """, tid, r["recruiter_id"], compute_hour, r["candidates_sourced"], r["candidates_screened"],
                             r["candidates_submitted"], r["interviews_completed"], r["offers_generated"],
                             r["offers_accepted"], r["placements"], active, idle, prod_pct)
            except Exception as e:
                logger.error(f"Hourly productivity aggregation failed for tenant {tid}: {e}")
    except Exception as e:
        logger.error(f"aggregate_hourly_productivity error: {e}")


async def aggregate_daily_from_hourly(compute_date: date | None = None):
    """Sum the day's hourly rows into recruiter_productivity_daily."""
    logger.info("scheduler: aggregating daily recruiter productivity")
    if compute_date is None:
        compute_date = date.today() - timedelta(days=1)
    try:
        async with db.system_conn() as conn:
            tenant_ids = [str(r["id"]) for r in await conn.fetch("SELECT id FROM tenants")]
        for tid in tenant_ids:
            try:
                async with db.tenant_conn(tid) as conn:
                    rows = await conn.fetch("""
                        SELECT recruiter_id,
                          SUM(candidates_sourced) candidates_sourced, SUM(candidates_screened) candidates_screened,
                          SUM(candidates_submitted) candidates_submitted, SUM(interviews_completed) interviews_completed,
                          SUM(offers_generated) offers_generated, SUM(offers_accepted) offers_accepted,
                          SUM(placements) placements, SUM(active_mins) active_mins, SUM(idle_mins) idle_mins
                        FROM recruiter_productivity_hourly
                        WHERE tenant_id=$1 AND period_start::date = $2
                        GROUP BY recruiter_id
                    """, tid, compute_date)
                    for r in rows:
                        active, idle = r["active_mins"], r["idle_mins"]
                        prod_pct = None
                        if active is not None and (float(active) + float(idle or 0)) > 0:
                            prod_pct = round(100 * float(active) / (float(active) + float(idle or 0)), 2)
                        await conn.execute("""
                            INSERT INTO recruiter_productivity_daily
                              (tenant_id, recruiter_id, period_start, candidates_sourced, candidates_screened,
                               candidates_submitted, interviews_completed, offers_generated, offers_accepted,
                               placements, active_mins, idle_mins, productivity_pct)
                            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
                            ON CONFLICT (tenant_id, recruiter_id, period_start) DO UPDATE SET
                              candidates_sourced=$4, candidates_screened=$5, candidates_submitted=$6,
                              interviews_completed=$7, offers_generated=$8, offers_accepted=$9, placements=$10,
                              active_mins=$11, idle_mins=$12, productivity_pct=$13, updated_at=now()
                        """, tid, r["recruiter_id"], compute_date, r["candidates_sourced"], r["candidates_screened"],
                             r["candidates_submitted"], r["interviews_completed"], r["offers_generated"],
                             r["offers_accepted"], r["placements"], active, idle, prod_pct)
            except Exception as e:
                logger.error(f"Daily productivity aggregation failed for tenant {tid}: {e}")
    except Exception as e:
        logger.error(f"aggregate_daily_from_hourly error: {e}")


async def aggregate_weekly_from_daily(week_start: date | None = None):
    """Sum the week's daily rows into recruiter_productivity_weekly."""
    logger.info("scheduler: aggregating weekly recruiter productivity")
    if week_start is None:
        today = date.today()
        week_start = today - timedelta(days=today.weekday() + 7)  # previous ISO week's Monday
    week_end = week_start + timedelta(days=7)
    try:
        async with db.system_conn() as conn:
            tenant_ids = [str(r["id"]) for r in await conn.fetch("SELECT id FROM tenants")]
        for tid in tenant_ids:
            try:
                async with db.tenant_conn(tid) as conn:
                    rows = await conn.fetch("""
                        SELECT recruiter_id,
                          SUM(candidates_sourced) candidates_sourced, SUM(candidates_screened) candidates_screened,
                          SUM(candidates_submitted) candidates_submitted, SUM(interviews_completed) interviews_completed,
                          SUM(offers_generated) offers_generated, SUM(offers_accepted) offers_accepted,
                          SUM(placements) placements, SUM(active_mins) active_mins, SUM(idle_mins) idle_mins
                        FROM recruiter_productivity_daily
                        WHERE tenant_id=$1 AND period_start >= $2 AND period_start < $3
                        GROUP BY recruiter_id
                    """, tid, week_start, week_end)
                    for r in rows:
                        active, idle = r["active_mins"], r["idle_mins"]
                        prod_pct = None
                        if active is not None and (float(active) + float(idle or 0)) > 0:
                            prod_pct = round(100 * float(active) / (float(active) + float(idle or 0)), 2)
                        await conn.execute("""
                            INSERT INTO recruiter_productivity_weekly
                              (tenant_id, recruiter_id, period_start, candidates_sourced, candidates_screened,
                               candidates_submitted, interviews_completed, offers_generated, offers_accepted,
                               placements, active_mins, idle_mins, productivity_pct)
                            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
                            ON CONFLICT (tenant_id, recruiter_id, period_start) DO UPDATE SET
                              candidates_sourced=$4, candidates_screened=$5, candidates_submitted=$6,
                              interviews_completed=$7, offers_generated=$8, offers_accepted=$9, placements=$10,
                              active_mins=$11, idle_mins=$12, productivity_pct=$13, updated_at=now()
                        """, tid, r["recruiter_id"], week_start, r["candidates_sourced"], r["candidates_screened"],
                             r["candidates_submitted"], r["interviews_completed"], r["offers_generated"],
                             r["offers_accepted"], r["placements"], active, idle, prod_pct)
            except Exception as e:
                logger.error(f"Weekly productivity aggregation failed for tenant {tid}: {e}")
    except Exception as e:
        logger.error(f"aggregate_weekly_from_daily error: {e}")


async def compute_recruiter_performance_scores(score_date: date | None = None):
    """Daily, informational activity/performance score (recruiter_performance_
    scores) — deliberately separate from the existing monthly, compensation-
    linked recruiter_kpi_scores. No money is attached to this score; it only
    feeds dashboards/leaderboards. Reads score_weight_config for real,
    tenant-adjustable weights and grade thresholds rather than hardcoding
    either."""
    logger.info("scheduler: computing daily recruiter performance scores")
    if score_date is None:
        score_date = date.today() - timedelta(days=1)
    try:
        async with db.system_conn() as conn:
            tenant_ids = [str(r["id"]) for r in await conn.fetch("SELECT id FROM tenants")]
        for tid in tenant_ids:
            try:
                async with db.tenant_conn(tid) as conn:
                    weights = await conn.fetchrow(
                        "SELECT * FROM score_weight_config WHERE tenant_id=$1", tid)
                    if not weights:
                        continue
                    daily_rows = await conn.fetch(
                        "SELECT * FROM recruiter_productivity_daily WHERE tenant_id=$1 AND period_start=$2",
                        tid, score_date)
                    for d in daily_rows:
                        rid = d["recruiter_id"]
                        # Output: raw funnel-milestone volume this day, capped at 100
                        # via a simple diminishing scale (10 combined milestones = 100).
                        volume = (d["candidates_sourced"] + d["candidates_submitted"]
                                  + d["interviews_completed"] + d["placements"])
                        output_score = min(100.0, volume * 10.0)
                        # Quality: submission -> interview conversion this day.
                        quality_score = (100.0 * d["interviews_completed"] / d["candidates_submitted"]
                                          if d["candidates_submitted"] else None)
                        # Velocity: real avg hours from sourced to first response
                        # today, via recruiter_sla_tracking — faster is better,
                        # scaled against the tenant's own default SLA target.
                        vel = await conn.fetchrow("""
                            SELECT AVG(EXTRACT(EPOCH FROM (first_response_at - sourced_at)) / 3600.0) avg_hours,
                                   AVG(sla_target_hours) avg_target
                            FROM recruiter_sla_tracking
                            WHERE tenant_id=$1 AND recruiter_id=$2 AND sourced_at::date=$3
                              AND first_response_at IS NOT NULL
                        """, tid, rid, score_date)
                        velocity_score = None
                        if vel and vel["avg_hours"] is not None and vel["avg_target"]:
                            velocity_score = max(0.0, min(100.0, 100.0 * (1 - float(vel["avg_hours"]) / (2 * float(vel["avg_target"])))))
                        # Productivity: real device active-time pct when known,
                        # else an activity-volume proxy (never fabricated).
                        productivity_score = float(d["productivity_pct"]) if d["productivity_pct"] is not None else min(100.0, volume * 8.0)
                        # SLA: % of today's sourced candidates whose first
                        # response met the target.
                        sla = await conn.fetchrow("""
                            SELECT COUNT(*) total, COUNT(*) FILTER (WHERE breached IS FALSE) met
                            FROM recruiter_sla_tracking
                            WHERE tenant_id=$1 AND recruiter_id=$2 AND sourced_at::date=$3
                              AND breached IS NOT NULL
                        """, tid, rid, score_date)
                        sla_score = (100.0 * sla["met"] / sla["total"]) if sla and sla["total"] else None
                        # Interview -> offer conversion.
                        interview_conv_score = (100.0 * d["offers_generated"] / d["interviews_completed"]
                                                 if d["interviews_completed"] else None)

                        def _w(val, weight, fallback=50.0):
                            return (val if val is not None else fallback) * float(weight)

                        overall = (
                            _w(output_score, weights["output_weight"])
                            + _w(quality_score, weights["quality_weight"])
                            + _w(velocity_score, weights["velocity_weight"])
                            + _w(productivity_score, weights["productivity_weight"])
                            + _w(sla_score, weights["sla_weight"])
                            + _w(interview_conv_score, weights["interview_conv_weight"])
                        )
                        if overall >= float(weights["grade_a_plus_threshold"]):
                            grade = "A+"
                        elif overall >= float(weights["grade_a_threshold"]):
                            grade = "A"
                        elif overall >= float(weights["grade_b_threshold"]):
                            grade = "B"
                        elif overall >= float(weights["grade_c_threshold"]):
                            grade = "C"
                        else:
                            grade = "D"
                        await conn.execute("""
                            INSERT INTO recruiter_performance_scores
                              (tenant_id, recruiter_id, score_date, output_score, quality_score, velocity_score,
                               productivity_score, sla_score, interview_conv_score, overall_score, grade)
                            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                            ON CONFLICT (tenant_id, recruiter_id, score_date) DO UPDATE SET
                              output_score=$4, quality_score=$5, velocity_score=$6, productivity_score=$7,
                              sla_score=$8, interview_conv_score=$9, overall_score=$10, grade=$11
                        """, tid, rid, score_date, output_score, quality_score, velocity_score,
                             productivity_score, sla_score, interview_conv_score, round(overall, 2), grade)
            except Exception as e:
                logger.error(f"Performance score computation failed for tenant {tid}: {e}")
    except Exception as e:
        logger.error(f"compute_recruiter_performance_scores error: {e}")


async def compute_recruiter_risk_scores(period_start: date | None = None):
    """Weekly burnout/attrition-risk scoring (Time Champ gap-analysis,
    2026-08-11) — distinct from compute_recruiter_performance_scores
    above (which scores output/quality, not risk). Zero-token: pure SQL
    trend analysis on recruiter_productivity_daily, already collected by
    the existing Workforce Intelligence rollups. Multi-signal, not a
    single metric — extended hours vs the recruiter's own baseline,
    declining productivity trend, day-to-day irregularity, and workload
    pressure vs their configured weekly capacity. Requires at least 3
    days of real productivity data in the week to score at all — no
    fabricated score from too little signal (same honesty standard as
    sla_predictions.py's "insufficient training data" path)."""
    logger.info("scheduler: computing weekly recruiter risk scores")
    if period_start is None:
        today = date.today()
        last_monday = today - timedelta(days=today.weekday() + 7)
        period_start = last_monday
    period_end = period_start + timedelta(days=6)
    baseline_start = period_start - timedelta(days=28)
    trend_start = period_start - timedelta(days=14)
    try:
        async with db.system_conn() as conn:
            tenant_ids = [str(r["id"]) for r in await conn.fetch("SELECT id FROM tenants")]
        for tid in tenant_ids:
            try:
                async with db.tenant_conn(tid) as conn:
                    cfg = await conn.fetchrow("SELECT * FROM risk_signal_config WHERE tenant_id=$1", tid)
                    if not cfg:
                        continue
                    recruiters = await conn.fetch(
                        """SELECT DISTINCT recruiter_id FROM recruiter_productivity_daily
                           WHERE tenant_id=$1 AND period_start BETWEEN $2 AND $3""",
                        tid, period_start, period_end)
                    for r in recruiters:
                        rid = r["recruiter_id"]
                        week = await conn.fetchrow(
                            """SELECT AVG(active_mins) avg_active, STDDEV(active_mins) stddev_active,
                                      AVG(productivity_pct) avg_prod, COUNT(*) n_days
                               FROM recruiter_productivity_daily
                               WHERE tenant_id=$1 AND recruiter_id=$2 AND period_start BETWEEN $3 AND $4""",
                            tid, rid, period_start, period_end)
                        if not week or (week["n_days"] or 0) < 3:
                            continue  # not enough real data to score this week honestly

                        baseline = await conn.fetchrow(
                            """SELECT AVG(active_mins) avg_active FROM recruiter_productivity_daily
                               WHERE tenant_id=$1 AND recruiter_id=$2 AND period_start BETWEEN $3 AND $4""",
                            tid, rid, baseline_start, period_start - timedelta(days=1))
                        prior_trend = await conn.fetchrow(
                            """SELECT AVG(productivity_pct) avg_prod FROM recruiter_productivity_daily
                               WHERE tenant_id=$1 AND recruiter_id=$2 AND period_start BETWEEN $3 AND $4""",
                            tid, rid, trend_start, period_start - timedelta(days=1))
                        capacity = await conn.fetchval("SELECT capacity_weekly FROM users WHERE id=$1", rid)
                        open_tasks = await conn.fetchval(
                            "SELECT COUNT(*) FROM recruiter_tasks WHERE tenant_id=$1 AND recruiter_id=$2 AND status NOT IN ('completed','cancelled')",
                            tid, rid)

                        avg_active = float(week["avg_active"] or 0)
                        stddev_active = float(week["stddev_active"] or 0)
                        avg_prod = float(week["avg_prod"]) if week["avg_prod"] is not None else None
                        baseline_active = float(baseline["avg_active"]) if baseline and baseline["avg_active"] is not None else None
                        prior_prod = float(prior_trend["avg_prod"]) if prior_trend and prior_trend["avg_prod"] is not None else None

                        signals: list[str] = []
                        hours_increase_pct = None
                        if baseline_active and baseline_active > 0:
                            hours_increase_pct = (avg_active - baseline_active) / baseline_active * 100
                            if hours_increase_pct >= float(cfg["hours_increase_threshold"]):
                                signals.append("extended_hours")

                        productivity_trend_pct = None
                        if prior_prod and prior_prod > 0 and avg_prod is not None:
                            productivity_trend_pct = (avg_prod - prior_prod) / prior_prod * 100
                            if productivity_trend_pct <= -float(cfg["productivity_drop_threshold"]):
                                signals.append("declining_productivity")

                        activity_variance_score = min(100.0, (stddev_active / avg_active * 100) if avg_active > 0 else 0.0)
                        if activity_variance_score >= 40:
                            signals.append("irregular_pattern")

                        workload_ratio = None
                        if capacity and capacity > 0:
                            workload_ratio = float(open_tasks or 0) / float(capacity)
                            if workload_ratio >= float(cfg["workload_overload_ratio"]):
                                signals.append("overloaded")

                        risk_score = min(100.0, len(signals) * 25.0)
                        risk_level = "high" if risk_score >= 60 else "medium" if risk_score >= 30 else "low"

                        await conn.execute("""
                            INSERT INTO recruiter_risk_scores
                              (tenant_id, recruiter_id, period_start, period_end, avg_active_mins,
                               baseline_active_mins, hours_increase_pct, avg_productivity_pct,
                               productivity_trend_pct, activity_variance_score, workload_ratio,
                               signals, risk_score, risk_level)
                            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
                            ON CONFLICT (tenant_id, recruiter_id, period_start) DO UPDATE SET
                              period_end=$4, avg_active_mins=$5, baseline_active_mins=$6, hours_increase_pct=$7,
                              avg_productivity_pct=$8, productivity_trend_pct=$9, activity_variance_score=$10,
                              workload_ratio=$11, signals=$12, risk_score=$13, risk_level=$14, computed_at=now()
                        """, tid, rid, period_start, period_end, round(avg_active, 2),
                             round(baseline_active, 2) if baseline_active is not None else None,
                             round(hours_increase_pct, 2) if hours_increase_pct is not None else None,
                             round(avg_prod, 2) if avg_prod is not None else None,
                             round(productivity_trend_pct, 2) if productivity_trend_pct is not None else None,
                             round(activity_variance_score, 2), round(workload_ratio, 2) if workload_ratio is not None else None,
                             signals, round(risk_score, 2), risk_level)
            except Exception as e:
                logger.error(f"Risk score computation failed for tenant {tid}: {e}")
    except Exception as e:
        logger.error(f"compute_recruiter_risk_scores error: {e}")


def start_scheduler():
    """Register and start all jobs.

    Cross-worker guard: only the worker that wins _acquire_scheduler_lock()
    actually registers/runs any job — see the module-level comment above.
    """
    if not _acquire_scheduler_lock():
        logger.info("APScheduler: another worker already owns the scheduler lock — skipping registration in this worker")
        return
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
    # Reminder & Follow-Up System (2026-08-21) — 4 new jobs.
    scheduler.add_job(process_task_escalations, "interval", minutes=30,
                      id="task_escalations", replace_existing=True)
    scheduler.add_job(process_reminder_sends, "interval", minutes=15,
                      id="reminder_sends", replace_existing=True)
    scheduler.add_job(process_configurable_interview_reminders, "interval", minutes=15,
                      id="configurable_interview_reminders", replace_existing=True)
    scheduler.add_job(process_document_expiry_alerts, "cron", hour=6, minute=0,
                      id="document_expiry_alerts", replace_existing=True)
    scheduler.add_job(generate_ai_suggested_reminders, "cron", hour=7, minute=0,
                      id="ai_suggested_reminders", replace_existing=True)
    # Every 10 min — real gap found 2026-08-20: fills resume_embedding/
    # jd_embedding (Tier-1 semantic matching) for anything created since
    # the last run of the previously-manual-only embed_writer.py script.
    scheduler.add_job(fill_missing_embeddings, "interval", minutes=10,
                      id="fill_missing_embeddings", replace_existing=True)
    # Daily at 03:00 IST — data-minimization purge for device monitoring
    # (active-window log + browsing history). Consent/device/enrollment
    # rows are kept (they're the audit trail of who agreed to what), only
    # the granular activity data ages out.
    scheduler.add_job(purge_old_device_monitoring_data, "cron", hour=3, minute=0,
                      id="device_monitoring_purge", replace_existing=True)
    # Daily at 03:30 IST — P35 duplicate-candidate scan (2026-08-10 audit
    # fix: was manual-button-only, so the list went stale the moment
    # nobody remembered to click it).
    scheduler.add_job(process_duplicate_scan, "cron", hour=3, minute=30,
                      id="duplicate_scan", replace_existing=True)
    # Daily at 04:00 IST — expire lapsed candidate-ownership locks
    # (2026-08-11 individual recruiter ownership).
    scheduler.add_job(flag_leave_conflicting_assignments, "cron", hour=4, minute=15,
                       id="leave_conflict_flagging", replace_existing=True)
    scheduler.add_job(process_ownership_expiry, "cron", hour=4, minute=0,
                      id="ownership_expiry", replace_existing=True)
    # Workforce Intelligence (2026-08-11): hourly/daily/weekly recruiter
    # activity rollups + daily performance scoring, feeding the Activity
    # tab / Team Leaderboard — deliberately separate from the monthly,
    # compensation-linked recruiter_kpi_scores.
    scheduler.add_job(aggregate_hourly_productivity, "cron", minute=5,
                      id="wi_hourly_productivity", replace_existing=True)
    scheduler.add_job(aggregate_daily_from_hourly, "cron", hour=2, minute=30,
                      id="wi_daily_productivity", replace_existing=True)
    scheduler.add_job(aggregate_weekly_from_daily, "cron", day_of_week="mon", hour=3, minute=15,
                      id="wi_weekly_productivity", replace_existing=True)
    scheduler.add_job(compute_recruiter_performance_scores, "cron", hour=2, minute=45,
                      id="wi_performance_scores", replace_existing=True)
    # Weekly, Monday 03:30 IST — burnout/attrition-risk scoring for the
    # completed prior week (a trend metric, not a daily snapshot).
    scheduler.add_job(compute_recruiter_risk_scores, "cron", day_of_week="mon", hour=3, minute=30,
                      id="recruiter_risk_scores", replace_existing=True)
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
            # Separate, distinct system from the Slack/Teams/Discord webhook
            # above (webhook_integrations) — this is the n8n automation_
            # workflows row of the same name, dead since it was seeded
            # (2026-08-10 audit item 4). Same trigger point, different
            # subscriber.
            try:
                ok = await _notify_n8n("weekly-kpi", {"tenant_id": tid, "week_of": str(date.today())})
                if ok:
                    async with db.tenant_conn(tid) as conn2:
                        await conn2.execute(
                            "UPDATE automation_workflows SET last_fired_at=now(), fire_count=fire_count+1 "
                            "WHERE tenant_id=$1 AND webhook_path='weekly-kpi'", tid)
            except Exception as e:
                logger.warning(f"Weekly KPI n8n webhook failed for tenant {tid}: {e}")
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
