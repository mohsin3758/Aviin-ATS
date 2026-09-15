-- WhatsApp automation research round 3 (2026-09-15): genuinely new gaps
-- found beyond the first two research passes -- inbound keyword self-
-- signup (Phenom's "text DRIVER to apply" pattern), and placed-contractor
-- timesheet nudges (a staffing-agency-specific workflow distinct from
-- candidate screening -- reuses the existing placements/timesheets
-- tables, sql/05 and sql/10).

-- A candidate can now text a published keyword (e.g. "DRIVER") to self-
-- initiate, instead of every screening being agency-initiated. Case-
-- insensitive match, one keyword per open requisition per tenant.
ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS inbound_keyword TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_requisitions_inbound_keyword
    ON requisitions (tenant_id, upper(inbound_keyword)) WHERE inbound_keyword IS NOT NULL;

-- A placement with no submitted timesheet for the week it just ended
-- gets a WhatsApp reminder, escalating to a back-office task on repeat.
ALTER TABLE timesheets
  ADD COLUMN IF NOT EXISTS whatsapp_reminder_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS whatsapp_escalated_at TIMESTAMPTZ;
