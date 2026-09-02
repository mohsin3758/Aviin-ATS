-- Quick-wins from the 2026-09-02 gap audit (Phase 14 findings), part 1.
--
-- 1. applications had no standalone index on stage/candidate_id despite
--    both being filtered constantly by the pipeline board and every
--    stage-move/removal endpoint. Only tenant_id and the composite
--    unique (tenant_id, requisition_id, candidate_id) existed. Adding a
--    real composite index matching the board's own real query shape
--    (WHERE tenant_id=$1 AND requisition_id=$2, grouped/filtered by
--    stage) plus a standalone candidate_id index (used by every
--    candidate-profile/ownership/duplicate-detection join).
--
-- 2. resume_files had ZERO row-level security at all — relrowsecurity=
--    false, zero policies, confirmed live via psql before writing this
--    migration (not assumed). Tenant isolation for real candidate resume
--    files has relied entirely on every query remembering its own
--    WHERE tenant_id=$1 — no DB-level backstop, unlike candidates/
--    applications (both FORCE RLS). Matches the exact tenant_isolation
--    policy shape already used on applications (confirmed via
--    pg_get_expr before writing this), same forced-RLS-on-a-postgres-
--    owned-table pattern this whole project already uses everywhere
--    else. Must be run as postgres (table owner) — a plain app_user
--    connection cannot ALTER TABLE ... ENABLE ROW LEVEL SECURITY on it.

CREATE INDEX IF NOT EXISTS idx_applications_req_stage
  ON applications (tenant_id, requisition_id, stage);

CREATE INDEX IF NOT EXISTS idx_applications_candidate_id
  ON applications (tenant_id, candidate_id);

ALTER TABLE resume_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE resume_files FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON resume_files;
CREATE POLICY tenant_isolation ON resume_files
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);
