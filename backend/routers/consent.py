"""HARD RULE #12 (DPDP 2023): read/write candidate consent records."""

from fastapi import APIRouter, Depends

import db
from deps import Actor, get_actor
from schemas import ConsentCreate

router = APIRouter(prefix="/consent-records", tags=["consent"])

FIELDS = """id, tenant_id, candidate_id, data_category, channel,
            consent_given, consent_text, ip_address, created_at"""


@router.get("")
async def list_consent_records(candidate_id: str | None = None, actor: Actor = Depends(get_actor)):
    conditions: list[str] = []
    params: list = []
    if candidate_id:
        params.append(candidate_id)
        conditions.append(f"candidate_id = ${len(params)}")

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(f"SELECT {FIELDS} FROM consent_records {where} ORDER BY created_at DESC", *params)
    return [dict(r) for r in rows]


@router.post("")
async def create_consent_record(body: ConsentCreate, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            f"""INSERT INTO consent_records
                  (tenant_id, candidate_id, data_category, channel, consent_given, consent_text)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING {FIELDS}""",
            actor.tenant_id, body.candidate_id, body.data_category, body.channel,
            body.consent_given, body.consent_text,
        )
    return dict(row)
