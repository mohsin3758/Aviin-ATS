-- Real feature (2026-09-09, Skill Verification Panel Phase 3 — see
-- roadmap: https://claude.ai/code/artifact/86b41cc7-ffc4-44cb-8fb1-016210c75683).
-- The recruiter's real shortlist decision checks not just "does the
-- candidate have this mandatory skill" but "have they used it long
-- enough" — e.g. "5 years of Java required." requisitions.mandatory_skills
-- (sql/80) is only a flat list of skill NAMES with no per-skill minimum-
-- years attached, and the only existing experience field is a single
-- whole-candidate experience_min/experience_max on the requisition, not
-- scoped to any one skill.
--
-- JSONB keyed by skill name, {"Java": 5, "Spring Boot": 3} — deliberately
-- sparse: a mandatory skill with no entry here has no additional
-- experience threshold, only the plain presence check. Not a child
-- table: this mirrors the same flat-column convention already used for
-- mandatory_skills itself (sql/80) rather than introducing a new table
-- for what's still small, JD-scoped, whole-set-edited data.
ALTER TABLE requisitions
  ADD COLUMN IF NOT EXISTS mandatory_skill_min_years JSONB NOT NULL DEFAULT '{}'::jsonb;
