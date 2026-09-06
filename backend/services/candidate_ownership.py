"""Individual Recruiter Candidate Ownership (30-day FCFS lock).

Business rule: the recruiter who first receives (personal mailbox) or
creates (manual add / bulk upload) a candidate individually owns that
candidate for 30 calendar days. Tied to the recruiter's user account +
registered email — never to a team/branch/department. Reused by every
intake path (candidates.py, import_router.py, resume_intake_service.py)
so there is exactly one implementation of the claim/lock logic, not three
divergent copies.

GOLDEN RULE (2026-09-07, sender-based attribution): for internal-mailbox
forwards, ownership/credit is resolved from the actual SENDER'S email
address, never the mailbox that merely received the email — see
resolve_sender_identity() below. recruiter_id is nullable to support a
"Temporary Sender Record": a real @company-domain sender who hasn't yet
been created as an ATS user. Once they are, auto_map_unregistered_sender()
retroactively links every prior claim to the new user_id.
"""

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException

OWNERSHIP_DAYS = 30

# Public providers a real candidate might legitimately use even though a
# colleague happens to share the same one — never trusted as "this
# tenant's own internal domain" regardless of how many staff use it.
_PUBLIC_EMAIL_PROVIDERS = {
    'gmail.com', 'yahoo.com', 'yahoo.co.in', 'outlook.com', 'hotmail.com',
    'live.com', 'icloud.com', 'rediffmail.com', 'protonmail.com',
    'yopmail.com', 'aol.com', 'zoho.com', 'msn.com',
}


async def resolve_sender_identity(conn, tenant_id: str, from_email: str,
                                   from_name: str = '', account_id: Optional[str] = None) -> Optional[dict]:
    """Golden Rule resolver: who should get ownership/submission credit for
    this email — the ACTUAL SENDER, not the mailbox that received it.

    Two real scenarios, deliberately handled differently:
    - Internal forward (from_email is on this tenant's own real staff
      domain): credit goes to the SENDER. If a real, active ATS user
      account exists with that exact email, that's the owner. If not, a
      "Temporary Sender Record" is returned (user_id=None) — the sender's
      real name/email is still recorded and still counted, just not yet
      linked to a users row (spec Scenario 2).
    - External sender (a candidate emailing their own resume from a
      personal/public address): the "sender" IS the candidate, not an
      internal recruiter — there's no one to credit via the Golden Rule,
      so this correctly falls back to crediting whichever recruiter's own
      registered mailbox received it (the pre-existing, still-correct
      behavior for direct candidate applications — never touched).

    Returns None if neither a sender nor a receiving mailbox can be
    resolved (no ownership claim is made — falls into the unassigned
    queue rather than guessing), matching the existing "no account
    context" contract this function replaces.
    """
    from_email = (from_email or '').strip().lower()

    async def _fallback_to_receiving_mailbox() -> Optional[dict]:
        if not account_id:
            return None
        acc = await conn.fetchrow(
            "SELECT ua.user_id, ua.email, u.full_name FROM user_email_accounts ua "
            "JOIN users u ON u.id = ua.user_id WHERE ua.id=$1", account_id)
        if not acc:
            return None
        return {"user_id": str(acc["user_id"]), "email": acc["email"],
                "name": acc["full_name"], "registered": True, "via": "receiving_mailbox"}

    if not from_email or '@' not in from_email:
        return await _fallback_to_receiving_mailbox()

    sender_domain = from_email.split('@')[-1]
    # "This tenant's own real internal domain" — same >=1 real-user bar as
    # is_internal_sender elsewhere in this codebase (a domain with at
    # least one real registered account on it, and never a public
    # provider even if a staff member happens to use one personally).
    is_internal_domain = (
        sender_domain not in _PUBLIC_EMAIL_PROVIDERS and
        await conn.fetchval(
            "SELECT count(*)>=1 FROM users WHERE tenant_id=$1 AND split_part(email,'@',2)=$2",
            tenant_id, sender_domain)
    )
    if not is_internal_domain:
        # External sender = the candidate applying directly. Golden Rule
        # doesn't apply — the receiving recruiter genuinely sourced this.
        return await _fallback_to_receiving_mailbox()

    user_row = await conn.fetchrow(
        "SELECT id, full_name, email FROM users WHERE tenant_id=$1 AND lower(email)=$2 AND is_active",
        tenant_id, from_email)
    if user_row:
        return {"user_id": str(user_row["id"]), "email": user_row["email"],
                "name": user_row["full_name"], "registered": True, "via": "sender_email"}

    # Internal domain, no matching registered user yet — Temporary Sender
    # Record. Real name if the email's own From: header gave one, else a
    # readable fallback derived from the local-part (matches the existing
    # convention already used elsewhere in this codebase for this exact
    # shape of fallback).
    display_name = (from_name or '').strip()
    if not display_name:
        display_name = from_email.split('@')[0].replace('.', ' ').replace('-', ' ').replace('_', ' ').title()
    return {"user_id": None, "email": from_email, "name": display_name[:200],
            "registered": False, "via": "unregistered_sender"}


