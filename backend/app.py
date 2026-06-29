"""AIrecruit (AVIIN ATS) — FastAPI backend.

P1: candidate/requisition/pipeline/offer/assignment/consent/scorecard
endpoints + JWT auth (see deps.py for tenant/actor resolution).
P3: AI engine (match/assign + JD generation) and analytics views.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import db
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
)

from scheduler import start_scheduler

@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init_pool()
    start_scheduler()
    yield
    await db.close_pool()


app = FastAPI(title="AVIIN ATS API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3001",
        "http://localhost:3000",
        "http://187.127.179.128",
        "http://187.127.179.128:3001",
        "http://ats.aviinjobs.com",
        "https://ats.aviinjobs.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(candidates.router)
app.include_router(requisitions.router)
app.include_router(applications.router)
app.include_router(offers.router)
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
# app.include_router(p36_p42.rules_router)  # disabled: conflicts with pipeline_p2.rules_router


# pipeline_p2 routers registered early below

app.include_router(pipeline_p2.metrics_router)
app.include_router(pipeline_p2.intel_router)
app.include_router(pipeline_p2.rules_router)
app.include_router(phase3.auto_interview_router)
app.include_router(phase3.waha_router)
app.include_router(phase3.auto_offer_router)
app.include_router(phase3.schedule_router)

@app.get("/health")
async def health():
    try:
        async with db.tenant_conn() as conn:
            await conn.fetchval("SELECT 1")
        db_ok = True
    except Exception:
        db_ok = False
    return {"ok": db_ok}
