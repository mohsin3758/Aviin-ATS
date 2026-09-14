-- WhatsApp Screening Blueprint, Milestones 2-4 (Phases 3-7): skill/generic
-- question loop, resume capture, scoring, handoff.
ALTER TABLE screening_sessions ADD COLUMN IF NOT EXISTS current_question_key TEXT;
ALTER TABLE screening_sessions ADD COLUMN IF NOT EXISTS recommendation TEXT CHECK (recommendation IN ('shortlist','reject'));

-- 'completed' is now a real terminal state (resume scored) -- widen the
-- one-active-session-per-candidate partial index to include it, same as
-- the original sql/128 index, so a candidate can be re-enrolled for a
-- different requisition after finishing a screening run.
DROP INDEX IF EXISTS screening_sessions_one_active_per_candidate;
CREATE UNIQUE INDEX IF NOT EXISTS screening_sessions_one_active_per_candidate
    ON screening_sessions (candidate_id)
    WHERE status NOT IN ('declined','opted_out','no_response','bad_number','completed');
