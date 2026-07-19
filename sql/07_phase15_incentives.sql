
-- ============================================================
-- AIrecruit P15: Recruiter Performance & Incentive Engine
-- Zero-token: pure SQL rules, no LLM calls
-- Run as: docker exec -i finstack_db psql -U postgres -d ats
-- ============================================================

-- Helper functions (idempotent via OR REPLACE)
CREATE OR REPLACE FUNCTION kpi_grade(score NUMERIC) RETURNS VARCHAR(2) AS $$
BEGIN
    IF score >= 90 THEN RETURN 'A+';
    ELSIF score >= 80 THEN RETURN 'A';
    ELSIF score >= 70 THEN RETURN 'B';
    ELSIF score >= 60 THEN RETURN 'C';
    ELSE RETURN 'D';
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION kpi_incentive(score NUMERIC, cm NUMERIC) RETURNS NUMERIC AS $$
DECLARE base NUMERIC;
BEGIN
    IF cm < 0 OR score < 60 THEN RETURN 0; END IF;
    IF    score >= 90 THEN base := LEAST(20000 + (score - 90) * 3000, 50000);
    ELSIF score >= 80 THEN base := 10000 + (score - 80) * 1000;
    ELSIF score >= 70 THEN base :=  5000 + (score - 70) * 500;
    ELSE                    base :=  1000 + (score - 60) * 200;
    END IF;
    RETURN ROUND(base, 0);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION retention_credit(days INT) RETURNS NUMERIC AS $$
BEGIN
    IF days < 30 THEN RETURN 0;
    ELSIF days < 60 THEN RETURN 50;
    ELSIF days < 90 THEN RETURN 75;
    ELSE RETURN 100;
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 1. recruiter_kpi_scores
CREATE TABLE IF NOT EXISTS recruiter_kpi_scores (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id                 UUID NOT NULL REFERENCES users(id),
    period_month            SMALLINT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
    period_year             SMALLINT NOT NULL CHECK (period_year BETWEEN 2020 AND 2099),
    joinings_score          NUMERIC(5,2) DEFAULT 0 CHECK (joinings_score BETWEEN 0 AND 35),
    revenue_score           NUMERIC(5,2) DEFAULT 0 CHECK (revenue_score BETWEEN 0 AND 25),
    interview_score         NUMERIC(5,2) DEFAULT 0 CHECK (interview_score BETWEEN 0 AND 10),
    offer_score             NUMERIC(5,2) DEFAULT 0 CHECK (offer_score BETWEEN 0 AND 10),
    client_sat_score        NUMERIC(5,2) DEFAULT 0 CHECK (client_sat_score BETWEEN 0 AND 10),
    ats_score               NUMERIC(5,2) DEFAULT 0 CHECK (ats_score BETWEEN 0 AND 10),
    total_score             NUMERIC(5,2),
    grade                   VARCHAR(2),
    contribution_margin     NUMERIC(14,2) DEFAULT 0,
    calculated_incentive    NUMERIC(12,2) DEFAULT 0,
    immediate_payout        NUMERIC(12,2) DEFAULT 0,
    retention_bank_amount   NUMERIC(12,2) DEFAULT 0,
    status                  VARCHAR(20) DEFAULT 'draft'
                            CHECK (status IN ('draft','approved','paid')),
    approved_by             UUID REFERENCES users(id),
    approved_at             TIMESTAMPTZ,
    created_at              TIMESTAMPTZ DEFAULT now(),
    updated_at              TIMESTAMPTZ DEFAULT now(),
    UNIQUE (tenant_id, user_id, period_month, period_year)
);

CREATE OR REPLACE FUNCTION trg_kpi_calc() RETURNS TRIGGER AS $$
DECLARE
    tot  NUMERIC;
    g    VARCHAR(2);
    inc  NUMERIC;
BEGIN
    tot := COALESCE(NEW.joinings_score,0) + COALESCE(NEW.revenue_score,0)
         + COALESCE(NEW.interview_score,0) + COALESCE(NEW.offer_score,0)
         + COALESCE(NEW.client_sat_score,0) + COALESCE(NEW.ats_score,0);
    g   := kpi_grade(tot);
    inc := kpi_incentive(tot, COALESCE(NEW.contribution_margin, 0));
    NEW.total_score           := tot;
    NEW.grade                 := g;
    NEW.calculated_incentive  := inc;
    NEW.immediate_payout      := ROUND(inc * 0.70, 2);
    NEW.retention_bank_amount := ROUND(inc * 0.30, 2);
    NEW.updated_at            := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kpi_calc ON recruiter_kpi_scores;
CREATE TRIGGER trg_kpi_calc
    BEFORE INSERT OR UPDATE ON recruiter_kpi_scores
    FOR EACH ROW EXECUTE FUNCTION trg_kpi_calc();

ALTER TABLE recruiter_kpi_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruiter_kpi_scores FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_recruiter_kpi ON recruiter_kpi_scores;
CREATE POLICY rls_recruiter_kpi ON recruiter_kpi_scores
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL ON recruiter_kpi_scores TO app_user;

