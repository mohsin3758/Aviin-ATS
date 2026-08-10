-- CRITICAL FIX (2026-08-10 audit): the Client Portal's public /view/{token}
-- and /feedback-public endpoints trusted a token that was nothing more than
-- base64url(tenant_id + ':' + requisition_id) - unsigned, no secret, no DB
-- record, minted entirely client-side. Since tenant_id is hardcoded in the
-- public careers page's client bundle and requisition IDs are enumerable via
-- the unauthenticated GET /public/jobs, anyone could forge a valid token for
-- any open requisition. Proven live: a forged token pulled 151 real
-- candidates (names, employers, designations, stages, AI scores) off
-- production with a plain curl request, zero credentials.
--
-- Fix: a real token table with a cryptographically random token (32 bytes,
-- base64url via Python's secrets.token_urlsafe - minted server-side, never
-- derivable from public data), a real expiry, and revocation. Same
-- "anonymous token resolves tenant_id via a SECURITY DEFINER function"
-- pattern already established in this codebase for NDA e-sign, offer
-- e-sign, and device enrollment - the public endpoint doesn't know its own
-- tenant_id ahead of time, so it needs a function that can look past RLS
-- for this one specific, token-scoped lookup.

CREATE TABLE IF NOT EXISTS client_portal_tokens (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    requisition_id    UUID NOT NULL REFERENCES requisitions(id) ON DELETE CASCADE,
    token             TEXT NOT NULL UNIQUE,
    created_by        UUID REFERENCES users(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at        TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '180 days'),
    revoked_at        TIMESTAMPTZ,
    last_accessed_at  TIMESTAMPTZ,
    access_count      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_cpt_tenant ON client_portal_tokens(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cpt_req ON client_portal_tokens(tenant_id, requisition_id);

ALTER TABLE client_portal_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_portal_tokens FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON client_portal_tokens;
CREATE POLICY tenant_isolation ON client_portal_tokens
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Resolves a real token to its tenant_id + requisition_id, only if not
-- revoked and not expired. SECURITY DEFINER + owned by postgres so the
-- anonymous public endpoint can call it before it has any app.tenant_id
-- set - same pattern as get_offer_by_signing_token / redeem_device_enrollment.
CREATE OR REPLACE FUNCTION get_client_portal_token(p_token TEXT)
RETURNS TABLE(id UUID, tenant_id UUID, requisition_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
    SELECT id, tenant_id, requisition_id
    FROM client_portal_tokens
    WHERE token = p_token
      AND revoked_at IS NULL
      AND expires_at > now()
    LIMIT 1;
$$;

-- Records a real access (view or feedback submission) against the token -
-- closes the "zero issuance/access tracking" finding from the same audit.
CREATE OR REPLACE FUNCTION record_client_portal_access(p_token TEXT)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER
AS $$
    UPDATE client_portal_tokens
    SET last_accessed_at = now(), access_count = access_count + 1
    WHERE token = p_token AND revoked_at IS NULL AND expires_at > now();
$$;
