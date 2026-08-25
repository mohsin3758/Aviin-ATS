-- Skill / Project Experience table (2026-08-25, real spec pasted with a
-- sample screenshot: Sl.No/Skill-Technology/Project Name/Project
-- Duration (From-To)/Role (Implementation/Support/Enhancement/Rollout)/
-- Relevant Experience/Last Used). Built as its own child table rather
-- than folded into candidates.skills (a flat text[] tag list, wrong
-- shape for structured per-skill project history) - one row per real
-- skill+project combination a recruiter records, edited as a whole set
-- (full delete+reinsert on save, matching this project's established
-- pattern for small per-candidate child lists with no cross-references
-- from anywhere else). duration_from/duration_to/relevant_experience/
-- last_used are all free text on purpose - real recruiter input is
-- inherently messy ("Jan 2024", "2024", "Current", "8 Years",
-- "6 months"), and forcing strict date/number typing would just reject
-- realistic input for no real benefit.

CREATE TABLE IF NOT EXISTS candidate_skill_experience (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID NOT NULL,
    candidate_id          UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    skill_name            TEXT NOT NULL,
    project_name          TEXT,
    duration_from         TEXT,
    duration_to           TEXT,
    role_types            TEXT[] DEFAULT '{}'::text[],
    relevant_experience   TEXT,
    last_used             TEXT,
    sort_order            INT DEFAULT 0,
    created_at            TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_candidate_skill_experience_candidate ON candidate_skill_experience(candidate_id);

ALTER TABLE candidate_skill_experience ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_skill_experience FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS candidate_skill_experience_isolation ON candidate_skill_experience;
CREATE POLICY candidate_skill_experience_isolation ON candidate_skill_experience
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL ON TABLE candidate_skill_experience TO app_user;
