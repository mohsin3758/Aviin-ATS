
-- AIrecruit P16: KAE Module & Account Ownership
-- 3-owner rule, L1-L5 visibility, KAE KPI + incentives

CREATE OR REPLACE FUNCTION kae_retention_bonus(months_served INT) RETURNS NUMERIC AS $$
BEGIN
    IF months_served >= 24 THEN RETURN 30000;
    ELSIF months_served >= 12 THEN RETURN 15000;
    ELSIF months_served >= 6  THEN RETURN 5000;
    ELSE RETURN 0;
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION kae_growth_bonus(growth_pct NUMERIC) RETURNS NUMERIC AS $$
BEGIN
    IF growth_pct >= 200 THEN RETURN 25000;
    ELSIF growth_pct >= 100 THEN RETURN 10000;
    ELSIF growth_pct >= 50  THEN RETURN 5000;
    ELSIF growth_pct >= 25  THEN RETURN 2500;
    ELSE RETURN 0;
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION kae_collection_bonus(collected NUMERIC) RETURNS NUMERIC AS $$
BEGIN
    IF collected >= 1000000 THEN RETURN 10000;
    ELSIF collected >= 500000 THEN RETURN 5000;
    ELSIF collected >= 100000 THEN RETURN 1000;
    ELSE RETURN 0;
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION kae_satisfaction_bonus(sat NUMERIC) RETURNS NUMERIC AS $$
BEGIN
    IF sat >= 4.8 THEN RETURN 10000;
    ELSIF sat >= 4.5 THEN RETURN 5000;
    ELSE RETURN 0;
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='visibility_level') THEN
        CREATE TYPE visibility_level AS ENUM ('L1','L2','L3','L4','L5');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS client_owners (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    client_id      UUID NOT NULL,
    user_id        UUID NOT NULL REFERENCES users(id),
    owner_type     VARCHAR(30) NOT NULL DEFAULT 'kae'
                   CHECK (owner_type IN ('kae','account_manager','secondary')),
    visibility_lvl VARCHAR(2) NOT NULL DEFAULT 'L3',
    assigned_at    TIMESTAMPTZ DEFAULT now(),
    assigned_by    UUID REFERENCES users(id),
    is_active      BOOLEAN DEFAULT true,
    notes          TEXT,
    created_at     TIMESTAMPTZ DEFAULT now(),
    UNIQUE (tenant_id, client_id, user_id)
);
ALTER TABLE client_owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_owners FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_client_owners ON client_owners;
CREATE POLICY rls_client_owners ON client_owners
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL ON client_owners TO app_user;
CREATE INDEX IF NOT EXISTS idx_client_owners_client ON client_owners(tenant_id, client_id) WHERE is_active;

CREATE TABLE IF NOT EXISTS account_visibility (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id        UUID NOT NULL REFERENCES users(id),
    visibility_lvl VARCHAR(2) NOT NULL DEFAULT 'L1',
    can_see_own_revenue     BOOLEAN DEFAULT false,
    can_see_account_revenue BOOLEAN DEFAULT false,
    can_see_delivery_data   BOOLEAN DEFAULT false,
    can_see_account_pl      BOOLEAN DEFAULT false,
    can_see_company_pl      BOOLEAN DEFAULT false,
    created_at     TIMESTAMPTZ DEFAULT now(),
    updated_at     TIMESTAMPTZ DEFAULT now(),
    UNIQUE (tenant_id, user_id)
);
ALTER TABLE account_visibility ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_visibility FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_acct_vis ON account_visibility;
CREATE POLICY rls_acct_vis ON account_visibility
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL ON account_visibility TO app_user;

