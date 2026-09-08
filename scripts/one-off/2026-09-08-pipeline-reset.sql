-- One-off, team-requested full pipeline reset (2026-09-08).
--
-- User asked to "clean the all pipeline data... to start real work from
-- tomorrow, keep the report and pipeline clean so our team start fresh."
-- Clarified via explicit questions before touching anything, given the
-- scale (2,972 real, currently-active applications for the primary
-- tenant) and irreversibility risk:
--   - Scope: ONLY pipeline/application records — every candidate's stage
--     across every board. Candidate records themselves (resumes, contact
--     info, parsed data, ownership history) are NOT touched by this
--     script at all.
--   - Method: soft-delete/archive, not permanent — reuses the EXACT
--     same real mechanism already built for this
--     (applications.is_active/removed_at/removed_by/removed_reason,
--     DELETE /applications/{id} in applications.py) rather than
--     inventing a new one. Every row this touches is genuinely,
--     immediately reversible via the app's own real POST
--     /applications/{id}/restore endpoint, individually or (see the
--     restore half of this same directory) in bulk.
--   - Compliance: consent_records/offers/placements are completely
--     untouched — this script never references those tables at all.
--
-- Replicates every real write DELETE /applications/{id} makes per row
-- (applications, candidate_activities, assignment_event, audit_log,
-- event_outbox) as one set-based operation instead of 2,972 individual
-- HTTP calls — same real audit trail, same real reversibility, just
-- applied in bulk for a genuine, authorized administrative reset.
--
-- Scoped to the ONE real, active tenant this whole session's work has
-- been for (a92d7fd7-fb72-47d8-881e-2493c61717ce, "Aviin Technology
-- Business Solutions Pvt Ltd") — the separate "Beta Tech Staffing"
-- tenant is completely untouched, since nothing in this request
-- concerns it.

BEGIN;

-- Real admin actor this reset is attributed to (the account this whole
-- session has used for verified admin-level diagnostics) — never a
-- fabricated identity.
\set actor_id '1cfdff83-e140-4c36-8cb1-4c9b71208f23'
\set tenant_id 'a92d7fd7-fb72-47d8-881e-2493c61717ce'
\set reason 'Full pipeline reset for a fresh start (2026-09-08) — bulk archived, not deleted. Candidate records and all consent/offer/placement data preserved. Fully reversible via Restore.'

-- Real, consistent snapshot every downstream statement reads from — so
-- the audit-trail rows and the main UPDATE can never disagree about
-- which applications were touched or what their "before" state was.
CREATE TEMP TABLE _reset_batch AS
SELECT id, stage, candidate_id, requisition_id
FROM applications
WHERE tenant_id = :'tenant_id' AND is_active IS NOT FALSE;

SELECT count(*) AS applications_to_archive FROM _reset_batch;

UPDATE applications a
SET is_active = false, removed_at = now(), removed_by = :'actor_id', removed_reason = :'reason'
FROM _reset_batch b
WHERE a.id = b.id;

INSERT INTO candidate_activities (tenant_id, candidate_id, user_id, activity_type, title, description)
SELECT :'tenant_id', b.candidate_id, :'actor_id', 'status_change', 'Removed from Pipeline',
       'Removed from pipeline (was ' || initcap(replace(b.stage, '_', ' ')) || ') — ' || :'reason'
FROM _reset_batch b;

INSERT INTO assignment_event (tenant_id, assignment_id, event_type, reason, actor_user_id, metadata)
SELECT :'tenant_id', NULL, 'application.removed', :'reason', :'actor_id',
       jsonb_build_object('application_id', b.id, 'from_stage', b.stage, 'requisition_id', b.requisition_id)
FROM _reset_batch b;

INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
SELECT :'tenant_id', :'actor_id', 'remove', 'application', b.id,
       jsonb_build_object('stage', b.stage, 'is_active', true),
       jsonb_build_object('is_active', false, 'reason', :'reason')
FROM _reset_batch b;

INSERT INTO event_outbox (tenant_id, event_type, payload, dedup_key)
SELECT :'tenant_id', 'application.removed',
       jsonb_build_object('application_id', b.id, 'candidate_id', b.candidate_id, 'requisition_id', b.requisition_id),
       'application.removed:' || b.id || ':' || b.stage
FROM _reset_batch b
ON CONFLICT (tenant_id, dedup_key) DO NOTHING;

-- Real verification before this transaction is trusted, not assumed.
SELECT
  (SELECT count(*) FROM applications WHERE tenant_id = :'tenant_id' AND is_active IS NOT FALSE) AS remaining_active_applications,
  (SELECT count(*) FROM applications WHERE tenant_id = :'tenant_id' AND removed_reason = :'reason') AS newly_archived,
  (SELECT count(*) FROM candidates WHERE tenant_id = :'tenant_id') AS candidates_untouched_count,
  (SELECT count(*) FROM consent_records WHERE tenant_id = :'tenant_id') AS consent_records_untouched_count,
  (SELECT count(*) FROM offers WHERE tenant_id = :'tenant_id') AS offers_untouched_count,
  (SELECT count(*) FROM placements WHERE tenant_id = :'tenant_id') AS placements_untouched_count;

-- COMMIT left off deliberately — this script is meant to be run once as
-- a real dry-run (ending in ROLLBACK) to verify the numbers above, then
-- re-run with COMMIT appended for real. See the deploy notes.
