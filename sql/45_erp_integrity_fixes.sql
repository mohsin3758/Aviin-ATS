-- ERP audit fixes (2026-08-10 round-3 audit): payroll double-pay,
-- reversible-after-billing timesheets, duplicate zero-value invoices,
-- and PUBLIC EXECUTE erosion on 2 SECURITY DEFINER functions.

-- ── 1. Payroll idempotency ──────────────────────────────────────────────
-- A period can only ever have one real payroll run (retries/double-clicks
-- now 409 instead of silently generating a second, fully-duplicate set of
-- payslips for the same hours).
ALTER TABLE payroll_runs
    ADD CONSTRAINT payroll_runs_period_uniq UNIQUE (tenant_id, pay_period_start, pay_period_end);

-- Per-timesheet marker: once a timesheet has been pulled into a payroll
-- run, it can never be pulled into a second one, even under a different
-- (e.g. overlapping) period boundary — a stronger guarantee than the
-- period-uniqueness constraint alone.
ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS payroll_run_id UUID REFERENCES payroll_runs(id);
CREATE INDEX IF NOT EXISTS idx_timesheets_payroll_run ON timesheets(payroll_run_id);

-- ── 2. Duplicate invoice generation ─────────────────────────────────────
-- Old version inserted the invoice header (and burned an invoice number)
-- before checking whether any approved timesheets existed for the period —
-- a second call for an already-billed period produced a permanent ₹0
-- invoice with no line items and no way to delete it. Now checks first and
-- returns NULL (mapped to a 400 in the router) when there's nothing to bill.
CREATE OR REPLACE FUNCTION generate_invoice_from_timesheets(
    p_tenant_id UUID, p_client_id UUID, p_period_start DATE, p_period_end DATE, p_gst_rate NUMERIC DEFAULT 18
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_invoice_id UUID;
  v_inv_num    TEXT;
  v_subtotal   NUMERIC := 0;
  v_row        RECORD;
  v_has_rows   BOOLEAN;
BEGIN
  -- Bare `SET LOCAL app.tenant_id = p_tenant_id` does NOT substitute the
  -- plpgsql variable — it literally sets the GUC to the 9-char string
  -- "p_tenant_id" (proven live: current_setting() read back that exact
  -- string after a real call). Every RLS-protected query later in the
  -- SAME transaction then fails casting that string to ::uuid — silently
  -- masked until now because no caller ever ran a second RLS-protected
  -- query on the same connection after this function returned. Found
  -- while wiring event_outbox/audit_log writes into the invoice-generate
  -- endpoint (round-3 audit fix), which does exactly that.
  EXECUTE format('SET LOCAL app.tenant_id = %L', p_tenant_id);

  SELECT EXISTS (
    SELECT 1 FROM timesheets t
    WHERE t.tenant_id = p_tenant_id AND t.client_id = p_client_id
      AND t.status = 'approved'
      AND t.week_start >= p_period_start AND t.week_end <= p_period_end
  ) INTO v_has_rows;

  IF NOT v_has_rows THEN
    RETURN NULL;
  END IF;

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

-- ── 3. PUBLIC EXECUTE erosion (defense-in-depth) ────────────────────────
-- erp_decrypt (PII decryption) and generate_invoice_from_timesheets (sets
-- app.tenant_id from a raw parameter, bypassing RLS) were both callable by
-- any DB role. Neither is reachable over HTTP today, but both should only
-- ever be callable by the app's own role.
REVOKE EXECUTE ON FUNCTION erp_decrypt(bytea) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION generate_invoice_from_timesheets(UUID, UUID, DATE, DATE, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_decrypt(bytea) TO app_user;
GRANT EXECUTE ON FUNCTION generate_invoice_from_timesheets(UUID, UUID, DATE, DATE, NUMERIC) TO app_user;

-- ── 4. Audit trail for ERP writes (HARD RULE #5/#6) ─────────────────────
-- Application code (erp.py) writes event_outbox/audit_log directly on each
-- mutating call from here on; no schema change needed for that part beyond
-- confirming both tables already accept these dedup_key shapes (they do —
-- same tables every other module already writes to).
