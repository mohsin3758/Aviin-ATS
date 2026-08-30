-- Real feature (2026-08-30): the Create Follow-Up form had no way to
-- attach a specific candidate to a follow-up — reported live ("Need to
-- add candidate name also to select base on client for followup
-- received"). recruiter_tasks already had a free-text candidate_name
-- column (no real link) — this adds a genuine FK so a follow-up can
-- reference a real candidate record, matching the same pattern already
-- used for requisition_id/application_id/client_id on this table.
ALTER TABLE recruiter_tasks
  ADD COLUMN IF NOT EXISTS candidate_id uuid REFERENCES candidates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_rtasks_candidate ON recruiter_tasks (tenant_id, candidate_id) WHERE candidate_id IS NOT NULL;
