
-- P18: Resume & JD Intelligence
-- P19: Candidate Intelligence Engine

-- candidate_parsed_data: structured extraction from resume_text
CREATE TABLE IF NOT EXISTS candidate_parsed_data (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    candidate_id    UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    -- Extracted entities
    extracted_skills    TEXT[] DEFAULT '{}',
    extracted_titles    TEXT[] DEFAULT '{}',
    extracted_companies TEXT[] DEFAULT '{}',
    education_level     VARCHAR(50),       -- PhD|Masters|Bachelors|Diploma|Other
    degrees             TEXT[] DEFAULT '{}',
    institutions        TEXT[] DEFAULT '{}',
    total_years_exp     NUMERIC(5,1),
    job_count           INT DEFAULT 0,
    -- Gap analysis
    max_gap_months      INT DEFAULT 0,     -- longest employment gap
    avg_tenure_months   NUMERIC(5,1),      -- average time per company
    -- Contact
    extracted_email     TEXT,
    extracted_phone     TEXT,
    linkedin_url        TEXT,
    -- Raw parsed JSON for future use
    raw_parsed          JSONB DEFAULT '{}',
    parsed_at           TIMESTAMPTZ DEFAULT now(),
    parse_version       INT DEFAULT 1,
    UNIQUE (tenant_id, candidate_id)
);
ALTER TABLE candidate_parsed_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_parsed_data FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_cpd ON candidate_parsed_data;
CREATE POLICY rls_cpd ON candidate_parsed_data
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL ON candidate_parsed_data TO app_user;

-- jd_parsed_data: structured extraction from JD text
CREATE TABLE IF NOT EXISTS jd_parsed_data (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    requisition_id          UUID REFERENCES requisitions(id) ON DELETE CASCADE,
    required_skills         TEXT[] DEFAULT '{}',
    preferred_skills        TEXT[] DEFAULT '{}',
    required_exp_years_min  NUMERIC(4,1) DEFAULT 0,
    required_exp_years_max  NUMERIC(4,1),
    education_required      VARCHAR(50),
    job_title               TEXT,
    keywords                TEXT[] DEFAULT '{}',
    jd_embedding            vector(384),
    parsed_at               TIMESTAMPTZ DEFAULT now(),
    UNIQUE (tenant_id, requisition_id)
);
ALTER TABLE jd_parsed_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE jd_parsed_data FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_jdpd ON jd_parsed_data;
CREATE POLICY rls_jdpd ON jd_parsed_data
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL ON jd_parsed_data TO app_user;

-- P19: candidate_scores — composite intelligence scores
CREATE TABLE IF NOT EXISTS candidate_scores (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    candidate_id        UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    requisition_id      UUID REFERENCES requisitions(id),
    -- Score components (0-100)
    skill_match_score       NUMERIC(5,2) DEFAULT 0,   -- semantic similarity
    experience_score        NUMERIC(5,2) DEFAULT 0,   -- years fit
    stability_score         NUMERIC(5,2) DEFAULT 0,   -- tenure/gaps
    education_score         NUMERIC(5,2) DEFAULT 0,
    compensation_fit_score  NUMERIC(5,2) DEFAULT 0,
    fraud_risk_score        NUMERIC(5,2) DEFAULT 0,   -- 0=low risk, 100=high risk
    -- Composite
    readiness_index         NUMERIC(5,2) DEFAULT 0,   -- weighted composite 0-100
    readiness_grade         VARCHAR(2),
    -- Flags
    has_gap_flag            BOOLEAN DEFAULT false,
    duplicate_flag          BOOLEAN DEFAULT false,
    inconsistency_flag      BOOLEAN DEFAULT false,
    -- Context
    skill_match_details     JSONB DEFAULT '{}',
    scoring_version         INT DEFAULT 1,
    scored_at               TIMESTAMPTZ DEFAULT now(),
    UNIQUE (tenant_id, candidate_id, requisition_id)
);
ALTER TABLE candidate_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_scores FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_cscores ON candidate_scores;
CREATE POLICY rls_cscores ON candidate_scores
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL ON candidate_scores TO app_user;

-- Helper: readiness grade from score
CREATE OR REPLACE FUNCTION readiness_grade(score NUMERIC) RETURNS VARCHAR(2) AS $$
BEGIN
    IF score >= 85 THEN RETURN 'A+';
    ELSIF score >= 75 THEN RETURN 'A';
    ELSIF score >= 65 THEN RETURN 'B';
    ELSIF score >= 50 THEN RETURN 'C';
    ELSE RETURN 'D';
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- View: candidates with their latest scores
CREATE OR REPLACE VIEW v_candidate_intelligence
WITH (security_invoker = true) AS
SELECT
    ca.id, ca.tenant_id, ca.full_name, ca.email, ca.skills,
    ca.total_exp_mo, ca.location, ca.current_employer,
    cpd.extracted_skills, cpd.extracted_titles, cpd.education_level,
    cpd.total_years_exp, cpd.max_gap_months, cpd.avg_tenure_months,
    cpd.job_count,
    cs.readiness_index, cs.readiness_grade, cs.skill_match_score,
    cs.experience_score, cs.stability_score, cs.education_score,
    cs.fraud_risk_score, cs.has_gap_flag, cs.duplicate_flag
FROM candidates ca
LEFT JOIN candidate_parsed_data cpd ON cpd.candidate_id = ca.id
    AND cpd.tenant_id = ca.tenant_id
LEFT JOIN LATERAL (
    SELECT * FROM candidate_scores
    WHERE candidate_id = ca.id AND tenant_id = ca.tenant_id
    ORDER BY scored_at DESC LIMIT 1
) cs ON true;

GRANT SELECT ON v_candidate_intelligence TO app_user;

SELECT 'P18+P19 migration complete' AS result;
