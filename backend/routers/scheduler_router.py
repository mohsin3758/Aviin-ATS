"""Scheduler status & manual trigger endpoints."""
from fastapi import APIRouter, Depends
from scheduler import scheduler, process_retention_bank_releases, check_loyalty_milestones, compute_recruiter_risk_scores
from deps import Actor, get_actor, require_role

router = APIRouter(prefix="/scheduler", tags=["scheduler"])

@router.get("/status")
async def scheduler_status(actor: Actor = Depends(get_actor)):
    jobs = [{"id": j.id, "next_run": str(j.next_run_time)} for j in scheduler.get_jobs()]
    return {"running": scheduler.running, "jobs": jobs}

@router.post("/trigger/retention-bank")
async def trigger_retention(actor: Actor = Depends(get_actor)):
    await process_retention_bank_releases()
    return {"triggered": "retention_bank_releases"}

@router.post("/trigger/loyalty")
async def trigger_loyalty(actor: Actor = Depends(get_actor)):
    await check_loyalty_milestones()
    return {"triggered": "loyalty_milestones"}

@router.post("/trigger/risk-scores")
async def trigger_risk_scores(actor: Actor = Depends(require_role("admin", "manager"))):
    await compute_recruiter_risk_scores()
    return {"triggered": "recruiter_risk_scores"}
