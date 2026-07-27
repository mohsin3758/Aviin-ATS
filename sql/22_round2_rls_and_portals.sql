-- Round 2 of the DB-vs-sidebar audit: 9 more tables had NO row-level
-- security at all (not just un-forced — completely disabled), three of
-- them owned by app_user itself (sla_tier_config, scoring_weight_config,
-- recruiter_client_blocks), meaning any tenant could read/write any other
-- tenant's rows the moment an API touched them. Fixing before adding APIs.

ALTER TABLE saved_filters ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_filters FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON saved_filters;
CREATE POLICY tenant_isolation ON saved_filters
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);

ALTER TABLE work_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON work_sessions;
CREATE POLICY tenant_isolation ON work_sessions
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);

ALTER TABLE alert_acknowledgments ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_acknowledgments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON alert_acknowledgments;
CREATE POLICY tenant_isolation ON alert_acknowledgments
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);

ALTER TABLE sla_tier_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_tier_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sla_tier_config;
CREATE POLICY tenant_isolation ON sla_tier_config
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);

ALTER TABLE scoring_weight_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE scoring_weight_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON scoring_weight_config;
CREATE POLICY tenant_isolation ON scoring_weight_config
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);

ALTER TABLE recruiter_client_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruiter_client_blocks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON recruiter_client_blocks;
CREATE POLICY tenant_isolation ON recruiter_client_blocks
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);

-- agency_users / agency_submissions / candidate_portal_uploads are all
-- reached anonymously via a token (external agency reps, candidates) —
-- same shape as nda_documents' public signing flow, so: forced RLS for
-- authenticated staff access + SECURITY DEFINER functions owned by
-- postgres (BYPASSRLS) for the anonymous token paths.
ALTER TABLE agency_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE agency_users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON agency_users;
CREATE POLICY tenant_isolation ON agency_users
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);

ALTER TABLE agency_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agency_submissions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON agency_submissions;
CREATE POLICY tenant_isolation ON agency_submissions
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);

ALTER TABLE candidate_portal_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_portal_uploads FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON candidate_portal_uploads;
CREATE POLICY tenant_isolation ON candidate_portal_uploads
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);

-- ── Agency portal: anonymous token login + requisition list + submit ──────
CREATE OR REPLACE FUNCTION public.get_agency_user_by_token(p_token text)
 RETURNS TABLE(id uuid, tenant_id uuid, agency_id uuid, full_name text, agency_name text)
 LANGUAGE sql STABLE SECURITY DEFINER
AS $function$
    SELECT au.id, au.tenant_id, au.agency_id, au.full_name, va.name
    FROM agency_users au
    JOIN vendor_agencies va ON va.id = au.agency_id
    WHERE au.token = p_token AND au.token_expires_at > now() AND au.is_active;
$function$;

CREATE OR REPLACE FUNCTION public.list_open_requisitions_for_agency(p_token text)
 RETURNS TABLE(id uuid, title text, location text, employment_type text)
 LANGUAGE sql STABLE SECURITY DEFINER
AS $function$
    SELECT r.id, r.title, r.location, r.employment_type
    FROM requisitions r
    JOIN agency_users au ON au.tenant_id = r.tenant_id
    WHERE au.token = p_token AND au.token_expires_at > now() AND au.is_active
      AND r.status = 'open'
    ORDER BY r.created_at DESC;
$function$;

CREATE OR REPLACE FUNCTION public.submit_agency_candidate(
    p_token text, p_requisition_id uuid, p_full_name text, p_email text, p_phone text,
    p_total_exp_mo int, p_current_employer text, p_current_designation text,
    p_expected_ctc numeric, p_notes text
) RETURNS TABLE(id uuid)
 LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
    v_tenant uuid;
    v_agency uuid;
    v_id uuid;
BEGIN
    SELECT tenant_id, agency_id INTO v_tenant, v_agency
    FROM agency_users WHERE token = p_token AND token_expires_at > now() AND is_active;
    IF v_tenant IS NULL THEN
        RAISE EXCEPTION 'Invalid or expired agency link';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM requisitions WHERE id = p_requisition_id AND tenant_id = v_tenant AND status = 'open') THEN
        RAISE EXCEPTION 'Requisition not found or not open';
    END IF;

    INSERT INTO agency_submissions
      (tenant_id, agency_id, requisition_id, full_name, email, phone, total_exp_mo,
       current_employer, current_designation, expected_ctc, notes)
    VALUES (v_tenant, v_agency, p_requisition_id, p_full_name, p_email, p_phone,
            p_total_exp_mo, p_current_employer, p_current_designation, p_expected_ctc, p_notes)
    RETURNING agency_submissions.id INTO v_id;

    RETURN QUERY SELECT v_id;
END;
$function$;

ALTER FUNCTION public.get_agency_user_by_token(text) OWNER TO postgres;
ALTER FUNCTION public.list_open_requisitions_for_agency(text) OWNER TO postgres;
ALTER FUNCTION public.submit_agency_candidate(text, uuid, text, text, text, int, text, text, numeric, text) OWNER TO postgres;

-- ── Candidate self-service upload (via existing candidate_status_tokens) ───
CREATE OR REPLACE FUNCTION public.upload_candidate_document_by_token(
    p_token text, p_file_name text, p_file_path text, p_doc_type text
) RETURNS TABLE(id uuid)
 LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
    v_tenant uuid;
    v_candidate uuid;
    v_id uuid;
BEGIN
    SELECT tenant_id, candidate_id INTO v_tenant, v_candidate
    FROM candidate_status_tokens WHERE token = p_token AND expires_at > now();
    IF v_tenant IS NULL THEN
        RAISE EXCEPTION 'Invalid or expired link';
    END IF;

    INSERT INTO candidate_portal_uploads (tenant_id, candidate_id, file_name, file_path, doc_type)
    VALUES (v_tenant, v_candidate, p_file_name, p_file_path, p_doc_type)
    RETURNING candidate_portal_uploads.id INTO v_id;

    RETURN QUERY SELECT v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_candidate_uploads_by_token(p_token text)
 RETURNS TABLE(id uuid, file_name text, doc_type text, uploaded_at timestamptz)
 LANGUAGE sql STABLE SECURITY DEFINER
AS $function$
    SELECT cpu.id, cpu.file_name, cpu.doc_type, cpu.uploaded_at
    FROM candidate_portal_uploads cpu
    JOIN candidate_status_tokens cst ON cst.candidate_id = cpu.candidate_id AND cst.tenant_id = cpu.tenant_id
    WHERE cst.token = p_token AND cst.expires_at > now()
    ORDER BY cpu.uploaded_at DESC;
$function$;

ALTER FUNCTION public.upload_candidate_document_by_token(text, text, text, text) OWNER TO postgres;
ALTER FUNCTION public.list_candidate_uploads_by_token(text) OWNER TO postgres;
