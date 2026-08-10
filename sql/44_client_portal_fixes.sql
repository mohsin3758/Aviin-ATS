-- Follow-up to the 2026-08-10 audit + critical-fix pass: closes the
-- remaining real bugs in the Client Portal feedback path (the critical
-- token-forgery fix was already deployed separately).

-- ── 1. Consolidate the 3 known duplicate rows before adding a real constraint ──
-- All 3 are self-labelled E2E test fixtures for the same (tenant,
-- application) pair - keep the most recent, drop the other 2. This is the
-- exact live duplication the audit reproduced (ON CONFLICT DO NOTHING with
-- no matching unique constraint never actually deduplicating).
DELETE FROM client_feedback
WHERE id IN (
    SELECT id FROM (
        SELECT id, row_number() OVER (
            PARTITION BY tenant_id, application_id ORDER BY created_at DESC
        ) AS rn
        FROM client_feedback WHERE application_id IS NOT NULL
    ) ranked WHERE rn > 1
);

-- ── 2. A real unique constraint, so ON CONFLICT DO NOTHING/DO UPDATE actually fires ──
-- One feedback record per (tenant, application) - a client revising their
-- decision updates the existing row instead of stacking a new one.
ALTER TABLE client_feedback
    ADD CONSTRAINT client_feedback_tenant_app_uniq UNIQUE (tenant_id, application_id);

-- ── 3. POST /client-portal/login crashed on every call ──────────────────────
-- Two independent bugs: (a) `email: str, password: str` as bare function
-- params bind as query params in FastAPI, not body, so credentials
-- travelled in the URL and would land in access logs; (b) the lookup went
-- through db.system_conn() (app.tenant_id='') against client_portal_users,
-- which has FORCE ROW LEVEL SECURITY casting app.tenant_id to ::uuid - a
-- hard crash on the empty string, the same class of bug fixed repeatedly
-- elsewhere in this project. This function resolves by email (globally
-- unique) before any tenant_id is known - same SECURITY DEFINER pattern as
-- get_client_portal_token() above.
CREATE OR REPLACE FUNCTION get_client_portal_user_by_email(p_email TEXT)
RETURNS TABLE(id UUID, tenant_id UUID, email TEXT, password_hash TEXT, full_name TEXT, company_name TEXT)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
    SELECT id, tenant_id, email, password_hash, full_name, company_name
    FROM client_portal_users
    WHERE email = p_email AND is_active
    LIMIT 1;
$$;
