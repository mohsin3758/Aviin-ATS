-- Real form gaps reported live from the New Client Requirement modal
-- (2026-08-24): (1) Bill Rate was a single value, no min/max range like
-- the existing annual Budget fields already have; (2) no way to mark
-- which of the Required Skills are genuinely mandatory vs nice-to-have.
--
-- bill_rate (existing, single value) is kept, not dropped -- backfilled
-- into bill_rate_min so existing requisitions don't lose their data, and
-- kept in sync going forward as bill_rate_min's value (same "legacy
-- scalar stays in sync with the new richer field" convention already
-- used for employment_type/work_mode arrays, 2026-08-24).
--
-- mandatory_skills is a real SUBSET of skills_required, not a parallel
-- list -- deliberately a separate column rather than encoding it into
-- skills_required itself (e.g. a "Python*" marker), so the many existing
-- readers of skills_required (AI skill matching, Boolean search, JD
-- templates, candidate scoring) keep working completely unchanged.
ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS bill_rate_min NUMERIC;
ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS bill_rate_max NUMERIC;
ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS mandatory_skills TEXT[] NOT NULL DEFAULT '{}';

UPDATE requisitions SET bill_rate_min = bill_rate WHERE bill_rate_min IS NULL AND bill_rate IS NOT NULL;
