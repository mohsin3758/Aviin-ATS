-- WhatsApp auto-trigger point (2026-09-18, explicit user decision: opt-in
-- per requisition, not blanket-on). A recruiter/admin turns this on for a
-- specific open role; from then on, any candidate newly linked to that
-- requisition via POST /applications is automatically WhatsApp-screening-
-- enrolled (skipped if already enrolled/screened, and skipped -- not
-- blocked -- if the assigning recruiter has no working WhatsApp account
-- connected). See backend/routers/screening.py's
-- maybe_auto_enroll_for_new_application().
ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS auto_screening_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- New enrolled_via value for this trigger path, extending the same CHECK
-- sql/137_screening_followups.sql already widened once for 're_engagement'.
ALTER TABLE screening_sessions DROP CONSTRAINT IF EXISTS screening_sessions_enrolled_via_check;
ALTER TABLE screening_sessions ADD CONSTRAINT screening_sessions_enrolled_via_check
  CHECK (enrolled_via IN ('quick_add','csv_import','bulk_select','re_engagement','auto_role_assignment'));