def owner_blocked(owner: Optional[dict], actor) -> bool:
    """True if `owner` is an active lock held by someone other than
    `actor` — the shared gate for broadened enforcement (2026-08-11:
    pipeline moves, messaging, tagging). Admin/manager and the owner
    themselves are never blocked; an unowned or expired-lock candidate
    is never blocked either."""
    if actor.role in ("admin", "super_admin", "manager"):
        return False
    if not owner or owner["status"] != "active":
        return False
    return str(owner["recruiter_id"]) != str(actor.user_id)


def _ownership_403_detail(owner: dict) -> dict:
    is_temp = owner.get("recruiter_id") is None
    name = owner['recruiter_name'] or owner['recruiter_email']
    label = f"{name} (Unregistered ATS User)" if is_temp else name
    return {
        "detail": (
            f"Candidate Already Owned — currently owned by {label} "
            f"until {owner['ownership_expires_at']}. You cannot process this candidate "
            f"during the active ownership period."
        ),
        "owner": {
            "recruiter_id": str(owner["recruiter_id"]) if owner.get("recruiter_id") else None,
            "recruiter_name": owner["recruiter_name"],
            "recruiter_email": owner["recruiter_email"],
            "is_registered": not is_temp,
            "expires_at": str(owner["ownership_expires_at"]),
        },
    }


async def check_ownership_or_raise(conn, tenant_id: str, candidate_id: str, actor) -> None:
    """Raise 403 if `candidate_id` has an active owner who isn't `actor`.
    No-op for admin/manager, the owner themselves, or an unowned/expired
    candidate. For SINGLE-candidate call sites only — bulk call sites
    should call get_ownership() directly and skip-not-raise per item
    (see applications.py bulk-action / communications.py bulk-send for
    the established pattern)."""
    if actor.role in ("admin", "super_admin", "manager"):
        return
    owner = await get_ownership(conn, tenant_id, candidate_id)
    if owner_blocked(owner, actor):
        raise HTTPException(403, _ownership_403_detail(owner))
    # (owner may still be None or unowned/expired here — both fine, no-op)


async def get_ownership(conn, tenant_id: str, candidate_id: str) -> Optional[dict]:
    """Current owner (any status) or None if never claimed. LEFT JOIN +
    COALESCE so a Temporary Sender Record (recruiter_id IS NULL) still
    resolves a real display name from its own stored recruiter_name,
    rather than requiring a users row to exist at all. is_registered is
    computed here once, so every caller (the ownership endpoints, the
    duplicate-conflict/403 detail builders, the Resume Inbox query) reads
    the same real signal instead of each re-deriving `recruiter_id is
    not None` independently — a real, previously-missing field on this
    function's own return value, caught by this suite's own first run."""
    row = await conn.fetchrow(
        """SELECT co.*, COALESCE(u.full_name, co.recruiter_name) AS recruiter_name,
                  (co.recruiter_id IS NOT NULL) AS is_registered
           FROM candidate_ownership co
           LEFT JOIN users u ON u.id = co.recruiter_id
           WHERE co.tenant_id=$1 AND co.candidate_id=$2""",
        tenant_id, candidate_id,
    )
    return dict(row) if row else None


async def get_original_source(conn, tenant_id: str, candidate_id: str) -> Optional[dict]:
    """The very first 'claimed' entry ever recorded for this candidate —
    immutable (history is append-only), so this reflects who ORIGINALLY
    sourced the candidate even after a later transfer, expiry/takeover, or
    a duplicate resubmission has since changed the CURRENT owner (spec's
    Duplicate Candidate Rule: "preserve the Original Source Recruiter").
    """
    row = await conn.fetchrow(
        """SELECT h.recruiter_id, h.recruiter_email,
                  COALESCE(u.full_name, h.recruiter_name) AS recruiter_name,
                  h.source, h.created_at
           FROM candidate_ownership_history h
           LEFT JOIN users u ON u.id = h.recruiter_id
           WHERE h.tenant_id=$1 AND h.candidate_id=$2 AND h.action='claimed'
           ORDER BY h.created_at ASC LIMIT 1""",
        tenant_id, candidate_id,
    )
    return dict(row) if row else None


