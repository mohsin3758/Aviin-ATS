-- Multi-select Employment Type (+ new "FL Contract" value) / Work Mode /
-- Shift Timing (tenant-configurable presets, region + real time range),
-- plus a much richer Auto-Assign explanation and manual-assign role/UX
-- parity with it.
--
-- MUST be run as postgres: assign_with_explanation() is owned by
-- postgres (same schema-drift/SECURITY-DEFINER-adjacent ownership
-- pattern documented repeatedly elsewhere in this project), not app_user.

-- ── Requisitions: real multi-select columns, legacy scalar kept for the
-- many existing display call sites (dashboard cards, Companies page,
-- public career pages, GlobalSearch, Job Sharing) that read
-- employment_type/work_mode as a single string - none of those are
-- being touched today, so the scalar stays populated as "the first
-- selected value" rather than forcing a rewrite of every read site. ──
ALTER TABLE requisitions
    ADD COLUMN IF NOT EXISTS employment_types TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS work_modes TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS shift_timing_ids UUID[] NOT NULL DEFAULT '{}';

-- Backfill the new arrays from whatever the existing scalar columns hold
-- today, for every existing row - a real, one-time data migration, not
-- just a column add. Deliberately does not touch shift_type (a
-- different, coarser concept - day/night/rotational/flexible - being
-- left alone, not migrated into the new region+time-range system).
UPDATE requisitions SET employment_types = ARRAY[employment_type]
    WHERE employment_types = '{}' AND employment_type IS NOT NULL;
UPDATE requisitions SET work_modes = ARRAY[work_mode]
    WHERE work_modes = '{}' AND work_mode IS NOT NULL;

-- Real, pre-existing bug found while auditing this column (2026-08-24):
-- the DB CHECK only ever allowed 4 employment_type values, but
-- backend/schemas.py's Literal and the frontend's own dropdown already
-- offered a 5th ("part_time") - selecting it and saving would have hit
-- a live CHECK-constraint violation. Fixed here, alongside adding the
-- new "fl_contract" (FL Contract / Freelance Contract) value asked for.
ALTER TABLE requisitions DROP CONSTRAINT IF EXISTS requisitions_employment_type_check;
ALTER TABLE requisitions ADD CONSTRAINT requisitions_employment_type_check
    CHECK (employment_type IN ('contract','fulltime','c2h','fte','part_time','fl_contract'));
ALTER TABLE requisitions DROP CONSTRAINT IF EXISTS requisitions_employment_types_check;
ALTER TABLE requisitions ADD CONSTRAINT requisitions_employment_types_check
    CHECK (employment_types <@ ARRAY['contract','fulltime','c2h','fte','part_time','fl_contract']::text[]);
ALTER TABLE requisitions DROP CONSTRAINT IF EXISTS requisitions_work_modes_check;
ALTER TABLE requisitions ADD CONSTRAINT requisitions_work_modes_check
    CHECK (work_modes <@ ARRAY['remote','onsite','hybrid']::text[]);

CREATE INDEX IF NOT EXISTS idx_req_employment_types ON requisitions USING GIN (employment_types);
CREATE INDEX IF NOT EXISTS idx_req_work_modes ON requisitions USING GIN (work_modes);

