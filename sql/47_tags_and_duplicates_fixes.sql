-- Candidate Tags (P33) + Duplicate Detection (P35) fixes, 2026-08-10 round-3 audit.

-- ── 1. candidate_tag_map had ZERO row-level security ────────────────────
-- Proven live: an authenticated user of tenant B could read tenant A's tag
-- assignments through this table. It has no tenant_id column of its own
-- (it's a pure candidate<->tag join table) — the policy resolves tenant
-- through the tag's own tenant_id, same approach used wherever a join
-- table has no tenant_id column of its own.
-- Checks BOTH sides deliberately, not just the tag: a policy that only
-- verified tag_id's tenant would still let an attacker holding a real
-- own-tenant tag_id attach it to another tenant's candidate_id.
ALTER TABLE candidate_tag_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_tag_map FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_ctag_map ON candidate_tag_map
  USING (
    EXISTS (
      SELECT 1 FROM candidate_tags t
      WHERE t.id = candidate_tag_map.tag_id
        AND t.tenant_id = current_setting('app.tenant_id', true)::uuid
    )
    AND EXISTS (
      SELECT 1 FROM candidates c
      WHERE c.id = candidate_tag_map.candidate_id
        AND c.tenant_id = current_setting('app.tenant_id', true)::uuid
    )
  );

-- ── 2. Remove confirmed QA/test-artifact tags from the real tag list ───
-- Zero real assignments on any of these 4 (only "Do Not Contact" has real
-- assignments, confirmed before running this) — leftover Playwright
-- fixtures polluting the real tag dropdown every recruiter sees.
DELETE FROM candidate_tag_map WHERE tag_id IN (
  SELECT id FROM candidate_tags
  WHERE tenant_id = 'a92d7fd7-fb72-47d8-881e-2493c61717ce'
    AND name IN ('E2E-Test-Tag', 'E2E-Final', 'Playwright QA Check', 'Python Developer')
);
DELETE FROM candidate_tags
  WHERE tenant_id = 'a92d7fd7-fb72-47d8-881e-2493c61717ce'
    AND name IN ('E2E-Test-Tag', 'E2E-Final', 'Playwright QA Check', 'Python Developer');

-- ── 3. Seed the 12 default tags for every tenant that has none ─────────
-- The original 12-tag seed (2026-06-21) was a one-time script against the
-- one tenant that existed then, not part of tenant provisioning — Beta
-- Tech Staffing (added later) got zero tags. Backfills any tenant with
-- zero rows in candidate_tags, not hardcoded to a specific tenant id, so
-- this also covers any future tenant created before this ships.
INSERT INTO candidate_tags (tenant_id, name, color)
SELECT t.id, d.name, d.color
FROM tenants t
CROSS JOIN (VALUES
  ('Do Not Contact', '#6B7280'), ('Freelancer', '#6366F1'), ('Hot Candidate', '#EF4444'),
  ('Immediate Joiner', '#22C55E'), ('In Pipeline', '#3B82F6'), ('Notice Period 30d', '#F97316'),
  ('Notice Period 60d', '#FBBF24'), ('Offer Dropped', '#EF4444'), ('On Hold', '#F59E0B'),
  ('Open to Relocation', '#0EA5E9'), ('Passive', '#8B5CF6'), ('Premium Profile', '#10B981')
) AS d(name, color)
WHERE NOT EXISTS (SELECT 1 FROM candidate_tags ct WHERE ct.tenant_id = t.id)
ON CONFLICT (tenant_id, name) DO NOTHING;

-- ── 3b. Soft-deleted candidates permanently blocked re-adding the same
-- email (2026-08-10 audit) — uq_candidates_email_per_tenant applied
-- globally, not just to active rows, so POST /candidates 409'd
-- unconditionally with no override possible ("Add Anyway" is a
-- client-side skip of the *pre-check*, this was a hard DB-level 409).
-- Checked first: zero existing active-duplicate emails, so this is safe.
-- It's a table CONSTRAINT, not a bare index — DROP INDEX alone fails
-- ("...because constraint ... requires it"), confirmed live before fixing.
ALTER TABLE candidates DROP CONSTRAINT IF EXISTS uq_candidates_email_per_tenant;
DROP INDEX IF EXISTS uq_candidates_email_per_tenant;
CREATE UNIQUE INDEX uq_candidates_email_per_tenant
  ON candidates (tenant_id, email) WHERE is_active IS NOT FALSE;

-- ── 4. Schema drift backfill (2026-08-10 audit) ─────────────────────────
-- candidate_tags, candidate_tag_map, duplicate_candidates all exist live
-- in production with no CREATE TABLE in any committed migration — a fresh
-- environment built from git alone wouldn't have them. IF NOT EXISTS
-- makes this a genuine no-op everywhere these already exist.
CREATE TABLE IF NOT EXISTS candidate_tags (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name       VARCHAR(50) NOT NULL,
    color      VARCHAR(20) DEFAULT '#3B82F6',
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (tenant_id, name)
);
ALTER TABLE candidate_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_tags FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='candidate_tags' AND policyname='rls_ctag') THEN
    CREATE POLICY rls_ctag ON candidate_tags
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS candidate_tag_map (
    candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    tag_id       UUID NOT NULL REFERENCES candidate_tags(id) ON DELETE CASCADE,
    tagged_by    UUID REFERENCES users(id),
    tagged_at    TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (candidate_id, tag_id)
);

CREATE TABLE IF NOT EXISTS duplicate_candidates (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    candidate_id_1 UUID NOT NULL REFERENCES candidates(id),
    candidate_id_2 UUID NOT NULL REFERENCES candidates(id),
    match_field    VARCHAR(30),
    match_score    NUMERIC(5,2) DEFAULT 100,
    status         VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','merged','dismissed')),
    detected_at    TIMESTAMPTZ DEFAULT now(),
    resolved_at    TIMESTAMPTZ,
    resolved_by    UUID REFERENCES users(id),
    UNIQUE (tenant_id, candidate_id_1, candidate_id_2)
);
ALTER TABLE duplicate_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE duplicate_candidates FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='duplicate_candidates' AND policyname='rls_dup') THEN
    CREATE POLICY rls_dup ON duplicate_candidates
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;
