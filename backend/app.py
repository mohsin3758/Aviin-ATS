"""AIrecruit (FinStack Staffing OS) — FastAPI backend.

P1: candidate/requisition/pipeline/offer/assignment/consent/scorecard
endpoints + JWT auth (see deps.py for tenant/actor resolution).
P3: AI engine (match/assign + JD generation) and analytics views.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import db
from routers import (
    ai,
    analytics,
    applications,
    assignments,
    auth,
    candidates,
    consent,
    offers,
    requisitions,
    scorecards,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init_pool()
    yield
    await db.close_pool()


app = FastAPI(title="AIrecruit API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3001", "http://localhost:3000"],
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


@app.get("/health")
async def health():
    try:
        async with db.tenant_conn() as conn:
            await conn.fetchval("SELECT 1")
        db_ok = True
    except Exception:
        db_ok = False
    return {"ok": db_ok}
