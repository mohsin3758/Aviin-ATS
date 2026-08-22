"""User Management — staffing industry roles, user CRUD, permissions."""
import asyncpg
import bcrypt
import json
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
import db
from deps import Actor, get_actor, require_role
from permissions import FEATURES, FEATURE_GROUPS, ACTIONS

router = APIRouter(prefix="/users", tags=["users"])

DEPARTMENTS = ["Delivery","Account Management","Sales","Operations","Finance","HR","Technology","Leadership","IT"]

class UserCreate(BaseModel):
    email: str
    full_name: str
    role: str
    password: str = "Welcome@2026"
    department: Optional[str] = None
    designation: Optional[str] = None
    phone: Optional[str] = None
    employee_id: Optional[str] = None
    reporting_to: Optional[str] = None
    joining_date: Optional[str] = None
    location: Optional[str] = None
    capacity_weekly: Optional[int] = 40

class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    role: Optional[str] = None
    department: Optional[str] = None
    designation: Optional[str] = None
    phone: Optional[str] = None
    employee_id: Optional[str] = None
    reporting_to: Optional[str] = None
    joining_date: Optional[str] = None
    location: Optional[str] = None
    capacity_weekly: Optional[int] = None
    is_active: Optional[bool] = None

class PasswordChange(BaseModel):
    new_password: str

def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


@router.get("")
async def list_users(
    department: Optional[str] = None,
    role: Optional[str] = None,
    is_active: Optional[bool] = None,
    actor: Actor = Depends(get_actor)
):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT v.id, v.email, v.full_name, v.role, v.role_name, v.role_level,
                   v.department, v.designation, v.phone, v.employee_id,
                   v.is_active, v.location, v.joining_date, v.last_login_at,
                   v.capacity_weekly, v.reporting_to_name, u.reporting_to
            FROM v_users_with_roles v
            JOIN users u ON u.id = v.id
            WHERE v.tenant_id = $1
              AND ($2::text IS NULL OR v.department = $2)
              AND ($3::text IS NULL OR v.role = $3)
              AND ($4::bool IS NULL OR v.is_active = $4)
        """, actor.tenant_id, department, role, is_active)
    return [dict(r) for r in rows]


@router.get("/me")
async def get_me(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            SELECT id, email, full_name, role, role_name, role_level,
                   department, designation, phone, employee_id,
                   is_active, location, capacity_weekly
            FROM v_users_with_roles
            WHERE tenant_id=$1 AND id=$2
        """, actor.tenant_id, actor.user_id)
    return dict(row) if row else {}

@router.put("/me")
async def update_me(body: dict, actor: Actor = Depends(get_actor)):
    allowed = ['full_name','phone','department','designation','location']
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        return {"updated": False}
    set_clause = ', '.join(f"{k}=${i+2}" for i, k in enumerate(updates.keys()))
    vals = list(updates.values())
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute(
            f"UPDATE users SET {set_clause} WHERE id=$1",
            actor.user_id, *vals)
    return {"updated": True}



