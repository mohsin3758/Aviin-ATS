"""GPS-verified field attendance for placed contractors (Time Champ
gap-analysis, 2026-08-11). Answers the staffing-agency-specific question
Time Champ's generic field-tracking module happens to solve: was this
contractor actually at the client site for the hours being billed?

Two auth paths:
  - Normal JWT (Actor/get_actor) for recruiters/admins configuring
    geofences, generating check-in links, and reviewing attendance.
  - Long-lived public token (no login — candidates aren't `users`) for
    the contractor's own daily check-in/check-out, resolved via
    SECURITY DEFINER SQL functions, same anonymous-token pattern as
    NDA/offer e-sign and the client portal.

Deliberately NOT auto-wired into timesheets/billing — this is a
read-only supporting-evidence layer surfaced next to the real timesheet
approval flow, not a replacement for it.
"""
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import db
from deps import Actor, get_actor, require_role

router = APIRouter(prefix="/field-attendance", tags=["field-attendance"])
public_router = APIRouter(prefix="/field-checkin", tags=["field-attendance-public"])


# ─── Geofences ──────────────────────────────────────────────────────────────

class GeofenceIn(BaseModel):
    client_id: str
    site_name: str
    address: Optional[str] = None
    center_lat: float
    center_lng: float
    radius_meters: int = 200


