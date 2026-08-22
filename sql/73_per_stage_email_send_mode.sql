-- Real UX fix (2026-08-22): "Email Send Mode" (Automatic vs Manual) was a
-- single tenant-wide toggle applying to every stage at once — the user
-- asked for genuine per-stage control. Investigating also found the
-- toggle had never actually been wired to anything: the real stage-move
-- flow (frontend's _AUTO_NOTIFY_STAGES) hardcoded exactly 3 stages
-- (l1_interview/l2_interview/rejected) as always-auto-send regardless of
-- this setting, and every other stage never sent at all — "Manual" mode's
-- promised review-before-send popup never existed anywhere.
--
-- send_mode now lives inside each stage's own stage_templates entry
-- (no new column needed — stage_templates is already a passthrough
-- JSONB dict). This migration seeds the real tenants' EXISTING 13-stage
-- config so the fix doesn't silently change today's real behavior:
-- the 3 stages that already genuinely auto-send keep doing so
-- explicitly; every other stage (which never sent anything before)
-- defaults to 'manual' — a real, working capability for the first time,
-- matching the tenant's own already-selected (but previously inert)
-- global "manual" preference.
UPDATE email_settings
SET stage_templates = (
  SELECT jsonb_object_agg(
    key,
    value || jsonb_build_object(
      'send_mode',
      CASE WHEN key IN ('l1_interview', 'l2_interview', 'rejected') THEN 'auto' ELSE 'manual' END
    )
  )
  FROM jsonb_each(COALESCE(stage_templates, '{}'::jsonb))
)
WHERE stage_templates IS NOT NULL AND stage_templates != '{}'::jsonb;
