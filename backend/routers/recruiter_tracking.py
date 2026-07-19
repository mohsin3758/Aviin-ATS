"""Recruiter Tracking Router."""
from fastapi import APIRouter

router = APIRouter(prefix="/recruiter-tracking", tags=["recruiter-tracking"])

@router.get("/presence")
async def get_presence():
    return {"recruiters": [], "online": 0, "away": 0, "offline": 0}

@router.post("/heartbeat")
async def heartbeat():
    return {"status": "ok"}

@router.get("/activity")
async def get_activity():
    return {"activity": []}
