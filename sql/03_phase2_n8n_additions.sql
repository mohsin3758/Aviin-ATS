-- ============================================================
-- AIrecruit / FinStack Staffing OS — Phase 2 (P2) additions
-- n8n automation: notifications queue + job-board distribution
-- queue + T0 SQL helpers for the SLA/stalled-assignment monitor
-- workflows (W7/W8).
--
-- The P0/P1 pgdata volume already has data, so this file will NOT
-- run via docker-entrypoint-initdb.d on the existing dev DB. Apply
-- it manually once:
--   docker compose exec db psql -U postgres -d ats \
--     -f /docker-entrypoint-initdb.d/03_phase2_n8n_additions.sql
-- (sql/ is bind-mounted read-only at /docker-entrypoint-initdb.d).
-- On a fresh deploy it runs automatically in filename order.
-- ============================================================

-- ---------------------------------------------------------------
-- notifications — in-app notification queue written by n8n
-- workflows W1-W8. channel='inapp' for now; P11 will add a WAHA/
-- SMTP delivery worker that picks up rows here, sends via
-- WhatsApp/email/SMS (after consent_records check, HARD RULE #7),
-- and flips status 'pending' -> 'sent'/'failed' + sets sent_at.
-- A row targets either a specific recipient_user_id OR broadcasts
-- to everyone with recipient_role in the tenant (frontend P4+
-- queries WHERE recipient_user_id = me OR recipient_role = my_role).
-- ---------------------------------------------------------------
CREATE TABLE notifications (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id),
  recipient_user_id    UUID REFERENCES users(id),
  recipient_role       TEXT CHECK (recipient_role IN ('admin','recruiter','manager','client','candidate')),
  channel              TEXT NOT NULL DEFAULT 'inapp' CHECK (channel IN ('inapp','whatsapp','email','sms')),
  title                TEXT NOT NULL,
  body                 TEXT,
  related_entity_type  TEXT,
  related_entity_id    UUID,
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at              TIMESTAMPTZ,
  CHECK (recipient_user_id IS NOT NULL OR recipient_role IS NOT NULL)
);

-- ---------------------------------------------------------------
-- job_board_postings — W9 distribution queue. n8n inserts a
-- 'queued' row per board when a requisition is created; NO external
-- Naukri/Indeed/LinkedIn API calls are made (no credentials exist
-- yet and adding them is out of scope for P2 — zero-token/zero-cost,
-- purely additive scaffold for a future P11+ delivery worker).
-- ---------------------------------------------------------------
CREATE TABLE job_board_postings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  requisition_id  UUID NOT NULL REFERENCES requisitions(id),
  board           TEXT NOT NULL CHECK (board IN ('naukri','indeed','linkedin')),
  status          TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','posted','failed')),
  external_ref    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, requisition_id, board)
);

DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY['notifications','job_board_postings'])
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

CREATE INDEX idx_notifications_pending ON notifications (tenant_id, status) WHERE status = 'pending';

-- ---------------------------------------------------------------
-- find_stalled_assignments(p_hours) — T0, used by W7. Active
-- assignments on still-open requisitions with no progress
-- (updated_at) for p_hours hours. RLS-scoped via SECURITY INVOKER
-- (default): caller (n8n, as app_user) must SET app.tenant_id first
-- (HARD RULE #8) — this function only ever sees that tenant's rows.
-- Flags for human review only; per HARD RULE #10 no auto-reassign.
-- ---------------------------------------------------------------
CREATE FUNCTION find_stalled_assignments(p_hours INT)
RETURNS TABLE (
  assignment_id      UUID,
  requisition_id     UUID,
  requisition_title  TEXT,
  recruiter_id       UUID,
  recruiter_name     TEXT,
  recruiter_email    TEXT,
  assigned_at        TIMESTAMPTZ,
  hours_since_update NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  SELECT a.id, a.requisition_id, r.title, a.recruiter_id, u.full_name, u.email,
         a.assigned_at,
         ROUND(EXTRACT(EPOCH FROM (now() - a.updated_at)) / 3600, 1)
  FROM assignments a
  JOIN requisitions r ON r.id = a.requisition_id
  JOIN users u ON u.id = a.recruiter_id
  WHERE a.status = 'active'
    AND r.status = 'open'
    AND a.updated_at < now() - (p_hours || ' hours')::interval;
$$;

-- ---------------------------------------------------------------
-- find_sla_breaches() — T0, used by W8. Open requisitions past
-- their sla_hours with fewer active/converted placements than
-- positions_count. RLS-scoped the same way as above.
-- ---------------------------------------------------------------
CREATE FUNCTION find_sla_breaches()
RETURNS TABLE (
  requisition_id    UUID,
  title             TEXT,
  client_id         UUID,
  sla_hours         INT,
  hours_open        NUMERIC,
  positions_count   INT,
  placements_count  BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT r.id, r.title, r.client_id, r.sla_hours,
         ROUND(EXTRACT(EPOCH FROM (now() - r.created_at)) / 3600, 1),
         r.positions_count,
         COUNT(p.id)
  FROM requisitions r
  LEFT JOIN placements p
    ON p.requisition_id = r.id AND p.status IN ('active','ending_soon','converted_fte')
  WHERE r.status = 'open'
    AND r.sla_hours IS NOT NULL
    AND r.created_at < now() - (r.sla_hours || ' hours')::interval
  GROUP BY r.id, r.title, r.client_id, r.sla_hours, r.created_at, r.positions_count
  HAVING COUNT(p.id) < r.positions_count;
$$;
