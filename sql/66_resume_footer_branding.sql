-- Resume Generator: replace the fixed "Generated via AVIIN ATS" footer
-- text with a real, selectable branding option (2026-08-18). Real user
-- ask: remove the fixed text entirely, keep a real AVIIN Tech logo option
-- alongside a no-branding option. Same pattern as visual_theme
-- (sql/64_resume_visual_themes.sql) -- a real, persisted, validated
-- column on both resume_templates and generated_resumes, not a
-- request-only flag.

ALTER TABLE resume_templates
  ADD COLUMN IF NOT EXISTS footer_branding TEXT NOT NULL DEFAULT 'logo'
    CHECK (footer_branding IN ('logo', 'none'));

ALTER TABLE generated_resumes
  ADD COLUMN IF NOT EXISTS footer_branding TEXT NOT NULL DEFAULT 'logo'
    CHECK (footer_branding IN ('logo', 'none'));
