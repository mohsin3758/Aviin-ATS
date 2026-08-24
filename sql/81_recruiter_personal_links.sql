-- Recruiter personal sourcing links (2026-08-25) — one of 3 recruiter-CRM
-- features picked from the "Recruiter CRM Landscape" market research report.
-- A permanent, shareable link per recruiter, not tied to any job — post it
-- on LinkedIn/WhatsApp as "send me your CV." Whoever submits through it
-- becomes a candidate auto-claimed as that recruiter's owned candidate via
-- the existing 30-day FCFS claim_ownership() service.

CREATE TABLE IF NOT EXISTS recruiter_personal_links (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  recruiter_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token             text NOT NULL UNIQUE,
  submission_count  integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, recruiter_id)
);
ALTER TABLE recruiter_personal_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruiter_personal_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON recruiter_personal_links;
CREATE POLICY tenant_isolation ON recruiter_personal_links
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);
CREATE INDEX IF NOT EXISTS idx_recruiter_personal_links_token ON recruiter_personal_links (token);

-- SECURITY DEFINER: the public resume-drop landing page authenticates via
-- token only and has no app.tenant_id set yet — same anonymous-token-
-- resolves-tenant pattern already established for field attendance check-in
-- (get_field_attendance_by_token, sql/51_field_attendance.sql), NDA/offer
-- e-sign, device enrollment, and the client portal. Unlike referral_links
-- (RLS enabled but not FORCEd, so its owner-only redirect query gets away
-- with a plain system_conn() lookup), this table is genuinely FORCE RLS, so
-- a real SECURITY DEFINER resolver is required, not a shortcut.
CREATE OR REPLACE FUNCTION get_personal_link_by_token(p_token text)
RETURNS TABLE (tenant_id uuid, recruiter_id uuid, recruiter_name text, tenant_name text)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT l.tenant_id, l.recruiter_id, u.full_name, t.name
  FROM recruiter_personal_links l
  JOIN users u ON u.id = l.recruiter_id
  JOIN tenants t ON t.id = l.tenant_id
  WHERE l.token = p_token;
END;
$$;
REVOKE ALL ON FUNCTION get_personal_link_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_personal_link_by_token(text) TO app_user;

-- Widen candidate_ownership's source CHECK for the two new recruiter-
-- attribution paths added in this change: this personal link, and the
-- per-job share-link attribution fix in public_apply() (job_share_link).
ALTER TABLE candidate_ownership DROP CONSTRAINT IF EXISTS candidate_ownership_source_check;
ALTER TABLE candidate_ownership ADD CONSTRAINT candidate_ownership_source_check
  CHECK (source = ANY (ARRAY['personal_mailbox','manual_add','bulk_upload','manual_assign','personal_link','job_share_link']));
