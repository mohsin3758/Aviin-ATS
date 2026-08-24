-- Candidate rediscovery (2026-08-25) — 3rd of the 3 recruiter-CRM features
-- from the "Recruiter CRM Landscape" research report, and the single most
-- independently-validated feature in the whole report: multiple unrelated
-- vendors (Gem, Eightfold, SeekOut) converge on large real ROI from exactly
-- this — automatically surfacing existing dormant/rejected candidates
-- against a newly-opened requisition instead of relying on a recruiter
-- remembering "didn't we already talk to this person?"
--
-- Real matches, not ephemeral — persisted so there's a genuine browsable
-- queue, and so UNIQUE(tenant_id, requisition_id, candidate_id) can make
-- repeated scans (the daily catch-up job re-checking still-open reqs)
-- idempotent via ON CONFLICT DO NOTHING: a still-open requisition re-scanned
-- daily only ever produces rows/notifications for genuinely new candidates.

CREATE TABLE IF NOT EXISTS candidate_rediscovery_matches (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  requisition_id        uuid NOT NULL REFERENCES requisitions(id) ON DELETE CASCADE,
  candidate_id          uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  cosine_similarity     numeric,
  matched_skills        text[] NOT NULL DEFAULT '{}',
  missing_skills        text[] NOT NULL DEFAULT '{}',
  notified_recruiter_id uuid REFERENCES users(id),
  notified_at           timestamptz,
  status                text NOT NULL DEFAULT 'new' CHECK (status IN ('new','viewed','actioned','dismissed')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, requisition_id, candidate_id)
);
ALTER TABLE candidate_rediscovery_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_rediscovery_matches FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON candidate_rediscovery_matches;
CREATE POLICY tenant_isolation ON candidate_rediscovery_matches
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);
CREATE INDEX IF NOT EXISTS idx_rediscovery_recruiter ON candidate_rediscovery_matches (tenant_id, notified_recruiter_id, status);