@router.post("")
async def create_user(body: UserCreate, actor: Actor = Depends(require_role("admin", "manager"))):
    # Defensive: reporting_to is a UUID FK — an empty string (a "no
    # selection" default some caller forgot to convert to null, same bug
    # class documented repeatedly elsewhere in this project) crashes
    # asyncpg's ::uuid cast with a raw DataError instead of a clean 400.
    # The frontend already converts '' -> null before sending, but the
    # backend shouldn't depend on every caller remembering that.
    if body.reporting_to == "":
        body.reporting_to = None
    if body.joining_date == "":
        body.joining_date = None
    async with db.tenant_conn(actor.tenant_id) as conn:
        # Check email uniqueness
        exists = await conn.fetchval(
            "SELECT id FROM users WHERE email=$1", body.email)
        if exists:
            raise HTTPException(400, "Email already registered")
        # Validate role exists
        valid_role = await conn.fetchrow(
            "SELECT role_code, role_name FROM role_definitions "
            "WHERE tenant_id=$1 AND role_code=$2 AND is_active",
            actor.tenant_id, body.role)
        if not valid_role:
            raise HTTPException(400, f"Role '{body.role}' not found")
        row = await conn.fetchrow("""
            INSERT INTO users
              (tenant_id, email, password_hash, full_name, role,
               department, designation, phone, employee_id,
               reporting_to, joining_date, location, capacity_weekly, is_active)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::date,$12,$13,true)
            RETURNING id, email, full_name, role, department, designation,
                      phone, employee_id, joining_date, location, is_active
        """,
            actor.tenant_id, body.email, hash_pw(body.password),
            body.full_name, body.role, body.department, body.designation,
            body.phone, body.employee_id, body.reporting_to,
            body.joining_date, body.location, body.capacity_weekly or 40)
        # Read email settings INSIDE the connection block (before conn closes)
        _cfg = await conn.fetchrow(
            "SELECT smtp_host,smtp_port,smtp_user,smtp_password,smtp_from,smtp_from_name,smtp_tls FROM email_settings WHERE tenant_id=$1 AND is_active=TRUE",
            actor.tenant_id)
    # Send welcome email in background thread using pre-fetched SMTP settings
    try:
        import threading, smtplib as _smtp
        from email.mime.text import MIMEText as _MIMEText
        from email.mime.multipart import MIMEMultipart as _MIMEMulti
        if _cfg and _cfg["smtp_host"]:
            _h=_cfg["smtp_host"]; _p=_cfg["smtp_port"] or 587
            _u=_cfg["smtp_user"] or ""; _pw=_cfg["smtp_password"] or ""
            _f=_cfg["smtp_from"] or _u; _fn=_cfg["smtp_from_name"] or "AVIIN ATS"
            _tls=_cfg["smtp_tls"] if _cfg["smtp_tls"] is not None else True
            _to=body.email; _name=body.full_name; _pass=body.password; _role=body.role
            def _go(h=_h,p=_p,u=_u,pw=_pw,f=_f,fn=_fn,tls=_tls,to=_to,nm=_name,pa=_pass,rl=_role):
                try:
                    msg=_MIMEMulti()
                    msg["Subject"]="Your AVIIN ATS Login Credentials"
                    msg["From"]=f"{fn} <{f}>"
                    msg["To"]=to
                    lines = [
                        "Dear " + nm + ",",
                        "",
                        "Your AVIIN ATS account has been created.",
                        "",
                        "Login Details:",
                        "Website : https://ats.aviinjobs.com/login",
                        "Email   : " + to,
                        "Password: " + pa,
                        "Role    : " + rl,
                        "",
                        "Please login and change your password after first login.",
                        "",
                        "Best regards,",
                        "AVIIN Jobs Services",
                        "https://ats.aviinjobs.com",
                    ]
                    txt = chr(10).join(lines)
                    msg.attach(_MIMEText(txt,"plain"))
                    with _smtp.SMTP(h,p,timeout=10) as s:
                        s.ehlo()
                        if tls and p==587:
                            s.starttls(); s.ehlo()
                        if u: s.login(u,pw)
                        s.sendmail(f,[to],msg.as_string())
                    print(f"Invite sent to {to}")
                except Exception as ex:
                    print(f"Invite failed: {ex}")
            threading.Thread(target=_go,daemon=True).start()
        else:
            print("No active SMTP config - invite email skipped")
    except Exception as ex:
        print(f"Invite setup error: {ex}")
    return dict(row)

@router.get("/{user_id}")
async def get_user(user_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            SELECT v.*, u.reporting_to FROM v_users_with_roles v
            JOIN users u ON u.id = v.id
            WHERE v.tenant_id=$1 AND v.id=$2
        """, actor.tenant_id, user_id)
        if not row:
            raise HTTPException(404, "User not found")
    return dict(row)


@router.put("/{user_id}")
async def update_user(user_id: str, body: UserUpdate, actor: Actor = Depends(require_role("admin", "manager"))):
    # Same empty-string-to-UUID/date cast defensive fix as create_user.
    if body.reporting_to == "":
        body.reporting_to = None
    if body.joining_date == "":
        body.joining_date = None
    async with db.tenant_conn(actor.tenant_id) as conn:
        if body.role:
            valid = await conn.fetchval(
                "SELECT 1 FROM role_definitions WHERE tenant_id=$1 AND role_code=$2 AND is_active",
                actor.tenant_id, body.role)
            if not valid:
                raise HTTPException(400, f"Role '{body.role}' not found")
        row = await conn.fetchrow("""
            UPDATE users SET
              full_name      = COALESCE($1, full_name),
              role           = COALESCE($2, role),
              department     = COALESCE($3, department),
              designation    = COALESCE($4, designation),
              phone          = COALESCE($5, phone),
              employee_id    = COALESCE($6, employee_id),
              reporting_to   = COALESCE($7::uuid, reporting_to),
              joining_date   = COALESCE($8::date, joining_date),
              location       = COALESCE($9, location),
              capacity_weekly= COALESCE($10, capacity_weekly),
              is_active      = COALESCE($11, is_active)
            WHERE id=$12 AND tenant_id=$13
            RETURNING id, email, full_name, role, department, is_active
        """,
            body.full_name, body.role, body.department, body.designation,
            body.phone, body.employee_id, body.reporting_to,
            body.joining_date, body.location, body.capacity_weekly,
            body.is_active, user_id, actor.tenant_id)
        if not row:
            raise HTTPException(404, "User not found")
    return dict(row)


@router.patch("/{user_id}/password")
async def change_password(user_id: str, body: PasswordChange, actor: Actor = Depends(require_role("admin", "manager"))):
    if len(body.new_password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            UPDATE users SET password_hash=$1 WHERE id=$2 AND tenant_id=$3
            RETURNING id, email, full_name
        """, hash_pw(body.new_password), user_id, actor.tenant_id)
        if not row:
            raise HTTPException(404, "User not found")
    return {"message": "Password updated", "user": dict(row)}


