-- Real per-feature, per-role access control (Settings > Permissions).
-- role_definitions.permissions (JSONB, 27 seeded staffing roles) already
-- existed with genuinely detailed feature->action maps, but nothing in
-- the whole backend ever read it — zero enforcement, zero admin UI to
-- edit it. Found during a direct user request to check whether role-
-- based feature access actually worked; it didn't.
--
-- Soft-launch design (user's explicit choice over immediate strict
-- enforcement): a per-tenant kill switch defaulting OFF, so shipping
-- this never immediately restricts anyone. Denials are logged either
-- way (via permission_check_log) so an admin can review real usage
-- before flipping enforcement on for real.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS permission_enforcement_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS permission_check_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    role_code TEXT,
    feature TEXT NOT NULL,
    action TEXT NOT NULL,
    route TEXT,
    would_have_blocked BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_permission_check_log_tenant ON permission_check_log(tenant_id, created_at DESC);

ALTER TABLE permission_check_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE permission_check_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON permission_check_log;
CREATE POLICY tenant_isolation ON permission_check_log
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);

-- Real gap found while checking this: 'manager' is an actively-used real
-- role (a genuine active user has it in production) but had ZERO
-- role_definitions row at all — not one of the 27 seeded staffing roles.
-- Under any future strict enforcement this would have locked that person
-- out of everything the instant it shipped. Seeded with permissions
-- modeled on the closest existing role (recruitment_manager) as a
-- reasonable starting point — the new Settings > Permissions UI is where
-- this should actually be reviewed and adjusted, not this migration.
INSERT INTO role_definitions (tenant_id, role_code, role_name, department, level, description, permissions, is_system)
SELECT DISTINCT u.tenant_id, 'manager', 'Manager', 'Delivery', 4,
       'Legacy manager role — permissions seeded as a starting point, review in Settings > Permissions.',
       '{"pipeline": ["read","update","delete"], "analytics": ["read","export"], "candidates": ["create","read","update","delete"], "companies": ["read","update"], "incentives": ["read"], "assessments": ["read","update"], "requisitions": ["read","update","delete"]}'::jsonb,
       false
FROM users u
WHERE u.role = 'manager'
  AND NOT EXISTS (
    SELECT 1 FROM role_definitions rd WHERE rd.tenant_id = u.tenant_id AND rd.role_code = 'manager'
  );

-- 'companies' is a new feature key (the Companies page, backed by
-- /clients) that predates this permission system and was never added to
-- any role's permissions — add a sensible minimum (read) to 'recruiter'
-- specifically since real recruiters use it today; every other role is
-- left for the admin to configure via the new UI since nothing else is
-- actually assigned to a real user yet.
UPDATE role_definitions
SET permissions = permissions || '{"companies": ["read"]}'::jsonb
WHERE role_code = 'recruiter' AND NOT (permissions ? 'companies');
