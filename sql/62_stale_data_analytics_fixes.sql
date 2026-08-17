-- Deep test/QA/demo-data audit, round 7 (2026-08-17): several more
-- report/dashboard endpoints found with the same missing is_active
-- filter bug documented extensively earlier this same day. This file
-- backfills find_stalled_assignments() (existed live with zero
-- CREATE FUNCTION in any prior committed migration - real schema drift,
-- same pattern found repeatedly in this project's history) with the
-- fix already applied, rather than backfilling the broken version
-- first and fixing it in a second statement.

CREATE OR REPLACE FUNCTION find_stalled_assignments(p_hours integer)
RETURNS TABLE (
  assignment_id      UUID,
  requisition_id      UUID,
  requisition_title   TEXT,
  recruiter_id         UUID,
  recruiter_name       TEXT,
  recruiter_email      TEXT,
  assigned_at          TIMESTAMPTZ,
  hours_since_update   NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  SELECT a.id, a.requisition_id, r.title, a.recruiter_id, u.full_name, u.email,
         a.assigned_at,
         ROUND(EXTRACT(EPOCH FROM (now() - a.updated_at)) / 3600, 1)
  FROM assignments a
  JOIN requisitions r ON r.id = a.requisition_id
  JOIN users u ON u.id = a.recruiter_id
  WHERE a.status = 'active'
    AND r.status = 'open'
    AND r.is_active IS NOT FALSE
    AND u.is_active IS NOT FALSE
    AND a.updated_at < now() - (p_hours || ' hours')::interval;
$$;