@router.patch("/{user_id}/deactivate")
async def deactivate_user(user_id: str, actor: Actor = Depends(require_role("admin", "manager"))):
    if user_id == actor.user_id:
        raise HTTPException(400, "Cannot deactivate yourself")
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            UPDATE users SET is_active=false WHERE id=$1 AND tenant_id=$2
            RETURNING id, email, full_name, is_active
        """, user_id, actor.tenant_id)
        if not row:
            raise HTTPException(404, "User not found")
    return dict(row)


@router.patch("/{user_id}/activate")
async def activate_user(user_id: str, actor: Actor = Depends(require_role("admin", "manager"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            UPDATE users SET is_active=true WHERE id=$1 AND tenant_id=$2
            RETURNING id, email, full_name, is_active
        """, user_id, actor.tenant_id)
        if not row:
            raise HTTPException(404, "User not found")
    return dict(row)


@router.delete("/{user_id}")
async def delete_user(user_id: str, actor: Actor = Depends(require_role("admin", "manager"))):
    """Soft-delete (is_active=false) — same real DELETE-verb-backed-by-
    soft-delete convention already established for clients.py (a genuine
    hard DELETE on a user would throw FK violations against every real
    row referencing them — created_by, assigned_recruiter_id, audit_log
    actor, etc. — the exact bug class already found and fixed once for
    clients). Functionally the same effect as PATCH .../deactivate, just
    exposed under the verb an admin naturally reaches for when they mean
    "remove this person" (the frontend's Trash icon/confirm-dialog flow,
    previously imported but never wired to anything)."""
    if user_id == actor.user_id:
        raise HTTPException(400, "Cannot delete yourself")
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            UPDATE users SET is_active=false WHERE id=$1 AND tenant_id=$2
            RETURNING id, email, full_name, is_active
        """, user_id, actor.tenant_id)
        if not row:
            raise HTTPException(404, "User not found")
    return {"ok": True, "deleted": dict(row)}


@router.delete("/{user_id}/purge")
async def purge_user(user_id: str, actor: Actor = Depends(require_role("admin"))):
    """Real gap fix (2026-08-22): soft-delete (above) has no effect on a
    user who's already inactive — an admin re-clicking Delete on an
    already-`is_active:false` row (e.g. leftover QA/test fixtures) gets a
    real 200 back but the row visibly doesn't change, reading as "delete
    failed" even though the API call succeeded. This is the genuine,
    permanent removal such a row needs.

    Admin-only (stricter than the manager-allowed soft-delete above —
    this is irreversible). Requires the user to already be inactive, so
    an active real employee can never be purged in one step — they must
    be deactivated first, giving a deliberate pause before an
    irreversible action. Attempts a real hard DELETE; if this user has
    any genuine historical activity (they created a candidate, were
    assigned work, appear in audit_log, etc. — dozens of tables FK-
    reference users.id), Postgres rejects it with a ForeignKeyViolation,
    caught here and returned as a clear, honest 409 rather than a raw
    500 — that user's history is real and stays intact, only visible
    under Show Inactive forever, same as before. A genuinely fresh QA/
    test fixture with zero real references purges cleanly."""
    if user_id == actor.user_id:
        raise HTTPException(400, "Cannot delete yourself")
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT id, is_active FROM users WHERE id=$1 AND tenant_id=$2", user_id, actor.tenant_id)
        if not row:
            raise HTTPException(404, "User not found")
        if row["is_active"] is not False:
            raise HTTPException(400, "Deactivate this user first before permanently deleting them")
        try:
            await conn.execute("DELETE FROM users WHERE id=$1 AND tenant_id=$2", user_id, actor.tenant_id)
        except asyncpg.exceptions.ForeignKeyViolationError:
            raise HTTPException(
                409,
                "This user has real activity on record (candidates, assignments, audit history, etc.) "
                "and can't be permanently deleted — they'll stay hidden as Inactive instead.",
            )
    return {"ok": True, "purged": user_id}


@router.get("/stats/summary")
async def user_stats(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            SELECT
                COUNT(*) AS total_users,
                COUNT(*) FILTER (WHERE is_active) AS active_users,
                COUNT(*) FILTER (WHERE NOT COALESCE(is_active,true)) AS inactive_users,
                COUNT(DISTINCT department) AS departments
            FROM users WHERE tenant_id=$1
        """, actor.tenant_id)
        by_dept = await conn.fetch("""
            SELECT COALESCE(department,'Unassigned') AS department,
                   COUNT(*) AS count,
                   COUNT(*) FILTER (WHERE COALESCE(is_active,true)) AS active
            FROM users WHERE tenant_id=$1
            GROUP BY department ORDER BY count DESC
        """, actor.tenant_id)
        by_role = await conn.fetch("""
            SELECT u.role, COALESCE(rd.role_name,u.role) AS role_name,
                   COUNT(*) AS count
            FROM users u
            LEFT JOIN role_definitions rd ON rd.role_code=u.role AND rd.tenant_id=u.tenant_id
            WHERE u.tenant_id=$1
            GROUP BY u.role, rd.role_name ORDER BY count DESC
        """, actor.tenant_id)
    return {
        **dict(row),
        "by_department": [dict(r) for r in by_dept],
        "by_role":       [dict(r) for r in by_role],
    }


