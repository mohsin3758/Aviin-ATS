-- Tier-2: 4 named resume-sharing formats (manual / projects_only /
-- confidential / anonymized), replacing the original 2-style
-- clean_generated/redacted_original set from sql/28. Both old values stay
-- valid in the CHECK constraint (existing candidate_submissions history
-- shouldn't become invalid), the new 4 are just additional options.
ALTER TABLE candidate_submissions DROP CONSTRAINT IF EXISTS candidate_submissions_resume_style_check;
ALTER TABLE candidate_submissions ADD CONSTRAINT candidate_submissions_resume_style_check
    CHECK (resume_style IN ('clean_generated', 'redacted_original', 'manual', 'projects_only', 'confidential', 'anonymized'));
