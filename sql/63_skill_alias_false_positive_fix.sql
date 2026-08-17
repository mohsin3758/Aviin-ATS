-- REAL BUG FIX (2026-08-18): the DB-backed skills_taxonomy table (used by
-- skill_normalizer.py's cache alongside the Python-hardcoded TECH_SKILLS
-- dict in improved_parser.py) had several dangerously generic bare-word
-- aliases that false-matched ordinary engineering/business vocabulary on
-- non-IT resumes. Found via a real Resume Generator bug report: a Senior
-- Piping Engineer's resume was tagged with "SAP MM, Jenkins, Spring Boot,
-- REST API" -- none of which appear anywhere in the real resume text.
-- Root-caused to:
--   - "spring" (bare) matching "spring hanger design" (a real piping-
--     engineering term for a thermal-expansion pipe support)
--   - "materials management" (bare) matching general EPC/procurement
--     vocabulary with no SAP connection
-- The Python-side companion fix (backend/services/improved_parser.py)
-- also renames the canonical keys "Spring"/"REST" to "Spring Boot"/
-- "REST API" -- removing just the alias wasn't sufficient, since the
-- extractor auto-registers the bare canonical name itself as a
-- matchable keyword too.

UPDATE skills_taxonomy SET aliases = array_remove(aliases, 'spring')
  WHERE skill_name = 'Java';
UPDATE skills_taxonomy SET aliases = array_remove(aliases, 'spring')
  WHERE skill_name = 'Spring Boot';
UPDATE skills_taxonomy SET aliases = array_remove(aliases, 'materials management')
  WHERE skill_name = 'SAP MM';
UPDATE skills_taxonomy SET aliases = array_remove(aliases, 'rest')
  WHERE skill_name = 'REST API';
