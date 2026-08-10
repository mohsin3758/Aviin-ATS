-- Individual Recruiter Candidate Ownership (30-day FCFS lock), 2026-08-11.
-- Business rule: whichever recruiter first receives (personal mailbox) or
-- creates (manual add / bulk upload) a candidate individually owns that
-- candidate for 30 calendar days. Ownership is tied to the specific
-- recruiter's user account + registered email — never to a team/branch.
-- Two-table design: candidate_ownership always reflects current state
-- (one row per candidate), candidate_ownership_history is an append-only
-- log of every claim/expiry/transfer/blocked-attempt.

CREATE TABLE candidate_ownership (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    candidate_id         UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    recruiter_id         UUID NOT NULL REFERENCES users(id),
    recruiter_email      TEXT NOT NULL,
    source               TEXT NOT NULL CHECK (source IN ('personal_mailbox','manual_add','bulk_upload','manual_assign')),
    ownership_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ownership_expires_at TIMESTAMPTZ NOT NULL,
    status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','transferred')),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, candidate_id)
);
CREATE INDEX idx_cand_ownership_status ON candidate_ownership (tenant_id, status, ownership_expires_at);
ALTER TABLE candidate_ownership ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_ownership FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON candidate_ownership
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE TABLE candidate_ownership_history (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    candidate_id      UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    recruiter_id      UUID REFERENCES users(id),
    recruiter_email   TEXT,
    action            TEXT NOT NULL CHECK (action IN ('claimed','expired','transferred','blocked_attempt')),
    source            TEXT,
    reason            TEXT,
    performed_by      UUID REFERENCES users(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cand_ownership_hist_cand ON candidate_ownership_history (tenant_id, candidate_id, created_at DESC);
ALTER TABLE candidate_ownership_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_ownership_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON candidate_ownership_history
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