# ── ROLES management ──────────────────────────────────────────
roles_router = APIRouter(prefix="/roles", tags=["roles"])

def _role_dict(r):
    """asyncpg has no jsonb codec registered in this app, so a jsonb
    column comes back as a raw JSON string, not a dict — parse it here
    rather than pushing that leak onto every caller."""
    d = dict(r)
    perms = d.get('permissions')
    d['permissions'] = perms if isinstance(perms, dict) else json.loads(perms or "{}")
    return d

@roles_router.get("")
async def list_roles(department: Optional[str]=None, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT rd.*,
                   COUNT(u.id) AS user_count
            FROM role_definitions rd
            LEFT JOIN users u ON u.role=rd.role_code AND u.tenant_id=rd.tenant_id AND u.is_active IS NOT FALSE
            WHERE rd.tenant_id=$1 AND rd.is_active
              AND ($2::text IS NULL OR rd.department=$2)
            GROUP BY rd.id
            ORDER BY rd.department, rd.level DESC
        """, actor.tenant_id, department)
    return [_role_dict(r) for r in rows]

@roles_router.get("/departments")
async def list_departments(actor: Actor=Depends(get_actor)):
    return {"departments": DEPARTMENTS}

@roles_router.post("")
async def create_role(body: dict, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            INSERT INTO role_definitions
              (tenant_id,role_code,role_name,department,level,description,permissions)
            VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
            ON CONFLICT (tenant_id,role_code) DO UPDATE SET
              role_name=EXCLUDED.role_name, description=EXCLUDED.description
            RETURNING *
        """, actor.tenant_id, body.get('role_code'), body.get('role_name'),
             body.get('department','Delivery'), body.get('level',1),
             body.get('description'), json.dumps(body.get('permissions',{})))
    return _role_dict(row)

# ── Permissions (Settings > Permissions — real per-feature RBAC) ─────
# NOTE: these fixed-path routes (/features, /enforcement, /permission-log)
# MUST be registered before the /{role_id} routes below — FastAPI matches
# routes in registration order, so a /{role_id} route registered first
# would swallow e.g. PUT /roles/enforcement as if "enforcement" were a
# role_id (confirmed for real: this exact bug shipped once already and
# threw asyncpg.exceptions.DataError: invalid input for query argument
# $5: 'enforcement' (invalid UUID) before this block was moved here).
class PermissionsUpdate(BaseModel):
    permissions: dict


