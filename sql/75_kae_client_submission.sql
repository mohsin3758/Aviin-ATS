-- One-Click Approve & Send (KAE -> Client/KAM), file-upload + table-builder
-- templates, client contacts, direction-aware defaults, per-send hide.
--
-- Everything built 2026-07-29 through 2026-08-19 covers exactly one hop:
-- recruiter (or an auto-trigger on stage->screened) submits a candidate to
-- the client-owning KAE. There is no second hop and no schema concept of one
-- - the KAE forwarding a candidate on to the actual client/KAM was entirely
-- unbuilt (confirmed: candidate_submissions/tracking_sheet_templates have no
-- direction column at all). This migration adds that second hop as a real,
-- distinct, tracked action rather than overloading the existing KAE-facing
-- one.

-- ── tracking_sheet_templates: direction + table/file mode ──────────────────
ALTER TABLE tracking_sheet_templates
    ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'recruiter_to_kae'
        CHECK (direction IN ('recruiter_to_kae', 'kae_to_client')),
    ADD COLUMN IF NOT EXISTS template_type TEXT NOT NULL DEFAULT 'table'
        CHECK (template_type IN ('table', 'file')),
    ADD COLUMN IF NOT EXISTS file_path TEXT,
    ADD COLUMN IF NOT EXISTS file_name TEXT,
    ADD COLUMN IF NOT EXISTS file_mime_type TEXT,
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- The old constraint allowed exactly one default template PER TENANT, full
-- stop - now that a client can be pinned AND direction genuinely
-- distinguishes two different template purposes, that's both too loose
-- (nothing stopped 2 templates pinning the same client - confirmed live as a
-- real latent bug during this feature's own audit, "oldest wins" silently)
-- and too strict (a tenant now legitimately wants 2 global defaults, one per
-- direction). Replaced with two real, correctly-scoped constraints.
DROP INDEX IF EXISTS uq_tst_one_default_per_tenant;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tst_one_global_default_per_direction
    ON tracking_sheet_templates(tenant_id, direction) WHERE is_default AND client_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tst_one_client_default_per_direction
    ON tracking_sheet_templates(tenant_id, client_id, direction) WHERE is_default AND client_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tst_direction ON tracking_sheet_templates(tenant_id, direction);

-- Existing rows are all real recruiter->KAE templates already (there was no
-- other kind before this migration) - the DEFAULT above backfills them for
-- free, nothing to UPDATE explicitly.

-- ── candidate_submissions: which hop, and what was hidden for this send ────
ALTER TABLE candidate_submissions
    ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'recruiter_to_kae'
        CHECK (direction IN ('recruiter_to_kae', 'kae_to_client')),
    ADD COLUMN IF NOT EXISTS hidden_columns TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS to_emails TEXT[] NOT NULL DEFAULT '{}',
    -- References client_contacts, created below in this same migration —
    -- the FK constraint itself is added right after that CREATE TABLE
    -- (a column can't reference a table that doesn't exist yet).
    ADD COLUMN IF NOT EXISTS recipient_contact_id UUID;

CREATE INDEX IF NOT EXISTS idx_csub_direction ON candidate_submissions(tenant_id, direction);

-- ── client_contacts: KAM / client-side recipient(s), one client can have
-- more than one (e.g. a primary KAM + a backup HR contact) ─────────────────
CREATE TABLE IF NOT EXISTS client_contacts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    contact_name TEXT NOT NULL,
    email        TEXT NOT NULL,
    role_label   TEXT,                     -- free text, e.g. "KAM", "HR Contact"
    is_primary   BOOLEAN NOT NULL DEFAULT false,
    created_by   UUID REFERENCES users(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ccon_client ON client_contacts(tenant_id, client_id);
-- At most one primary contact per client - the default "To" for
-- submit-to-client resolves this row first.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ccon_one_primary_per_client
    ON client_contacts(tenant_id, client_id) WHERE is_primary;

ALTER TABLE client_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_contacts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON client_contacts;
CREATE POLICY tenant_isolation ON client_contacts
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'candidate_submissions_recipient_contact_id_fkey'
    ) THEN
        ALTER TABLE candidate_submissions
            ADD CONSTRAINT candidate_submissions_recipient_contact_id_fkey
            FOREIGN KEY (recipient_contact_id) REFERENCES client_contacts(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Real fix, found while building this: client_owners.owner_type already
-- supports 'kae'/'account_manager'/'secondary', but the whole submission
-- system only ever resolved 'kae' rows. The new KAE->Client hop is a KAE
-- action by definition, so no change needed there - flagged here, not
-- silently expanded, since widening _resolve_kaes() itself is a separate,
-- unrelated decision this feature doesn't need to make.

-- Seed one global default 'kae_to_client' template per tenant that doesn't
-- have one yet - same 17-column base as the existing recruiter->KAE default
-- (the client-facing sample sheet the request was built from uses the same
-- shape), so "clean table sheet with all candidate details" is real
-- immediately for the new hop too, not left blank until someone configures
-- it by hand.
DO $$
DECLARE
    t RECORD;
BEGIN
    FOR t IN SELECT id FROM tenants LOOP
        PERFORM set_config('app.tenant_id', t.id::text, true);
        IF NOT EXISTS (
            SELECT 1 FROM tracking_sheet_templates x
            WHERE x.tenant_id = t.id AND x.is_default AND x.client_id IS NULL AND x.direction = 'kae_to_client'
        ) THEN
            INSERT INTO tracking_sheet_templates (tenant_id, client_id, name, columns, is_default, direction, template_type)
            VALUES (t.id, NULL, 'Default Client Tracking Sheet',
                '[
                    {"key":"sl_no","label":"SL No"},
                    {"key":"date","label":"Date"},
                    {"key":"partner","label":"Partner"},
                    {"key":"candidate_name","label":"Name"},
                    {"key":"role","label":"Role"},
                    {"key":"total_exp","label":"Total Exp"},
                    {"key":"relevant_exp","label":"Relevant Exp"},
                    {"key":"skill_summary","label":"Skill Relevant Exp / Support / Implementation / Projects"},
                    {"key":"notice_period","label":"Notice Period / LWD"},
                    {"key":"mobile_number","label":"Mobile Number"},
                    {"key":"alternate_number","label":"Alternate Number"},
                    {"key":"email_id","label":"Email Id"},
                    {"key":"current_location","label":"Current Location"},
                    {"key":"deployment_location","label":"Deployment Location"},
                    {"key":"current_company","label":"Current Company"},
                    {"key":"ctc","label":"CTC"},
                    {"key":"ectc_rate_card","label":"ECTC / Rate Card"}
                ]'::jsonb,
                true, 'kae_to_client', 'table');
        END IF;
    END LOOP;
    PERFORM set_config('app.tenant_id', '', true);
END $$;
