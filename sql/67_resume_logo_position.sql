-- Resume Generator: move the logo from the footer to the page header,
-- with a real top-left / top-right placement choice (2026-08-18, same-day
-- follow-up to sql/66_resume_footer_branding.sql). Real user ask, from a
-- screenshot: the logo should sit at the top of the document, not the
-- bottom, and both left and right placement should be selectable.
--
-- Renames footer_branding -> logo_position on both tables (this column
-- was added earlier the same day with near-zero real data yet, so a
-- rename + constraint swap is safe rather than adding a parallel column)
-- and widens the CHECK constraint from ('logo','none') to
-- ('none','top_left','top_right'). Existing 'logo' rows migrate to
-- 'top_right' (a reasonable default direction, not a guess left
-- unresolved); existing 'none' rows are untouched.
--
-- MUST be run as the `postgres` superuser, not `app_user` -- both tables
-- have FORCE ROW LEVEL SECURITY, so the UPDATE statements below silently
-- match 0 rows under app_user with no app.tenant_id set (RLS filters
-- every row out before the WHERE clause even runs), while the later
-- ADD CONSTRAINT step still validates against the real, unfiltered data
-- and fails with "check constraint is violated by some row" -- exactly
-- what happened on first deploy of this migration, caught and fixed live
-- rather than left broken.

ALTER TABLE resume_templates RENAME COLUMN footer_branding TO logo_position;
ALTER TABLE generated_resumes RENAME COLUMN footer_branding TO logo_position;

ALTER TABLE resume_templates DROP CONSTRAINT IF EXISTS resume_templates_footer_branding_check;
ALTER TABLE generated_resumes DROP CONSTRAINT IF EXISTS generated_resumes_footer_branding_check;

UPDATE resume_templates SET logo_position = 'top_right' WHERE logo_position = 'logo';
UPDATE generated_resumes SET logo_position = 'top_right' WHERE logo_position = 'logo';

ALTER TABLE resume_templates ALTER COLUMN logo_position SET DEFAULT 'top_right';
ALTER TABLE resume_templates ADD CONSTRAINT resume_templates_logo_position_check
  CHECK (logo_position IN ('none', 'top_left', 'top_right'));

ALTER TABLE generated_resumes ALTER COLUMN logo_position SET DEFAULT 'top_right';
ALTER TABLE generated_resumes ADD CONSTRAINT generated_resumes_logo_position_check
  CHECK (logo_position IN ('none', 'top_left', 'top_right'));
