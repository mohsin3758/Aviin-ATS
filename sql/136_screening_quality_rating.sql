-- WhatsApp automation research (2026-09-14): our WAHA engine (WEBJS)
-- can't send interactive buttons/lists (confirmed live: WAHA itself
-- returns 501 "not implemented by WEBJS engine") and has no delivery-ack
-- webhook -- both real, structural gaps vs. an official WhatsApp
-- Business API integration. This migration implements the mitigation
-- research recommended instead: a "shadow quality rating" per number
-- (green/yellow/red, mirroring Meta's own official quality-tier concept)
-- computed from signals we DO have (reply rate, opt-out rate, send
-- failures), used to auto-pause a badly degraded number before it gets
-- a real ban -- reactive protection standing in for the missing
-- proactive delivery-ack signal.
ALTER TABLE user_whatsapp_accounts
  ADD COLUMN IF NOT EXISTS quality_rating TEXT NOT NULL DEFAULT 'green'
    CHECK (quality_rating IN ('green', 'yellow', 'red')),
  ADD COLUMN IF NOT EXISTS quality_rating_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recent_optout_rate NUMERIC;
