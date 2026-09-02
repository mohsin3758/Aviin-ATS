-- Gap-audit fix (Phase 11, 2026-09-02) — "Jobs Created" is not tracked
-- as a per-recruiter metric anywhere in the codebase (confirmed via a
-- whole-repo grep: zero references). requisitions.created_by already
-- exists and is exactly the real, granular signal needed — a live
-- COUNT against it, not a new rollup table, matches how this same view
-- already computes every other real-time figure. Widens
-- v_recruiter_activity_summary with today_jobs_created/week_jobs_created,
-- same real-time shape as its existing today_sourced/week_sourced
-- columns, via CREATE OR REPLACE (column-additive, same return columns
-- kept plus 2 new ones at the end — every existing caller's SELECT *
-- keeps working unchanged).

CREATE OR REPLACE VIEW v_recruiter_activity_summary AS
SELECT
  u.id AS recruiter_id,
  u.tenant_id,
  u.full_name,
  COALESCE(d.candidates_sourced, 0) AS today_sourced,
  COALESCE(d.candidates_submitted, 0) AS today_submitted,
  COALESCE(d.interviews_completed, 0) AS today_interviews,
  COALESCE(d.placements, 0) AS today_placements,
  COALESCE(w.candidates_sourced, 0) AS week_sourced,
  COALESCE(w.candidates_submitted, 0) AS week_submitted,
  COALESCE(w.placements, 0) AS week_placements,
  s.overall_score,
  s.grade,
  s.score_date,
  COALESCE(rj_today.cnt, 0) AS today_jobs_created,
  COALESCE(rj_week.cnt, 0) AS week_jobs_created
FROM users u
LEFT JOIN recruiter_productivity_daily d
  ON d.recruiter_id = u.id AND d.tenant_id = u.tenant_id AND d.period_start = CURRENT_DATE
LEFT JOIN recruiter_productivity_weekly w
  ON w.recruiter_id = u.id AND w.tenant_id = u.tenant_id
  AND w.period_start = date_trunc('week', CURRENT_DATE::timestamp)::date
LEFT JOIN recruiter_performance_scores s
  ON s.recruiter_id = u.id AND s.tenant_id = u.tenant_id AND s.score_date = CURRENT_DATE
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS cnt FROM requisitions r
  WHERE r.created_by = u.id AND r.tenant_id = u.tenant_id
    AND r.created_at::date = CURRENT_DATE AND r.is_active IS NOT FALSE
) rj_today ON true
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS cnt FROM requisitions r
  WHERE r.created_by = u.id AND r.tenant_id = u.tenant_id
    AND r.created_at >= date_trunc('week', CURRENT_DATE::timestamp) AND r.is_active IS NOT FALSE
) rj_week ON true
WHERE u.role = 'recruiter' AND u.is_active IS NOT FALSE;

-- CRITICAL: CREATE OR REPLACE VIEW does NOT preserve reloptions across
-- a replace — this view was already correctly security_invoker=true
-- (confirmed live before writing this migration), and silently losing
-- that here would reopen the exact real cross-tenant leak class fixed
-- earlier this same day for v_recruiter_capacity/v_monthly_billing/
-- v_sla_dashboard. Re-applied explicitly, in the same migration, right
-- after the replace.
ALTER VIEW v_recruiter_activity_summary SET (security_invoker = true);
