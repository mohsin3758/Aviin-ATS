"""Tier 2-lite generation endpoints — all routed through ai_router.py
(HARD RULES #1/#3/#4: local Ollama only, 384-dim BGE-small embeddings,
semantic cache lookup before generation)."""

import logging

from fastapi import APIRouter, Depends, HTTPException

import ai_router
import db
from deps import Actor, get_actor
from schemas import JDGenerateRequest

log = logging.getLogger(__name__)
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

    # QA sweep (2026-09-01) — degraded-dependency check: this was the one
    # real ai_router.generate() caller with no try/except at all (the other
    # 3 — offers.py's letter generation, final_features.py's 2 sites — all
    # already fall back cleanly). A down Ollama/embed service previously
    # propagated as a raw, generic 500 with no actionable message. Matches
    # phase3.py's own established try/except pattern; unlike offer letters,
    # a JD has no safe template fallback to fabricate (that risks silently
    # passing off a generic filler as if it were the real generated JD), so
    # this surfaces a clean, honest 503 instead.
    try:
        async with db.tenant_conn(actor.tenant_id) as conn:
            result = await ai_router.generate(conn, actor.tenant_id, cache_key, prompt)
    except Exception as e:
        log.warning(f"AI Router JD generation failed: {e}")
        raise HTTPException(
            status_code=503,
            detail="AI-powered JD generation is temporarily unavailable. Please try again shortly, "
                   "or write the job description manually.",
        )

    return {"jd_text": result["text"], "cached": result["cached"], "similarity": result["similarity"]}
