"""Recruiter Personal Dashboard — personal stats for the logged-in recruiter."""

from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends
import db
from deps import Actor, get_actor

router = APIRouter(prefix="/recruiter", tags=["recruiter"])


def _start_of_day_utc() -> datetime:
    now = datetime.now(timezone.utc)
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def _start_of_month_utc() -> datetime:
    now = datetime.now(timezone.utc)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _start_of_week_utc() -> datetime:
    now = datetime.now(timezone.utc)
    # Monday as start of week
    monday = now - timedelta(days=now.weekday())
    return monday.replace(hour=0, minute=0, second=0, microsecond=0)


@router.get("/my-stats")
async def my_stats(actor: Actor = Depends(get_actor)):
    """Personal stats for the logged-in recruiter.

    Requires JWT auth (actor.user_id must be set).
    Anonymous/x-tenant-id callers get zeroed stats.
    """
    uid = actor.user_id  # may be None for anonymous callers
    today_start = _start_of_day_utc()
    month_start = _start_of_month_utc()
    week_start = _start_of_week_utc()

    async with db.tenant_conn(actor.tenant_id) as conn:
        if uid is None:
            # Anonymous caller — return zeroed stats
            return {
                "my_submissions_today": 0,
                "my_submissions_month": 0,
                "my_interviews_this_week": 0,
                "my_offers_active": 0,
                "my_placements_month": 0,
                "my_pipeline": {},
                "my_candidates_added_today": 0,
            }

        # 1. Submissions today (any stage change / application update by this recruiter today)
        sub_today = await conn.fetchval(
            """SELECT COUNT(*) FROM applications
               WHERE assigned_recruiter_id = $1::uuid
                 AND updated_at >= $2""",
            uid, today_start,
        )

        # 2. Submissions this month
        sub_month = await conn.fetchval(
            """SELECT COUNT(*) FROM applications
               WHERE assigned_recruiter_id = $1::uuid
                 AND updated_at >= $2""",
            uid, month_start,
        )

        # 3. Interviews this week
        interviews_week = await conn.fetchval(
            """SELECT COUNT(*) FROM applications
               WHERE assigned_recruiter_id = $1::uuid
                 AND stage IN ('l1_interview', 'l2_interview')
                 AND updated_at >= $2""",
            uid, week_start,
        )

        # 4. Active offers
        offers_active = await conn.fetchval(
            """SELECT COUNT(*) FROM applications
               WHERE assigned_recruiter_id = $1::uuid
                 AND stage IN ('offer', 'offer_accepted')""",
            uid,
        )

        # 5. Placements this month
        placements_month = await conn.fetchval(
            """SELECT COUNT(*) FROM applications
               WHERE assigned_recruiter_id = $1::uuid
                 AND stage = 'placed'
                 AND updated_at >= $2""",
            uid, month_start,
        )

        # 6. My pipeline — stage → count for this recruiter's applications
        pipeline_rows = await conn.fetch(
            """SELECT stage, COUNT(*) AS cnt FROM applications
               WHERE assigned_recruiter_id = $1::uuid
               GROUP BY stage""",
            uid,
        )
        my_pipeline = {r["stage"]: int(r["cnt"]) for r in pipeline_rows}

        # 7. Candidates added today
        # candidates table has no created_by; proxy via applications created today
        # where this recruiter is assigned (closest available signal)
        cands_today = await conn.fetchval(
            """SELECT COUNT(*) FROM applications
               WHERE assigned_recruiter_id = $1::uuid
                 AND created_at >= $2""",
            uid, today_start,
        )

    return {
        "my_submissions_today": int(sub_today or 0),
        "my_submissions_month": int(sub_month or 0),
        "my_interviews_this_week": int(interviews_week or 0),
        "my_offers_active": int(offers_active or 0),
        "my_placements_month": int(placements_month or 0),
        "my_pipeline": my_pipeline,
        "my_candidates_added_today": int(cands_today or 0),
    }
