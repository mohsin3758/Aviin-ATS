-- Unify the two "send resume to KAE" paths' submission tracking (2026-08-12
-- audit): the new Resume Generator's Generate & Submit used to email the
-- KAE directly without ever writing candidate_submissions, so it was
-- invisible in submission history, never bumped the application stage,
-- and undercounted the tracking-sheet sl_no. Both paths now go through the
-- same shared submission core in kae_submission.py (_do_kae_submission),
-- writing to this same table either way.

-- Widen resume_style to also allow a generic marker for resumes produced by
-- the new compositional Resume Generator (not one of the 6 legacy named
-- styles) — the real config detail lives in generated_resumes, linked below.
ALTER TABLE candidate_submissions DROP CONSTRAINT IF EXISTS candidate_submissions_resume_style_check;
ALTER TABLE candidate_submissions ADD CONSTRAINT candidate_submissions_resume_style_check
    CHECK (resume_style = ANY (ARRAY['clean_generated','redacted_original','manual','projects_only','confidential','anonymized','custom_generated']));

ALTER TABLE candidate_submissions ADD COLUMN IF NOT EXISTS generated_resume_id UUID REFERENCES generated_resumes(id);
