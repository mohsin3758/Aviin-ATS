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
