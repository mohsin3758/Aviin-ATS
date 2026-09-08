-- Real feature (2026-09-09, reported live): "Notice Serving Period -->
-- Yes or No (Mandatory) in the add new candidate form" -- a distinct
-- yes/no status (is the candidate ALREADY serving their notice right
-- now) separate from the existing notice_period_days (how long their
-- notice period IS, in days, whether or not they've resigned yet).
-- "Mandatory" is enforced at the Add Candidate modal's own client-side
-- validation only, same established convention as full_name/location
-- there (see schemas.py's CandidateCreate.location docstring) -- this
-- column stays a real, optional boolean at the DB/API layer since
-- POST /candidates is also called by other legitimate callers with
-- partial data (resume auto-intake, personal resume links, WhatsApp
-- bot) that can't always know this at creation time.

ALTER TABLE candidates ADD COLUMN IF NOT EXISTS is_serving_notice BOOLEAN;
