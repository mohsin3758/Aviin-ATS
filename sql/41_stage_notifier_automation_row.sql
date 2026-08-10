-- Direct follow-up to the 2026-08-10 audit re-check: the one item flagged
-- as still open after the previous two fix rounds. "AVIIN Stage Notifier"
-- (webhook path aviin-stage-change) is the single most-used real n8n
-- integration in the system - it has genuinely fired 500+ times from
-- applications.py's stage-change background task - but was never a row
-- in automation_workflows, so Settings > Automations had zero visibility
-- into the one thing that actually runs at scale, and it had no
-- fire_count/last_fired_at tracking at all (applications.py's fix in this
-- same pass switches its call site to fire_webhook(), which needs a real
-- row here to update).
--
-- fire_count starts at 0, not backfilled with an invented historical
-- number - the app itself never tracked this webhook's call count before
-- today, only n8n's own internal execution log did (which this table has
-- no access to), so 0 and "starts counting from today" is the honest
-- starting point, same principle as the earlier decision not to fabricate
-- historical approval data for the offer HITL audit-trail backfill.
--
-- Seeded per-tenant (not a single global row) matching every other
-- automation_workflows row's convention. Run as postgres superuser, which
-- bypasses RLS entirely (not just FORCE ROW LEVEL SECURITY, which only
-- binds the table owner/app_user) - a plain cross-tenant INSERT is safe
-- here, no per-tenant app.tenant_id/tenant_conn() dance needed.
INSERT INTO automation_workflows (tenant_id, name, trigger_type, webhook_path, description, is_active)
SELECT t.id, 'AVIIN Stage Notifier', 'application_stage_changed', 'aviin-stage-change',
       'Fires on every application stage change (drag-and-drop, stage buttons, bulk moves). The most-used real n8n integration in the system - was previously untracked here despite genuinely firing hundreds of times.',
       true
FROM tenants t
ON CONFLICT (tenant_id, name) DO NOTHING;
