-- Gap-audit fix (Phase 8, 2026-09-02) — real WhatsApp Channel job
-- broadcasting, closing the "Employee Referral Loop" report's sibling
-- item ("WhatsApp Channel job broadcasting... start with confirming
-- real API availability and cost"). Researched before building: WAHA
-- (already self-hosted here) supports posting to a WhatsApp Channel via
-- the SAME POST /api/sendText endpoint already used for 1:1 messages,
-- just with a chatId ending "@newsletter" instead of "@c.us" — no new
-- infrastructure, no new cost (confirmed as of WAHA 2026.6.1 every
-- feature that used to need a paid "Plus" tier shipped in the free
-- image; this tenant already runs 2026.7.2, well past that merge).
-- The account only needs to already be OWNER/ADMIN of a real channel
-- (created once, manually, via the WhatsApp app itself — WAHA cannot
-- create channels via API, same "connect once, automate after" shape
-- as the existing Facebook Page/Telegram Bot integrations).
--
-- Unlike Facebook/Telegram, this needs NO new secret credential at
-- all — it reuses the ALREADY-CONNECTED shared "default" WAHA session
-- (the same one stage-change notifications already use), so no
-- pgcrypto encryption column is needed here either; this table just
-- records WHICH of the tenant's real channels should receive auto-posts.

CREATE TABLE IF NOT EXISTS whatsapp_channel_connections (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel_id        TEXT NOT NULL,       -- e.g. "123456789@newsletter"
  channel_name      TEXT,
  session_name      TEXT NOT NULL DEFAULT 'default',
  connected_by      UUID REFERENCES users(id),
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)
);

ALTER TABLE whatsapp_channel_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_channel_connections FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON whatsapp_channel_connections;
CREATE POLICY tenant_isolation ON whatsapp_channel_connections
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);
