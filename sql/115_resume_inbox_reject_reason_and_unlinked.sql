-- Resume Inbox: real reject-reason capture + a real "unlinked resumes"
-- filter (2026-09-08 gap-audit follow-up build).
--
-- resume_files is owned by postgres, not app_user — run this migration
-- as postgres, matching this project's established discipline for every
-- other ALTER TABLE against this exact table.
--
-- Idempotent (IF NOT EXISTS throughout) — safe to re-run.

ALTER TABLE resume_files ADD COLUMN IF NOT EXISTS reject_reason varchar(30);
ALTER TABLE resume_files ADD COLUMN IF NOT EXISTS reject_notes text;
ALTER TABLE resume_files ADD COLUMN IF NOT EXISTS rejected_by uuid;
ALTER TABLE resume_files ADD COLUMN IF NOT EXISTS rejected_at timestamptz;

DO $$ BEGIN
  ALTER TABLE resume_files ADD CONSTRAINT resume_files_reject_reason_check
    CHECK (reject_reason IS NULL OR reject_reason IN
      ('not_a_resume', 'duplicate', 'poor_quality', 'wrong_role', 'spam', 'other'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE resume_files ADD CONSTRAINT resume_files_rejected_by_fkey
    FOREIGN KEY (rejected_by) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- A real, dedicated index for the new "Unlinked" filter — resumes with no
-- candidate record yet are exactly the ones a reviewer most needs to find
-- quickly, and this is a genuinely selective condition worth its own index
-- rather than relying on the existing idx_rf_tenant scan.
CREATE INDEX IF NOT EXISTS idx_rf_tenant_unlinked ON resume_files (tenant_id)
  WHERE candidate_id IS NULL;
