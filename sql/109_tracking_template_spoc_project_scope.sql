-- 109_tracking_template_spoc_project_scope.sql
-- Real, explicit business requirement (reported live, 2026-09-02): a
-- tracking-sheet template's "default" was only ever scoped at the CLIENT
-- level (or tenant-wide, as the global fallback) — no way to make one
-- template the default for one specific SPOC within a client, or for one
-- specific requisition/project, even though a client with several SPOCs
-- (or several concurrent roles) may genuinely want a different sheet
-- layout per SPOC/project. Adds both as real, independently-defaultable
-- scopes on the SAME tracking_sheet_templates table, not a second table —
-- resolution priority (most specific wins): requisition > SPOC (client
-- contact) > client > global.
--
-- Run as app_user (matches this table's own established ownership).

ALTER TABLE tracking_sheet_templates
    ADD COLUMN IF NOT EXISTS client_contact_id UUID REFERENCES client_contacts(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS requisition_id    UUID REFERENCES requisitions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tst_contact ON tracking_sheet_templates(tenant_id, client_contact_id) WHERE client_contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tst_requisition ON tracking_sheet_templates(tenant_id, requisition_id) WHERE requisition_id IS NOT NULL;

-- Each new scope gets its own real uniqueness, matching the exact same
-- "a genuinely new, independently-defaultable scope needs its own
-- partial unique index, not silently sharing/fighting over an existing
-- one" fix already applied once for the client-level default
-- (sql/75_kae_client_submission.sql).
CREATE UNIQUE INDEX IF NOT EXISTS uq_tst_one_contact_default_per_direction
    ON tracking_sheet_templates(tenant_id, client_contact_id, direction) WHERE is_default AND client_contact_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tst_one_requisition_default_per_direction
    ON tracking_sheet_templates(tenant_id, requisition_id, direction) WHERE is_default AND requisition_id IS NOT NULL;

-- REAL BUG (found via genuine end-to-end testing, not code review): the
-- pre-existing "uq_tst_one_client_default_per_direction" index (from
-- sql/75_kae_client_submission.sql, back when client_id was the ONLY
-- scope dimension) is defined as
--   UNIQUE(tenant_id, client_id, direction) WHERE is_default AND client_id IS NOT NULL
-- with no exclusion for the two new sub-scopes added above — so saving a
-- genuinely NEW SPOC-scoped or requisition-scoped default (with client_id
-- ALSO set, since a SPOC/requisition always belongs to one client) still
-- collided with this old, too-broad index and raised a real
-- UniqueViolationError the instant a client-wide default already existed
-- for that client. Narrowed to only apply to a true client-WIDE default
-- (no contact/requisition sub-scope), matching every other tier's own
-- narrow, single-purpose index exactly.
DROP INDEX IF EXISTS uq_tst_one_client_default_per_direction;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tst_one_client_default_per_direction
    ON tracking_sheet_templates(tenant_id, client_id, direction)
    WHERE is_default AND client_id IS NOT NULL AND client_contact_id IS NULL AND requisition_id IS NULL;
