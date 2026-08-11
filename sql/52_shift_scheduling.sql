-- Internal shift scheduling for recruiters/staff (Time Champ gap-analysis,
-- 2026-08-11). Requisitions already have a `shift_type` field describing
-- the JOB's shift — this is a separate concept: scheduling FinStack's own
-- staff. Template-based (a named shift shape, e.g. "Day 9-6") assigned per
-- user per date, plus a shift-swap request/approval workflow.

CREATE TABLE shift_templates (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    start_time  TIME NOT NULL,
    end_time    TIME NOT NULL,
    color       TEXT NOT NULL DEFAULT '#2563eb',
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_by  UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_shift_templates_tenant ON shift_templates (tenant_id, is_active);
ALTER TABLE shift_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON shift_templates
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE TABLE staff_shifts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    template_id  UUID REFERENCES shift_templates(id),
    shift_date   DATE NOT NULL,
    start_time   TIME NOT NULL,
    end_time     TIME NOT NULL,
    status       TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','missed','swapped')),
    notes        TEXT,
    created_by   UUID REFERENCES users(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, user_id, shift_date)
);
CREATE INDEX idx_staff_shifts_user_date ON staff_shifts (tenant_id, user_id, shift_date);
CREATE INDEX idx_staff_shifts_date ON staff_shifts (tenant_id, shift_date);
ALTER TABLE staff_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_shifts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON staff_shifts
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE TABLE shift_swap_requests (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    shift_id          UUID NOT NULL REFERENCES staff_shifts(id) ON DELETE CASCADE,
    requested_by      UUID NOT NULL REFERENCES users(id),
    target_user_id    UUID REFERENCES users(id),
    reason            TEXT,
    status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
    reviewed_by       UUID REFERENCES users(id),
    reviewed_at       TIMESTAMPTZ,
    review_note       TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_swap_requests_status ON shift_swap_requests (tenant_id, status);
ALTER TABLE shift_swap_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_swap_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON shift_swap_requests
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
