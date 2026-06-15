"""Offer state machine: draft -> pending_approval -> approved -> issued
-> accepted/declined.

HARD RULE #10: approve/issue are HITL-gated (admin/manager only) and
write assignment_event + audit_log. issue also writes event_outbox
'offer.issued' for downstream automation (P2/P11).
"""

from fastapi import APIRouter, Depends, HTTPException

import db
import events
from deps import Actor, get_actor, require_role
from schemas import OfferCreate, OfferRespond

router = APIRouter(prefix="/offers", tags=["offers"])

FIELDS = """id, tenant_id, application_id, status, ctc_offered, currency,
            joining_date, approved_by, created_at, updated_at"""


async def _get_offer(conn, offer_id: str):
    row = await conn.fetchrow(f"SELECT {FIELDS} FROM offers WHERE id = $1", offer_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Offer not found")
    return row


@router.get("")
async def list_offers(application_id: str | None = None, actor: Actor = Depends(get_actor)):
    conditions: list[str] = []
    params: list = []
    if application_id:
        params.append(application_id)
        conditions.append(f"application_id = ${len(params)}")

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(f"SELECT {FIELDS} FROM offers {where} ORDER BY created_at DESC", *params)
    return [dict(r) for r in rows]


@router.post("")
async def create_offer(body: OfferCreate, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            f"""INSERT INTO offers (tenant_id, application_id, status, ctc_offered, currency, joining_date)
                VALUES ($1, $2, 'draft', $3, $4, $5)
                RETURNING {FIELDS}""",
            actor.tenant_id, body.application_id, body.ctc_offered, body.currency, body.joining_date,
        )

        await events.write_outbox(
            conn, actor.tenant_id, "offer.created",
            {"offer_id": str(row["id"]), "application_id": body.application_id},
            f"offer.created:{row['id']}",
        )

    return dict(row)


@router.get("/{offer_id}")
async def get_offer(offer_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await _get_offer(conn, offer_id)
    return dict(row)


@router.post("/{offer_id}/submit-for-approval")
async def submit_for_approval(offer_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            f"""UPDATE offers SET status = 'pending_approval', updated_at = now()
                WHERE id = $1 AND status = 'draft' RETURNING {FIELDS}""",
            offer_id,
        )
        if row is None:
            existing = await _get_offer(conn, offer_id)
            raise HTTPException(status_code=409, detail=f"Offer is '{existing['status']}', expected 'draft'")

        await events.write_assignment_event(
            conn, actor.tenant_id, "offer.pending_approval",
            reason="Submitted for manager approval", actor_user_id=actor.user_id,
            metadata={"offer_id": offer_id},
        )

    return dict(row)


@router.post("/{offer_id}/approve")
async def approve_offer(offer_id: str, actor: Actor = Depends(require_role("admin", "manager"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            f"""UPDATE offers SET status = 'approved', approved_by = $2, updated_at = now()
                WHERE id = $1 AND status = 'pending_approval' RETURNING {FIELDS}""",
            offer_id, actor.user_id,
        )
        if row is None:
            existing = await _get_offer(conn, offer_id)
            raise HTTPException(status_code=409, detail=f"Offer is '{existing['status']}', expected 'pending_approval'")

        await events.write_assignment_event(
            conn, actor.tenant_id, "offer.approved",
            actor_user_id=actor.user_id, metadata={"offer_id": offer_id},
        )
        await events.write_audit(
            conn, actor.tenant_id, actor.user_id, "approve", "offer", offer_id,
            before={"status": "pending_approval"}, after={"status": "approved"},
        )

    return dict(row)


@router.post("/{offer_id}/issue")
async def issue_offer(offer_id: str, actor: Actor = Depends(require_role("admin", "manager"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            f"""UPDATE offers SET status = 'issued', updated_at = now()
                WHERE id = $1 AND status = 'approved' RETURNING {FIELDS}""",
            offer_id,
        )
        if row is None:
            existing = await _get_offer(conn, offer_id)
            raise HTTPException(status_code=409, detail=f"Offer is '{existing['status']}', expected 'approved'")

        await events.write_assignment_event(
            conn, actor.tenant_id, "offer.issued",
            actor_user_id=actor.user_id, metadata={"offer_id": offer_id},
        )
        await events.write_audit(
            conn, actor.tenant_id, actor.user_id, "issue", "offer", offer_id,
            before={"status": "approved"}, after={"status": "issued"},
        )
        await events.write_outbox(
            conn, actor.tenant_id, "offer.issued",
            {"offer_id": offer_id, "application_id": str(row["application_id"])},
            f"offer.issued:{offer_id}",
        )

    return dict(row)


@router.post("/{offer_id}/respond")
async def respond_offer(offer_id: str, body: OfferRespond, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            f"""UPDATE offers SET status = $2, updated_at = now()
                WHERE id = $1 AND status = 'issued' RETURNING {FIELDS}""",
            offer_id, body.status,
        )
        if row is None:
            existing = await _get_offer(conn, offer_id)
            raise HTTPException(status_code=409, detail=f"Offer is '{existing['status']}', expected 'issued'")

        await events.write_outbox(
            conn, actor.tenant_id, f"offer.{body.status}",
            {"offer_id": offer_id, "application_id": str(row["application_id"])},
            f"offer.{body.status}:{offer_id}",
        )

        if body.status == "accepted":
            await conn.execute(
                "UPDATE applications SET stage = 'placed', updated_at = now() WHERE id = $1",
                row["application_id"],
            )

    return dict(row)
