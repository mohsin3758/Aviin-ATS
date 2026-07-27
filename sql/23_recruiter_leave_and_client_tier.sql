-- Approved items 09 (availability/leave tracking) and 07 (client priority
-- tier) from the AI Auto-Assignment Engine research audit. Both are real
-- prerequisites for the scoring-engine rewrite in items 1/2/6: leave_status
-- and urgency_bonus are configured weights in scoring_weight_config with no
-- underlying data to compute from until these land.

-- ── Item 09: recruiter_leave ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recruiter_leave (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  recruiter_id  UUID NOT NULL REFERENCES users(id),
  leave_type    TEXT NOT NULL DEFAULT 'other' CHECK (leave_type IN ('vacation','sick','personal','other')),
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL CHECK (end_date >= start_date),
  notes         TEXT,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recruiter_leave_recruiter ON recruiter_leave(recruiter_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_recruiter_leave_tenant ON recruiter_leave(tenant_id);

ALTER TABLE recruiter_leave ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruiter_leave FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON recruiter_leave;
CREATE POLICY tenant_isolation ON recruiter_leave
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);

-- ── Item 07: client priority tier ───────────────────────────────────────
ALTER TABLE clients ADD COLUMN IF NOT EXISTS priority_tier TEXT NOT NULL DEFAULT 'standard'
  CHECK (priority_tier IN ('strategic','standard','low_touch'));
