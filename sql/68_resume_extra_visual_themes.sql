-- Resume Generator: 5 additional real visual themes (2026-08-18), on top
-- of the original 3 (classic, modern_sidebar, minimal_ats). Real user
-- ask: add more resume template samples covering the kinds of layouts
-- seen across popular ATS-friendly and Canva-style resume builders.
-- Widens the CHECK constraint to accept the 5 new theme ids.

ALTER TABLE resume_templates DROP CONSTRAINT IF EXISTS resume_templates_visual_theme_check;
ALTER TABLE resume_templates ADD CONSTRAINT resume_templates_visual_theme_check
  CHECK (visual_theme IN (
    'classic', 'modern_sidebar', 'minimal_ats',
    'executive_header', 'two_tone_header', 'timeline', 'compact_grid', 'elegant_serif'
  ));

ALTER TABLE generated_resumes DROP CONSTRAINT IF EXISTS generated_resumes_visual_theme_check;
ALTER TABLE generated_resumes ADD CONSTRAINT generated_resumes_visual_theme_check
  CHECK (visual_theme IN (
    'classic', 'modern_sidebar', 'minimal_ats',
    'executive_header', 'two_tone_header', 'timeline', 'compact_grid', 'elegant_serif'
  ));
