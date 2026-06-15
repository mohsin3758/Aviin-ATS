"""Tier 2-lite generation endpoints — all routed through ai_router.py
(HARD RULES #1/#3/#4: local Ollama only, 384-dim BGE-small embeddings,
semantic cache lookup before generation)."""

from fastapi import APIRouter, Depends

import ai_router
import db
from deps import Actor, get_actor
from schemas import JDGenerateRequest

router = APIRouter(tags=["ai"])


def _jd_prompt(body: JDGenerateRequest) -> str:
    lines = [f"Write a concise job description for the role: {body.title}."]
    if body.skills_required:
        lines.append(f"Required skills: {', '.join(body.skills_required)}.")
    if body.experience_years is not None:
        lines.append(f"Experience required: {body.experience_years} years.")
    if body.location:
        lines.append(f"Location: {body.location}.")
    lines.append(f"Employment type: {body.employment_type}.")
    if body.notes:
        lines.append(f"Additional notes: {body.notes}.")
    lines.append("Include a short summary, key responsibilities, and required qualifications.")
    return " ".join(lines)


@router.post("/jd/generate")
async def generate_jd(body: JDGenerateRequest, actor: Actor = Depends(get_actor)):
    prompt = _jd_prompt(body)
    cache_key = "jd_generate:" + body.title.strip().lower()

    async with db.tenant_conn(actor.tenant_id) as conn:
        result = await ai_router.generate(conn, actor.tenant_id, cache_key, prompt)

    return {"jd_text": result["text"], "cached": result["cached"], "similarity": result["similarity"]}
