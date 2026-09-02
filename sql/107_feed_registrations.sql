-- 107_feed_registrations.sql
-- "Path to Full Auto-Distribution" research (2026-09-02) confirmed 5 more
-- real, free, currently-active publisher/partner XML-feed programs beyond
-- the 2 (Indeed/Jooble) already wired into GET /job-sharing/feed-info:
-- Careerjet, Adzuna, Trovit, Jora, Jobrapido. Each works the exact same
-- way Indeed/Jooble already do — register the existing
-- /api/public/jobs/feed.xml URL once with the aggregator's own real
-- publisher/partner application (a real human action on their site, not
-- something a backend call can complete on the tenant's behalf, since it
-- needs the agency's own contact/business details and agreement to their
-- terms) — after that, every future open job is picked up automatically,
-- forever, with zero further action.
--
-- This table is the honest record of WHICH of the 7 real feed programs a
-- given tenant has actually completed registration for — self-reported
-- by an admin once they've done the real-world step, the same "the
-- system can't verify a third party's approval, so a human attests to
-- it" pattern already used elsewhere in this codebase. Before this
-- table existed, Indeed/Jooble were silently ASSUMED registered (a
-- hardcoded _FEED_ELIGIBLE set in job_portals.py with no real per-tenant
-- tracking at all) — seeded below as already-true for every tenant,
-- preserving that existing assumption rather than introducing a
-- regression, while giving the 5 new programs an honest, real,
-- initially-unregistered starting state.
--
-- Run as app_user (owner = app_user, matches every other tenant-scoped
-- self-service config/tracking table this app writes directly, e.g.
-- job_distribution_config, saved_filters).

CREATE TABLE IF NOT EXISTS feed_registrations (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    portal_key     TEXT NOT NULL,
    registered_by  UUID REFERENCES users(id),
    registered_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, portal_key)
);

ALTER TABLE feed_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_registrations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON feed_registrations;
CREATE POLICY tenant_isolation ON feed_registrations
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Preserve the pre-existing, already-live assumption for Indeed/Jooble
-- (job_portals.py's _FEED_ELIGIBLE set, unconditionally treated as
-- registered since it was first built) for every tenant that already
-- exists — a real, honest backfill of a fact the code has always
-- asserted, not a new claim. registered_by is left NULL (no real actor
-- attested to this specific fact at this specific time — it predates
-- this table), matching this project's own established "never fabricate
-- an attribution that didn't happen" discipline (see the offer-HITL
-- audit-trail backfill, 2026-08-10).
--
-- FORCE ROW LEVEL SECURITY applies even to app_user as the table's own
-- owner - a bare cross-tenant INSERT...SELECT is rejected outright
-- (confirmed live via a transactional dry-run before this was written).
-- Same real per-tenant set_config('app.tenant_id',...) loop already
-- established in sql/28_kae_submission.sql for exactly this situation.
DO $$
DECLARE
    t RECORD;
BEGIN
    FOR t IN SELECT id FROM tenants LOOP
        PERFORM set_config('app.tenant_id', t.id::text, true);
        INSERT INTO feed_registrations (tenant_id, portal_key)
        VALUES (t.id, 'indeed'), (t.id, 'jooble')
        ON CONFLICT (tenant_id, portal_key) DO NOTHING;
    END LOOP;
    PERFORM set_config('app.tenant_id', '', true);
END $$;
