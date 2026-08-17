-- Workforce Intelligence: recruiter activity events, productivity aggregates,
-- daily performance scoring, SLA tracking, and configurable weights.
-- 2026-08-11. See CLAUDE.md "Workforce Intelligence" section for context.
-- Deliberately separate from the existing monthly recruiter_kpi_scores
-- (compensation-linked, human-approved) -- this is a daily, informational
-- activity system with no money attached.

CREATE TABLE IF NOT EXISTS recruiter_activity_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  recruiter_id    UUID NOT NULL REFERENCES users(id),
  candidate_id    UUID REFERENCES candidates(id),
  application_id  UUID REFERENCES applications(id),
  requisition_id  UUID REFERENCES requisitions(id),
  client_id       UUID REFERENCES clients(id),
  event_type      TEXT NOT NULL,
  event_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  dedup_key       TEXT NOT NULL,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, dedup_key)
);
CREATE INDEX IF NOT EXISTS idx_rae_recruiter_at ON recruiter_activity_events(tenant_id, recruiter_id, event_at DESC);
CREATE INDEX IF NOT EXISTS idx_rae_type_at ON recruiter_activity_events(tenant_id, event_type, event_at DESC);

ALTER TABLE recruiter_activity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruiter_activity_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON recruiter_activity_events;
CREATE POLICY tenant_isolation ON recruiter_activity_events
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Productivity aggregates: identical shape at 3 granularities.
CREATE TABLE IF NOT EXISTS recruiter_productivity_hourly (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  recruiter_id           UUID NOT NULL REFERENCES users(id),
  period_start           TIMESTAMPTZ NOT NULL,
  candidates_sourced     INT DEFAULT 0,
  candidates_screened    INT DEFAULT 0,
  candidates_submitted   INT DEFAULT 0,
  interviews_completed   INT DEFAULT 0,
  offers_generated       INT DEFAULT 0,
  offers_accepted        INT DEFAULT 0,
  placements             INT DEFAULT 0,
  active_mins            DECIMAL(9,2),
  idle_mins              DECIMAL(9,2),
  productivity_pct       DECIMAL(5,2),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, recruiter_id, period_start)
);

CREATE TABLE IF NOT EXISTS recruiter_productivity_daily (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  recruiter_id           UUID NOT NULL REFERENCES users(id),
  period_start           DATE NOT NULL,
  candidates_sourced     INT DEFAULT 0,
  candidates_screened    INT DEFAULT 0,
  candidates_submitted   INT DEFAULT 0,
  interviews_completed   INT DEFAULT 0,
  offers_generated       INT DEFAULT 0,
  offers_accepted        INT DEFAULT 0,
  placements             INT DEFAULT 0,
  active_mins            DECIMAL(9,2),
  idle_mins              DECIMAL(9,2),
  productivity_pct       DECIMAL(5,2),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, recruiter_id, period_start)
);

CREATE TABLE IF NOT EXISTS recruiter_productivity_weekly (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  recruiter_id           UUID NOT NULL REFERENCES users(id),
  period_start           DATE NOT NULL,
  candidates_sourced     INT DEFAULT 0,
  candidates_screened    INT DEFAULT 0,
  candidates_submitted   INT DEFAULT 0,
  interviews_completed   INT DEFAULT 0,
  offers_generated       INT DEFAULT 0,
  offers_accepted        INT DEFAULT 0,
  placements             INT DEFAULT 0,
  active_mins            DECIMAL(9,2),
  idle_mins              DECIMAL(9,2),
  productivity_pct       DECIMAL(5,2),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, recruiter_id, period_start)
);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['recruiter_productivity_hourly','recruiter_productivity_daily','recruiter_productivity_weekly']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid)', t);
  END LOOP;
END $$;

