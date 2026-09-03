-- ============================================================================
-- Enterprise Email Management, Tracking & Reporting System (2026-09-03)
-- Closes the 11+ real gaps found in the same-day audit against:
--   "Enterprise Email Management, Tracking & Reporting System" spec.
-- Extends the existing candidate_messages/imap_messages/message_drafts/
-- recruiter_tasks tables rather than building a parallel messaging system,
-- matching this project's own established "one shared engine, not two"
-- discipline (Resume Generator, KAE Review Queue, Reminders, etc.).
--
-- Run as `postgres` — candidate_messages/imap_messages/message_drafts are
-- postgres-owned (confirmed via pg_tables before writing this), and every
-- new table below gets FORCE ROW LEVEL SECURITY regardless of owner, so a
-- non-owner (app_user) query is always correctly tenant-isolated either way.
-- Idempotent throughout (IF NOT EXISTS / DO $$ ... EXCEPTION guards) so a
-- repeat run is a safe no-op, matching this project's established migration
-- discipline.
-- ============================================================================

-- ── 1. email_threads — the real conversation-grouping entity ────────────────
-- One row per (candidate OR client) + normalized-subject conversation.
-- candidate_messages/imap_messages rows attach via thread_id; the 2 tables
-- stay separate storage, this is just the connective layer.
CREATE TABLE IF NOT EXISTS email_threads (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    candidate_id      UUID REFERENCES candidates(id) ON DELETE SET NULL,
    client_id         UUID REFERENCES clients(id) ON DELETE SET NULL,
    client_contact_id UUID REFERENCES client_contacts(id) ON DELETE SET NULL,
    thread_type       VARCHAR(20) NOT NULL DEFAULT 'candidate'
                        CHECK (thread_type IN ('candidate', 'client')),
    subject           TEXT,
    subject_key       TEXT,            -- normalized (Re:/Fwd: stripped, lowercased)
    created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_activity_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_direction    VARCHAR(10),
    message_count     INT NOT NULL DEFAULT 0,
    reply_count       INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ethreads_tenant ON email_threads(tenant_id, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_ethreads_candidate ON email_threads(tenant_id, candidate_id) WHERE candidate_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ethreads_client ON email_threads(tenant_id, client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ethreads_subject_key ON email_threads(tenant_id, subject_key) WHERE subject_key IS NOT NULL;

ALTER TABLE email_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_threads FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON email_threads;
CREATE POLICY tenant_isolation ON email_threads
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);


-- ── 2. candidate_messages — threading, tracking, client linkage ─────────────
ALTER TABLE candidate_messages
  ADD COLUMN IF NOT EXISTS thread_id UUID REFERENCES email_threads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS client_contact_id UUID REFERENCES client_contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recipient_type VARCHAR(20) DEFAULT 'candidate'
    CHECK (recipient_type IN ('candidate', 'client', 'internal', 'other')),
  ADD COLUMN IF NOT EXISTS message_id_header TEXT,
  ADD COLUMN IF NOT EXISTS in_reply_to TEXT,
  ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reply_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS forwarded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS forward_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bounced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bounce_reason TEXT,
  ADD COLUMN IF NOT EXISTS link_click_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_link_click_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_link_click_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attachment_download_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_attachment_download_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_attachment_download_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;

-- A real Message-ID is only meaningful once per row; NULL (whatsapp/manual-
-- log rows, or a pre-migration historical email) is never unique-checked.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cm_message_id_header
  ON candidate_messages(message_id_header) WHERE message_id_header IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cm_thread ON candidate_messages(thread_id) WHERE thread_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cm_client ON candidate_messages(tenant_id, client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cm_last_activity ON candidate_messages(tenant_id, last_activity_at DESC) WHERE last_activity_at IS NOT NULL;

-- Backfill last_activity_at for existing rows so the new sort/report
-- queries have a real value to work with immediately, not NULL for every
-- historical message.
UPDATE candidate_messages SET last_activity_at = COALESCE(email_opened_at, created_at)
  WHERE last_activity_at IS NULL;


-- ── 3. imap_messages — header capture for reply/bounce correlation ─────────
ALTER TABLE imap_messages
  ADD COLUMN IF NOT EXISTS message_id_header TEXT,
  ADD COLUMN IF NOT EXISTS in_reply_to TEXT,
  ADD COLUMN IF NOT EXISTS matched_message_id UUID REFERENCES candidate_messages(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_imap_in_reply_to ON imap_messages(tenant_id, in_reply_to) WHERE in_reply_to IS NOT NULL;


-- ── 4. client_engagement_scores — High/Medium/Low/Inactive per client ──────
CREATE TABLE IF NOT EXISTS client_engagement_scores (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    client_id               UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    period_start            DATE NOT NULL,
    period_end              DATE NOT NULL,
    emails_sent             INT NOT NULL DEFAULT 0,
    emails_opened           INT NOT NULL DEFAULT 0,
    emails_replied          INT NOT NULL DEFAULT 0,
    attachments_downloaded  INT NOT NULL DEFAULT 0,
    avg_response_hours      NUMERIC,
    open_rate               NUMERIC,
    reply_rate              NUMERIC,
    engagement_score        NUMERIC NOT NULL DEFAULT 0,
    engagement_level        VARCHAR(20) NOT NULL DEFAULT 'inactive'
                               CHECK (engagement_level IN ('high', 'medium', 'low', 'inactive')),
    computed_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, client_id, period_start, period_end)
);
CREATE INDEX IF NOT EXISTS idx_ces_tenant ON client_engagement_scores(tenant_id, period_end DESC);

ALTER TABLE client_engagement_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_engagement_scores FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON client_engagement_scores;
CREATE POLICY tenant_isolation ON client_engagement_scores
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);


-- ── 5. email_report_snapshots — real audit trail of scheduled reports ──────
CREATE TABLE IF NOT EXISTS email_report_snapshots (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    report_type       VARCHAR(30) NOT NULL,   -- 'daily'|'weekly'|'monthly'|'kae_performance'|'client_activity'
    period_start      DATE,
    period_end        DATE,
    snapshot_data     JSONB NOT NULL DEFAULT '{}'::jsonb,
    generated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    delivered_to      TEXT[],
    delivery_status   VARCHAR(20) DEFAULT 'generated'
);
CREATE INDEX IF NOT EXISTS idx_ers_tenant ON email_report_snapshots(tenant_id, generated_at DESC);

ALTER TABLE email_report_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_report_snapshots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON email_report_snapshots;
CREATE POLICY tenant_isolation ON email_report_snapshots
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);


-- ── 6. email_report_schedule_config — opt-in scheduled report recipients ───
CREATE TABLE IF NOT EXISTS email_report_schedule_config (
    tenant_id         UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    daily_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
    weekly_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
    monthly_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
    recipient_emails  TEXT[] NOT NULL DEFAULT '{}',
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by        UUID REFERENCES users(id) ON DELETE SET NULL
);

ALTER TABLE email_report_schedule_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_report_schedule_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON email_report_schedule_config;
CREATE POLICY tenant_isolation ON email_report_schedule_config
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);


