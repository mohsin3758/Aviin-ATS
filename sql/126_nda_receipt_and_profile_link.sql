-- 2 more real gaps in the NDA process (2026-09-10, third pass of "check
-- again if missing any features and option in this"):
--
-- 1) The candidate profile page and Resume Inbox drawer STILL never
-- showed the real e-signature status -- this was the very first gap
-- identified in this whole investigation ("how NDA are connected with
-- candidates database... option to check NDA signed... in candidate
-- box/folder and resume inbox") and got sidetracked into bug-fixing
-- before it was ever actually built. See backend/routers/candidates.py
-- and resume_intake.py.
--
-- 2) A candidate who e-signs gets a "Signed!" page and nothing else --
-- no way to ever retrieve a copy of what they agreed to again, and no
-- receipt emailed to them (compare: every real e-sign platform emails
-- the signer their own copy). See backend/routers/nda.py.

-- get_nda_by_signing_token needs candidate_email now, to actually email
-- the candidate their signed copy right after signing (previously
-- selected candidate_name/job_title/company_name only -- email was never
-- needed by that function's only prior caller). Adding a column changes
-- the return type, so CREATE OR REPLACE isn't allowed; DROP first, same
-- as the other functions already updated in sql/124/125.
DROP FUNCTION IF EXISTS public.get_nda_by_signing_token(text);
CREATE FUNCTION public.get_nda_by_signing_token(p_token text)
 RETURNS TABLE(
   final_text text, draft_text text, status text, sign_method text,
   candidate_name text, candidate_email text, job_title text, company_name text
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
    SELECT nd.final_text, nd.draft_text, nd.status, nd.sign_method,
           c.full_name, c.email, r.title, t.name
    FROM nda_documents nd
    JOIN applications a ON a.id = nd.application_id
    JOIN candidates c ON c.id = a.candidate_id
    JOIN requisitions r ON r.id = a.requisition_id
    JOIN tenants t ON t.id = nd.tenant_id
    WHERE nd.signing_token = p_token
    LIMIT 1;
$function$;

ALTER FUNCTION public.get_nda_by_signing_token(text) OWNER TO postgres;

-- Lets the (still-live, per sql/74) signing token also fetch the actual
-- signed artifact after the fact -- a candidate revisiting their own
-- link can now download what they signed, not just see "Already
-- Signed". Deliberately requires status='e_signed' -- never reveals a
-- draft/pending document's content through this endpoint.
CREATE OR REPLACE FUNCTION public.get_nda_signed_file_by_token(p_token text)
 RETURNS TABLE(
   status text, signed_snapshot_path text, final_text text, draft_text text,
   candidate_name text, company_name text
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
    SELECT nd.status, nd.signed_snapshot_path, nd.final_text, nd.draft_text,
           c.full_name, t.name
    FROM nda_documents nd
    JOIN candidates c ON c.id = nd.candidate_id
    JOIN tenants t ON t.id = nd.tenant_id
    WHERE nd.signing_token = p_token AND nd.status = 'e_signed'
    LIMIT 1;
$function$;

ALTER FUNCTION public.get_nda_signed_file_by_token(text) OWNER TO postgres;
