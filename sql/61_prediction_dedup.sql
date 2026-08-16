-- Real bug found 2026-08-17 while investigating a user-reported screenshot
-- of the Predictive Hiring page: two real candidates ("Vidyashree Katgi",
-- "Sneha Reddy") had 11 and 6 near-identical placement_predictions rows
-- respectively, all with requisition_id = NULL.
--
-- placement_predictions' real unique constraint is
-- (tenant_id, candidate_id, requisition_id) — but standard SQL treats
-- every NULL as distinct from every other NULL for uniqueness purposes,
-- so `ON CONFLICT (tenant_id,candidate_id,requisition_id) DO UPDATE`
-- never matched when requisition_id was NULL (the common case — both
-- the single-predict and "Run Bulk Predictions" UI actions call this
-- with no specific requisition). Every repeat call for the same
-- candidate silently inserted a brand-new row instead of updating the
-- existing one.
--
-- A partial unique index is the standard PostgreSQL way to make NULL
-- behave as "one value" for exactly this case, scoped only to rows
-- where requisition_id IS NULL so it doesn't conflict with the existing
-- full 3-column constraint used when a real requisition_id is present.
CREATE UNIQUE INDEX IF NOT EXISTS placement_predictions_no_req_uniq
  ON placement_predictions (tenant_id, candidate_id)
  WHERE requisition_id IS NULL;

-- One-time cleanup of the duplicate rows this bug already produced:
-- keep only the most recently predicted_at row per (tenant_id,
-- candidate_id) among NULL-requisition rows, delete the rest. Verified
-- zero real requisition-scoped duplicates exist (the 3-column
-- constraint was always correctly enforced) — this only ever touches
-- the NULL-requisition case.
DELETE FROM placement_predictions pp
USING placement_predictions newer
WHERE pp.requisition_id IS NULL
  AND newer.requisition_id IS NULL
  AND pp.tenant_id = newer.tenant_id
  AND pp.candidate_id = newer.candidate_id
  AND pp.predicted_at < newer.predicted_at;
