-- P13 BGV: Trust Intelligence + India Verification APIs
-- trust_graph adjacency table (CLAUDE.md: "trust_graph → P13")
-- bgv_checks + bgv_documents for structured background verification
-- All tables: tenant_id + RLS + app_user access

-- ─── Trust Graph ──────────────────────────────────────────────────────────────
-- Directed graph: source_id → target_id with typed edges and weight [0,1]
CREATE TABLE IF NOT EXISTS trust_graph (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  source_type    text NOT NULL CHECK (source_type IN ('candidate','recruiter','client')),
  source_id      uuid NOT NULL,
  target_type    text NOT NULL CHECK (target_type IN ('candidate','recruiter','client')),
  target_id      uuid NOT NULL,
  edge_type      text NOT NULL CHECK (edge_type IN (
    'referral',       -- A referred B for a role
    'worked_with',    -- A and B worked at the same company
    'interviewed',    -- recruiter A interviewed candidate B
    'placed',         -- recruiter A placed candidate B at client C
    'vouched',        -- A provided a reference for B
    'reported_fraud'  -- A flagged B for fraud (negative edge)
  )),
  weight         numeric(4,3) NOT NULL DEFAULT 1.0  -- positive [0,1]; fraud edge = -1.0
                 CHECK (weight >= -1.0 AND weight <= 1.0),
  metadata       jsonb,          -- role, company, date range, notes
  created_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE trust_graph ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust_graph FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON trust_graph
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);
CREATE INDEX IF NOT EXISTS idx_trust_graph_source ON trust_graph(tenant_id, source_id);
CREATE INDEX IF NOT EXISTS idx_trust_graph_target ON trust_graph(tenant_id, target_id);
GRANT SELECT, INSERT, UPDATE ON trust_graph TO app_user;

-- ─── BGV Checks ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bgv_checks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  candidate_id    uuid NOT NULL REFERENCES candidates(id),
  check_type      text NOT NULL CHECK (check_type IN (
    'identity',           -- Aadhaar / passport / voter ID
    'education',          -- degree/certificate verification
    'employment',         -- previous employer confirmation
    'criminal',           -- court records / police clearance
    'credit',             -- CIBIL / financial check
    'address',            -- physical address verification
    'reference',          -- professional reference call
    'digilocker'          -- DigiLocker document pull (India)
  )),
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','in_progress','completed','failed','expired')),
  result          text CHECK (result IN ('clear','flagged','unverifiable','pending')),
  score_points    int NOT NULL DEFAULT 0,  -- points added to trust score on completion
  initiated_at    timestamptz,
  completed_at    timestamptz,
  expires_at      timestamptz,
  vendor          text,         -- verification vendor name / 'in_house'
  reference_id    text,         -- vendor's reference number
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE bgv_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE bgv_checks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON bgv_checks
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);
CREATE INDEX IF NOT EXISTS idx_bgv_checks_candidate ON bgv_checks(tenant_id, candidate_id);
GRANT SELECT, INSERT, UPDATE ON bgv_checks TO app_user;

-- ─── BGV Documents (encrypted for PII docs) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS bgv_documents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  bgv_check_id   uuid NOT NULL REFERENCES bgv_checks(id) ON DELETE CASCADE,
  doc_type       text NOT NULL,   -- 'aadhaar_card', 'degree_cert', 'payslip', etc.
  file_name      text NOT NULL,
  file_size_bytes int,
  mime_type      text,
  storage_path   text,            -- local VPS path or future S3 key
  checksum       text,            -- SHA-256 of original file
  uploaded_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE bgv_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE bgv_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON bgv_documents
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);
GRANT SELECT, INSERT ON bgv_documents TO app_user;

-- ─── Trust Score (computed view) ─────────────────────────────────────────────
-- Rule-based aggregate: sum of BGV scores + trust graph edge weights.
-- No LLM needed — fully Tier-0 (SQL aggregation).
CREATE OR REPLACE VIEW v_trust_scores
WITH (security_invoker = true) AS
SELECT
  c.id AS candidate_id,
  c.full_name,
  c.tenant_id,
  -- BGV component (max 100 from verified checks)
  COALESCE(
    (SELECT SUM(score_points) FROM bgv_checks b
     WHERE b.candidate_id = c.id AND b.result = 'clear' AND b.status = 'completed'),
    0
  ) AS bgv_score,
  -- Trust graph inbound edges (positive referrals, vouches)
  COALESCE(
    (SELECT ROUND(SUM(weight)::numeric * 10)::int FROM trust_graph tg
     WHERE tg.target_id = c.id AND tg.edge_type IN ('referral','vouched','placed') AND tg.weight > 0),
    0
  ) AS trust_graph_score,
  -- Fraud flags (hard penalise)
  COALESCE(
    (SELECT COUNT(*) FROM trust_graph tg
     WHERE tg.target_id = c.id AND tg.edge_type = 'reported_fraud'),
    0
  ) AS fraud_flags,
  -- BGV check summary
  (SELECT COUNT(*) FROM bgv_checks b WHERE b.candidate_id = c.id) AS total_checks,
  (SELECT COUNT(*) FROM bgv_checks b WHERE b.candidate_id = c.id AND b.status = 'completed' AND b.result = 'clear') AS checks_clear
FROM candidates c;

GRANT SELECT ON v_trust_scores TO app_user;

-- ─── Offer Letters ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS offer_letters (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  offer_id          uuid NOT NULL REFERENCES offers(id),
  candidate_id      uuid NOT NULL REFERENCES candidates(id),
  draft_text        text,          -- AI-generated draft (Tier-2 Qwen via AI Router)
  final_text        text,          -- recruiter-edited version
  status            text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','sent','e_signed','expired')),
  aadhaar_esign_ref text,          -- Aadhaar OTP e-sign reference (production only)
  digilocker_ref    text,          -- DigiLocker handshake reference
  sent_at           timestamptz,
  signed_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE offer_letters ENABLE ROW LEVEL SECURITY;
ALTER TABLE offer_letters FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON offer_letters
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);
GRANT SELECT, INSERT, UPDATE ON offer_letters TO app_user;
