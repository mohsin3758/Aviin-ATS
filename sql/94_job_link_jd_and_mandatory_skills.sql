-- Real feature (2026-08-30): the job-specific public apply form
-- (/apply/{token}) never showed the requisition's own Job Description or
-- Required/Mandatory Skills at all - a candidate applying through a
-- recruiter's job-specific share link had no way to see what the role
-- actually needed. Widens get_job_link_by_token() (sql/90) with the
-- fields already real on requisitions (description, skills_required,
-- mandatory_skills - the last built 2026-08-24) so the public form can
-- surface them, and so the required Skill/Project Experience prompt can
-- be scoped to the role's own mandatory skills, not a generic list.
-- CREATE OR REPLACE FUNCTION cannot change a function's return type (the
-- RETURNS TABLE column list here is genuinely widening) - the same class
-- of migration snag already documented elsewhere in this project (the
-- Offer Letter e-sign fix, 2026-08-23). DROP first, so this migration is
-- idempotent and correct regardless of how many times it's re-run.
DROP FUNCTION IF EXISTS get_job_link_by_token(text);

CREATE OR REPLACE FUNCTION get_job_link_by_token(p_token text)
RETURNS TABLE (tenant_id uuid, recruiter_id uuid, requisition_id uuid,
               recruiter_name text, tenant_name text, requisition_title text,
               req_is_active boolean, req_status text,
               description text, skills_required text[], mandatory_skills text[],
               location text, work_mode text, employment_type text)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT l.tenant_id, l.recruiter_id, l.requisition_id,
         u.full_name, t.name, r.title, r.is_active, r.status,
         r.description, r.skills_required, r.mandatory_skills,
         r.location, r.work_mode::text, r.employment_type::text
  FROM recruiter_job_links l
  JOIN users u ON u.id = l.recruiter_id
  JOIN tenants t ON t.id = l.tenant_id
  JOIN requisitions r ON r.id = l.requisition_id
  WHERE l.token = p_token;
END;
$$;
REVOKE ALL ON FUNCTION get_job_link_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_job_link_by_token(text) TO app_user;
-- CREATE OR REPLACE preserves the existing owner/grants of an
-- already-correct function (only DROP+CREATE would reset them) - this
-- still must run as postgres the FIRST time a function is created, but
-- since get_job_link_by_token already exists and is already
-- postgres-owned (sql/90's own explicit ALTER), a plain REPLACE here is
-- safe regardless of which role runs this migration. Re-asserted anyway,
-- matching this project's established belt-and-suspenders convention:
ALTER FUNCTION get_job_link_by_token(text) OWNER TO postgres;
