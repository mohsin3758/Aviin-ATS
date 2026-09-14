"""WhatsApp automation research (2026-09-15), gap #10: a candidate going
off-script mid-screening (e.g. "what's the salary range?") to ask a real
question, rather than answering the question just sent, previously had no
defined handling -- confusing the linear Q&A loop. Answered here via local
Qwen2.5 only (Hard Rule #1 -- never an external LLM), grounded in the
real requisition's own public-facing fields, then the original question
is re-sent unchanged so the screening sequence itself never advances or
skips on an off-script turn.

Salary/CTC questions are deliberately deflected rather than answered from
requisitions.budget_max -- that figure is the CLIENT's negotiating ceiling,
not something a recruiter would want a bot blurting to a candidate before
a human ever discusses compensation with them.
"""
import re

import ai_router
from services.screening_i18n import t

_SALARY_WORDS = re.compile(r"\b(salary|ctc|pay|package|compensation|budget|stipend)\b", re.I)
_CORRECTION_WORDS = re.compile(
    r"\b(actually|sorry|correction|i meant|my mistake|typo|wrong|not \d)\b", re.I)


def looks_like_correction(text: str) -> bool:
    """Blueprint's own v1 scope note: 'a candidate's self-correction is
    fixed manually via the existing candidate_skill_experience edit form'
    -- but that was never paired with a DEFINED bot response to the
    correction attempt itself; it just silently got treated as a literal
    answer to whatever question was current, alongside the earlier good
    answer neither the bot nor the recruiter would know to look twice at.
    Deliberately does NOT try to guess which earlier answer to overwrite
    or with what value -- an ambiguous regex guess risks corrupting a
    correct answer with a wrong one, the same class of harm as guess-
    correcting a candidate's identity fields. Routes to a human instead."""
    return bool(_CORRECTION_WORDS.search(text or ""))


def looks_like_question(text: str) -> bool:
    """Cheap, language-agnostic Tier-0 signal: a real answer to "how many
    years of experience" doesn't usually contain a '?' or start with an
    interrogative word. Deliberately conservative (a few genuine answers
    with a stray '?' get routed here too) -- the cost of a false positive
    is just one extra FAQ turn before the original question is re-sent,
    never a lost or skipped answer."""
    text = (text or "").strip()
    if "?" in text:
        return True
    starters = ("what", "how", "why", "when", "where", "which", "who", "can i", "could i",
                "is there", "are there", "do you", "does this", "will i")
    return text.lower().startswith(starters)


async def answer_question(conn, tenant_id: str, requisition_id: str, question_text: str, lang: str = "en") -> str:
    if _SALARY_WORDS.search(question_text or ""):
        return t("faq_salary_deflect", lang)

    req = await conn.fetchrow(
        """SELECT r.title, r.employment_type, r.location, cl.name AS client_name
           FROM requisitions r LEFT JOIN clients cl ON cl.id = r.client_id
           WHERE r.id=$1 AND r.tenant_id=$2""",
        requisition_id, tenant_id)
    if not req:
        return t("faq_generic_fallback", lang)

    context = (
        f"Role: {req['title'] or 'this role'}. Client: {req['client_name'] or 'our client'}. "
        f"Employment type: {req['employment_type'] or 'not specified'}. "
        f"Location: {req['location'] or 'not specified'}."
    )
    prompt = (
        "You are a recruiting assistant messaging a candidate on WhatsApp. Using ONLY the context below, "
        "answer their question in one short, friendly sentence. If the context doesn't cover it, say a "
        "recruiter will confirm the details soon. Never invent facts not in the context.\n"
        f"Context: {context}\nCandidate question: {question_text}\nAnswer:"
    )
    try:
        result = await ai_router.generate(
            conn, tenant_id, f"screening_faq:{requisition_id}:{(question_text or '')[:200]}", prompt)
        answer = (result.get("text") or "").strip()
        return answer[:400] if answer else t("faq_generic_fallback", lang)
    except Exception:
        return t("faq_generic_fallback", lang)
