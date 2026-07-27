-- Approved items 04 + 05 from the AI Auto-Assignment Engine research audit,
-- combined per the user's explicit choice for item 05: a LAYERED policy
-- (immediate alert + manager notification, THEN auto-reassign only after
-- a grace period if still unresolved) rather than immediate auto-reassign.
--
-- find_sla_breaches()/find_stalled_assignments() (real since P1/P3) only
-- ever produced a dashboard card a human had to click. This table tracks
-- each alert's escalation state across scheduler runs so tier 1 (alert +
-- manager notify) fires once, and tier 2 (auto-reassign) fires only after
-- a real grace period, not on every 30-minute poll.

CREATE TABLE IF NOT EXISTS sla_escalations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  alert_id          TEXT NOT NULL,
  alert_type        TEXT NOT NULL CHECK (alert_type IN ('stalled_assignment','sla_breach')),
  requisition_id    UUID,
  assignment_id     UUID,
  first_detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  tier1_fired_at    TIMESTAMPTZ,
  tier2_fired_at    TIMESTAMPTZ,
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sla_escalations_open_alert
  ON sla_escalations(tenant_id, alert_id) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sla_escalations_tenant ON sla_escalations(tenant_id);

ALTER TABLE sla_escalations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_escalations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sla_escalations;
CREATE POLICY tenant_isolation ON sla_escalations
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);
