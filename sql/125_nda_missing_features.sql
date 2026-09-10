-- 5 more real gaps in the NDA e-sign process (2026-09-10, reported live:
-- "go deep check and if any features and option is missing in this" ->
-- "complete the all gaps and build it"). See backend/routers/nda.py and
-- backend/scheduler.py for the implementations.

-- 1) The signing page (frontend/app/sign-nda/[token]/page.tsx) tells
-- every candidate "Your IP and timestamp will be recorded" -- timestamp
-- was real (signed_at), IP never was. Standard e-sign evidentiary data,
-- now actually captured.
ALTER TABLE nda_documents ADD COLUMN IF NOT EXISTS ip_address TEXT;
ALTER TABLE nda_documents ADD COLUMN IF NOT EXISTS user_agent TEXT;

-- 5) Lightweight engagement/audit trail: proof the candidate actually
-- opened the link before signing (or never opened it at all, a real,
-- different situation from "opened but hasn't signed yet").
ALTER TABLE nda_documents ADD COLUMN IF NOT EXISTS first_viewed_at TIMESTAMPTZ;

-- 3) Idempotency marker for the new candidate-facing reminder job
-- (process_nda_candidate_reminders in scheduler.py) -- without this a
-- daily job would re-email the candidate every single day it's due.
ALTER TABLE nda_documents ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

-- 2) No way to void/cancel an NDA today -- once sent, the only paths are
-- sign, resend, or wait out the 14-day auto-expiry. A role falling
-- through or a candidate getting rejected mid-process has nowhere for
-- the recruiter to close this out explicitly.
ALTER TABLE nda_documents DROP CONSTRAINT IF EXISTS nda_documents_status_check;
ALTER TABLE nda_documents ADD CONSTRAINT nda_documents_status_check
  CHECK (status IN ('draft','sent','e_signed','manually_signed','expired','voided'));

-- Records that a signing link was opened at least once, without
-- disturbing anything else on the row. Separate from get_nda_by_signing_
-- token (kept STABLE/pure-read) since a read endpoint silently writing
-- is the wrong shape for that function; called as its own best-effort
-- step right after. MUST be owned by postgres, same FORCE RLS +
-- SECURITY DEFINER reasoning as every other function in this file.
CREATE OR REPLACE FUNCTION public.mark_nda_viewed_by_token(p_token text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
    UPDATE nda_documents
    SET first_viewed_at = COALESCE(first_viewed_at, now())
    WHERE signing_token = p_token AND status = 'sent';
$function$;

ALTER FUNCTION public.mark_nda_viewed_by_token(text) OWNER TO postgres;

-- sign_nda_by_token (sql/74, then sql/124) now also captures ip/user_agent
-- at the moment of signing -- adding params changes the function's
-- identity (name + input types), so CREATE OR REPLACE would silently
-- create a second overload instead of truly replacing it; DROP first.
DROP FUNCTION IF EXISTS public.sign_nda_by_token(text, text);
CREATE FUNCTION public.sign_nda_by_token(p_token text, p_name text, p_ip text DEFAULT NULL, p_user_agent text DEFAULT NULL)
 RETURNS TABLE(id uuid, application_id uuid, tenant_id uuid, candidate_id uuid)
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
    UPDATE nda_documents
    SET status = 'e_signed', signed_at = now(), signatory_name = p_name,
        otp_code = NULL, otp_expires_at = NULL,
        ip_address = p_ip, user_agent = p_user_agent
    WHERE signing_token = p_token AND status = 'sent'
    RETURNING id, application_id, tenant_id, candidate_id;
$function$;

ALTER FUNCTION public.sign_nda_by_token(text, text, text, text) OWNER TO postgres;
