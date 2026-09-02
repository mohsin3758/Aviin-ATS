-- 106_job_distribution_config.sql
-- Job Board & Distribution gap-audit build (2026-09-02): a real, opt-in
-- tenant-wide scheduled re-post ("bump") toggle for stale open-job
-- listings on the 3 real auto-post channels (Facebook, Telegram,
-- WhatsApp Channel). Matches the exact shape/ownership convention
-- already established for auto_assign_config (sql/96) - self-service,
-- owned by app_user, get-or-create on first GET, defaults to OFF so a
-- fresh/untouched tenant gets no behavior change until an admin opts in.
--
-- Note: job_shares.click_count / job_shares.apply_count already exist
-- (confirmed via schema inspection - real columns, already read by
-- job_sharing.py's own /stats endpoint) but were never written anywhere.
-- No new table needed for click/apply analytics - only the write side
-- (the real click-redirect endpoint added in job_sharing.py) was
-- missing. No unique constraint exists on job_shares either, confirmed
-- via a full constraint scan - a second row per (requisition, platform)
-- for a re-bump is structurally safe, not blocked by ON CONFLICT.
--
-- Run as app_user (owner = app_user, matches auto_assign_config).

CREATE TABLE IF NOT EXISTS job_distribution_config (
    tenant_id           UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    auto_rebump_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    rebump_after_days   INTEGER NOT NULL DEFAULT 14,
    updated_by          UUID REFERENCES users(id),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE job_distribution_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_distribution_config FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON job_distribution_config;
CREATE POLICY tenant_isolation ON job_distribution_config
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
