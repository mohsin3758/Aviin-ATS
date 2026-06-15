-- ============================================================
-- AIrecruit / FinStack Staffing OS — Phase 1 (P1) additions
-- Runs after 01_phase1_schema.sql + 10_phase1_staffing_additions.sql
-- (depends on tenants, users, applications).
--
-- The P0 pgdata volume already has data, so this file will NOT run
-- via docker-entrypoint-initdb.d on the existing dev DB. Apply it
-- manually once:
--   docker compose exec db psql -U postgres -d ats \
--     -f /docker-entrypoint-initdb.d/02_phase1_p1_additions.sql
-- (sql/ is bind-mounted read-only at /docker-entrypoint-initdb.d).
-- On a fresh deploy it runs automatically in filename order.
-- ============================================================

-- ---------------------------------------------------------------
-- interview_scorecards — P1 (structured interview kits/scorecards)
-- ---------------------------------------------------------------
CREATE TABLE interview_scorecards (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  application_id  UUID NOT NULL REFERENCES applications(id),
  interviewer_id  UUID REFERENCES users(id),
  round           TEXT NOT NULL DEFAULT 'L1',
  scores          JSONB NOT NULL DEFAULT '{}',
  overall_rating  NUMERIC(3,1),
  recommendation  TEXT CHECK (recommendation IN ('strong_yes','yes','neutral','no','strong_no')),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  ALTER TABLE interview_scorecards ENABLE ROW LEVEL SECURITY;
  ALTER TABLE interview_scorecards FORCE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON interview_scorecards
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  CREATE INDEX idx_interview_scorecards_tenant ON interview_scorecards (tenant_id);
END
$$;

-- ---------------------------------------------------------------
-- auth_lookup_user — P1 login-time tenant resolution.
--
-- SECURITY DEFINER + owned by postgres (superuser) => bypasses RLS,
-- so the user-by-email lookup can run BEFORE app.tenant_id is known
-- (see NOTE for P1 auth at the top of 01_phase1_schema.sql). Email is
-- only UNIQUE per-tenant (UNIQUE (tenant_id, email)), so this returns
-- the oldest matching active user across tenants if an email string
-- happens to collide between tenants.
-- ---------------------------------------------------------------
CREATE FUNCTION auth_lookup_user(p_email TEXT)
RETURNS TABLE (
  user_id        UUID,
  tenant_id      UUID,
  password_hash  TEXT,
  role           TEXT,
  full_name      TEXT,
  is_active      BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, tenant_id, password_hash, role, full_name, is_active
  FROM users
  WHERE email = p_email AND is_active = TRUE
  ORDER BY created_at ASC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION auth_lookup_user(TEXT) TO app_user;
