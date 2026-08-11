-- Burnout / attrition-risk scoring (Time Champ gap-analysis, 2026-08-11).
-- Distinct from `recruiter_performance_scores` (daily output/quality/
-- velocity/SLA score, built same day under Workforce Intelligence) — this
-- scores RISK, not performance: extended hours, declining engagement,
-- irregular patterns, workload pressure. Zero-token — pure SQL trend
-- analysis on `recruiter_productivity_daily` (already collected), no
-- external AI. Weekly cadence (burnout is a trend, not a daily snapshot).

CREATE TABLE risk_signal_config (
    tenant_id                 UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    hours_increase_threshold  NUMERIC(5,2) NOT NULL DEFAULT 20.0,  -- % above own 4-week baseline
    productivity_drop_threshold NUMERIC(5,2) NOT NULL DEFAULT 15.0, -- % decline vs prior 2-week avg
    workload_overload_ratio   NUMERIC(5,2) NOT NULL DEFAULT 1.3,    -- open tasks / weekly capacity
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE risk_signal_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_signal_config FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON risk_signal_config
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE TABLE recruiter_risk_scores (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    recruiter_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    period_start            DATE NOT NULL,
    period_end              DATE NOT NULL,
    avg_active_mins         NUMERIC(9,2),
    baseline_active_mins    NUMERIC(9,2),
    hours_increase_pct      NUMERIC(6,2),
    avg_productivity_pct    NUMERIC(5,2),
    productivity_trend_pct  NUMERIC(6,2),
    activity_variance_score NUMERIC(5,2),
    workload_ratio          NUMERIC(6,2),
    signals                 TEXT[] NOT NULL DEFAULT '{}',
    risk_score              NUMERIC(5,2) NOT NULL DEFAULT 0,
    risk_level              TEXT NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low','medium','high')),
    computed_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, recruiter_id, period_start)
);
CREATE INDEX idx_risk_scores_recruiter ON recruiter_risk_scores (tenant_id, recruiter_id, period_start DESC);
CREATE INDEX idx_risk_scores_level ON recruiter_risk_scores (tenant_id, risk_level, period_start DESC);
ALTER TABLE recruiter_risk_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruiter_risk_scores FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recruiter_risk_scores
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Seed a default config row for every existing tenant so the scheduler
-- job has something real to read from day one (matching the same
-- backfill pattern used for score_weight_config/sla_tier_config).
INSERT INTO risk_signal_config (tenant_id)
SELECT id FROM tenants
ON CONFLICT (tenant_id) DO NOTHING;
