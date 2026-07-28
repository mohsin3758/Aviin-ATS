-- Approved gaps from the 10-item "did we already build this" check, 2026-07-28:
-- (9) hierarchy/approval-chain routing for requisitions, using the same
-- users.reporting_to org-chart field populated earlier this session.

-- requisitions.approval_status already existed (an early migration
-- anticipated draft/pending_approval/approved but the workflow was never
-- built - CLAUDE.md's earlier audit found zero application code touching
-- it). Its CHECK constraint has no 'rejected' terminal state at all; adding
-- one properly rather than overloading 'draft' (which means "not yet
-- submitted", a different thing from "reviewed and declined").
ALTER TABLE requisitions DROP CONSTRAINT IF EXISTS requisitions_approval_status_check;
ALTER TABLE requisitions ADD CONSTRAINT requisitions_approval_status_check
  CHECK (approval_status = ANY (ARRAY['draft', 'pending_approval', 'approved', 'rejected']));

CREATE TABLE IF NOT EXISTS requisition_approval_steps (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  requisition_id UUID NOT NULL REFERENCES requisitions(id) ON DELETE CASCADE,
  step_number    INTEGER NOT NULL,
  approver_id    UUID NOT NULL REFERENCES users(id),
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','approved','rejected','skipped')),
  comment        TEXT,
  acted_at       TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (requisition_id, step_number)
);
CREATE INDEX IF NOT EXISTS idx_approval_steps_req ON requisition_approval_steps(tenant_id, requisition_id);
CREATE INDEX IF NOT EXISTS idx_approval_steps_approver ON requisition_approval_steps(tenant_id, approver_id, status);

ALTER TABLE requisition_approval_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE requisition_approval_steps FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON requisition_approval_steps;
CREATE POLICY tenant_isolation ON requisition_approval_steps
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);
