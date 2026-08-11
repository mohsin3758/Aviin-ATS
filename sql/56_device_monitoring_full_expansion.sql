-- Device Monitoring full expansion (Time Champ gap-analysis, 2026-08-11):
-- screenshots + live screen view, keystroke/mouse INTENSITY (counts/rate,
-- never literal keys typed -- that would be a categorically different and
-- far more invasive keylogger, not what was asked for or what Time
-- Champ's own product page describes as "keyboard/mouse intensity
-- tracking"), DLP detection (website/USB -- detection+alert, not
-- enforcement blocking, which needs a browser extension/driver-level
-- component out of scope here), and a silent/invisible tracking mode.
--
-- This is an explicit reversal of the 2026-07-28 scope decision
-- (sql/26_device_monitoring.sql) that excluded exactly these items on
-- DPDP 2023 grounds. The reversal was made by the user after being shown
-- that original rationale in full. Kept a real, separate "extended
-- scope" consent record rather than silently widening the existing
-- basic-monitoring consent row -- an employee who already consented to
-- active-window/idle/browsing tracking did not thereby consent to
-- screenshots or silent mode, and shouldn't be retroactively opted in.

ALTER TABLE device_monitoring_consent ADD COLUMN IF NOT EXISTS consent_scope TEXT NOT NULL DEFAULT 'basic'
  CHECK (consent_scope IN ('basic', 'extended'));

ALTER TABLE monitored_devices ADD COLUMN IF NOT EXISTS tracking_mode TEXT NOT NULL DEFAULT 'visible'
  CHECK (tracking_mode IN ('visible', 'silent'));
ALTER TABLE monitored_devices ADD COLUMN IF NOT EXISTS screenshot_interval_minutes INTEGER NOT NULL DEFAULT 10
  CHECK (screenshot_interval_minutes >= 1);
ALTER TABLE monitored_devices ADD COLUMN IF NOT EXISTS screenshots_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE monitored_devices ADD COLUMN IF NOT EXISTS blur_screenshots BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS device_screenshots (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id    UUID NOT NULL REFERENCES monitored_devices(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_path    TEXT NOT NULL,
  is_blurred   BOOLEAN NOT NULL DEFAULT FALSE,
  captured_at  TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_screenshots_tenant_user_time ON device_screenshots(tenant_id, user_id, captured_at DESC);

-- Aggregated counts/rate per time window -- never the actual keys typed
-- or mouse-click targets. This is an activity-intensity signal (same
-- concept the existing device_activity_log/burnout-risk-scoring features
-- already use), not a keylogger.
CREATE TABLE IF NOT EXISTS device_intensity_metrics (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id         UUID NOT NULL REFERENCES monitored_devices(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  window_start      TIMESTAMPTZ NOT NULL,
  window_end        TIMESTAMPTZ NOT NULL,
  keystroke_count   INTEGER NOT NULL DEFAULT 0,
  mouse_click_count INTEGER NOT NULL DEFAULT 0,
  mouse_move_px     BIGINT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_intensity_tenant_user_time ON device_intensity_metrics(tenant_id, user_id, window_start DESC);

CREATE TABLE IF NOT EXISTS device_dlp_policies (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  policy_type  TEXT NOT NULL CHECK (policy_type IN ('website_blocklist', 'usb_restriction')),
  rule         TEXT NOT NULL,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dlp_policies_tenant ON device_dlp_policies(tenant_id, policy_type, is_active);

CREATE TABLE IF NOT EXISTS device_dlp_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id    UUID NOT NULL REFERENCES monitored_devices(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type   TEXT NOT NULL CHECK (event_type IN ('blocked_website_visited', 'usb_connected')),
  detail       TEXT,
  occurred_at  TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dlp_events_tenant_user_time ON device_dlp_events(tenant_id, user_id, occurred_at DESC);

ALTER TABLE device_screenshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_screenshots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON device_screenshots;
CREATE POLICY tenant_isolation ON device_screenshots
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);

ALTER TABLE device_intensity_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_intensity_metrics FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON device_intensity_metrics;
CREATE POLICY tenant_isolation ON device_intensity_metrics
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);

ALTER TABLE device_dlp_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_dlp_policies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON device_dlp_policies;
CREATE POLICY tenant_isolation ON device_dlp_policies
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);

ALTER TABLE device_dlp_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_dlp_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON device_dlp_events;
CREATE POLICY tenant_isolation ON device_dlp_events
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);
