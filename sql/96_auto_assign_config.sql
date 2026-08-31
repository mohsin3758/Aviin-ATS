-- 96_auto_assign_config.sql
-- Tenant-wide on/off switch for the AI Auto-Assign capability
-- (assign_with_explanation() / do_reassign()'s auto-pick path), 2026-08-31.
--
-- Reported live: "need option to off and on auto assign features." There
-- is no automatic/scheduled trigger anywhere in this codebase today - the
-- AI capability only ever runs when a real human clicks "Auto-Assign
-- (AI)"/"Auto-Reassign (AI)" (requisition detail page, Recruiter Ops'
-- Auto-Assign tab) or picks "Auto-pick per assignment" on the Assignment
-- Dashboard's bulk-reassign modal. Per the user's own explicit choice
-- between the two real interpretations offered, this is a tenant-wide
-- switch that shows/hides those AI buttons - not a new background job.
-- Manual assignment/reassignment to a SPECIFIC, human-chosen recruiter is
-- never affected by this, at any setting.
--
-- Defaults enabled=TRUE so a fresh tenant (or one that never touches this
-- setting) keeps today's exact current behavior with zero change.
--
-- Run as app_user (owner = app_user, matches every other tenant-scoped
-- config table this app writes directly, e.g. whatsapp_session_config).

CREATE TABLE IF NOT EXISTS auto_assign_config (
    tenant_id   UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by  UUID REFERENCES users(id),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE auto_assign_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE auto_assign_config FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON auto_assign_config;
CREATE POLICY tenant_isolation ON auto_assign_config
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
