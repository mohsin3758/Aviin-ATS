-- ===================================================================
-- Phase 3: AI Engine — match/assign SQL functions + analytics views
--
-- All functions are LANGUAGE sql/plpgsql with the default SECURITY
-- INVOKER, so they run with the calling role's privileges and RLS
-- (tenant_isolation policies from sql/01_phase1_schema.sql /
-- sql/10_phase1_staffing_additions.sql) is enforced exactly as for
-- ordinary queries — a req_id/assignment_id from another tenant
-- yields zero rows (fail-closed), per HARD RULE #2.
--
-- Apply as postgres (DDL only, HARD RULE #2/#9 exception):
--   docker compose cp sql/04_phase3_ai_engine.sql db:/tmp/04.sql
--   docker compose exec -T db psql -U postgres -d ats -f /tmp/04.sql
-- New functions/views are auto-usable by app_user via the
-- ALTER DEFAULT PRIVILEGES grants in sql/00_app_role.sql.
-- ===================================================================

-- -------------------------------------------------------------
-- match_candidates(req_id, limit) [T1]
-- Ranks candidates for a requisition by a blend of resume/JD
-- embedding cosine similarity (pgvector <=>, HARD RULE #3,
-- 384-dim BGE-small) and skills_required overlap.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION match_candidates(p_req_id UUID, p_limit INT DEFAULT 10)
RETURNS TABLE (
  candidate_id      UUID,
  full_name         TEXT,
  email             TEXT,
  skills            TEXT[],
  total_exp_mo      INT,
  location          TEXT,
  cosine_similarity NUMERIC,
  skill_overlap     INT,
  fit_score         NUMERIC
)
LANGUAGE sql STABLE AS $$
  WITH req AS (
    SELECT skills_required, jd_embedding FROM requisitions WHERE id = p_req_id
  )
  SELECT
    c.id,
    c.full_name,
    c.email,
    c.skills,
    c.total_exp_mo,
    c.location,
    ROUND(COALESCE(1 - (c.resume_embedding <=> req.jd_embedding), 0)::numeric, 4) AS cosine_similarity,
    COALESCE(cardinality(ARRAY(
      SELECT unnest(c.skills) INTERSECT SELECT unnest(req.skills_required)
    )), 0) AS skill_overlap,
    ROUND((
      0.6 * GREATEST(COALESCE(1 - (c.resume_embedding <=> req.jd_embedding), 0), 0)::numeric
      +
      0.4 * COALESCE(cardinality(ARRAY(
        SELECT unnest(c.skills) INTERSECT SELECT unnest(req.skills_required)
      )), 0)::numeric / GREATEST(cardinality(req.skills_required), 1)
    ) * 100, 2) AS fit_score
  FROM candidates c, req
  ORDER BY fit_score DESC, c.full_name
  LIMIT p_limit;
$$;

-- -------------------------------------------------------------
-- match_recruiters(req_id, limit) [T1]
-- Ranks active recruiters by historical skill-overlap (skills
-- of requisitions they've previously been assigned to, vs. this
-- requisition's skills_required) blended with current spare
-- capacity (capacity_weekly vs. active assignment count).
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION match_recruiters(p_req_id UUID, p_limit INT DEFAULT 5)
RETURNS TABLE (
  recruiter_id       UUID,
  full_name          TEXT,
  email              TEXT,
  capacity_weekly    INT,
  active_assignments INT,
  available_capacity INT,
  skill_match_count  INT,
  match_score        NUMERIC
)
LANGUAGE sql STABLE AS $$
  WITH req AS (
    SELECT skills_required FROM requisitions WHERE id = p_req_id
  ),
  recruiter_skills AS (
    SELECT a.recruiter_id, array_agg(DISTINCT s) AS skills
    FROM assignments a
    JOIN requisitions r2 ON r2.id = a.requisition_id
    CROSS JOIN LATERAL unnest(r2.skills_required) AS s
    GROUP BY a.recruiter_id
  ),
  load AS (
    SELECT recruiter_id, count(*)::int AS active_assignments
    FROM assignments
    WHERE status = 'active'
    GROUP BY recruiter_id
  )
  SELECT
    u.id,
    u.full_name,
    u.email,
    u.capacity_weekly,
    COALESCE(l.active_assignments, 0) AS active_assignments,
    GREATEST(u.capacity_weekly - COALESCE(l.active_assignments, 0), 0) AS available_capacity,
    COALESCE(cardinality(ARRAY(
      SELECT unnest(rs.skills) INTERSECT SELECT unnest(req.skills_required)
    )), 0) AS skill_match_count,
    ROUND((
      0.4 * COALESCE(cardinality(ARRAY(
        SELECT unnest(rs.skills) INTERSECT SELECT unnest(req.skills_required)
      )), 0)::numeric / GREATEST(cardinality(req.skills_required), 1)
      +
      0.6 * GREATEST(u.capacity_weekly - COALESCE(l.active_assignments, 0), 0)::numeric
            / GREATEST(u.capacity_weekly, 1)
    ) * 100, 2) AS match_score
  FROM users u
  CROSS JOIN req
  LEFT JOIN recruiter_skills rs ON rs.recruiter_id = u.id
  LEFT JOIN load l ON l.recruiter_id = u.id
  WHERE u.role = 'recruiter' AND u.is_active
  ORDER BY match_score DESC, u.full_name
  LIMIT p_limit;
$$;

-- -------------------------------------------------------------
-- assign_with_explanation(req_id) [T0/T1]
-- Auto-assigns the top-ranked recruiter (via match_recruiters)
-- to an open requisition that has no active assignment yet.
-- NOT HITL-gated: initial "assigned" is not in HARD RULE #10's
-- list (only "reassigned", "offer issued", "candidate rejected"
-- are). Writes assignment_event + event_outbox in the same
-- transaction (HARD RULE #5/#6); W1's generic dispatcher (P2)
-- picks up 'assignment.created' for an admin notification.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION assign_with_explanation(p_req_id UUID)
RETURNS TABLE (
  assignment_id  UUID,
  requisition_id UUID,
  recruiter_id   UUID,
  recruiter_name TEXT,
  match_score    NUMERIC,
  newly_created  BOOLEAN,
  explanation    JSONB
)
LANGUAGE plpgsql AS $$
DECLARE
  v_tenant     UUID;
  v_status     TEXT;
  v_existing   RECORD;
  v_pick       RECORD;
  v_new_id     UUID;
BEGIN
  SELECT tenant_id, status INTO v_tenant, v_status
  FROM requisitions WHERE id = p_req_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Requisition % not found or not accessible', p_req_id;
  END IF;

  SELECT a.id, a.recruiter_id, u.full_name, a.match_score
  INTO v_existing
  FROM assignments a
  JOIN users u ON u.id = a.recruiter_id
  WHERE a.requisition_id = p_req_id AND a.status = 'active'
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT v_existing.id, p_req_id, v_existing.recruiter_id, v_existing.full_name,
      v_existing.match_score, false,
      jsonb_build_object('reason', 'existing_active_assignment');
    RETURN;
  END IF;

  IF v_status NOT IN ('open', 'on_hold') THEN
    RAISE EXCEPTION 'Requisition % has status ''%'', not open for assignment', p_req_id, v_status;
  END IF;

  SELECT * INTO v_pick FROM match_recruiters(p_req_id, 1);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No eligible recruiters found for requisition %', p_req_id;
  END IF;

  INSERT INTO assignments (tenant_id, requisition_id, recruiter_id, status, match_score)
  VALUES (v_tenant, p_req_id, v_pick.recruiter_id, 'active', v_pick.match_score)
  RETURNING id INTO v_new_id;

  INSERT INTO assignment_event (tenant_id, assignment_id, event_type, reason, metadata)
  VALUES (v_tenant, v_new_id, 'assigned', 'auto-assigned via assign_with_explanation',
    jsonb_build_object(
      'match_score', v_pick.match_score,
      'skill_match_count', v_pick.skill_match_count,
      'available_capacity', v_pick.available_capacity,
      'active_assignments_before', v_pick.active_assignments
    ));

  INSERT INTO event_outbox (tenant_id, event_type, payload, dedup_key)
  VALUES (v_tenant, 'assignment.created',
    jsonb_build_object('assignment_id', v_new_id, 'requisition_id', p_req_id, 'recruiter_id', v_pick.recruiter_id),
    'assignment.created:' || v_new_id::text)
  ON CONFLICT (tenant_id, dedup_key) DO NOTHING;

  RETURN QUERY SELECT v_new_id, p_req_id, v_pick.recruiter_id, v_pick.full_name, v_pick.match_score, true,
    jsonb_build_object(
      'reason', 'auto_assigned',
      'match_score', v_pick.match_score,
      'skill_match_count', v_pick.skill_match_count,
      'available_capacity', v_pick.available_capacity,
      'active_assignments_before', v_pick.active_assignments
    );
END;
$$;

-- -------------------------------------------------------------
-- do_reassign(assignment_id, reason, new_recruiter_id) [T0/T1]
-- Canonical reassign primitive: marks the old assignment
-- 'reassigned', creates a new 'active' one, writes
-- assignment_event 'reassigned' + event_outbox. If
-- new_recruiter_id is omitted, the top alternative (excluding
-- the current recruiter) from match_recruiters is used. Mirrors
-- the existing HITL-gated POST /assignments/{id}/reassign
-- endpoint (backend/routers/assignments.py), which remains the
-- HARD RULE #10 enforcement point (admin/manager only); this
-- function is the reusable DB-level primitive that endpoint (or
-- future automation behind the same gate) can call.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION do_reassign(
  p_assignment_id UUID,
  p_reason TEXT,
  p_new_recruiter_id UUID DEFAULT NULL
)
RETURNS TABLE (
  old_assignment_id  UUID,
  new_assignment_id  UUID,
  old_recruiter_id   UUID,
  new_recruiter_id   UUID,
  new_recruiter_name TEXT,
  match_score        NUMERIC,
  explanation        JSONB
)
LANGUAGE plpgsql AS $$
DECLARE
  v_old           RECORD;
  v_pick          RECORD;
  v_new_id        UUID;
  v_new_recruiter UUID;
  v_match_score   NUMERIC;
  v_name          TEXT;
BEGIN
  SELECT * INTO v_old FROM assignments WHERE id = p_assignment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment % not found or not accessible', p_assignment_id;
  END IF;
  IF v_old.status <> 'active' THEN
    RAISE EXCEPTION 'Assignment % is ''%'', expected ''active''', p_assignment_id, v_old.status;
  END IF;

  IF p_new_recruiter_id IS NOT NULL THEN
    v_new_recruiter := p_new_recruiter_id;
    v_match_score := v_old.match_score;
    SELECT full_name INTO v_name FROM users WHERE id = v_new_recruiter;
  ELSE
    SELECT * INTO v_pick FROM match_recruiters(v_old.requisition_id, 5) mr
      WHERE mr.recruiter_id <> v_old.recruiter_id
      LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'No alternative recruiter found for requisition %', v_old.requisition_id;
    END IF;
    v_new_recruiter := v_pick.recruiter_id;
    v_match_score := v_pick.match_score;
    v_name := v_pick.full_name;
  END IF;

  UPDATE assignments SET status = 'reassigned', updated_at = now() WHERE id = p_assignment_id;

  INSERT INTO assignments (tenant_id, requisition_id, recruiter_id, status, match_score)
  VALUES (v_old.tenant_id, v_old.requisition_id, v_new_recruiter, 'active', v_match_score)
  RETURNING id INTO v_new_id;

  INSERT INTO assignment_event (tenant_id, assignment_id, event_type, reason, metadata)
  VALUES (v_old.tenant_id, p_assignment_id, 'reassigned', p_reason,
    jsonb_build_object(
      'from_recruiter_id', v_old.recruiter_id,
      'to_recruiter_id', v_new_recruiter,
      'new_assignment_id', v_new_id,
      'match_score', v_match_score
    ));

  INSERT INTO event_outbox (tenant_id, event_type, payload, dedup_key)
  VALUES (v_old.tenant_id, 'assignment.reassigned',
    jsonb_build_object(
      'old_assignment_id', p_assignment_id, 'new_assignment_id', v_new_id,
      'requisition_id', v_old.requisition_id,
      'from_recruiter_id', v_old.recruiter_id, 'to_recruiter_id', v_new_recruiter
    ),
    'assignment.reassigned:' || v_new_id::text)
  ON CONFLICT (tenant_id, dedup_key) DO NOTHING;

  RETURN QUERY SELECT p_assignment_id, v_new_id, v_old.recruiter_id, v_new_recruiter, v_name, v_match_score,
    jsonb_build_object('reason', p_reason, 'match_score', v_match_score);
END;
$$;

-- ===================================================================
-- Analytics views — all WITH (security_invoker = true) so RLS is
-- evaluated against the QUERYING role (app_user), not the view
-- owner (postgres, BYPASSRLS). Without security_invoker, a view
-- created by postgres on FORCE-RLS tables would leak all tenants'
-- rows to app_user. (PG15+ feature; this stack is PG16.)
-- ===================================================================

-- v_redeployment_queue — placements ending within 21 days
CREATE OR REPLACE VIEW v_redeployment_queue
WITH (security_invoker = true) AS
SELECT
  p.tenant_id,
  p.id AS placement_id,
  p.candidate_id,
  c.full_name AS candidate_name,
  c.skills,
  p.requisition_id,
  r.title AS requisition_title,
  p.client_id,
  cl.name AS client_name,
  p.end_date,
  (p.end_date - CURRENT_DATE) AS days_remaining,
  p.status
FROM placements p
JOIN candidates c ON c.id = p.candidate_id
JOIN requisitions r ON r.id = p.requisition_id
LEFT JOIN clients cl ON cl.id = p.client_id
WHERE p.status IN ('active', 'ending_soon')
  AND p.end_date IS NOT NULL
  AND p.end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '21 days';

-- v_agency_funnel — applications -> submittals -> offers -> placements per client
CREATE OR REPLACE VIEW v_agency_funnel
WITH (security_invoker = true) AS
SELECT
  cl.tenant_id,
  cl.id AS client_id,
  cl.name AS client_name,
  count(DISTINCT a.id) AS applications_count,
  count(DISTINCT s.id) AS submittals_count,
  count(DISTINCT s.id) FILTER (WHERE s.status = 'shortlisted') AS shortlisted_count,
  count(DISTINCT o.id) FILTER (WHERE o.status IN ('issued', 'accepted')) AS offers_count,
  count(DISTINCT pl.id) AS placements_count
FROM clients cl
LEFT JOIN requisitions r ON r.client_id = cl.id
LEFT JOIN applications a ON a.requisition_id = r.id
LEFT JOIN submittals s ON s.application_id = a.id
LEFT JOIN offers o ON o.application_id = a.id
LEFT JOIN placements pl ON pl.requisition_id = r.id
GROUP BY cl.tenant_id, cl.id, cl.name;

-- v_recruiter_capacity — active assignment load vs. capacity_weekly
CREATE OR REPLACE VIEW v_recruiter_capacity
WITH (security_invoker = true) AS
SELECT
  u.tenant_id,
  u.id AS recruiter_id,
  u.full_name,
  u.email,
  u.capacity_weekly,
  COALESCE(l.active_assignments, 0) AS active_assignments,
  GREATEST(u.capacity_weekly - COALESCE(l.active_assignments, 0), 0) AS available_capacity,
  ROUND(100.0 * COALESCE(l.active_assignments, 0) / GREATEST(u.capacity_weekly, 1), 1) AS utilization_pct
FROM users u
LEFT JOIN (
  SELECT recruiter_id, count(*) AS active_assignments
  FROM assignments WHERE status = 'active' GROUP BY recruiter_id
) l ON l.recruiter_id = u.id
WHERE u.role = 'recruiter' AND u.is_active;

-- v_skill_gap — open-requisition skill demand vs. candidate skill supply
CREATE OR REPLACE VIEW v_skill_gap
WITH (security_invoker = true) AS
WITH demand AS (
  SELECT r.tenant_id, s AS skill, count(*) AS demand_count
  FROM requisitions r, unnest(r.skills_required) AS s
  WHERE r.status = 'open'
  GROUP BY r.tenant_id, s
),
supply AS (
  SELECT c.tenant_id, s AS skill, count(*) AS supply_count
  FROM candidates c, unnest(c.skills) AS s
  GROUP BY c.tenant_id, s
)
SELECT
  COALESCE(d.tenant_id, sup.tenant_id) AS tenant_id,
  COALESCE(d.skill, sup.skill) AS skill,
  COALESCE(d.demand_count, 0) AS demand_count,
  COALESCE(sup.supply_count, 0) AS supply_count,
  COALESCE(d.demand_count, 0) - COALESCE(sup.supply_count, 0) AS gap
FROM demand d
FULL OUTER JOIN supply sup ON sup.skill = d.skill AND sup.tenant_id = d.tenant_id
ORDER BY gap DESC;
