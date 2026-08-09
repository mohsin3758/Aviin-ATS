-- Recruiter-assignment competitive gap analysis (2026-08-09) — implements
-- all 6 build recommendations. No-op CREATE TABLE IF NOT EXISTS blocks for
-- sla_tier_config/scoring_weight_config close the same schema-drift gap
-- documented in the audit (both existed live, owned by app_user, but had
-- no CREATE TABLE in any committed migration).

-- ── 1. sla_tier_config (schema-drift backfill, no-op if already present) ──
CREATE TABLE IF NOT EXISTS sla_tier_config (
    tenant_id       UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    low_hours       INTEGER DEFAULT 1440,
    medium_hours    INTEGER DEFAULT 720,
    high_hours      INTEGER DEFAULT 360,
    critical_hours  INTEGER DEFAULT 168,
    updated_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at      TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE sla_tier_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_tier_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sla_tier_config;
CREATE POLICY tenant_isolation ON sla_tier_config
    USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);
GRANT ALL ON sla_tier_config TO app_user;

-- ── 2. scoring_weight_config (schema-drift backfill, no-op if already present) ──
CREATE TABLE IF NOT EXISTS scoring_weight_config (
    tenant_id         UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    capacity          NUMERIC(5,4) DEFAULT 0.25,
    skill_match       NUMERIC(5,4) DEFAULT 0.25,
    relationship      NUMERIC(5,4) DEFAULT 0.10,
    performance       NUMERIC(5,4) DEFAULT 0.08,
    leave_status      NUMERIC(5,4) DEFAULT 0.10,
    location_match    NUMERIC(5,4) DEFAULT 0.07,
    seniority_match   NUMERIC(5,4) DEFAULT 0.06,
    language_match    NUMERIC(5,4) DEFAULT 0.04,
    tenure_stability  NUMERIC(5,4) DEFAULT 0.03,
    urgency_bonus     NUMERIC(5,4) DEFAULT 0.02,
    updated_by        UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at        TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE scoring_weight_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE scoring_weight_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON scoring_weight_config;
CREATE POLICY tenant_isolation ON scoring_weight_config
    USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);
GRANT ALL ON scoring_weight_config TO app_user;

-- ── 3. Recommendation 2: per-role job-visibility scope ("all" vs
-- "assigned_only" jobs on Requisitions/Pipeline/Dashboard) ──
ALTER TABLE role_definitions
    ADD COLUMN IF NOT EXISTS job_visibility_scope TEXT NOT NULL DEFAULT 'all'
    CHECK (job_visibility_scope IN ('all', 'assigned_only'));

-- ── 4. Recommendation 1: wire sla_tier_config (+ client priority_tier)
-- into find_sla_breaches(). Same return signature as before so no Python
-- caller needs to change — `sla_hours` in the result now means "effective
-- hours actually used for this breach check", not the raw column, which
-- was frequently NULL (206 of 217 real requisitions on this tenant had no
-- explicit sla_hours, so those requisitions were never breach-checked at
-- all before this fix — a bigger bug than "the tier config is ignored").
-- Precedence: an explicit per-requisition sla_hours always wins (a
-- deliberate manual override); otherwise the tenant's configured
-- priority-tier hours apply, adjusted by the client's priority_tier
-- (strategic = 20% tighter, low_touch = 20% more slack); final fallback
-- of 168h only if a tenant has neither a requisition-level value nor an
-- sla_tier_config row at all.
CREATE OR REPLACE FUNCTION find_sla_breaches()
RETURNS TABLE (
  requisition_id    UUID,
  title             TEXT,
  client_id         UUID,
  sla_hours         INT,
  hours_open        NUMERIC,
  positions_count   INT,
  placements_count  BIGINT
)
LANGUAGE sql
STABLE
AS $$
  WITH cfg AS (
    SELECT * FROM sla_tier_config LIMIT 1  -- RLS scopes to at most 1 row (this tenant)
  ),
  effective AS (
    SELECT r.id, r.title, r.client_id, r.created_at, r.positions_count,
           COALESCE(
             r.sla_hours,
             ROUND(
               CASE r.priority
                 WHEN 'critical' THEN cfg.critical_hours
                 WHEN 'high'     THEN cfg.high_hours
                 WHEN 'low'      THEN cfg.low_hours
                 ELSE cfg.medium_hours
               END
               * CASE cl.priority_tier
                   WHEN 'strategic' THEN 0.8
                   WHEN 'low_touch' THEN 1.2
                   ELSE 1.0
                 END
             )::int,
             168
           ) AS effective_sla_hours
    FROM requisitions r
    LEFT JOIN cfg ON true
    LEFT JOIN clients cl ON cl.id = r.client_id
    WHERE r.status = 'open'
  )
  SELECT e.id, e.title, e.client_id, e.effective_sla_hours,
         ROUND(EXTRACT(EPOCH FROM (now() - e.created_at)) / 3600, 1),
         e.positions_count,
         COUNT(p.id)
  FROM effective e
  LEFT JOIN placements p
    ON p.requisition_id = e.id AND p.status IN ('active','ending_soon','converted_fte')
  WHERE e.created_at < now() - (e.effective_sla_hours || ' hours')::interval
  GROUP BY e.id, e.title, e.client_id, e.effective_sla_hours, e.created_at, e.positions_count
  HAVING COUNT(p.id) < e.positions_count;
$$;

-- ── 5. Recommendation 6: wire clients.priority_tier into match_recruiters()'s
-- urgency_bonus term, alongside the existing requisition-priority multiplier
-- (same term, not a new weight column — a strategic client's urgent job
-- should push available-capacity harder than a standard client's, but this
-- is still fundamentally "how urgently should we reward free capacity",
-- the same concept urgency_bonus already exists for).
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
    SELECT r.skills_required, r.client_id, r.location, r.priority, cl.priority_tier AS client_priority_tier
    FROM requisitions r
    LEFT JOIN clients cl ON cl.id = r.client_id
    WHERE r.id = p_req_id
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
                            * (CASE (SELECT client_priority_tier FROM req)
                                 WHEN 'strategic' THEN 1.3 WHEN 'low_touch' THEN 0.8 ELSE 1.0 END)
      -- seniority_match, language_match: 0-contribution, no data source exists (documented gap)
    ) * 100, 2) AS match_score
  FROM candidates c
  ORDER BY 13 DESC, 2  -- match_score DESC, full_name — ordinal refs: "match_score"
                       -- as a bare name collides with the RETURNS TABLE out-param
                       -- of the same name, same class of bug as recruiter_id above
  LIMIT p_limit;
END;
$$;
