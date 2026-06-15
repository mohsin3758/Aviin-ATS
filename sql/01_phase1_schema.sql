-- ============================================================
-- AIrecruit / FinStack Staffing OS — Phase 1 foundation schema
-- Runs as postgres via docker-entrypoint-initdb.d against `ats`,
-- after 00_app_role.sql (role + extensions already exist).
--
-- Multi-tenancy: every business table has tenant_id UUID NOT NULL
-- with RLS + FORCE RLS, policy:
--   tenant_id = current_setting('app.tenant_id', true)::uuid
-- (fails closed — no app.tenant_id set => no rows, per Architecture
-- Rules in FINSTACK_MASTER_INDEX.md)
-- ============================================================

-- ---------------------------------------------------------------
-- tenants — root reference table, no tenant_id column, no RLS.
-- NOTE for P1 auth: looking up a user by email at login happens
-- before app.tenant_id is known, so the `users` SELECT below would
-- be RLS-blocked. P1 must resolve the tenant first (e.g. a
-- SECURITY DEFINER lookup function, or tenant-by-subdomain/slug)
-- before setting app.tenant_id and querying `users`.
-- ---------------------------------------------------------------
CREATE TABLE tenants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------
-- users
-- ---------------------------------------------------------------
CREATE TABLE users (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  email            TEXT NOT NULL,
  password_hash    TEXT NOT NULL,
  full_name        TEXT NOT NULL,
  role             TEXT NOT NULL CHECK (role IN ('admin','recruiter','manager','client','candidate')),
  capacity_weekly  INT NOT NULL DEFAULT 40,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

-- ---------------------------------------------------------------
-- clients — the staffing agency's own customers
-- ---------------------------------------------------------------
CREATE TABLE clients (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  name        TEXT NOT NULL,
  industry    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------
-- requisitions
-- ---------------------------------------------------------------
CREATE TABLE requisitions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  client_id        UUID REFERENCES clients(id),
  title            TEXT NOT NULL,
  description      TEXT,
  skills_required  TEXT[] NOT NULL DEFAULT '{}',
  location         TEXT,
  employment_type  TEXT NOT NULL DEFAULT 'contract' CHECK (employment_type IN ('contract','fulltime','c2h','fte')),
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','on_hold','filled','closed')),
  positions_count  INT NOT NULL DEFAULT 1,
  sla_hours        INT,
  jd_embedding     vector(384),
  created_by       UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------
-- candidates
-- ---------------------------------------------------------------
CREATE TABLE candidates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  full_name         TEXT NOT NULL,
  email             TEXT,
  phone             TEXT,
  skills            TEXT[] NOT NULL DEFAULT '{}',
  total_exp_mo      INT NOT NULL DEFAULT 0,
  location          TEXT,
  current_employer  TEXT,
  resume_text       TEXT,
  resume_embedding  vector(384),
  source            TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------
-- applications — candidate <-> requisition pipeline
-- ---------------------------------------------------------------
CREATE TABLE applications (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id),
  requisition_id         UUID NOT NULL REFERENCES requisitions(id),
  candidate_id           UUID NOT NULL REFERENCES candidates(id),
  stage                  TEXT NOT NULL DEFAULT 'sourced' CHECK (stage IN ('sourced','screened','submitted','interview','offer','placed','rejected')),
  fit_score              NUMERIC(5,2),
  assigned_recruiter_id  UUID REFERENCES users(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, requisition_id, candidate_id)
);

-- ---------------------------------------------------------------
-- offers — HARD RULE #10: offer issuance is a HITL-gated action
-- ---------------------------------------------------------------
CREATE TABLE offers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  application_id  UUID NOT NULL REFERENCES applications(id),
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved','issued','accepted','declined','rescinded')),
  ctc_offered     NUMERIC(12,2),
  currency        TEXT NOT NULL DEFAULT 'INR',
  joining_date    DATE,
  approved_by     UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------
-- assignments — requisition <-> recruiter (do_reassign target, P1/P3)
-- ---------------------------------------------------------------
CREATE TABLE assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  requisition_id  UUID NOT NULL REFERENCES requisitions(id),
  recruiter_id    UUID NOT NULL REFERENCES users(id),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','reassigned','completed')),
  match_score     NUMERIC(5,2),
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------
-- event_outbox — HARD RULES #5/#6
-- ---------------------------------------------------------------
CREATE TABLE event_outbox (
  id            BIGSERIAL PRIMARY KEY,
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  event_type    TEXT NOT NULL,
  payload       JSONB NOT NULL,
  dedup_key     TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at  TIMESTAMPTZ,
  UNIQUE (tenant_id, dedup_key)
);

-- ---------------------------------------------------------------
-- ai_jobs — Postgres-based async queue for Tier-2 generation (P3 worker)
-- ---------------------------------------------------------------
CREATE TABLE ai_jobs (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  job_type    TEXT NOT NULL,
  payload     JSONB NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','done','failed')),
  result      JSONB,
  error       TEXT,
  attempts    INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_jobs_status_pending ON ai_jobs (status, created_at) WHERE status = 'pending';

-- ---------------------------------------------------------------
-- ai_cache — semantic cache, HARD RULE #4 (>0.95 cosine lookup
-- on prompt_embedding before any Ollama call)
-- ---------------------------------------------------------------
CREATE TABLE ai_cache (
  id                BIGSERIAL PRIMARY KEY,
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  cache_key         TEXT NOT NULL,
  prompt_text       TEXT NOT NULL,
  prompt_embedding  vector(384) NOT NULL,
  response          TEXT NOT NULL,
  model             TEXT NOT NULL,
  hit_count         INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_hit_at       TIMESTAMPTZ
);
CREATE INDEX idx_ai_cache_embedding ON ai_cache USING hnsw (prompt_embedding vector_cosine_ops);

-- ---------------------------------------------------------------
-- audit_log — append-only, partitioned by month
-- ---------------------------------------------------------------
CREATE TABLE audit_log (
  id             BIGSERIAL,
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  actor_user_id  UUID REFERENCES users(id),
  action         TEXT NOT NULL,
  entity_type    TEXT NOT NULL,
  entity_id      UUID,
  before_data    JSONB,
  after_data     JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Current + next month, plus a catch-all so writes never fail if a
-- monthly partition hasn't been created yet (P1+ should add a
-- scheduled job to create the next partition ahead of time).
CREATE TABLE audit_log_2026_06 PARTITION OF audit_log
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE audit_log_2026_07 PARTITION OF audit_log
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE audit_log_default PARTITION OF audit_log DEFAULT;

-- ---------------------------------------------------------------
-- assignment_event — append-only; written on assign/reassign AND on
-- every HITL approval decision (HARD RULE #10)
-- ---------------------------------------------------------------
CREATE TABLE assignment_event (
  id             BIGSERIAL PRIMARY KEY,
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  assignment_id  UUID REFERENCES assignments(id),
  event_type     TEXT NOT NULL,
  reason         TEXT,
  actor_user_id  UUID REFERENCES users(id),
  metadata       JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------
-- consent_records — DPDP 2023, HARD RULE #12 (per data-category
-- consent before storing/processing ANY candidate PII)
-- ---------------------------------------------------------------
CREATE TABLE consent_records (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  candidate_id   UUID REFERENCES candidates(id),
  data_category  TEXT NOT NULL,
  channel        TEXT,
  consent_given  BOOLEAN NOT NULL,
  consent_text   TEXT,
  ip_address     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------
-- Row Level Security — every tenant_id table above, FORCE RLS,
-- fail-closed (Architecture Rule: "every table has tenant_id +
-- FORCE RLS"). Also indexes tenant_id since RLS filters on it for
-- every query.
-- ---------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'users','clients','requisitions','candidates','applications',
    'offers','assignments','event_outbox','ai_jobs','ai_cache',
    'audit_log','assignment_event','consent_records'
  ])
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
      t
    );
    EXECUTE format('CREATE INDEX %I ON %I (tenant_id)', 'idx_' || t || '_tenant', t);
  END LOOP;
END
$$;

-- Vector indexes for match_candidates()/match_recruiters() (P1/P3)
CREATE INDEX idx_candidates_resume_embedding ON candidates USING hnsw (resume_embedding vector_cosine_ops);
CREATE INDEX idx_requisitions_jd_embedding ON requisitions USING hnsw (jd_embedding vector_cosine_ops);
