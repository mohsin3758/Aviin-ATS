-- Advanced Reminder, Follow-Up & Notification Management System — Phase 1
-- Built on top of the existing recruiter_tasks entity (already wired into
-- Recruiter Ops "My Day", load-balanced auto-assign, notifications) rather
-- than a second, competing "follow_ups" table — same "one shared engine,
-- not two" principle applied throughout this project's history.
--
-- Reuses: notifications (in-app/whatsapp/email/sms delivery, sms channel
-- already has a real MSG91 service — see backend/services/sms_service.py),
-- the sla_escalations tier1/tier2 pattern (generalized here to 4 tiers for
-- any follow-up task, not just SLA breaches), client_owners (kae/
-- account_manager resolution for tier-3 escalation), users.reporting_to
-- (tier-2 manager resolution, same convention as HARD RULE #10 approval
-- chains and the earlier tier-1 SLA notification path).

-- ── 1. Extend recruiter_tasks into the real Follow-Up entity ──────────────
ALTER TABLE recruiter_tasks
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS follow_up_reason text,
  ADD COLUMN IF NOT EXISTS reminder_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS rescheduled_from timestamptz,
  ADD COLUMN IF NOT EXISTS reschedule_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recurrence_rule text,   -- 'daily'|'weekly'|'monthly'|'quarterly'|'yearly'|'every_N_days:<N>'|NULL
  ADD COLUMN IF NOT EXISTS recurrence_parent_id uuid REFERENCES recruiter_tasks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ai_suggested boolean NOT NULL DEFAULT false;

-- Real, validated priority levels (was an unconstrained varchar — only
-- 'low'/'medium' ever actually used in production, confirmed via direct
-- query before writing this constraint, so this is a genuine tightening,
-- not a breaking change against real data).
ALTER TABLE recruiter_tasks DROP CONSTRAINT IF EXISTS recruiter_tasks_priority_check;
ALTER TABLE recruiter_tasks ADD CONSTRAINT recruiter_tasks_priority_check
  CHECK (priority IN ('low', 'medium', 'high', 'critical'));

-- 'rescheduled' added; 'overdue' deliberately NOT stored — it's a function
-- of (status IN ('pending','in_progress') AND due_at < now()), computed at
-- read time everywhere it's needed, to avoid a second, driftable source of
-- truth for the exact same fact.
ALTER TABLE recruiter_tasks DROP CONSTRAINT IF EXISTS recruiter_tasks_status_check;
ALTER TABLE recruiter_tasks ADD CONSTRAINT recruiter_tasks_status_check
  CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled', 'rescheduled'));

CREATE INDEX IF NOT EXISTS idx_rtasks_due_at ON recruiter_tasks (tenant_id, due_at) WHERE status IN ('pending','in_progress');
CREATE INDEX IF NOT EXISTS idx_rtasks_reminder_at ON recruiter_tasks (tenant_id, reminder_at) WHERE reminder_sent_at IS NULL AND reminder_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rtasks_client ON recruiter_tasks (tenant_id, client_id) WHERE client_id IS NOT NULL;

-- ── 2. Generalized 4-level escalation for any overdue follow-up task ──────
-- Mirrors sla_escalations' proven tier1_fired_at/tier2_fired_at pattern,
-- widened to 4 tiers: assigned user (fires at reminder_at / due_at, not
-- tracked here — that's reminder_sent_at above) -> reporting manager ->
-- the client's KAE/KAM (via client_owners) -> admin.
CREATE TABLE IF NOT EXISTS task_escalations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  task_id           uuid NOT NULL REFERENCES recruiter_tasks(id) ON DELETE CASCADE,
  first_overdue_at  timestamptz NOT NULL DEFAULT now(),
  tier1_fired_at    timestamptz,   -- assigned user reminded
  tier2_fired_at    timestamptz,   -- reporting manager notified
  tier3_fired_at    timestamptz,   -- client's KAE/KAM notified
  tier4_fired_at    timestamptz,   -- admin notified
  resolved_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, task_id)
);
ALTER TABLE task_escalations ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_escalations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON task_escalations;
CREATE POLICY tenant_isolation ON task_escalations
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);

-- Tenant-tunable grace periods between tiers (hours), matching the same
-- "config table with a sensible seeded default" convention already used
-- by scoring_weight_config/sla_tier_config elsewhere in this codebase.
CREATE TABLE IF NOT EXISTS escalation_config (
  tenant_id           uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  tier1_grace_hours   int NOT NULL DEFAULT 0,    -- fires immediately at due_at
  tier2_grace_hours   int NOT NULL DEFAULT 24,   -- manager, 1 day overdue
  tier3_grace_hours   int NOT NULL DEFAULT 72,   -- KAE/KAM, 3 days overdue
  tier4_grace_hours   int NOT NULL DEFAULT 168,  -- admin, 7 days overdue
  critical_multiplier numeric(3,2) NOT NULL DEFAULT 0.5, -- critical-priority tasks escalate 2x faster
  updated_at          timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE escalation_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalation_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON escalation_config;
CREATE POLICY tenant_isolation ON escalation_config
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);
INSERT INTO escalation_config (tenant_id)
  SELECT id FROM tenants ON CONFLICT (tenant_id) DO NOTHING;

-- ── 3. Document expiry tracking (NDA/contract/visa/certification/offer/KYC) ──
CREATE TABLE IF NOT EXISTS document_expiry_tracking (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  candidate_id     uuid REFERENCES candidates(id) ON DELETE CASCADE,
  document_type    text NOT NULL CHECK (document_type IN
                     ('nda', 'contract', 'visa', 'certification', 'offer_letter', 'kyc')),
  document_name    text NOT NULL,
  reference_table  text,           -- e.g. 'nda_documents' — informational only, no FK (cross-table by design)
  reference_id     uuid,
  expires_at       date NOT NULL,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'renewed', 'cancelled')),
  alert_90d_sent_at timestamptz,
  alert_30d_sent_at timestamptz,
  alert_7d_sent_at  timestamptz,
  alert_1d_sent_at  timestamptz,
  notes            text,
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE document_expiry_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_expiry_tracking FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON document_expiry_tracking;
CREATE POLICY tenant_isolation ON document_expiry_tracking
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);
CREATE INDEX IF NOT EXISTS idx_doc_expiry_upcoming ON document_expiry_tracking (tenant_id, expires_at) WHERE status = 'active';

-- ── 4. Interview reminder timing config (was hardcoded 24h-only) ──────────
CREATE TABLE IF NOT EXISTS interview_reminder_config (
  tenant_id        uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  lead_times_hours numeric[] NOT NULL DEFAULT ARRAY[24, 2, 0.5], -- 24h, 2h, 30min before
  updated_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE interview_reminder_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_reminder_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON interview_reminder_config;
CREATE POLICY tenant_isolation ON interview_reminder_config
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);
INSERT INTO interview_reminder_config (tenant_id)
  SELECT id FROM tenants ON CONFLICT (tenant_id) DO NOTHING;

-- Tracks which (interview_id, lead_time_hours) pairs have already fired,
-- so a 30-min-lead reminder job tick doesn't re-send the same alert twice.
CREATE TABLE IF NOT EXISTS interview_reminder_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  interview_id     uuid NOT NULL REFERENCES interview_schedules(id) ON DELETE CASCADE,
  lead_time_hours  numeric NOT NULL,
  sent_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, interview_id, lead_time_hours)
);
ALTER TABLE interview_reminder_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_reminder_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON interview_reminder_log;
CREATE POLICY tenant_isolation ON interview_reminder_log
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);
