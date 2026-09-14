-- WhatsApp Screening Blueprint, Milestone 1 (Phases 0-2: quick-add/dedup,
-- enroll & throttle, opt-in & consent). screening_sessions tracks one
-- candidate's screening run against one requisition; screening_answers
-- (populated starting Milestone 2's skill-question loop) holds one row per
-- question/answer with its extraction method logged.
--
-- status has no rigid CHECK enum on purpose -- applications.stage went
-- through exactly this pain (sql/16_custom_stages.sql widened a rigid
-- CHECK to a permissive regex so new stage values never need a migration).
-- Milestone 2-4 will keep adding statuses (in_progress, completed, ...),
-- so screening_sessions.status starts with the permissive form already.
--
-- current_ctc/expected_ctc/notice_period_days exist live on candidates
-- (see backend/routers/candidates.py FIELDS, backend/schemas.py) but have
-- no tracked ALTER TABLE anywhere -- genuine schema drift distinct from
-- the whole-table drift sql/99 already backfilled. Backfilled here so a
-- fresh environment build doesn't silently miss them.
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS current_ctc NUMERIC;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS expected_ctc NUMERIC;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS notice_period_days INT;

CREATE TABLE IF NOT EXISTS screening_sessions (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID NOT NULL,
    candidate_id         UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    requisition_id       UUID NOT NULL REFERENCES requisitions(id),
    application_id       UUID REFERENCES applications(id),
    whatsapp_account_id  UUID REFERENCES user_whatsapp_accounts(id),
    status               TEXT NOT NULL DEFAULT 'pending_optin'
                             CHECK (status ~ '^[a-z][a-z0-9_]{1,40}$'),
    enrolled_via         TEXT NOT NULL CHECK (enrolled_via IN ('quick_add','csv_import','bulk_select')),
    consent_id           UUID REFERENCES consent_records(id),
    reminder_count       INT NOT NULL DEFAULT 0,
    last_message_at      TIMESTAMPTZ,
    created_by           UUID REFERENCES users(id),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_screening_sessions_candidate ON screening_sessions(candidate_id);
CREATE INDEX IF NOT EXISTS idx_screening_sessions_status ON screening_sessions(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_screening_sessions_dispatch
    ON screening_sessions(whatsapp_account_id, status) WHERE status IN ('pending_optin','sent');

-- "One active session per candidate" -- active = not yet in a terminal
-- state. Same partial-unique-index pattern as sql/42's
-- assignments_one_active_per_requisition, inverted to a NOT IN list since
-- "active" here isn't one fixed value. Closes a genuine race condition
-- (two recruiters enrolling the same phone number at the same instant).
CREATE UNIQUE INDEX IF NOT EXISTS screening_sessions_one_active_per_candidate
    ON screening_sessions (candidate_id)
    WHERE status NOT IN ('declined','opted_out','no_response','bad_number');

CREATE TABLE IF NOT EXISTS screening_answers (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID NOT NULL,
    screening_session_id UUID NOT NULL REFERENCES screening_sessions(id) ON DELETE CASCADE,
    question_key          TEXT NOT NULL,
    question_text         TEXT NOT NULL,
    raw_answer             TEXT,
    extracted_value        JSONB,
    extraction_method      TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_screening_answers_session ON screening_answers(screening_session_id);

ALTER TABLE screening_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE screening_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS screening_sessions_isolation ON screening_sessions;
CREATE POLICY screening_sessions_isolation ON screening_sessions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL ON TABLE screening_sessions TO app_user;

ALTER TABLE screening_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE screening_answers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS screening_answers_isolation ON screening_answers;
CREATE POLICY screening_answers_isolation ON screening_answers
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL ON TABLE screening_answers TO app_user;
