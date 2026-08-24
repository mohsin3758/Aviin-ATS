"""Company-device activity monitoring: active-window/idle time + browsing
history on company-issued devices only. Transparent by design — a
recruiter must self-consent and self-generate an enrollment code before
any agent can enroll a device; there is no admin path to push this onto
someone silently.

Extended scope (2026-08-11, explicit reversal of the original "no
screenshots, no keystroke logging" decision, made after the user was
shown that original DPDP rationale in full): periodic screenshots +
on-demand live screen view, keystroke/mouse INTENSITY (counts/rate only
— never literal keys or click targets, so passwords/message content are
never captured), DLP detection (blocked-website visits, USB connection —
alert-only, not enforcement blocking), and a silent tracking mode. Gated
behind a SEPARATE 'extended' consent record from the base monitoring
consent — agreeing to active-window/browsing tracking does not imply
agreeing to screenshots or silent mode.

Two auth paths in this file:
  - Normal JWT (Actor/get_actor) for everything a logged-in human does:
    consenting, generating an enrollment code, viewing dashboards.
  - Device API key (get_device) for the agent itself: enroll completion,
    heartbeat, browsing/screenshot/intensity/DLP-event ingest. The agent
    never sees the recruiter's ATS password.
"""
import hashlib
import io
import json
import os
import secrets
import zipfile
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from pydantic import BaseModel

import db
from deps import Actor, get_actor, require_role

router = APIRouter(prefix="/device-monitoring", tags=["device-monitoring"])

MANAGE_ROLES = ("admin", "super_admin", "manager")
# The real agent source lives in the repo's top-level agent/ directory,
# but the backend's Docker build context is only ./backend (confirmed via
# docker-compose.yml: `build: ./backend`) — agent/ sits outside it and is
# never copied into the image. backend/agent_dist/ is a distributable
# copy kept in sync manually, specifically so this download endpoint has
# something real to serve without restructuring the Docker build context.
_AGENT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "agent_dist")

POLICY_VERSION = "2026-07-28.1"
POLICY_TEXT = (
    "Your company-issued laptop runs an activity monitoring agent while you "
    "are logged in. It records: (1) which application/window is active and "
    "for how long, including idle time, and (2) URLs visited in your work "
    "browser. It does NOT record keystrokes, passwords, screen content, or "
    "screenshots, and it does not run on personal devices. Monitoring "
    "applies only to this company-issued device. You can see your own "
    "collected data at any time, and you can revoke consent, which "
    "deactivates monitoring on your enrolled device(s)."
)

# Extended monitoring scope (Time Champ gap-analysis, 2026-08-11) — an
# explicit reversal of the original decision to exclude these items,
# made after the user was shown the original DPDP rationale in full.
# Kept as a SEPARATE consent record (consent_scope='extended') rather
# than silently widening basic consent — an employee who already agreed
# to active-window/browsing tracking did not thereby agree to
# screenshots or silent mode.
EXTENDED_POLICY_VERSION = "2026-08-11.1"
EXTENDED_POLICY_TEXT = (
    "In addition to the basic monitoring above, your employer may enable: "
    "(1) periodic screenshots of your screen (interval configurable by your "
    "employer, may be blurred), (2) an on-demand live screen view your "
    "manager can request at any time, (3) keystroke and mouse activity "
    "INTENSITY — the RATE/COUNT of keys pressed and clicks made, never the "
    "actual keys typed or content clicked, so passwords and message content "
    "are never captured, (4) detection of visits to a company-configured "
    "list of blocked websites and connection of USB storage devices (alerts "
    "only — this does not block access), and (5) a silent tracking mode "
    "where the agent runs without a visible tray icon. You can see your own "
    "collected data (including all screenshots) at any time, and revoking "
    "this consent turns off screenshots, live view, intensity tracking, DLP "
    "detection, and silent mode on your device(s) — basic monitoring "
    "continues under your original consent unless you revoke that too."
)


def _hash_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode()).hexdigest()


@dataclass
class DeviceActor:
    tenant_id: str
    user_id: str
    device_id: str


async def get_device(x_device_key: Optional[str] = Header(default=None)) -> DeviceActor:
    if not x_device_key:
        raise HTTPException(status_code=401, detail="Missing X-Device-Key header")
    key_hash = _hash_key(x_device_key)
    # Tenant is unknown until the key is resolved — same "cast '' to uuid"
    # problem as every other token-based public flow, same fix: a
    # SECURITY DEFINER function (owned by postgres) that bypasses RLS for
    # this one lookup only.
    async with db.system_conn() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM get_device_by_key_hash($1)", key_hash,
        )
    if row is None or not row["is_active"]:
        raise HTTPException(status_code=401, detail="Invalid or deactivated device key")
    return DeviceActor(tenant_id=str(row["tenant_id"]), user_id=str(row["user_id"]), device_id=str(row["id"]))


