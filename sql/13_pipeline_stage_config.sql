-- AIrecruit: configurable pipeline-stage display (Stage-Workflow Phase 2)
--
-- Scope decision: the 13 stage KEYS below are load-bearing across the app
-- (applications.stage CHECK constraint; 'rejected' is a HITL/RBAC gate in
-- applications.py; 'placed' is set on offer acceptance in offers.py;
-- analytics.py/requisitions.py/recruiter_dashboard.py/pipeline_p2.py all
-- filter on the literal stage strings for revenue/SLA reporting). Making
-- the stage KEYS themselves arbitrary would require dropping that CHECK
-- constraint and auditing every one of those call sites. Instead this table
-- only configures the DISPLAY layer per tenant: label, color, board
-- position, and visibility. The underlying stage_key never changes.

CREATE TABLE IF NOT EXISTS pipeline_stage_config (
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  stage_key      TEXT NOT NULL CHECK (stage_key IN (
                    'sourced','contacted','interested','nda','screened',
                    'submitted','l1_interview','l2_interview','offer',
                    'offer_accepted','placed','rejected','hold'
                  )),
  label          TEXT NOT NULL,
  color          TEXT NOT NULL,
  display_order  INT NOT NULL,
  is_visible     BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, stage_key)
);

ALTER TABLE pipeline_stage_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_stage_config FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON pipeline_stage_config;
CREATE POLICY tenant_isolation ON pipeline_stage_config
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);

-- NOTE: this seed INSERT spans ALL tenants in one statement, so it must be
-- run as the `postgres` superuser (bypasses RLS) — as `app_user` it 500s
-- with "new row violates row-level security policy" because a tenant-scoped
-- app_user session only ever has ONE app.tenant_id set, never "all of them".
-- (The GET /settings/pipeline-stages endpoint separately lazy-seeds a single
-- tenant's 13 rows correctly via db.tenant_conn if this migration is skipped.)
--
-- Seed current defaults (matches the hardcoded STAGES array previously in
-- frontend/app/(dashboard)/pipeline/page.tsx) for every existing tenant.
INSERT INTO pipeline_stage_config (tenant_id, stage_key, label, color, display_order, is_visible)
SELECT t.id, s.stage_key, s.label, s.color, s.display_order, TRUE
FROM tenants t
CROSS JOIN (VALUES
  ('sourced',        'Sourced',        '#6366F1', 1),
  ('contacted',      'Contacted',      '#06B6D4', 2),
  ('interested',     'Interested',     '#3B82F6', 3),
  ('nda',            'NDA',            '#F59E0B', 4),
  ('screened',       'Screened',       '#0891B2', 5),
  ('submitted',      'Submitted',      '#64748B', 6),
  ('l1_interview',   'L1 Interview',   '#7C3AED', 7),
  ('l2_interview',   'L2 Interview',   '#9333EA', 8),
  ('offer',          'Offer',          '#CA8A04', 9),
  ('offer_accepted', 'Offer Accepted', '#059669', 10),
  ('placed',         'Placed ✓',       '#16A34A', 11),
  ('hold',           'On Hold',        '#94A3B8', 12),
  ('rejected',       'Rejected',       '#DC2626', 13)
) AS s(stage_key, label, color, display_order)
ON CONFLICT (tenant_id, stage_key) DO NOTHING;