-- 2. recruiter_advanced_kpis
CREATE TABLE IF NOT EXISTS recruiter_advanced_kpis (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id                     UUID NOT NULL REFERENCES users(id),
    period_month                SMALLINT NOT NULL,
    period_year                 SMALLINT NOT NULL,
    time_to_first_sub_hrs       NUMERIC(8,2),
    submission_acceptance_pct   NUMERIC(5,2),
    interview_ratio             NUMERIC(5,2),
    offer_ratio                 NUMERIC(5,2),
    joining_ratio               NUMERIC(5,2),
    offer_drop_rate             NUMERIC(5,2),
    no_show_pct                 NUMERIC(5,2),
    candidate_satisfaction      NUMERIC(3,1) CHECK (candidate_satisfaction BETWEEN 0 AND 5),
    client_satisfaction         NUMERIC(3,1) CHECK (client_satisfaction BETWEEN 0 AND 5),
    retention_90day_pct         NUMERIC(5,2),
    updated_at                  TIMESTAMPTZ DEFAULT now(),
    UNIQUE (tenant_id, user_id, period_month, period_year)
);
ALTER TABLE recruiter_advanced_kpis ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruiter_advanced_kpis FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_adv_kpi ON recruiter_advanced_kpis;
CREATE POLICY rls_adv_kpi ON recruiter_advanced_kpis
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL ON recruiter_advanced_kpis TO app_user;

-- 3. candidate_retention_tracking
CREATE TABLE IF NOT EXISTS candidate_retention_tracking (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    placement_id         UUID REFERENCES placements(id),
    candidate_id         UUID NOT NULL REFERENCES candidates(id),
    recruiter_id         UUID NOT NULL REFERENCES users(id),
    joining_date         DATE NOT NULL,
    days_employed        INT DEFAULT 0,
    retention_credit_pct NUMERIC(5,2) DEFAULT 0,
    last_checked_at      TIMESTAMPTZ DEFAULT now(),
    created_at           TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE candidate_retention_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_retention_tracking FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_retention ON candidate_retention_tracking;
CREATE POLICY rls_retention ON candidate_retention_tracking
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL ON candidate_retention_tracking TO app_user;

-- 4. incentive_records
CREATE TABLE IF NOT EXISTS incentive_records (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id                 UUID NOT NULL REFERENCES users(id),
    kpi_score_id            UUID REFERENCES recruiter_kpi_scores(id),
    period_month            SMALLINT NOT NULL,
    period_year             SMALLINT NOT NULL,
    gross_incentive         NUMERIC(12,2) DEFAULT 0,
    immediate_payout_70pct  NUMERIC(12,2) DEFAULT 0,
    retention_bank_30pct    NUMERIC(12,2) DEFAULT 0,
    contribution_margin     NUMERIC(14,2),
    paid_at                 TIMESTAMPTZ,
    status                  VARCHAR(20) DEFAULT 'pending'
                            CHECK (status IN ('pending','approved','paid')),
    created_at              TIMESTAMPTZ DEFAULT now(),
    UNIQUE (tenant_id, user_id, period_month, period_year)
);
ALTER TABLE incentive_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE incentive_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_inc_rec ON incentive_records;
CREATE POLICY rls_inc_rec ON incentive_records
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL ON incentive_records TO app_user;

-- 5. retention_bank
CREATE TABLE IF NOT EXISTS retention_bank (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id          UUID NOT NULL REFERENCES users(id),
    incentive_id     UUID REFERENCES incentive_records(id),
    amount           NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
    accrued_month    SMALLINT NOT NULL,
    accrued_year     SMALLINT NOT NULL,
    release_schedule VARCHAR(20) DEFAULT 'quarterly'
                     CHECK (release_schedule IN ('quarterly','half_yearly','annual')),
    release_due_date DATE,
    released_at      TIMESTAMPTZ,
    status           VARCHAR(20) DEFAULT 'held'
                     CHECK (status IN ('held','released','forfeited')),
    forfeited_reason TEXT,
    created_at       TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE retention_bank ENABLE ROW LEVEL SECURITY;
ALTER TABLE retention_bank FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_ret_bank ON retention_bank;
CREATE POLICY rls_ret_bank ON retention_bank
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL ON retention_bank TO app_user;

-- 6. loyalty_milestones
CREATE TABLE IF NOT EXISTS loyalty_milestones (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id),
    joining_date    DATE NOT NULL,
    milestone_years SMALLINT NOT NULL CHECK (milestone_years IN (1,2,3,5)),
    bonus_amount    NUMERIC(12,2) NOT NULL,
    milestone_date  DATE NOT NULL,
    achieved_at     TIMESTAMPTZ,
    paid_at         TIMESTAMPTZ,
    status          VARCHAR(20) DEFAULT 'pending'
                    CHECK (status IN ('pending','achieved','paid')),
    created_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE (tenant_id, user_id, milestone_years)
);
ALTER TABLE loyalty_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_milestones FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_loyalty ON loyalty_milestones;
CREATE POLICY rls_loyalty ON loyalty_milestones
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL ON loyalty_milestones TO app_user;

-- Convenience view (security_invoker so RLS applies)
CREATE OR REPLACE VIEW v_recruiter_bank_summary
WITH (security_invoker = true) AS
SELECT
    rb.user_id,
    rb.tenant_id,
    SUM(CASE WHEN rb.status='held'      THEN rb.amount ELSE 0 END) AS held_total,
    SUM(CASE WHEN rb.status='released'  THEN rb.amount ELSE 0 END) AS released_total,
    SUM(CASE WHEN rb.status='forfeited' THEN rb.amount ELSE 0 END) AS forfeited_total
FROM retention_bank rb
GROUP BY rb.user_id, rb.tenant_id;

GRANT SELECT ON v_recruiter_bank_summary TO app_user;

SELECT 'P15 migration complete' AS result;
