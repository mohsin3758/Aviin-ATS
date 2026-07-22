-- AIrecruit: support the 72-portal job-sharing directory (job_portals.py)
-- and add per-portal issue reporting.
--
-- job_shares.platform had a CHECK constraint hardcoded to the original 7
-- platforms (linkedin/naukri/indeed/shine/monster/whatsapp/email). Every
-- /job-sharing/log call for one of the 65+ new portals (facebook, twitter,
-- telegram, hirist, instahyre, ...) has been silently failing at the DB
-- level since the 72-portal directory shipped - the frontend's log call is
-- fire-and-forget with no error surfaced, so the UI's green "posted"
-- checkmarks were only ever client-side state, never actually recorded.
-- Drop the constraint rather than re-hardcode a longer one - the portal
-- list lives in job_portals.py and will keep changing; validation of
-- `platform` belongs at the application layer against that list, not as a
-- DB enum that needs a migration every time a portal is added.
ALTER TABLE job_shares DROP CONSTRAINT IF EXISTS job_shares_platform_check;
ALTER TABLE job_shares ALTER COLUMN platform TYPE VARCHAR(40);

CREATE TABLE IF NOT EXISTS job_portal_issues (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  requisition_id  UUID REFERENCES requisitions(id) ON DELETE SET NULL,
  portal_key      VARCHAR(40) NOT NULL,
  portal_name     TEXT NOT NULL,
  issue_type      VARCHAR(30) NOT NULL DEFAULT 'other'
                  CHECK (issue_type IN ('broken_link','wrong_info','posting_failed','other')),
  note            TEXT,
  status          VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  reported_by     UUID REFERENCES users(id),
  resolved_by     UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_job_portal_issues_tenant_status
  ON job_portal_issues(tenant_id, status);

ALTER TABLE job_portal_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_portal_issues FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON job_portal_issues;
CREATE POLICY tenant_isolation ON job_portal_issues
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);
