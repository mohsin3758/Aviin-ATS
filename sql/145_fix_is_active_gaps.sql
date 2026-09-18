-- End-to-end audit fix (2026-09-18): the same "missing is_active filter on
-- applications/requisitions" bug class already found and fixed three times
-- on the new Screening Tracker dashboard (see backend/routers/candidates.py
-- sourcing_status_summary) also existed in two long-standing views. Fixing
-- here so it stops recurring client-by-client as users happen to notice it.

-- v_sla_dashboard: total_submissions/interviews/offers/hires per requisition
-- never filtered a.is_active, so a removed/soft-deleted application still
-- counted toward the SLA Tracking page's per-role totals.
CREATE OR REPLACE VIEW v_sla_dashboard AS
 SELECT r.id AS requisition_id,
    r.tenant_id,
    r.title AS role_title,
    r.title AS client_name,
    r.created_at AS opened_at,
    r.status,
    EXTRACT(day FROM now() - r.created_at)::integer AS age_days,
    count(DISTINCT a.id) AS total_submissions,
    count(DISTINCT
        CASE
            WHEN a.stage LIKE '%interview%' THEN a.id
            ELSE NULL::uuid
        END) AS interviews,
    count(DISTINCT
        CASE
            WHEN a.stage = 'offer' THEN a.id
            ELSE NULL::uuid
        END) AS offers,
    count(DISTINCT
        CASE
            WHEN a.stage = 'placed' THEN a.id
            ELSE NULL::uuid
        END) AS hires,
    st.time_to_first_sub_hrs,
    st.time_to_fill_days,
    COALESCE(st.sla_target_days, 30) AS sla_target_days,
    COALESCE(st.sla_breached, EXTRACT(day FROM now() - r.created_at) > COALESCE(st.sla_target_days, 30)::numeric) AS sla_breached
   FROM requisitions r
     LEFT JOIN applications a ON a.requisition_id = r.id AND a.tenant_id = r.tenant_id
        AND a.is_active IS NOT FALSE
     LEFT JOIN sla_tracking st ON st.requisition_id = r.id AND st.tenant_id = r.tenant_id
  WHERE r.is_active IS NOT FALSE
  GROUP BY r.id, r.tenant_id, r.title, r.created_at, r.status, st.time_to_first_sub_hrs, st.time_to_fill_days, st.sla_target_days, st.sla_breached;

-- CREATE OR REPLACE VIEW does not preserve security_invoker -- must be
-- re-set every time this view is replaced (sql/101 already learned this).
ALTER VIEW v_sla_dashboard SET (security_invoker = true);

-- v_pipeline_velocity: per-stage counts never filtered a.is_active, so a
-- removed application still counted on the Reports > Pipeline Velocity tab.
CREATE OR REPLACE VIEW v_pipeline_velocity AS
 SELECT a.tenant_id,
    a.stage,
    count(*) AS count,
    round(avg(EXTRACT(epoch FROM now() - a.updated_at) / 86400::numeric), 1) AS avg_days_in_stage,
    count(*) FILTER (WHERE (EXTRACT(epoch FROM now() - a.updated_at) / 86400::numeric) > 7::numeric) AS stale_count
   FROM applications a
   JOIN candidates c ON c.id = a.candidate_id
  WHERE c.is_active IS NOT FALSE AND a.is_active IS NOT FALSE
  GROUP BY a.tenant_id, a.stage;
