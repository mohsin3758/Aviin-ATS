-- Fix: Offer Letter e-sign "already signed" state was unreachable — the
-- identical dead-code bug already fixed for NDA e-sign in sql/74, found by
-- checking whether the same root cause existed elsewhere in this codebase
-- (it was explicitly flagged as a real, un-fixed gap when sql/74 landed).
--
-- sign_offer_by_token() nulled offer_letters.signing_token on success, but
-- get_offer_by_signing_token() (called by GET /offer-sign/public, which the
-- public /sign-offer/{token} page re-hits on every load/reload) looks the
-- row up BY that same token — once it's null, the lookup finds nothing
-- and returns a 404 "Invalid or expired link" instead of the intended
-- "Already Signed" message, even though offers.py's own
-- get_offer_for_signing() already has correct handling for
-- status='e_signed' that could never be reached.
--
-- Fix: stop nulling signing_token on sign, same reasoning as sql/74 — the
-- UPDATE's own "AND status='sent'" guard already makes the SIGN action
-- itself correctly single-use (a replay with the same token matches zero
-- rows once status is no longer 'sent'), so nulling the token added no
-- real security benefit — it just broke the read-only "view what I
-- signed" path for anyone who revisits the link afterward.
CREATE OR REPLACE FUNCTION public.sign_offer_by_token(p_token text, p_name text)
 RETURNS TABLE(offer_id uuid, tenant_id uuid)
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
    UPDATE offer_letters
    SET status = 'e_signed', signed_at = now(), signatory_name = p_name
    WHERE signing_token = p_token AND status = 'sent'
    RETURNING offer_id, tenant_id;
$function$;
