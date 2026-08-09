-- Follow-up to the "Assessments / Offers / n8n" fresh audit, 2026-08-10 —
-- closes the confirmed HARD RULE #10 bypass on offer acceptance, plus
-- backfills 3 more schema-drifted SECURITY DEFINER functions found while
-- fixing it (offers.py/get_offer_by_signing_token, sign_offer_by_token,
-- accept_offer_by_id all existed live, none were in any committed
-- migration — same pattern documented repeatedly elsewhere in this file).
-- Definitions below for the first two are captured byte-for-byte from the
-- live schema via pg_get_functiondef(); accept_offer_by_id gets one real
-- change on top of the honest capture — see below.

CREATE OR REPLACE FUNCTION public.get_offer_by_signing_token(p_token text)
 RETURNS TABLE(final_text text, draft_text text, status text, candidate_name text, job_title text, company_name text, ctc_offered numeric, joining_date date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
    SELECT ol.final_text, ol.draft_text, ol.status,
           c.full_name, r.title, t.name, o.ctc_offered, o.joining_date
    FROM offer_letters ol
    JOIN offers o ON o.id = ol.offer_id
    JOIN applications a ON a.id = o.application_id
    JOIN candidates c ON c.id = a.candidate_id
    JOIN requisitions r ON r.id = a.requisition_id
    JOIN tenants t ON t.id = ol.tenant_id
    WHERE ol.signing_token = p_token
    LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.sign_offer_by_token(p_token text, p_name text)
 RETURNS TABLE(offer_id uuid, tenant_id uuid)
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
    UPDATE offer_letters
    SET status = 'e_signed', signed_at = now(), signatory_name = p_name, signing_token = NULL
    WHERE signing_token = p_token AND status = 'sent'
    RETURNING offer_id, tenant_id;
$function$;

-- THE FIX: the live version had no WHERE clause at all — it would flip
-- ANY offer straight to 'accepted' regardless of current status, which is
-- exactly how a real production offer ended up 'accepted' with an empty
-- approved_by and zero assignment_event/audit_log rows (confirmed via the
-- audit: offer 003a796d... was e-signed and accepted despite never having
-- gone through /approve or /issue). Now requires status='issued' first,
-- matching the same guard respond_offer() already enforces for the
-- internal-authenticated accept path (offers.py:144-168) — the public
-- e-sign path should never have been held to a looser standard than the
-- authenticated one.
-- CREATE OR REPLACE can't change a function's return type (void -> boolean
-- here) — confirmed live on first deploy attempt ("cannot change return
-- type of existing function"). Drop first, matching the hint.
DROP FUNCTION IF EXISTS public.accept_offer_by_id(uuid);

CREATE FUNCTION public.accept_offer_by_id(p_offer_id uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
    UPDATE offers SET status='accepted', updated_at=now()
    WHERE id=p_offer_id AND status='issued'
    RETURNING true;
$function$;

-- Second real gap closed alongside the HITL fix: nothing anywhere in this
-- codebase ever inserted into `placements` on offer acceptance (grepped
-- the whole backend — zero matches). offers.py's respond_offer() now does
-- this. A real unique constraint on offer_id (checked first: zero existing
-- duplicates in production) makes the INSERT's `ON CONFLICT (offer_id) DO
-- NOTHING` a genuine no-op-on-retry rather than the same "no matching
-- constraint so it never fires" bug already found and fixed once this
-- project (retention_bank, sql/36...sql) — the offers-table status guard
-- above already makes double-firing this code path essentially impossible
-- in practice, but this is defense-in-depth, not the only thing preventing
-- a duplicate placement per offer.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'placements_offer_id_key'
    ) THEN
        ALTER TABLE placements ADD CONSTRAINT placements_offer_id_key UNIQUE (offer_id);
    END IF;
END $$;
