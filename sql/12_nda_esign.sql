-- AIrecruit: NDA document generation + e-signature (Stage-Workflow Phase 1)
--
-- Mirrors the offer_letters / offer-sign pattern (offers.py) that is already
-- live in production: a document row with a draft/final text, a one-time
-- signing_token, and SECURITY DEFINER functions so the public no-auth
-- /sign-nda/{token} page can read + write through RLS safely.
--
-- Adds sign_method (type_name / otp / manual) and OTP columns, which the
-- offer flow does not have.

CREATE TABLE IF NOT EXISTS nda_documents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  application_id    UUID NOT NULL REFERENCES applications(id),
  candidate_id      UUID NOT NULL REFERENCES candidates(id),
  draft_text        TEXT,
  final_text        TEXT,
  status            TEXT NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','sent','e_signed','manually_signed','expired')),
  sign_method       TEXT CHECK (sign_method IN ('type_name','otp','manual')),
  signatory_name    TEXT,
  signing_token     TEXT UNIQUE,
  otp_code          TEXT,
  otp_expires_at    TIMESTAMPTZ,
  manual_file_path  TEXT,
  uploaded_by       UUID REFERENCES users(id),
  sent_at           TIMESTAMPTZ,
  signed_at         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nda_documents_application ON nda_documents(application_id);

ALTER TABLE nda_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE nda_documents FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON nda_documents;
CREATE POLICY tenant_isolation ON nda_documents
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);

-- IMPORTANT: the four functions below MUST be created (or ALTER FUNCTION ...
-- OWNER TO'd) as the `postgres` superuser, not `app_user`. SECURITY DEFINER
-- makes a function run as its OWNER's role, and nda_documents has FORCE ROW
-- LEVEL SECURITY — so unless the owner role has BYPASSRLS (postgres does,
-- app_user does not), the function is still blocked by RLS and every public
-- /sign-nda/{token} request 500s with "invalid input syntax for type uuid: ''"
-- (system_conn() sets app.tenant_id to an empty string for anonymous public
-- requests). This exact pattern is why offers.py's get_offer_by_signing_token
-- / sign_offer_by_token are owned by postgres in production. If this file is
-- ever re-run via `psql -U app_user`, follow up with:
--   ALTER FUNCTION public.get_nda_by_signing_token(text) OWNER TO postgres;
--   ALTER FUNCTION public.request_nda_otp_by_token(text) OWNER TO postgres;
--   ALTER FUNCTION public.verify_nda_otp_by_token(text, text) OWNER TO postgres;
--   ALTER FUNCTION public.sign_nda_by_token(text, text) OWNER TO postgres;

-- ── Public signing: read (no OTP code exposed) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.get_nda_by_signing_token(p_token text)
 RETURNS TABLE(
   final_text text, draft_text text, status text, sign_method text,
   candidate_name text, job_title text, company_name text
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
    SELECT nd.final_text, nd.draft_text, nd.status, nd.sign_method,
           c.full_name, r.title, t.name
    FROM nda_documents nd
    JOIN applications a ON a.id = nd.application_id
    JOIN candidates c ON c.id = a.candidate_id
    JOIN requisitions r ON r.id = a.requisition_id
    JOIN tenants t ON t.id = nd.tenant_id
    WHERE nd.signing_token = p_token
    LIMIT 1;
$function$;


-- ── Public signing: generate + store a fresh OTP, return who to email ──────
CREATE OR REPLACE FUNCTION public.request_nda_otp_by_token(p_token text)
 RETURNS TABLE(tenant_id uuid, candidate_email text, candidate_name text, otp_code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_otp text := lpad((floor(random() * 1000000))::int::text, 6, '0');
BEGIN
    RETURN QUERY
    UPDATE nda_documents nd
    SET otp_code = v_otp, otp_expires_at = now() + interval '10 minutes'
    FROM applications a
    JOIN candidates c ON c.id = a.candidate_id
    WHERE nd.application_id = a.id
      AND nd.signing_token = p_token
      AND nd.status = 'sent'
      AND nd.sign_method = 'otp'
    RETURNING nd.tenant_id, c.email, c.full_name, v_otp;
END;
$function$;


-- ── Public signing: verify OTP server-side (code never sent to browser) ────
CREATE OR REPLACE FUNCTION public.verify_nda_otp_by_token(p_token text, p_otp text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM nda_documents
        WHERE signing_token = p_token
          AND status = 'sent'
          AND sign_method = 'otp'
          AND otp_code = p_otp
          AND otp_expires_at > now()
    );
$function$;


-- ── Public signing: record the signature ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sign_nda_by_token(p_token text, p_name text)
 RETURNS TABLE(application_id uuid, tenant_id uuid, candidate_id uuid)
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
    UPDATE nda_documents
    SET status = 'e_signed', signed_at = now(), signatory_name = p_name,
        signing_token = NULL, otp_code = NULL, otp_expires_at = NULL
    WHERE signing_token = p_token AND status = 'sent'
    RETURNING application_id, tenant_id, candidate_id;
$function$;
