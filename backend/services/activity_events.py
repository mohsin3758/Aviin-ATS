"""Recruiter activity event logging (Workforce Intelligence, 2026-08-11).

A typed, timestamped log of recruiter actions (sourced/screened/submitted/
interviewed/offer/placed) feeding the daily productivity aggregates and
performance-score jobs in scheduler.py. Deliberately additive alongside
the existing candidate_activities/pipeline_movements tables, not a
replacement — those log a broader "what happened to this candidate"
timeline; this is a purpose-built, typed event stream keyed for
aggregation (event_type + recruiter_id + timestamps only).

event_type is free text, not a rigid enum — tenants can add custom
pipeline stages (e.g. l3_interview), so a hardcoded CHECK/enum here would
repeat the exact hardcoded-stage-key bug class fixed repeatedly elsewhere
in this codebase (recruiter-performance report, hiring-funnel,
v_sla_dashboard, recruiter_dashboard.my-stats, etc.).

Written synchronously inside the caller's own transaction — same
treatment as pipeline_movements/candidate_activities today (a reliable
log entry tied to the real write, not a best-effort background task).
"""

import json
from datetime import datetime, timezone
from typing import Optional

# Canonical event types this system understands for aggregation/scoring.
# Interview-related events are generated dynamically as f"{stage}_scheduled"
# / f"{interview_type}_completed" to handle custom tenant stages, so this
# set is documentation of the fixed ones, not an exhaustive enum.
SOURCED = "sourced"
SCREENED = "screened"
SUBMITTED = "submitted"
REJECTED = "rejected"
OFFER_GENERATED = "offer_generated"
OFFER_ACCEPTED = "offer_accepted"
OFFER_DECLINED = "offer_declined"
PLACED = "placed"

_SLA_TARGET_HOURS_DEFAULT = 48
# Event types that count as the recruiter's "first real response" to a
# freshly-sourced candidate, for recruiter_sla_tracking.
_FIRST_RESPONSE_EVENT_TYPES = {SCREENED, SUBMITTED, "contacted"}


async def log_recruiter_activity(
    conn,
    tenant_id: str,
    recruiter_id: str,
    event_type: str,
    candidate_id: Optional[str] = None,
    application_id: Optional[str] = None,
    requisition_id: Optional[str] = None,
    client_id: Optional[str] = None,
    metadata: Optional[dict] = None,
    event_at: Optional[datetime] = None,
) -> None:
    """Log one recruiter activity event. Idempotent via dedup_key.

    Must be called with the caller's own connection, inside its own
    transaction — this is a reliable log entry tied to the triggering
    write, not a fire-and-forget side effect.
    """
    if not recruiter_id:
        return
    if event_at is None:
        event_at = datetime.now(timezone.utc)
    dedup_key = f"{event_type}:{recruiter_id}:{candidate_id or 'none'}:{application_id or 'none'}:{int(event_at.timestamp())}"
    await conn.execute(
        """INSERT INTO recruiter_activity_events
             (tenant_id, recruiter_id, candidate_id, application_id,
              requisition_id, client_id, event_type, event_at, dedup_key, metadata)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (tenant_id, dedup_key) DO NOTHING""",
        tenant_id, recruiter_id, candidate_id, application_id,
        requisition_id, client_id, event_type, event_at, dedup_key, json.dumps(metadata or {}),
    )

    if event_type == SOURCED and candidate_id:
        await conn.execute(
            """INSERT INTO recruiter_sla_tracking
                 (tenant_id, candidate_id, recruiter_id, sourced_at, sla_target_hours)
               VALUES ($1,$2,$3,$4,$5)
               ON CONFLICT (tenant_id, candidate_id, recruiter_id) DO NOTHING""",
            tenant_id, candidate_id, recruiter_id, event_at, _SLA_TARGET_HOURS_DEFAULT,
        )
    elif event_type in _FIRST_RESPONSE_EVENT_TYPES and candidate_id:
        row = await conn.fetchrow(
            """SELECT sourced_at, first_response_at, sla_target_hours FROM recruiter_sla_tracking
               WHERE tenant_id=$1 AND candidate_id=$2 AND recruiter_id=$3""",
            tenant_id, candidate_id, recruiter_id,
        )
        if row and row["first_response_at"] is None:
            elapsed_hours = (event_at - row["sourced_at"]).total_seconds() / 3600.0
            breached = elapsed_hours > row["sla_target_hours"]
            await conn.execute(
                """UPDATE recruiter_sla_tracking
                   SET first_response_at=$4, breached=$5, resolved_at=now(), updated_at=now()
                   WHERE tenant_id=$1 AND candidate_id=$2 AND recruiter_id=$3""",
                tenant_id, candidate_id, recruiter_id, event_at, breached,
            )
