-- Fixes real multi-tenant RLS gaps found while wiring up previously-stub
-- "gap features" routers, plus the SECURITY DEFINER public-token lookup
-- functions their candidate/referee-facing pages need (same pattern as
-- nda_documents / get_nda_by_signing_token in sql/12_nda_esign.sql).

-- recruiter_tasks had neither RLS enabled nor any policy at all (any
-- tenant could read/write any other tenant's tasks via app_user).
ALTER TABLE recruiter_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruiter_tasks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON recruiter_tasks;
CREATE POLICY tenant_isolation ON recruiter_tasks
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);

-- video_screening_tokens had tenant_id but no RLS at all.
ALTER TABLE video_screening_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_screening_tokens FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON video_screening_tokens;
CREATE POLICY tenant_isolation ON video_screening_tokens
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);

-- reference_responses has no tenant_id column (scoped via reference_check_id
-- -> reference_checks.tenant_id) and had no RLS at all.
ALTER TABLE reference_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE reference_responses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON reference_responses;
CREATE POLICY tenant_isolation ON reference_responses
  USING (EXISTS (
    SELECT 1 FROM reference_checks rc
    WHERE rc.id = reference_check_id
      AND rc.tenant_id = (current_setting('app.tenant_id', true))::uuid
  ));

-- ── Public referee flow (reference-check request/response) ────────────────
-- IMPORTANT: must be owned by postgres (BYPASSRLS), not app_user — same
-- reasoning as get_nda_by_signing_token: system_conn() sets app.tenant_id
-- to '' for anonymous requests, which ::uuid casts would error on and
-- text-compares would just silently return zero rows either way.
CREATE OR REPLACE FUNCTION public.get_reference_check_by_token(p_token text)
 RETURNS TABLE(
   id uuid, candidate_name text, referee_name text, relationship text,
   company text, status text
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
    SELECT rc.id, c.full_name, rc.referee_name, rc.relationship, rc.company, rc.status
    FROM reference_checks rc
    JOIN candidates c ON c.id = rc.candidate_id
    WHERE rc.token = p_token
    LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.submit_reference_response_by_token(
    p_token text, p_q1 text, p_q2 int, p_q3 int, p_q4 boolean,
    p_q5 text, p_q6 text, p_q7 int
) RETURNS TABLE(id uuid)
 LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
    v_check_id uuid;
    v_resp_id uuid;
BEGIN
    SELECT rc.id INTO v_check_id FROM reference_checks rc
    WHERE rc.token = p_token AND rc.status != 'completed';
    IF v_check_id IS NULL THEN
        RAISE EXCEPTION 'Reference check not found or already completed';
    END IF;

    INSERT INTO reference_responses
      (reference_check_id, q1_known_duration, q2_work_quality, q3_reliability,
       q4_rehire, q5_strengths, q6_concerns, q7_overall_rating)
    VALUES (v_check_id, p_q1, p_q2, p_q3, p_q4, p_q5, p_q6, p_q7)
    RETURNING reference_responses.id INTO v_resp_id;

    UPDATE reference_checks SET status = 'completed', completed_at = now()
    WHERE reference_checks.id = v_check_id;

    RETURN QUERY SELECT v_resp_id;
END;
$function$;

ALTER FUNCTION public.get_reference_check_by_token(text) OWNER TO postgres;
ALTER FUNCTION public.submit_reference_response_by_token(text, text, int, int, boolean, text, text, int) OWNER TO postgres;

-- ── Public candidate flow (async video screening) ──────────────────────────
CREATE OR REPLACE FUNCTION public.get_video_screening_by_token(p_token text)
 RETURNS TABLE(
   candidate_name text, expires_at timestamptz,
   question_id uuid, question_text text, time_limit_secs int, order_num int
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
    SELECT c.full_name, vst.expires_at, vq.id, vq.question_text,
           COALESCE(vq.time_limit_secs, vq.time_limit_sec, 90), vq.order_num
    FROM video_screening_tokens vst
    JOIN candidates c ON c.id = vst.candidate_id
    JOIN video_questions vq ON vq.id = ANY(vst.question_ids)
    WHERE vst.token = p_token AND vst.expires_at > now()
    ORDER BY vq.order_num NULLS LAST;
$function$;

CREATE OR REPLACE FUNCTION public.submit_video_response_by_token(
    p_token text, p_question_id uuid, p_file_path text, p_file_name text, p_duration_sec int
) RETURNS TABLE(id uuid)
 LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
    v_tenant uuid;
    v_candidate uuid;
    v_req uuid;
    v_resp_id uuid;
BEGIN
    SELECT tenant_id, candidate_id, requisition_id INTO v_tenant, v_candidate, v_req
    FROM video_screening_tokens WHERE token = p_token AND expires_at > now();
    IF v_tenant IS NULL THEN
        RAISE EXCEPTION 'Video screening link not found or expired';
    END IF;

    INSERT INTO video_responses
      (tenant_id, candidate_id, question_id, requisition_id, file_path, file_name, duration_sec, status)
    VALUES (v_tenant, v_candidate, p_question_id, v_req, p_file_path, p_file_name, p_duration_sec, 'submitted')
    RETURNING video_responses.id INTO v_resp_id;

    RETURN QUERY SELECT v_resp_id;
END;
$function$;

ALTER FUNCTION public.get_video_screening_by_token(text) OWNER TO postgres;
ALTER FUNCTION public.submit_video_response_by_token(text, uuid, text, text, int) OWNER TO postgres;
