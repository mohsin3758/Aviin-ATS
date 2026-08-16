-- Real bug found 2026-08-16 while investigating "Invite New User Failed"
-- reports: role_definitions had ZERO rows for the "Beta Tech Staffing"
-- tenant (539f4aea-646e-4816-a2f6-b476fed0bc51) — meaning every single
-- user-invite attempt on that tenant hit users.py's own real, correct
-- guard (`if not valid_role: raise HTTPException(400, "Role not found")`)
-- for every role, unconditionally. No committed migration anywhere in
-- sql/*.sql ever populated role_definitions for any tenant — it was
-- populated by hand at some point for the primary "Acme Staffing India"
-- tenant only, the same schema-drift/second-tenant-missed-a-fixup
-- pattern documented repeatedly elsewhere in this project's history.
--
-- Backfills every tenant that currently has zero role_definitions rows
-- by copying the full, real 28-role catalog (including each role's real,
-- non-empty `permissions` JSONB and per-role job_visibility_scope
-- overrides — not defaults, confirmed via direct inspection) from
-- whichever tenant already has the most complete real set. Generic, not
-- hardcoded to the one tenant found broken today — any future tenant
-- created with zero roles self-heals the same way.
--
-- Run as postgres (bypasses RLS for this one-off cross-tenant backfill,
-- matching the established pattern for seeding every tenant from a
-- migration, e.g. sql/56's device-monitoring consent backfill).

DO $$
DECLARE
  source_tenant UUID;
  target RECORD;
BEGIN
  -- Canonical source = the tenant with the most role_definitions rows.
  SELECT tenant_id INTO source_tenant
  FROM role_definitions
  GROUP BY tenant_id
  ORDER BY COUNT(*) DESC
  LIMIT 1;

  IF source_tenant IS NULL THEN
    RAISE NOTICE 'No tenant has any role_definitions rows — nothing to copy from, skipping.';
    RETURN;
  END IF;

  FOR target IN
    SELECT t.id FROM tenants t
    WHERE NOT EXISTS (SELECT 1 FROM role_definitions rd WHERE rd.tenant_id = t.id)
      AND t.id <> source_tenant
  LOOP
    INSERT INTO role_definitions
      (tenant_id, role_code, role_name, department, level, description,
       permissions, is_active, is_system, job_visibility_scope)
    SELECT
      target.id, role_code, role_name, department, level, description,
      permissions, is_active, is_system, job_visibility_scope
    FROM role_definitions
    WHERE tenant_id = source_tenant
    ON CONFLICT (tenant_id, role_code) DO NOTHING;

    RAISE NOTICE 'Backfilled role_definitions for tenant %', target.id;
  END LOOP;
END $$;
