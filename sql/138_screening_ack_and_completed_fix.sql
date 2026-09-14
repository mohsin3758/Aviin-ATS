-- WhatsApp automation research (2026-09-15), two real gaps found while
-- reviewing the previous batch's own work, not carried over from the
-- original blueprint:
--
-- 1) 'completed' was never added to the "one active session per
-- candidate" partial unique index (sql/128) or to screening.py's
-- TERMINAL_STATUSES tuple -- a recruiter trying to manually re-screen an
-- already-completed candidate for a genuinely different new role, through
-- the normal quick-add UI, silently got "skipped" forever with no
-- explanation (enroll_candidate_for_screening's own active-session guard
-- found the 'completed' row and treated it as still "active"). The
-- cross-match/re-engagement code added in the previous migration routed
-- around this by reusing the existing session row rather than creating a
-- new one, which is why it wasn't caught until now.
DROP INDEX IF EXISTS screening_sessions_one_active_per_candidate;
CREATE UNIQUE INDEX screening_sessions_one_active_per_candidate
    ON screening_sessions (candidate_id)
    WHERE status NOT IN ('declined','opted_out','no_response','bad_number','completed');

-- 2) Real delivery-ack tracking: WAHA emits a genuine message.ack event
-- (whatsapp-web.js's own Message.ack -- ERROR/PENDING/SERVER/DEVICE/READ/
-- PLAYED) that this codebase had simply never subscribed to or handled,
-- despite needing no official Cloud API or new infra for it (see
-- routers/user_whatsapp.py and routers/phase3.py's webhook config, and
-- routers/whatsapp_bot.py's new `_handle_message_ack`). This column lets
-- an inbound ack event be matched back to the specific screening opt-in
-- send that produced it.
ALTER TABLE screening_sessions ADD COLUMN IF NOT EXISTS last_sent_waha_msg_id TEXT;
CREATE INDEX IF NOT EXISTS idx_screening_sessions_waha_msg_id
    ON screening_sessions(tenant_id, last_sent_waha_msg_id) WHERE last_sent_waha_msg_id IS NOT NULL;