CREATE OR REPLACE FUNCTION set_visibility_level(
    p_tenant UUID, p_user UUID, p_level VARCHAR(2)
) RETURNS VOID AS $$
BEGIN
    INSERT INTO account_visibility
        (tenant_id, user_id, visibility_lvl,
         can_see_own_revenue, can_see_account_revenue, can_see_delivery_data,
         can_see_account_pl, can_see_company_pl)
    VALUES (
        p_tenant, p_user, p_level,
        p_level >= 'L2', p_level >= 'L3', p_level >= 'L3',
        p_level >= 'L4', p_level >= 'L5'
    )
    ON CONFLICT (tenant_id, user_id) DO UPDATE SET
        visibility_lvl          = EXCLUDED.visibility_lvl,
        can_see_own_revenue     = EXCLUDED.can_see_own_revenue,
        can_see_account_revenue = EXCLUDED.can_see_account_revenue,
        can_see_delivery_data   = EXCLUDED.can_see_delivery_data,
        can_see_account_pl      = EXCLUDED.can_see_account_pl,
        can_see_company_pl      = EXCLUDED.can_see_company_pl,
        updated_at              = now();
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS kae_kpi_scores (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES users(id),
    period_month        SMALLINT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
    period_year         SMALLINT NOT NULL,
    revenue_target      NUMERIC(14,2) DEFAULT 0,
    revenue_actual      NUMERIC(14,2) DEFAULT 0,
    revenue_pct         NUMERIC(6,2),
    revenue_score       NUMERIC(5,2) DEFAULT 0 CHECK (revenue_score BETWEEN 0 AND 40),
    collection_target   NUMERIC(14,2) DEFAULT 0,
    collection_actual   NUMERIC(14,2) DEFAULT 0,
    collection_pct      NUMERIC(6,2),
    collection_score    NUMERIC(5,2) DEFAULT 0 CHECK (collection_score BETWEEN 0 AND 25),
    client_sat_score    NUMERIC(5,2) DEFAULT 0 CHECK (client_sat_score BETWEEN 0 AND 20),
    new_pos_score       NUMERIC(5,2) DEFAULT 0 CHECK (new_pos_score BETWEEN 0 AND 10),
    renewal_score       NUMERIC(5,2) DEFAULT 0 CHECK (renewal_score BETWEEN 0 AND 5),
    total_score         NUMERIC(5,2),
    grade               VARCHAR(2),
    base_incentive      NUMERIC(12,2) DEFAULT 0,
    retention_bonus     NUMERIC(12,2) DEFAULT 0,
    growth_bonus        NUMERIC(12,2) DEFAULT 0,
    collection_bonus    NUMERIC(12,2) DEFAULT 0,
    satisfaction_bonus  NUMERIC(12,2) DEFAULT 0,
    total_incentive     NUMERIC(12,2) DEFAULT 0,
    status              VARCHAR(20) DEFAULT 'draft'
                        CHECK (status IN ('draft','approved','paid')),
    approved_by         UUID REFERENCES users(id),
    approved_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now(),
    UNIQUE (tenant_id, user_id, period_month, period_year)
);

CREATE OR REPLACE FUNCTION trg_kae_kpi_calc() RETURNS TRIGGER AS $$
DECLARE tot NUMERIC; g VARCHAR(2);
BEGIN
    NEW.revenue_pct    := CASE WHEN COALESCE(NEW.revenue_target,0) > 0
                          THEN ROUND((NEW.revenue_actual / NEW.revenue_target)*100,1) ELSE 0 END;
    NEW.collection_pct := CASE WHEN COALESCE(NEW.collection_target,0) > 0
                          THEN ROUND((NEW.collection_actual / NEW.collection_target)*100,1) ELSE 0 END;
    tot := COALESCE(NEW.revenue_score,0) + COALESCE(NEW.collection_score,0)
         + COALESCE(NEW.client_sat_score,0) + COALESCE(NEW.new_pos_score,0)
         + COALESCE(NEW.renewal_score,0);
    g   := kpi_grade(tot);
    NEW.total_score     := tot;
    NEW.grade           := g;
    NEW.total_incentive := COALESCE(NEW.base_incentive,0) + COALESCE(NEW.retention_bonus,0)
                         + COALESCE(NEW.growth_bonus,0)   + COALESCE(NEW.collection_bonus,0)
                         + COALESCE(NEW.satisfaction_bonus,0);
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kae_kpi_calc ON kae_kpi_scores;
CREATE TRIGGER trg_kae_kpi_calc
    BEFORE INSERT OR UPDATE ON kae_kpi_scores
    FOR EACH ROW EXECUTE FUNCTION trg_kae_kpi_calc();

