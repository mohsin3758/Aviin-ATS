-- AIrecruit: allow tenant-defined custom pipeline stages.
--
-- Earlier (sql/13_pipeline_stage_config.sql) deliberately kept the stage
-- KEYS fixed to the original 13 because 'rejected' and 'placed' are
-- load-bearing (the HITL/RBAC reject gate and the offer-acceptance
-- auto-transition in applications.py/offers.py are literal Python string
-- comparisons — untouched by this migration) and various dashboards filter
-- on the known set. Requested now: let admins add genuinely new stages.
-- Safe to do because:
--   - 'rejected'/'placed' keep meaning what they already mean; a new custom
--     stage just doesn't participate in those two specific code paths
--   - analytics/SLA/dashboard filters that do `stage IN ('placed', ...)`
--     simply won't count a new custom stage in those buckets, which is the
--     correct behavior for a step that isn't one of those business events
--   - GET /requisitions/{id}/pipeline already uses board.setdefault(), so
--     an unrecognized stage value already renders as its own column

ALTER TABLE applications DROP CONSTRAINT IF EXISTS applications_stage_check;
ALTER TABLE applications ADD CONSTRAINT applications_stage_check
  CHECK (stage ~ '^[a-z][a-z0-9_]{1,40}$');

ALTER TABLE pipeline_stage_config DROP CONSTRAINT IF EXISTS pipeline_stage_config_stage_key_check;
ALTER TABLE pipeline_stage_config ADD CONSTRAINT pipeline_stage_config_stage_key_check
  CHECK (stage_key ~ '^[a-z][a-z0-9_]{1,40}$');

-- Marks stages added via "Add Stage" so the UI can block deleting the 13
-- built-ins (which can still be hidden/relabeled, just not removed).
ALTER TABLE pipeline_stage_config ADD COLUMN IF NOT EXISTS is_custom BOOLEAN NOT NULL DEFAULT FALSE;
