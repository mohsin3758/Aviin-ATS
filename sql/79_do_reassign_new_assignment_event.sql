-- Real bug found via genuine end-to-end testing of the Assignment Dashboard
-- (2026-08-24), not code review: do_reassign() wrote an assignment_event
-- for the OLD assignment row (event_type='reassigned') but never wrote one
-- for the NEW assignment row it creates — confirmed live against a real
-- production assignment (khan mer / Associate Managing Consultant - SAP
-- FICO), which genuinely had ZERO assignment_event rows despite being an
-- active, real assignment. This meant the dashboard's AI-vs-Manual
-- detection (reads assignment_event.metadata->>'reason') silently
-- defaulted every reassigned-into assignment to "Manual", even ones made
-- via "Auto-Reassign (AI)" — an incorrect label, not just a missing one.
--
-- Real function definition pulled byte-for-byte via pg_get_functiondef()
-- first (do_reassign is schema-drifted -- no committed CREATE FUNCTION
-- anywhere in sql/*.sql -- confirmed by grep before writing this), not
-- reconstructed from memory. Only addition: one new INSERT tied to the
-- new assignment id, with a reason that distinguishes auto-picked
-- (p_new_recruiter_id IS NULL, i.e. Auto-Reassign) from explicitly-
-- specified (manual Reassign) -- same 'auto_assigned'/'manually_assigned'
-- reason convention create_assignment()/assign_with_explanation() already
-- use, with a "_re" suffix so history can still tell an initial assign
-- apart from a reassignment.
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

  -- REAL FIX (2026-08-24): the new assignment row previously had zero
  -- assignment_event rows of its own -- confirmed live before this fix.
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
