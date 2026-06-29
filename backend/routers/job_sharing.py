"""LinkedIn/Naukri job sharing links."""
from urllib.parse import urlencode, quote
from fastapi import APIRouter, Depends, HTTPException
import db
from deps import Actor, get_actor

router = APIRouter(prefix="/job-sharing", tags=["job-sharing"])
BASE_URL = "http://187.127.179.128"

@router.get("/requisition/{req_id}")
async def share_links(req_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        req = await conn.fetchrow(
            "SELECT * FROM requisitions WHERE id=$1 AND tenant_id=$2", req_id, actor.tenant_id)
        if not req: raise HTTPException(404, "Not found")
    job_url = f"{BASE_URL}/jobs/{req_id}"
    title   = req["title"]
    loc     = req["location"] or "Bengaluru"
    skills  = list(req["skills_required"] or [])
    desc    = (req["description"] or f"{title} opportunity")[:300]
    wa_msg  = f"*{title}*\n📍 {loc} | {req['employment_type']}\n🎯 Skills: {', '.join(skills[:4])}\nApply: {job_url}\n\n_AVIIN Jobs — AI Staffing_"
    return {
        "job_url": job_url,
        "linkedin_share":  f"https://www.linkedin.com/sharing/share-offsite/?{urlencode({'url':job_url,'title':title,'summary':desc})}",
        "naukri_post":     f"https://www.naukri.com/jd?{urlencode({'title':title,'location':loc,'skills':','.join(skills[:5])})}",
        "indeed_post":     f"https://www.indeed.com/job/post?{urlencode({'title':title,'location':loc})}",
        "whatsapp_share":  f"https://wa.me/?text={quote(wa_msg)}",
        "email_share":     f"mailto:?subject={quote(title)}&body={quote(f'Apply: {job_url}')}",
        "whatsapp_message": wa_msg,
        "linkedin_post": f"{title}\n\n{desc}\n\nLocation: {loc}\nSkills: {', '.join(skills[:5])}\n\nApply: {job_url}",
    }

@router.post("/log")
async def log_share(req_id: str, platform: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute("""
            INSERT INTO job_shares (tenant_id,requisition_id,platform,posted_by)
            VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING
        """, actor.tenant_id, req_id, platform, actor.user_id)
    return {"logged": True, "platform": platform}

@router.get("/stats")
async def stats(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT platform, COUNT(*) shares, SUM(click_count) clicks
            FROM job_shares WHERE tenant_id=$1
            GROUP BY platform ORDER BY shares DESC
        """, actor.tenant_id)
    return [dict(r) for r in rows]