-- Per-candidate first-response SLA tracking (distinct from the existing
-- requisition-level sla_tier_config/find_sla_breaches -- this is
-- "did the recruiter respond to THIS candidate in time", not fill-time).
CREATE TABLE IF NOT EXISTS recruiter_sla_tracking (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  candidate_id        UUID NOT NULL REFERENCES candidates(id),
  recruiter_id        UUID NOT NULL REFERENCES users(id),
  sourced_at          TIMESTAMPTZ NOT NULL,
  first_response_at   TIMESTAMPTZ,
  sla_target_hours    INT NOT NULL DEFAULT 48,
  breached            BOOLEAN,
  resolved_at         TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, candidate_id, recruiter_id)
);
ALTER TABLE recruiter_sla_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruiter_sla_tracking FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON recruiter_sla_tracking;
CREATE POLICY tenant_isolation ON recruiter_sla_tracking
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Tenant-configurable weighting for the new daily performance score --
-- deliberately separate from scoring_weight_config (AI recruiter-matching
-- weights) and sla_tier_config (requisition fill-time SLA) -- unrelated
-- concerns, not overloaded onto one config table.
CREATE TABLE IF NOT EXISTS score_weight_config (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  output_weight           DECIMAL(3,2) NOT NULL DEFAULT 0.30,
  quality_weight          DECIMAL(3,2) NOT NULL DEFAULT 0.20,
  velocity_weight         DECIMAL(3,2) NOT NULL DEFAULT 0.15,
  productivity_weight     DECIMAL(3,2) NOT NULL DEFAULT 0.15,
  sla_weight              DECIMAL(3,2) NOT NULL DEFAULT 0.10,
  interview_conv_weight   DECIMAL(3,2) NOT NULL DEFAULT 0.10,
  grade_a_plus_threshold  DECIMAL(5,2) NOT NULL DEFAULT 95,
  grade_a_threshold       DECIMAL(5,2) NOT NULL DEFAULT 85,
  grade_b_threshold       DECIMAL(5,2) NOT NULL DEFAULT 75,
  grade_c_threshold       DECIMAL(5,2) NOT NULL DEFAULT 65,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)
);
ALTER TABLE score_weight_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE score_weight_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON score_weight_config;
CREATE POLICY tenant_isolation ON score_weight_config
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Seed one default row per existing tenant (own table, app_user-owned,
-- FORCE RLS -- needs app.tenant_id set per tenant even for an INSERT,
-- same pattern already used for tracking_sheet_templates' per-tenant seed).
DO $$
DECLARE tid UUID;
BEGIN
  FOR tid IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', tid::text, true);
    INSERT INTO score_weight_config (tenant_id) VALUES (tid)
    ON CONFLICT (tenant_id) DO NOTHING;
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS recruiter_performance_scores (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  recruiter_id           UUID NOT NULL REFERENCES users(id),
  score_date             DATE NOT NULL,
  output_score           DECIMAL(5,2),
  quality_score          DECIMAL(5,2),
  velocity_score         DECIMAL(5,2),
  productivity_score     DECIMAL(5,2),
  sla_score              DECIMAL(5,2),
  interview_conv_score   DECIMAL(5,2),
  overall_score          DECIMAL(5,2),
  grade                  VARCHAR(2),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, recruiter_id, score_date)
);
ALTER TABLE recruiter_performance_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruiter_performance_scores FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON recruiter_performance_scores;
CREATE POLICY tenant_isolation ON recruiter_performance_scores
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Leaderboard summary view -- same "materialized SELECT * ORDER BY metric
-- DESC" template as v_kae_summary. security_invoker so RLS on the
-- underlying tables still applies to whoever queries the view.
CREATE OR REPLACE VIEW v_recruiter_activity_summary
WITH (security_invoker = true) AS
SELECT
  u.id AS recruiter_id,
  u.tenant_id,
  u.full_name,
  COALESCE(d.candidates_sourced, 0)   AS today_sourced,
  COALESCE(d.candidates_submitted, 0) AS today_submitted,
  COALESCE(d.interviews_completed, 0) AS today_interviews,
  COALESCE(d.placements, 0)           AS today_placements,
  COALESCE(w.candidates_sourced, 0)   AS week_sourced,
  COALESCE(w.candidates_submitted, 0) AS week_submitted,
  COALESCE(w.placements, 0)           AS week_placements,
  s.overall_score,
  s.grade,
  s.score_date AS score_date
FROM users u
LEFT JOIN recruiter_productivity_daily d
  ON d.recruiter_id = u.id AND d.tenant_id = u.tenant_id AND d.period_start = CURRENT_DATE
LEFT JOIN recruiter_productivity_weekly w
  ON w.recruiter_id = u.id AND w.tenant_id = u.tenant_id
  AND w.period_start = date_trunc('week', CURRENT_DATE)::date
LEFT JOIN recruiter_performance_scores s
  ON s.recruiter_id = u.id AND s.tenant_id = u.tenant_id AND s.score_date = CURRENT_DATE
WHERE u.role = 'recruiter' AND u.is_active IS NOT FALSE;
