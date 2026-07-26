-- AIrecruit: nurture_executions previously only ever recorded "this
-- candidate was enrolled" (step_idx=0, sent_at=now() at INSERT time) -
-- nothing anywhere read this table to actually send a message, so no
-- candidate has ever received a real nurture email/WhatsApp/SMS.
--
-- New semantics needed for a real dispatch worker to track progress
-- through a multi-day sequence:
--   enrolled_at  - when the candidate first entered the sequence (fixed,
--                  the anchor every step's "day" offset is measured from)
--   step_idx     - index of the NEXT step still due to be sent (was
--                  previously "the step already sent", conflating
--                  enrollment with completion)
--   sent_at      - when the last step was actually, successfully sent
--                  (NULL until the first real send happens)
--   last_error   - best-effort diagnostic for a failed send attempt,
--                  so a stuck candidate is debuggable instead of silently
--                  retried forever with no visibility

ALTER TABLE nurture_executions ADD COLUMN IF NOT EXISTS enrolled_at TIMESTAMPTZ;
-- Deliberately NOT backfilling from the old sent_at (which could be days
-- or weeks old): under the new semantics every step whose "day" offset
-- has already elapsed since enrolled_at is immediately due, so backdating
-- would fire several steps at once for anyone enrolled before this
-- migration. Resetting the clock to "now" for pre-existing rows means at
-- most one (day-0) step goes out immediately, and later steps are
-- correctly spaced out from today rather than bursting.
UPDATE nurture_executions SET enrolled_at = now() WHERE enrolled_at IS NULL;
ALTER TABLE nurture_executions ALTER COLUMN enrolled_at SET NOT NULL;
ALTER TABLE nurture_executions ALTER COLUMN enrolled_at SET DEFAULT now();
ALTER TABLE nurture_executions ALTER COLUMN sent_at DROP DEFAULT;
ALTER TABLE nurture_executions ADD COLUMN IF NOT EXISTS last_error TEXT;

-- Existing rows all have step_idx=0 under the OLD semantics (meaning
-- "step 0 already sent"), which under the NEW semantics ("step 0 still
-- due") just means the dispatch worker finally, correctly sends their
-- first message - the honest fix for candidates who were previously
-- enrolled but never actually messaged.
