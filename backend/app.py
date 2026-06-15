"""AIrecruit (FinStack Staffing OS) — FastAPI backend.

P1: candidate/requisition/pipeline/offer/assignment/consent/scorecard
endpoints + JWT auth (see deps.py for tenant/actor resolution).
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI

import db
from routers import applications, assignments, auth, candidates, consent, offers, requisitions, scorecards


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init_pool()
    yield
    await db.close_pool()


app = FastAPI(title="AIrecruit API", lifespan=lifespan)

app.include_router(auth.router)
app.include_router(candidates.router)
app.include_router(requisitions.router)
app.include_router(applications.router)
app.include_router(offers.router)
app.include_router(assignments.router)
app.include_router(consent.router)
app.include_router(scorecards.router)


@app.get("/health")
async def health():
    try:
        async with db.tenant_conn() as conn:
            await conn.fetchval("SELECT 1")
        db_ok = True
    except Exception:
        db_ok = False
    return {"ok": db_ok}
