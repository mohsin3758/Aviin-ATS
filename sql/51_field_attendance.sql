-- GPS-verified contractor field attendance (Time Champ gap-analysis, 2026-08-11).
-- Verifies a placed contractor is actually at the client site for billed
-- hours — a staffing-agency-specific problem Time Champ's generic field-
-- tracking module happens to solve. Daily check-in/check-out with geofence
-- verification via a long-lived public token link (no candidate login —
-- candidates aren't `users`, same reasoning as the client-portal/NDA/
-- offer-signing token flows). Deliberately NOT auto-wired into
-- timesheets/billing this round — kept as its own read-only supporting-
-- evidence layer surfaced next to the real timesheet approval flow,
-- rather than risking the existing billing pipeline.

CREATE TABLE client_site_geofences (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    site_name       TEXT NOT NULL,
    address         TEXT,
    center_lat      DOUBLE PRECISION NOT NULL,
    center_lng      DOUBLE PRECISION NOT NULL,
    radius_meters   INTEGER NOT NULL DEFAULT 200 CHECK (radius_meters > 0 AND radius_meters <= 5000),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_geofence_client ON client_site_geofences (tenant_id, client_id);
ALTER TABLE client_site_geofences ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_site_geofences FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON client_site_geofences
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE TABLE placement_geofence_assignments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    placement_id    UUID NOT NULL REFERENCES placements(id) ON DELETE CASCADE,
    geofence_id     UUID NOT NULL REFERENCES client_site_geofences(id) ON DELETE CASCADE,
    assigned_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, placement_id)
);
ALTER TABLE placement_geofence_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE placement_geofence_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON placement_geofence_assignments
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Long-lived (not single-use like NDA/offer tokens) — a contractor checks
-- in/out every working day for the length of the placement.
CREATE TABLE field_attendance_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    placement_id    UUID NOT NULL REFERENCES placements(id) ON DELETE CASCADE,
    token           TEXT NOT NULL UNIQUE,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, placement_id)
);
CREATE INDEX idx_field_att_token ON field_attendance_tokens (token) WHERE revoked_at IS NULL;
ALTER TABLE field_attendance_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_attendance_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON field_attendance_tokens
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE TABLE contractor_attendance (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    placement_id                UUID NOT NULL REFERENCES placements(id) ON DELETE CASCADE,
    candidate_id                UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    attendance_date             DATE NOT NULL DEFAULT CURRENT_DATE,
    check_in_at                 TIMESTAMPTZ,
    check_in_lat                DOUBLE PRECISION,
    check_in_lng                DOUBLE PRECISION,
    check_in_accuracy_m         DOUBLE PRECISION,
    check_in_distance_m         DOUBLE PRECISION,
    check_in_within_geofence    BOOLEAN,
    check_out_at                TIMESTAMPTZ,
    check_out_lat               DOUBLE PRECISION,
    check_out_lng               DOUBLE PRECISION,
    check_out_accuracy_m        DOUBLE PRECISION,
    check_out_distance_m        DOUBLE PRECISION,
    check_out_within_geofence   BOOLEAN,
    geofence_id                 UUID REFERENCES client_site_geofences(id),
    status                      TEXT NOT NULL DEFAULT 'clean' CHECK (status IN ('clean','flagged','manual_override')),
    manual_override_reason      TEXT,
    manual_override_by          UUID REFERENCES users(id),
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, placement_id, attendance_date)
);
CREATE INDEX idx_contractor_att_placement ON contractor_attendance (tenant_id, placement_id, attendance_date DESC);
CREATE INDEX idx_contractor_att_status ON contractor_attendance (tenant_id, status);
ALTER TABLE contractor_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE contractor_attendance FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON contractor_attendance
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Haversine distance in meters — plain SQL, no PostGIS dependency needed
-- at this scale (per-placement point-in-radius check, not spatial indexing).
CREATE OR REPLACE FUNCTION geo_distance_meters(lat1 DOUBLE PRECISION, lng1 DOUBLE PRECISION,
                                                lat2 DOUBLE PRECISION, lng2 DOUBLE PRECISION)
