"""Individual Recruiter Candidate Ownership (30-day FCFS lock).

Business rule: the recruiter who first receives (personal mailbox) or
creates (manual add / bulk upload) a candidate individually owns that
candidate for 30 calendar days. Tied to the recruiter's user account +
registered email — never to a team/branch/department. Reused by every
intake path (candidates.py, import_router.py, resume_intake_service.py)
so there is exactly one implementation of the claim/lock logic, not three
divergent copies.
"""

from datetime import datetime, timedelta, timezone
from typing import Optional

OWNERSHIP_DAYS = 30


async def get_ownership(conn, tenant_id: str, candidate_id: str) -> Optional[dict]:
    """Current owner (any status) or None if never claimed."""
    row = await conn.fetchrow(
        """SELECT co.*, u.full_name AS recruiter_name
           FROM candidate_ownership co
           JOIN users u ON u.id = co.recruiter_id
           WHERE co.tenant_id=$1 AND co.candidate_id=$2""",
        tenant_id, candidate_id,
    )
    return dict(row) if row else None


def _is_active(row: dict) -> bool:
    return row is not None and row["status"] == "active" and row["ownership_expires_at"] > datetime.now(timezone.utc)


async def claim_ownership(conn, tenant_id: str, candidate_id: str, recruiter_id: str,
                           recruiter_email: str, source: str) -> dict:
    """Atomic FCFS claim on a real candidate row.

    Locks any existing ownership row for this candidate, then:
    - No row, or an expired/non-active row: claim succeeds (fresh or
      takeover — a prior real takeover is logged as 'expired' in history
      before the new 'claimed' row, preserving the record per the
      ownership rule's own requirement).
    - An active, unexpired row for the SAME recruiter: no-op, already
      theirs — returns claimed=True with the existing row untouched.
    - An active, unexpired row for a DIFFERENT recruiter: does NOT touch
      candidate_ownership at all — logs a 'blocked_attempt' and returns
      the real current owner so callers can show who owns it and until
      when (matches the ownership rule's exact "Candidate Already Owned"
      UX — never silently reassign).

    Must be called inside the caller's own transaction (all callers here
    already run inside db.tenant_conn()'s implicit transaction).
    """
    existing = await conn.fetchrow(
        "SELECT * FROM candidate_ownership WHERE tenant_id=$1 AND candidate_id=$2 FOR UPDATE",
        tenant_id, candidate_id,
    )

    if existing and _is_active(dict(existing)) and str(existing["recruiter_id"]) != str(recruiter_id):
        await conn.execute(
            """INSERT INTO candidate_ownership_history
               (tenant_id, candidate_id, recruiter_id, recruiter_email, action, source, performed_by)
               VALUES ($1,$2,$3,$4,'blocked_attempt',$5,$3)""",
            tenant_id, candidate_id, recruiter_id, recruiter_email, source,
        )
        owner = await get_ownership(conn, tenant_id, candidate_id)
        return {"claimed": False, "owner": owner}

    if existing and _is_active(dict(existing)) and str(existing["recruiter_id"]) == str(recruiter_id):
        owner = await get_ownership(conn, tenant_id, candidate_id)
        return {"claimed": True, "owner": owner}

    # Fresh claim or takeover of an expired lock.
    if existing and existing["status"] == "active":
        # Real takeover of a lapsed lock — record the expiry before overwriting.
        await conn.execute(
            """INSERT INTO candidate_ownership_history
               (tenant_id, candidate_id, recruiter_id, recruiter_email, action, source)
               VALUES ($1,$2,$3,$4,'expired',$5)""",
            tenant_id, candidate_id, existing["recruiter_id"], existing["recruiter_email"], existing["source"],
        )

    expires_at = datetime.now(timezone.utc) + timedelta(days=OWNERSHIP_DAYS)
    await conn.execute(
        """INSERT INTO candidate_ownership
             (tenant_id, candidate_id, recruiter_id, recruiter_email, source,
              ownership_started_at, ownership_expires_at, status, updated_at)
           VALUES ($1,$2,$3,$4,$5, now(), $6, 'active', now())
           ON CONFLICT (tenant_id, candidate_id) DO UPDATE SET
             recruiter_id=$3, recruiter_email=$4, source=$5,
             ownership_started_at=now(), ownership_expires_at=$6,
             status='active', updated_at=now()""",
        tenant_id, candidate_id, recruiter_id, recruiter_email, source, expires_at,
    )
    await conn.execute(
        """INSERT INTO candidate_ownership_history
           (tenant_id, candidate_id, recruiter_id, recruiter_email, action, source, performed_by)
           VALUES ($1,$2,$3,$4,'claimed',$5,$3)""",
        tenant_id, candidate_id, recruiter_id, recruiter_email, source,
    )
    owner = await get_ownership(conn, tenant_id, candidate_id)
    return {"claimed": True, "owner": owner}


async def transfer_ownership(conn, tenant_id: str, candidate_id: str, new_recruiter_id: str,
                              new_recruiter_email: str, performed_by: str, reason: Optional[str] = None) -> dict:
    """Explicit admin/manager override — always allowed regardless of an
    active lock (the ownership rule's own "authorized ownership transfer"
    escape hatch). Records who performed it and why."""
    existing = await conn.fetchrow(
        "SELECT * FROM candidate_ownership WHERE tenant_id=$1 AND candidate_id=$2 FOR UPDATE",
        tenant_id, candidate_id,
    )
    if existing:
        await conn.execute(
            """INSERT INTO candidate_ownership_history
               (tenant_id, candidate_id, recruiter_id, recruiter_email, action, source, performed_by, reason)
               VALUES ($1,$2,$3,$4,'transferred',$5,$6,$7)""",
            tenant_id, candidate_id, existing["recruiter_id"], existing["recruiter_email"],
            existing["source"], performed_by, reason,
        )

    expires_at = datetime.now(timezone.utc) + timedelta(days=OWNERSHIP_DAYS)
    await conn.execute(
        """INSERT INTO candidate_ownership
             (tenant_id, candidate_id, recruiter_id, recruiter_email, source,
              ownership_started_at, ownership_expires_at, status, updated_at)
           VALUES ($1,$2,$3,$4,'manual_assign', now(), $5, 'active', now())
           ON CONFLICT (tenant_id, candidate_id) DO UPDATE SET
             recruiter_id=$3, recruiter_email=$4, source='manual_assign',
             ownership_started_at=now(), ownership_expires_at=$5,
             status='active', updated_at=now()""",
        tenant_id, candidate_id, new_recruiter_id, new_recruiter_email, expires_at,
    )
    await conn.execute(
        """INSERT INTO candidate_ownership_history
           (tenant_id, candidate_id, recruiter_id, recruiter_email, action, source, performed_by, reason)
           VALUES ($1,$2,$3,$4,'claimed','manual_assign',$5,$6)""",
        tenant_id, candidate_id, new_recruiter_id, new_recruiter_email, performed_by, reason,
    )
    return await get_ownership(conn, tenant_id, candidate_id)
