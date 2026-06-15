"""Fills resume_embedding / jd_embedding vector(384) columns.

Tier 1 of the zero-token cascade (HARD RULE #3): calls the local
BGE-small embedding service (embed/embed_service.py) over HTTP, never
an external embeddings API.

Run inside the backend container:
  docker compose exec backend python embed_writer.py
"""

import asyncio
import os

import asyncpg
import httpx

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://app_user:apppw@db:5432/ats"
)
EMBED_URL = os.environ.get("EMBED_URL", "http://embed:8081")

BATCH_SIZE = 16


def to_vector_literal(vec: list[float]) -> str:
    return "[" + ",".join(f"{x:.8f}" for x in vec) + "]"


async def embed_texts(client: httpx.AsyncClient, texts: list[str]) -> list[list[float]]:
    resp = await client.post(f"{EMBED_URL}/embed", json={"texts": texts}, timeout=60.0)
    resp.raise_for_status()
    return resp.json()["embeddings"]


async def set_tenant(conn: asyncpg.Connection, tenant_id) -> None:
    # session-level (not LOCAL): must persist across the multiple statements
    # run for this tenant outside any explicit transaction
    await conn.execute("SELECT set_config('app.tenant_id', $1, false)", str(tenant_id))


async def fill_candidates(conn: asyncpg.Connection, client: httpx.AsyncClient) -> int:
    rows = await conn.fetch(
        "SELECT id, resume_text FROM candidates "
        "WHERE resume_embedding IS NULL AND resume_text IS NOT NULL"
    )
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        vectors = await embed_texts(client, [r["resume_text"] for r in batch])
        for row, vec in zip(batch, vectors):
            await conn.execute(
                "UPDATE candidates SET resume_embedding = $1::vector WHERE id = $2",
                to_vector_literal(vec), row["id"],
            )
    return len(rows)


async def fill_requisitions(conn: asyncpg.Connection, client: httpx.AsyncClient) -> int:
    rows = await conn.fetch(
        "SELECT id, title, description, skills_required FROM requisitions "
        "WHERE jd_embedding IS NULL"
    )
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        texts = [
            f"{r['title']}. {r['description'] or ''} Skills: "
            f"{', '.join(r['skills_required'] or [])}."
            for r in batch
        ]
        vectors = await embed_texts(client, texts)
        for row, vec in zip(batch, vectors):
            await conn.execute(
                "UPDATE requisitions SET jd_embedding = $1::vector WHERE id = $2",
                to_vector_literal(vec), row["id"],
            )
    return len(rows)


async def main() -> None:
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    async with httpx.AsyncClient() as client, pool.acquire() as conn:
        tenants = await conn.fetch("SELECT id, slug FROM tenants")
        for t in tenants:
            async with conn.transaction():
                await set_tenant(conn, t["id"])
                n_cand = await fill_candidates(conn, client)
                n_req = await fill_requisitions(conn, client)
            print(f"tenant={t['slug']}: embedded {n_cand} candidates, {n_req} requisitions")
    await pool.close()


if __name__ == "__main__":
    asyncio.run(main())