async def get_other_senders(conn, tenant_id: str, candidate_id: str) -> list:
    """Every DISTINCT sender who also tried to submit this same candidate
    while someone else already owned it — the spec's "Current Sender:
    Padmashree" alongside "Original Source: Ashwini" display, sourced
    from the real blocked_attempt trail (2026-09-07: this only shows real
    data once the sender-based fix is live — a blocked_attempt row now
    always carries the true sender's identity, not the wrong receiving
    mailbox owner)."""
    rows = await conn.fetch(
        """SELECT DISTINCT ON (lower(h.recruiter_email))
                  h.recruiter_id, h.recruiter_email,
                  COALESCE(u.full_name, h.recruiter_name) AS recruiter_name,
                  h.created_at AS last_attempt_at
           FROM candidate_ownership_history h
           LEFT JOIN users u ON u.id = h.recruiter_id
           WHERE h.tenant_id=$1 AND h.candidate_id=$2 AND h.action='blocked_attempt'
           ORDER BY lower(h.recruiter_email), h.created_at DESC""",
        tenant_id, candidate_id,
    )
    return [dict(r) for r in rows]


async def auto_map_unregistered_sender(conn, tenant_id: str, new_user_id: str, new_user_email: str) -> int:
    """Spec Scenario 2's closing requirement: "Once [the ATS user account
    is] created, automatically map all previous submissions to that
    recruiter." Called once, right after a new user is created — links
    every existing Temporary Sender Record (recruiter_id IS NULL) whose
    stored email matches the new account to the real user_id, on both the
    live ownership table and the append-only history. Returns how many
    candidate_ownership rows were remapped (0 is normal/expected — most
    new users were never an unregistered sender)."""
    email = (new_user_email or '').strip().lower()
    if not email:
        return 0
    n = await conn.fetchval(
        """WITH updated AS (
             UPDATE candidate_ownership SET recruiter_id=$1, updated_at=now()
             WHERE tenant_id=$2 AND recruiter_id IS NULL AND lower(recruiter_email)=$3
             RETURNING id)
           SELECT count(*) FROM updated""",
        new_user_id, tenant_id, email,
    )
    await conn.execute(
        """UPDATE candidate_ownership_history SET recruiter_id=$1
           WHERE tenant_id=$2 AND recruiter_id IS NULL AND lower(recruiter_email)=$3""",
        new_user_id, tenant_id, email,
    )
    return int(n or 0)


def _is_active(row: dict) -> bool:
    return row is not None and row["status"] == "active" and row["ownership_expires_at"] > datetime.now(timezone.utc)


async def claim_ownership(conn, tenant_id: str, candidate_id: str, recruiter_id: Optional[str],
                           recruiter_email: str, source: str, recruiter_name: Optional[str] = None) -> dict:
    """Atomic FCFS claim on a real candidate row.

    recruiter_id may be None — a Temporary Sender Record (a real
    @company-domain sender with no ATS user account yet, spec Scenario
    2). Identity is then compared by email instead of user_id, so the
    SAME unregistered sender re-submitting is correctly treated as
    "already theirs", not a new blocked attempt every time.

    Locks any existing ownership row for this candidate, then:
    - No row, or an expired/non-active row: claim succeeds (fresh or
      takeover — a prior real takeover is logged as 'expired' in history
      before the new 'claimed' row, preserving the record per the
      ownership rule's own requirement).
    - An active, unexpired row for the SAME identity: no-op, already
      theirs — returns claimed=True with the existing row untouched.
    - An active, unexpired row for a DIFFERENT identity: does NOT touch
      candidate_ownership at all — logs a 'blocked_attempt' (this is also
      the real data source for the Duplicate Candidate Rule's "Current
      Sender" display, see get_other_senders()) and returns the real
      current owner so callers can show who owns it and until when
      (matches the ownership rule's exact "Candidate Already Owned" UX —
      never silently reassign).

    Must be called inside the caller's own transaction (all callers here
    already run inside db.tenant_conn()'s implicit transaction).
    """
    existing = await conn.fetchrow(
        "SELECT * FROM candidate_ownership WHERE tenant_id=$1 AND candidate_id=$2 FOR UPDATE",
        tenant_id, candidate_id,
    )

    def _same_identity(row) -> bool:
        # Registered on both sides: compare by real user_id. Either side
        # unregistered (or both): compare by email — the only stable
        # identity a Temporary Sender Record has.
        if row["recruiter_id"] and recruiter_id:
            return str(row["recruiter_id"]) == str(recruiter_id)
        return (row["recruiter_email"] or '').strip().lower() == (recruiter_email or '').strip().lower()

    if existing and _is_active(dict(existing)) and not _same_identity(existing):
        await conn.execute(
            """INSERT INTO candidate_ownership_history
               (tenant_id, candidate_id, recruiter_id, recruiter_email, recruiter_name, action, source, performed_by)
               VALUES ($1,$2,$3,$4,$5,'blocked_attempt',$6,$3)""",
            tenant_id, candidate_id, recruiter_id, recruiter_email, recruiter_name, source,
        )
        owner = await get_ownership(conn, tenant_id, candidate_id)
        return {"claimed": False, "owner": owner}

    if existing and _is_active(dict(existing)) and _same_identity(existing):
        owner = await get_ownership(conn, tenant_id, candidate_id)
        return {"claimed": True, "owner": owner}

    # Fresh claim or takeover of an expired lock.
    if existing and existing["status"] == "active":
        # Real takeover of a lapsed lock — record the expiry before overwriting.
        await conn.execute(
            """INSERT INTO candidate_ownership_history
               (tenant_id, candidate_id, recruiter_id, recruiter_email, recruiter_name, action, source)
               VALUES ($1,$2,$3,$4,$5,'expired',$6)""",
            tenant_id, candidate_id, existing["recruiter_id"], existing["recruiter_email"],
            existing["recruiter_name"], existing["source"],
        )

    expires_at = datetime.now(timezone.utc) + timedelta(days=OWNERSHIP_DAYS)
    await conn.execute(
        """INSERT INTO candidate_ownership
             (tenant_id, candidate_id, recruiter_id, recruiter_email, recruiter_name, source,
              ownership_started_at, ownership_expires_at, status, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6, now(), $7, 'active', now())
           ON CONFLICT (tenant_id, candidate_id) DO UPDATE SET
             recruiter_id=$3, recruiter_email=$4, recruiter_name=$5, source=$6,
             ownership_started_at=now(), ownership_expires_at=$7,
             status='active', updated_at=now()""",
        tenant_id, candidate_id, recruiter_id, recruiter_email, recruiter_name, source, expires_at,
    )
    await conn.execute(
        """INSERT INTO candidate_ownership_history
           (tenant_id, candidate_id, recruiter_id, recruiter_email, recruiter_name, action, source, performed_by)
           VALUES ($1,$2,$3,$4,$5,'claimed',$6,$3)""",
        tenant_id, candidate_id, recruiter_id, recruiter_email, recruiter_name, source,
    )
    owner = await get_ownership(conn, tenant_id, candidate_id)
    return {"claimed": True, "owner": owner}