-- ── shift_timings: tenant-configurable named presets (region + a real
-- time range), matching this codebase's own established pattern for
-- tenant-managed reference lists (rejection_reasons, sla_tier_config,
-- tracking_sheet_templates) rather than a hardcoded, code-change-only
-- dropdown. ──
CREATE TABLE IF NOT EXISTS shift_timings (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    label       TEXT NOT NULL,
    region      TEXT NOT NULL,       -- e.g. "UK", "US", "India" - free text, not enum-constrained (regions vary per tenant)
    start_time  TIME NOT NULL,
    end_time    TIME NOT NULL,
    timezone_label TEXT,             -- e.g. "IST", "GMT", "EST" - display-only, no real tz math performed
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_by  UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shift_timings_tenant ON shift_timings(tenant_id);

ALTER TABLE shift_timings ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_timings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON shift_timings;
CREATE POLICY tenant_isolation ON shift_timings
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Seed 3 real, immediately-usable presets per tenant, matching the exact
-- examples given in the request (9am-6pm, 2pm-8pm, tied to UK/US) - same
-- "ships with a sensible real default, not an empty list" precedent as
-- every other tenant-configurable reference table in this project.
DO $$
DECLARE
    t RECORD;
BEGIN
    FOR t IN SELECT id FROM tenants LOOP
        PERFORM set_config('app.tenant_id', t.id::text, true);
        IF NOT EXISTS (SELECT 1 FROM shift_timings x WHERE x.tenant_id = t.id) THEN
            INSERT INTO shift_timings (tenant_id, label, region, start_time, end_time, timezone_label) VALUES
                (t.id, 'India Day Shift', 'India', '09:00', '18:00', 'IST'),
                (t.id, 'UK Shift',        'UK',    '14:00', '20:00', 'IST'),
                (t.id, 'US Shift',        'US',    '18:30', '03:30', 'IST');
        END IF;
    END LOOP;
    PERFORM set_config('app.tenant_id', '', true);
END $$;

-- ── Auto-Assign: widen the explanation from a thin 4-field subset to
-- the FULL factor breakdown match_recruiters() already computes (it was
-- being silently dropped before reaching assignment_event/the API
-- response), plus a real, computed workload_label (High/Medium/Low)
-- derived from the same available_capacity/capacity_weekly numbers
-- already being returned - no new tracking invented, reusing exactly
-- what "the old database" already has, per the request. ──
CREATE OR REPLACE FUNCTION public.assign_with_explanation(p_req_id uuid)
 RETURNS TABLE(assignment_id uuid, requisition_id uuid, recruiter_id uuid, recruiter_name text, match_score numeric, newly_created boolean, explanation jsonb)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_tenant     UUID;
  v_status     TEXT;
  v_existing   RECORD;
  v_pick       RECORD;
  v_new_id     UUID;
  v_workload   TEXT;
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

  v_workload := CASE
    WHEN v_pick.capacity_weekly IS NULL OR v_pick.capacity_weekly = 0 THEN 'High'
    WHEN v_pick.available_capacity::numeric / v_pick.capacity_weekly >= 0.6 THEN 'Low'
    WHEN v_pick.available_capacity::numeric / v_pick.capacity_weekly >= 0.3 THEN 'Medium'
    ELSE 'High'
  END;

  INSERT INTO assignments (tenant_id, requisition_id, recruiter_id, status, match_score)
  VALUES (v_tenant, p_req_id, v_pick.recruiter_id, 'active', v_pick.match_score)
  RETURNING id INTO v_new_id;

  INSERT INTO assignment_event (tenant_id, assignment_id, event_type, reason, metadata)
  VALUES (v_tenant, v_new_id, 'assigned', 'auto-assigned via assign_with_explanation',
    jsonb_build_object(
      'match_score', v_pick.match_score,
      'skill_match_count', v_pick.skill_match_count,
      'available_capacity', v_pick.available_capacity,
      'active_assignments_before', v_pick.active_assignments,
      'capacity_weekly', v_pick.capacity_weekly,
      'on_leave', v_pick.on_leave,
      'location_match', v_pick.location_match,
      'has_prior_client_relationship', v_pick.has_prior_client_relationship,
      'tenure_months', v_pick.tenure_months,
      'performance_score', v_pick.performance_score,
      'workload_label', v_workload
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
      'active_assignments_before', v_pick.active_assignments,
      'capacity_weekly', v_pick.capacity_weekly,
      'on_leave', v_pick.on_leave,
      'location_match', v_pick.location_match,
      'has_prior_client_relationship', v_pick.has_prior_client_relationship,
      'tenure_months', v_pick.tenure_months,
      'performance_score', v_pick.performance_score,
      'workload_label', v_workload
    );
END;
$function$;