RETURNS DOUBLE PRECISION LANGUAGE sql IMMUTABLE AS $$
    SELECT 6371000 * 2 * ASIN(SQRT(
        POWER(SIN(RADIANS(lat2 - lat1) / 2), 2) +
        COS(RADIANS(lat1)) * COS(RADIANS(lat2)) * POWER(SIN(RADIANS(lng2 - lng1) / 2), 2)
    ));
$$;

-- SECURITY DEFINER: the public check-in page authenticates via token only
-- and has no app.tenant_id set yet — same anonymous-token-resolves-tenant
-- pattern as NDA/offer e-sign, device enrollment, and the client portal.
CREATE OR REPLACE FUNCTION get_field_attendance_by_token(p_token TEXT)
RETURNS TABLE (
    tenant_id UUID, placement_id UUID, candidate_id UUID, candidate_name TEXT,
    client_name TEXT, site_name TEXT, center_lat DOUBLE PRECISION,
    center_lng DOUBLE PRECISION, radius_meters INTEGER, geofence_id UUID,
    placement_status TEXT
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    RETURN QUERY
    SELECT t.tenant_id, t.placement_id, p.candidate_id, c.full_name,
           cl.name, g.site_name, g.center_lat, g.center_lng, g.radius_meters, g.id,
           p.status
    FROM field_attendance_tokens t
    JOIN placements p ON p.id = t.placement_id
    JOIN candidates c ON c.id = p.candidate_id
    LEFT JOIN clients cl ON cl.id = p.client_id
    LEFT JOIN placement_geofence_assignments pga ON pga.placement_id = p.id
    LEFT JOIN client_site_geofences g ON g.id = pga.geofence_id
    WHERE t.token = p_token AND t.revoked_at IS NULL;
END;
$$;
REVOKE ALL ON FUNCTION get_field_attendance_by_token(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_field_attendance_by_token(TEXT) TO app_user;

CREATE OR REPLACE FUNCTION get_today_field_attendance(p_token TEXT)
RETURNS TABLE (id UUID, check_in_at TIMESTAMPTZ, check_out_at TIMESTAMPTZ, status TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    RETURN QUERY
    SELECT ca.id, ca.check_in_at, ca.check_out_at, ca.status
    FROM contractor_attendance ca
    JOIN field_attendance_tokens t ON t.placement_id = ca.placement_id AND t.tenant_id = ca.tenant_id
    WHERE t.token = p_token AND t.revoked_at IS NULL AND ca.attendance_date = CURRENT_DATE;
END;
$$;
REVOKE ALL ON FUNCTION get_today_field_attendance(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_today_field_attendance(TEXT) TO app_user;

CREATE OR REPLACE FUNCTION record_field_checkin(p_token TEXT, p_lat DOUBLE PRECISION,
                                                 p_lng DOUBLE PRECISION, p_accuracy DOUBLE PRECISION)
RETURNS TABLE (attendance_id UUID, within_geofence BOOLEAN, distance_m DOUBLE PRECISION)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_tenant UUID; v_placement UUID; v_candidate UUID; v_geofence UUID;
    v_center_lat DOUBLE PRECISION; v_center_lng DOUBLE PRECISION; v_radius INTEGER;
    v_dist DOUBLE PRECISION; v_within BOOLEAN; v_id UUID;
BEGIN
    SELECT t.tenant_id, t.placement_id, p.candidate_id, g.id, g.center_lat, g.center_lng, g.radius_meters
      INTO v_tenant, v_placement, v_candidate, v_geofence, v_center_lat, v_center_lng, v_radius
    FROM field_attendance_tokens t
    JOIN placements p ON p.id = t.placement_id
    LEFT JOIN placement_geofence_assignments pga ON pga.placement_id = p.id
    LEFT JOIN client_site_geofences g ON g.id = pga.geofence_id
    WHERE t.token = p_token AND t.revoked_at IS NULL;

    IF v_placement IS NULL THEN
        RAISE EXCEPTION 'Invalid or revoked check-in link';
    END IF;

    IF v_geofence IS NOT NULL THEN
        v_dist := geo_distance_meters(p_lat, p_lng, v_center_lat, v_center_lng);
        v_within := v_dist <= v_radius;
    END IF;

    INSERT INTO contractor_attendance
        (tenant_id, placement_id, candidate_id, attendance_date, check_in_at,
         check_in_lat, check_in_lng, check_in_accuracy_m, check_in_distance_m,
         check_in_within_geofence, geofence_id, status)
    VALUES (v_tenant, v_placement, v_candidate, CURRENT_DATE, now(),
            p_lat, p_lng, p_accuracy, v_dist, v_within, v_geofence,
            CASE WHEN v_geofence IS NOT NULL AND v_within IS NOT TRUE THEN 'flagged' ELSE 'clean' END)
    ON CONFLICT (tenant_id, placement_id, attendance_date) DO UPDATE SET
        check_in_at = now(), check_in_lat = p_lat, check_in_lng = p_lng,
        check_in_accuracy_m = p_accuracy, check_in_distance_m = v_dist,
        check_in_within_geofence = v_within, geofence_id = v_geofence,
        status = CASE WHEN v_geofence IS NOT NULL AND v_within IS NOT TRUE THEN 'flagged'
                      ELSE contractor_attendance.status END,
        updated_at = now()
    RETURNING id INTO v_id;

    RETURN QUERY SELECT v_id, v_within, v_dist;
END;
$$;
REVOKE ALL ON FUNCTION record_field_checkin(TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_field_checkin(TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO app_user;

CREATE OR REPLACE FUNCTION record_field_checkout(p_token TEXT, p_lat DOUBLE PRECISION,
                                                  p_lng DOUBLE PRECISION, p_accuracy DOUBLE PRECISION)
RETURNS TABLE (attendance_id UUID, within_geofence BOOLEAN, distance_m DOUBLE PRECISION)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_tenant UUID; v_placement UUID; v_geofence UUID;
    v_center_lat DOUBLE PRECISION; v_center_lng DOUBLE PRECISION; v_radius INTEGER;
    v_dist DOUBLE PRECISION; v_within BOOLEAN; v_id UUID; v_existing_status TEXT;
BEGIN
    SELECT t.tenant_id, t.placement_id, g.id, g.center_lat, g.center_lng, g.radius_meters
      INTO v_tenant, v_placement, v_geofence, v_center_lat, v_center_lng, v_radius
    FROM field_attendance_tokens t
    JOIN placements p ON p.id = t.placement_id
    LEFT JOIN placement_geofence_assignments pga ON pga.placement_id = p.id
    LEFT JOIN client_site_geofences g ON g.id = pga.geofence_id
    WHERE t.token = p_token AND t.revoked_at IS NULL;

    IF v_placement IS NULL THEN
        RAISE EXCEPTION 'Invalid or revoked check-in link';
    END IF;

    IF v_geofence IS NOT NULL THEN
        v_dist := geo_distance_meters(p_lat, p_lng, v_center_lat, v_center_lng);
        v_within := v_dist <= v_radius;
    END IF;

    SELECT id, status INTO v_id, v_existing_status FROM contractor_attendance
      WHERE tenant_id=v_tenant AND placement_id=v_placement AND attendance_date=CURRENT_DATE;

    IF v_id IS NULL THEN
        RAISE EXCEPTION 'No check-in recorded today — check in first';
    END IF;

    UPDATE contractor_attendance SET
        check_out_at = now(), check_out_lat = p_lat, check_out_lng = p_lng,
        check_out_accuracy_m = p_accuracy, check_out_distance_m = v_dist,
        check_out_within_geofence = v_within,
        status = CASE WHEN v_geofence IS NOT NULL AND v_within IS NOT TRUE AND v_existing_status != 'manual_override'
                      THEN 'flagged' ELSE v_existing_status END,
        updated_at = now()
    WHERE id = v_id;

    RETURN QUERY SELECT v_id, v_within, v_dist;
END;
$$;
REVOKE ALL ON FUNCTION record_field_checkout(TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_field_checkout(TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO app_user;
