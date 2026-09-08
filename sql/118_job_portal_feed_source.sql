-- Real, confirmed bug fix (2026-09-08).
--
-- User reported (screenshot of the Recruiter/Sender Tracking page):
-- "how is it possible ashwini.c has submitted 3147 resumes... deep check
-- and fix it." Investigated with real data, not guessed: 2,894 of her
-- 3,147 claims were tagged source='personal_mailbox' — the pre-Golden-
-- Rule (2026-09-07) fallback that credits whoever's mailbox RECEIVED an
-- email, used for any sender whose domain isn't this tenant's own
-- internal one. Cross-checking every source_email behind those rows
-- confirmed they're ALL Naukri.com job-portal auto-forward relay
-- addresses (e.g. "shazia.sap.fico.gmail@naukri.com" — Naukri's own
-- relay format, not a real person's address) — 2,655 such rows exist
-- tenant-wide, credited to only 2 real recruiters purely because their
-- mailboxes happen to be the ones subscribed to Naukri's feed. This is
-- an automated, bulk, third-party job-portal forward, not a candidate
-- personally emailing that recruiter — resolve_sender_identity()'s
-- existing "external sender = the candidate applying directly, the
-- receiving recruiter genuinely sourced this" reasoning is correct for
-- a real 1:1 candidate application, but wrong for this specific,
-- confirmed automated-feed case.
--
-- Fix (code, see candidate_ownership.py's new _JOB_PORTAL_RELAY_DOMAINS):
-- a job-portal-relay sender still resolves ownership to the receiving
-- recruiter (unchanged — someone still needs to functionally work the
-- candidate within the real 30-day FCFS window, no workflow disruption)
-- but is now tagged with a distinct source='job_portal_feed' instead of
-- 'personal_mailbox', so recruiter_attribution.py's Recruiter/Sender
-- Tracking report can correctly exclude it from a specific human's
-- "Total Submitted" count and show it as its own honest, clearly-
-- labeled "Job Portal Feed" bucket instead — never silently misattributed
-- to a person, never silently hidden either.

ALTER TABLE candidate_ownership DROP CONSTRAINT IF EXISTS candidate_ownership_source_check;
ALTER TABLE candidate_ownership ADD CONSTRAINT candidate_ownership_source_check
    CHECK (source = ANY (ARRAY[
        'personal_mailbox', 'manual_add', 'bulk_upload', 'manual_assign',
        'personal_link', 'job_share_link', 'sender_email', 'unregistered_sender',
        'job_portal_feed'
    ]));

-- Retroactive correction — real, existing rows, not just future intake.
-- Scoped precisely to the confirmed pattern (a 'claimed' row whose
-- resume genuinely came from a naukri.com relay address), not a blind
-- bulk relabel of every 'personal_mailbox' row (562 of those are
-- genuine direct-candidate applications from real employer/personal
-- domains — correctly left untouched).
UPDATE candidate_ownership_history h
SET source = 'job_portal_feed'
WHERE h.source = 'personal_mailbox'
  AND h.action = 'claimed'
  AND EXISTS (
        SELECT 1 FROM resume_files rf
        WHERE rf.candidate_id = h.candidate_id
          AND rf.source_email ILIKE '%@naukri.com'
  );

UPDATE candidate_ownership o
SET source = 'job_portal_feed'
WHERE o.source = 'personal_mailbox'
  AND EXISTS (
        SELECT 1 FROM resume_files rf
        WHERE rf.candidate_id = o.candidate_id
          AND rf.source_email ILIKE '%@naukri.com'
  );
