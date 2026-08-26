-- KAE Review Queue + shortlist decision (2026-08-26) — when 2+ recruiters
-- each submit their own candidate for the same requisition, the KAE gets
-- a real in-app place to compare them by AI JD Match Score and mark one
-- Shortlisted (or Not Selected) — a soft marker only, never a hard gate
-- on the other candidates (multiple finalists are a real, normal outcome).
ALTER TABLE candidate_submissions ADD COLUMN IF NOT EXISTS kae_decision TEXT
  CHECK (kae_decision IS NULL OR kae_decision IN ('shortlisted', 'not_selected'));
ALTER TABLE candidate_submissions ADD COLUMN IF NOT EXISTS kae_decision_at TIMESTAMPTZ;
ALTER TABLE candidate_submissions ADD COLUMN IF NOT EXISTS kae_decision_by UUID REFERENCES users(id);
