-- WAHA session auto-recovery (2026-09-08 — real incident: 3 WhatsApp
-- sessions sat in SCAN_QR_CODE for days, each keeping a full, persistent
-- headless Chromium process alive, driving hypervisor CPU-steal into the
-- 90%+ range and exhausting Hostinger's burst-CPU reset budget. Found and
-- manually fixed once; this backs the real, automated recovery so it
-- can't silently recur).
--
-- waha_session_health is a plain, global operational-state table, not
-- tenant business data — WAHA itself is one shared, VPS-wide service, not
-- per-tenant — so no RLS here, matching this project's established RLS
-- philosophy (RLS protects tenant data, not internal ops bookkeeping).
--
-- Idempotent, safe to re-run.

CREATE TABLE IF NOT EXISTS waha_session_health (
  session_name        text PRIMARY KEY,
  first_seen_stuck_at  timestamptz,
  last_status           text,
  last_checked_at       timestamptz NOT NULL DEFAULT now(),
  auto_stopped_at       timestamptz
);

-- user_whatsapp_accounts has FORCE ROW LEVEL SECURITY casting
-- app.tenant_id to ::uuid — the scheduler job doesn't know which tenant a
-- given personal session (u_<user_id>) belongs to ahead of time, so this
-- resolves it via the table's own real UNIQUE(waha_session_name)
-- constraint, the same anonymous-token-resolves-tenant SECURITY DEFINER
-- pattern already established repeatedly elsewhere in this project
-- (get_client_portal_token, record_email_open, redeem_referral_click).
-- MUST be run as postgres — SECURITY DEFINER runs with the function
-- owner's privileges, and this needs to bypass RLS to do the lookup.
CREATE OR REPLACE FUNCTION get_whatsapp_account_by_session(p_session_name text)
RETURNS TABLE(tenant_id uuid, user_id uuid, status text)
LANGUAGE sql SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT tenant_id, user_id, status
  FROM user_whatsapp_accounts
  WHERE waha_session_name = p_session_name;
$$;

REVOKE ALL ON FUNCTION get_whatsapp_account_by_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_whatsapp_account_by_session(text) TO app_user;
