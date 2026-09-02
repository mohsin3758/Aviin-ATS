-- Gap-audit fix (Phase 12, 2026-09-02) — referral_links tracked
-- referrer -> click -> candidate correctly, but stopped there: confirmed
-- live before this migration, bonus_paid is never set by any code path
-- anywhere in the backend (grepped the whole repo - zero UPDATE
-- statements touch it, only the DDL default and SELECT/INSERT column
-- lists), and there was no hired/placed_at field at all. Live before
-- this fix: 42 real referral links, 44 clicks, but only 1 ever
-- converted through to an attached candidate, 0 bonuses ever paid.
--
-- Deliberately a 2-step lifecycle, not a single auto-set bonus_paid
-- boolean: `bonus_eligible` becomes true AUTOMATICALLY the moment a
-- referred candidate is genuinely placed (an objective fact - "someone
-- this recruiter referred got hired") - `bonus_paid` stays a real,
-- separate, human-confirmed action, matching this project's own
-- established HITL principle for anything touching real money
-- (HARD RULE #10 - high-stakes actions always pause for human
-- approval, never fully autonomous).

ALTER TABLE referral_links
  ADD COLUMN IF NOT EXISTS hired_candidate_id UUID REFERENCES candidates(id),
  ADD COLUMN IF NOT EXISTS hired_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS placement_value NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS bonus_eligible BOOLEAN NOT NULL DEFAULT FALSE;
