-- Fix: general (job-less) referral links have always been 500'ing.
-- candidate-engagement/page.tsx's "Generate Referral Link" button (its
-- "General referral" option) calls POST /referrals with an empty body
-- on purpose - gap_features.py's ReferralIn.requisition_id has always
-- been Optional[str]=None and referral_redirect() already has a real
-- fallback dest (/careers?ref=code, no job) for a null requisition_id -
-- the whole app-layer code path was built to support this. The DB
-- column was the one place still blocking it (NOT NULL), so every
-- "General referral" click has 500'd since this feature was built.
--
-- Also backfills the CREATE TABLE for referral_links itself - same
-- schema-drift pattern documented repeatedly elsewhere in this project
-- (no committed migration existed for this table at all before now).
-- Captured byte-for-byte via pg_dump --schema-only against production,
-- not reconstructed from memory, with requisition_id already nullable
-- so a fresh environment gets the fixed schema from day one. RLS stays
-- enabled-but-not-forced, exactly matching the live table's current
-- state - referral_redirect()'s system_conn() read relies on that,
-- and forcing it is a separate decision out of scope for this fix.

CREATE TABLE IF NOT EXISTS referral_links (
    id                UUID DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    tenant_id         UUID NOT NULL,
    referrer_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    requisition_id    UUID REFERENCES requisitions(id) ON DELETE CASCADE,
    unique_code       VARCHAR(32) DEFAULT encode(gen_random_bytes(8), 'hex') NOT NULL UNIQUE,
    click_count       INT DEFAULT 0 NOT NULL,
    candidate_ids     UUID[] DEFAULT '{}'::uuid[] NOT NULL,
    bonus_amount      NUMERIC(12,2) DEFAULT 0,
    bonus_paid        BOOLEAN DEFAULT false NOT NULL,
    created_at        TIMESTAMPTZ DEFAULT now() NOT NULL
);

ALTER TABLE referral_links ALTER COLUMN requisition_id DROP NOT NULL;

ALTER TABLE referral_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS referral_links_isolation ON referral_links;
CREATE POLICY referral_links_isolation ON referral_links
  USING (tenant_id::text = current_setting('app.tenant_id', true));
GRANT ALL ON TABLE referral_links TO app_user;

-- Second, more serious bug found while verifying the fix above:
-- referral_links is owned by postgres, not app_user, and RLS is
-- enabled (just not forced). db.system_conn() always connects as
-- app_user (backend/db.py), which is NOT the table owner - so RLS is
-- fully enforced against it despite not being FORCE'd (non-owners
-- always get RLS applied when RLS is enabled at all; FORCE only
-- changes behavior for the owner itself). system_conn() sets
-- app.tenant_id='', so the isolation policy (tenant_id::text = '')
-- matches zero rows for every query - GET /r/{code} (the public
-- redirect a candidate actually clicks) has returned a 404 for EVERY
-- referral link, not just job-less ones, since this feature was built.
-- Confirmed live before writing this fix, not assumed.
--
-- Two leftover, unused SECURITY DEFINER functions already existed for
-- this exact purpose (get_referral_by_code/increment_referral_clicks,
-- flagged dead in an earlier audit, still zero real callers anywhere
-- in the backend, confirmed via grep) - an older, imperfect shape
-- (get_referral_by_code INNER JOINs requisitions, so it would return
-- nothing for a job-less link even after today's nullable-requisition
-- fix). Replaced both with one correct, atomic function matching this
-- project's established anonymous-token SECURITY DEFINER pattern
-- (NDA/offer e-sign, personal_links, field attendance).
DROP FUNCTION IF EXISTS get_referral_by_code(text);
DROP FUNCTION IF EXISTS increment_referral_clicks(uuid);

CREATE OR REPLACE FUNCTION redeem_referral_click(p_code text)
RETURNS TABLE(tenant_id uuid, requisition_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE referral_links
  SET click_count = click_count + 1
  WHERE unique_code = p_code
  RETURNING referral_links.tenant_id, referral_links.requisition_id;
$$;

REVOKE ALL ON FUNCTION redeem_referral_click(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION redeem_referral_click(text) TO app_user;