async def transfer_ownership(conn, tenant_id: str, candidate_id: str, new_recruiter_id: str,
                              new_recruiter_email: str, performed_by: str, reason: Optional[str] = None,
                              new_recruiter_name: Optional[str] = None) -> dict:
    """Explicit admin/manager override — always allowed regardless of an
    active lock (the ownership rule's own "authorized ownership transfer"
    escape hatch, matching the spec's closing Golden-Rule caveat: "unless
    manually changed by Super Admin with audit logging"). Records who
    performed it and why."""
    existing = await conn.fetchrow(
        "SELECT * FROM candidate_ownership WHERE tenant_id=$1 AND candidate_id=$2 FOR UPDATE",
        tenant_id, candidate_id,
    )
    if existing:
        await conn.execute(
            """INSERT INTO candidate_ownership_history
               (tenant_id, candidate_id, recruiter_id, recruiter_email, recruiter_name, action, source, performed_by, reason)
               VALUES ($1,$2,$3,$4,$5,'transferred',$6,$7,$8)""",
            tenant_id, candidate_id, existing["recruiter_id"], existing["recruiter_email"],
            existing["recruiter_name"], existing["source"], performed_by, reason,
        )

    expires_at = datetime.now(timezone.utc) + timedelta(days=OWNERSHIP_DAYS)
    await conn.execute(
        """INSERT INTO candidate_ownership
             (tenant_id, candidate_id, recruiter_id, recruiter_email, recruiter_name, source,
              ownership_started_at, ownership_expires_at, status, updated_at)
           VALUES ($1,$2,$3,$4,$5,'manual_assign', now(), $6, 'active', now())
           ON CONFLICT (tenant_id, candidate_id) DO UPDATE SET
             recruiter_id=$3, recruiter_email=$4, recruiter_name=$5, source='manual_assign',
             ownership_started_at=now(), ownership_expires_at=$6,
             status='active', updated_at=now()""",
        tenant_id, candidate_id, new_recruiter_id, new_recruiter_email, new_recruiter_name, expires_at,
    )
    await conn.execute(
        """INSERT INTO candidate_ownership_history
           (tenant_id, candidate_id, recruiter_id, recruiter_email, recruiter_name, action, source, performed_by, reason)
           VALUES ($1,$2,$3,$4,$5,'claimed','manual_assign',$6,$7)""",
        tenant_id, candidate_id, new_recruiter_id, new_recruiter_email, new_recruiter_name, performed_by, reason,
    )
    return await get_ownership(conn, tenant_id, candidate_id)
