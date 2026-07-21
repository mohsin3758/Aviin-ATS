-- AIrecruit: per-stage WhatsApp message templates (Stage-Workflow Phase 3)
-- Mirrors email_settings.stage_templates/notification_mode exactly, but
-- scoped to WhatsApp (separate table since WAHA session config already
-- lives elsewhere and this has no SMTP/IMAP fields).

CREATE TABLE IF NOT EXISTS whatsapp_settings (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id),
  notification_mode  TEXT NOT NULL DEFAULT 'manual' CHECK (notification_mode IN ('auto','manual')),
  stage_templates    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)
);

ALTER TABLE whatsapp_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_settings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON whatsapp_settings;
CREATE POLICY tenant_isolation ON whatsapp_settings
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);
