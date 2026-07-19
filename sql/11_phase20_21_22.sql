
-- P20: Technical Assessment & Video Intelligence
-- P21: Placement Predictions (ML)
-- P22: Vendor Agencies & Analytics

-- P20: technical_assessments
CREATE TABLE IF NOT EXISTS technical_assessments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    candidate_id        UUID NOT NULL REFERENCES candidates(id),
    requisition_id      UUID REFERENCES requisitions(id),
    assessment_type     VARCHAR(30) DEFAULT 'mcq'
                        CHECK (assessment_type IN ('mcq','coding','video','written')),
    title               TEXT,
    questions           JSONB DEFAULT '[]',  -- [{q, options, correct, candidate_ans}]
    score               NUMERIC(5,2),
    max_score           NUMERIC(5,2) DEFAULT 100,
    time_taken_mins     INT,
    -- Anti-cheat metrics
    tab_switches        INT DEFAULT 0,
    copy_paste_count    INT DEFAULT 0,
    focus_lost_count    INT DEFAULT 0,
    suspicious_flag     BOOLEAN DEFAULT false,
    -- Video metrics (P20 video intelligence)
    video_duration_secs INT,
    video_file_path     TEXT,
    transcript_text     TEXT,
    sentiment_score     NUMERIC(4,3),        -- -1 to 1
    confidence_score    NUMERIC(4,3),        -- 0 to 1
    eye_contact_pct     NUMERIC(5,2),        -- % of time looking at camera
    speech_rate_wpm     INT,
    filler_word_count   INT,
    video_flags         JSONB DEFAULT '{}',
    --
    status              VARCHAR(20) DEFAULT 'pending'
                        CHECK (status IN ('pending','in_progress','completed','flagged')),
    completed_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE technical_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE technical_assessments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_ta ON technical_assessments;
CREATE POLICY rls_ta ON technical_assessments
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL ON technical_assessments TO app_user;

-- P21: placement_predictions — ML model output
CREATE TABLE IF NOT EXISTS placement_predictions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    candidate_id        UUID NOT NULL REFERENCES candidates(id),
    requisition_id      UUID REFERENCES requisitions(id),
    -- Prediction
    placement_prob      NUMERIC(5,4) DEFAULT 0,  -- 0.0 to 1.0
    offer_drop_prob     NUMERIC(5,4) DEFAULT 0,
    predicted_grade     VARCHAR(2),
    -- Features used
    features            JSONB DEFAULT '{}',
    model_version       VARCHAR(20) DEFAULT 'v1-logistic',
    predicted_at        TIMESTAMPTZ DEFAULT now(),
    -- Outcome (filled after joining)
    actual_outcome      VARCHAR(20),  -- placed|not_placed|offer_drop
    outcome_recorded_at TIMESTAMPTZ,
    UNIQUE (tenant_id, candidate_id, requisition_id)
);
ALTER TABLE placement_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE placement_predictions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_pp ON placement_predictions;
CREATE POLICY rls_pp ON placement_predictions
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL ON placement_predictions TO app_user;

-- P22: vendor_agencies
CREATE TABLE IF NOT EXISTS vendor_agencies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    contact_person  VARCHAR(100),
    email           TEXT,
    phone           TEXT,
    specialization  TEXT[],              -- domains they cover
    empanelled_since DATE,
    rating          NUMERIC(2,1) CHECK (rating BETWEEN 0 AND 5),
    status          VARCHAR(20) DEFAULT 'active'
                    CHECK (status IN ('active','inactive','blacklisted')),
    commission_pct  NUMERIC(5,2) DEFAULT 0,
    payment_terms   VARCHAR(50),
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE (tenant_id, name)
);
ALTER TABLE vendor_agencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_agencies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_va ON vendor_agencies;
CREATE POLICY rls_va ON vendor_agencies
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL ON vendor_agencies TO app_user;

-- source_attribution: link a candidate's source to a vendor or channel
CREATE TABLE IF NOT EXISTS source_attribution (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    candidate_id    UUID NOT NULL REFERENCES candidates(id),
    vendor_id       UUID REFERENCES vendor_agencies(id),
    source_channel  VARCHAR(50) DEFAULT 'direct'
                    CHECK (source_channel IN (
                      'direct','vendor','linkedin','naukri','indeed',
                      'referral','walk_in','campus','job_portal','other'
                    )),
    source_cost     NUMERIC(10,2) DEFAULT 0,
    cv_shared_at    TIMESTAMPTZ DEFAULT now(),
    -- Outcome tracking
    placed          BOOLEAN DEFAULT false,
    placed_at       TIMESTAMPTZ,
    placement_value NUMERIC(12,2),  -- revenue from this placement
    roi             NUMERIC(8,2),   -- (value - cost) / cost * 100
    UNIQUE (tenant_id, candidate_id)
);
ALTER TABLE source_attribution ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_attribution FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_sa ON source_attribution;
CREATE POLICY rls_sa ON source_attribution
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL ON source_attribution TO app_user;

-- View: per-recruiter funnel analytics
CREATE OR REPLACE VIEW v_recruiter_funnel
WITH (security_invoker = true) AS
SELECT
    u.id              AS recruiter_id,
    u.full_name,
    u.tenant_id,
    COUNT(DISTINCT a.id)                                         AS total_submissions,
    COUNT(DISTINCT a.id) FILTER (WHERE a.stage='interview')      AS interviews,
    COUNT(DISTINCT a.id) FILTER (WHERE a.stage='offer')          AS offers,
    COUNT(DISTINCT a.id) FILTER (WHERE a.stage='hired')          AS placements,
    ROUND(
        COUNT(DISTINCT a.id) FILTER (WHERE a.stage='interview')::numeric
        / NULLIF(COUNT(DISTINCT a.id),0) * 100, 1
    )                                                            AS sub_to_interview_pct,
    ROUND(
        COUNT(DISTINCT a.id) FILTER (WHERE a.stage='hired')::numeric
        / NULLIF(COUNT(DISTINCT a.id) FILTER (WHERE a.stage='offer'),0) * 100, 1
    )                                                            AS offer_to_join_pct
FROM users u
LEFT JOIN applications a ON a.created_by = u.id AND a.tenant_id = u.tenant_id
GROUP BY u.id, u.full_name, u.tenant_id;

GRANT SELECT ON v_recruiter_funnel TO app_user;

-- View: source channel performance
CREATE OR REPLACE VIEW v_source_performance
WITH (security_invoker = true) AS
SELECT
    sa.tenant_id,
    sa.source_channel,
    sa.vendor_id,
    va.name AS vendor_name,
    COUNT(*)                                        AS total_candidates,
    COUNT(*) FILTER (WHERE sa.placed)               AS placed_count,
    ROUND(COUNT(*) FILTER (WHERE sa.placed)::numeric / NULLIF(COUNT(*),0)*100,1) AS placement_rate,
    COALESCE(SUM(sa.source_cost),0)                 AS total_cost,
    COALESCE(SUM(sa.placement_value),0)             AS total_revenue,
    ROUND(AVG(sa.roi),1)                            AS avg_roi
FROM source_attribution sa
LEFT JOIN vendor_agencies va ON va.id = sa.vendor_id
GROUP BY sa.tenant_id, sa.source_channel, sa.vendor_id, va.name;

GRANT SELECT ON v_source_performance TO app_user;

SELECT 'P20+P21+P22 migration complete' AS result;
