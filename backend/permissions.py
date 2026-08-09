"""Real per-feature, per-role access control.

role_definitions.permissions (JSONB, 27 seeded staffing roles) already
existed with genuinely detailed feature -> action maps — but nothing in
the whole backend ever read it before this file. This is the actual
enforcement layer, wired via require_permission() as a route dependency,
plus the read/lookup helpers the admin API and frontend matrix use.

Soft-launch by design: `tenants.permission_enforcement_enabled` defaults
FALSE for every tenant, so adding this dependency to a route never
immediately restricts anyone. Every would-be-denied check is logged to
permission_check_log regardless of whether enforcement is on, so an
admin can review real usage (Settings > Permissions > Activity Log)
before flipping the switch for real.

FEATURES below is the taxonomy shown in the admin matrix — it's larger
than the set of routes currently gated (see each router for where
require_permission() is actually applied); features not yet gated by
any route are still editable in the UI, they just aren't enforced yet.
"""
import json
from typing import Optional

from fastapi import Depends, HTTPException, Request

import db
from deps import Actor, get_actor

# (key, label) — order here is the order the admin matrix renders in.
FEATURES: list[tuple[str, str]] = [
    ("candidates", "Candidates"),
    ("companies", "Companies"),
    ("requisitions", "Jobs / Requisitions"),
    ("pipeline", "Pipeline (Kanban)"),
    ("applications", "Applications"),
    ("analytics", "Analytics & Reporting"),
    ("assessments", "Assessments"),
    ("incentives", "Incentives"),
    ("kae", "KAE / Account Ownership"),
    ("collections", "Collections"),
    ("account_pl", "Account P&L"),
    ("bu_tracker", "BU Tracker"),
]
ACTIONS: list[str] = ["create", "read", "update", "delete", "export"]
_FEATURE_KEYS = {f[0] for f in FEATURES}


async def get_role_permissions(conn, tenant_id: str, role_code: Optional[str]) -> Optional[dict]:
    """None means "no role_definitions row at all" (an unmigrated/legacy
    role) — distinct from {} (a real role with zero grants), since the
    former should never be silently locked out by this new system and
    the latter is a genuine, intentional "nothing" a real admin set."""
    if not role_code:
        return None
    row = await conn.fetchval(
        "SELECT permissions FROM role_definitions WHERE tenant_id=$1 AND role_code=$2 AND is_active",
        tenant_id, role_code)
    if row is None:
        return None
    return row if isinstance(row, dict) else json.loads(row or "{}")


def check_permission(permissions: Optional[dict], feature: str, action: str) -> Optional[bool]:
    """True/False if determinable, None if the role has no row at all
    (see get_role_permissions) — callers treat None as "allow, but this
    role needs real permissions configured"."""
    if permissions is None:
        return None
    wildcard = permissions.get("*")
    if wildcard and ("*" in wildcard or action in wildcard):
        return True
    feat_actions = permissions.get(feature)
    if feat_actions is None:
        return False
    return "*" in feat_actions or action in feat_actions


def require_permission(feature: str, action: str = "read"):
    """Route dependency. admin/super_admin and anonymous trusted-internal
    actors (role=None — n8n and similar automation paths, same exemption
    already established for require_role()) always pass. Everyone else
    is checked against their role's real permissions; a denial is logged
    to permission_check_log and only actually blocks the request if this
    tenant has enforcement turned on AND the role has a real (non-None)
    permissions row — a role with no row at all is never blocked, since
    that's a data gap for an admin to fix, not a reason to lock someone
    out with no way to self-correct."""

    async def dependency(request: Request, actor: Actor = Depends(get_actor)) -> Actor:
        if actor.role in ("admin", "super_admin") or actor.role is None:
            return actor

        async with db.tenant_conn(actor.tenant_id) as conn:
            enforcement_on = await conn.fetchval(
                "SELECT permission_enforcement_enabled FROM tenants WHERE id=$1", actor.tenant_id)
            permissions = await get_role_permissions(conn, actor.tenant_id, actor.role)
            allowed = check_permission(permissions, feature, action)

            if allowed is not True:
                await conn.execute(
                    """INSERT INTO permission_check_log
                         (tenant_id, user_id, role_code, feature, action, route, would_have_blocked)
                       VALUES ($1,$2,$3,$4,$5,$6,$7)""",
                    actor.tenant_id, actor.user_id, actor.role, feature, action,
                    f"{request.method} {request.url.path}",
                    bool(enforcement_on and permissions is not None),
                )

        if allowed is False and enforcement_on and permissions is not None:
            raise HTTPException(
                status_code=403,
                detail=f"Your role ('{actor.role}') does not have '{action}' access to '{feature}'",
            )
        return actor

    return dependency
