"""Free job-board distribution: LinkedIn/Naukri/Indeed links plus the full
70+ portal directory (services/job_portals.py) for one-click sharing."""
import os
from urllib.parse import urlencode, quote
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import db
from deps import Actor, get_actor
from services.job_portals import get_all_portals, build_share_links, portal_count

router = APIRouter(prefix="/job-sharing", tags=["job-sharing"])
# Matches the convention already used in routers/offers.py and routers/nda.py.
BASE_URL = os.environ.get("NEXT_PUBLIC_APP_URL", "https://ats.aviinjobs.com")


@router.get("/portals")
async def list_portals():
    """Full 70+ portal catalog, no requisition context - used for the
    directory/category browser before a job is selected."""
    return {"count": portal_count(), "portals": get_all_portals()}


@router.get("/requisition/{req_id}")
async def share_links(req_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        req = await conn.fetchrow(
            "SELECT * FROM requisitions WHERE id=$1 AND tenant_id=$2", req_id, actor.tenant_id)
        if not req: raise HTTPException(404, "Not found")
    # /careers is the actual public, unauthenticated job-board route (see
    # frontend/app/(public)/careers/page.tsx) - /jobs/{id} is the internal
    # admin view under (dashboard) and requires login, so a candidate
    # clicking a shared link there would just hit the login wall.
    job_url = f"{BASE_URL}/careers?job={req_id}"
    title   = req["title"]
    loc     = req["location"] or "Bengaluru"
    skills  = list(req["skills_required"] or [])
    desc    = (req["description"] or f"{title} opportunity")[:300]
    wa_msg  = f"*{title}*\n📍 {loc} | {req['employment_type']}\n🎯 Skills: {', '.join(skills[:4])}\nApply: {job_url}\n\n_AVIIN Jobs — AI Staffing_"
    share = build_share_links(job_url, title, desc, loc, skills, wa_msg)
    return {
        "job_url": job_url,
        # Legacy top-level fields, kept for any existing callers.
        "linkedin_share":  share["linkedin"],
        "whatsapp_share":  share["whatsapp"],
        "email_share":     share["email"],
        "naukri_post":     "https://www.naukri.com",
        "indeed_post":     "https://www.indeed.com",
        "whatsapp_message": wa_msg,
        "linkedin_post": f"{title}\n\n{desc}\n\nLocation: {loc}\nSkills: {', '.join(skills[:5])}\n\nApply: {job_url}",
        "job_description_text": f"{title}\n\nLocation: {loc}\nType: {req['employment_type'] or 'Full-time'}\n\n{desc}\n\nSkills: {', '.join(skills[:8])}\n\nApply: {job_url}",
        # Full 70+ portal catalog with per-requisition computed links -
        # share_intent ones get a pre-filled compose URL, the rest get the
        # portal's own homepage (no public posting API exists for them).
        "portals": get_all_portals(job_url, title, desc, loc, skills, wa_msg),
    }

class LogShareBody(BaseModel):
    req_id: str
    platform: str


@router.post("/log")
async def log_share(body: LogShareBody, actor: Actor = Depends(get_actor)):
    # Was previously (req_id: str, platform: str) with no Body() - FastAPI
    # binds bare scalar params on a POST to the QUERY string, but the
    # frontend has always sent these as a JSON body, so every call 422'd
    # silently (fire-and-forget, error never surfaced) - job_shares has
    # essentially never recorded anything and /stats has always been empty.
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute("""
            INSERT INTO job_shares (tenant_id,requisition_id,platform,posted_by)
            VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING
        """, actor.tenant_id, body.req_id, body.platform, actor.user_id)
    return {"logged": True, "platform": body.platform}


@router.get("/shared/{req_id}")
async def already_shared(req_id: str, actor: Actor = Depends(get_actor)):
    """Which portals this requisition has already been shared to - lets the
    UI restore the green checkmarks on reload instead of losing them the
    moment the page refreshes (previously pure client-side state)."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            "SELECT DISTINCT platform FROM job_shares WHERE tenant_id=$1 AND requisition_id=$2",
            actor.tenant_id, req_id)
    return {"platforms": [r["platform"] for r in rows]}


@router.post("/clear/{req_id}")
async def clear_shares(req_id: str, actor: Actor = Depends(get_actor)):
    """Reset the shared/posted state for a requisition so it can be
    re-shared from scratch (e.g. after fixing a broken link)."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute(
            "DELETE FROM job_shares WHERE tenant_id=$1 AND requisition_id=$2",
            actor.tenant_id, req_id)
    return {"cleared": True}


@router.get("/stats")
async def stats(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT platform, COUNT(*) shares, SUM(click_count) clicks
            FROM job_shares WHERE tenant_id=$1
            GROUP BY platform ORDER BY shares DESC
        """, actor.tenant_id)
    return [dict(r) for r in rows]


class IssueBody(BaseModel):
    req_id: str | None = None
    portal_key: str
    portal_name: str
    issue_type: str = 'other'
    note: str | None = None


@router.post("/issues")
async def report_issue(body: IssueBody, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            INSERT INTO job_portal_issues
              (tenant_id, requisition_id, portal_key, portal_name, issue_type, note, reported_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
            RETURNING id, portal_key, portal_name, issue_type, note, status, created_at
        """, actor.tenant_id, body.req_id, body.portal_key, body.portal_name,
             body.issue_type, body.note, actor.user_id)
    return dict(row)


@router.get("/issues")
async def list_issues(status: str = 'open', actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT i.id, i.requisition_id, i.portal_key, i.portal_name, i.issue_type,
                   i.note, i.status, i.created_at, r.title AS requisition_title
            FROM job_portal_issues i
            LEFT JOIN requisitions r ON r.id = i.requisition_id
            WHERE i.tenant_id=$1 AND ($2='' OR i.status=$2)
            ORDER BY i.created_at DESC
        """, actor.tenant_id, status)
    return [dict(r) for r in rows]


@router.patch("/issues/{issue_id}/resolve")
async def resolve_issue(issue_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            UPDATE job_portal_issues
            SET status='resolved', resolved_by=$1, resolved_at=now()
            WHERE id=$2 AND tenant_id=$3
            RETURNING id
        """, actor.user_id, issue_id, actor.tenant_id)
    if not row:
        raise HTTPException(404, "Issue not found")
    return {"resolved": True}
