-- P: Recruiter -> KAE candidate submission (tracking sheet + redacted resume)
--
-- Recruiters had no way to hand a candidate off to the client-owning KAE with
-- (a) a resume that hides phone/email/personal details and (b) an Excel
-- "tracking sheet" row appended to a running per-requisition sheet, sent by
-- real email and logged in the ATS. Nothing in the schema modeled this at
-- all (confirmed: zero hits anywhere for tracking_sheet/submission_template).
--
-- tracking_sheet_templates: named, ordered column sets. A template can be
-- global (client_id NULL) or pinned to one client. This single flexible
-- shape covers both requested modes at once - "one flexible template with
-- toggles" is just a template that reuses most of the default column set,
-- "fully separate per client" is just another template row with a
-- different column set - same mechanism, no separate code path needed.
CREATE TABLE IF NOT EXISTS tracking_sheet_templates (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    client_id   UUID REFERENCES clients(id) ON DELETE SET NULL,
    name        TEXT NOT NULL,
    columns     JSONB NOT NULL,   -- ordered [{"key":"sl_no","label":"SL No"}, ...]
    is_default  BOOLEAN NOT NULL DEFAULT false,
    created_by  UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tst_tenant ON tracking_sheet_templates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tst_client ON tracking_sheet_templates(tenant_id, client_id) WHERE client_id IS NOT NULL;
-- At most one default (global fallback) template per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tst_one_default_per_tenant
    ON tracking_sheet_templates(tenant_id) WHERE is_default;

ALTER TABLE tracking_sheet_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracking_sheet_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tracking_sheet_templates;
CREATE POLICY tenant_isolation ON tracking_sheet_templates
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- candidate_submissions: audit trail of every "Submit to KAE" send. Stores a
-- values snapshot (field_values) independent of the template definition so
-- historic tracking-sheet rows stay stable even if a template is edited or
-- deleted later.
CREATE TABLE IF NOT EXISTS candidate_submissions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    application_id   UUID REFERENCES applications(id) ON DELETE SET NULL,
    candidate_id     UUID NOT NULL REFERENCES candidates(id),
    requisition_id   UUID REFERENCES requisitions(id),
    client_id        UUID REFERENCES clients(id),
    template_id      UUID REFERENCES tracking_sheet_templates(id),
    kae_user_id      UUID REFERENCES users(id),
    resume_style     TEXT NOT NULL CHECK (resume_style IN ('clean_generated', 'redacted_original')),
    field_values     JSONB NOT NULL DEFAULT '{}',
    recipient_emails TEXT[] NOT NULL DEFAULT '{}',
    status           TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed')),
    error_message    TEXT,
    sent_by          UUID REFERENCES users(id),
    sent_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_csub_tenant ON candidate_submissions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_csub_requisition ON candidate_submissions(tenant_id, requisition_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_csub_application ON candidate_submissions(application_id);
CREATE INDEX IF NOT EXISTS idx_csub_candidate ON candidate_submissions(candidate_id);

ALTER TABLE candidate_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_submissions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON candidate_submissions;
CREATE POLICY tenant_isolation ON candidate_submissions
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Seed one global default template per existing tenant, matching the
-- 17-column example tracking sheet the user provided (SL No .. ECTC/Rate
-- Card). Recipients/values still come from candidate+submission data at
-- send time; this only defines which columns show and their order/labels.
--
-- tracking_sheet_templates has FORCE ROW LEVEL SECURITY, so even app_user
-- (its owner) needs app.tenant_id set per row to satisfy the policy on
-- INSERT — loop per tenant with set_config rather than a bare cross-tenant
-- INSERT...SELECT, which RLS would reject outright (HARD RULE #9: this
-- migration runs as app_user, never postgres).
DO $$
DECLARE
    t RECORD;
BEGIN
    FOR t IN SELECT id FROM tenants LOOP
        PERFORM set_config('app.tenant_id', t.id::text, true);
        IF NOT EXISTS (SELECT 1 FROM tracking_sheet_templates x WHERE x.tenant_id = t.id AND x.is_default) THEN
            INSERT INTO tracking_sheet_templates (tenant_id, client_id, name, columns, is_default)
            VALUES (t.id, NULL, 'Default Tracking Sheet',
                '[
                    {"key":"sl_no","label":"SL No"},
                    {"key":"date","label":"Date"},
                    {"key":"partner","label":"Partner"},
                    {"key":"candidate_name","label":"Name"},
                    {"key":"role","label":"Role"},
                    {"key":"total_exp","label":"Total Exp"},
                    {"key":"relevant_exp","label":"Relevant Exp"},
                    {"key":"skill_summary","label":"Skill Relevant Exp / Support / Implementation / Projects"},
                    {"key":"notice_period","label":"Notice Period / LWD"},
                    {"key":"mobile_number","label":"Mobile Number"},
                    {"key":"alternate_number","label":"Alternate Number"},
                    {"key":"email_id","label":"Email Id"},
                    {"key":"current_location","label":"Current Location"},
                    {"key":"deployment_location","label":"Deployment Location"},
                    {"key":"current_company","label":"Current Company"},
                    {"key":"ctc","label":"CTC"},
                    {"key":"ectc_rate_card","label":"ECTC / Rate Card"}
                ]'::jsonb,
                true);
        END IF;
    END LOOP;
    PERFORM set_config('app.tenant_id', '', true);
END $$;
