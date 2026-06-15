"""AI Router — the ONE module every Tier-2 AI call passes through.

Enforces:
  HARD RULE #1 — never calls an external LLM API, only local Ollama.
  HARD RULE #3 — embeddings are always vector(384) (BGE-small-en-v1.5).
  HARD RULE #4 — semantic cache lookup (ai_cache.prompt_embedding,
                 cosine similarity > 0.95) happens BEFORE any Ollama
                 call, not just an exact prompt-text/hash match.

Tier 0/1 work (match_candidates, match_recruiters,
assign_with_explanation — sql/04_phase3_ai_engine.sql) is pure
Postgres/pgvector and does not go through this module.
"""

import os

import asyncpg
import httpx

EMBED_URL = os.environ.get("EMBED_URL", "http://embed:8081")
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://ollama:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen2.5:1.5b-instruct-q4_K_M")

EMBED_DIMS = 384
CACHE_SIMILARITY_THRESHOLD = 0.95


def _vector_literal(vec: list[float]) -> str:
    return "[" + ",".join(f"{x:.8f}" for x in vec) + "]"


async def embed_text(text: str) -> list[float]:
    """Tier 1: BGE-small-en-v1.5 via the local embed service. 384-dim only."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(f"{EMBED_URL}/embed", json={"texts": [text]}, timeout=30.0)
        resp.raise_for_status()
    vector = resp.json()["embeddings"][0]
    if len(vector) != EMBED_DIMS:
        raise ValueError(f"embed service returned {len(vector)}-dim vector, expected {EMBED_DIMS}")
    return vector


async def cache_lookup(
    conn: asyncpg.Connection, model: str, embedding: list[float]
) -> dict | None:
    """HARD RULE #4: cosine-similarity cache lookup, not exact-hash."""
    literal = _vector_literal(embedding)
    row = await conn.fetchrow(
        """SELECT id, response, hit_count,
                  1 - (prompt_embedding <=> $1::vector) AS similarity
           FROM ai_cache
           WHERE model = $2
           ORDER BY prompt_embedding <=> $1::vector
           LIMIT 1""",
        literal, model,
    )
    if row is None or row["similarity"] < CACHE_SIMILARITY_THRESHOLD:
        return None

    await conn.execute(
        "UPDATE ai_cache SET hit_count = hit_count + 1, last_hit_at = now() WHERE id = $1",
        row["id"],
    )
    return {
        "response": row["response"],
        "similarity": float(row["similarity"]),
        "hit_count": row["hit_count"] + 1,
    }


async def cache_store(
    conn: asyncpg.Connection,
    tenant_id: str,
    cache_key: str,
    prompt_text: str,
    embedding: list[float],
    response: str,
    model: str,
) -> None:
    await conn.execute(
        """INSERT INTO ai_cache (tenant_id, cache_key, prompt_text, prompt_embedding, response, model)
           VALUES ($1, $2, $3, $4::vector, $5, $6)""",
        tenant_id, cache_key, prompt_text, _vector_literal(embedding), response, model,
    )


async def call_ollama(prompt: str, model: str = OLLAMA_MODEL) -> str:
    """HARD RULE #1: local Qwen2.5 via Ollama, never an external LLM API."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{OLLAMA_URL}/api/generate",
            json={"model": model, "prompt": prompt, "stream": False},
            timeout=120.0,
        )
        resp.raise_for_status()
    return resp.json()["response"].strip()


async def generate(
    conn: asyncpg.Connection,
    tenant_id: str,
    cache_key: str,
    prompt_text: str,
    model: str = OLLAMA_MODEL,
) -> dict:
    """Tier 2-lite cascade entry point: cache-first Qwen2.5 generation.

    Returns {"text": str, "cached": bool, "similarity": float | None}.
    """
    embedding = await embed_text(prompt_text)

    cached = await cache_lookup(conn, model, embedding)
    if cached is not None:
        return {"text": cached["response"], "cached": True, "similarity": cached["similarity"]}

    text = await call_ollama(prompt_text, model)
    await cache_store(conn, tenant_id, cache_key, prompt_text, embedding, text, model)
    return {"text": text, "cached": False, "similarity": None}
