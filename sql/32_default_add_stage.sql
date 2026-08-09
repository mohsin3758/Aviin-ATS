-- Configurable default stage for "Add Candidate to Pipeline" — user asked
-- for a way to change which stage new candidates land in when no more
-- specific context (an active board tab) applies, instead of it always
-- being hardcoded to 'sourced'.
--
-- Exactly one row per tenant can be the default at a time, enforced by a
-- partial unique index rather than application logic alone (matches this
-- table's existing FORCE RLS discipline of preferring DB-level guarantees
-- for invariants that matter).

ALTER TABLE pipeline_stage_config
  ADD COLUMN IF NOT EXISTS is_default_add BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS pipeline_stage_config_one_default_add
  ON pipeline_stage_config (tenant_id) WHERE is_default_add;

-- Backfill: every existing tenant keeps today's real behavior (new
-- candidates land in 'sourced') as their explicit, changeable default,
-- rather than silently defaulting to whatever stage happens to sort first.
UPDATE pipeline_stage_config
SET is_default_add = TRUE
WHERE stage_key = 'sourced'
  AND tenant_id NOT IN (SELECT tenant_id FROM pipeline_stage_config WHERE is_default_add);
