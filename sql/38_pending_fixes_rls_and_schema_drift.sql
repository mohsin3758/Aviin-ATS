-- Follow-up to "whats next?" check, 2026-08-09 — closes the 3 real,
-- previously-flagged-but-unfixed items still open in this project:
--   1. candidate_messages had NO row-level security at all
--      (relrowsecurity=false), despite carrying real candidate-facing
--      email/WhatsApp content, tenant-scoped only by every query
--      individually remembering a WHERE tenant_id=... clause.
--   2. (frontend-only fix, no SQL — recruiter-ops TargetsTab hydration bug)
--   3. Schema-drift backfill: v_sla_dashboard, v_pipeline_velocity,
--      v_monthly_billing (views), recruiter_targets, and sla_tracking
--      (found as an undocumented dependency of v_sla_dashboard while
--      pulling its real definition) all exist live in production but were
--      never captured in any committed migration — a fresh environment
--      built from git alone wouldn't have them. Every definition below was
--      pulled directly from the live production schema via
--      pg_get_viewdef()/\d, not reconstructed from memory — an earlier
--      draft of this file guessed plausible-looking definitions instead
--      and every single one was wrong in some way once checked against
--      the real schema, confirming that was the right call.

-- ── 1. candidate_messages RLS ───────────────────────────────────────────
-- The only caller that doesn't already go through tenant_conn(actor.
-- tenant_id) is the anonymous email-open tracking pixel
-- (communications.py's GET /track/open/{token}.gif — the recipient's own
-- email client fetches it, not the ATS, so there's no tenant_id to set).
-- Same shape as every other anonymous/token-based flow in this codebase
-- (NDA/offer e-sign, device enrollment): a SECURITY DEFINER function
-- owned by postgres bypasses RLS for that one specific, token-scoped
-- write, everything else stays tenant-isolated for real.
ALTER TABLE candidate_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON candidate_messages;
CREATE POLICY tenant_isolation ON candidate_messages
    USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);

-- IMPORTANT: must be created as the `postgres` superuser (this migration
-- is run that way in this project's deploy process) so SECURITY DEFINER
-- actually bypasses FORCE ROW LEVEL SECURITY — same requirement documented
-- in sql/12_nda_esign.sql for the identical reason.
CREATE OR REPLACE FUNCTION public.record_email_open(p_token text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
    UPDATE candidate_messages
    SET email_opened_at = COALESCE(email_opened_at, now()),
        email_open_count = email_open_count + 1
    WHERE tracking_token = p_token::uuid;
$function$;

-- ── 3. Schema-drift backfill ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recruiter_targets (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    recruiter_id        UUID NOT NULL REFERENCES users(id),
    period_month        SMALLINT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
    period_year         SMALLINT NOT NULL CHECK (period_year BETWEEN 2020 AND 2099),
    target_submissions  INTEGER NOT NULL DEFAULT 0,
    target_interviews   INTEGER NOT NULL DEFAULT 0,
    target_placements   INTEGER NOT NULL DEFAULT 0,
    target_work_hours   INTEGER NOT NULL DEFAULT 0,
    notes               TEXT,
    created_by          UUID REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, recruiter_id, period_month, period_year)
);
CREATE INDEX IF NOT EXISTS idx_rt_recruiter ON recruiter_targets(recruiter_id);
CREATE INDEX IF NOT EXISTS idx_rt_tenant ON recruiter_targets(tenant_id);
ALTER TABLE recruiter_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruiter_targets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_recruiter_targets ON recruiter_targets;
CREATE POLICY rls_recruiter_targets ON recruiter_targets
    USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);
GRANT ALL ON recruiter_targets TO app_user;

