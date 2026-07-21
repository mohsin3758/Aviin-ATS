from routers.signatures import router as sig_router
from routers.clients import router as clients_router
from routers.user_mail import router as user_mail_router
from routers.communications import router as comm_router
"""AIrecruit (AVIIN ATS) — FastAPI backend.

P1: candidate/requisition/pipeline/offer/assignment/consent/scorecard
endpoints + JWT auth (see deps.py for tenant/actor resolution).
P3: AI engine (match/assign + JD generation) and analytics views.
"""

import time
from collections import defaultdict
from contextlib import asynccontextmanager
from typing import Callable

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

import db
from routers.sse_router import sse_router
from routers import (
    phase3,
    pipeline_p2,
    ai,
    incentives,
    kae,
    account_pl,
    intelligence,
    assessments,
    predictions,
    vendor_analytics,
    scheduler_router,
    media,
    users,
    p23_p27,
    p28_p32,
    p30_p35,
    p36_p42,
    import_router,
    job_sharing,
    calendar,
    two_fa,
    sms,
    whatsapp_bot,
    headcount,
    onboarding,
    sso,
    final_features,
    analytics,
    applications,
    assignments,
    auth,
    bgv,
    candidates,
    consent,
    erp,
    offers,
    requisitions,
    scorecards,
    whatsapp,
    recruiter_dashboard,
)
from routers import recruiter_tracking

# GAP features (1-10)
from routers.gap_features import (
    nps_router, gdpr_new_router, talent_router,
    referral_router, referral_redirect_router,
    refcheck_router, ref_public_router,
    video_router, jobdist_router,
    bgv_api_router, reportbuilder_router,
    extension_router
)

from scheduler import start_scheduler

# ─── In-memory rate limiter (per-IP, no external deps) ───────────────────────
# CPython list ops are GIL-protected; safe for single-process uvicorn.
_rate_store: dict = defaultdict(list)

_LOGIN_LIMIT  = 10    # max login attempts per IP
_LOGIN_WINDOW = 900.0 # within 15 minutes

_GLOBAL_LIMIT  = 600   # max requests per IP
_GLOBAL_WINDOW = 60.0  # within 1 minute


def _check_rate(key: str, limit: int, window: float) -> bool:
    """Return True if request is allowed, False if rate limited."""
    now = time.monotonic()
    bucket = _rate_store[key]
    # Evict expired timestamps
    while bucket and now - bucket[0] > window:
        bucket.pop(0)
    if len(bucket) >= limit:
        return False
    bucket.append(now)
    return True


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable):
        ip = (request.client.host if request.client else "unknown")
        path = request.url.path

        if path in ("/auth/login", "/auth/register"):
            allowed = _check_rate(f"login:{ip}", _LOGIN_LIMIT, _LOGIN_WINDOW)
            if not allowed:
                return JSONResponse(
                    status_code=429,
                    content={"detail": "Too many login attempts. Try again in 15 minutes."},
                    headers={"Retry-After": "900"},
                )
        else:
            allowed = _check_rate(f"global:{ip}", _GLOBAL_LIMIT, _GLOBAL_WINDOW)
            if not allowed:
                return JSONResponse(
                    status_code=429,
                    content={"detail": "Rate limit exceeded. Please slow down."},
                    headers={"Retry-After": "60"},
                )

        return await call_next(request)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable):
        response = await call_next(request)
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["X-Powered-By"] = "AVIIN ATS"
        return response


# ─── App setup ────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init_pool()
    start_scheduler()
    try:
        import os as _os
        import imap_bg
        _db_url = _os.getenv('DATABASE_URL', 'postgresql://app_user:apppw@db:5432/ats')
        imap_bg.start(_db_url, interval=10)
    except Exception as _e:
        print('IMAP poller error: ' + str(_e))
    yield
    await db.close_pool()


app = FastAPI(title="AVIIN ATS API", lifespan=lifespan)

# Middleware order matters: outermost = first to process request, last to process response.
# Rate limiter before everything so blocked requests never hit business logic.
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3001",
        "http://localhost:3000",
        "http://187.127.179.128",
        "http://187.127.179.128:3001",
        "http://ats.aviinjobs.com",
        "https://ats.aviinjobs.com",
        "https://ats.aviintech.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(clients_router)
