-- QA sweep (2026-09-01) Phase 5 cross-tenant leak sweep — found while
-- systematically checking every real view in the schema for the same
-- security_invoker gap already found once on v_recruiter_capacity
-- (2026-08-31). Direct live-DB check (pg_class.reloptions, not guessed
-- from any committed migration) found 2 more real views with the
-- identical structural gap: v_monthly_billing and v_sla_dashboard —
-- both genuinely missing `security_invoker = true`, both confirmed
-- owned by `postgres` (which bypasses RLS), both querying real, tenant-
-- scoped RLS-protected tables (placements/requisitions/applications/
-- sla_tracking).
--
-- Every real backend caller of both views (3 total, grepped across the
-- whole backend — p23_p27.py's GET /sla and GET /sla/summary, p36_p42.
-- py's GET /reports/monthly-billing) already correctly applies an
-- explicit `WHERE tenant_id=$1` at the app level using the caller's own
-- authenticated actor.tenant_id, so a normal call today is NOT
-- currently leaking cross-tenant data in practice — this is a real,
-- confirmed structural gap (RLS silently inert as a defense-in-depth
-- backstop), not a currently-exploited live incident. Fixed anyway,
-- immediately, matching the same standard already applied to
-- v_recruiter_capacity: any future caller that forgets the tenant_id
-- filter (the exact "missing is_active filter" class of mistake this
-- project has found and fixed dozens of times elsewhere) would
-- otherwise leak every tenant's real billing/SLA data with zero error
-- and zero warning.

ALTER VIEW v_monthly_billing SET (security_invoker = true);
ALTER VIEW v_sla_dashboard SET (security_invoker = true);
