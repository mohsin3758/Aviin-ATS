"""User Management — staffing industry roles, user CRUD, permissions."""
import bcrypt
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
import db
from deps import Actor, get_actor

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
            SELECT id, email, full_name, role, role_name, role_level,
                   department, designation, phone, employee_id,
                   is_active, location, joining_date, last_login_at,
                   capacity_weekly, reporting_to_name
            FROM v_users_with_roles
            WHERE tenant_id = $1
              AND ($2::text IS NULL OR department = $2)
              AND ($3::text IS NULL OR role = $3)
              AND ($4::bool IS NULL OR is_active = $4)
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


@router.post("")
async def create_user(body: UserCreate, actor: Actor = Depends(get_actor)):
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
    return dict(row)


@router.get("/{user_id}")
async def get_user(user_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            SELECT * FROM v_users_with_roles WHERE tenant_id=$1 AND id=$2
        """, actor.tenant_id, user_id)
        if not row:
            raise HTTPException(404, "User not found")
    return dict(row)


@router.put("/{user_id}")
async def update_user(user_id: str, body: UserUpdate, actor: Actor = Depends(get_actor)):
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
async def change_password(user_id: str, body: PasswordChange, actor: Actor = Depends(get_actor)):
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
async def deactivate_user(user_id: str, actor: Actor = Depends(get_actor)):
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
async def activate_user(user_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            UPDATE users SET is_active=true WHERE id=$1 AND tenant_id=$2
            RETURNING id, email, full_name, is_active
        """, user_id, actor.tenant_id)
        if not row:
            raise HTTPException(404, "User not found")
    return dict(row)


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

@roles_router.get("")
async def list_roles(department: Optional[str]=None, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT rd.*,
                   COUNT(u.id) AS user_count
            FROM role_definitions rd
            LEFT JOIN users u ON u.role=rd.role_code AND u.tenant_id=rd.tenant_id
            WHERE rd.tenant_id=$1 AND rd.is_active
              AND ($2::text IS NULL OR rd.department=$2)
            GROUP BY rd.id
            ORDER BY rd.department, rd.level DESC
        """, actor.tenant_id, department)
    return [dict(r) for r in rows]

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
    return dict(row)

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
    return dict(row)
