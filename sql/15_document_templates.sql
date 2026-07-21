-- AIrecruit: reusable NDA/Contract document templates (upload your own
-- PDF or Word file instead of relying solely on the auto-generated text).
-- One active file per tenant per doc_type; uploading again replaces it.

CREATE TABLE IF NOT EXISTS document_templates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id),
  doc_type     TEXT NOT NULL CHECK (doc_type IN ('nda', 'contract')),
  file_path    TEXT NOT NULL,
  file_name    TEXT NOT NULL,
  mime_type    TEXT NOT NULL,
  uploaded_by  UUID REFERENCES users(id),
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, doc_type)
);

ALTER TABLE document_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_templates FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON document_templates;
CREATE POLICY tenant_isolation ON document_templates
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);

-- Which document was actually attached when this NDA was sent (audit trail +
-- lets the public signing page offer a "download the document" link for the
-- exact file the candidate was asked to review, not just the rendered text).
ALTER TABLE nda_documents ADD COLUMN IF NOT EXISTS attachment_source TEXT
  NOT NULL DEFAULT 'generated' CHECK (attachment_source IN ('generated', 'nda_template', 'contract_template'));
ALTER TABLE nda_documents ADD COLUMN IF NOT EXISTS attached_file_path TEXT;
ALTER TABLE nda_documents ADD COLUMN IF NOT EXISTS attached_file_name TEXT;

-- Refresh the public signing-page read function to also expose whether a
-- custom uploaded document (not the auto-generated text) was attached, so
-- the candidate can download the exact file they're being asked to sign.
-- IMPORTANT (see sql/12_nda_esign.sql note): must be owned by `postgres`
-- (BYPASSRLS) — CREATE OR REPLACE does NOT change ownership of an existing
-- function, so after running this as app_user, also run:
--   ALTER FUNCTION public.get_nda_by_signing_token(text) OWNER TO postgres;
CREATE OR REPLACE FUNCTION public.get_nda_by_signing_token(p_token text)
 RETURNS TABLE(
   final_text text, draft_text text, status text, sign_method text,
   candidate_name text, job_title text, company_name text,
   attachment_source text, attached_file_name text
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
    SELECT nd.final_text, nd.draft_text, nd.status, nd.sign_method,
           c.full_name, r.title, t.name,
           nd.attachment_source, nd.attached_file_name
    FROM nda_documents nd
    JOIN applications a ON a.id = nd.application_id
    JOIN candidates c ON c.id = a.candidate_id
    JOIN requisitions r ON r.id = a.requisition_id
    JOIN tenants t ON t.id = nd.tenant_id
    WHERE nd.signing_token = p_token
    LIMIT 1;
$function$;

-- Same ownership requirement as above — must end up owned by `postgres`.
CREATE OR REPLACE FUNCTION public.get_nda_attached_file_by_token(p_token text)
 RETURNS TABLE(attached_file_path text, attached_file_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
    SELECT attached_file_path, attached_file_name
    FROM nda_documents
    WHERE signing_token = p_token
    LIMIT 1;
$function$;
