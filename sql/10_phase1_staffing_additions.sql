-- ============================================================
-- AIrecruit / FinStack Staffing OS — Phase 1 staffing additions
-- Runs after 01_phase1_schema.sql (depends on tenants, clients,
-- candidates, requisitions, applications, offers).
--
-- hotlist     -> backs v_redeployment_queue (P1/P3)
-- submittals  -> backs v_agency_funnel (submittals->placements, P1/P3)
-- placements  -> backs v_agency_funnel + v_redeployment_queue
-- ============================================================

CREATE TABLE hotlist (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  candidate_id    UUID NOT NULL REFERENCES candidates(id),
  available_from  DATE,
  reason          TEXT NOT NULL DEFAULT 'bench' CHECK (reason IN ('bench','contract_ending','other')),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE submittals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  application_id   UUID NOT NULL REFERENCES applications(id),
  submitted_rate   NUMERIC(12,2),
  rate_type        TEXT NOT NULL DEFAULT 'annual' CHECK (rate_type IN ('hourly','daily','monthly','annual')),
  status           TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','client_review','shortlisted','rejected','withdrawn')),
  client_feedback  TEXT,
  submitted_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE placements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  offer_id        UUID NOT NULL REFERENCES offers(id),
  candidate_id    UUID NOT NULL REFERENCES candidates(id),
  requisition_id  UUID NOT NULL REFERENCES requisitions(id),
  client_id       UUID REFERENCES clients(id),
  start_date      DATE NOT NULL,
  end_date        DATE,
  bill_rate       NUMERIC(12,2),
  pay_rate        NUMERIC(12,2),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','ending_soon','ended','converted_fte')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY['hotlist','submittals','placements'])
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
      t
    );
    EXECUTE format('CREATE INDEX %I ON %I (tenant_id)', 'idx_' || t || '_tenant', t);
  END LOOP;
END
$$;

-- v_redeployment_queue (P1/P3): contractors whose placement ends within N days
CREATE INDEX idx_placements_end_date ON placements (end_date) WHERE end_date IS NOT NULL;
