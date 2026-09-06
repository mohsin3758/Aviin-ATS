-- Sender-based recruiter/candidate ownership attribution, 2026-09-07.
--
-- Golden Rule (user spec): candidate ownership, submission count, KPI, and
-- recruiter credit must always be assigned to the ACTUAL SENDER email
-- address (@company-domain), never the mailbox that merely received it.
--
-- Real, confirmed bug this closes: resume_intake_service.py resolved
-- ownership from `account_id` (which mailbox RECEIVED the email) instead
-- of `from_email` (who actually SENT it) -- live data showed 6 different
-- real recruiters' forwarded resumes all crediting one recruiter (whoever
-- happened to own the receiving mailbox), regardless of who actually
-- sourced/sent each one.
--
-- This migration only widens the schema to make the fix possible; the
-- identity-resolution logic itself lives in
-- backend/services/candidate_ownership.py::resolve_sender_identity().
--
-- 1. recruiter_id becomes nullable -- supports "Temporary Sender Record"
--    (spec Scenario 2): an @company-domain sender who forwarded/sent a
--    candidate but has no ATS user account yet. Ownership is still real
--    and still counted (by email), just not yet linked to a users row.
--    Once a matching user account is created, every prior ownership +
--    history row for that email is auto-mapped to the new user_id (see
--    candidate_ownership.py::auto_map_unregistered_sender(), called from
--    users.py's create_user()).
-- 2. recruiter_name is a new, always-populated denormalized display name
--    -- needed because an unregistered sender has no users row to JOIN
--    for a name at all.
CREATE OR REPLACE FUNCTION _idempotent_alter() RETURNS void AS $f$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='candidate_ownership' AND column_name='recruiter_id' AND is_nullable='NO'
  ) THEN
    ALTER TABLE candidate_ownership ALTER COLUMN recruiter_id DROP NOT NULL;
  END IF;
END;
$f$ LANGUAGE plpgsql;
SELECT _idempotent_alter();
DROP FUNCTION _idempotent_alter();

ALTER TABLE candidate_ownership ADD COLUMN IF NOT EXISTS recruiter_name TEXT;
ALTER TABLE candidate_ownership_history ADD COLUMN IF NOT EXISTS recruiter_name TEXT;

-- Backfill recruiter_name for every existing row from the real users table
-- (a one-time data fix so historical rows aren't blank once the code starts
-- reading recruiter_name directly instead of always JOINing users).
UPDATE candidate_ownership co SET recruiter_name = u.full_name
  FROM users u WHERE u.id = co.recruiter_id AND co.recruiter_name IS NULL;
UPDATE candidate_ownership_history h SET recruiter_name = u.full_name
  FROM users u WHERE u.id = h.recruiter_id AND h.recruiter_name IS NULL;

-- Widen the source vocabulary: 'sender_email' is the new, correct Golden-
-- Rule resolution path (a real, registered user matched by From: address);
-- 'unregistered_sender' marks a Temporary Sender Record (spec Scenario 2).
-- Existing values ('personal_mailbox','manual_add','bulk_upload',
-- 'manual_assign') are kept for historical rows and for the one case
-- where sender-based attribution genuinely doesn't apply (an external
-- candidate emailing their own resume directly to a recruiter's own
-- inbox -- there the "sender" IS the candidate, not an internal
-- recruiter, so the pre-existing receiving-mailbox credit is correct
-- and unchanged).
-- NOTE: the real, LIVE constraint (widened by sql/81_recruiter_personal_
-- links.sql, after the original sql/48 CREATE TABLE) already includes
-- 'personal_link'/'job_share_link' too -- confirmed via a live dry-run
-- against production (this exact ALTER failed on real rows carrying
-- those 2 values until they were added here), not assumed from re-
-- reading the original creation script alone.
ALTER TABLE candidate_ownership DROP CONSTRAINT IF EXISTS candidate_ownership_source_check;
ALTER TABLE candidate_ownership ADD CONSTRAINT candidate_ownership_source_check
  CHECK (source IN ('personal_mailbox','manual_add','bulk_upload','manual_assign',
                     'personal_link','job_share_link','sender_email','unregistered_sender'));

COMMENT ON COLUMN candidate_ownership.recruiter_id IS
  'Nullable: NULL = Temporary Sender Record (a real @company-domain sender with no ATS user account yet). Auto-backfilled once a matching user account is created.';
COMMENT ON COLUMN candidate_ownership.recruiter_name IS
  'Always-populated display name -- the sender''s real name for a Temporary Sender Record, or the registered user''s full_name once linked.';
