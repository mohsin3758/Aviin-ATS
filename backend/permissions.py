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

2026-08-17: expanded from 12 broad modules to ~73 individual features,
grouped to mirror the sidebar's own NAV_GROUPS (frontend/components/
layout/Sidebar.tsx) 1:1 — every group/feature here is a real page, not
invented. The 12 keys already wired into a real require_permission()
call elsewhere in the backend (see the list below) keep their exact
original key string so those existing gates are untouched by this
expansion; only the label/grouping changed for a few of them.
"""
import json
from typing import Optional

from fastapi import Depends, HTTPException, Request

import db
from deps import Actor, get_actor

# (group_id, group_label, [(feature_key, feature_label), ...]) — order
# here is the order the admin matrix renders in. Feature keys marked
# "existing" below are the 12 already consumed by a real
# require_permission(feature, action) call in another router — renaming
# any of them would silently break that gate, so they keep their exact
# original string:
#   account_pl -> account_pl.py; collections -> account_pl.py;
#   bu_tracker -> account_pl.py; analytics -> analytics.py, p36_p42.py(x2);
#   applications -> applications.py; pipeline -> applications.py,
#   p36_p42.py, pipeline_p2.py(x2), requisitions.py; candidates ->
#   candidates.py(x4); companies -> clients.py(x5); incentives ->
#   incentives.py(x2); kae -> kae.py; recruiter_ops -> recruiter_ops.py(x7);
#   requisitions -> requisitions.py(x4).
FEATURE_GROUPS: list[tuple[str, str, list[tuple[str, str]]]] = [
    ("core", "Core Features", [
        ("dashboard", "Dashboard"),
        ("candidates", "Candidates"),
        ("companies", "Companies"),
        ("requisitions", "Jobs / Requisitions"),
        ("pipeline", "Pipeline (Kanban)"),
        ("applications", "Applications"),
        ("pipeline_velocity", "Pipeline Velocity"),
        ("duplicates", "Duplicate Candidates"),
        ("recruiter_ops", "Recruiter Ops"),
        ("assignment_dashboard", "Assignment Dashboard"),
        ("reminders", "Reminders & Follow-Ups"),
        ("device_monitoring", "Device Monitoring"),
        ("field_attendance", "Field Attendance"),
        ("shift_scheduling", "Shift Scheduling"),
    ]),
    ("ai", "AI & Intelligence", [
        ("ai_intelligence", "AI Intelligence"),
        ("ai_tools", "AI Tools"),
        ("predictive_hiring", "Predictive Hiring"),
    ]),
    ("recruitment", "Recruitment", [
        ("resume_inbox", "Resume Inbox"),
        ("interviews", "Interviews"),
        ("calendar", "Calendar"),
        ("video_screening", "Video Screening"),
        ("offer_engine", "Offer Engine"),
        ("nda_documents", "NDA Documents"),
        ("jd_templates", "JD Templates"),
        ("email_templates", "Email Templates"),
        ("question_bank", "Question Bank"),
        ("reference_checks", "Reference Checks"),
        ("submittals", "Submittals"),
        ("job_board", "Job Board"),
        ("job_sharing", "Job Sharing"),
        ("career_page", "Career Page"),
        ("onboarding", "Onboarding"),
        ("candidate_engagement", "Candidate Engagement"),
        ("captured_profiles", "Captured Profiles"),
    ]),
    ("analytics", "Analytics", [
        ("analytics", "Analytics"),
        ("reports", "Reports"),
        ("sla_dashboard", "SLA Dashboard"),
        ("revenue_forecast", "Revenue Forecast"),
        ("client_health", "Client Health"),
        ("clients_packs", "Clients & Packs"),
        ("headcount_plan", "Headcount Plan"),
        ("war_room", "War Room"),
        ("report_builder", "Report Builder"),
    ]),
    ("finance", "Finance", [
        ("erp_finance", "ERP / Finance"),
        ("account_pl", "Account P&L"),
        ("collections", "Collections"),
        ("bu_tracker", "BU Tracker"),
        ("ceo_dashboard", "CEO Dashboard"),
        ("compliance_pf_esi_tds", "PF/ESI/TDS"),
        ("salary_benchmark", "Salary Benchmark"),
    ]),
    ("incentives", "Incentives & KAE", [
        ("incentives", "Incentives"),
        ("kae", "KAE Module"),
    ]),
    ("bgv", "BGV & Compliance", [
        ("bgv_checks", "BGV Checks"),
        ("audit_log", "Audit Log"),
    ]),
    ("communication", "Communication", [
        ("email_communication", "Email Communication"),
        ("whatsapp_bot", "WhatsApp Bot"),
        ("whatsapp_stage_notifications", "WhatsApp Stage Notifications"),
        ("whatsapp_setup", "WhatsApp Setup"),
        ("sms_notifications", "SMS Notifications"),
        ("automations", "Automations"),
        ("nurture_sequences", "Nurture Sequences"),
        ("integrations", "Integrations"),
    ]),
    ("vendors", "Vendors", [
        ("vendor_analytics", "Vendor Analytics"),
        ("agency_portal", "Agency Portal"),
    ]),
    ("settings", "Settings", [
        ("users_roles", "Users & Roles"),
        ("permissions_settings", "Permissions"),
        ("pipeline_stages", "Pipeline Stages"),
        ("company_email_smtp", "Company Email (SMTP)"),
        ("email_signatures", "Email Signatures"),
        ("security_2fa", "Security / 2FA"),
        ("skills_taxonomy", "Skills Taxonomy"),
        ("themes", "Themes"),
        ("ops_settings", "Ops Settings"),
    ]),
    ("my_account", "My Account", [
        ("my_email_accounts", "My Email Accounts"),
        ("my_profile", "My Profile"),
    ]),
]

# Flattened (key, label) view — every consumer that only cares about a
# bare feature key (check_permission, require_permission callers, the
# admin matrix's legacy "features" field) keeps working unchanged.
FEATURES: list[tuple[str, str]] = [f for _, _, feats in FEATURE_GROUPS for f in feats]
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


async def get_job_visibility_scope(conn, tenant_id: str, role: Optional[str]) -> str:
    """'all' (see every open requisition) or 'assigned_only' (see only
    requisitions this user has an active assignment on) — a per-role
    setting on role_definitions.job_visibility_scope, edited from the same
    Settings > Permissions page as the feature/action matrix. Admin/super_
    admin and anonymous trusted-internal callers (role=None) always see
    'all', same exemption used throughout permissions.py/require_role().
    Defaults to 'all' for a role with no row (or no override) — this is a
    display filter, not a security boundary, so the safe default is the
    pre-existing unfiltered behavior, not a lockout."""
    if not role or role in ("admin", "super_admin"):
        return "all"
    scope = await conn.fetchval(
        "SELECT job_visibility_scope FROM role_definitions WHERE tenant_id=$1 AND role_code=$2 AND is_active",
        tenant_id, role)
    return scope or "all"


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
