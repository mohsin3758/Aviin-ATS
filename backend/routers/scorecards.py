"""P1: structured interview kits/scorecards."""

import json

from fastapi import APIRouter, Depends, HTTPException

import db
from deps import Actor, get_actor
from schemas import ScorecardCreate

router = APIRouter(prefix="/interview-scorecards", tags=["scorecards"])

FIELDS = """id, tenant_id, application_id, interviewer_id, round, scores,
            overall_rating, recommendation, notes, created_at"""


@router.get("")
async def list_scorecards(application_id: str | None = None, actor: Actor = Depends(get_actor)):
    conditions: list[str] = []
    params: list = []
    if application_id:
        params.append(application_id)
        conditions.append(f"application_id = ${len(params)}")

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(f"SELECT {FIELDS} FROM interview_scorecards {where} ORDER BY created_at DESC", *params)
    return [dict(r) for r in rows]


@router.post("")
async def create_scorecard(body: ScorecardCreate, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            f"""INSERT INTO interview_scorecards
                  (tenant_id, application_id, interviewer_id, round, scores,
                   overall_rating, recommendation, notes)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING {FIELDS}""",
            actor.tenant_id, body.application_id, body.interviewer_id or actor.user_id,
            body.round, json.dumps(body.scores), body.overall_rating,
            body.recommendation, body.notes,
        )
    return dict(row)


@router.get("/{scorecard_id}")
async def get_scorecard(scorecard_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(f"SELECT {FIELDS} FROM interview_scorecards WHERE id = $1", scorecard_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Scorecard not found")
    return dict(row)
