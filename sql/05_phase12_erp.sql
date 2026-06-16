-- P12 ERP: Timesheet + Invoice + Payroll
-- HARD RULE #11: Aadhaar/PAN/PF/bank-account encrypted at rest with pgcrypto pgp_sym_encrypt.
-- All tables have tenant_id + RLS. app_user accesses via encrypt/decrypt functions.

-- ─── Encryption helpers ───────────────────────────────────────────────────────
-- Key stored as DB setting (set per connection by application layer).
-- Application sets: SET app.encrypt_key = '<per-tenant-secret>' before any
-- encrypt/decrypt call. Keeps key out of the schema.

CREATE OR REPLACE FUNCTION erp_encrypt(plaintext text)
RETURNS bytea LANGUAGE sql SECURITY DEFINER AS $$
  SELECT pgp_sym_encrypt(plaintext, current_setting('app.encrypt_key', true))::bytea;
$$;

CREATE OR REPLACE FUNCTION erp_decrypt(ciphertext bytea)
RETURNS text LANGUAGE sql SECURITY DEFINER AS $$
  SELECT pgp_sym_decrypt(ciphertext, current_setting('app.encrypt_key', true));
$$;

-- ─── Contractor PII (HARD RULE #11) ──────────────────────────────────────────
-- Stores Aadhaar/PAN/PF/bank encrypted. Linked to candidates.
CREATE TABLE IF NOT EXISTS contractor_pii (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  candidate_id   uuid NOT NULL REFERENCES candidates(id),
  aadhaar_enc    bytea,          -- pgp_sym_encrypt(aadhaar_number, key)
  pan_enc        bytea,          -- pgp_sym_encrypt(pan_number, key)
  pf_number_enc  bytea,          -- pgp_sym_encrypt(pf_account_number, key)
  bank_account_enc bytea,        -- pgp_sym_encrypt(bank_account_number, key)
  bank_ifsc      text,           -- IFSC is not PII, store plain
  bank_name      text,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, candidate_id)
);
ALTER TABLE contractor_pii ENABLE ROW LEVEL SECURITY;
ALTER TABLE contractor_pii FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON contractor_pii
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);
GRANT SELECT, INSERT, UPDATE ON contractor_pii TO app_user;

-- ─── Timesheets ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS timesheets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  placement_id    uuid NOT NULL REFERENCES placements(id),
  candidate_id    uuid NOT NULL REFERENCES candidates(id),
  client_id       uuid REFERENCES clients(id),
  week_start      date NOT NULL,
  week_end        date NOT NULL GENERATED ALWAYS AS (week_start + 6) STORED,
  regular_hours   numeric(5,2) NOT NULL DEFAULT 0,
  overtime_hours  numeric(5,2) NOT NULL DEFAULT 0,
  total_hours     numeric(5,2) GENERATED ALWAYS AS (regular_hours + overtime_hours) STORED,
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','submitted','approved','rejected','billed')),
  submitted_at    timestamptz,
  approved_by     uuid REFERENCES users(id),
  approved_at     timestamptz,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE timesheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE timesheets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON timesheets
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);
CREATE INDEX IF NOT EXISTS idx_timesheets_placement ON timesheets(placement_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_status ON timesheets(tenant_id, status);
GRANT SELECT, INSERT, UPDATE ON timesheets TO app_user;

-- ─── Invoices ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  client_id       uuid NOT NULL REFERENCES clients(id),
  invoice_number  text NOT NULL,
  invoice_date    date NOT NULL DEFAULT current_date,
  due_date        date NOT NULL,
  subtotal        numeric(14,2) NOT NULL DEFAULT 0,
  gst_rate        numeric(5,2) NOT NULL DEFAULT 18,  -- GST % (India)
  gst_amount      numeric(14,2) GENERATED ALWAYS AS (subtotal * gst_rate / 100) STORED,
  total_amount    numeric(14,2) GENERATED ALWAYS AS (subtotal + subtotal * gst_rate / 100) STORED,
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','sent','paid','overdue','cancelled')),
  paid_at         timestamptz,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, invoice_number)
);
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invoices
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);
CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(tenant_id, status);
GRANT SELECT, INSERT, UPDATE ON invoices TO app_user;

