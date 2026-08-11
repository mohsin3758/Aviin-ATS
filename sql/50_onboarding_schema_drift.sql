-- Schema-drift backfill for candidate_onboarding / onboarding_templates
-- (2026-08-11 audit) -- both tables existed live in production with no
-- CREATE TABLE in any committed migration, the same recurring pattern
-- found and fixed for ~15 other tables across this project. Captured
-- byte-for-byte from the real live schema via pg_dump --schema-only,
-- not reconstructed from memory. Genuine no-op everywhere both tables
-- already exist correctly.

CREATE TABLE IF NOT EXISTS onboarding_templates (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name        VARCHAR(100) NOT NULL,
    role_type   VARCHAR(50) DEFAULT 'all',
    tasks       JSONB DEFAULT '[]',
    is_active   BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMPTZ DEFAULT now(),
    UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS candidate_onboarding (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    candidate_id     UUID NOT NULL REFERENCES candidates(id),
    placement_id     UUID REFERENCES placements(id),
    template_id      UUID REFERENCES onboarding_templates(id),
    client_name      VARCHAR(200),
    joining_date     DATE,
    status           VARCHAR(20) DEFAULT 'not_started'
                       CHECK (status IN ('not_started','in_progress','completed','cancelled')),
    tasks            JSONB DEFAULT '[]',
    completed_count  INT DEFAULT 0,
    total_count      INT DEFAULT 0,
    hr_spoc          VARCHAR(100),
    hr_phone         VARCHAR(20),
    notes            TEXT,
    created_at       TIMESTAMPTZ DEFAULT now(),
    updated_at       TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE onboarding_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_ot ON onboarding_templates;
CREATE POLICY rls_ot ON onboarding_templates
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL ON TABLE onboarding_templates TO app_user;

ALTER TABLE candidate_onboarding ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_onboarding FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_co ON candidate_onboarding;
CREATE POLICY rls_co ON candidate_onboarding
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL ON TABLE candidate_onboarding TO app_user;

-- Second real gap found in the same audit: only 1 of 2 tenants has any
-- onboarding_templates row at all, so a tenant with none would only
-- ever get blank-checklist onboarding records (POST /onboarding without
-- a template_id still succeeds, just with zero tasks). Seed one sane
-- default template for any tenant that currently has zero — mirrors
-- this project's established per-tenant default-row seeding pattern
-- (score_weight_config, tracking_sheet_templates).
DO $$
DECLARE tid UUID;
BEGIN
  FOR tid IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', tid::text, true);
    IF NOT EXISTS (SELECT 1 FROM onboarding_templates WHERE tenant_id = tid) THEN
      -- Task shape matches what onboarding.py's create_onboarding()/
      -- update_task() and the frontend onboarding page actually read
      -- (id: int, title, desc) -- confirmed by reading both, not guessed;
      -- an earlier draft used key/label/done, which update_task's
      -- `t.get("id") == body.task_id` match would have silently never hit.
      INSERT INTO onboarding_templates (tenant_id, name, role_type, tasks, is_active)
      VALUES (tid, 'Standard Onboarding', 'all', '[
        {"id":1,"title":"Offer letter signed & returned","desc":"Candidate has signed and returned the offer letter"},
        {"id":2,"title":"Documents collected","desc":"Aadhaar, PAN, education certificates collected"},
        {"id":3,"title":"Background verification initiated","desc":"BGV check kicked off with the verification vendor"},
        {"id":4,"title":"Bank account details captured","desc":"Bank details on file for payroll setup"},
        {"id":5,"title":"Laptop/assets arranged","desc":"Laptop and other assets ready for day 1"},
        {"id":6,"title":"HR induction scheduled","desc":"HR induction session booked with the candidate"},
        {"id":7,"title":"Reporting manager introduction","desc":"Candidate introduced to their reporting manager"},
        {"id":8,"title":"Day-1 joining confirmed","desc":"Joining date and logistics reconfirmed with the candidate"}
      ]'::jsonb, TRUE)
      ON CONFLICT (tenant_id, name) DO NOTHING;
    END IF;
  END LOOP;
END $$;
