-- Fixes a real, confirmed instance of this project's own recurring
-- "missing is_active filter on a joined clients/users table" bug class
-- (v_recruiter_capacity/v_monthly_billing/v_sla_dashboard all leaked
-- cross-tenant/stale data once before; this is the same class, found
-- live in the brand-new Email Management System's SLA view).
--
-- Confirmed live before writing this: 148 of 155 real
-- "outbound, unreplied" candidate_messages joined to a client belonged
-- to an already-soft-deleted (mostly QA-test-fixture) client. The
-- backend query-level fixes (email_reports.py, email_tracking.py) are
-- a separate code change; this migration closes the one instance that
-- lives in the database itself, v_client_email_sla.
CREATE OR REPLACE VIEW v_client_email_sla AS
SELECT
    cm.tenant_id,
    cm.client_id,
    cl.name AS client_name,
    COUNT(*) FILTER (WHERE cm.direction='outbound' AND cm.channel='email') AS emails_sent,
    ROUND(AVG(EXTRACT(EPOCH FROM (cm.replied_at - cm.created_at)) / 3600)
          FILTER (WHERE cm.replied_at IS NOT NULL), 1) AS avg_response_hours,
    ROUND(MIN(EXTRACT(EPOCH FROM (cm.replied_at - cm.created_at)) / 3600)
          FILTER (WHERE cm.replied_at IS NOT NULL), 1) AS fastest_response_hours,
    ROUND(MAX(EXTRACT(EPOCH FROM (now() - cm.created_at)) / 3600)
          FILTER (WHERE cm.replied_at IS NULL AND cm.direction='outbound'), 1) AS longest_pending_hours
FROM candidate_messages cm
JOIN clients cl ON cl.id = cm.client_id AND cl.is_active IS NOT FALSE
WHERE cm.client_id IS NOT NULL AND cm.channel='email' AND cm.is_deleted IS NOT TRUE
GROUP BY cm.tenant_id, cm.client_id, cl.name;

-- CREATE OR REPLACE VIEW does NOT preserve reloptions across a replace
-- (the exact real bug already found and fixed once this project for
-- v_recruiter_capacity/v_monthly_billing/v_sla_dashboard) — must be
-- re-stated explicitly every time this view is replaced, not assumed
-- to survive.
ALTER VIEW v_client_email_sla SET (security_invoker = true);
