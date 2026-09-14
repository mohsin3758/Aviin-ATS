-- WhatsApp Screening Blueprint -- manual question add/remove per role
-- (locked decision #1). Unused until Milestone 2's Phase 3 question loop
-- reads it; shipped now alongside the rest of the screening schema
-- baseline rather than re-splitting migrations per milestone.
ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS screening_questions_config JSONB NOT NULL DEFAULT '{}'::jsonb;
