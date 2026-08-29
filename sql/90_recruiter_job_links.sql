-- Job-specific candidate resume link (2026-08-28) — the same standard
-- resume-drop form as recruiter_personal_links (sql/81), but scoped to one
-- specific requisition and creating a real application on submit, not just
-- a bare candidate. Real user report: sharing a job needed either the full
-- public Career Page apply flow (referral_links -> /careers/{id}) or
-- nothing simple/attributed. This is a second, parallel option using the
-- exact same clean form design, not a replacement for the Career Page.

CREATE TABLE IF NOT EXISTS recruiter_job_links (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  recruiter_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requisition_id    uuid NOT NULL REFERENCES requisitions(id) ON DELETE CASCADE,
  token             text NOT NULL UNIQUE,
  submission_count  integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, recruiter_id, requisition_id)
);
ALTER TABLE recruiter_job_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruiter_job_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON recruiter_job_links;
CREATE POLICY tenant_isolation ON recruiter_job_links
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);
CREATE INDEX IF NOT EXISTS idx_recruiter_job_links_token ON recruiter_job_links (token);

-- Same anonymous-token-resolves-tenant SECURITY DEFINER pattern as
-- get_personal_link_by_token() (sql/81) — the public landing page has no
-- app.tenant_id set yet, and this table is genuinely FORCE RLS.
CREATE OR REPLACE FUNCTION get_job_link_by_token(p_token text)
RETURNS TABLE (tenant_id uuid, recruiter_id uuid, requisition_id uuid,
               recruiter_name text, tenant_name text, requisition_title text,
               req_is_active boolean, req_status text)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT l.tenant_id, l.recruiter_id, l.requisition_id,
         u.full_name, t.name, r.title, r.is_active, r.status
  FROM recruiter_job_links l
  JOIN users u ON u.id = l.recruiter_id
  JOIN tenants t ON t.id = l.tenant_id
  JOIN requisitions r ON r.id = l.requisition_id
  WHERE l.token = p_token;
END;
$$;
REVOKE ALL ON FUNCTION get_job_link_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_job_link_by_token(text) TO app_user;

-- IMPORTANT: the CREATE FUNCTION above must run as postgres, not app_user.
-- Real bug found live (2026-08-28): CREATE OR REPLACE FUNCTION does NOT
-- change an existing function's owner, so a first run as app_user (the
-- table-owning role for most of this schema) leaves the function itself
-- owned by app_user - and since this function's body joins requisitions
-- (FORCE ROW LEVEL SECURITY), the public /public/job-links/{token} caller
-- (db.system_conn(), app.tenant_id='') hit a real crash: casting '' to
-- ::uuid inside the RLS policy check, the same class of bug documented
-- repeatedly elsewhere in this project. get_personal_link_by_token()
-- (sql/81) never hit this because it only touches users/tenants, not a
-- FORCE RLS table. Fixed with an explicit ALTER, so this migration is
-- correct however it's run:
ALTER FUNCTION get_job_link_by_token(text) OWNER TO postgres;
