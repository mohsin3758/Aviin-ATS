-- 89_user_whatsapp_accounts.sql
-- Individual WhatsApp numbers per recruiter/KAE (2026-08-26/27).
-- Mirrors user_email_accounts' per-user-account shape. Real, per-user WAHA
-- sessions (u_<user_id>) live alongside the existing shared "default"
-- session used by automated stage-change/reminder sends, which stay
-- unchanged. See CLAUDE.md's "Individual WhatsApp numbers per
-- recruiter/KAE" entry for the full design rationale (real RAM-cost
-- research, the resource-safety cap, the per-account bot-auto-reply
-- toggle).
--
-- Run as app_user for the CREATE TABLE statements below (owner = app_user,
-- matches every other tenant-scoped table this app writes directly). The
-- seed INSERT at the bottom must run as postgres (or any role that bypasses
-- RLS) -- app_user itself still needs app.tenant_id set to satisfy its own
-- FORCE ROW LEVEL SECURITY policy on a bare cross-tenant INSERT, the same
-- gotcha documented repeatedly elsewhere in this project's migrations.

CREATE TABLE IF NOT EXISTS user_whatsapp_accounts (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    waha_session_name       TEXT NOT NULL UNIQUE,
    phone_number            TEXT,
    status                  TEXT NOT NULL DEFAULT 'stopped'
                                CHECK (status IN ('stopped','scan_qr','starting','working','failed')),
    bot_auto_reply_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    connected_at            TIMESTAMPTZ,
    last_status_check_at    TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_uwa_tenant ON user_whatsapp_accounts(tenant_id);

ALTER TABLE user_whatsapp_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_whatsapp_accounts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON user_whatsapp_accounts;
CREATE POLICY tenant_isolation ON user_whatsapp_accounts
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);


CREATE TABLE IF NOT EXISTS whatsapp_session_config (
    tenant_id                        UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    max_concurrent_personal_sessions INTEGER NOT NULL DEFAULT 2,
    updated_by                       UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at                       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE whatsapp_session_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_session_config FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON whatsapp_session_config;
CREATE POLICY tenant_isolation ON whatsapp_session_config
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Seed one config row per existing tenant (real default = 2 concurrent
-- personal sessions, matching the RAM headroom measured live on the VPS
-- when this feature was built). Run this INSERT as postgres (or any
-- RLS-bypassing role) -- app_user's own FORCE RLS blocks a bare
-- cross-tenant INSERT with no app.tenant_id set.
INSERT INTO whatsapp_session_config (tenant_id)
SELECT id FROM tenants
ON CONFLICT (tenant_id) DO NOTHING;


-- candidate_messages is owned by postgres (not app_user) -- this ALTER
-- must run as postgres too.
ALTER TABLE candidate_messages
    ADD COLUMN IF NOT EXISTS from_whatsapp_account_id UUID
        REFERENCES user_whatsapp_accounts(id) ON DELETE SET NULL;
