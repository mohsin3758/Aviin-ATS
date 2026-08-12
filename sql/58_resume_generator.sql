-- AI Resume Generator / Resume Transformation Engine
-- resume_templates: named, reusable compositional configs (4 built-in +
-- future custom ones per tenant). generated_resumes: every actual
-- generated document, versioned, auditable, never overwrites the original.

CREATE TABLE IF NOT EXISTS resume_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    name TEXT NOT NULL,
    is_builtin BOOLEAN NOT NULL DEFAULT FALSE,
    name_format TEXT NOT NULL DEFAULT 'full' CHECK (name_format IN ('full','masked')),
    show_mobile BOOLEAN NOT NULL DEFAULT TRUE,
    show_email BOOLEAN NOT NULL DEFAULT TRUE,
    show_location BOOLEAN NOT NULL DEFAULT TRUE,
    company_mode TEXT NOT NULL DEFAULT 'original' CHECK (company_mode IN ('original','replace','hide')),
    default_company_replacement TEXT,
    project_mode TEXT NOT NULL DEFAULT 'include' CHECK (project_mode IN ('include','hide','focus')),
    client_name_mode TEXT NOT NULL DEFAULT 'hide' CHECK (client_name_mode IN ('show','hide','replace')),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, name)
);

CREATE TABLE IF NOT EXISTS generated_resumes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    candidate_id UUID NOT NULL REFERENCES candidates(id),
    source_resume_file_id UUID REFERENCES resume_files(id),
    template_id UUID REFERENCES resume_templates(id),
    requisition_id UUID REFERENCES requisitions(id),
    client_id UUID REFERENCES clients(id),

    template_name TEXT NOT NULL,
    name_format TEXT NOT NULL,
    display_name TEXT NOT NULL,
    show_mobile BOOLEAN NOT NULL,
    show_email BOOLEAN NOT NULL,
    show_location BOOLEAN NOT NULL,
    company_mode TEXT NOT NULL,
    company_replacement TEXT,
    project_mode TEXT NOT NULL,
    client_name_mode TEXT NOT NULL,
    client_name_replacement TEXT,

    output_format TEXT NOT NULL DEFAULT 'pdf' CHECK (output_format IN ('pdf','docx')),
    file_path TEXT NOT NULL,
    file_size INT,
    version INT NOT NULL DEFAULT 1,
    generation_status TEXT NOT NULL DEFAULT 'completed' CHECK (generation_status IN ('completed','failed')),
    error_message TEXT,

    generated_by UUID REFERENCES users(id),
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_generated_resumes_candidate ON generated_resumes(tenant_id, candidate_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_resume_templates_tenant ON resume_templates(tenant_id);

-- Client-level default template preference (auto-recommendation, spec 52.9)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS default_resume_template_id UUID REFERENCES resume_templates(id);

ALTER TABLE resume_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE resume_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON resume_templates;
CREATE POLICY tenant_isolation ON resume_templates
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL ON resume_templates TO app_user;

ALTER TABLE generated_resumes ENABLE ROW LEVEL SECURITY;
ALTER TABLE generated_resumes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON generated_resumes;
CREATE POLICY tenant_isolation ON generated_resumes
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL ON generated_resumes TO app_user;

-- Seed the 4 built-in templates for every existing tenant. FORCE RLS means
-- even app_user (table owner) needs app.tenant_id set to satisfy its own
-- policy on INSERT — same pattern used for every other per-tenant seed in
-- this project (tracking_sheet_templates, rejection_reasons, etc).
DO $$
DECLARE t RECORD;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);
    INSERT INTO resume_templates
      (tenant_id, name, is_builtin, name_format, show_mobile, show_email, show_location,
       company_mode, default_company_replacement, project_mode, client_name_mode)
    VALUES
      (t.id, 'Full Contact Resume', true, 'full', true, true, true,
       'original', NULL, 'include', 'hide'),
      (t.id, 'No Contact / Sanitized Resume', true, 'masked', false, false, true,
       'original', NULL, 'include', 'hide'),
      (t.id, 'Project-Focused Resume', true, 'masked', false, false, true,
       'hide', NULL, 'focus', 'hide'),
      (t.id, 'Current/Recent Company Replacement', true, 'full', true, true, true,
       'replace', 'Aviin Technology', 'include', 'hide')
    ON CONFLICT (tenant_id, name) DO NOTHING;
  END LOOP;
END $$;
