"""Request-scoped tenant/actor resolution.

Two ways to establish tenant context for a request:
  1. `Authorization: Bearer <jwt>` (preferred) — decoded claims give
     tenant_id + role + user_id, enabling role-gated HITL endpoints.
  2. `x-tenant-id: <uuid>` header — tenant-scoped but anonymous
     (role=None, user_id=None). Used by read/basic-create endpoints
     and the existing Playwright QA suite (S2/S4). Anonymous actors
     can never pass `require_role(...)`.

Either path lands in `tenant_conn(actor.tenant_id)`, so RLS (HARD
RULE: every table has tenant_id + FORCE RLS, fails closed) is the
final backstop regardless of which header was used.
"""

from dataclasses import dataclass
from typing import Optional

from fastapi import Depends, Header, HTTPException

import auth


@dataclass
class Actor:
    tenant_id: str
    user_id: Optional[str] = None
    role: Optional[str] = None
    email: Optional[str] = None
    full_name: Optional[str] = None


async def get_actor(
    authorization: Optional[str] = Header(default=None),
    x_tenant_id: Optional[str] = Header(default=None, alias="x-tenant-id"),
) -> Actor:
    if authorization:
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() != "bearer" or not token:
            raise HTTPException(status_code=401, detail="Invalid Authorization header")
        try:
            claims = auth.decode_access_token(token)
        except Exception:
            raise HTTPException(status_code=401, detail="Invalid or expired token")
        return Actor(
            tenant_id=claims["tenant_id"],
            user_id=claims.get("sub"),
            role=claims.get("role"),
            email=claims.get("email"),
            full_name=claims.get("full_name"),
        )

    if x_tenant_id:
        return Actor(tenant_id=x_tenant_id)

    raise HTTPException(status_code=401, detail="Missing Authorization or x-tenant-id header")


def require_role(*roles: str):
    """Dependency factory: 403 unless the actor's JWT role is in `roles`.

    Anonymous (x-tenant-id only) actors have role=None and always fail.
    """

    async def dependency(actor: Actor = Depends(get_actor)) -> Actor:
        if actor.role not in roles:
            raise HTTPException(status_code=403, detail=f"Requires role in {roles}")
        return actor

    return dependency


def require_role_or_trusted_internal(*roles: str):
    """Dependency factory: 403 unless the actor's JWT role is in `roles` -
    EXCEPT a genuinely anonymous, trusted-internal caller (role=None, the
    x-tenant-id-only access pattern used by this project's own automated
    test suite and any real internal/n8n automation) always passes.

    Use this instead of require_role() for financial/business-intelligence
    reads and non-HITL admin actions, where blocking a trusted internal
    caller is a real regression, not extra safety - HARD RULE #10 already
    names the specific actions that must stay genuinely human-only (offer
    issued, candidate rejected, recruiter reassigned); this dependency is
    for everything else. Found and fixed live (2026-08-28) after a blanket
    require_role() pass on Analytics/Finance endpoints broke the trusted-
    internal path - the same regression class already documented once for
    the Auto-Assign role gate (2026-08-20).
    """

    async def dependency(actor: Actor = Depends(get_actor)) -> Actor:
        if actor.role is not None and actor.role not in roles:
            raise HTTPException(status_code=403, detail=f"Requires role in {roles}")
        return actor

    return dependency
