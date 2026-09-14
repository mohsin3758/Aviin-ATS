"""WhatsApp Screening Blueprint, Milestone 2 (Phase 3-4): expands a
requisition's mandatory_skills into the standard question block, then
appends the generic CTC/notice/location questions (decision #1's
"manual add/remove" hook is screening_questions_config.skip_keys /
extra_questions, read here).

mandatory_skills is TEXT[] + a separate sparse mandatory_skill_min_years
JSONB map keyed by skill name (sql/80, sql/121) -- NOT one combined JSON
structure, a correction from the original blueprint's assumption made
during Milestone 1 planning.
"""
import json


def _skill_questions(skill: str) -> list[dict]:
    return [
        {"key": f"skill_years::{skill}", "type": "skill_years", "skill": skill,
         "text": f"How many years of experience do you have in {skill}?"},
        {"key": f"skill_projects::{skill}", "type": "skill_projects", "skill": skill,
         "text": f"How many {skill} projects have you completed?"},
        {"key": f"skill_role::{skill}", "type": "skill_role", "skill": skill,
         "text": "What was your role in those projects, and which modules/tools did you use?"},
    ]


GENERIC_QUESTIONS = [
    {"key": "generic_ctc_notice", "type": "generic_ctc_notice",
     "text": "What's your current and expected CTC, and notice period?"},
    {"key": "generic_location", "type": "generic_location",
     "text": "What's your current location, and are you open to relocating?"},
]


async def build_question_sequence(conn, tenant_id: str, requisition_id: str) -> list[dict]:
    req = await conn.fetchrow(
        "SELECT mandatory_skills, screening_questions_config FROM requisitions WHERE id=$1 AND tenant_id=$2",
        requisition_id, tenant_id)
    if not req:
        return []
    skills = req["mandatory_skills"] or []
    config = req["screening_questions_config"]
    config = json.loads(config) if isinstance(config, str) else (config or {})

    questions: list[dict] = []
    for skill in skills:
        questions.extend(_skill_questions(skill))
    questions.extend(GENERIC_QUESTIONS)

    for extra in config.get("extra_questions", []):
        if extra.get("key") and extra.get("text"):
            questions.append({"key": extra["key"], "type": "custom", "text": extra["text"]})

    skip = set(config.get("skip_keys", []))
    return [q for q in questions if q["key"] not in skip]


def next_question(sequence: list[dict], answered_keys: set[str]) -> dict | None:
    for q in sequence:
        if q["key"] not in answered_keys:
            return q
    return None
