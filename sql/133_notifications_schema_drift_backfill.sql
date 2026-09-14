-- Real, pre-existing schema drift found while wiring WhatsApp Screening's
-- Phase 7 recruiter-handoff notification: the only CREATE TABLE
-- notifications anywhere in sql/ (03_phase2_n8n_additions.sql) defines
-- id, tenant_id, recipient_user_id, recipient_role, channel, title, body,
-- related_entity_type, related_entity_id, status, created_at, sent_at --
-- but 15+ real call sites across the backend (assignment_notify.py,
-- applications.py, pipeline_p2.py, p28_p32.py, imap_bg.py, scheduler.py,
-- whatsapp_bot.py, ...) actually read/write user_id, type, resource,
-- resource_id, is_read, read_at instead. Unlike the other 57 tables with
-- this exact problem, notifications was never covered by
-- sql/99_phase0_schema_drift_backfill.sql. Backfilled here so a fresh
-- environment build doesn't silently break every one of those call sites.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS resource TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS resource_id UUID;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_read BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
