-- 108_spoc_kae_assignments.sql
-- Real business requirement (reported live, 2026-09-02): a client company
-- (e.g. Invenio) can have several SPOCs, but a given KAE should NOT
-- automatically see every one of them — only the specific SPOCs an admin
-- has actually assigned to that KAE. Company -> SPOC -> KAE User, with
-- email/contact details already carried by the existing client_contacts
-- row this table maps onto.
--
-- Run as app_user (client_contacts is app_user-owned; matches that
-- table's own convention).

CREATE TABLE IF NOT EXISTS client_contact_kae_assignments (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    client_contact_id UUID NOT NULL REFERENCES client_contacts(id) ON DELETE CASCADE,
    kae_user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_by       UUID REFERENCES users(id),
    assigned_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, client_contact_id, kae_user_id)
);

ALTER TABLE client_contact_kae_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_contact_kae_assignments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON client_contact_kae_assignments;
CREATE POLICY tenant_isolation ON client_contact_kae_assignments
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Real, honest backfill: a KAE who already owns a client (via
-- client_owners) has, until now, always been able to see and use EVERY
-- one of that client's SPOCs — this backfill preserves exactly that as
-- the starting state (same "preserve the pre-existing assumption rather
-- than introduce a sudden, confusing regression" precedent already used
-- for the Indeed/Jooble feed-registration backfill). An admin can narrow
-- it down per-SPOC from here via the new PUT /client-contacts/{id}/
-- kae-assignments endpoint; any NEW contact created going forward is
-- NOT auto-granted to every owning KAE, only to whichever KAE actually
-- created it (handled in application code, not here).
DO $$
DECLARE
    t RECORD;
BEGIN
    FOR t IN SELECT id FROM tenants LOOP
        PERFORM set_config('app.tenant_id', t.id::text, true);
        INSERT INTO client_contact_kae_assignments (tenant_id, client_contact_id, kae_user_id, assigned_by)
        SELECT DISTINCT cc.tenant_id, cc.id, co.user_id, NULL::uuid
        FROM client_contacts cc
        JOIN client_owners co ON co.client_id = cc.client_id AND co.tenant_id = cc.tenant_id
        WHERE cc.tenant_id = t.id AND co.is_active = true
        ON CONFLICT (tenant_id, client_contact_id, kae_user_id) DO NOTHING;
    END LOOP;
    PERFORM set_config('app.tenant_id', '', true);
END $$;
