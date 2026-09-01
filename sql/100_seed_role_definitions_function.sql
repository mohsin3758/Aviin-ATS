-- REAL FIX for a bug introduced earlier the same session (2026-09-01,
-- QA sweep Phase 0): the first version of the new-tenant role_definitions
-- self-heal (backend/routers/users.py::_ensure_role_definitions_seeded)
-- ran its "find whichever tenant has the most role_definitions rows"
-- query through a tenant-scoped db.tenant_conn(actor.tenant_id) —
-- RLS on role_definitions correctly restricted that connection to ONLY
-- the current (empty) tenant's own rows, so the cross-tenant lookup
-- always returned nothing and the self-heal silently never fired.
-- Confirmed live: GET /roles against a genuine throwaway tenant still
-- returned an empty list after the first fix deployed.
--
-- db.system_conn() (app.tenant_id='') doesn't help here either — it hits
-- the exact same recurring ''::uuid RLS-cast-crash class already
-- documented repeatedly elsewhere in this project for any FORCE RLS
-- table whose policy casts app.tenant_id to ::uuid.
--
-- The correct, already-established pattern for "app_user-level code
-- needs a narrow, safe read/write across tenant boundaries" is a real
-- SECURITY DEFINER function, owned by postgres (which genuinely bypasses
-- RLS, not just app_user with an empty tenant_id) — the same shape as
-- get_client_portal_token/redeem_referral_click/record_email_open
-- elsewhere in this codebase. Copies the real role catalog from
-- whichever tenant currently has the most complete set — identical
-- logic to sql/60's one-time migration, now callable at real request
-- time instead of only as a one-off script.

CREATE OR REPLACE FUNCTION seed_role_definitions_for_tenant(p_tenant_id uuid)
RETURNS void AS $$
DECLARE
  source_tenant UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM role_definitions WHERE tenant_id = p_tenant_id) THEN
    RETURN;  -- already has real rows, nothing to do
  END IF;

  SELECT tenant_id INTO source_tenant
  FROM role_definitions
  GROUP BY tenant_id
  ORDER BY COUNT(*) DESC
  LIMIT 1;

  IF source_tenant IS NULL THEN
    RETURN;  -- no tenant has any role_definitions rows to copy from
  END IF;

  INSERT INTO role_definitions
    (tenant_id, role_code, role_name, department, level, description,
     permissions, is_active, is_system, job_visibility_scope)
  SELECT
    p_tenant_id, role_code, role_name, department, level, description,
    permissions, is_active, is_system, job_visibility_scope
  FROM role_definitions
  WHERE tenant_id = source_tenant
  ON CONFLICT (tenant_id, role_code) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER FUNCTION seed_role_definitions_for_tenant(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION seed_role_definitions_for_tenant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION seed_role_definitions_for_tenant(uuid) TO app_user;
