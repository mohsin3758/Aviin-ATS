-- Real feature (2026-08-30): the 2 public resume-submission forms
-- (job-specific /apply/{token} and personal /link/{token}) only ever
-- collected Name/Email/Phone/Location/Employer/Experience — reported
-- live with a specific, numbered field list to add (Role Position,
-- Current/Expected CTC, Notice Period, Current/Preferred Location,
-- Expert/Intermediate Skills, LinkedIn Profile), matching the internal
-- Add Candidate form's own established fields where they already exist
-- (expected_ctc, current_ctc, notice_period_days, desired_location,
-- linkedin_url, current_designation all already exist on candidates -
-- only the skill-proficiency split and a distinct "role applying for"
-- concept are genuinely new).
ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS expert_skills text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS intermediate_skills text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS interested_role text;
