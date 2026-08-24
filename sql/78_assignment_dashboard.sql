-- Assignment Dashboard (2026-08-24) — built off a real research pass (internal
-- gap audit + external industry comparison against Bullhorn/CEIPAL/JobDiva/
-- Vincere/Crelate patterns). Deliberately minimal schema footprint — almost
-- everything needed (AI-vs-manual, workload, client responsiveness) is
-- computable from tables that already exist:
--   - AI vs Manual        -> assignment_event.metadata->>'reason' (already written)
--   - client responsiveness -> client_feedback.created_at vs submittals.submitted_at
--     (both real, live tables — client_feedback has no committed migration at
--     all, schema pulled live via psql \d before writing any query against it)
--   - desk/team grouping  -> users.department (already real, already used in
--     5 other places: Candidates filter, Headcount, Permissions groups, Users
--     list, Profile)
-- The ONE genuinely new thing needed: a dedup marker so the leave-conflict
-- scheduler job (flags an ALREADY-active assignment when its recruiter goes
-- on leave) doesn't re-notify on every daily run for the same leave record.

ALTER TABLE recruiter_leave ADD COLUMN IF NOT EXISTS conflict_notified_at TIMESTAMPTZ;

-- Explicitly NOT built here: co-recruiter/secondary-assignee support. That
-- needs relaxing assignments_one_active_per_requisition (a real, deliberate
-- unique-per-requisition constraint added 2026-08-10 specifically to fix a
-- self-amplifying data-corruption bug) — flagged in research as needing its
-- own separate decision, not folded into this migration.
