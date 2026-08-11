-- Break-time split tracking (Time Champ gap-analysis, 2026-08-11).
-- Extends the existing work_sessions clock-in/clock-out with a distinct
-- "on break" state and a real work-vs-break split report — Time Champ's
-- "Break Time Split Report" (Enterprise tier).

CREATE TABLE work_session_breaks (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    session_id    UUID NOT NULL REFERENCES work_sessions(id) ON DELETE CASCADE,
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    break_type    TEXT NOT NULL DEFAULT 'short' CHECK (break_type IN ('lunch','short','other')),
    break_start   TIMESTAMPTZ NOT NULL DEFAULT now(),
    break_end     TIMESTAMPTZ,
    duration_mins NUMERIC(8,2)
);
CREATE INDEX idx_work_breaks_session ON work_session_breaks (tenant_id, session_id);
CREATE INDEX idx_work_breaks_user ON work_session_breaks (tenant_id, user_id, break_start DESC);
ALTER TABLE work_session_breaks ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_session_breaks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON work_session_breaks
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