ALTER TABLE kae_kpi_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE kae_kpi_scores FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_kae_kpi ON kae_kpi_scores;
CREATE POLICY rls_kae_kpi ON kae_kpi_scores
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL ON kae_kpi_scores TO app_user;

CREATE TABLE IF NOT EXISTS kae_incentives (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES users(id),
    kae_kpi_score_id    UUID REFERENCES kae_kpi_scores(id),
    period_month        SMALLINT NOT NULL,
    period_year         SMALLINT NOT NULL,
    client_id           UUID,
    base_incentive      NUMERIC(12,2) DEFAULT 0,
    retention_bonus     NUMERIC(12,2) DEFAULT 0,
    growth_bonus        NUMERIC(12,2) DEFAULT 0,
    collection_bonus    NUMERIC(12,2) DEFAULT 0,
    satisfaction_bonus  NUMERIC(12,2) DEFAULT 0,
    total_incentive     NUMERIC(12,2) DEFAULT 0,
    status              VARCHAR(20) DEFAULT 'pending'
                        CHECK (status IN ('pending','approved','paid')),
    paid_at             TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT now(),
    UNIQUE (tenant_id, user_id, period_month, period_year)
);
ALTER TABLE kae_incentives ENABLE ROW LEVEL SECURITY;
ALTER TABLE kae_incentives FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_kae_inc ON kae_incentives;
CREATE POLICY rls_kae_inc ON kae_incentives
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL ON kae_incentives TO app_user;

CREATE TABLE IF NOT EXISTS kae_client_retention (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES users(id),
    client_id           UUID NOT NULL,
    owner_since         DATE NOT NULL,
    months_served       INT DEFAULT 0,
    last_checked_at     TIMESTAMPTZ DEFAULT now(),
    retention_6m_paid   BOOLEAN DEFAULT false,
    retention_12m_paid  BOOLEAN DEFAULT false,
    retention_24m_paid  BOOLEAN DEFAULT false,
    created_at          TIMESTAMPTZ DEFAULT now(),
    UNIQUE (tenant_id, user_id, client_id)
);
ALTER TABLE kae_client_retention ENABLE ROW LEVEL SECURITY;
ALTER TABLE kae_client_retention FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_kae_ret ON kae_client_retention;
CREATE POLICY rls_kae_ret ON kae_client_retention
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL ON kae_client_retention TO app_user;

CREATE OR REPLACE VIEW v_kae_summary
WITH (security_invoker = true) AS
SELECT k.user_id, k.tenant_id, u.full_name,
    COUNT(k.id)                        AS scorecard_count,
    ROUND(AVG(k.total_score),1)        AS avg_score,
    COALESCE(SUM(k.total_incentive),0) AS total_incentive,
    COALESCE(SUM(k.collection_actual),0) AS total_collected,
    COALESCE(SUM(k.revenue_actual),0)  AS total_revenue,
    COUNT(co.id)                       AS accounts_owned
FROM kae_kpi_scores k
JOIN users u ON u.id = k.user_id
LEFT JOIN client_owners co ON co.user_id=k.user_id AND co.tenant_id=k.tenant_id AND co.is_active
GROUP BY k.user_id, k.tenant_id, u.full_name;

GRANT SELECT ON v_kae_summary TO app_user;

SELECT 'P16 migration complete' AS result;