# ── Consent (self-service, JWT auth) ────────────────────────────────────────

class ConsentIn(BaseModel):
    consent_given: bool


@router.get("/policy")
async def get_policy():
    return {"policy_version": POLICY_VERSION, "policy_text": POLICY_TEXT}


@router.get("/consent/status")
async def consent_status(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """SELECT consent_given, policy_version, created_at FROM device_monitoring_consent
               WHERE tenant_id=$1 AND user_id=$2 AND consent_scope='basic' AND revoked_at IS NULL
               ORDER BY created_at DESC LIMIT 1""",
            actor.tenant_id, actor.user_id,
        )
    active = bool(row and row["consent_given"] and row["policy_version"] == POLICY_VERSION)
    return {"has_active_consent": active, "record": dict(row) if row else None}


@router.post("/consent")
async def give_consent(body: ConsentIn, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """INSERT INTO device_monitoring_consent
                 (tenant_id, user_id, policy_version, consent_text, consent_given)
               VALUES ($1,$2,$3,$4,$5) RETURNING *""",
            actor.tenant_id, actor.user_id, POLICY_VERSION, POLICY_TEXT, body.consent_given,
        )
    return dict(row)


@router.post("/consent/revoke")
async def revoke_consent(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute(
            """UPDATE device_monitoring_consent SET revoked_at=now()
               WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL""",
            actor.tenant_id, actor.user_id,
        )
        await conn.execute(
            "UPDATE monitored_devices SET is_active=false WHERE tenant_id=$1 AND user_id=$2",
            actor.tenant_id, actor.user_id,
        )
    return {"revoked": True}


# ── Extended consent (screenshots/keystroke-intensity/DLP/silent mode) ─────

@router.get("/extended-policy")
async def get_extended_policy():
    return {"policy_version": EXTENDED_POLICY_VERSION, "policy_text": EXTENDED_POLICY_TEXT}


@router.get("/consent/extended-status")
async def extended_consent_status(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """SELECT consent_given, policy_version, created_at FROM device_monitoring_consent
               WHERE tenant_id=$1 AND user_id=$2 AND consent_scope='extended' AND revoked_at IS NULL
               ORDER BY created_at DESC LIMIT 1""",
            actor.tenant_id, actor.user_id,
        )
    active = bool(row and row["consent_given"] and row["policy_version"] == EXTENDED_POLICY_VERSION)
    return {"has_active_consent": active, "record": dict(row) if row else None}


@router.post("/consent/extended")
async def give_extended_consent(body: ConsentIn, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """INSERT INTO device_monitoring_consent
                 (tenant_id, user_id, policy_version, consent_text, consent_given, consent_scope)
               VALUES ($1,$2,$3,$4,$5,'extended') RETURNING *""",
            actor.tenant_id, actor.user_id, EXTENDED_POLICY_VERSION, EXTENDED_POLICY_TEXT, body.consent_given,
        )
    return dict(row)


@router.post("/consent/extended/revoke")
async def revoke_extended_consent(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute(
            """UPDATE device_monitoring_consent SET revoked_at=now()
               WHERE tenant_id=$1 AND user_id=$2 AND consent_scope='extended' AND revoked_at IS NULL""",
            actor.tenant_id, actor.user_id,
        )
        # Turn off every extended-scope feature on this user's devices —
        # basic monitoring (active-window/browsing) continues under their
        # separate basic consent unless that's revoked too.
        await conn.execute(
            """UPDATE monitored_devices SET screenshots_enabled=false, tracking_mode='visible'
               WHERE tenant_id=$1 AND user_id=$2""",
            actor.tenant_id, actor.user_id,
        )
    return {"revoked": True}


@router.get("/consent/roster")
async def consent_roster(actor: Actor = Depends(require_role(*MANAGE_ROLES))):
    """Real gap found 2026-08-11: Team Overview only ever showed people
    who had *already* enrolled a device — a manager rolling this out had
    no way to see who on the team still hadn't consented at all. One
    roster row per active user, real consent/device counts, not a guess."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            """SELECT u.id AS user_id, u.full_name, u.email,
                      c.consent_given AND c.revoked_at IS NULL AND c.policy_version=$2 AS has_active_consent,
                      c.created_at AS consented_at,
                      (SELECT count(*) FROM monitored_devices d
                         WHERE d.tenant_id=$1 AND d.user_id=u.id AND d.is_active) AS active_device_count
               FROM users u
               LEFT JOIN LATERAL (
                 SELECT consent_given, revoked_at, policy_version, created_at
                 FROM device_monitoring_consent
                 WHERE tenant_id=$1 AND user_id=u.id AND consent_scope='basic'
                 ORDER BY created_at DESC LIMIT 1
               ) c ON true
               WHERE u.tenant_id=$1 AND u.is_active
               ORDER BY has_active_consent DESC NULLS LAST, u.full_name""",
            actor.tenant_id, POLICY_VERSION,
        )
    return [dict(r) for r in rows]


# ── Enrollment (recruiter generates a code, agent redeems it) ──────────────

@router.post("/enrollment-token")
async def create_enrollment_token(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        consent = await conn.fetchval(
            """SELECT 1 FROM device_monitoring_consent
               WHERE tenant_id=$1 AND user_id=$2 AND consent_given AND revoked_at IS NULL
                 AND policy_version=$3""",
            actor.tenant_id, actor.user_id, POLICY_VERSION,
        )
        if not consent:
            raise HTTPException(status_code=403, detail="Give consent before generating an enrollment code")
        token = secrets.token_hex(4).upper()
        expires = datetime.now(timezone.utc) + timedelta(minutes=15)
        await conn.execute(
            """INSERT INTO device_enrollment_tokens (tenant_id, user_id, token, expires_at)
               VALUES ($1,$2,$3,$4)""",
            actor.tenant_id, actor.user_id, token, expires,
        )
    return {"token": token, "expires_at": expires.isoformat()}


class EnrollIn(BaseModel):
    token: str
    hostname: str
    os: Optional[str] = None
    device_fingerprint: str
    agent_version: Optional[str] = None


@router.post("/enroll")
async def enroll_device(body: EnrollIn):
    raw_key = secrets.token_urlsafe(32)
    key_hash = _hash_key(raw_key)
    # Token validation + device upsert must happen atomically and without
    # knowing the tenant ahead of time — one SECURITY DEFINER function
    # (owned by postgres) does both, same reasoning as get_device above.
    async with db.system_conn() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM redeem_device_enrollment($1,$2,$3,$4,$5,$6)",
            body.token, body.hostname, body.os, body.device_fingerprint,
            body.agent_version, key_hash,
        )
    if row is None or row["device_id"] is None:
        raise HTTPException(status_code=400, detail="Invalid, used, or expired enrollment code")
    return {"device_id": str(row["device_id"]), "device_api_key": raw_key}


# ── Device settings (extended-scope features, JWT auth) ─────────────────────

class DeviceSettingsIn(BaseModel):
    tracking_mode: Optional[str] = None  # 'visible' | 'silent'
    screenshot_interval_minutes: Optional[int] = None
    screenshots_enabled: Optional[bool] = None
    blur_screenshots: Optional[bool] = None


@router.patch("/devices/{device_id}/settings")
async def update_device_settings(device_id: str, body: DeviceSettingsIn, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        device = await conn.fetchrow("SELECT user_id FROM monitored_devices WHERE id=$1 AND tenant_id=$2", device_id, actor.tenant_id)
        if not device:
            raise HTTPException(status_code=404, detail="Device not found")
        if actor.role not in MANAGE_ROLES and device["user_id"] != actor.user_id:
            raise HTTPException(status_code=403, detail="Not your device")
        target_user = str(device["user_id"])
        # Screenshots/silent-mode/etc. require the EXTENDED consent
        # specifically -- basic consent alone doesn't cover these.
        if body.screenshots_enabled or (body.tracking_mode == "silent"):
            consent = await conn.fetchval(
                """SELECT 1 FROM device_monitoring_consent
                   WHERE tenant_id=$1 AND user_id=$2 AND consent_scope='extended'
                     AND consent_given AND revoked_at IS NULL AND policy_version=$3""",
                actor.tenant_id, target_user, EXTENDED_POLICY_VERSION,
            )
            if not consent:
                raise HTTPException(status_code=403, detail="Extended monitoring consent required before enabling this feature")
        if body.tracking_mode is not None and body.tracking_mode not in ("visible", "silent"):
            raise HTTPException(status_code=400, detail="tracking_mode must be 'visible' or 'silent'")
        row = await conn.fetchrow(
            """UPDATE monitored_devices SET
                 tracking_mode = COALESCE($1, tracking_mode),
                 screenshot_interval_minutes = COALESCE($2, screenshot_interval_minutes),
                 screenshots_enabled = COALESCE($3, screenshots_enabled),
                 blur_screenshots = COALESCE($4, blur_screenshots)
               WHERE id=$5 RETURNING *""",
            body.tracking_mode, body.screenshot_interval_minutes,
            body.screenshots_enabled, body.blur_screenshots, device_id,
        )
    return dict(row)


@router.post("/devices/{device_id}/live-view/request")
async def request_live_view(device_id: str, actor: Actor = Depends(require_role(*MANAGE_ROLES))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        device = await conn.fetchrow(
            "SELECT id, user_id FROM monitored_devices WHERE id=$1 AND tenant_id=$2 AND is_active", device_id, actor.tenant_id)
        if not device:
            raise HTTPException(status_code=404, detail="Device not found")
        consent = await conn.fetchval(
            """SELECT 1 FROM device_monitoring_consent
               WHERE tenant_id=$1 AND user_id=$2 AND consent_scope='extended'
                 AND consent_given AND revoked_at IS NULL AND policy_version=$3""",
            actor.tenant_id, device["user_id"], EXTENDED_POLICY_VERSION,
        )
        if not consent:
            raise HTTPException(status_code=403, detail="This user has not consented to extended monitoring")
        await conn.execute(
            "UPDATE monitored_devices SET live_view_requested_at=now(), live_view_requested_by=$1 WHERE id=$2",
            actor.user_id, device_id,
        )
    return {"requested": True}


@router.get("/devices/{device_id}/live-view")
async def get_live_view(device_id: str, actor: Actor = Depends(require_role(*MANAGE_ROLES))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        device = await conn.fetchrow(
            "SELECT live_view_requested_at FROM monitored_devices WHERE id=$1 AND tenant_id=$2", device_id, actor.tenant_id)
        if not device:
            raise HTTPException(status_code=404, detail="Device not found")
        shot = await conn.fetchrow(
            """SELECT id, captured_at, is_blurred FROM device_screenshots
               WHERE tenant_id=$1 AND device_id=$2 ORDER BY captured_at DESC LIMIT 1""",
            actor.tenant_id, device_id,
        )
    if not shot or not device["live_view_requested_at"]:
        return {"ready": False, "screenshot": None}
    # "Live" = the freshest capture is newer than the request itself.
    ready = shot["captured_at"] >= device["live_view_requested_at"]
    return {"ready": ready, "screenshot": dict(shot) if ready else None}


# ── Agent ingest (device-key auth) ──────────────────────────────────────────

class ActivityEntry(BaseModel):
    app_name: Optional[str] = None
    window_title: Optional[str] = None
    started_at: datetime
    ended_at: datetime
    is_idle: bool = False


class ActivityBatch(BaseModel):
    entries: List[ActivityEntry]


@router.post("/heartbeat")
async def post_activity(body: ActivityBatch, device: DeviceActor = Depends(get_device)):
    if not body.entries:
        return {"accepted": 0}
    async with db.tenant_conn(device.tenant_id) as conn:
        await conn.executemany(
            """INSERT INTO device_activity_log
                 (tenant_id, device_id, user_id, app_name, window_title, started_at, ended_at, is_idle)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)""",
            [
                (device.tenant_id, device.device_id, device.user_id, e.app_name,
                 (e.window_title or "")[:500], e.started_at, e.ended_at, e.is_idle)
                for e in body.entries
            ],
        )
        await conn.execute(
            "UPDATE monitored_devices SET last_heartbeat_at=now() WHERE id=$1", device.device_id,
        )
    return {"accepted": len(body.entries)}


class BrowsingEntry(BaseModel):
    url: str
    page_title: Optional[str] = None
    browser: Optional[str] = None
    visited_at: datetime


class BrowsingBatch(BaseModel):
    entries: List[BrowsingEntry]


@router.post("/browsing")
async def post_browsing(body: BrowsingBatch, device: DeviceActor = Depends(get_device)):
    if not body.entries:
        return {"accepted": 0}
    async with db.tenant_conn(device.tenant_id) as conn:
        await conn.executemany(
            """INSERT INTO device_browsing_history
                 (tenant_id, device_id, user_id, url, page_title, browser, visited_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7)""",
            [
                (device.tenant_id, device.device_id, device.user_id,
                 e.url[:2000], (e.page_title or "")[:300], e.browser, e.visited_at)
                for e in body.entries
            ],
        )
    return {"accepted": len(body.entries)}


SCREENSHOT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "uploads", "device-screenshots")


class ScreenshotIn(BaseModel):
    captured_at: datetime
    image_base64: str  # PNG/JPEG bytes, base64-encoded
    is_blurred: bool = False


@router.post("/screenshots")
async def post_screenshot(body: ScreenshotIn, device: DeviceActor = Depends(get_device)):
    import base64
    async with db.tenant_conn(device.tenant_id) as conn:
        settings = await conn.fetchrow(
            "SELECT screenshots_enabled FROM monitored_devices WHERE id=$1", device.device_id)
        if not settings or not settings["screenshots_enabled"]:
            raise HTTPException(status_code=403, detail="Screenshots not enabled for this device")
        os.makedirs(SCREENSHOT_DIR, exist_ok=True)
        fname = f"{device.device_id}_{secrets.token_hex(6)}.jpg"
        fpath = os.path.join(SCREENSHOT_DIR, fname)
        try:
            with open(fpath, "wb") as f:
                f.write(base64.b64decode(body.image_base64))
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid image data")
        row = await conn.fetchrow(
            """INSERT INTO device_screenshots (tenant_id, device_id, user_id, file_path, is_blurred, captured_at)
               VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, captured_at""",
            device.tenant_id, device.device_id, device.user_id,
            f"device-screenshots/{fname}", body.is_blurred, body.captured_at,
        )
    return {"id": str(row["id"]), "captured_at": row["captured_at"].isoformat()}


class IntensityEntry(BaseModel):
    window_start: datetime
    window_end: datetime
    keystroke_count: int = 0
    mouse_click_count: int = 0
    mouse_move_px: int = 0


class IntensityBatch(BaseModel):
    entries: List[IntensityEntry]


@router.post("/intensity")
async def post_intensity(body: IntensityBatch, device: DeviceActor = Depends(get_device)):
    if not body.entries:
        return {"accepted": 0}
    async with db.tenant_conn(device.tenant_id) as conn:
        await conn.executemany(
            """INSERT INTO device_intensity_metrics
                 (tenant_id, device_id, user_id, window_start, window_end,
                  keystroke_count, mouse_click_count, mouse_move_px)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)""",
            [
                (device.tenant_id, device.device_id, device.user_id,
                 e.window_start, e.window_end, e.keystroke_count, e.mouse_click_count, e.mouse_move_px)
                for e in body.entries
            ],
        )
    return {"accepted": len(body.entries)}


@router.get("/my-settings")
async def get_my_settings(device: DeviceActor = Depends(get_device)):
    """Device-key auth -- the agent polls this each cycle to pick up
    setting changes (silent mode, screenshot interval, a pending live-view
    request) without needing a restart."""
    async with db.tenant_conn(device.tenant_id) as conn:
        row = await conn.fetchrow(
            """WITH latest_shot AS (
                 SELECT MAX(captured_at) AS captured_at FROM device_screenshots WHERE device_id=$1
               )
               SELECT d.tracking_mode, d.screenshot_interval_minutes, d.screenshots_enabled,
                      d.blur_screenshots, d.live_view_requested_at,
                      (d.live_view_requested_at IS NOT NULL AND
                       (s.captured_at IS NULL OR d.live_view_requested_at > s.captured_at)) AS live_view_pending
               FROM monitored_devices d, latest_shot s
               WHERE d.id=$1""",
            device.device_id,
        )
    return dict(row) if row else {}


@router.get("/dlp-policies/active")
async def get_active_dlp_policies(device: DeviceActor = Depends(get_device)):
    """Device-key auth -- the agent fetches its own tenant's current
    policies on each heartbeat so blocklist/USB-restriction changes take
    effect without an agent restart."""
    async with db.tenant_conn(device.tenant_id) as conn:
        rows = await conn.fetch(
            "SELECT policy_type, rule FROM device_dlp_policies WHERE tenant_id=$1 AND is_active",
            device.tenant_id,
        )
    return {
        "blocked_domains": [r["rule"] for r in rows if r["policy_type"] == "website_blocklist"],
        "usb_restricted": any(r["policy_type"] == "usb_restriction" for r in rows),
    }


class DlpEventIn(BaseModel):
    event_type: str  # 'blocked_website_visited' | 'usb_connected'
    detail: Optional[str] = None
    occurred_at: datetime


@router.post("/dlp-events")
async def post_dlp_event(body: DlpEventIn, device: DeviceActor = Depends(get_device)):
    if body.event_type not in ("blocked_website_visited", "usb_connected"):
        raise HTTPException(status_code=400, detail="Invalid event_type")
    async with db.tenant_conn(device.tenant_id) as conn:
        row = await conn.fetchrow(
            """INSERT INTO device_dlp_events (tenant_id, device_id, user_id, event_type, detail, occurred_at)
               VALUES ($1,$2,$3,$4,$5,$6) RETURNING id""",
            device.tenant_id, device.device_id, device.user_id, body.event_type, body.detail, body.occurred_at,
        )
    return {"id": str(row["id"])}


# ── Dashboards (JWT auth; recruiters see only their own data) ──────────────

def _scope_user_id(actor: Actor, requested_user_id: Optional[str]) -> Optional[str]:
    if actor.role in MANAGE_ROLES:
        return requested_user_id
    return actor.user_id


@router.get("/devices")
async def list_devices(user_id: Optional[str] = None, actor: Actor = Depends(get_actor)):
    scoped = _scope_user_id(actor, user_id)
    async with db.tenant_conn(actor.tenant_id) as conn:
        if scoped:
            rows = await conn.fetch(
                """SELECT d.*, u.full_name FROM monitored_devices d
                   JOIN users u ON u.id = d.user_id
                   WHERE d.tenant_id=$1 AND d.user_id=$2 ORDER BY d.enrolled_at DESC""",
                actor.tenant_id, scoped,
            )
        else:
            # REAL BUG FIX (2026-08-24): Team Overview's device roster had no
            # u.is_active filter -- same "missing is_active on a joined
            # users table" class documented repeatedly elsewhere in this
            # project. The self-scoped branch above deliberately keeps
            # no filter -- a user viewing their own devices should never
            # be hidden from their own self-service page.
            rows = await conn.fetch(
                """SELECT d.*, u.full_name FROM monitored_devices d
                   JOIN users u ON u.id = d.user_id AND u.is_active IS NOT FALSE
                   WHERE d.tenant_id=$1 ORDER BY d.enrolled_at DESC""",
                actor.tenant_id,
            )
    return [dict(r) for r in rows]


@router.delete("/devices/{device_id}")
async def deactivate_device(device_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("SELECT user_id FROM monitored_devices WHERE id=$1 AND tenant_id=$2", device_id, actor.tenant_id)
        if not row:
            raise HTTPException(status_code=404, detail="Device not found")
        if actor.role not in MANAGE_ROLES and row["user_id"] != actor.user_id:
            raise HTTPException(status_code=403, detail="Not your device")
        await conn.execute("UPDATE monitored_devices SET is_active=false WHERE id=$1", device_id)
    return {"deactivated": True}


@router.get("/summary")
async def activity_summary(
    user_id: Optional[str] = None, days: int = 7, actor: Actor = Depends(get_actor),
):
    scoped = _scope_user_id(actor, user_id)
    since = datetime.now(timezone.utc) - timedelta(days=days)
    async with db.tenant_conn(actor.tenant_id) as conn:
        base_where = "tenant_id=$1 AND started_at >= $2"
        params = [actor.tenant_id, since]
        if scoped:
            base_where += " AND user_id=$3"
            params.append(scoped)

        active_seconds = await conn.fetch(
            f"""SELECT user_id, date_trunc('day', started_at) AS day,
                       SUM(EXTRACT(EPOCH FROM (ended_at - started_at)))
                         FILTER (WHERE NOT is_idle) AS active_seconds
                FROM device_activity_log WHERE {base_where}
                GROUP BY user_id, day ORDER BY day DESC""",
            *params,
        )
        top_apps = await conn.fetch(
            f"""SELECT user_id, app_name,
                       SUM(EXTRACT(EPOCH FROM (ended_at - started_at))) AS seconds
                FROM device_activity_log WHERE {base_where} AND NOT is_idle AND app_name IS NOT NULL
                GROUP BY user_id, app_name ORDER BY seconds DESC LIMIT 20""",
            *params,
        )

        browse_where = "tenant_id=$1 AND visited_at >= $2"
        bparams = [actor.tenant_id, since]
        if scoped:
            browse_where += " AND user_id=$3"
            bparams.append(scoped)
        top_domains = await conn.fetch(
            f"""SELECT user_id,
                       regexp_replace(regexp_replace(url, '^https?://', ''), '/.*$', '') AS domain,
                       count(*) AS visits
                FROM device_browsing_history WHERE {browse_where}
                GROUP BY user_id, domain ORDER BY visits DESC LIMIT 20""",
            *bparams,
        )
    return {
        "daily_active_time": [dict(r) for r in active_seconds],
        "top_apps": [dict(r) for r in top_apps],
        "top_domains": [dict(r) for r in top_domains],
    }


@router.get("/browsing-history")
async def browsing_history(
    user_id: Optional[str] = None, days: int = 7, limit: int = 200,
    actor: Actor = Depends(get_actor),
):
    # Raw URL-level history is more sensitive than the aggregate summary —
    # managers can view any recruiter's; recruiters can only view their own
    # (transparency: you can always see exactly what's collected about you).
    scoped = _scope_user_id(actor, user_id) or actor.user_id
    since = datetime.now(timezone.utc) - timedelta(days=days)
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            """SELECT url, page_title, browser, visited_at FROM device_browsing_history
               WHERE tenant_id=$1 AND user_id=$2 AND visited_at >= $3
               ORDER BY visited_at DESC LIMIT $4""",
            actor.tenant_id, scoped, since, limit,
        )
    return [dict(r) for r in rows]


# ── Screenshots (JWT auth; same self/manager scoping as browsing history) ──

@router.get("/screenshots")
async def list_screenshots(
    user_id: Optional[str] = None, days: int = 7, limit: int = 100,
    actor: Actor = Depends(get_actor),
):
    scoped = _scope_user_id(actor, user_id) or actor.user_id
    since = datetime.now(timezone.utc) - timedelta(days=days)
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            """SELECT id, captured_at, is_blurred FROM device_screenshots
               WHERE tenant_id=$1 AND user_id=$2 AND captured_at >= $3
               ORDER BY captured_at DESC LIMIT $4""",
            actor.tenant_id, scoped, since, limit,
        )
    return [dict(r) for r in rows]


@router.get("/screenshots/{screenshot_id}/image")
async def get_screenshot_image(screenshot_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT file_path, user_id FROM device_screenshots WHERE id=$1 AND tenant_id=$2",
            screenshot_id, actor.tenant_id,
        )
    if not row:
        raise HTTPException(status_code=404, detail="Screenshot not found")
    if actor.role not in MANAGE_ROLES and str(row["user_id"]) != str(actor.user_id):
        raise HTTPException(status_code=403, detail="Not your screenshot")
    fpath = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "uploads", row["file_path"])
    if not os.path.isfile(fpath):
        raise HTTPException(status_code=404, detail="Image file missing")
    with open(fpath, "rb") as f:
        content = f.read()
    return Response(content=content, media_type="image/jpeg")


# ── Keystroke/mouse intensity (JWT auth) — counts/rate only, never content ─

@router.get("/intensity-summary")
async def intensity_summary(user_id: Optional[str] = None, days: int = 7, actor: Actor = Depends(get_actor)):
    scoped = _scope_user_id(actor, user_id) or actor.user_id
    since = datetime.now(timezone.utc) - timedelta(days=days)
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            """SELECT date_trunc('day', window_start) AS day,
                      SUM(keystroke_count) AS keystrokes,
                      SUM(mouse_click_count) AS mouse_clicks,
                      SUM(mouse_move_px) AS mouse_move_px
               FROM device_intensity_metrics
               WHERE tenant_id=$1 AND user_id=$2 AND window_start >= $3
               GROUP BY day ORDER BY day DESC""",
            actor.tenant_id, scoped, since,
        )
    return [dict(r) for r in rows]


# ── DLP: policies (admin/manager) + events (JWT, scoped) ───────────────────

class DlpPolicyIn(BaseModel):
    policy_type: str  # 'website_blocklist' | 'usb_restriction'
    rule: str


@router.get("/dlp-policies")
async def list_dlp_policies(actor: Actor = Depends(require_role(*MANAGE_ROLES))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            "SELECT * FROM device_dlp_policies WHERE tenant_id=$1 ORDER BY created_at DESC", actor.tenant_id)
    return [dict(r) for r in rows]


@router.post("/dlp-policies")
async def create_dlp_policy(body: DlpPolicyIn, actor: Actor = Depends(require_role(*MANAGE_ROLES))):
    if body.policy_type not in ("website_blocklist", "usb_restriction"):
        raise HTTPException(status_code=400, detail="Invalid policy_type")
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """INSERT INTO device_dlp_policies (tenant_id, policy_type, rule, created_by)
               VALUES ($1,$2,$3,$4) RETURNING *""",
            actor.tenant_id, body.policy_type, body.rule, actor.user_id,
        )
    return dict(row)


@router.delete("/dlp-policies/{policy_id}")
async def deactivate_dlp_policy(policy_id: str, actor: Actor = Depends(require_role(*MANAGE_ROLES))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "UPDATE device_dlp_policies SET is_active=false WHERE id=$1 AND tenant_id=$2 RETURNING id",
            policy_id, actor.tenant_id,
        )
    if not row:
        raise HTTPException(status_code=404, detail="Policy not found")
    return {"deactivated": True}


@router.get("/dlp-events")
async def list_dlp_events(user_id: Optional[str] = None, days: int = 30, limit: int = 100, actor: Actor = Depends(get_actor)):
    scoped = _scope_user_id(actor, user_id) or actor.user_id
    since = datetime.now(timezone.utc) - timedelta(days=days)
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            """SELECT e.*, u.full_name FROM device_dlp_events e JOIN users u ON u.id = e.user_id
               WHERE e.tenant_id=$1 AND e.user_id=$2 AND e.occurred_at >= $3
               ORDER BY e.occurred_at DESC LIMIT $4""",
            actor.tenant_id, scoped, since, limit,
        )
    return [dict(r) for r in rows]


# ── Data export (DPDP 2023 access/portability) ──────────────────────────────

@router.get("/export")
async def export_my_data(user_id: Optional[str] = None, actor: Actor = Depends(get_actor)):
    """Real gap found 2026-08-11: the page's own policy text promises "you
    can see your own collected data at any time," but the UI only ever
    showed a capped view (top-5 apps/domains, last-50 rows) — never a
    real, complete export. This returns everything, unbounded, as a real
    downloadable JSON file. Same self/manager scoping as every other
    endpoint here — recruiters can only export their own; a manager can
    export any real team member's (matches their existing browsing-
    history visibility, not a new permission)."""
    scoped = _scope_user_id(actor, user_id) or actor.user_id
    async with db.tenant_conn(actor.tenant_id) as conn:
        user_row = await conn.fetchrow("SELECT full_name, email FROM users WHERE id=$1 AND tenant_id=$2", scoped, actor.tenant_id)
        if not user_row:
            raise HTTPException(status_code=404, detail="User not found")
        consent_rows = await conn.fetch(
            """SELECT policy_version, consent_scope, consent_given, created_at, revoked_at FROM device_monitoring_consent
               WHERE tenant_id=$1 AND user_id=$2 ORDER BY created_at DESC""",
            actor.tenant_id, scoped)
        device_rows = await conn.fetch(
            """SELECT hostname, os, is_active, enrolled_at, last_heartbeat_at FROM monitored_devices
               WHERE tenant_id=$1 AND user_id=$2 ORDER BY enrolled_at DESC""",
            actor.tenant_id, scoped)
        activity_rows = await conn.fetch(
            """SELECT app_name, window_title, started_at, ended_at, is_idle FROM device_activity_log
               WHERE tenant_id=$1 AND user_id=$2 ORDER BY started_at DESC""",
            actor.tenant_id, scoped)
        browsing_rows = await conn.fetch(
            """SELECT url, page_title, browser, visited_at FROM device_browsing_history
               WHERE tenant_id=$1 AND user_id=$2 ORDER BY visited_at DESC""",
            actor.tenant_id, scoped)
        screenshot_rows = await conn.fetch(
            """SELECT id, captured_at, is_blurred FROM device_screenshots
               WHERE tenant_id=$1 AND user_id=$2 ORDER BY captured_at DESC""",
            actor.tenant_id, scoped)
        intensity_rows = await conn.fetch(
            """SELECT window_start, window_end, keystroke_count, mouse_click_count, mouse_move_px
               FROM device_intensity_metrics WHERE tenant_id=$1 AND user_id=$2 ORDER BY window_start DESC""",
            actor.tenant_id, scoped)
        dlp_rows = await conn.fetch(
            """SELECT event_type, detail, occurred_at FROM device_dlp_events
               WHERE tenant_id=$1 AND user_id=$2 ORDER BY occurred_at DESC""",
            actor.tenant_id, scoped)

    payload = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "user": {"full_name": user_row["full_name"], "email": user_row["email"]},
        "consent_history": [dict(r) for r in consent_rows],
        "devices": [dict(r) for r in device_rows],
        "activity_log": [dict(r) for r in activity_rows],
        "browsing_history": [dict(r) for r in browsing_rows],
        "screenshots": [dict(r) for r in screenshot_rows],
        "intensity_metrics": [dict(r) for r in intensity_rows],
        "dlp_events": [dict(r) for r in dlp_rows],
    }
    body = json.dumps(payload, indent=2, default=str)
    filename = f"device-monitoring-export-{scoped}.json"
    return Response(
        content=body, media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Agent distribution ───────────────────────────────────────────────────────

@router.get("/agent/download")
async def download_agent(actor: Actor = Depends(get_actor)):
    """Real gap found 2026-08-11: the enroll card told a recruiter to "run
    the agent on this company laptop" with no way to actually get it —
    the agent only ever existed as source in this repo. Serves the real
    agent source + README + requirements as a zip; ships source (not a
    compiled .exe — building/signing a real Windows binary is a separate,
    larger undertaking) so at minimum every recruiter has a genuine,
    working path to run `pip install -r requirements.txt` then the
    agent's own documented `enroll`/`run`/`install-autostart` CLI."""
    if not os.path.isdir(_AGENT_DIR):
        raise HTTPException(status_code=404, detail="Agent distribution not available on this deployment")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for fname in os.listdir(_AGENT_DIR):
            fpath = os.path.join(_AGENT_DIR, fname)
            if os.path.isfile(fpath):
                zf.write(fpath, arcname=f"aviin-device-agent/{fname}")
    return Response(
        content=buf.getvalue(), media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="aviin-device-agent.zip"'},
    )
