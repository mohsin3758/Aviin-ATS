-- Approved items 01, 02, 06 from the AI Auto-Assignment Engine research
-- audit: match_recruiters() previously ran a hardcoded 0.4 skill / 0.6
-- capacity formula that ignored scoring_weight_config entirely (item 01),
-- never checked recruiter_client_blocks (item 02), and never considered
-- location, performance, leave, prior-client relationship, or tenure
-- (item 06). Rewritten to read real weights and real data for every
-- factor that has an actual data source today. seniority_match and
-- language_match remain 0-contribution — no recruiter-side experience or
-- language field exists anywhere in the schema, and inventing one wasn't
-- part of what was approved. That's documented, not silently dropped.
--
-- Hard filter (not a scoring term, per the audit's explicit recommendation):
-- a recruiter with a matching recruiter_client_blocks row is excluded from
-- the candidate pool entirely for that client's requisitions.

CREATE OR REPLACE FUNCTION match_recruiters(p_req_id UUID, p_limit INTEGER DEFAULT 5)
RETURNS TABLE (
  recruiter_id                   UUID,
  full_name                      TEXT,
  email                          TEXT,
  capacity_weekly                INTEGER,
  active_assignments             INTEGER,
  available_capacity             INTEGER,
  skill_match_count              INTEGER,
  location_match                 BOOLEAN,
  on_leave                       BOOLEAN,
  performance_score              NUMERIC,
  has_prior_client_relationship  BOOLEAN,
  tenure_months                  INTEGER,
  match_score                    NUMERIC
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_tenant   UUID;
  v_w        RECORD;  -- scoring_weight_config row (or defaults)
BEGIN
  SELECT tenant_id INTO v_tenant FROM requisitions WHERE id = p_req_id;
  IF v_tenant IS NULL THEN
    RETURN;
  END IF;

  SELECT
    COALESCE(swc.capacity, 0.25)         AS capacity,
    COALESCE(swc.skill_match, 0.25)      AS skill_match,
    COALESCE(swc.relationship, 0.10)     AS relationship,
    COALESCE(swc.performance, 0.08)      AS performance,
    COALESCE(swc.leave_status, 0.10)     AS leave_status,
    COALESCE(swc.location_match, 0.07)   AS location_match,
    COALESCE(swc.tenure_stability, 0.03) AS tenure_stability,
    COALESCE(swc.urgency_bonus, 0.02)    AS urgency_bonus
  INTO v_w
  FROM (SELECT 1) dummy
  LEFT JOIN scoring_weight_config swc ON swc.tenant_id = v_tenant;

  RETURN QUERY
  WITH req AS (
    SELECT skills_required, client_id, location, priority
    FROM requisitions WHERE id = p_req_id
  ),
  recruiter_skills AS (
    SELECT a.recruiter_id, array_agg(DISTINCT s) AS skills
    FROM assignments a
    JOIN requisitions r2 ON r2.id = a.requisition_id
    CROSS JOIN LATERAL unnest(r2.skills_required) AS s
    GROUP BY a.recruiter_id
  ),
  load AS (
    SELECT a3.recruiter_id, count(*)::int AS active_assignments
    FROM assignments a3 WHERE a3.status = 'active'
    GROUP BY a3.recruiter_id
  ),
  latest_kpi AS (
    SELECT DISTINCT ON (user_id) user_id, total_score
    FROM recruiter_kpi_scores
    ORDER BY user_id, period_year DESC, period_month DESC
  ),
  relationship AS (
    SELECT DISTINCT a2.recruiter_id
    FROM placements pl
    JOIN assignments a2 ON a2.requisition_id = pl.requisition_id
    JOIN req ON req.client_id = pl.client_id
  ),
  candidates AS (
    SELECT
      u.id, u.full_name, u.email, u.capacity_weekly, u.location, u.created_at,
      COALESCE(l.active_assignments, 0) AS active_assignments,
      GREATEST(u.capacity_weekly - COALESCE(l.active_assignments, 0), 0) AS available_capacity,
      COALESCE(cardinality(ARRAY(
        SELECT unnest(rs.skills) INTERSECT SELECT unnest(req.skills_required)
      )), 0) AS skill_match_count,
      (
        u.location IS NOT NULL AND req.location IS NOT NULL AND (
          lower(trim(u.location)) = lower(trim(req.location))
          OR u.location ILIKE '%' || req.location || '%'
          OR req.location ILIKE '%' || u.location || '%'
        )
      ) AS location_match,
      EXISTS (
        SELECT 1 FROM recruiter_leave rl
        WHERE rl.recruiter_id = u.id AND CURRENT_DATE BETWEEN rl.start_date AND rl.end_date
      ) AS on_leave,
      COALESCE(lk.total_score, 50.0) AS kpi_score,
      EXISTS (SELECT 1 FROM relationship rel WHERE rel.recruiter_id = u.id) AS has_prior_client_relationship,
      GREATEST(0, (EXTRACT(YEAR FROM AGE(now(), u.created_at)) * 12 + EXTRACT(MONTH FROM AGE(now(), u.created_at)))::int) AS tenure_months
    FROM users u
    CROSS JOIN req
    LEFT JOIN recruiter_skills rs ON rs.recruiter_id = u.id
    LEFT JOIN load l ON l.recruiter_id = u.id
    LEFT JOIN latest_kpi lk ON lk.user_id = u.id
    WHERE u.role = 'recruiter' AND u.is_active
      -- Hard filter (item 02): exclude any recruiter blocked from this
      -- requisition's client, blanket-blocked or client-specific.
      AND NOT EXISTS (
        SELECT 1 FROM recruiter_client_blocks b, req
        WHERE b.recruiter_id = u.id AND (b.client_id IS NULL OR b.client_id = req.client_id)
      )
  )
  SELECT
    c.id, c.full_name, c.email, c.capacity_weekly, c.active_assignments, c.available_capacity,
    c.skill_match_count, c.location_match, c.on_leave, ROUND(c.kpi_score, 1),
    c.has_prior_client_relationship, c.tenure_months,
    ROUND((
      v_w.capacity         * (c.available_capacity::numeric / GREATEST(c.capacity_weekly, 1))
      + v_w.skill_match     * (c.skill_match_count::numeric / GREATEST(cardinality((SELECT skills_required FROM req)), 1))
      + v_w.location_match  * c.location_match::int
      + v_w.performance     * (c.kpi_score / 100.0)
      + v_w.leave_status    * (NOT c.on_leave)::int
      + v_w.relationship    * c.has_prior_client_relationship::int
      + v_w.tenure_stability* LEAST(c.tenure_months / 24.0, 1.0)
      + v_w.urgency_bonus   * (c.available_capacity::numeric / GREATEST(c.capacity_weekly, 1))
                            * (CASE (SELECT priority FROM req)
                                 WHEN 'critical' THEN 1.0 WHEN 'high' THEN 0.6
                                 WHEN 'medium' THEN 0.3 ELSE 0.1 END)
      -- seniority_match, language_match: 0-contribution, no data source exists (documented gap)
    ) * 100, 2) AS match_score
  FROM candidates c
  ORDER BY 13 DESC, 2  -- match_score DESC, full_name — ordinal refs: "match_score"
                       -- as a bare name collides with the RETURNS TABLE out-param
                       -- of the same name, same class of bug as recruiter_id above
  LIMIT p_limit;
END;
$$;
