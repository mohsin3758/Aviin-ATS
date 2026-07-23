-- AIrecruit: real automatic Facebook Page posting (not the share-dialog
-- trick, which Facebook has never allowed a URL to pre-fill text for).
-- Requires the tenant's own Facebook Page Access Token, obtained via a
-- one-time setup on their end (create a Facebook App, add themselves as
-- Admin/Developer/Tester on it, request pages_manage_posts at Standard
-- Access - no App Review needed for a business posting to its own Page,
-- per Meta's own policy: unapproved permissions work for users who hold
-- a role on the requesting app). The token itself is a real secret
-- credential, encrypted at rest the same way HARD RULE #11 already
-- requires for Aadhaar/PAN/bank fields (sql/05_phase12_erp.sql).

CREATE TABLE IF NOT EXISTS facebook_page_connections (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  page_id                TEXT NOT NULL,
  page_name              TEXT,
  page_access_token_enc  BYTEA NOT NULL,
  connected_by           UUID REFERENCES users(id),
  is_active              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)
);

ALTER TABLE facebook_page_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE facebook_page_connections FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON facebook_page_connections;
CREATE POLICY tenant_isolation ON facebook_page_connections
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);