@router.get("/geofences")
async def list_geofences(client_id: Optional[str] = None, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        q = "SELECT g.*, c.name AS client_name FROM client_site_geofences g JOIN clients c ON c.id=g.client_id WHERE g.tenant_id=$1"
        params = [actor.tenant_id]
        if client_id:
            q += " AND g.client_id=$2"
            params.append(client_id)
        q += " ORDER BY g.is_active DESC, g.created_at DESC"
        rows = await conn.fetch(q, *params)
    return [dict(r) for r in rows]


@router.post("/geofences")
async def create_geofence(body: GeofenceIn, actor: Actor = Depends(require_role("admin", "manager"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        client = await conn.fetchrow("SELECT id FROM clients WHERE id=$1 AND tenant_id=$2", body.client_id, actor.tenant_id)
        if not client:
            raise HTTPException(404, "Client not found")
        row = await conn.fetchrow(
            """INSERT INTO client_site_geofences
                 (tenant_id, client_id, site_name, address, center_lat, center_lng, radius_meters, created_by)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *""",
            actor.tenant_id, body.client_id, body.site_name, body.address,
            body.center_lat, body.center_lng, body.radius_meters, actor.user_id,
        )
    return dict(row)


@router.put("/geofences/{geofence_id}")
async def update_geofence(geofence_id: str, body: GeofenceIn, actor: Actor = Depends(require_role("admin", "manager"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """UPDATE client_site_geofences SET site_name=$1, address=$2, center_lat=$3, center_lng=$4, radius_meters=$5
               WHERE id=$6 AND tenant_id=$7 RETURNING *""",
            body.site_name, body.address, body.center_lat, body.center_lng, body.radius_meters,
            geofence_id, actor.tenant_id,
        )
    if not row:
        raise HTTPException(404, "Geofence not found")
    return dict(row)


@router.delete("/geofences/{geofence_id}")
async def deactivate_geofence(geofence_id: str, actor: Actor = Depends(require_role("admin", "manager"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "UPDATE client_site_geofences SET is_active=FALSE WHERE id=$1 AND tenant_id=$2 RETURNING id",
            geofence_id, actor.tenant_id)
    if not row:
        raise HTTPException(404, "Geofence not found")
    return {"deactivated": True}


@router.get("/placements-search")
async def search_placements(q: str = "", actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            """SELECT p.id, p.status, p.start_date, p.end_date, c.full_name AS candidate_name,
                      cl.name AS client_name, cl.id AS client_id
               FROM placements p
               JOIN candidates c ON c.id=p.candidate_id
               LEFT JOIN clients cl ON cl.id=p.client_id
               WHERE p.tenant_id=$1 AND (c.full_name ILIKE $2 OR cl.name ILIKE $2)
               ORDER BY p.start_date DESC LIMIT 25""",
            actor.tenant_id, f"%{q}%")
    return [dict(r) for r in rows]


# ─── Placement wiring: assign geofence, generate/revoke check-in link ──────

class AssignGeofenceIn(BaseModel):
    geofence_id: str


@router.get("/placements/{placement_id}")
async def get_placement_field_config(placement_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        placement = await conn.fetchrow(
            """SELECT p.*, c.full_name AS candidate_name, cl.name AS client_name
               FROM placements p JOIN candidates c ON c.id=p.candidate_id
               LEFT JOIN clients cl ON cl.id=p.client_id
               WHERE p.id=$1 AND p.tenant_id=$2""",
            placement_id, actor.tenant_id)
        if not placement:
            raise HTTPException(404, "Placement not found")
        geofence = await conn.fetchrow(
            """SELECT g.* FROM placement_geofence_assignments pga
               JOIN client_site_geofences g ON g.id=pga.geofence_id
               WHERE pga.placement_id=$1 AND pga.tenant_id=$2""",
            placement_id, actor.tenant_id)
        token_row = await conn.fetchrow(
            "SELECT token, revoked_at FROM field_attendance_tokens WHERE placement_id=$1 AND tenant_id=$2",
            placement_id, actor.tenant_id)
        recent = await conn.fetch(
            """SELECT * FROM contractor_attendance WHERE placement_id=$1 AND tenant_id=$2
               ORDER BY attendance_date DESC LIMIT 14""",
            placement_id, actor.tenant_id)
    return {
        "placement": dict(placement),
        "geofence": dict(geofence) if geofence else None,
        "has_active_link": bool(token_row and not token_row["revoked_at"]),
        "recent_attendance": [dict(r) for r in recent],
    }


@router.post("/placements/{placement_id}/assign-geofence")
async def assign_geofence(placement_id: str, body: AssignGeofenceIn, actor: Actor = Depends(require_role("admin", "manager"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        placement = await conn.fetchrow("SELECT id FROM placements WHERE id=$1 AND tenant_id=$2", placement_id, actor.tenant_id)
        if not placement:
            raise HTTPException(404, "Placement not found")
        geofence = await conn.fetchrow("SELECT id FROM client_site_geofences WHERE id=$1 AND tenant_id=$2", body.geofence_id, actor.tenant_id)
        if not geofence:
            raise HTTPException(404, "Geofence not found")
        row = await conn.fetchrow(
            """INSERT INTO placement_geofence_assignments (tenant_id, placement_id, geofence_id)
               VALUES ($1,$2,$3)
               ON CONFLICT (tenant_id, placement_id) DO UPDATE SET geofence_id=$3, assigned_at=now()
               RETURNING *""",
            actor.tenant_id, placement_id, body.geofence_id)
    return dict(row)


@router.post("/placements/{placement_id}/generate-link")
async def generate_checkin_link(placement_id: str, actor: Actor = Depends(require_role("admin", "manager"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        placement = await conn.fetchrow("SELECT id FROM placements WHERE id=$1 AND tenant_id=$2", placement_id, actor.tenant_id)
        if not placement:
            raise HTTPException(404, "Placement not found")
        existing = await conn.fetchrow(
            "SELECT token FROM field_attendance_tokens WHERE placement_id=$1 AND tenant_id=$2 AND revoked_at IS NULL",
            placement_id, actor.tenant_id)
        if existing:
            token = existing["token"]
        else:
            token = secrets.token_urlsafe(32)
            await conn.execute(
                """INSERT INTO field_attendance_tokens (tenant_id, placement_id, token)
                   VALUES ($1,$2,$3)
                   ON CONFLICT (tenant_id, placement_id) DO UPDATE SET token=$3, revoked_at=NULL""",
                actor.tenant_id, placement_id, token)
    return {"token": token, "checkin_url": f"/field-checkin/{token}"}


@router.post("/placements/{placement_id}/revoke-link")
async def revoke_checkin_link(placement_id: str, actor: Actor = Depends(require_role("admin", "manager"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "UPDATE field_attendance_tokens SET revoked_at=now() WHERE placement_id=$1 AND tenant_id=$2 AND revoked_at IS NULL RETURNING id",
            placement_id, actor.tenant_id)
    return {"revoked": bool(row)}


# ─── Reporting ──────────────────────────────────────────────────────────────

@router.get("/records")
async def list_attendance_records(
    placement_id: Optional[str] = None, client_id: Optional[str] = None,
    status: Optional[str] = None, date_from: Optional[str] = None, date_to: Optional[str] = None,
    limit: int = 200, actor: Actor = Depends(get_actor),
):
    async with db.tenant_conn(actor.tenant_id) as conn:
        q = """SELECT ca.*, c.full_name AS candidate_name, cl.name AS client_name, p.client_id
               FROM contractor_attendance ca
               JOIN candidates c ON c.id=ca.candidate_id
               JOIN placements p ON p.id=ca.placement_id
               LEFT JOIN clients cl ON cl.id=p.client_id
               WHERE ca.tenant_id=$1"""
        params = [actor.tenant_id]
        if placement_id:
            params.append(placement_id); q += f" AND ca.placement_id=${len(params)}"
        if client_id:
            params.append(client_id); q += f" AND p.client_id=${len(params)}"
        if status:
            params.append(status); q += f" AND ca.status=${len(params)}"
        if date_from:
            params.append(date_from); q += f" AND ca.attendance_date>=${len(params)}"
        if date_to:
            params.append(date_to); q += f" AND ca.attendance_date<=${len(params)}"
        q += " ORDER BY ca.attendance_date DESC, ca.created_at DESC LIMIT $%d" % (len(params) + 1)
        params.append(limit)
        rows = await conn.fetch(q, *params)
    return [dict(r) for r in rows]


@router.get("/summary")
async def attendance_summary(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        stats = await conn.fetchrow(
            """SELECT
                 COUNT(*) FILTER (WHERE status='clean') AS clean_count,
                 COUNT(*) FILTER (WHERE status='flagged') AS flagged_count,
                 COUNT(*) FILTER (WHERE status='manual_override') AS override_count,
                 COUNT(*) FILTER (WHERE attendance_date >= CURRENT_DATE - 30) AS last_30d_count
               FROM contractor_attendance WHERE tenant_id=$1""",
            actor.tenant_id)
        geofence_count = await conn.fetchval(
            "SELECT COUNT(*) FROM client_site_geofences WHERE tenant_id=$1 AND is_active=TRUE", actor.tenant_id)
        active_links = await conn.fetchval(
            "SELECT COUNT(*) FROM field_attendance_tokens WHERE tenant_id=$1 AND revoked_at IS NULL", actor.tenant_id)
    return {**dict(stats), "active_geofences": geofence_count, "active_checkin_links": active_links}


class OverrideIn(BaseModel):
    reason: str


@router.patch("/records/{record_id}/override")
async def override_attendance(record_id: str, body: OverrideIn, actor: Actor = Depends(require_role("admin", "manager"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """UPDATE contractor_attendance SET status='manual_override', manual_override_reason=$1,
                 manual_override_by=$2, updated_at=now()
               WHERE id=$3 AND tenant_id=$4 RETURNING *""",
            body.reason, actor.user_id, record_id, actor.tenant_id)
    if not row:
        raise HTTPException(404, "Attendance record not found")
    return dict(row)


# ─── Public check-in/check-out (no auth — SECURITY DEFINER bypasses RLS) ───

@public_router.get("/{token}")
async def get_checkin_info(token: str):
    async with db.system_conn() as conn:
        row = await conn.fetchrow("SELECT * FROM get_field_attendance_by_token($1)", token)
    if not row:
        raise HTTPException(404, "Check-in link is invalid or has been revoked")
    return dict(row)


@public_router.get("/{token}/today")
async def get_today_status(token: str):
    async with db.system_conn() as conn:
        info = await conn.fetchrow("SELECT * FROM get_field_attendance_by_token($1)", token)
        if not info:
            raise HTTPException(404, "Check-in link is invalid or has been revoked")
        row = await conn.fetchrow("SELECT * FROM get_today_field_attendance($1)", token)
    return dict(row) if row else {"id": None, "check_in_at": None, "check_out_at": None, "status": None}


class GpsIn(BaseModel):
    lat: float
    lng: float
    accuracy: Optional[float] = None


@public_router.post("/{token}/check-in")
async def check_in(token: str, body: GpsIn):
    async with db.system_conn() as conn:
        try:
            row = await conn.fetchrow(
                "SELECT * FROM record_field_checkin($1,$2,$3,$4)", token, body.lat, body.lng, body.accuracy)
        except Exception as exc:
            raise HTTPException(400, str(exc).split("\n")[0])
    return dict(row)


@public_router.post("/{token}/check-out")
async def check_out(token: str, body: GpsIn):
    async with db.system_conn() as conn:
        try:
            row = await conn.fetchrow(
                "SELECT * FROM record_field_checkout($1,$2,$3,$4)", token, body.lat, body.lng, body.accuracy)
        except Exception as exc:
            raise HTTPException(400, str(exc).split("\n")[0])
    return dict(row)
