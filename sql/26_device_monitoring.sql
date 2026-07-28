-- Company-device activity monitoring: scoped down from the original ask
-- (company-issued devices only, no personal/BYOD, no screenshots, no
-- keystroke logging) per explicit user decision after a scope discussion.
-- Transparent by design: a recruiter must consent (device_monitoring_consent)
-- before an enrollment code can be issued, and the agent enrolling requires
-- the recruiter's own login — there is no path for an admin to silently
-- push this onto someone's machine.
--
-- consent_records (HARD RULE #12) is candidate_id-scoped by design (FK to
-- candidates) and can't be reused for employee consent — this is the
-- employee-monitoring equivalent of that same DPDP 2023 consent
-- requirement, kept as its own table rather than widening a working,
-- candidate-specific table.

CREATE TABLE IF NOT EXISTS device_monitoring_consent (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  policy_version TEXT NOT NULL,
  consent_text   TEXT NOT NULL,
  consent_given  BOOLEAN NOT NULL,
  ip_address     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_dmc_tenant_user ON device_monitoring_consent(tenant_id, user_id);

-- Short-lived, single-use codes a logged-in recruiter generates in the web
-- UI and types into the agent on first run. Keeps the agent from ever
-- touching the recruiter's actual ATS password.
CREATE TABLE IF NOT EXISTS device_enrollment_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_enroll_tokens_tenant_user ON device_enrollment_tokens(tenant_id, user_id);

CREATE TABLE IF NOT EXISTS monitored_devices (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hostname           TEXT NOT NULL,
  os                 TEXT,
  device_fingerprint TEXT NOT NULL,
  agent_version      TEXT,
  api_key_hash       TEXT NOT NULL,
  enrolled_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_heartbeat_at  TIMESTAMPTZ,
  is_active          BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (tenant_id, device_fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_devices_tenant_user ON monitored_devices(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_devices_api_key_hash ON monitored_devices(api_key_hash);

-- Active-window + idle tracking. window_title is disclosed activity
-- monitoring (which app/window was focused, for how long), NOT keystroke
-- or screen content capture — deliberately declined per user decision.
CREATE TABLE IF NOT EXISTS device_activity_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id    UUID NOT NULL REFERENCES monitored_devices(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app_name     TEXT,
  window_title TEXT,
  started_at   TIMESTAMPTZ NOT NULL,
  ended_at     TIMESTAMPTZ NOT NULL,
  is_idle      BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activity_tenant_user_time ON device_activity_log(tenant_id, user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS device_browsing_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id   UUID NOT NULL REFERENCES monitored_devices(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  page_title  TEXT,
  browser     TEXT,
  visited_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_browsing_tenant_user_time ON device_browsing_history(tenant_id, user_id, visited_at DESC);

ALTER TABLE device_monitoring_consent ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_monitoring_consent FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON device_monitoring_consent;
CREATE POLICY tenant_isolation ON device_monitoring_consent
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);

ALTER TABLE device_enrollment_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_enrollment_tokens FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON device_enrollment_tokens;
CREATE POLICY tenant_isolation ON device_enrollment_tokens
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);

ALTER TABLE monitored_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitored_devices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON monitored_devices;
CREATE POLICY tenant_isolation ON monitored_devices
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);

ALTER TABLE device_activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_activity_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON device_activity_log;
CREATE POLICY tenant_isolation ON device_activity_log
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);

ALTER TABLE device_browsing_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_browsing_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON device_browsing_history;
CREATE POLICY tenant_isolation ON device_browsing_history
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);

-- The agent authenticates with a device API key, not a user JWT, so it
-- doesn't know its own tenant_id ahead of time — same "cast '' to uuid"
-- problem as every other anonymous/token-based flow in this codebase
-- (nda.py, offers.py, agency-submit, video-screening). Same fix: SECURITY
-- DEFINER functions owned by postgres, which run with RLS-bypass privilege
-- regardless of what system_conn()'s empty app.tenant_id would otherwise
-- block. MUST be created (or OWNER TO'd) as postgres, not app_user — this
-- file is applied via `psql -U postgres`, which already makes that true,
-- but if ever re-run as app_user, follow up with:
--   ALTER FUNCTION public.get_device_by_key_hash(text) OWNER TO postgres;
--   ALTER FUNCTION public.redeem_device_enrollment(text,text,text,text,text,text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.get_device_by_key_hash(p_key_hash text)
 RETURNS TABLE(id uuid, tenant_id uuid, user_id uuid, is_active boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
    SELECT d.id, d.tenant_id, d.user_id, d.is_active
    FROM monitored_devices d
    WHERE d.api_key_hash = p_key_hash
    LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.redeem_device_enrollment(
  p_token text, p_hostname text, p_os text, p_fingerprint text,
  p_agent_version text, p_key_hash text
)
 RETURNS TABLE(device_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_tenant uuid;
    v_user   uuid;
    v_device uuid;
BEGIN
    SELECT tenant_id, user_id INTO v_tenant, v_user
    FROM device_enrollment_tokens
    WHERE token = p_token AND used_at IS NULL AND expires_at > now();

    IF v_tenant IS NULL THEN
        RETURN;
    END IF;

    UPDATE device_enrollment_tokens SET used_at = now()
    WHERE token = p_token;

    INSERT INTO monitored_devices
      (tenant_id, user_id, hostname, os, device_fingerprint, agent_version, api_key_hash)
    VALUES (v_tenant, v_user, p_hostname, p_os, p_fingerprint, p_agent_version, p_key_hash)
    ON CONFLICT (tenant_id, device_fingerprint)
    DO UPDATE SET hostname = p_hostname, os = p_os, agent_version = p_agent_version,
                  api_key_hash = p_key_hash, is_active = true, user_id = v_user
    RETURNING id INTO v_device;

    RETURN QUERY SELECT v_device;
END;
$function$;
