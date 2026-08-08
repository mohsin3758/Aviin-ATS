-- Real automatic Telegram channel posting for job distribution — same
-- "genuinely free, zero-approval" tier as the Facebook Page integration
-- (sql/19_facebook_page_connection.sql), added after confirming no other
-- true job board (Naukri/Indeed/Monster/Shine/TimesJobs/LinkedIn) offers
-- free auto-posting without a paid or partner-approved API. A Telegram
-- bot token is created instantly via @BotFather with zero review process,
-- and the agency adds the bot as an admin of their own broadcast channel
-- (many India recruiter communities already run Telegram job-alert
-- channels) — no OAuth, no app review, no cost.

CREATE TABLE IF NOT EXISTS telegram_channel_connections (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  chat_id           TEXT NOT NULL,
  channel_name      TEXT,
  bot_token_enc     BYTEA NOT NULL,
  connected_by      UUID REFERENCES users(id),
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)
);

ALTER TABLE telegram_channel_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_channel_connections FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON telegram_channel_connections;
CREATE POLICY tenant_isolation ON telegram_channel_connections
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);