CREATE TABLE IF NOT EXISTS sla_tracking (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    requisition_id         UUID NOT NULL REFERENCES requisitions(id),
    first_submission_at    TIMESTAMPTZ,
    time_to_first_sub_hrs  NUMERIC(6,2),
    first_interview_at     TIMESTAMPTZ,
    time_to_interview_hrs  NUMERIC(6,2),
    first_offer_at         TIMESTAMPTZ,
    time_to_offer_hrs      NUMERIC(6,2),
    placement_at           TIMESTAMPTZ,
    time_to_fill_days      NUMERIC(6,1),
    sla_target_days        INTEGER DEFAULT 30,
    sla_breached           BOOLEAN DEFAULT false,
    created_at             TIMESTAMPTZ DEFAULT now(),
    updated_at             TIMESTAMPTZ DEFAULT now(),
    UNIQUE (tenant_id, requisition_id)
);
ALTER TABLE sla_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_tracking FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_sla ON sla_tracking;
CREATE POLICY rls_sla ON sla_tracking
    USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);
GRANT ALL ON sla_tracking TO app_user;

-- v_sla_dashboard backs the real, live SLA Dashboard page (GET /sla,
-- GET /sla/summary in p23_p27.py) — captured here with one disclosed fix
-- on top of the honest capture: the live definition filtered interviews/
-- hires with `a.stage = 'interview'` / `a.stage = 'hired'`, neither of
-- which is a real stage value in this system (real ones are
-- l1_interview/l2_interview/l3_interview and placed) — the exact same
-- hardcoded-stage-key bug class already found and fixed in
-- recruiter-performance, hiring-funnel, and several other endpoints
-- earlier in this project, just never caught here because this view only
-- ever lived in the database, invisible to a .py-file grep. Confirmed via
-- the real frontend (frontend/app/(dashboard)/sla/page.tsx) that
-- interviews/offers/hires are genuinely displayed (PipelineDots) and
-- CSV-exported on that live page — this was silently always showing 0
-- interviews/hires for every requisition. sla_tracking itself is confirmed
-- fully orphaned (grepped the whole backend — zero writers, zero readers
-- besides this view), so its columns still always fall back to the
-- view's own COALESCE defaults; that's a separate, unbuilt feature
-- (nothing ever populates first_submission_at etc.), not something this
-- backfill invents new behavior for.
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
     LEFT JOIN sla_tracking st ON st.requisition_id = r.id AND st.tenant_id = r.tenant_id
  GROUP BY r.id, r.tenant_id, r.title, r.created_at, r.status, st.time_to_first_sub_hrs, st.time_to_fill_days, st.sla_target_days, st.sla_breached;

CREATE OR REPLACE VIEW v_pipeline_velocity AS
 SELECT tenant_id,
    stage,
    count(*) AS count,
    round(avg(EXTRACT(epoch FROM now() - updated_at) / 86400::numeric), 1) AS avg_days_in_stage,
    count(*) FILTER (WHERE (EXTRACT(epoch FROM now() - updated_at) / 86400::numeric) > 7::numeric) AS stale_count
   FROM applications a
  GROUP BY tenant_id, stage;

CREATE OR REPLACE VIEW v_monthly_billing AS
 SELECT p.tenant_id,
    EXTRACT(month FROM p.start_date)::integer AS month,
    EXTRACT(year FROM p.start_date)::integer AS year,
    count(DISTINCT p.id) AS placements,
    COALESCE(sum(p.bill_rate * 30::numeric), 0::numeric) AS estimated_revenue,
    count(DISTINCT p.candidate_id) AS candidates_placed,
    count(DISTINCT r.id) AS roles_filled
   FROM placements p
     LEFT JOIN requisitions r ON r.id = p.requisition_id
  WHERE p.start_date IS NOT NULL
  GROUP BY p.tenant_id, (EXTRACT(month FROM p.start_date)::integer), (EXTRACT(year FROM p.start_date)::integer)
  ORDER BY (EXTRACT(year FROM p.start_date)::integer) DESC, (EXTRACT(month FROM p.start_date)::integer) DESC;
