-- retention_bank had an INSERT ... ON CONFLICT DO NOTHING (incentives.py's
-- approve_scorecard) with no matching unique/exclusion constraint to fire on
-- (only `id`, a fresh random UUID every time, was ever unique) — so the
-- clause was dead code and re-approving a scorecard (double-click, retry,
-- or re-PATCHing status='approved') silently double-accrued a held
-- incentive row for the same user/period. Confirmed zero existing
-- duplicates in production before adding this (both real tenants checked).
CREATE UNIQUE INDEX IF NOT EXISTS uq_retention_bank_period
  ON retention_bank (tenant_id, user_id, accrued_month, accrued_year);
