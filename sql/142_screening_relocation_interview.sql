-- Gap-analysis follow-up (2026-09-18): "willing to relocate" and
-- "available for interview" were requested as their own structured
-- WhatsApp screening captures. Relocation was previously only a weak
-- text heuristic buried inside candidates.desired_location (still kept,
-- for backward compatibility); interview availability had no field at
-- all. See backend/services/screening_extraction.py's _parse_location/
-- _parse_yes_no for how these get written.
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS willing_to_relocate BOOLEAN;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS available_for_interview BOOLEAN;