-- Invoice line items (each timesheet week billed)
CREATE TABLE IF NOT EXISTS invoice_line_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  invoice_id      uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  timesheet_id    uuid REFERENCES timesheets(id),
  description     text NOT NULL,
  hours           numeric(6,2) NOT NULL DEFAULT 0,
  rate            numeric(10,2) NOT NULL DEFAULT 0,
  amount          numeric(14,2) GENERATED ALWAYS AS (hours * rate) STORED
);
ALTER TABLE invoice_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_line_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invoice_line_items
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);
GRANT SELECT, INSERT, DELETE ON invoice_line_items TO app_user;

-- ─── Payroll ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  pay_period_start date NOT NULL,
  pay_period_end   date NOT NULL,
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','approved','paid')),
  total_gross     numeric(14,2) NOT NULL DEFAULT 0,
  total_tds       numeric(14,2) NOT NULL DEFAULT 0,
  total_pf        numeric(14,2) NOT NULL DEFAULT 0,
  total_net       numeric(14,2) GENERATED ALWAYS AS (total_gross - total_tds - total_pf) STORED,
  approved_by     uuid REFERENCES users(id),
  approved_at     timestamptz,
  paid_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payroll_runs
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);
GRANT SELECT, INSERT, UPDATE ON payroll_runs TO app_user;

CREATE TABLE IF NOT EXISTS payslips (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  payroll_run_id  uuid NOT NULL REFERENCES payroll_runs(id),
  candidate_id    uuid NOT NULL REFERENCES candidates(id),
  placement_id    uuid REFERENCES placements(id),
  gross_pay       numeric(12,2) NOT NULL DEFAULT 0,
  tds_amount      numeric(12,2) NOT NULL DEFAULT 0,  -- Tax Deducted at Source
  pf_amount       numeric(12,2) NOT NULL DEFAULT 0,  -- Provident Fund (12% employee)
  net_pay         numeric(12,2) GENERATED ALWAYS AS (gross_pay - tds_amount - pf_amount) STORED,
  hours_worked    numeric(6,2) NOT NULL DEFAULT 0,
  pay_rate        numeric(10,2) NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE payslips ENABLE ROW LEVEL SECURITY;
ALTER TABLE payslips FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payslips
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);
CREATE INDEX IF NOT EXISTS idx_payslips_run ON payslips(payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_payslips_candidate ON payslips(tenant_id, candidate_id);
GRANT SELECT, INSERT ON payslips TO app_user;

-- ─── Sequence for invoice numbers ─────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS invoice_seq START 1000;
GRANT USAGE ON SEQUENCE invoice_seq TO app_user;

-- ─── Helper: auto-generate invoice from approved timesheets ─────────────────
-- Called by API — groups approved timesheets by client into a draft invoice.
CREATE OR REPLACE FUNCTION generate_invoice_from_timesheets(
  p_tenant_id uuid,
  p_client_id uuid,
  p_period_start date,
  p_period_end date,
  p_gst_rate numeric DEFAULT 18
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_invoice_id uuid;
  v_inv_num    text;
  v_subtotal   numeric := 0;
  v_row        RECORD;
BEGIN
  SET LOCAL app.tenant_id = p_tenant_id;
  v_inv_num := 'INV-' || nextval('invoice_seq');
  INSERT INTO invoices(tenant_id, client_id, invoice_number, due_date, gst_rate)
  VALUES (p_tenant_id, p_client_id, v_inv_num, p_period_end + 30, p_gst_rate)
  RETURNING id INTO v_invoice_id;

  FOR v_row IN
    SELECT t.id, t.total_hours, p.bill_rate,
           c.full_name || ' — week of ' || t.week_start AS desc
    FROM timesheets t
    JOIN placements p ON p.id = t.placement_id
    JOIN candidates c ON c.id = t.candidate_id
    WHERE t.tenant_id = p_tenant_id AND t.client_id = p_client_id
      AND t.status = 'approved'
      AND t.week_start >= p_period_start AND t.week_end <= p_period_end
  LOOP
    INSERT INTO invoice_line_items(tenant_id, invoice_id, timesheet_id, description, hours, rate)
    VALUES (p_tenant_id, v_invoice_id, v_row.id, v_row.desc, v_row.total_hours, COALESCE(v_row.bill_rate, 0));
    v_subtotal := v_subtotal + v_row.total_hours * COALESCE(v_row.bill_rate, 0);
    UPDATE timesheets SET status = 'billed' WHERE id = v_row.id;
  END LOOP;

  UPDATE invoices SET subtotal = v_subtotal WHERE id = v_invoice_id;
  RETURN v_invoice_id;
END;
$$;
GRANT EXECUTE ON FUNCTION generate_invoice_from_timesheets TO app_user;
