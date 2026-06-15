"""AIrecruit (FinStack Staffing OS) — FastAPI backend.

P0: infrastructure skeleton only (/health). Candidate/requisition/
pipeline/offer endpoints are built in P1.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI

import db


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init_pool()
    yield
    await db.close_pool()


app = FastAPI(title="AIrecruit API", lifespan=lifespan)


@app.get("/health")
async def health():
    try:
        async with db.tenant_conn() as conn:
            await conn.fetchval("SELECT 1")
        db_ok = True
    except Exception:
        db_ok = False
    return {"ok": db_ok}
