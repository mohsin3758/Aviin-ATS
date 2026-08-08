-- Tier-1 quick wins: rejection taxonomy, submission limits, requisition
-- soft-delete, email open/read tracking.
--
-- rejection_reasons: tenant-configurable taxonomy (admin-managed, matching
-- the tracking_sheet_templates pattern from sql/28 — a seeded default set,
-- editable/extendable per tenant).
CREATE TABLE IF NOT EXISTS rejection_reasons (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    code        TEXT NOT NULL,
    label       TEXT NOT NULL,
    sort_order  INT NOT NULL DEFAULT 0,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, code)
);
CREATE INDEX IF NOT EXISTS idx_rejreasons_tenant ON rejection_reasons(tenant_id) WHERE is_active;

ALTER TABLE rejection_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE rejection_reasons FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rejection_reasons;
CREATE POLICY tenant_isolation ON rejection_reasons
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- application_rejections: structured record of each rejection, separate
-- from applications so re-rejecting (e.g. after a re-submit) keeps history,
-- and so the recruiter-facing feedback survives independently of whatever
-- free-text StageUpdate.reason gets passed at the moment of the PATCH.
CREATE TABLE IF NOT EXISTS application_rejections (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    candidate_id   UUID NOT NULL REFERENCES candidates(id),
    requisition_id UUID REFERENCES requisitions(id),
    reason_code    TEXT NOT NULL,
    reason_label   TEXT NOT NULL,
    notes          TEXT,
    rejected_by    UUID REFERENCES users(id),
    rejected_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_apprej_tenant ON application_rejections(tenant_id);
CREATE INDEX IF NOT EXISTS idx_apprej_application ON application_rejections(application_id);

ALTER TABLE application_rejections ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_rejections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON application_rejections;
CREATE POLICY tenant_isolation ON application_rejections
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Seed a default reason taxonomy per tenant (same set_config-per-tenant
-- loop as sql/28's seed, for the same FORCE RLS reason).
DO $$
DECLARE
    t RECORD;
    reasons TEXT[][] := ARRAY[
        ARRAY['skills_mismatch',      'Skills mismatch'],
        ARRAY['experience_mismatch',  'Experience level not a fit'],
        ARRAY['salary_expectations',  'Salary/CTC expectations too high'],
        ARRAY['notice_period',        'Notice period too long'],
        ARRAY['failed_screening',     'Failed internal screening'],
        ARRAY['failed_interview',     'Failed client interview'],
        ARRAY['client_feedback',      'Negative client feedback'],
        ARRAY['candidate_withdrew',   'Candidate withdrew'],
        ARRAY['location_mismatch',    'Location/relocation mismatch'],
        ARRAY['duplicate',            'Duplicate / already in pipeline'],
        ARRAY['not_relevant',         'Profile not relevant to role'],
        ARRAY['other',                'Other']
    ];
    r TEXT[];
    i INT := 0;
BEGIN
    FOR t IN SELECT id FROM tenants LOOP
        PERFORM set_config('app.tenant_id', t.id::text, true);
        IF NOT EXISTS (SELECT 1 FROM rejection_reasons x WHERE x.tenant_id = t.id) THEN
            i := 0;
            FOREACH r SLICE 1 IN ARRAY reasons LOOP
                INSERT INTO rejection_reasons (tenant_id, code, label, sort_order)
                VALUES (t.id, r[1], r[2], i);
                i := i + 1;
            END LOOP;
        END IF;
    END LOOP;
    PERFORM set_config('app.tenant_id', '', true);
END $$;

-- Submission limits: NULL = unlimited (default, no behavior change for
-- existing requisitions until an admin sets one).
ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS submission_limit_per_recruiter INT;

-- Soft-delete for requisitions (mirrors candidates.is_active) — was
-- entirely missing; the only way to remove a bad/duplicate/test
-- requisition was a raw DELETE cascading through half a dozen FK'd
-- tables by hand. Default true so every existing row stays visible.
ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- Email open/read tracking. tracking_token is the opaque id embedded in
-- the pixel URL — separate from the message's own id so a leaked message
-- id (used elsewhere, e.g. inbox links) can't be used to forge opens.
ALTER TABLE candidate_messages ADD COLUMN IF NOT EXISTS tracking_token UUID DEFAULT gen_random_uuid();
ALTER TABLE candidate_messages ADD COLUMN IF NOT EXISTS email_opened_at TIMESTAMPTZ;
ALTER TABLE candidate_messages ADD COLUMN IF NOT EXISTS email_open_count INT NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cand_msgs_tracking_token ON candidate_messages(tracking_token) WHERE tracking_token IS NOT NULL;