-- ── 7. message_drafts — real scheduled send ─────────────────────────────────
ALTER TABLE message_drafts
  ADD COLUMN IF NOT EXISTS scheduled_send_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_scheduled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS send_error TEXT,
  ADD COLUMN IF NOT EXISTS application_id UUID REFERENCES applications(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES email_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stage VARCHAR(50),
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_drafts_scheduled ON message_drafts(scheduled_send_at)
  WHERE is_scheduled AND sent_at IS NULL;


-- ── 8. recruiter_tasks — link a follow-up to the real thread it's about ────
ALTER TABLE recruiter_tasks
  ADD COLUMN IF NOT EXISTS related_thread_id UUID REFERENCES email_threads(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_rtasks_thread ON recruiter_tasks(related_thread_id) WHERE related_thread_id IS NOT NULL;


-- ── 9. Real, tenant-wide SLA view: client-wise avg/fastest/longest-pending ──
-- security_invoker=true throughout this project's own hard-learned lesson
-- (v_recruiter_capacity/v_monthly_billing/v_sla_dashboard all leaked
-- cross-tenant data once before this was set correctly) — every real view
-- built in this project now gets it from day one.
CREATE OR REPLACE VIEW v_client_email_sla AS
SELECT
    cm.tenant_id,
    cm.client_id,
    cl.name AS client_name,
    COUNT(*) FILTER (WHERE cm.direction='outbound' AND cm.channel='email') AS emails_sent,
    ROUND(AVG(EXTRACT(EPOCH FROM (cm.replied_at - cm.created_at)) / 3600)
          FILTER (WHERE cm.replied_at IS NOT NULL), 1) AS avg_response_hours,
    ROUND(MIN(EXTRACT(EPOCH FROM (cm.replied_at - cm.created_at)) / 3600)
          FILTER (WHERE cm.replied_at IS NOT NULL), 1) AS fastest_response_hours,
    ROUND(MAX(EXTRACT(EPOCH FROM (now() - cm.created_at)) / 3600)
          FILTER (WHERE cm.replied_at IS NULL AND cm.direction='outbound'), 1) AS longest_pending_hours
FROM candidate_messages cm
JOIN clients cl ON cl.id = cm.client_id
WHERE cm.client_id IS NOT NULL AND cm.channel='email' AND cm.is_deleted IS NOT TRUE
GROUP BY cm.tenant_id, cm.client_id, cl.name;
ALTER VIEW v_client_email_sla SET (security_invoker = true);
