-- Recruiter -> Screening Team automation (2026-08-19). Real user ask: when
-- a recruiter moves a candidate to "screened", automatically email the
-- internal screening team (To) with the resume + full tracking sheet,
-- CC'ing every active KAE assigned to that client -- not just sending to
-- the KAE directly, which is what the existing manual "Submit to KAE"
-- flow already does. The screening-team recipient list is tenant-
-- configurable (Settings > Ops Settings > Screening Notifications):
-- first save establishes the default, every later save can change it --
-- same "auto-create a default row on first GET, PUT to change it"
-- pattern already used by scoring_weight_config/sla_tier_config.

CREATE TABLE IF NOT EXISTS screening_notification_settings (
    tenant_id  UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    to_emails  TEXT[] NOT NULL DEFAULT '{}',
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE screening_notification_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE screening_notification_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON screening_notification_settings;
CREATE POLICY tenant_isolation ON screening_notification_settings
    USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);

-- Distinguishes an auto-fired (stage->screened) submission from a real
-- manual "Submit to KAE" click in candidate_submissions history -- was
-- previously impossible to tell apart.
ALTER TABLE candidate_submissions
    ADD COLUMN IF NOT EXISTS trigger_source TEXT NOT NULL DEFAULT 'manual'
        CHECK (trigger_source IN ('manual', 'auto_screened'));
