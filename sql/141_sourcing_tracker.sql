-- Sourcing Tracker (candidate-level fields, pre-application sourcing
-- workflow). sourcing_status is a fixed, small set -- CHECK IN (...),
-- matching this codebase's convention for constrained-but-simple fields,
-- NOT the permissive regex convention used for tenant-customizable fields
-- like applications.stage/screening_sessions.status. This set is fixed by
-- design (pre-pipeline sourcing steps only) -- once a real applications
-- row exists, status tracking switches to the tenant's real
-- pipeline_stage_config instead, which IS customizable.
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS sourcing_status TEXT NOT NULL DEFAULT 'sourced';
ALTER TABLE candidates DROP CONSTRAINT IF EXISTS candidates_sourcing_status_check;
ALTER TABLE candidates ADD CONSTRAINT candidates_sourcing_status_check
  CHECK (sourcing_status IN (
    'sourced','contacted','whatsapp_sent','interested','not_interested',
    'screening_pending','screening_completed','qualified'
  ));

ALTER TABLE candidates ADD COLUMN IF NOT EXISTS remarks TEXT;
