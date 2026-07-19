"""GAP Features - NPS, GDPR, Talent Pool, Referrals, Refcheck, Video, Job Dist, BGV, Reports, Extension."""
from fastapi import APIRouter

nps_router           = APIRouter(prefix="/nps",            tags=["nps"])
gdpr_new_router      = APIRouter(prefix="/gdpr",           tags=["gdpr"])
talent_router        = APIRouter(prefix="/talent-pool",    tags=["talent-pool"])
referral_router      = APIRouter(prefix="/referrals",      tags=["referrals"])
referral_redirect_router = APIRouter(prefix="/r",          tags=["referral-redirect"])
refcheck_router      = APIRouter(prefix="/refcheck",       tags=["refcheck"])
ref_public_router    = APIRouter(prefix="/ref-public",     tags=["ref-public"])
video_router         = APIRouter(prefix="/video",          tags=["video"])
jobdist_router       = APIRouter(prefix="/job-distribution", tags=["job-distribution"])
bgv_api_router       = APIRouter(prefix="/bgv-api",        tags=["bgv-api"])
reportbuilder_router = APIRouter(prefix="/report-builder", tags=["report-builder"])
extension_router     = APIRouter(prefix="/extension",      tags=["extension"])

@nps_router.get("/status")
async def nps_status(): return {"configured": False}

@talent_router.get("/")
async def talent_list(): return {"candidates": []}

@referral_router.get("/")
async def referral_list(): return {"referrals": []}

@jobdist_router.get("/status")
async def jobdist_status(): return {"boards": []}

@reportbuilder_router.get("/")
async def report_list(): return {"reports": []}

@extension_router.get("/ping")
async def ext_ping(): return {"ok": True}
