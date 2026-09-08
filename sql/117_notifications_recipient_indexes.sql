-- Real, confirmed performance fix (2026-09-08).
--
-- User reported the whole app (Candidates, Resume Inbox, Mailbox, "other
-- features") feeling slow on the live production site. Investigated with
-- real timing evidence, not guessed: a genuine headless-browser trace of
-- the live site showed even TRIVIAL endpoints (the notification bell's
-- unread-count, the notification dropdown list) taking 800ms-6s, on
-- every single page load, since GET /notifications/unread-count,
-- GET /notifications, and POST /notifications/read-all (p28_p32.py) all
-- filter on:
--   tenant_id=$1 AND (recipient_user_id=$2 OR recipient_role=$3) AND NOT is_read
-- and `notifications` had NO index at all supporting recipient_user_id,
-- recipient_role, or is_read — only a bare (tenant_id) index. Confirmed
-- directly via EXPLAIN ANALYZE: a real Seq Scan over all 55,321 rows for
-- this one tenant, 305ms of pure execution time per call, fired on
-- nearly every page load across the whole app (the bell badge lives in
-- the shared Topbar).
--
-- Two indexes, one per side of the OR — Postgres combines them via a
-- BitmapOr for the real query shape, and each independently also serves
-- the ORDER BY created_at DESC LIMIT $N call (GET /notifications).
-- Deliberately not partial-on-is_read: the same indexes need to serve
-- both the "unread only" hot path and the general "all my notifications"
-- list view (is_read left unset), so a broad composite is more useful
-- here than a narrower partial one.

-- CONCURRENTLY: this table is under live, active read+write traffic on
-- production right now — avoids taking a lock that would block writers
-- while the index builds. Must be run outside a transaction block, and
-- as `postgres` (the table's real owner, confirmed live — app_user
-- cannot CREATE INDEX on a table it doesn't own).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_recipient_user
    ON notifications (tenant_id, recipient_user_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_recipient_role
    ON notifications (tenant_id, recipient_role, created_at DESC);
