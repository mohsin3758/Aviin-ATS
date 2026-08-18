-- REAL BUG FIX (2026-08-18): v_recruiter_capacity's active_assignments/
-- utilization_pct counted every assignments row with status='active',
-- regardless of whether the requisition it points at was later soft-
-- deleted or closed. Found live via the Dashboard's Recruiter Capacity
-- card: "QA Test Recruiter" (a real, permanently-kept, active test-login
-- fixture, not a bug in itself) showed 3/40 slots -- all 3 pointing at
-- soft-deleted/closed QA test requisitions. The same gap affected real
-- recruiters too (khan mer: 6/6 "active" assignments all stale; mohsin3786:
-- 6 of 7). This is a structural gap, not just leftover QA data: nothing
-- in this codebase ever resolved an assignment when its requisition was
-- later closed/soft-deleted.

-- One-time cleanup: resolve existing stale 'active' assignments pointing
-- at a soft-deleted requisition to 'completed' (the requisition's work is
-- over -- not 'reassigned', which would misrepresent this as a real
-- handoff to another recruiter that never happened).
UPDATE assignments a
SET status = 'completed', updated_at = now()
FROM requisitions r
WHERE a.requisition_id = r.id
  AND a.status = 'active'
  AND r.is_active IS FALSE;

-- Permanent fix: exclude assignments against soft-deleted requisitions
-- from the "active" utilization count going forward, for every recruiter,
-- not just the ones caught in the one-time cleanup above.
CREATE OR REPLACE VIEW v_recruiter_capacity AS
SELECT u.tenant_id,
       u.id AS recruiter_id,
       u.full_name,
       u.email,
       u.role,
       u.skill_tags,
       COALESCE(u.max_active_reqs, 8) AS max_active_reqs,
       u.capacity_weekly,
       count(a.id) FILTER (WHERE a.status = 'active' AND r.is_active IS NOT FALSE) AS active_assignments,
       GREATEST(0::bigint, COALESCE(u.max_active_reqs, 8) - count(a.id) FILTER (WHERE a.status = 'active' AND r.is_active IS NOT FALSE)) AS available_capacity,
       round(count(a.id) FILTER (WHERE a.status = 'active' AND r.is_active IS NOT FALSE)::numeric / NULLIF(COALESCE(u.max_active_reqs, 8), 0)::numeric * 100::numeric, 1) AS utilization_pct,
       u.is_active
FROM users u
LEFT JOIN assignments a ON a.recruiter_id = u.id AND a.status = 'active'
LEFT JOIN requisitions r ON r.id = a.requisition_id
WHERE u.is_active = true
GROUP BY u.id, u.tenant_id, u.full_name, u.email, u.role, u.skill_tags, u.max_active_reqs, u.capacity_weekly, u.is_active
ORDER BY u.full_name;
