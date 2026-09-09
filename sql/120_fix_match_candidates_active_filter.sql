-- Fixes a real, confirmed instance of this project's own recurring
-- "missing is_active filter" bug class — this time in match_candidates()
-- itself, a bare `FROM candidates c` with no filter at all (not even a
-- JOIN to miss it on).
--
-- Confirmed live: a soft-deleted candidate ("Sravan Kumar", is_active=
-- false) was ranked and shown as addable in the "Add Candidate to
-- Pipeline" modal (backed by this function), got added to a real
-- requisition's Interested stage, and then silently vanished from the
-- Kanban board — the board correctly filters out inactive candidates,
-- but nothing upstream stopped one from being offered and added in the
-- first place. Recruiters would see the add succeed and then the
-- candidate disappear with no explanation.
CREATE OR REPLACE FUNCTION match_candidates(p_req_id UUID, p_limit INT DEFAULT 10)
RETURNS TABLE (
  candidate_id        UUID,
  full_name           TEXT,
  email               TEXT,
  skills              TEXT[],
  total_exp_mo        INT,
  location            TEXT,
  current_designation TEXT,
  current_employer    TEXT,
  cosine_similarity   NUMERIC,
  skill_overlap       INT,
  fit_score           NUMERIC
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
    c.current_designation,
    c.current_employer,
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
  WHERE c.is_active IS NOT FALSE
  ORDER BY fit_score DESC, c.full_name
  LIMIT p_limit;
$$;
