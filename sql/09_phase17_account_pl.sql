
-- AIrecruit P17: Account Financial Framework & CEO Dashboard
-- Account P&L, CM engine, collection tracking, BU eligibility

-- account_pl: monthly P&L per client-account
CREATE TABLE IF NOT EXISTS account_pl (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    client_id               UUID NOT NULL,
    client_name             VARCHAR(255),
    period_month            SMALLINT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
    period_year             SMALLINT NOT NULL,
    -- Revenue breakdown (100%)
    gross_revenue           NUMERIC(14,2) DEFAULT 0,
    -- Company share (20%)
    company_share_pct       NUMERIC(5,2) DEFAULT 20,
    management_cost         NUMERIC(14,2) DEFAULT 0,
    finance_cost            NUMERIC(14,2) DEFAULT 0,
    ops_cost                NUMERIC(14,2) DEFAULT 0,
    company_share_total     NUMERIC(14,2) GENERATED ALWAYS AS
                            (COALESCE(management_cost,0)+COALESCE(finance_cost,0)+COALESCE(ops_cost,0)) STORED,
    -- Delivery pool (80%)
    delivery_pool           NUMERIC(14,2) DEFAULT 0,
    recruiter_incentives    NUMERIC(14,2) DEFAULT 0,
    sourcing_cost           NUMERIC(14,2) DEFAULT 0,
    referral_cost           NUMERIC(14,2) DEFAULT 0,
    kae_incentive           NUMERIC(14,2) DEFAULT 0,
    growth_reserve          NUMERIC(14,2) DEFAULT 0,
    op_reserve              NUMERIC(14,2) DEFAULT 0,
    -- Contribution Margin
    delivery_cost           NUMERIC(14,2) DEFAULT 0,
    total_incentives        NUMERIC(14,2) DEFAULT 0,
    operational_cost        NUMERIC(14,2) DEFAULT 0,
    contribution_margin     NUMERIC(14,2) DEFAULT 0,
    cm_pct                  NUMERIC(6,2),
    -- Headcount
    active_positions        INT DEFAULT 0,
    filled_positions        INT DEFAULT 0,
    -- Status
    is_finalized            BOOLEAN DEFAULT false,
    finalized_by            UUID REFERENCES users(id),
    finalized_at            TIMESTAMPTZ,
    created_at              TIMESTAMPTZ DEFAULT now(),
    updated_at              TIMESTAMPTZ DEFAULT now(),
    UNIQUE (tenant_id, client_id, period_month, period_year)
);

CREATE OR REPLACE FUNCTION trg_account_pl_calc() RETURNS TRIGGER AS $$
BEGIN
    -- CM = Revenue - Delivery Cost - Total Incentives - Operational Cost
    NEW.contribution_margin := COALESCE(NEW.gross_revenue,0)
                             - COALESCE(NEW.delivery_cost,0)
                             - COALESCE(NEW.total_incentives,0)
                             - COALESCE(NEW.operational_cost,0);
    NEW.cm_pct := CASE WHEN COALESCE(NEW.gross_revenue,0) > 0
                  THEN ROUND((NEW.contribution_margin / NEW.gross_revenue)*100, 2)
                  ELSE 0 END;
    -- Delivery pool = 80% of gross
    NEW.delivery_pool := ROUND(COALESCE(NEW.gross_revenue,0) * 0.80, 2);
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_account_pl_calc ON account_pl;
CREATE TRIGGER trg_account_pl_calc
    BEFORE INSERT OR UPDATE ON account_pl
    FOR EACH ROW EXECUTE FUNCTION trg_account_pl_calc();

ALTER TABLE account_pl ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_pl FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_account_pl ON account_pl;
CREATE POLICY rls_account_pl ON account_pl
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL ON account_pl TO app_user;

-- delivery_pool_allocations: breakdown of 80% pool per account-month
CREATE TABLE IF NOT EXISTS delivery_pool_allocations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    account_pl_id       UUID NOT NULL REFERENCES account_pl(id) ON DELETE CASCADE,
    allocation_type     VARCHAR(50) NOT NULL
                        CHECK (allocation_type IN (
                          'recruiter_incentive','sourcing','referral',
                          'kae_incentive','growth_reserve','op_reserve'
                        )),
    user_id             UUID REFERENCES users(id),
    amount              NUMERIC(12,2) NOT NULL DEFAULT 0,
    pct_of_pool         NUMERIC(5,2),
    notes               TEXT,
    created_at          TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE delivery_pool_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_pool_allocations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_dpa ON delivery_pool_allocations;
CREATE POLICY rls_dpa ON delivery_pool_allocations
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL ON delivery_pool_allocations TO app_user;

