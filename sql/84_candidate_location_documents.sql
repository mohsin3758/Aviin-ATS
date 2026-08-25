-- Add New Candidate form gaps closed (real spec items, requested
-- 2026-08-25): Current Location (the existing "location" column already
-- serves this purpose and is reused, not renamed - too invasive to
-- rename a column referenced across dozens of files for a purely
-- cosmetic label change), Desired Location (new), and document uploads
-- (LWD confirmation + other documents - resume upload reuses the
-- already-existing resume_files table/pattern, not duplicated here).

ALTER TABLE candidates ADD COLUMN IF NOT EXISTS desired_location TEXT;

CREATE TABLE IF NOT EXISTS candidate_documents (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL,
    candidate_id   UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    document_type  TEXT NOT NULL CHECK (document_type IN ('lwd_confirmation', 'other')),
    file_name      VARCHAR(500),
    file_path      VARCHAR(1000) NOT NULL,
    mime_type      VARCHAR(100),
    file_size      INT,
    notes          TEXT,
    uploaded_by    UUID REFERENCES users(id),
    created_at     TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_candidate_documents_candidate ON candidate_documents(candidate_id);

ALTER TABLE candidate_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS candidate_documents_isolation ON candidate_documents;
CREATE POLICY candidate_documents_isolation ON candidate_documents
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL ON TABLE candidate_documents TO app_user;
