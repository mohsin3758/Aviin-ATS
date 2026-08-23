-- Fix: NDA e-sign "already signed" state was unreachable.
--
-- sign_nda_by_token() nulled nda_documents.signing_token on success, but
-- get_nda_by_signing_token() (called by GET /nda-sign/public, which the
-- signing page re-hits on every load/reload) looks the row up BY that
-- same token — once it's null, the lookup finds nothing and the page
-- shows "Invalid or Expired Link" instead of the intended "Already
-- Signed" message, even though nda.py's own get_nda_for_signing()
-- already has correct handling for status='e_signed' that could never
-- be reached.
--
-- Fix: stop nulling signing_token on sign. The UPDATE's own
-- "AND status='sent'" guard already makes the SIGN action itself
-- correctly single-use (a replay with the same token matches zero rows
-- once status is no longer 'sent'), so nulling the token added no real
-- security benefit — it just broke the read-only "view what I signed"
-- path for anyone who revisits the link afterward.
CREATE OR REPLACE FUNCTION public.sign_nda_by_token(p_token text, p_name text)
 RETURNS TABLE(application_id uuid, tenant_id uuid, candidate_id uuid)
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
    UPDATE nda_documents
    SET status = 'e_signed', signed_at = now(), signatory_name = p_name,
        otp_code = NULL, otp_expires_at = NULL
    WHERE signing_token = p_token AND status = 'sent'
    RETURNING application_id, tenant_id, candidate_id;
$function$;
