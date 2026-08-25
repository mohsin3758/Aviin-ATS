-- Client Submission stage automation (2026-08-25) — moving a candidate
-- into a real, tenant-created "Client Submission" pipeline stage now
-- auto-fires the KAE->Client submission engine (_do_client_submission),
-- mirroring the existing "screened" auto-notify-screening-team automation
-- exactly. That sibling automation records itself as trigger_source=
-- 'auto_screened' so it's distinguishable from a real recruiter clicking
-- "Approve & Send" (trigger_source='manual') in the real audit trail
-- (candidate_submissions.trigger_source, GET /applications/{id}/submissions).
-- Widening the same CHECK constraint for the new automation's own value,
-- rather than reusing 'manual' (which would misrepresent an automated
-- send as a real human action in the audit trail).
ALTER TABLE candidate_submissions DROP CONSTRAINT IF EXISTS candidate_submissions_trigger_source_check;
ALTER TABLE candidate_submissions ADD CONSTRAINT candidate_submissions_trigger_source_check
  CHECK (trigger_source = ANY (ARRAY['manual'::text, 'auto_screened'::text, 'auto_client_submission'::text]));
