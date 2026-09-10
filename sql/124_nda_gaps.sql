-- Fix 5 of 5 real gaps in the NDA e-sign process (2026-09-10, reported
-- live: "anything missing in this process?" -> "complete all gaps and
-- build it"). See backend/routers/nda.py and backend/scheduler.py for
-- the other four (resend guard, real expiry, earlier missing-NDA nudge,
-- is_active filtering).
--
-- Adds a place to store a real captured PDF at the moment of e-signing,
-- instead of only ever regenerating one on demand from final_text (which
-- works today only because final_text rarely changes after signing, and
-- leaves no true "certificate of record" the way the existing manual-
-- upload path already has via manual_file_path).
ALTER TABLE nda_documents ADD COLUMN IF NOT EXISTS signed_snapshot_path TEXT;

-- MUST be owned by postgres, same reason as the other 4 functions in
-- sql/12_nda_esign.sql (SECURITY DEFINER on a FORCE RLS table needs a
-- BYPASSRLS owner, or the public /sign-nda/{token} flow 500s). Narrowly
-- scoped: only writes when status is already 'e_signed' by the SAME
-- signing_token that just succeeded via sign_nda_by_token(), so this
-- can only ever attach a snapshot to the signature that was just made,
-- never retroactively to an older or different one.
CREATE OR REPLACE FUNCTION public.set_nda_signed_snapshot_by_token(p_token text, p_path text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
    UPDATE nda_documents
    SET signed_snapshot_path = p_path
    WHERE signing_token = p_token AND status = 'e_signed'
    RETURNING true;
$function$;

ALTER FUNCTION public.set_nda_signed_snapshot_by_token(text, text) OWNER TO postgres;

-- sign_nda_by_token() (sql/74) didn't return the row's own id, which the
-- Python signing endpoint now needs to name the snapshot file it saves
-- right after a successful sign. Same body otherwise, unchanged. Postgres
-- won't let CREATE OR REPLACE change a function's return columns, hence
-- the explicit DROP first.
DROP FUNCTION IF EXISTS public.sign_nda_by_token(text, text);
CREATE FUNCTION public.sign_nda_by_token(p_token text, p_name text)
 RETURNS TABLE(id uuid, application_id uuid, tenant_id uuid, candidate_id uuid)
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
    UPDATE nda_documents
    SET status = 'e_signed', signed_at = now(), signatory_name = p_name,
        otp_code = NULL, otp_expires_at = NULL
    WHERE signing_token = p_token AND status = 'sent'
    RETURNING id, application_id, tenant_id, candidate_id;
$function$;

ALTER FUNCTION public.sign_nda_by_token(text, text) OWNER TO postgres;