-- contribution_margins: monthly CM records (detailed breakdowns)
CREATE TABLE IF NOT EXISTS contribution_margins (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    client_id           UUID,
    user_id             UUID REFERENCES users(id),  -- NULL = company-wide
    period_month        SMALLINT NOT NULL,
    period_year         SMALLINT NOT NULL,
    revenue             NUMERIC(14,2) DEFAULT 0,
    delivery_cost       NUMERIC(14,2) DEFAULT 0,
    total_incentives    NUMERIC(14,2) DEFAULT 0,
    operational_cost    NUMERIC(14,2) DEFAULT 0,
    cm                  NUMERIC(14,2),              -- auto-computed by trigger or app
    cm_pct              NUMERIC(6,2),
    created_at          TIMESTAMPTZ DEFAULT now(),
    UNIQUE (tenant_id, client_id, user_id, period_month, period_year)
);
ALTER TABLE contribution_margins ENABLE ROW LEVEL SECURITY;
ALTER TABLE contribution_margins FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_cm ON contribution_margins;
CREATE POLICY rls_cm ON contribution_margins
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL ON contribution_margins TO app_user;

-- collection_records: invoice collection tracking
CREATE TABLE IF NOT EXISTS collection_records (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    client_id           UUID NOT NULL,
    client_name         VARCHAR(255),
    invoice_ref         VARCHAR(100),
    invoice_date        DATE,
    invoice_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
    collected_amount    NUMERIC(14,2) DEFAULT 0,
    outstanding_amount  NUMERIC(14,2),
    due_date            DATE,
    collected_date      DATE,
    aging_days          INT,
    status              VARCHAR(20) DEFAULT 'outstanding'
                        CHECK (status IN ('outstanding','partial','collected','overdue','written_off')),
    collection_stage    VARCHAR(50) DEFAULT 'invoice_raised'
                        CHECK (collection_stage IN (
                          'invoice_raised','reminder_sent','escalated',
                          'legal_notice','collected','written_off'
                        )),
    kae_user_id         UUID REFERENCES users(id),
    notes               TEXT,
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE OR REPLACE FUNCTION trg_collection_calc() RETURNS TRIGGER AS $$
BEGIN
    NEW.outstanding_amount := COALESCE(NEW.invoice_amount,0) - COALESCE(NEW.collected_amount,0);
    NEW.aging_days         := CASE WHEN NEW.due_date IS NOT NULL
                              THEN (CURRENT_DATE - NEW.due_date)
                              ELSE NULL END;
    IF NEW.collected_amount >= NEW.invoice_amount THEN
        NEW.status := 'collected';
    ELSIF NEW.collected_amount > 0 THEN
        NEW.status := 'partial';
    ELSIF NEW.due_date IS NOT NULL AND CURRENT_DATE > NEW.due_date THEN
        NEW.status := 'overdue';
    ELSE
        NEW.status := 'outstanding';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_collection_calc ON collection_records;
CREATE TRIGGER trg_collection_calc
    BEFORE INSERT OR UPDATE ON collection_records
    FOR EACH ROW EXECUTE FUNCTION trg_collection_calc();

ALTER TABLE collection_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_coll ON collection_records;
CREATE POLICY rls_coll ON collection_records
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL ON collection_records TO app_user;

-- bu_eligibility: business unit eligibility flags per client-account
CREATE TABLE IF NOT EXISTS bu_eligibility (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    client_id           UUID NOT NULL,
    client_name         VARCHAR(255),
    -- Criteria
    min_monthly_revenue NUMERIC(14,2) DEFAULT 0,
    min_cm_pct          NUMERIC(5,2) DEFAULT 0,
    months_active       INT DEFAULT 0,
    active_positions    INT DEFAULT 0,
    -- Eligibility result
    is_eligible         BOOLEAN DEFAULT false,
    eligible_since      DATE,
    bu_created          BOOLEAN DEFAULT false,
    bu_created_at       TIMESTAMPTZ,
    bu_head_user_id     UUID REFERENCES users(id),
    notes               TEXT,
    last_evaluated_at   TIMESTAMPTZ DEFAULT now(),
    created_at          TIMESTAMPTZ DEFAULT now(),
    UNIQUE (tenant_id, client_id)
);
ALTER TABLE bu_eligibility ENABLE ROW LEVEL SECURITY;
ALTER TABLE bu_eligibility FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_bu ON bu_eligibility;
CREATE POLICY rls_bu ON bu_eligibility
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL ON bu_eligibility TO app_user;

-- Views
CREATE OR REPLACE VIEW v_account_pl
WITH (security_invoker = true) AS
SELECT ap.*,
       ROUND((ap.filled_positions::numeric / NULLIF(ap.active_positions,0))*100,1) AS fill_rate_pct
FROM account_pl ap;
GRANT SELECT ON v_account_pl TO app_user;

CREATE OR REPLACE VIEW v_collection_aging
WITH (security_invoker = true) AS
SELECT cr.*,
    CASE WHEN cr.aging_days <= 0 THEN 'current'
         WHEN cr.aging_days <= 30 THEN '1-30d'
         WHEN cr.aging_days <= 60 THEN '31-60d'
         WHEN cr.aging_days <= 90 THEN '61-90d'
         ELSE '90d+'
    END AS aging_bucket
FROM collection_records cr;
GRANT SELECT ON v_collection_aging TO app_user;

SELECT 'P17 migration complete' AS result;
