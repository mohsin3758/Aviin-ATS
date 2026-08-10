-- Direct follow-up to the "Recruiter Assignment — Competitive Gap Analysis"
-- report re-check, 2026-08-10. The report named a real gap in passing (not
-- one of its 6 numbered recommendations, but flagged in section 1's body
-- text): "no DB constraint stopping two simultaneous active [assignment]
-- rows". Checking it directly against production turned up something far
-- worse than a theoretical gap: 4 real requisitions with 2-6 simultaneous
-- 'active' assignment rows each (21 rows on one alone), and a live,
-- self-amplifying mechanism causing it.
--
-- Root cause: find_stalled_assignments() returns every 'active' row
-- independently (it has no reason not to - "one active row per req" was
-- never a real invariant). Once ANY requisition had 2+ active rows (from
-- the exact race this report flagged), scheduler.py's SLA escalation job
-- gave EACH one its own independent stale_<assignment_id> alert with its
-- own tier1->tier2 clock. When each one's tier 2 fires (~24h later,
-- scheduler.py:167 SLA_ESCALATION_GRACE_HOURS), do_reassign() correctly
-- marks that ONE row 'reassigned' and creates ONE new 'active' row - but
-- since do_reassign() has no awareness of sibling duplicates for the same
-- requisition, N duplicates become N new duplicates every ~24h cycle
-- instead of shrinking. This has been silently reassigning real
-- requisitions to recruiters at random, roughly daily, since at least
-- 2026-07-27, with zero visibility anywhere in the product.

-- ── 1. Consolidate each corrupted requisition down to one active row ───────
-- Canonical = most recently created active assignment (reflects the
-- latest real reassignment decision the system made); every sibling gets
-- marked 'reassigned' with an honest, non-fabricated note - this is a
-- retroactive data-integrity cleanup, not a real reassignment event, and
-- says so plainly rather than looking like one in the audit trail. Uses
-- UPDATE...RETURNING captured directly into the event insert so this only
-- ever writes a cleanup note for rows THIS migration actually touched -
-- never for rows that were already legitimately 'reassigned' earlier.
DO $$
DECLARE
    r RECORD;
    v_keep UUID;
    v_changed RECORD;
BEGIN
    FOR r IN
        SELECT requisition_id FROM assignments
        WHERE status='active'
        GROUP BY requisition_id HAVING count(*) > 1
    LOOP
        SELECT id INTO v_keep FROM assignments
        WHERE requisition_id = r.requisition_id AND status='active'
        ORDER BY assigned_at DESC, id DESC LIMIT 1;

        FOR v_changed IN
            UPDATE assignments
            SET status='reassigned', updated_at=now()
            WHERE requisition_id = r.requisition_id AND status='active' AND id <> v_keep
            RETURNING id, tenant_id
        LOOP
            INSERT INTO assignment_event (tenant_id, assignment_id, event_type, reason, metadata)
            VALUES (
                v_changed.tenant_id, v_changed.id, 'data_integrity_cleanup',
                'Retroactively marked non-active: this row was a duplicate ''active'' assignment caused by a self-amplifying bug in the SLA tier-2 auto-reassign job (do_reassign() had no awareness that multiple ''active'' rows already existed for this requisition). Not a real reassignment - a data cleanup. Fixed in sql/42_assignments_uniqueness_and_cleanup.sql, 2026-08-10.',
                jsonb_build_object('kept_assignment_id', v_keep, 'cleanup', true)
            );
        END LOOP;
    END LOOP;
END $$;

-- ── 2. Resolve orphaned SLA escalation alerts referencing rows just cleaned up ──
-- Without this, any of these alerts still open with tier2_fired_at IS NULL
-- would try to call do_reassign() on a now-'reassigned' assignment_id on
-- its next grace-period check - harmless after fix #3 below (it would
-- correctly fail closed, caught, logged, and skipped) but pure noise.
UPDATE sla_escalations SET resolved_at = now()
WHERE resolved_at IS NULL
  AND assignment_id IN (
    SELECT assignment_id FROM assignment_event WHERE event_type = 'data_integrity_cleanup'
  );

-- ── 3. The actual fix: make a second simultaneous active row impossible ────
-- Every real INSERT INTO assignments...status='active' path already
-- guards against this in isolation (POST /assignments has an app-level
-- 409 check, do_reassign()/assign_with_explanation() both check-then-act
-- against a single row) - the compounding bug above happened because
-- MULTIPLE independent alerts, each targeting a DIFFERENT already-
-- duplicated assignment_id, each individually passed their own check.
-- A real database constraint is the only thing that closes this for good,
-- for every current and future write path at once.
CREATE UNIQUE INDEX IF NOT EXISTS assignments_one_active_per_requisition
    ON assignments (requisition_id) WHERE status = 'active';
