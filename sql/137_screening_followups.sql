-- WhatsApp automation research (2026-09-14/15), quick-win gaps 2-4 +
-- higher-value gaps 5-8: a lightweight followup_stage state machine on
-- screening_sessions (referral ask -> CSAT -> done, or a cross-requisition
-- offer first) that runs AFTER status already reached 'completed' --
-- deliberately NOT delaying score_and_advance's real business action
-- (recruiter notification + stage advance) behind these courtesy
-- follow-ups. status stays 'completed' throughout (dashboard/funnel
-- unaffected); followup_stage is a separate, unconstrained TEXT column
-- (no rigid CHECK enum, same convention as status itself -- sql/128's own
-- comment on why).
ALTER TABLE screening_sessions
  ADD COLUMN IF NOT EXISTS followup_stage TEXT,
  ADD COLUMN IF NOT EXISTS csat_rating INT CHECK (csat_rating BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS cross_match_requisition_id UUID REFERENCES requisitions(id);

-- Gap #4 (cold-candidate re-engagement): a fresh screening_session for a
-- NEW open requisition, created by the reengagement scheduler job rather
-- than a recruiter -- requires its own real opt-in from scratch (no
-- consent is assumed to carry over), same DPDP posture as any other
-- enrollment.
ALTER TABLE screening_sessions DROP CONSTRAINT IF EXISTS screening_sessions_enrolled_via_check;
ALTER TABLE screening_sessions ADD CONSTRAINT screening_sessions_enrolled_via_check
  CHECK (enrolled_via IN ('quick_add','csv_import','bulk_select','re_engagement'));

-- Gap #2 (referral capture): a lightweight lead, NOT a full candidate
-- record -- Hard Rule #6 requires a consent_records row before any real
-- PII PROCESSING of a candidate; a raw note about a third party someone
-- else mentioned isn't that yet. A recruiter reviews raw_text and adds
-- them properly (through the normal Add Candidate flow, which handles
-- consent correctly) only if they choose to actually reach out.
CREATE TABLE IF NOT EXISTS screening_referrals (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID NOT NULL,
    screening_session_id  UUID NOT NULL REFERENCES screening_sessions(id) ON DELETE CASCADE,
    referring_candidate_id UUID NOT NULL REFERENCES candidates(id),
    raw_text              TEXT NOT NULL,
    referred_name         TEXT,
    referred_phone        TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_screening_referrals_session ON screening_referrals(screening_session_id);

ALTER TABLE screening_referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE screening_referrals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS screening_referrals_isolation ON screening_referrals;
CREATE POLICY screening_referrals_isolation ON screening_referrals
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL ON TABLE screening_referrals TO app_user;

-- Gap #7 (post-offer joining sequence): offers.status already has a real
-- 'accepted' value (sql/01) -- a staffing agency's placement fee triggers
-- on joining, not interview, and that's the one part of the funnel this
-- feature had left completely unbuilt. Tracking columns only; no new
-- table, reuses the existing offers.joining_date.
ALTER TABLE offers
  ADD COLUMN IF NOT EXISTS joining_reminder_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS joining_confirmation_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS joining_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS joining_confirmation_response TEXT;
