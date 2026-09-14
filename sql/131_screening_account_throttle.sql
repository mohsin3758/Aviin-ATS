-- WhatsApp Screening Blueprint -- per-number send pacing + health state
-- for Phase 1 (business hours, jitter, per-number cap, warm-up ramp,
-- proactive delivery/reply-rate warning). Throttle state is naturally 1:1
-- with a recruiter's own WhatsApp connection (user_whatsapp_accounts
-- already has UNIQUE(tenant_id, user_id)), so it's added here via ALTER
-- rather than as a separate join table -- simpler, same effect as the
-- blueprint's "new send-queue table" framing.
--
-- (There is no migration numbered 130: the blueprint's plan assumed
-- question_bank.category needed its CHECK constraint widened for a new
-- 'screening' value -- checked sql/99_phase0_schema_drift_backfill.sql,
-- category is a plain character varying(50) NOT NULL with no CHECK at
-- all, so there's nothing to migrate. 'screening' can be inserted as a
-- category value directly once Milestone 2 starts using it.)
ALTER TABLE user_whatsapp_accounts
  ADD COLUMN IF NOT EXISTS next_eligible_send_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS warm_up_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS messages_sent_today INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS messages_sent_date DATE,
  ADD COLUMN IF NOT EXISTS recent_delivery_rate NUMERIC,
  ADD COLUMN IF NOT EXISTS recent_reply_rate NUMERIC;
