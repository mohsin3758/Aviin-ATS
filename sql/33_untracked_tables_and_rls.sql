-- stage_rules, pipeline_movements, and candidate_activities have existed
-- live in production for a long time (used throughout pipeline_p2.py,
-- applications.py, p23_p27.py, scheduler.py) but were never captured in
-- any committed migration — a real gap in schema version control found
-- during a pipeline/candidates audit: rebuilding this DB from sql/*.sql
-- alone would silently miss all three. IF NOT EXISTS makes this a no-op
-- everywhere they already exist; the CREATE TABLE statements below are
-- copied verbatim from `pg_dump --schema-only` against production, not
-- reconstructed by hand.
--
-- pipeline_movements and stage_rules also had NO row-level security at
-- all (relrowsecurity=false) despite being tenant-scoped and owned by
-- postgres, not app_user — every read/write relied entirely on the
-- application always remembering a WHERE tenant_id=... clause, with no
-- DB-level backstop. Same class of gap found and fixed repeatedly
-- elsewhere in this project (saved_filters, agency_users, work_sessions,
-- round 2 audit). candidate_activities already had FORCE RLS.

CREATE TABLE IF NOT EXISTS stage_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    tenant_id uuid NOT NULL,
    name character varying(200),
    stage_from character varying(50),
    stage_to character varying(50),
    conditions jsonb DEFAULT '[]'::jsonb,
    action character varying(50) DEFAULT 'move'::character varying,
    enabled boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pipeline_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    tenant_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    application_id uuid,
    stage_from character varying(50),
    stage_to character varying(50),
    reason character varying(100) DEFAULT 'auto_rule'::character varying,
    triggered_by character varying(255) DEFAULT 'rule_engine'::character varying,
    created_at timestamp without time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS candidate_activities (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    candidate_id uuid NOT NULL REFERENCES candidates(id),
    user_id uuid REFERENCES users(id),
    activity_type character varying(30) NOT NULL,
    title text NOT NULL,
    description text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT candidate_activities_activity_type_check CHECK (
        (activity_type)::text = ANY ((ARRAY[
            'note','email_sent','status_change','interview_scheduled',
            'offer_made','call_logged','document_uploaded','whatsapp_sent',
            'assessment_sent'
        ])::character varying[]::text[])
    )
);

ALTER TABLE candidate_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_activities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_ca ON candidate_activities;
CREATE POLICY rls_ca ON candidate_activities
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);

ALTER TABLE pipeline_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_movements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pipeline_movements;
CREATE POLICY tenant_isolation ON pipeline_movements
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);

ALTER TABLE stage_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE stage_rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON stage_rules;
CREATE POLICY tenant_isolation ON stage_rules
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);

-- NOTE: scheduler.py's run_pipeline_auto_move() previously read/wrote
-- stage_rules/pipeline_movements through db.system_conn() (app.tenant_id
-- =''), which would now hard-crash on the ::uuid cast above (same bug
-- class as send_weekly_kpi_summary, documented in CLAUDE.md) — fixed in
-- the same change as this migration by switching that function to a real
-- per-tenant tenant_conn(), not here.