app.include_router(candidates.router)
app.include_router(requisitions.router)
app.include_router(applications.router)
app.include_router(offers.router)
from routers.offers import offer_sign_public
app.include_router(offer_sign_public)
app.include_router(assignments.router)
app.include_router(consent.router)
app.include_router(scorecards.router)
app.include_router(ai.router)
app.include_router(analytics.router)
app.include_router(whatsapp.router)
app.include_router(erp.router)
app.include_router(bgv.router)
app.include_router(incentives.router)
app.include_router(kae.router)
app.include_router(account_pl.router)
app.include_router(account_pl.coll_router)
app.include_router(account_pl.bu_router)
app.include_router(account_pl.ceo_router)
app.include_router(intelligence.router)
app.include_router(assessments.router)
app.include_router(predictions.router)
app.include_router(vendor_analytics.router)
app.include_router(scheduler_router.router)
app.include_router(media.router)
app.include_router(users.router)
from routers import email_settings
app.include_router(email_settings.router)
from routers import resume_intake
app.include_router(resume_intake.router)
from routers import nda
app.include_router(nda.router)
app.include_router(nda.nda_router)
app.include_router(nda.nda_sign_public)
from routers import pipeline_stages
app.include_router(pipeline_stages.router)
from routers import whatsapp_settings
app.include_router(whatsapp_settings.router)
app.include_router(users.roles_router)
app.include_router(p23_p27.skills_router)
app.include_router(p23_p27.bulk_router)
app.include_router(p23_p27.email_router)
app.include_router(p23_p27.interview_router)
app.include_router(p23_p27.client_portal_router)
app.include_router(p23_p27.sla_router)
app.include_router(p23_p27.activity_router)
app.include_router(p23_p27.jd_tmpl_router)
app.include_router(p28_p32.audit_router)
app.include_router(p28_p32.export_router)
app.include_router(p28_p32.jobs_router)
app.include_router(p28_p32.public_jobs_router)
app.include_router(p28_p32.salary_router)
app.include_router(p28_p32.notif_router)
app.include_router(p30_p35.automation_router)
app.include_router(p30_p35.tags_router)
app.include_router(p30_p35.qbank_router)
app.include_router(p30_p35.dup_router)
app.include_router(p36_p42.reports_router)
app.include_router(p36_p42.compliance_router)
app.include_router(import_router.import_router)
app.include_router(job_sharing.router)
app.include_router(calendar.router)
app.include_router(two_fa.router)
app.include_router(sms.router)
app.include_router(whatsapp_bot.router)
app.include_router(headcount.router)
app.include_router(onboarding.router)
app.include_router(sso.router)
app.include_router(final_features.pdf_router)
app.include_router(final_features.ai_router)
app.include_router(final_features.status_router)
app.include_router(final_features.gdpr_router)
app.include_router(final_features.nurture_router)
app.include_router(final_features.notif_router)
app.include_router(p36_p42.health_router)
app.include_router(p36_p42.forecast_router)
app.include_router(recruiter_dashboard.router)
app.include_router(recruiter_tracking.router)
# app.include_router(p36_p42.rules_router)  # disabled: conflicts with pipeline_p2.rules_router

app.include_router(pipeline_p2.metrics_router)
app.include_router(pipeline_p2.intel_router)
app.include_router(pipeline_p2.rules_router)
app.include_router(phase3.auto_interview_router)
app.include_router(phase3.waha_router)
app.include_router(phase3.auto_offer_router)
app.include_router(comm_router)
app.include_router(user_mail_router)
app.include_router(sig_router)
app.include_router(phase3.schedule_router)

app.include_router(sse_router)

# Register GAP feature routers (10 gaps)
app.include_router(nps_router)
app.include_router(gdpr_new_router)
app.include_router(talent_router)
app.include_router(referral_router)
app.include_router(referral_redirect_router)
app.include_router(refcheck_router)
app.include_router(ref_public_router)
app.include_router(video_router)
app.include_router(jobdist_router)
app.include_router(bgv_api_router)
app.include_router(reportbuilder_router)
app.include_router(extension_router)


@app.get("/health")
async def health():
    try:
        async with db.tenant_conn() as conn:
            await conn.fetchval("SELECT 1")
        db_ok = True
    except Exception:
        db_ok = False
    return {"ok": db_ok}


@app.on_event('startup')
async def start_imap_bg():
    import os
    import imap_bg
    db_url = os.getenv('DATABASE_URL', 'postgresql://app_user:apppw@db:5432/ats')
    imap_bg.start(db_url, interval=10)
    print('[STARTUP] IMAP background poller started')
