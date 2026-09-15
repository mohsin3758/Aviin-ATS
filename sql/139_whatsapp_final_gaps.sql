-- WhatsApp automation research (2026-09-15), closing the remaining gaps
-- from the original 20-item competitor comparison: e-sign/BGV status
-- pings, self-service interview reschedule, an auto-summarized
-- transcript for recruiter handoff, and a forwardable referral prompt
-- (the last needs no schema -- see services/screening_i18n.py).

-- Gap: post-offer milestone sequencing (Jobvite pattern) was only ever
-- built as far as the joining-confirmation half (sql/137). NDA and offer
-- e-sign already have real, working links (nda_documents, offer_letters)
-- sent by EMAIL (scheduler.py's existing reminder job) but never by
-- WhatsApp -- tracked separately from email's own sent_at/reminder_sent_at
-- so both channels can fire independently without racing each other.
ALTER TABLE nda_documents ADD COLUMN IF NOT EXISTS whatsapp_sent_at TIMESTAMPTZ;
ALTER TABLE offer_letters ADD COLUMN IF NOT EXISTS whatsapp_sent_at TIMESTAMPTZ;

-- Gap: a completed/failed bgv_checks row never notified the candidate at
-- all, on any channel. Kept deliberately non-alarming and free of the
-- real check `result`/`notes` (Aadhaar/PAN-adjacent PII, Hard Rule #10) --
-- a status ping only, real findings stay recruiter-only.
ALTER TABLE bgv_checks ADD COLUMN IF NOT EXISTS candidate_notified_at TIMESTAMPTZ;

-- Gap: self-service interview reschedule (Paradox.ai pattern) -- a
-- candidate can now flag they need a new time over WhatsApp instead of
-- calling; the actual re-slotting still needs a recruiter (this app has
-- no real calendar-booking integration), so this just closes the "how do
-- they even tell us" gap, not automated re-booking.
ALTER TABLE interview_schedules
  ADD COLUMN IF NOT EXISTS reschedule_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reschedule_note TEXT;

-- Gap: auto-summarized transcript for recruiter handoff (Humanly.io
-- pattern) -- a recruiter reading a completed screening today only sees
-- the raw Q&A list. One local-Qwen summary generated once, at
-- score_and_advance time, stored so it's never recomputed per page view.
ALTER TABLE screening_sessions ADD COLUMN IF NOT EXISTS transcript_summary TEXT;
