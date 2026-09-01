-- PHASE 0 SCHEMA-DRIFT BACKFILL (QA sweep, 2026-09-01) -- 57 real, live,
-- heavily-used production tables with ZERO CREATE TABLE anywhere in any
-- committed migration (confirmed via a direct live-schema-vs-sql/*.sql
-- diff, not assumed) -- several are core, foundational tables
-- (resume_files, role_definitions, interview_schedules, candidate_
-- messages, email_templates, recruiter_tasks, webhook_integrations,
-- skills_taxonomy, saved_filters, work_sessions, and many more) that
-- have existed live for a long time without ever being captured. A
-- fresh environment built from git alone would be missing all 57.
--
-- Every statement below is copied verbatim from a real
-- `pg_dump --schema-only` against production (a single combined dump
-- covering all 57 tables at once, so PostgreSQL's own dependency
-- resolution -- not manual reordering -- determined statement order,
-- avoiding any cross-table foreign-key ordering risk) -- never
-- reconstructed from memory, matching this project's own established
-- discipline for every prior schema-drift backfill.
--
-- CREATE TABLE/SEQUENCE use IF NOT EXISTS (genuine no-op wherever they
-- already exist). CREATE INDEX uses IF NOT EXISTS. Every ADD CONSTRAINT
-- (primary key, foreign key, unique, check) is wrapped in a real
-- DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- block, since PostgreSQL has no native ADD CONSTRAINT IF NOT EXISTS.
-- Every CREATE POLICY is preceded by a matching DROP POLICY IF EXISTS,
-- matching the exact idempotency pattern already established in
-- sql/33_untracked_tables_and_rls.sql. ENABLE/FORCE ROW LEVEL SECURITY
-- and GRANT are naturally idempotent in Postgres and need no wrapping.
--
-- login_rate_limits is a confirmed, already-documented dead/legacy
-- table (superseded by app.py's in-memory RateLimitMiddleware) --
-- backfilled anyway for completeness at near-zero cost, not because
-- it's actively used. audit_logs (the OTHER confirmed-dead relic,
-- superseded by the real audit_log table) was deliberately excluded
-- from this batch entirely, since it has zero code references and
-- adding its schema serves no real reproducibility purpose.
--
-- MUST be run as postgres (several of these tables are postgres-owned;
-- postgres has superuser privileges to also correctly set the handful
-- that are genuinely app_user-owned -- recruiter_client_blocks,
-- recruiter_tasks, login_rate_limits -- via the OWNER TO statements
-- below, exactly as they exist live).

--
--

--
-- Name: agency_submissions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS agency_submissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    agency_id uuid NOT NULL,
    requisition_id uuid NOT NULL,
    full_name text NOT NULL,
    email text,
    phone text,
    total_exp_mo integer DEFAULT 0,
    current_employer text,
    current_designation text,
    expected_ctc numeric(14,2),
    resume_path text,
    notes text,
    status text DEFAULT 'submitted'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE agency_submissions FORCE ROW LEVEL SECURITY;

ALTER TABLE agency_submissions OWNER TO postgres;

--
-- Name: agency_users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS agency_users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    agency_id uuid NOT NULL,
    email text NOT NULL,
    full_name text NOT NULL,
    token text DEFAULT encode(gen_random_bytes(32), 'hex'::text),
    token_expires_at timestamp with time zone DEFAULT (now() + '90 days'::interval),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE agency_users FORCE ROW LEVEL SECURITY;

ALTER TABLE agency_users OWNER TO postgres;

--
-- Name: alert_acknowledgments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS alert_acknowledgments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    alert_id character varying(255) NOT NULL,
    acknowledged_by uuid,
    acknowledged_at timestamp with time zone DEFAULT now() NOT NULL,
    note text DEFAULT ''::text
);

ALTER TABLE alert_acknowledgments FORCE ROW LEVEL SECURITY;

ALTER TABLE alert_acknowledgments OWNER TO postgres;

--
-- Name: automation_workflows; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS automation_workflows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    trigger_type character varying(50) NOT NULL,
    webhook_path character varying(100),
    description text,
    is_active boolean DEFAULT true,
    last_fired_at timestamp with time zone,
    fire_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE automation_workflows FORCE ROW LEVEL SECURITY;

ALTER TABLE automation_workflows OWNER TO postgres;

--
-- Name: calendar_events; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS calendar_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    interview_id uuid,
    user_id uuid,
    event_uid text,
    title text NOT NULL,
    description text,
    start_at timestamp with time zone NOT NULL,
    end_at timestamp with time zone NOT NULL,
    location text,
    meeting_link text,
    attendees text[] DEFAULT '{}'::text[],
    google_event_id text,
    ics_content text,
    status character varying(20) DEFAULT 'created'::character varying,
    created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE calendar_events FORCE ROW LEVEL SECURITY;

ALTER TABLE calendar_events OWNER TO postgres;

--
-- Name: candidate_messages; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS candidate_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    candidate_id uuid,
    application_id uuid,
    channel character varying(20) DEFAULT 'email'::character varying NOT NULL,
    direction character varying(10) DEFAULT 'outbound'::character varying NOT NULL,
    subject text,
    body text NOT NULL,
    status character varying(20) DEFAULT 'sent'::character varying NOT NULL,
    error_msg text,
    sent_by uuid,
    template_id uuid,
    stage_at_send character varying(50),
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    is_deleted boolean DEFAULT false,
    deleted_at timestamp with time zone,
    is_read boolean DEFAULT false,
    is_starred boolean DEFAULT false,
    to_email text,
    cc text,
    bcc text,
    from_account_id uuid,
    from_email text,
    tracking_token uuid DEFAULT gen_random_uuid(),
    email_opened_at timestamp with time zone,
    email_open_count integer DEFAULT 0 NOT NULL,
    from_whatsapp_account_id uuid
);

ALTER TABLE candidate_messages FORCE ROW LEVEL SECURITY;

ALTER TABLE candidate_messages OWNER TO postgres;

--
-- Name: candidate_nps; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS candidate_nps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    application_id uuid,
    trigger_type character varying(20) NOT NULL,
    nps_score integer,
    what_went_well text,
    what_could_improve text,
    submitted_at timestamp with time zone,
    token character varying(64) DEFAULT encode(gen_random_bytes(32), 'hex'::text) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT candidate_nps_nps_score_check CHECK (((nps_score >= 0) AND (nps_score <= 10))),
    CONSTRAINT candidate_nps_trigger_type_check CHECK (((trigger_type)::text = ANY ((ARRAY['rejection'::character varying, 'placement'::character varying])::text[])))
);

ALTER TABLE candidate_nps OWNER TO postgres;

--
-- Name: candidate_portal_uploads; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS candidate_portal_uploads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    file_name text NOT NULL,
    file_path text NOT NULL,
    doc_type text DEFAULT 'general'::text,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE candidate_portal_uploads FORCE ROW LEVEL SECURITY;

ALTER TABLE candidate_portal_uploads OWNER TO postgres;

--
-- Name: candidate_status_tokens; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS candidate_status_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    token text NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '30 days'::interval),
    created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE candidate_status_tokens OWNER TO postgres;

--
-- Name: client_feedback; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS client_feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    application_id uuid,
    candidate_id uuid NOT NULL,
    requisition_id uuid,
    client_user_id uuid,
    decision character varying(20) NOT NULL,
    feedback_text text,
    rating smallint,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT client_feedback_decision_check CHECK (((decision)::text = ANY ((ARRAY['approved'::character varying, 'rejected'::character varying, 'hold'::character varying, 'interview_requested'::character varying])::text[]))),
    CONSTRAINT client_feedback_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);

ALTER TABLE client_feedback FORCE ROW LEVEL SECURITY;

ALTER TABLE client_feedback OWNER TO postgres;

--
-- Name: client_health_scores; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS client_health_scores (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    client_name character varying(200) NOT NULL,
    score_date date DEFAULT CURRENT_DATE,
    revenue_score numeric(5,2) DEFAULT 0,
    collection_score numeric(5,2) DEFAULT 0,
    fill_rate_score numeric(5,2) DEFAULT 0,
    growth_score numeric(5,2) DEFAULT 0,
    relationship_score numeric(5,2) DEFAULT 0,
    health_score numeric(5,2) DEFAULT 0,
    health_grade character varying(2),
    risk_level character varying(10) DEFAULT 'low'::character varying,
    insights jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT client_health_scores_risk_level_check CHECK (((risk_level)::text = ANY ((ARRAY['low'::character varying, 'medium'::character varying, 'high'::character varying, 'critical'::character varying])::text[])))
);

ALTER TABLE client_health_scores FORCE ROW LEVEL SECURITY;

ALTER TABLE client_health_scores OWNER TO postgres;

--
-- Name: client_portal_users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS client_portal_users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    full_name character varying(100),
    company_name character varying(100),
    phone character varying(20),
    is_active boolean DEFAULT true,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE client_portal_users FORCE ROW LEVEL SECURITY;

ALTER TABLE client_portal_users OWNER TO postgres;

--
-- Name: compliance_records; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS compliance_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    candidate_id uuid,
    placement_id uuid,
    month smallint NOT NULL,
    year smallint NOT NULL,
    gross_salary numeric(12,2) DEFAULT 0,
    basic_salary numeric(12,2) DEFAULT 0,
    pf_employee numeric(10,2) DEFAULT 0,
    pf_employer numeric(10,2) DEFAULT 0,
    esi_employee numeric(10,2) DEFAULT 0,
    esi_employer numeric(10,2) DEFAULT 0,
    professional_tax numeric(8,2) DEFAULT 0,
    tds_amount numeric(10,2) DEFAULT 0,
    net_take_home numeric(12,2) DEFAULT 0,
    status character varying(20) DEFAULT 'computed'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT compliance_records_month_check CHECK (((month >= 1) AND (month <= 12))),
    CONSTRAINT compliance_records_status_check CHECK (((status)::text = ANY ((ARRAY['computed'::character varying, 'filed'::character varying, 'paid'::character varying])::text[])))
);

ALTER TABLE compliance_records FORCE ROW LEVEL SECURITY;

ALTER TABLE compliance_records OWNER TO postgres;

--
-- Name: cv_bulk_uploads; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS cv_bulk_uploads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    uploaded_by uuid,
    total_files integer DEFAULT 0,
    parsed integer DEFAULT 0,
    added_new integer DEFAULT 0,
    duplicates integer DEFAULT 0,
    failed integer DEFAULT 0,
    status character varying(20) DEFAULT 'processing'::character varying,
    results jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    CONSTRAINT cv_bulk_uploads_status_check CHECK (((status)::text = ANY ((ARRAY['processing'::character varying, 'completed'::character varying, 'failed'::character varying])::text[])))
);

ALTER TABLE cv_bulk_uploads FORCE ROW LEVEL SECURITY;

ALTER TABLE cv_bulk_uploads OWNER TO postgres;

--
-- Name: email_settings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS email_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    smtp_host character varying(200),
    smtp_port integer DEFAULT 587,
    smtp_user character varying(200),
    smtp_password character varying(500),
    smtp_from character varying(200),
    smtp_from_name character varying(200) DEFAULT 'AVIIN ATS'::character varying,
    smtp_tls boolean DEFAULT true,
    imap_host character varying(200),
    imap_port integer DEFAULT 993,
    imap_user character varying(200),
    imap_password character varying(500),
    is_active boolean DEFAULT false,
    last_tested_at timestamp with time zone,
    last_test_status character varying(20),
    last_test_error text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    notification_mode character varying(10) DEFAULT 'manual'::character varying NOT NULL,
    stage_templates jsonb DEFAULT '{}'::jsonb NOT NULL
);

ALTER TABLE email_settings OWNER TO postgres;

--
-- Name: email_templates; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS email_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    category character varying(50) NOT NULL,
    subject text NOT NULL,
    body_html text NOT NULL,
    variables text[] DEFAULT '{}'::text[],
    is_active boolean DEFAULT true,
    is_system boolean DEFAULT false,
    sent_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT email_templates_category_check CHECK (((category)::text = ANY ((ARRAY['shortlist'::character varying, 'rejection'::character varying, 'interview_invite'::character varying, 'offer'::character varying, 'onboarding'::character varying, 'follow_up'::character varying, 'welcome'::character varying, 'custom'::character varying])::text[])))
);

ALTER TABLE email_templates FORCE ROW LEVEL SECURITY;

ALTER TABLE email_templates OWNER TO postgres;

--
-- Name: extension_captures; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS extension_captures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    captured_by uuid,
    candidate_id uuid,
    name text,
    email text,
    phone text,
    current_title text,
    current_company text,
    profile_url text,
    source text DEFAULT 'chrome_extension'::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE extension_captures OWNER TO postgres;

--
-- Name: gdpr_archive_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS gdpr_archive_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    candidate_id uuid,
    action character varying(30) DEFAULT 'anonymized'::character varying,
    reason text,
    fields_cleared text[] DEFAULT '{}'::text[],
    archived_at timestamp with time zone DEFAULT now()
);

ALTER TABLE gdpr_archive_log FORCE ROW LEVEL SECURITY;

ALTER TABLE gdpr_archive_log OWNER TO postgres;

--
-- Name: gdpr_settings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS gdpr_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    retention_days integer DEFAULT 365 NOT NULL,
    last_cron_run timestamp with time zone,
    candidates_archived integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE gdpr_settings OWNER TO postgres;

--
-- Name: headcount_plans; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS headcount_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    department character varying(100) NOT NULL,
    client_name character varying(200),
    fiscal_year character varying(9) NOT NULL,
    quarter smallint,
    planned_hires integer DEFAULT 0,
    actual_hires integer DEFAULT 0,
    planned_budget numeric(14,2) DEFAULT 0,
    actual_spend numeric(14,2) DEFAULT 0,
    skills_needed text[] DEFAULT '{}'::text[],
    priority character varying(20) DEFAULT 'medium'::character varying,
    status character varying(20) DEFAULT 'planning'::character varying,
    notes text,
    approved_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT headcount_plans_priority_check CHECK (((priority)::text = ANY ((ARRAY['low'::character varying, 'medium'::character varying, 'high'::character varying, 'critical'::character varying])::text[]))),
    CONSTRAINT headcount_plans_quarter_check CHECK (((quarter >= 1) AND (quarter <= 4))),
    CONSTRAINT headcount_plans_status_check CHECK (((status)::text = ANY ((ARRAY['planning'::character varying, 'approved'::character varying, 'in_progress'::character varying, 'closed'::character varying])::text[])))
);

ALTER TABLE headcount_plans FORCE ROW LEVEL SECURITY;

ALTER TABLE headcount_plans OWNER TO postgres;

--
-- Name: imap_messages; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS imap_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    imap_uid text NOT NULL,
    folder character varying(100) DEFAULT 'INBOX'::character varying,
    from_email text,
    from_name text,
    to_email text,
    cc text,
    subject text,
    body text,
    html_body text,
    received_at timestamp with time zone,
    is_read boolean DEFAULT false,
    is_starred boolean DEFAULT false,
    is_deleted boolean DEFAULT false,
    candidate_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    imap_uid_int bigint,
    attachments jsonb,
    snoozed_until timestamp with time zone,
    auto_processed boolean DEFAULT false,
    process_status character varying(20)
);

ALTER TABLE imap_messages OWNER TO postgres;

--
-- Name: imap_sync_state; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS imap_sync_state (
    account_id uuid NOT NULL,
    folder text NOT NULL,
    last_uid bigint DEFAULT 0,
    total_synced integer DEFAULT 0,
    last_synced_at timestamp with time zone
);

ALTER TABLE imap_sync_state OWNER TO postgres;

--
-- Name: interview_schedules; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS interview_schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    application_id uuid,
    candidate_id uuid NOT NULL,
    requisition_id uuid,
    interviewer_id uuid,
    interview_type character varying(30) DEFAULT 'technical'::character varying,
    scheduled_at timestamp with time zone NOT NULL,
    duration_mins integer DEFAULT 45,
    mode character varying(20) DEFAULT 'video'::character varying,
    meeting_link text,
    location text,
    status character varying(20) DEFAULT 'scheduled'::character varying,
    feedback text,
    rating smallint,
    invite_sent_at timestamp with time zone,
    reminder_sent_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT interview_schedules_interview_type_check CHECK (((interview_type)::text = ANY (ARRAY['screening'::text, 'technical'::text, 'hr'::text, 'client'::text, 'final'::text, 'panel'::text, 'self_scheduled'::text]))),
    CONSTRAINT interview_schedules_mode_check CHECK (((mode)::text = ANY ((ARRAY['video'::character varying, 'phone'::character varying, 'in_person'::character varying])::text[]))),
    CONSTRAINT interview_schedules_rating_check CHECK (((rating >= 1) AND (rating <= 5))),
    CONSTRAINT interview_schedules_status_check CHECK (((status)::text = ANY ((ARRAY['scheduled'::character varying, 'confirmed'::character varying, 'completed'::character varying, 'cancelled'::character varying, 'no_show'::character varying, 'rescheduled'::character varying])::text[])))
);

ALTER TABLE interview_schedules FORCE ROW LEVEL SECURITY;

ALTER TABLE interview_schedules OWNER TO postgres;

--
-- Name: jd_templates; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS jd_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    title character varying(200) NOT NULL,
    category character varying(50),
    role_level character varying(30),
    skills_required text[] DEFAULT '{}'::text[],
    experience_min numeric(4,1) DEFAULT 0,
    experience_max numeric(4,1),
    jd_text text NOT NULL,
    usage_count integer DEFAULT 0,
    is_system boolean DEFAULT false,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE jd_templates FORCE ROW LEVEL SECURITY;

ALTER TABLE jd_templates OWNER TO postgres;

--
-- Name: job_distributions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS job_distributions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    requisition_id uuid NOT NULL,
    board_name text NOT NULL,
    external_id text,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    post_url text,
    posted_at timestamp with time zone,
    error_msg text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT job_distributions_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'posted'::character varying, 'failed'::character varying])::text[])))
);

ALTER TABLE job_distributions OWNER TO postgres;

--
-- Name: job_shares; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS job_shares (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    requisition_id uuid,
    platform character varying(40) NOT NULL,
    share_url text,
    posted_by uuid,
    click_count integer DEFAULT 0,
    apply_count integer DEFAULT 0,
    posted_at timestamp with time zone DEFAULT now()
);

ALTER TABLE job_shares FORCE ROW LEVEL SECURITY;

ALTER TABLE job_shares OWNER TO postgres;

--
-- Name: linkedin_captures; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS linkedin_captures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    linkedin_url text,
    raw_data jsonb,
    candidate_id uuid,
    captured_by uuid,
    created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE linkedin_captures OWNER TO postgres;

--
-- Name: login_rate_limits; Type: TABLE; Schema: public; Owner: app_user
--

CREATE TABLE IF NOT EXISTS login_rate_limits (
    ip text NOT NULL,
    attempted_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE login_rate_limits OWNER TO app_user;

--
-- Name: message_drafts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS message_drafts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    candidate_id uuid,
    channel character varying(20) DEFAULT 'email'::character varying NOT NULL,
    subject text,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    to_email text,
    cc text,
    created_by uuid
);

ALTER TABLE message_drafts OWNER TO postgres;

--
-- Name: nurture_executions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS nurture_executions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    sequence_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    step_idx integer DEFAULT 0 NOT NULL,
    channel text,
    sent_at timestamp with time zone,
    enrolled_at timestamp with time zone DEFAULT now() NOT NULL,
    last_error text
);

ALTER TABLE nurture_executions OWNER TO postgres;

--
-- Name: nurture_sequences; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS nurture_sequences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    trigger_event character varying(50) NOT NULL,
    steps jsonb DEFAULT '[]'::jsonb,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE nurture_sequences FORCE ROW LEVEL SECURITY;

ALTER TABLE nurture_sequences OWNER TO postgres;

--
-- Name: offer_esign_requests; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS offer_esign_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    offer_id uuid NOT NULL,
    candidate_email text NOT NULL,
    candidate_name text,
    token text DEFAULT encode(gen_random_bytes(24), 'hex'::text),
    signature_data text,
    signed_at timestamp with time zone,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE offer_esign_requests OWNER TO postgres;

--
-- Name: ollama_cache; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS ollama_cache (
    cache_key text NOT NULL,
    prompt text,
    response text,
    created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE ollama_cache OWNER TO postgres;

--
-- Name: pipeline_metrics_cache; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS pipeline_metrics_cache (
    id integer NOT NULL,
    tenant_id uuid NOT NULL,
    metric_key character varying(100),
    metric_value double precision,
    computed_at timestamp without time zone DEFAULT now()
);

ALTER TABLE pipeline_metrics_cache OWNER TO postgres;

--
-- Name: pipeline_metrics_cache_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE IF NOT EXISTS pipeline_metrics_cache_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE pipeline_metrics_cache_id_seq OWNER TO postgres;

--
-- Name: pipeline_metrics_cache_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE pipeline_metrics_cache_id_seq OWNED BY pipeline_metrics_cache.id;

--
-- Name: pipeline_rules; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS pipeline_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    trigger_event character varying(50) NOT NULL,
    condition_field character varying(50),
    condition_op character varying(20),
    condition_value text,
    action_type character varying(50) NOT NULL,
    action_data jsonb DEFAULT '{}'::jsonb,
    is_active boolean DEFAULT true,
    run_count integer DEFAULT 0,
    last_run_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE pipeline_rules FORCE ROW LEVEL SECURITY;

ALTER TABLE pipeline_rules OWNER TO postgres;

--
-- Name: public_job_applications; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS public_job_applications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    requisition_id uuid NOT NULL,
    full_name text NOT NULL,
    email text NOT NULL,
    phone text,
    location text,
    current_employer text,
    total_exp_mo integer DEFAULT 0,
    resume_path text,
    cover_letter text,
    status text DEFAULT 'new'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public_job_applications OWNER TO postgres;

--
-- Name: question_bank; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS question_bank (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    category character varying(50) NOT NULL,
    role_type character varying(100),
    difficulty character varying(20) DEFAULT 'medium'::character varying,
    question text NOT NULL,
    expected_answer text,
    tags text[] DEFAULT '{}'::text[],
    usage_count integer DEFAULT 0,
    is_system boolean DEFAULT false,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT question_bank_difficulty_check CHECK (((difficulty)::text = ANY ((ARRAY['easy'::character varying, 'medium'::character varying, 'hard'::character varying])::text[])))
);

ALTER TABLE question_bank FORCE ROW LEVEL SECURITY;

ALTER TABLE question_bank OWNER TO postgres;

--
-- Name: recruiter_client_blocks; Type: TABLE; Schema: public; Owner: app_user
--

CREATE TABLE IF NOT EXISTS recruiter_client_blocks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    recruiter_id uuid NOT NULL,
    client_id uuid,
    reason text,
    blocked_by uuid,
    created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE recruiter_client_blocks FORCE ROW LEVEL SECURITY;

ALTER TABLE recruiter_client_blocks OWNER TO app_user;

--
-- Name: recruiter_tasks; Type: TABLE; Schema: public; Owner: app_user
--

CREATE TABLE IF NOT EXISTS recruiter_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    requisition_id uuid,
    application_id uuid,
    candidate_name character varying(255),
    req_title character varying(255),
    recruiter_id uuid,
    task_type character varying(50) NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    status character varying(20) DEFAULT 'pending'::character varying,
    priority character varying(20) DEFAULT 'medium'::character varying,
    due_at timestamp with time zone,
    completed_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    client_id uuid,
    follow_up_reason text,
    reminder_at timestamp with time zone,
    reminder_sent_at timestamp with time zone,
    rescheduled_from timestamp with time zone,
    reschedule_count integer DEFAULT 0 NOT NULL,
    created_by uuid,
    recurrence_rule text,
    recurrence_parent_id uuid,
    ai_suggested boolean DEFAULT false NOT NULL,
    candidate_id uuid,
    CONSTRAINT recruiter_tasks_priority_check CHECK (((priority)::text = ANY ((ARRAY['low'::character varying, 'medium'::character varying, 'high'::character varying, 'critical'::character varying])::text[]))),
    CONSTRAINT recruiter_tasks_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'in_progress'::character varying, 'completed'::character varying, 'cancelled'::character varying, 'rescheduled'::character varying])::text[])))
);

ALTER TABLE recruiter_tasks FORCE ROW LEVEL SECURITY;

ALTER TABLE recruiter_tasks OWNER TO app_user;

--
-- Name: reference_checks; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS reference_checks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    offer_id uuid,
    referee_name text NOT NULL,
    referee_email text,
    referee_phone text,
    relationship text,
    company text,
    token character varying(64) DEFAULT encode(gen_random_bytes(32), 'hex'::text) NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    sent_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reference_checks_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'sent'::character varying, 'completed'::character varying])::text[])))
);

ALTER TABLE reference_checks OWNER TO postgres;

--
-- Name: reference_responses; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS reference_responses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    reference_check_id uuid NOT NULL,
    q1_known_duration text,
    q2_work_quality integer,
    q3_reliability integer,
    q4_rehire boolean,
    q5_strengths text,
    q6_concerns text,
    q7_overall_rating integer,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reference_responses_q2_work_quality_check CHECK (((q2_work_quality >= 1) AND (q2_work_quality <= 5))),
    CONSTRAINT reference_responses_q3_reliability_check CHECK (((q3_reliability >= 1) AND (q3_reliability <= 5))),
    CONSTRAINT reference_responses_q7_overall_rating_check CHECK (((q7_overall_rating >= 1) AND (q7_overall_rating <= 5)))
);

ALTER TABLE reference_responses FORCE ROW LEVEL SECURITY;

ALTER TABLE reference_responses OWNER TO postgres;

--
-- Name: resume_files; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS resume_files (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    candidate_id uuid,
    imap_msg_id uuid,
    job_board character varying(60),
    job_board_label character varying(80),
    source_email character varying(300),
    source_domain character varying(150),
    file_name character varying(500),
    file_path character varying(1000),
    mime_type character varying(100),
    file_size integer,
    parse_status character varying(20) DEFAULT 'pending'::character varying,
    parsed_data jsonb,
    error_msg text,
    requisition_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    parse_confidence numeric(4,3) DEFAULT 0,
    routing_decision character varying(20) DEFAULT 'pending'::character varying,
    file_hash character varying(64),
    dedup_status character varying(20) DEFAULT 'new'::character varying
);

ALTER TABLE resume_files OWNER TO postgres;

--
-- Name: revenue_forecasts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS revenue_forecasts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    forecast_date date DEFAULT CURRENT_DATE,
    forecast_months integer DEFAULT 6,
    historical jsonb DEFAULT '[]'::jsonb,
    forecast jsonb DEFAULT '[]'::jsonb,
    model_used character varying(50) DEFAULT 'linear_trend'::character varying,
    created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE revenue_forecasts FORCE ROW LEVEL SECURITY;

ALTER TABLE revenue_forecasts OWNER TO postgres;

--
-- Name: role_definitions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS role_definitions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    role_code character varying(50) NOT NULL,
    role_name character varying(100) NOT NULL,
    department character varying(50) NOT NULL,
    level smallint DEFAULT 1 NOT NULL,
    description text,
    permissions jsonb DEFAULT '{}'::jsonb,
    is_active boolean DEFAULT true,
    is_system boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    job_visibility_scope text DEFAULT 'all'::text NOT NULL,
    CONSTRAINT role_definitions_job_visibility_scope_check CHECK ((job_visibility_scope = ANY (ARRAY['all'::text, 'assigned_only'::text])))
);

ALTER TABLE role_definitions FORCE ROW LEVEL SECURITY;

ALTER TABLE role_definitions OWNER TO postgres;

--
-- Name: salary_benchmarks; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS salary_benchmarks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    role_title character varying(200) NOT NULL,
    category character varying(50),
    location character varying(100),
    exp_min numeric(4,1) DEFAULT 0,
    exp_max numeric(4,1),
    salary_min numeric(12,2),
    salary_median numeric(12,2),
    salary_max numeric(12,2),
    currency character varying(5) DEFAULT 'INR'::character varying,
    source character varying(50) DEFAULT 'internal'::character varying,
    as_of_date date DEFAULT CURRENT_DATE,
    created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE salary_benchmarks FORCE ROW LEVEL SECURITY;

ALTER TABLE salary_benchmarks OWNER TO postgres;

--
-- Name: saved_filters; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS saved_filters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid,
    name text NOT NULL,
    filters jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_shared boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE saved_filters FORCE ROW LEVEL SECURITY;

ALTER TABLE saved_filters OWNER TO postgres;

--
-- Name: saved_reports; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS saved_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid,
    name text NOT NULL,
    description text,
    entity character varying(50) NOT NULL,
    fields jsonb DEFAULT '[]'::jsonb NOT NULL,
    filters jsonb DEFAULT '[]'::jsonb NOT NULL,
    group_by character varying(100),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT saved_reports_entity_check CHECK (((entity)::text = ANY ((ARRAY['applications'::character varying, 'candidates'::character varying, 'requisitions'::character varying, 'placements'::character varying])::text[])))
);

ALTER TABLE saved_reports OWNER TO postgres;

--
-- Name: skills_taxonomy; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS skills_taxonomy (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    skill_name character varying(100) NOT NULL,
    category character varying(50),
    aliases text[] DEFAULT '{}'::text[],
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE skills_taxonomy FORCE ROW LEVEL SECURITY;

ALTER TABLE skills_taxonomy OWNER TO postgres;

--
-- Name: sms_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS sms_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    to_phone character varying(20) NOT NULL,
    message text NOT NULL,
    template character varying(50),
    status character varying(20) DEFAULT 'queued'::character varying,
    provider character varying(20) DEFAULT 'msg91'::character varying,
    provider_id text,
    cost_units numeric(6,4) DEFAULT 0,
    sent_at timestamp with time zone,
    error text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT sms_log_status_check CHECK (((status)::text = ANY ((ARRAY['queued'::character varying, 'sent'::character varying, 'failed'::character varying, 'delivered'::character varying])::text[])))
);

ALTER TABLE sms_log FORCE ROW LEVEL SECURITY;

ALTER TABLE sms_log OWNER TO postgres;

--
-- Name: talent_community; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS talent_community (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    email text NOT NULL,
    name text,
    phone text,
    job_categories text[] DEFAULT '{}'::text[] NOT NULL,
    preferred_location text,
    alert_type character varying(20) DEFAULT 'email'::character varying NOT NULL,
    subscribed_at timestamp with time zone DEFAULT now() NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    last_alerted_at timestamp with time zone,
    CONSTRAINT talent_community_alert_type_check CHECK (((alert_type)::text = ANY ((ARRAY['email'::character varying, 'whatsapp'::character varying, 'both'::character varying])::text[])))
);

ALTER TABLE talent_community OWNER TO postgres;

--
-- Name: user_email_accounts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS user_email_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    provider character varying(50) DEFAULT 'custom'::character varying,
    display_name text,
    email text NOT NULL,
    smtp_host text,
    smtp_port integer DEFAULT 587,
    smtp_user text,
    smtp_password text,
    smtp_tls boolean DEFAULT true,
    imap_host text,
    imap_port integer DEFAULT 993,
    imap_user text,
    imap_password text,
    imap_ssl boolean DEFAULT true,
    is_default boolean DEFAULT false,
    is_active boolean DEFAULT true,
    verified boolean DEFAULT false,
    last_verified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    signature text,
    signature_enabled boolean DEFAULT true,
    sig_new_mail uuid,
    sig_reply uuid,
    discovered_folders text[] DEFAULT ARRAY['INBOX'::text],
    sync_status character varying(20) DEFAULT 'idle'::character varying,
    total_emails_synced integer DEFAULT 0
);

ALTER TABLE user_email_accounts OWNER TO postgres;

--
-- Name: user_signatures; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS user_signatures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    name character varying(100) DEFAULT 'My Signature'::character varying NOT NULL,
    html text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

ALTER TABLE user_signatures OWNER TO postgres;

--
-- Name: video_questions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS video_questions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    title text NOT NULL,
    question_text text NOT NULL,
    time_limit_sec integer DEFAULT 120,
    is_active boolean DEFAULT true,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    requisition_id uuid,
    time_limit_secs integer DEFAULT 120 NOT NULL,
    order_num integer DEFAULT 1 NOT NULL
);

ALTER TABLE video_questions OWNER TO postgres;

--
-- Name: video_responses; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS video_responses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    candidate_id uuid,
    question_id uuid,
    application_id uuid,
    file_path text,
    file_name text,
    duration_sec integer,
    status text DEFAULT 'pending'::text,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    rating integer,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    requisition_id uuid,
    recruiter_rating integer,
    recruiter_notes text
);

ALTER TABLE video_responses OWNER TO postgres;

--
-- Name: video_screening_tokens; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS video_screening_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    question_ids uuid[] NOT NULL,
    token text DEFAULT encode(gen_random_bytes(32), 'hex'::text),
    expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval),
    created_at timestamp with time zone DEFAULT now(),
    requisition_id uuid
);

ALTER TABLE video_screening_tokens FORCE ROW LEVEL SECURITY;

ALTER TABLE video_screening_tokens OWNER TO postgres;

--
-- Name: webhook_integrations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS webhook_integrations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    platform character varying(20) NOT NULL,
    name character varying(100) NOT NULL,
    webhook_url text NOT NULL,
    events text[] DEFAULT '{}'::text[],
    is_active boolean DEFAULT true,
    last_sent_at timestamp with time zone,
    send_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT webhook_integrations_platform_check CHECK (((platform)::text = ANY ((ARRAY['slack'::character varying, 'teams'::character varying, 'discord'::character varying, 'custom'::character varying])::text[])))
);

ALTER TABLE webhook_integrations FORCE ROW LEVEL SECURITY;

ALTER TABLE webhook_integrations OWNER TO postgres;

--
-- Name: work_sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS work_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    clock_in timestamp with time zone DEFAULT now() NOT NULL,
    clock_out timestamp with time zone,
    duration_mins numeric(8,2),
    note_in text,
    note_out text
);

ALTER TABLE work_sessions FORCE ROW LEVEL SECURITY;

ALTER TABLE work_sessions OWNER TO postgres;

--
-- Name: pipeline_metrics_cache id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE pipeline_metrics_cache ALTER COLUMN id SET DEFAULT nextval('pipeline_metrics_cache_id_seq'::regclass);

--
-- Name: agency_submissions agency_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE agency_submissions
      ADD CONSTRAINT agency_submissions_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: agency_users agency_users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE agency_users
      ADD CONSTRAINT agency_users_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: agency_users agency_users_token_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE agency_users
      ADD CONSTRAINT agency_users_token_key UNIQUE (token);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: alert_acknowledgments alert_acknowledgments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE alert_acknowledgments
      ADD CONSTRAINT alert_acknowledgments_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: alert_acknowledgments alert_acknowledgments_tenant_id_alert_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE alert_acknowledgments
      ADD CONSTRAINT alert_acknowledgments_tenant_id_alert_id_key UNIQUE (tenant_id, alert_id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: automation_workflows automation_workflows_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE automation_workflows
      ADD CONSTRAINT automation_workflows_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: automation_workflows automation_workflows_tenant_id_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE automation_workflows
      ADD CONSTRAINT automation_workflows_tenant_id_name_key UNIQUE (tenant_id, name);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: calendar_events calendar_events_event_uid_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE calendar_events
      ADD CONSTRAINT calendar_events_event_uid_key UNIQUE (event_uid);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: calendar_events calendar_events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE calendar_events
      ADD CONSTRAINT calendar_events_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: candidate_messages candidate_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE candidate_messages
      ADD CONSTRAINT candidate_messages_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: candidate_nps candidate_nps_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE candidate_nps
      ADD CONSTRAINT candidate_nps_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: candidate_nps candidate_nps_token_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE candidate_nps
      ADD CONSTRAINT candidate_nps_token_key UNIQUE (token);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: candidate_portal_uploads candidate_portal_uploads_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE candidate_portal_uploads
      ADD CONSTRAINT candidate_portal_uploads_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: candidate_status_tokens candidate_status_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE candidate_status_tokens
      ADD CONSTRAINT candidate_status_tokens_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: candidate_status_tokens candidate_status_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE candidate_status_tokens
      ADD CONSTRAINT candidate_status_tokens_token_key UNIQUE (token);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: client_feedback client_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE client_feedback
      ADD CONSTRAINT client_feedback_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: client_feedback client_feedback_tenant_app_uniq; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE client_feedback
      ADD CONSTRAINT client_feedback_tenant_app_uniq UNIQUE (tenant_id, application_id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: client_health_scores client_health_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE client_health_scores
      ADD CONSTRAINT client_health_scores_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: client_health_scores client_health_scores_tenant_id_client_name_score_date_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE client_health_scores
      ADD CONSTRAINT client_health_scores_tenant_id_client_name_score_date_key UNIQUE (tenant_id, client_name, score_date);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: client_portal_users client_portal_users_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE client_portal_users
      ADD CONSTRAINT client_portal_users_email_key UNIQUE (email);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: client_portal_users client_portal_users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE client_portal_users
      ADD CONSTRAINT client_portal_users_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: compliance_records compliance_records_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE compliance_records
      ADD CONSTRAINT compliance_records_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: compliance_records compliance_records_tenant_id_candidate_id_month_year_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE compliance_records
      ADD CONSTRAINT compliance_records_tenant_id_candidate_id_month_year_key UNIQUE (tenant_id, candidate_id, month, year);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: cv_bulk_uploads cv_bulk_uploads_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE cv_bulk_uploads
      ADD CONSTRAINT cv_bulk_uploads_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: email_settings email_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE email_settings
      ADD CONSTRAINT email_settings_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: email_settings email_settings_tenant_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE email_settings
      ADD CONSTRAINT email_settings_tenant_id_key UNIQUE (tenant_id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: email_templates email_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE email_templates
      ADD CONSTRAINT email_templates_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: email_templates email_templates_tenant_id_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE email_templates
      ADD CONSTRAINT email_templates_tenant_id_name_key UNIQUE (tenant_id, name);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: extension_captures extension_captures_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE extension_captures
      ADD CONSTRAINT extension_captures_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: gdpr_archive_log gdpr_archive_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE gdpr_archive_log
      ADD CONSTRAINT gdpr_archive_log_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: gdpr_settings gdpr_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE gdpr_settings
      ADD CONSTRAINT gdpr_settings_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: gdpr_settings gdpr_settings_tenant_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE gdpr_settings
      ADD CONSTRAINT gdpr_settings_tenant_id_key UNIQUE (tenant_id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: headcount_plans headcount_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE headcount_plans
      ADD CONSTRAINT headcount_plans_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: headcount_plans headcount_plans_tenant_id_department_fiscal_year_quarter_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE headcount_plans
      ADD CONSTRAINT headcount_plans_tenant_id_department_fiscal_year_quarter_key UNIQUE (tenant_id, department, fiscal_year, quarter);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: imap_messages imap_messages_account_folder_uid; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE imap_messages
      ADD CONSTRAINT imap_messages_account_folder_uid UNIQUE (account_id, folder, imap_uid);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: imap_messages imap_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE imap_messages
      ADD CONSTRAINT imap_messages_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: imap_sync_state imap_sync_state_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE imap_sync_state
      ADD CONSTRAINT imap_sync_state_pkey PRIMARY KEY (account_id, folder);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: interview_schedules interview_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE interview_schedules
      ADD CONSTRAINT interview_schedules_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: jd_templates jd_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE jd_templates
      ADD CONSTRAINT jd_templates_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: jd_templates jd_templates_tenant_id_title_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE jd_templates
      ADD CONSTRAINT jd_templates_tenant_id_title_key UNIQUE (tenant_id, title);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: job_distributions job_distributions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE job_distributions
      ADD CONSTRAINT job_distributions_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: job_shares job_shares_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE job_shares
      ADD CONSTRAINT job_shares_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: linkedin_captures linkedin_captures_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE linkedin_captures
      ADD CONSTRAINT linkedin_captures_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: message_drafts message_drafts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE message_drafts
      ADD CONSTRAINT message_drafts_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: nurture_executions nurture_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE nurture_executions
      ADD CONSTRAINT nurture_executions_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: nurture_executions nurture_executions_sequence_id_candidate_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE nurture_executions
      ADD CONSTRAINT nurture_executions_sequence_id_candidate_id_key UNIQUE (sequence_id, candidate_id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: nurture_sequences nurture_sequences_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE nurture_sequences
      ADD CONSTRAINT nurture_sequences_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: nurture_sequences nurture_sequences_tenant_id_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE nurture_sequences
      ADD CONSTRAINT nurture_sequences_tenant_id_name_key UNIQUE (tenant_id, name);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: offer_esign_requests offer_esign_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE offer_esign_requests
      ADD CONSTRAINT offer_esign_requests_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: offer_esign_requests offer_esign_requests_token_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE offer_esign_requests
      ADD CONSTRAINT offer_esign_requests_token_key UNIQUE (token);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: ollama_cache ollama_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE ollama_cache
      ADD CONSTRAINT ollama_cache_pkey PRIMARY KEY (cache_key);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: pipeline_metrics_cache pipeline_metrics_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE pipeline_metrics_cache
      ADD CONSTRAINT pipeline_metrics_cache_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: pipeline_rules pipeline_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE pipeline_rules
      ADD CONSTRAINT pipeline_rules_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: pipeline_rules pipeline_rules_tenant_id_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE pipeline_rules
      ADD CONSTRAINT pipeline_rules_tenant_id_name_key UNIQUE (tenant_id, name);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: public_job_applications public_job_applications_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE public_job_applications
      ADD CONSTRAINT public_job_applications_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: question_bank question_bank_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE question_bank
      ADD CONSTRAINT question_bank_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: recruiter_client_blocks recruiter_client_blocks_pkey; Type: CONSTRAINT; Schema: public; Owner: app_user
--

DO $$ BEGIN
  ALTER TABLE recruiter_client_blocks
      ADD CONSTRAINT recruiter_client_blocks_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: recruiter_client_blocks recruiter_client_blocks_tenant_id_recruiter_id_client_id_key; Type: CONSTRAINT; Schema: public; Owner: app_user
--

DO $$ BEGIN
  ALTER TABLE recruiter_client_blocks
      ADD CONSTRAINT recruiter_client_blocks_tenant_id_recruiter_id_client_id_key UNIQUE (tenant_id, recruiter_id, client_id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: recruiter_tasks recruiter_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: app_user
--

DO $$ BEGIN
  ALTER TABLE recruiter_tasks
      ADD CONSTRAINT recruiter_tasks_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: reference_checks reference_checks_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE reference_checks
      ADD CONSTRAINT reference_checks_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: reference_checks reference_checks_token_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE reference_checks
      ADD CONSTRAINT reference_checks_token_key UNIQUE (token);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: reference_responses reference_responses_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE reference_responses
      ADD CONSTRAINT reference_responses_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: resume_files resume_files_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE resume_files
      ADD CONSTRAINT resume_files_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: revenue_forecasts revenue_forecasts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE revenue_forecasts
      ADD CONSTRAINT revenue_forecasts_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: role_definitions role_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE role_definitions
      ADD CONSTRAINT role_definitions_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: role_definitions role_definitions_tenant_id_role_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE role_definitions
      ADD CONSTRAINT role_definitions_tenant_id_role_code_key UNIQUE (tenant_id, role_code);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: salary_benchmarks salary_benchmarks_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE salary_benchmarks
      ADD CONSTRAINT salary_benchmarks_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: saved_filters saved_filters_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE saved_filters
      ADD CONSTRAINT saved_filters_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: saved_reports saved_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE saved_reports
      ADD CONSTRAINT saved_reports_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: skills_taxonomy skills_taxonomy_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE skills_taxonomy
      ADD CONSTRAINT skills_taxonomy_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: skills_taxonomy skills_taxonomy_tenant_id_skill_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE skills_taxonomy
      ADD CONSTRAINT skills_taxonomy_tenant_id_skill_name_key UNIQUE (tenant_id, skill_name);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: sms_log sms_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE sms_log
      ADD CONSTRAINT sms_log_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: talent_community talent_community_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE talent_community
      ADD CONSTRAINT talent_community_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: talent_community talent_community_tenant_id_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE talent_community
      ADD CONSTRAINT talent_community_tenant_id_email_key UNIQUE (tenant_id, email);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: user_email_accounts user_email_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE user_email_accounts
      ADD CONSTRAINT user_email_accounts_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: user_signatures user_signatures_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE user_signatures
      ADD CONSTRAINT user_signatures_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: video_questions video_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE video_questions
      ADD CONSTRAINT video_questions_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: video_responses video_responses_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE video_responses
      ADD CONSTRAINT video_responses_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: video_screening_tokens video_screening_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE video_screening_tokens
      ADD CONSTRAINT video_screening_tokens_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: video_screening_tokens video_screening_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE video_screening_tokens
      ADD CONSTRAINT video_screening_tokens_token_key UNIQUE (token);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: webhook_integrations webhook_integrations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE webhook_integrations
      ADD CONSTRAINT webhook_integrations_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: webhook_integrations webhook_integrations_tenant_id_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE webhook_integrations
      ADD CONSTRAINT webhook_integrations_tenant_id_name_key UNIQUE (tenant_id, name);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: work_sessions work_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE work_sessions
      ADD CONSTRAINT work_sessions_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: idx_alert_ack_tenant; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX IF NOT EXISTS idx_alert_ack_tenant ON alert_acknowledgments USING btree (tenant_id);

--
-- Name: idx_cand_msgs_candidate; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX IF NOT EXISTS idx_cand_msgs_candidate ON candidate_messages USING btree (candidate_id);

--
-- Name: idx_cand_msgs_stage; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX IF NOT EXISTS idx_cand_msgs_stage ON candidate_messages USING btree (tenant_id, stage_at_send);

--
-- Name: idx_cand_msgs_tenant; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX IF NOT EXISTS idx_cand_msgs_tenant ON candidate_messages USING btree (tenant_id, created_at DESC);

--
-- Name: idx_cand_msgs_tracking_token; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX IF NOT EXISTS idx_cand_msgs_tracking_token ON candidate_messages USING btree (tracking_token) WHERE (tracking_token IS NOT NULL);

--
-- Name: idx_drafts_tenant; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX IF NOT EXISTS idx_drafts_tenant ON message_drafts USING btree (tenant_id);

--
-- Name: idx_imap_account; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX IF NOT EXISTS idx_imap_account ON imap_messages USING btree (account_id, tenant_id);

--
-- Name: idx_imap_candidate; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX IF NOT EXISTS idx_imap_candidate ON imap_messages USING btree (candidate_id);

--
-- Name: idx_nurture_exec_seq; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX IF NOT EXISTS idx_nurture_exec_seq ON nurture_executions USING btree (sequence_id, candidate_id);

--
-- Name: idx_rcblocks_recruiter; Type: INDEX; Schema: public; Owner: app_user
--

CREATE INDEX IF NOT EXISTS idx_rcblocks_recruiter ON recruiter_client_blocks USING btree (recruiter_id);

--
-- Name: idx_rcblocks_tenant; Type: INDEX; Schema: public; Owner: app_user
--

CREATE INDEX IF NOT EXISTS idx_rcblocks_tenant ON recruiter_client_blocks USING btree (tenant_id);

--
-- Name: idx_rf_candidate; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX IF NOT EXISTS idx_rf_candidate ON resume_files USING btree (candidate_id);

--
-- Name: idx_rf_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX IF NOT EXISTS idx_rf_created ON resume_files USING btree (created_at DESC);

--
-- Name: idx_rf_hash; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX IF NOT EXISTS idx_rf_hash ON resume_files USING btree (tenant_id, file_hash) WHERE (file_hash IS NOT NULL);

--
-- Name: idx_rf_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX IF NOT EXISTS idx_rf_status ON resume_files USING btree (parse_status);

--
-- Name: idx_rf_tenant; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX IF NOT EXISTS idx_rf_tenant ON resume_files USING btree (tenant_id);

--
-- Name: idx_rtasks_candidate; Type: INDEX; Schema: public; Owner: app_user
--

CREATE INDEX IF NOT EXISTS idx_rtasks_candidate ON recruiter_tasks USING btree (tenant_id, candidate_id) WHERE (candidate_id IS NOT NULL);

--
-- Name: idx_rtasks_client; Type: INDEX; Schema: public; Owner: app_user
--

CREATE INDEX IF NOT EXISTS idx_rtasks_client ON recruiter_tasks USING btree (tenant_id, client_id) WHERE (client_id IS NOT NULL);

--
-- Name: idx_rtasks_due_at; Type: INDEX; Schema: public; Owner: app_user
--

CREATE INDEX IF NOT EXISTS idx_rtasks_due_at ON recruiter_tasks USING btree (tenant_id, due_at) WHERE ((status)::text = ANY ((ARRAY['pending'::character varying, 'in_progress'::character varying])::text[]));

--
-- Name: idx_rtasks_recruiter; Type: INDEX; Schema: public; Owner: app_user
--

CREATE INDEX IF NOT EXISTS idx_rtasks_recruiter ON recruiter_tasks USING btree (recruiter_id);

--
-- Name: idx_rtasks_reminder_at; Type: INDEX; Schema: public; Owner: app_user
--

CREATE INDEX IF NOT EXISTS idx_rtasks_reminder_at ON recruiter_tasks USING btree (tenant_id, reminder_at) WHERE ((reminder_sent_at IS NULL) AND (reminder_at IS NOT NULL));

--
-- Name: idx_rtasks_req; Type: INDEX; Schema: public; Owner: app_user
--

CREATE INDEX IF NOT EXISTS idx_rtasks_req ON recruiter_tasks USING btree (requisition_id);

--
-- Name: idx_rtasks_status; Type: INDEX; Schema: public; Owner: app_user
--

CREATE INDEX IF NOT EXISTS idx_rtasks_status ON recruiter_tasks USING btree (status);

--
-- Name: idx_rtasks_tenant; Type: INDEX; Schema: public; Owner: app_user
--

CREATE INDEX IF NOT EXISTS idx_rtasks_tenant ON recruiter_tasks USING btree (tenant_id);

--
-- Name: idx_saved_filters_tenant; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX IF NOT EXISTS idx_saved_filters_tenant ON saved_filters USING btree (tenant_id);

--
-- Name: idx_uemail_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX IF NOT EXISTS idx_uemail_user ON user_email_accounts USING btree (user_id, tenant_id);

--
-- Name: idx_user_sigs; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX IF NOT EXISTS idx_user_sigs ON user_signatures USING btree (user_id, tenant_id);

--
-- Name: idx_work_sessions_tenant; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX IF NOT EXISTS idx_work_sessions_tenant ON work_sessions USING btree (tenant_id);

--
-- Name: idx_work_sessions_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX IF NOT EXISTS idx_work_sessions_user ON work_sessions USING btree (user_id);

--
-- Name: uq_resume_files_msg_fname; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX IF NOT EXISTS uq_resume_files_msg_fname ON resume_files USING btree (tenant_id, imap_msg_id, file_name) WHERE ((imap_msg_id IS NOT NULL) AND (file_name IS NOT NULL));

--
-- Name: alert_acknowledgments alert_acknowledgments_acknowledged_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE alert_acknowledgments
      ADD CONSTRAINT alert_acknowledgments_acknowledged_by_fkey FOREIGN KEY (acknowledged_by) REFERENCES users(id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: automation_workflows automation_workflows_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE automation_workflows
      ADD CONSTRAINT automation_workflows_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: calendar_events calendar_events_interview_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE calendar_events
      ADD CONSTRAINT calendar_events_interview_id_fkey FOREIGN KEY (interview_id) REFERENCES interview_schedules(id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: calendar_events calendar_events_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE calendar_events
      ADD CONSTRAINT calendar_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: calendar_events calendar_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE calendar_events
      ADD CONSTRAINT calendar_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: candidate_messages candidate_messages_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE candidate_messages
      ADD CONSTRAINT candidate_messages_application_id_fkey FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: candidate_messages candidate_messages_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE candidate_messages
      ADD CONSTRAINT candidate_messages_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: candidate_messages candidate_messages_from_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE candidate_messages
      ADD CONSTRAINT candidate_messages_from_account_id_fkey FOREIGN KEY (from_account_id) REFERENCES user_email_accounts(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: candidate_messages candidate_messages_from_whatsapp_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE candidate_messages
      ADD CONSTRAINT candidate_messages_from_whatsapp_account_id_fkey FOREIGN KEY (from_whatsapp_account_id) REFERENCES user_whatsapp_accounts(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: candidate_messages candidate_messages_sent_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE candidate_messages
      ADD CONSTRAINT candidate_messages_sent_by_fkey FOREIGN KEY (sent_by) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: candidate_messages candidate_messages_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE candidate_messages
      ADD CONSTRAINT candidate_messages_template_id_fkey FOREIGN KEY (template_id) REFERENCES email_templates(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: candidate_nps candidate_nps_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE candidate_nps
      ADD CONSTRAINT candidate_nps_application_id_fkey FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: candidate_nps candidate_nps_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE candidate_nps
      ADD CONSTRAINT candidate_nps_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: candidate_status_tokens candidate_status_tokens_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE candidate_status_tokens
      ADD CONSTRAINT candidate_status_tokens_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES candidates(id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: candidate_status_tokens candidate_status_tokens_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE candidate_status_tokens
      ADD CONSTRAINT candidate_status_tokens_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: client_feedback client_feedback_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE client_feedback
      ADD CONSTRAINT client_feedback_application_id_fkey FOREIGN KEY (application_id) REFERENCES applications(id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: client_feedback client_feedback_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE client_feedback
      ADD CONSTRAINT client_feedback_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES candidates(id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: client_feedback client_feedback_client_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE client_feedback
      ADD CONSTRAINT client_feedback_client_user_id_fkey FOREIGN KEY (client_user_id) REFERENCES client_portal_users(id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: client_feedback client_feedback_requisition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE client_feedback
      ADD CONSTRAINT client_feedback_requisition_id_fkey FOREIGN KEY (requisition_id) REFERENCES requisitions(id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: client_feedback client_feedback_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE client_feedback
      ADD CONSTRAINT client_feedback_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: client_health_scores client_health_scores_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE client_health_scores
      ADD CONSTRAINT client_health_scores_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: client_portal_users client_portal_users_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE client_portal_users
      ADD CONSTRAINT client_portal_users_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: compliance_records compliance_records_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE compliance_records
      ADD CONSTRAINT compliance_records_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES candidates(id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: compliance_records compliance_records_placement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE compliance_records
      ADD CONSTRAINT compliance_records_placement_id_fkey FOREIGN KEY (placement_id) REFERENCES placements(id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: compliance_records compliance_records_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE compliance_records
      ADD CONSTRAINT compliance_records_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: cv_bulk_uploads cv_bulk_uploads_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE cv_bulk_uploads
      ADD CONSTRAINT cv_bulk_uploads_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: cv_bulk_uploads cv_bulk_uploads_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE cv_bulk_uploads
      ADD CONSTRAINT cv_bulk_uploads_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES users(id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: email_settings email_settings_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE email_settings
      ADD CONSTRAINT email_settings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: email_templates email_templates_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE email_templates
      ADD CONSTRAINT email_templates_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: extension_captures extension_captures_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE extension_captures
      ADD CONSTRAINT extension_captures_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: extension_captures extension_captures_captured_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE extension_captures
      ADD CONSTRAINT extension_captures_captured_by_fkey FOREIGN KEY (captured_by) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: gdpr_archive_log gdpr_archive_log_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE gdpr_archive_log
      ADD CONSTRAINT gdpr_archive_log_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: headcount_plans headcount_plans_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE headcount_plans
      ADD CONSTRAINT headcount_plans_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES users(id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: headcount_plans headcount_plans_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE headcount_plans
      ADD CONSTRAINT headcount_plans_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: imap_messages imap_messages_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE imap_messages
      ADD CONSTRAINT imap_messages_account_id_fkey FOREIGN KEY (account_id) REFERENCES user_email_accounts(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: imap_messages imap_messages_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE imap_messages
      ADD CONSTRAINT imap_messages_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: imap_sync_state imap_sync_state_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE imap_sync_state
      ADD CONSTRAINT imap_sync_state_account_id_fkey FOREIGN KEY (account_id) REFERENCES user_email_accounts(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: interview_schedules interview_schedules_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE interview_schedules
      ADD CONSTRAINT interview_schedules_application_id_fkey FOREIGN KEY (application_id) REFERENCES applications(id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: interview_schedules interview_schedules_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE interview_schedules
      ADD CONSTRAINT interview_schedules_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES candidates(id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: interview_schedules interview_schedules_interviewer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE interview_schedules
      ADD CONSTRAINT interview_schedules_interviewer_id_fkey FOREIGN KEY (interviewer_id) REFERENCES users(id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: interview_schedules interview_schedules_requisition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE interview_schedules
      ADD CONSTRAINT interview_schedules_requisition_id_fkey FOREIGN KEY (requisition_id) REFERENCES requisitions(id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: interview_schedules interview_schedules_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE interview_schedules
      ADD CONSTRAINT interview_schedules_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: jd_templates jd_templates_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE jd_templates
      ADD CONSTRAINT jd_templates_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: job_distributions job_distributions_requisition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE job_distributions
      ADD CONSTRAINT job_distributions_requisition_id_fkey FOREIGN KEY (requisition_id) REFERENCES requisitions(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: job_shares job_shares_posted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE job_shares
      ADD CONSTRAINT job_shares_posted_by_fkey FOREIGN KEY (posted_by) REFERENCES users(id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: job_shares job_shares_requisition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE job_shares
      ADD CONSTRAINT job_shares_requisition_id_fkey FOREIGN KEY (requisition_id) REFERENCES requisitions(id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: job_shares job_shares_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE job_shares
      ADD CONSTRAINT job_shares_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: message_drafts message_drafts_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE message_drafts
      ADD CONSTRAINT message_drafts_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: message_drafts message_drafts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE message_drafts
      ADD CONSTRAINT message_drafts_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: nurture_sequences nurture_sequences_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE nurture_sequences
      ADD CONSTRAINT nurture_sequences_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: pipeline_rules pipeline_rules_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE pipeline_rules
      ADD CONSTRAINT pipeline_rules_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: question_bank question_bank_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE question_bank
      ADD CONSTRAINT question_bank_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: recruiter_client_blocks recruiter_client_blocks_blocked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: app_user
--

DO $$ BEGIN
  ALTER TABLE recruiter_client_blocks
      ADD CONSTRAINT recruiter_client_blocks_blocked_by_fkey FOREIGN KEY (blocked_by) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: recruiter_client_blocks recruiter_client_blocks_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: app_user
--

DO $$ BEGIN
  ALTER TABLE recruiter_client_blocks
      ADD CONSTRAINT recruiter_client_blocks_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: recruiter_client_blocks recruiter_client_blocks_recruiter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: app_user
--

DO $$ BEGIN
  ALTER TABLE recruiter_client_blocks
      ADD CONSTRAINT recruiter_client_blocks_recruiter_id_fkey FOREIGN KEY (recruiter_id) REFERENCES users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: recruiter_tasks recruiter_tasks_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: app_user
--

DO $$ BEGIN
  ALTER TABLE recruiter_tasks
      ADD CONSTRAINT recruiter_tasks_application_id_fkey FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: recruiter_tasks recruiter_tasks_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: app_user
--

DO $$ BEGIN
  ALTER TABLE recruiter_tasks
      ADD CONSTRAINT recruiter_tasks_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: recruiter_tasks recruiter_tasks_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: app_user
--

DO $$ BEGIN
  ALTER TABLE recruiter_tasks
      ADD CONSTRAINT recruiter_tasks_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: recruiter_tasks recruiter_tasks_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: app_user
--

DO $$ BEGIN
  ALTER TABLE recruiter_tasks
      ADD CONSTRAINT recruiter_tasks_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: recruiter_tasks recruiter_tasks_recruiter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: app_user
--

DO $$ BEGIN
  ALTER TABLE recruiter_tasks
      ADD CONSTRAINT recruiter_tasks_recruiter_id_fkey FOREIGN KEY (recruiter_id) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: recruiter_tasks recruiter_tasks_recurrence_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: app_user
--

DO $$ BEGIN
  ALTER TABLE recruiter_tasks
      ADD CONSTRAINT recruiter_tasks_recurrence_parent_id_fkey FOREIGN KEY (recurrence_parent_id) REFERENCES recruiter_tasks(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: recruiter_tasks recruiter_tasks_requisition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: app_user
--

DO $$ BEGIN
  ALTER TABLE recruiter_tasks
      ADD CONSTRAINT recruiter_tasks_requisition_id_fkey FOREIGN KEY (requisition_id) REFERENCES requisitions(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: reference_checks reference_checks_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE reference_checks
      ADD CONSTRAINT reference_checks_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: reference_checks reference_checks_offer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE reference_checks
      ADD CONSTRAINT reference_checks_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: reference_responses reference_responses_reference_check_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE reference_responses
      ADD CONSTRAINT reference_responses_reference_check_id_fkey FOREIGN KEY (reference_check_id) REFERENCES reference_checks(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: resume_files resume_files_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE resume_files
      ADD CONSTRAINT resume_files_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: resume_files resume_files_imap_msg_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE resume_files
      ADD CONSTRAINT resume_files_imap_msg_id_fkey FOREIGN KEY (imap_msg_id) REFERENCES imap_messages(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: resume_files resume_files_requisition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE resume_files
      ADD CONSTRAINT resume_files_requisition_id_fkey FOREIGN KEY (requisition_id) REFERENCES requisitions(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: revenue_forecasts revenue_forecasts_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE revenue_forecasts
      ADD CONSTRAINT revenue_forecasts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: role_definitions role_definitions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE role_definitions
      ADD CONSTRAINT role_definitions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: salary_benchmarks salary_benchmarks_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE salary_benchmarks
      ADD CONSTRAINT salary_benchmarks_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: saved_reports saved_reports_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE saved_reports
      ADD CONSTRAINT saved_reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: skills_taxonomy skills_taxonomy_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE skills_taxonomy
      ADD CONSTRAINT skills_taxonomy_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: sms_log sms_log_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE sms_log
      ADD CONSTRAINT sms_log_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: user_email_accounts user_email_accounts_sig_new_mail_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE user_email_accounts
      ADD CONSTRAINT user_email_accounts_sig_new_mail_fkey FOREIGN KEY (sig_new_mail) REFERENCES user_signatures(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: user_email_accounts user_email_accounts_sig_reply_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE user_email_accounts
      ADD CONSTRAINT user_email_accounts_sig_reply_fkey FOREIGN KEY (sig_reply) REFERENCES user_signatures(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: user_email_accounts user_email_accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE user_email_accounts
      ADD CONSTRAINT user_email_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: user_signatures user_signatures_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE user_signatures
      ADD CONSTRAINT user_signatures_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: video_questions video_questions_requisition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE video_questions
      ADD CONSTRAINT video_questions_requisition_id_fkey FOREIGN KEY (requisition_id) REFERENCES requisitions(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: video_responses video_responses_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE video_responses
      ADD CONSTRAINT video_responses_question_id_fkey FOREIGN KEY (question_id) REFERENCES video_questions(id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: video_responses video_responses_requisition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE video_responses
      ADD CONSTRAINT video_responses_requisition_id_fkey FOREIGN KEY (requisition_id) REFERENCES requisitions(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: video_screening_tokens video_screening_tokens_requisition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE video_screening_tokens
      ADD CONSTRAINT video_screening_tokens_requisition_id_fkey FOREIGN KEY (requisition_id) REFERENCES requisitions(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: webhook_integrations webhook_integrations_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE webhook_integrations
      ADD CONSTRAINT webhook_integrations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: work_sessions work_sessions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE work_sessions
      ADD CONSTRAINT work_sessions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: work_sessions work_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

DO $$ BEGIN
  ALTER TABLE work_sessions
      ADD CONSTRAINT work_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN NULL;
END $$;

--
-- Name: agency_submissions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE agency_submissions ENABLE ROW LEVEL SECURITY;

--
-- Name: agency_users; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE agency_users ENABLE ROW LEVEL SECURITY;

--
-- Name: alert_acknowledgments; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE alert_acknowledgments ENABLE ROW LEVEL SECURITY;

--
-- Name: automation_workflows; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE automation_workflows ENABLE ROW LEVEL SECURITY;

--
-- Name: calendar_events; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;

--
-- Name: candidate_messages; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE candidate_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: candidate_nps; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE candidate_nps ENABLE ROW LEVEL SECURITY;

--
-- Name: candidate_portal_uploads; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE candidate_portal_uploads ENABLE ROW LEVEL SECURITY;

--
-- Name: client_feedback; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE client_feedback ENABLE ROW LEVEL SECURITY;

--
-- Name: client_health_scores; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE client_health_scores ENABLE ROW LEVEL SECURITY;

--
-- Name: client_portal_users; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE client_portal_users ENABLE ROW LEVEL SECURITY;

--
-- Name: compliance_records; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE compliance_records ENABLE ROW LEVEL SECURITY;

--
-- Name: cv_bulk_uploads; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE cv_bulk_uploads ENABLE ROW LEVEL SECURITY;

--
-- Name: email_templates; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: extension_captures; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE extension_captures ENABLE ROW LEVEL SECURITY;

--
-- Name: extension_captures extension_captures_isolation; Type: POLICY; Schema: public; Owner: postgres
--

DROP POLICY IF EXISTS extension_captures_isolation ON extension_captures;
CREATE POLICY extension_captures_isolation ON extension_captures USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

--
-- Name: gdpr_archive_log; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE gdpr_archive_log ENABLE ROW LEVEL SECURITY;

--
-- Name: gdpr_settings gdpr_isolation; Type: POLICY; Schema: public; Owner: postgres
--

DROP POLICY IF EXISTS gdpr_isolation ON gdpr_settings;
CREATE POLICY gdpr_isolation ON gdpr_settings USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

--
-- Name: gdpr_settings; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE gdpr_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: headcount_plans; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE headcount_plans ENABLE ROW LEVEL SECURITY;

--
-- Name: interview_schedules; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE interview_schedules ENABLE ROW LEVEL SECURITY;

--
-- Name: jd_templates; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE jd_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: job_distributions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE job_distributions ENABLE ROW LEVEL SECURITY;

--
-- Name: job_distributions job_distributions_isolation; Type: POLICY; Schema: public; Owner: postgres
--

DROP POLICY IF EXISTS job_distributions_isolation ON job_distributions;
CREATE POLICY job_distributions_isolation ON job_distributions USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

--
-- Name: job_shares; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE job_shares ENABLE ROW LEVEL SECURITY;

--
-- Name: linkedin_captures; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE linkedin_captures ENABLE ROW LEVEL SECURITY;

--
-- Name: candidate_nps nps_isolation; Type: POLICY; Schema: public; Owner: postgres
--

DROP POLICY IF EXISTS nps_isolation ON candidate_nps;
CREATE POLICY nps_isolation ON candidate_nps USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

--
-- Name: nurture_sequences; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE nurture_sequences ENABLE ROW LEVEL SECURITY;

--
-- Name: pipeline_rules; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE pipeline_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: question_bank; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE question_bank ENABLE ROW LEVEL SECURITY;

--
-- Name: recruiter_client_blocks; Type: ROW SECURITY; Schema: public; Owner: app_user
--

ALTER TABLE recruiter_client_blocks ENABLE ROW LEVEL SECURITY;

--
-- Name: recruiter_tasks; Type: ROW SECURITY; Schema: public; Owner: app_user
--

ALTER TABLE recruiter_tasks ENABLE ROW LEVEL SECURITY;

--
-- Name: reference_checks; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE reference_checks ENABLE ROW LEVEL SECURITY;

--
-- Name: reference_checks reference_checks_isolation; Type: POLICY; Schema: public; Owner: postgres
--

DROP POLICY IF EXISTS reference_checks_isolation ON reference_checks;
CREATE POLICY reference_checks_isolation ON reference_checks USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

--
-- Name: reference_responses; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE reference_responses ENABLE ROW LEVEL SECURITY;

--
-- Name: revenue_forecasts; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE revenue_forecasts ENABLE ROW LEVEL SECURITY;

--
-- Name: automation_workflows rls_awf; Type: POLICY; Schema: public; Owner: postgres
--

DROP POLICY IF EXISTS rls_awf ON automation_workflows;
CREATE POLICY rls_awf ON automation_workflows USING ((tenant_id = (current_setting('app.tenant_id'::text, true))::uuid));

--
-- Name: cv_bulk_uploads rls_bulk; Type: POLICY; Schema: public; Owner: postgres
--

DROP POLICY IF EXISTS rls_bulk ON cv_bulk_uploads;
CREATE POLICY rls_bulk ON cv_bulk_uploads USING ((tenant_id = (current_setting('app.tenant_id'::text, true))::uuid));

--
-- Name: calendar_events rls_cal; Type: POLICY; Schema: public; Owner: postgres
--

DROP POLICY IF EXISTS rls_cal ON calendar_events;
CREATE POLICY rls_cal ON calendar_events USING ((tenant_id = (current_setting('app.tenant_id'::text, true))::uuid));

--
-- Name: client_feedback rls_cf; Type: POLICY; Schema: public; Owner: postgres
--

DROP POLICY IF EXISTS rls_cf ON client_feedback;
CREATE POLICY rls_cf ON client_feedback USING ((tenant_id = (current_setting('app.tenant_id'::text, true))::uuid));

--
-- Name: client_health_scores rls_chs; Type: POLICY; Schema: public; Owner: postgres
--

DROP POLICY IF EXISTS rls_chs ON client_health_scores;
CREATE POLICY rls_chs ON client_health_scores USING ((tenant_id = (current_setting('app.tenant_id'::text, true))::uuid));

--
-- Name: compliance_records rls_comp; Type: POLICY; Schema: public; Owner: postgres
--

DROP POLICY IF EXISTS rls_comp ON compliance_records;
CREATE POLICY rls_comp ON compliance_records USING ((tenant_id = (current_setting('app.tenant_id'::text, true))::uuid));

--
-- Name: client_portal_users rls_cpu; Type: POLICY; Schema: public; Owner: postgres
--

DROP POLICY IF EXISTS rls_cpu ON client_portal_users;
CREATE POLICY rls_cpu ON client_portal_users USING ((tenant_id = (current_setting('app.tenant_id'::text, true))::uuid));

--
-- Name: candidate_status_tokens rls_cst; Type: POLICY; Schema: public; Owner: postgres
--

DROP POLICY IF EXISTS rls_cst ON candidate_status_tokens;
CREATE POLICY rls_cst ON candidate_status_tokens USING (true);

--
-- Name: email_templates rls_email_tmpl; Type: POLICY; Schema: public; Owner: postgres
--

DROP POLICY IF EXISTS rls_email_tmpl ON email_templates;
CREATE POLICY rls_email_tmpl ON email_templates USING ((tenant_id = (current_setting('app.tenant_id'::text, true))::uuid));

--
-- Name: gdpr_archive_log rls_gdpr; Type: POLICY; Schema: public; Owner: postgres
--

DROP POLICY IF EXISTS rls_gdpr ON gdpr_archive_log;
CREATE POLICY rls_gdpr ON gdpr_archive_log USING ((tenant_id = (current_setting('app.tenant_id'::text, true))::uuid));

--
-- Name: headcount_plans rls_hcp; Type: POLICY; Schema: public; Owner: postgres
--

DROP POLICY IF EXISTS rls_hcp ON headcount_plans;
CREATE POLICY rls_hcp ON headcount_plans USING ((tenant_id = (current_setting('app.tenant_id'::text, true))::uuid));

--
-- Name: interview_schedules rls_is; Type: POLICY; Schema: public; Owner: postgres
--

DROP POLICY IF EXISTS rls_is ON interview_schedules;
CREATE POLICY rls_is ON interview_schedules USING ((tenant_id = (current_setting('app.tenant_id'::text, true))::uuid));

--
-- Name: jd_templates rls_jdt; Type: POLICY; Schema: public; Owner: postgres
--

DROP POLICY IF EXISTS rls_jdt ON jd_templates;
CREATE POLICY rls_jdt ON jd_templates USING (((tenant_id IS NULL) OR (tenant_id = (current_setting('app.tenant_id'::text, true))::uuid)));

--
-- Name: job_shares rls_js; Type: POLICY; Schema: public; Owner: postgres
--

DROP POLICY IF EXISTS rls_js ON job_shares;
CREATE POLICY rls_js ON job_shares USING ((tenant_id = (current_setting('app.tenant_id'::text, true))::uuid));

--
-- Name: nurture_sequences rls_ns; Type: POLICY; Schema: public; Owner: postgres
--

DROP POLICY IF EXISTS rls_ns ON nurture_sequences;
CREATE POLICY rls_ns ON nurture_sequences USING ((tenant_id = (current_setting('app.tenant_id'::text, true))::uuid));

--
-- Name: pipeline_rules rls_pr; Type: POLICY; Schema: public; Owner: postgres
--

DROP POLICY IF EXISTS rls_pr ON pipeline_rules;
CREATE POLICY rls_pr ON pipeline_rules USING ((tenant_id = (current_setting('app.tenant_id'::text, true))::uuid));

--
-- Name: question_bank rls_qbank; Type: POLICY; Schema: public; Owner: postgres
--

DROP POLICY IF EXISTS rls_qbank ON question_bank;
CREATE POLICY rls_qbank ON question_bank USING (((tenant_id IS NULL) OR (tenant_id = (current_setting('app.tenant_id'::text, true))::uuid)));

--
-- Name: revenue_forecasts rls_rf; Type: POLICY; Schema: public; Owner: postgres
--

DROP POLICY IF EXISTS rls_rf ON revenue_forecasts;
CREATE POLICY rls_rf ON revenue_forecasts USING ((tenant_id = (current_setting('app.tenant_id'::text, true))::uuid));

--
-- Name: role_definitions rls_role_def; Type: POLICY; Schema: public; Owner: postgres
--

DROP POLICY IF EXISTS rls_role_def ON role_definitions;
CREATE POLICY rls_role_def ON role_definitions USING ((tenant_id = (current_setting('app.tenant_id'::text, true))::uuid));

--
-- Name: salary_benchmarks rls_sal; Type: POLICY; Schema: public; Owner: postgres
--

DROP POLICY IF EXISTS rls_sal ON salary_benchmarks;
CREATE POLICY rls_sal ON salary_benchmarks USING (((tenant_id IS NULL) OR (tenant_id = (current_setting('app.tenant_id'::text, true))::uuid)));

--
-- Name: skills_taxonomy rls_skills; Type: POLICY; Schema: public; Owner: postgres
--

DROP POLICY IF EXISTS rls_skills ON skills_taxonomy;
CREATE POLICY rls_skills ON skills_taxonomy USING (((tenant_id IS NULL) OR (tenant_id = (current_setting('app.tenant_id'::text, true))::uuid)));

--
-- Name: sms_log rls_sms; Type: POLICY; Schema: public; Owner: postgres
--

DROP POLICY IF EXISTS rls_sms ON sms_log;
CREATE POLICY rls_sms ON sms_log USING ((tenant_id = (current_setting('app.tenant_id'::text, true))::uuid));

--
-- Name: webhook_integrations rls_wi; Type: POLICY; Schema: public; Owner: postgres
--

DROP POLICY IF EXISTS rls_wi ON webhook_integrations;
CREATE POLICY rls_wi ON webhook_integrations USING ((tenant_id = (current_setting('app.tenant_id'::text, true))::uuid));

--
-- Name: role_definitions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE role_definitions ENABLE ROW LEVEL SECURITY;

--
-- Name: salary_benchmarks; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE salary_benchmarks ENABLE ROW LEVEL SECURITY;

--
-- Name: saved_filters; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE saved_filters ENABLE ROW LEVEL SECURITY;

--
-- Name: saved_reports; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE saved_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: saved_reports saved_reports_isolation; Type: POLICY; Schema: public; Owner: postgres
--

DROP POLICY IF EXISTS saved_reports_isolation ON saved_reports;
CREATE POLICY saved_reports_isolation ON saved_reports USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

--
-- Name: skills_taxonomy; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE skills_taxonomy ENABLE ROW LEVEL SECURITY;

--
-- Name: sms_log; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE sms_log ENABLE ROW LEVEL SECURITY;

--
-- Name: talent_community; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE talent_community ENABLE ROW LEVEL SECURITY;

--
-- Name: talent_community talent_community_isolation; Type: POLICY; Schema: public; Owner: postgres
--

DROP POLICY IF EXISTS talent_community_isolation ON talent_community;
CREATE POLICY talent_community_isolation ON talent_community USING (((tenant_id)::text = current_setting('app.tenant_id'::text, true)));

--
-- Name: agency_submissions tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

DROP POLICY IF EXISTS tenant_isolation ON agency_submissions;
CREATE POLICY tenant_isolation ON agency_submissions USING ((tenant_id = (current_setting('app.tenant_id'::text, true))::uuid));

--
-- Name: agency_users tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

DROP POLICY IF EXISTS tenant_isolation ON agency_users;
CREATE POLICY tenant_isolation ON agency_users USING ((tenant_id = (current_setting('app.tenant_id'::text, true))::uuid));

--
-- Name: alert_acknowledgments tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

DROP POLICY IF EXISTS tenant_isolation ON alert_acknowledgments;
CREATE POLICY tenant_isolation ON alert_acknowledgments USING ((tenant_id = (current_setting('app.tenant_id'::text, true))::uuid));

--
-- Name: candidate_messages tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

DROP POLICY IF EXISTS tenant_isolation ON candidate_messages;
CREATE POLICY tenant_isolation ON candidate_messages USING ((tenant_id = (current_setting('app.tenant_id'::text, true))::uuid));

--
-- Name: candidate_portal_uploads tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

DROP POLICY IF EXISTS tenant_isolation ON candidate_portal_uploads;
CREATE POLICY tenant_isolation ON candidate_portal_uploads USING ((tenant_id = (current_setting('app.tenant_id'::text, true))::uuid));

--
-- Name: linkedin_captures tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

DROP POLICY IF EXISTS tenant_isolation ON linkedin_captures;
CREATE POLICY tenant_isolation ON linkedin_captures USING ((tenant_id = (current_setting('app.tenant_id'::text, true))::uuid));

--
-- Name: recruiter_client_blocks tenant_isolation; Type: POLICY; Schema: public; Owner: app_user
--

DROP POLICY IF EXISTS tenant_isolation ON recruiter_client_blocks;
CREATE POLICY tenant_isolation ON recruiter_client_blocks USING ((tenant_id = (current_setting('app.tenant_id'::text, true))::uuid));

--
-- Name: recruiter_tasks tenant_isolation; Type: POLICY; Schema: public; Owner: app_user
--

DROP POLICY IF EXISTS tenant_isolation ON recruiter_tasks;
CREATE POLICY tenant_isolation ON recruiter_tasks USING ((tenant_id = (current_setting('app.tenant_id'::text, true))::uuid));

--
-- Name: reference_responses tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

DROP POLICY IF EXISTS tenant_isolation ON reference_responses;
CREATE POLICY tenant_isolation ON reference_responses USING ((EXISTS ( SELECT 1
   FROM reference_checks rc
  WHERE ((rc.id = reference_responses.reference_check_id) AND (rc.tenant_id = (current_setting('app.tenant_id'::text, true))::uuid)))));

--
-- Name: saved_filters tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

DROP POLICY IF EXISTS tenant_isolation ON saved_filters;
CREATE POLICY tenant_isolation ON saved_filters USING ((tenant_id = (current_setting('app.tenant_id'::text, true))::uuid));

--
-- Name: video_questions tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

DROP POLICY IF EXISTS tenant_isolation ON video_questions;
CREATE POLICY tenant_isolation ON video_questions USING ((tenant_id = (current_setting('app.tenant_id'::text, true))::uuid));

--
-- Name: video_responses tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

DROP POLICY IF EXISTS tenant_isolation ON video_responses;
CREATE POLICY tenant_isolation ON video_responses USING ((tenant_id = (current_setting('app.tenant_id'::text, true))::uuid));

--
-- Name: video_screening_tokens tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

DROP POLICY IF EXISTS tenant_isolation ON video_screening_tokens;
CREATE POLICY tenant_isolation ON video_screening_tokens USING ((tenant_id = (current_setting('app.tenant_id'::text, true))::uuid));

--
-- Name: work_sessions tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

DROP POLICY IF EXISTS tenant_isolation ON work_sessions;
CREATE POLICY tenant_isolation ON work_sessions USING ((tenant_id = (current_setting('app.tenant_id'::text, true))::uuid));

--
-- Name: video_questions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE video_questions ENABLE ROW LEVEL SECURITY;

--
-- Name: video_responses; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE video_responses ENABLE ROW LEVEL SECURITY;

--
-- Name: video_screening_tokens; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE video_screening_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: webhook_integrations; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE webhook_integrations ENABLE ROW LEVEL SECURITY;

--
-- Name: work_sessions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE work_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: TABLE agency_submissions; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE agency_submissions TO app_user;

--
-- Name: TABLE agency_users; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE agency_users TO app_user;

--
-- Name: TABLE alert_acknowledgments; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE alert_acknowledgments TO app_user;

--
-- Name: TABLE automation_workflows; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE automation_workflows TO app_user;

--
-- Name: TABLE calendar_events; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE calendar_events TO app_user;

--
-- Name: TABLE candidate_messages; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE candidate_messages TO app_user;

--
-- Name: TABLE candidate_nps; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE candidate_nps TO app_user;

--
-- Name: TABLE candidate_portal_uploads; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE candidate_portal_uploads TO app_user;

--
-- Name: TABLE candidate_status_tokens; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE candidate_status_tokens TO app_user;

--
-- Name: TABLE client_feedback; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE client_feedback TO app_user;

--
-- Name: TABLE client_health_scores; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE client_health_scores TO app_user;

--
-- Name: TABLE client_portal_users; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE client_portal_users TO app_user;

--
-- Name: TABLE compliance_records; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE compliance_records TO app_user;

--
-- Name: TABLE cv_bulk_uploads; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE cv_bulk_uploads TO app_user;

--
-- Name: TABLE email_settings; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE email_settings TO app_user;

--
-- Name: TABLE email_templates; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE email_templates TO app_user;

--
-- Name: TABLE extension_captures; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE extension_captures TO app_user;

--
-- Name: TABLE gdpr_archive_log; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE gdpr_archive_log TO app_user;

--
-- Name: TABLE gdpr_settings; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE gdpr_settings TO app_user;

--
-- Name: TABLE headcount_plans; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE headcount_plans TO app_user;

--
-- Name: TABLE imap_messages; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE imap_messages TO app_user;

--
-- Name: TABLE imap_sync_state; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE imap_sync_state TO app_user;

--
-- Name: TABLE interview_schedules; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE interview_schedules TO app_user;

--
-- Name: TABLE jd_templates; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE jd_templates TO app_user;

--
-- Name: TABLE job_distributions; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE job_distributions TO app_user;

--
-- Name: TABLE job_shares; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE job_shares TO app_user;

--
-- Name: TABLE linkedin_captures; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE linkedin_captures TO app_user;

--
-- Name: TABLE message_drafts; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE message_drafts TO app_user;

--
-- Name: TABLE nurture_executions; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE nurture_executions TO app_user;

--
-- Name: TABLE nurture_sequences; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE nurture_sequences TO app_user;

--
-- Name: TABLE offer_esign_requests; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE offer_esign_requests TO app_user;

--
-- Name: TABLE ollama_cache; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE ollama_cache TO app_user;

--
-- Name: TABLE pipeline_metrics_cache; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE pipeline_metrics_cache TO app_user;

--
-- Name: SEQUENCE pipeline_metrics_cache_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE pipeline_metrics_cache_id_seq TO app_user;

--
-- Name: TABLE pipeline_rules; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE pipeline_rules TO app_user;

--
-- Name: TABLE public_job_applications; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public_job_applications TO app_user;

--
-- Name: TABLE question_bank; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE question_bank TO app_user;

--
-- Name: TABLE reference_checks; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE reference_checks TO app_user;

--
-- Name: TABLE reference_responses; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE reference_responses TO app_user;

--
-- Name: TABLE resume_files; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE resume_files TO app_user;

--
-- Name: TABLE revenue_forecasts; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE revenue_forecasts TO app_user;

--
-- Name: TABLE role_definitions; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE role_definitions TO app_user;

--
-- Name: TABLE salary_benchmarks; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE salary_benchmarks TO app_user;

--
-- Name: TABLE saved_filters; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE saved_filters TO app_user;

--
-- Name: TABLE saved_reports; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE saved_reports TO app_user;

--
-- Name: TABLE skills_taxonomy; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE skills_taxonomy TO app_user;

--
-- Name: TABLE sms_log; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE sms_log TO app_user;

--
-- Name: TABLE talent_community; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE talent_community TO app_user;

--
-- Name: TABLE user_email_accounts; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE user_email_accounts TO app_user;

--
-- Name: TABLE user_signatures; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE user_signatures TO app_user;

--
-- Name: TABLE video_questions; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE video_questions TO app_user;

--
-- Name: TABLE video_responses; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE video_responses TO app_user;

--
-- Name: TABLE video_screening_tokens; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE video_screening_tokens TO app_user;

--
-- Name: TABLE webhook_integrations; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE webhook_integrations TO app_user;

--
-- Name: TABLE work_sessions; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE work_sessions TO app_user;

--
--

