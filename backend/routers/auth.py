"""Login + current-user endpoints.

Login resolves the tenant via `auth_lookup_user` (SECURITY DEFINER,
bypasses RLS) since app.tenant_id is unknown before the user's tenant
is identified — see NOTE in sql/01_phase1_schema.sql.
"""

from fastapi import APIRouter, Depends, HTTPException

import auth
import db
from deps import Actor, get_actor
from schemas import LoginRequest

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login")
async def login(body: LoginRequest):
    async with db.tenant_conn() as conn:
        row = await conn.fetchrow("SELECT * FROM auth_lookup_user($1)", body.email)

    if row is None or not auth.verify_password(body.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    # Real bug fix (2026-08-27): last_login_at had never been written on a
    # successful login anywhere in this codebase — the only write attempt
    # was on /logout (the wrong event for a column named "last_login_at"),
    # and even that had broken SQL ("WHERE id=" with no bound parameter)
    # silently swallowed by a bare try/except, so the column has been
    # permanently NULL for every user since it was added. Best-effort:
    # a failure here must never block a real login.
    try:
        async with db.tenant_conn(str(row["tenant_id"])) as _lconn:
            await _lconn.execute(
                "UPDATE users SET last_login_at=NOW() WHERE id=$1", row["user_id"])
    except Exception:
        pass

    claims = {
        "sub": str(row["user_id"]),
        "tenant_id": str(row["tenant_id"]),
        "role": row["role"],
        "email": body.email,
        "full_name": row["full_name"],
    }
    return {
        "access_token": auth.create_access_token(claims),
        "token_type": "bearer",
        "user": {k: v for k, v in claims.items()},
    }


@router.get("/me")
async def me(actor: Actor = Depends(get_actor)):
    if not actor.user_id:
        raise HTTPException(status_code=401, detail="Login required")
    return {
        "id": actor.user_id,
        "tenant_id": actor.tenant_id,
        "role": actor.role,
        "email": actor.email,
        "full_name": actor.full_name,
    }


@router.post("/change-password")
async def change_password(body: dict, actor: Actor = Depends(get_actor)):
    import bcrypt
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("SELECT password_hash FROM users WHERE id=$1", actor.user_id)
        if not row:
            raise HTTPException(404, "User not found")
        if not bcrypt.checkpw(body.current_password.encode(), row["password_hash"].encode()):
            raise HTTPException(400, "Current password is incorrect")
        if len(body.new_password) < 8:
            raise HTTPException(400, "Password must be at least 8 characters")
        new_hash = bcrypt.hashpw(body.new_password.encode(), bcrypt.gensalt()).decode()
        await conn.execute("UPDATE users SET password_hash=$1 WHERE id=$2", new_hash, actor.user_id)
    return {"changed": True}


@router.post('/logout')
async def logout(actor: Actor = Depends(get_actor)):
    """
    Logout endpoint. With stateless JWT the token expires naturally (7 days).
    The frontend clears the token from localStorage on this call.
    For immediate invalidation, implement a Redis blacklist here if needed.
    """
    return {'logged_out': True, 'message': 'Session cleared. Please discard your token.'}
