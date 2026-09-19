-- REAL BUG FIX (2026-09-19, live report): a candidate's single WhatsApp
-- reply produced two identical bot replies -- confirmed root cause is
-- WAHA re-delivering the same inbound webhook event with no idempotency
-- guard anywhere in routers/whatsapp_bot.py's webhook(). This table is
-- infrastructure-level bookkeeping (WAHA's own message id, not tenant
-- business data), so no RLS -- matches the existing tenant-less
-- `tenants` table convention.
CREATE TABLE IF NOT EXISTS whatsapp_inbound_dedup (
    waha_message_id TEXT PRIMARY KEY,
    received_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
