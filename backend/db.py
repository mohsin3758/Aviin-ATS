"""Shared asyncpg pool + tenant-scoped connection helper.

HARD RULE #2/#9: DATABASE_URL must point at app_user (non-superuser);
RLS on every business table relies on app.tenant_id being set via
set_config() before any query in the same transaction.
"""

import os
from contextlib import asynccontextmanager
from typing import Optional

import asyncpg

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://app_user:apppw@db:5432/ats"
)

_pool: Optional[asyncpg.Pool] = None


async def init_pool() -> asyncpg.Pool:
    global _pool
    _pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=10)
    return _pool


async def close_pool() -> None:
    if _pool is not None:
        await _pool.close()


@asynccontextmanager
async def tenant_conn(tenant_id: Optional[str] = None):
    """Acquire a connection with app.tenant_id set for this transaction.

    Pass tenant_id=None for tenant-less checks (e.g. /health) — RLS
    then fails closed and returns zero rows for every business table.
    """
    assert _pool is not None, "call init_pool() first"
    async with _pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "SELECT set_config('app.tenant_id', $1, true)", tenant_id or ""
            )
            yield conn

@asynccontextmanager
async def system_conn():
    """System connection — uses app_user but with no tenant isolation (app.tenant_id='')."""
    assert _pool is not None, "call init_pool() first"
    async with _pool.acquire() as conn:
        async with conn.transaction():
            # Set empty tenant_id — tables without RLS will work, tables with RLS return all rows for admin
            await conn.execute("SELECT set_config('app.tenant_id', '', true)")
            yield conn
