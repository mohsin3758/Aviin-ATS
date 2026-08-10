-- Follow-up to sql/39 (offer HITL fix) - closes the remaining loose ends
-- flagged in the 2026-08-10 audit re-check: an honest, non-fabricated
-- audit-trail backfill for the offers that bypassed HITL before the
-- code fix landed, and removal of the one automation_workflows row that
-- has no real, buildable trigger.

-- ── Retroactive audit-trail flag for pre-fix HITL bypasses ─────────────────
-- 4 real offers (status accepted/issued, approved_by NULL) were created via
-- the old auto_generate_offer() bypass before today's fix. The code path is
-- now fixed going forward, but these 4 historical rows still show zero
-- assignment_event/audit_log rows, which is what the audit flagged.
--
-- This deliberately does NOT fabricate an approval that never happened
-- (no fake approved_by, no invented "approved" event) - that would make
-- the audit trail lie. Instead it writes one real, honestly-worded
-- assignment_event + audit_log row per affected offer, dated today,
-- explaining exactly what happened: this offer was issued via a since-
-- fixed bypass, no human ever actually reviewed or approved it, and this
-- entry exists so a query joining against these tables sees an accurate
-- explanation instead of silent zero rows.
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT id, tenant_id, status, application_id
        FROM offers
        WHERE approved_by IS NULL
          AND status IN ('accepted', 'issued', 'declined')
    LOOP
        INSERT INTO assignment_event (tenant_id, event_type, reason, actor_user_id, metadata)
        VALUES (
            r.tenant_id,
            'offer.hitl_bypass_retroactive_flag',
            'This offer was created via auto_generate_offer() before the 2026-08-10 fix, which inserted directly as status=''issued'' with no approval step. No human ever reviewed or approved this offer. Flagged retroactively for audit-trail accuracy - not a fabricated approval.',
            NULL,
            jsonb_build_object('offer_id', r.id, 'application_id', r.application_id, 'status_at_flag_time', r.status)
        );

        INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
        VALUES (
            r.tenant_id,
            NULL,
            'hitl_bypass_retroactive_flag',
            'offer',
            r.id,
            jsonb_build_object('approved_by', NULL, 'audit_trail', 'none - pre-fix bypass'),
            jsonb_build_object('note', 'Retroactively flagged 2026-08-10: this offer bypassed the HITL approval gate via the pre-fix auto_generate_offer() path. No approval occurred. Code fixed in sql/39; this entry documents the historical gap rather than concealing it.')
        );
    END LOOP;
END $$;

-- ── Remove the one automation_workflows row with no real trigger ───────────
-- Candidate Birthday/Anniversary (webhook_path candidate-engagement) has no
-- DOB/anniversary field anywhere in this schema (confirmed via grep across
-- every sql/*.sql file) - genuinely unbuildable without inventing new data
-- capture, which is out of scope for this fix pass. Per the audit's own
-- recommendation ("wire real triggers... or remove them"), this one is
-- removed rather than left as unused surface area with no path to ever
-- being wired.
DELETE FROM automation_workflows WHERE webhook_path = 'candidate-engagement';
