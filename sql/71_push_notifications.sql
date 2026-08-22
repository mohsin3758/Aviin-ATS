-- Advanced Reminder System, Phase 2 — real browser push notifications.
-- Genuinely buildable without a paid/partner API (unlike Google/Outlook/
-- Teams/Zoom calendar sync, which stays blocked on OAuth credentials this
-- project doesn't have) — the W3C Push API + VAPID needs no external
-- service, just a self-generated keypair (see push_service.py).

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint     text NOT NULL,
  p256dh       text NOT NULL,
  auth         text NOT NULL,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  UNIQUE (tenant_id, endpoint)
);
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON push_subscriptions;
CREATE POLICY tenant_isolation ON push_subscriptions
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);
CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions (tenant_id, user_id);
