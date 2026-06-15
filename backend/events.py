"""Shared helpers for event_outbox / audit_log / assignment_event writes.

HARD RULE #5/#6: event_outbox rows are written in the same transaction
as the business change, always with a dedup_key.
HARD RULE #10: assignment_event + audit_log are written for every HITL
decision (offer issued, candidate rejected, recruiter reassigned).
"""

import json
from typing import Optional

import asyncpg


async def write_outbox(
    conn: asyncpg.Connection, tenant_id: str, event_type: str, payload: dict, dedup_key: str
) -> None:
    await conn.execute(
        """INSERT INTO event_outbox (tenant_id, event_type, payload, dedup_key)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (tenant_id, dedup_key) DO NOTHING""",
        tenant_id, event_type, json.dumps(payload), dedup_key,
    )


async def write_audit(
    conn: asyncpg.Connection,
    tenant_id: str,
    actor_user_id: Optional[str],
    action: str,
    entity_type: str,
    entity_id: Optional[str],
    before: Optional[dict] = None,
    after: Optional[dict] = None,
) -> None:
    await conn.execute(
        """INSERT INTO audit_log
             (tenant_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
           VALUES ($1, $2, $3, $4, $5, $6, $7)""",
        tenant_id, actor_user_id, action, entity_type, entity_id,
        json.dumps(before) if before is not None else None,
        json.dumps(after) if after is not None else None,
    )


async def write_assignment_event(
    conn: asyncpg.Connection,
    tenant_id: str,
    event_type: str,
    *,
    assignment_id: Optional[str] = None,
    reason: Optional[str] = None,
    actor_user_id: Optional[str] = None,
    metadata: Optional[dict] = None,
) -> None:
    await conn.execute(
        """INSERT INTO assignment_event
             (tenant_id, assignment_id, event_type, reason, actor_user_id, metadata)
           VALUES ($1, $2, $3, $4, $5, $6)""",
        tenant_id, assignment_id, event_type, reason, actor_user_id,
        json.dumps(metadata) if metadata is not None else None,
    )