@roles_router.get("/features", tags=["permissions"])
async def list_permission_features(actor: Actor=Depends(get_actor)):
    """2026-08-17: feature-level permissions — groups mirrors the
    sidebar's own NAV_GROUPS so every group/feature here is a real page,
    not invented (see permissions.py's FEATURE_GROUPS). `features` is
    kept as a flat list too for any consumer that only wants the bare
    key/label pairs (matches the pre-existing response shape)."""
    return {
        "groups": [
            {"id": gid, "label": glabel, "features": [{"key": k, "label": l} for k, l in feats]}
            for gid, glabel, feats in FEATURE_GROUPS
        ],
        "features": [{"key": k, "label": lbl} for k, lbl in FEATURES],
        "actions": ACTIONS,
    }


class EnforcementUpdate(BaseModel):
    enabled: bool


@roles_router.get("/enforcement", tags=["permissions"])
async def get_enforcement(actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        enabled = await conn.fetchval(
            "SELECT permission_enforcement_enabled FROM tenants WHERE id=$1", actor.tenant_id)
    return {"enabled": bool(enabled)}


@roles_router.put("/enforcement", tags=["permissions"])
async def set_enforcement(body: EnforcementUpdate, actor: Actor=Depends(require_role("admin", "super_admin"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute(
            "UPDATE tenants SET permission_enforcement_enabled=$1 WHERE id=$2", body.enabled, actor.tenant_id)
    return {"enabled": body.enabled}


@roles_router.get("/permission-log", tags=["permissions"])
async def permission_log(days: int = 14, actor: Actor=Depends(require_role("admin", "super_admin"))):
    """Aggregated, not raw rows — an admin reviewing before flipping
    enforcement on needs "recruiter tried 'read' on 'companies' 47 times
    this week", not 47 individual timestamps."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT role_code, feature, action,
                   COUNT(*) AS attempts,
                   COUNT(DISTINCT user_id) AS distinct_users,
                   MAX(created_at) AS last_seen,
                   bool_or(would_have_blocked) AS would_block_if_enforced
            FROM permission_check_log
            WHERE tenant_id=$1 AND created_at >= now() - ($2 || ' days')::interval
            GROUP BY role_code, feature, action
            ORDER BY attempts DESC
        """, actor.tenant_id, str(days))
    return [dict(r) for r in rows]


@roles_router.put("/{role_id}")
async def update_role(role_id: str, body: dict, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            UPDATE role_definitions SET
              role_name=COALESCE($1,role_name),
              description=COALESCE($2,description),
              level=COALESCE($3,level),
              permissions=COALESCE($4::jsonb,permissions)
            WHERE id=$5 AND tenant_id=$6 AND NOT is_system
            RETURNING *
        """, body.get('role_name'), body.get('description'),
             body.get('level'), json.dumps(body['permissions']) if 'permissions' in body else None,
             role_id, actor.tenant_id)
        if not row:
            raise HTTPException(404, "Role not found or is a system role")
    return _role_dict(row)


@roles_router.put("/{role_id}/permissions", tags=["permissions"])
async def update_role_permissions(role_id: str, body: PermissionsUpdate,
                                    actor: Actor=Depends(require_role("admin", "super_admin"))):
    """Permissions-only edit, deliberately allowed on system roles (all 27
    seeded staffing roles have is_system=true) — the general PUT above
    protects rename/delete of foundational roles, but blocking permission
    edits on them too would make this whole feature unusable, since
    editing exactly those roles' access is the point."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "UPDATE role_definitions SET permissions=$1::jsonb WHERE id=$2 AND tenant_id=$3 RETURNING *",
            json.dumps(body.permissions), role_id, actor.tenant_id)
        if not row:
            raise HTTPException(404, "Role not found")
    return _role_dict(row)


class VisibilityUpdate(BaseModel):
    job_visibility_scope: str


@roles_router.put("/{role_id}/visibility", tags=["permissions"])
async def update_role_visibility(role_id: str, body: VisibilityUpdate,
                                   actor: Actor=Depends(require_role("admin", "super_admin"))):
    """Recommendation 2 (recruiter-assignment gap analysis): per-role
    'all jobs' vs 'assigned jobs only' scope, read by requisitions.py's
    GET /requisitions (which also backs the Pipeline board's job picker
    and the main Dashboard's Open Requisitions stat — same endpoint, one
    filter). Same is_system-exempt pattern as /permissions above."""
    if body.job_visibility_scope not in ("all", "assigned_only"):
        raise HTTPException(400, "job_visibility_scope must be 'all' or 'assigned_only'")
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "UPDATE role_definitions SET job_visibility_scope=$1 WHERE id=$2 AND tenant_id=$3 RETURNING *",
            body.job_visibility_scope, role_id, actor.tenant_id)
        if not row:
            raise HTTPException(404, "Role not found")
    return _role_dict(row)
