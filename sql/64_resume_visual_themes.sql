-- Resume Generator: real selectable visual/layout themes (2026-08-18).
-- Separate dimension from resume_templates' existing content-composition
-- fields (name_format/company_mode/project_mode/etc) -- any content
-- template can render in any of these 3 real layouts. Not "clone an
-- arbitrary uploaded sample PDF" (would need vision/AI analysis this
-- zero-token codebase has no local model for) -- a curated set of 3
-- distinct, hand-built layouts covering what was actually asked for: a
-- colorful two-column "showcase" layout and a plain, color-free,
-- single-column layout safe for automated ATS parsers.

ALTER TABLE resume_templates
  ADD COLUMN IF NOT EXISTS visual_theme TEXT NOT NULL DEFAULT 'classic'
    CHECK (visual_theme IN ('classic', 'modern_sidebar', 'minimal_ats'));

ALTER TABLE generated_resumes
  ADD COLUMN IF NOT EXISTS visual_theme TEXT NOT NULL DEFAULT 'classic'
    CHECK (visual_theme IN ('classic', 'modern_sidebar', 'minimal_ats'));
