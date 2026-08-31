-- 98_multi_recruiter_assignment.sql
-- Real feature add (2026-08-31): "Not able to assign both recruiter to
-- same job requisition, i want option to select to both or more to work
-- on the same job 2 to more recruiter" - reported live.
--
-- assignments_one_active_per_requisition (added 2026-08-10 to fix a
-- real, severe self-amplifying data-corruption bug — see that date's
-- own CLAUDE.md entry) enforced strictly ONE active assignment per
-- requisition, full stop, no exceptions. That bug's actual mechanism
-- was a RACE in assignment-creation code letting a requisition end up
-- with 2+ DUPLICATE active rows by accident, which the SLA-escalation
-- job then compounded by reassigning each duplicate independently,
-- each reassignment creating a fresh duplicate rather than shrinking
-- toward one. The constraint fixed that by making duplicate active
-- rows structurally impossible.
--
-- Relaxed here, not removed: uniqueness now scopes to
-- (requisition_id, recruiter_id) instead of bare (requisition_id) -
-- the SAME recruiter still cannot hold two simultaneous active rows on
-- the same requisition (closing off the exact original race), but two
-- DIFFERENT recruiters can now each hold their own real, distinct
-- active assignment on the same job - a deliberate, new capability,
-- not a reopening of the old bug's mechanism.
--
-- do_reassign()'s auto-pick branch is also updated in the same
-- migration: it excluded only the ONE recruiter being reassigned when
-- picking a replacement, which could now try to "reassign" one
-- co-recruiter's slot onto a recruiter who already holds a DIFFERENT
-- active slot on the same requisition - previously impossible, now
-- would hit the new unique constraint. Fixed to exclude every
-- currently-active recruiter on the requisition, not just the one
-- being replaced.
--
-- MUST be run as postgres — assignments/do_reassign are postgres-owned
-- (confirmed via the same schema-drift pattern documented repeatedly
-- elsewhere in this project), and CREATE OR REPLACE FUNCTION can't
-- change a return signature, but do_reassign's signature is unchanged
-- here so a plain REPLACE is safe.

DROP INDEX IF EXISTS assignments_one_active_per_requisition;

CREATE UNIQUE INDEX IF NOT EXISTS assignments_one_active_per_req_recruiter
    ON assignments (requisition_id, recruiter_id) WHERE (status = 'active');

CREATE OR REPLACE FUNCTION public.do_reassign(p_assignment_id uuid, p_reason text, p_new_recruiter_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(old_assignment_id uuid, new_assignment_id uuid, old_recruiter_id uuid, new_recruiter_id uuid, new_recruiter_name text, match_score numeric, explanation jsonb)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_old           RECORD;
  v_pick          RECORD;
  v_new_id        UUID;
  v_new_recruiter UUID;
  v_match_score   NUMERIC;
  v_name          TEXT;
  v_was_auto      BOOLEAN;
BEGIN
  SELECT * INTO v_old FROM assignments WHERE id = p_assignment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment % not found or not accessible', p_assignment_id;
  END IF;
  IF v_old.status <> 'active' THEN
    RAISE EXCEPTION 'Assignment % is ''%'', expected ''active''', p_assignment_id, v_old.status;
  END IF;

  v_was_auto := p_new_recruiter_id IS NULL;

  IF p_new_recruiter_id IS NOT NULL THEN
    v_new_recruiter := p_new_recruiter_id;
    v_match_score := v_old.match_score;
    SELECT full_name INTO v_name FROM users WHERE id = v_new_recruiter;
  ELSE
    -- REAL FIX (2026-08-31, multi-recruiter assignment): excludes every
    -- currently-active recruiter on this requisition, not just the one
    -- being reassigned — a real co-recruiter setup means the auto-pick
    -- must never suggest someone who already holds a different active
    -- slot on the same job (the new unique index would reject the
    -- resulting INSERT).
    SELECT * INTO v_pick FROM match_recruiters(v_old.requisition_id, 5) mr
      WHERE mr.recruiter_id NOT IN (
        SELECT recruiter_id FROM assignments
        WHERE requisition_id = v_old.requisition_id AND status = 'active'
      )
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

  INSERT INTO assignment_event (tenant_id, assignment_id, event_type, reason, metadata)
  VALUES (v_old.tenant_id, v_new_id, 'assigned', p_reason,
    jsonb_build_object(
      'reason', CASE WHEN v_was_auto THEN 'auto_assigned_re' ELSE 'manually_assigned_re' END,
      'from_assignment_id', p_assignment_id,
      'from_recruiter_id', v_old.recruiter_id,
      'match_score', v_match_score,
      'auto_picked', v_was_auto
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
$function$;
