-- ============================================================
-- AIrecruit / FinStack Staffing OS — app role + extensions
-- Runs first (00_) as the postgres superuser via
-- docker-entrypoint-initdb.d against the `ats` database.
-- HARD RULE #9: app code connects ONLY as app_user, never postgres.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user WITH LOGIN PASSWORD 'apppw';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE ats TO app_user;
GRANT USAGE, CREATE ON SCHEMA public TO app_user;

-- Tables/sequences/functions created after this point by the
-- initializing role (postgres, running these init scripts) are
-- automatically usable by app_user.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO app_user;

-- pgcrypto: gen_random_uuid() + future Aadhaar/PAN/PF/bank field
-- encryption (HARD RULE #11, P12/P13).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- vector: pgvector for BGE-small 384-dim embeddings (HARD RULE #3).
CREATE EXTENSION IF NOT EXISTS vector;
