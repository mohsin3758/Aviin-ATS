-- Payroll webhook export + subscribable calendar feed (Time Champ gap-
-- analysis, 2026-08-11) — both explicitly scoped to what's genuinely
-- buildable without a named-vendor OAuth partnership (no Google/Outlook/
-- ADP credentials exist for this project, same constraint already
-- documented for Naukri/LinkedIn/MS-Teams-app-review): a generic "bring
-- your own endpoint" webhook for payroll data, and a standard iCal
-- subscription feed any calendar app can poll without OAuth.

CREATE TABLE payroll_export_webhooks (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    webhook_url   TEXT NOT NULL,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    last_sent_at  TIMESTAMPTZ,
    send_count    INTEGER NOT NULL DEFAULT 0,
    created_by    UUID REFERENCES users(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE payroll_export_webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_export_webhooks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payroll_export_webhooks
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE TABLE calendar_feed_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token       TEXT NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, user_id)
);
CREATE INDEX idx_calendar_feed_token ON calendar_feed_tokens (token);
ALTER TABLE calendar_feed_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_feed_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON calendar_feed_tokens
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- SECURITY DEFINER: a calendar app polling the subscription URL has no
-- JWT/app.tenant_id — same anonymous-token-resolves-tenant pattern as
-- NDA/offer e-sign, device enrollment, field-attendance check-in.
CREATE OR REPLACE FUNCTION get_calendar_feed_owner(p_token TEXT)
RETURNS TABLE (tenant_id UUID, user_id UUID)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    RETURN QUERY SELECT t.tenant_id, t.user_id FROM calendar_feed_tokens t WHERE t.token = p_token;
END;
$$;
REVOKE ALL ON FUNCTION get_calendar_feed_owner(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_calendar_feed_owner(TEXT) TO app_user;
