-- Real "Remove from Pipeline" feature, 2026-08-20.
--
-- Until now applications had no soft-delete concept at all — the only
-- way to get a candidate off a job's board was "Reject" (moves them to
-- the Rejected column, still visible/counted). This adds a genuine
-- removal: the candidate disappears from every stage on the board
-- entirely, reversible (matching this codebase's soft-delete-everywhere
-- convention — see clients/candidates/requisitions), not a hard DELETE
-- (applications is FK-referenced by offers/interview_schedules/
-- interview_scorecards/client_feedback/submittals with no ON DELETE
-- clause, so a hard delete would throw on any candidate with real
-- pipeline history).

ALTER TABLE applications ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS removed_at timestamptz;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS removed_by uuid REFERENCES users(id);
ALTER TABLE applications ADD COLUMN IF NOT EXISTS removed_reason text;

-- Replace the plain unique constraint with a partial one scoped to
-- active rows, so a candidate removed from a job's pipeline can later
-- be re-added to that same job (same "candidates.email partial unique
-- index" precedent used for exactly this reason on 2026-08-12).
ALTER TABLE applications DROP CONSTRAINT IF EXISTS applications_tenant_id_requisition_id_candidate_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS applications_tenant_req_cand_active_key
  ON applications (tenant_id, requisition_id, candidate_id) WHERE is_active IS NOT FALSE;
