"""WhatsApp Screening Blueprint, Milestone 2 (Phase 3-4): Tier-0 regex for
numeric answers, Tier-2 Qwen (via ai_router.generate -- HARD RULE #4,
semantic-cached, never a direct Ollama call) for free-text role/modules
extraction. Every answer is logged to screening_answers regardless of
method, then materialized into candidate_skill_experience / candidates.*
-- the same tables a recruiter's manual entry form and the resume parser
already populate.

candidate_skill_experience (sql/85) has no numeric years column and no
unique constraint enabling a real upsert -- the established pattern
elsewhere is delete+reinsert or plain append. Screening writes ONE row
per skill (assembled once all 3 sub-answers for that skill are in,
re-reading its own screening_answers rows rather than tracking state
separately), storing years/projects as a descriptive summary in the
existing relevant_experience TEXT column and modules in role_types TEXT[]
-- reusing real columns rather than inventing new ones.

COALESCE is used on every candidates.* write here so a regex/Qwen guess
never overwrites a value a recruiter (or the resume parser) already set
-- same spirit as "never guess-correct a candidate's identity fields",
applied to CTC/notice/location.
"""
import json
import re

import ai_router


def _first_number(text: str) -> float | None:
    m = re.search(r"(\d+(?:\.\d+)?)", text or "")
    return float(m.group(1)) if m else None


def _parse_ctc_notice(raw: str) -> dict:
    numbers = [float(n) for n in re.findall(r"\d+(?:\.\d+)?", raw or "")]
    current_ctc = numbers[0] if len(numbers) >= 1 else None
    expected_ctc = numbers[1] if len(numbers) >= 2 else None
    notice_days = None
    if len(numbers) >= 3:
        notice_val = numbers[2]
        notice_days = int(notice_val * 30) if re.search(r"month", raw or "", re.I) else int(notice_val)
    is_serving = True if re.search(r"\bserving\b", raw or "", re.I) else None
    return {"current_ctc": current_ctc, "expected_ctc": expected_ctc,
            "notice_period_days": notice_days, "is_serving_notice": is_serving}


def _parse_location(raw: str) -> dict:
    raw = (raw or "").strip()
    relocation_note = None
    if re.search(r"\b(yes|open|willing)\b", raw, re.I):
        relocation_note = f"Open to relocation: yes — {raw}"
    elif re.search(r"\b(no|not)\b", raw, re.I):
        relocation_note = f"Open to relocation: no — {raw}"
    return {"location": raw[:200] or None, "relocation_note": relocation_note}


async def _extract_role_modules(conn, tenant_id: str, raw_answer: str) -> dict:
    prompt = (
        "Extract the role and tools/modules mentioned in this candidate's answer "
        "about their project experience. Return ONLY a JSON object, no markdown, "
        'no explanation, in exactly this shape: {"role": "<short role description>", '
        '"modules": ["<tool or module>", ...]}.\n\n'
        f'Candidate answer: "{raw_answer}"'
    )
    try:
        result = await ai_router.generate(conn, tenant_id, f"screening_role_modules:{raw_answer[:200]}", prompt)
        text = result.get("text", "") or ""
        m = re.search(r"\{[\s\S]*?\}", text)
        if m:
            parsed = json.loads(m.group(0))
            return {"role": parsed.get("role") or raw_answer, "modules": parsed.get("modules") or []}
    except Exception:
        pass
    return {"role": raw_answer, "modules": []}


async def _extract(conn, tenant_id: str, question: dict, raw_answer: str) -> tuple[dict, str]:
    qtype = question["type"]
    if qtype == "skill_years":
        return {"years": _first_number(raw_answer)}, "regex"
    if qtype == "skill_projects":
        n = _first_number(raw_answer)
        return {"projects": int(n) if n is not None else None}, "regex"
    if qtype == "skill_role":
        return await _extract_role_modules(conn, tenant_id, raw_answer), "qwen"
    if qtype == "generic_ctc_notice":
        return _parse_ctc_notice(raw_answer), "regex"
    if qtype == "generic_location":
        return _parse_location(raw_answer), "regex"
    return {"raw": raw_answer}, "none"


async def record_answer(conn, tenant_id: str, session, question: dict, raw_answer: str) -> dict:
    extracted, method = await _extract(conn, tenant_id, question, raw_answer)

    await conn.execute(
        """INSERT INTO screening_answers
             (tenant_id, screening_session_id, question_key, question_text, raw_answer,
              extracted_value, extraction_method)
           VALUES ($1,$2,$3,$4,$5,$6,$7)""",
        tenant_id, session["id"], question["key"], question["text"], raw_answer,
        json.dumps(extracted), method)

    qtype = question["type"]
    if qtype == "skill_role":
        skill = question["skill"]
        years_row = await conn.fetchrow(
            "SELECT extracted_value FROM screening_answers WHERE screening_session_id=$1 AND question_key=$2",
            session["id"], f"skill_years::{skill}")
        proj_row = await conn.fetchrow(
            "SELECT extracted_value FROM screening_answers WHERE screening_session_id=$1 AND question_key=$2",
            session["id"], f"skill_projects::{skill}")

        def _val(row, field):
            if not row:
                return None
            v = row["extracted_value"]
            v = json.loads(v) if isinstance(v, str) else v
            return (v or {}).get(field)

        years = _val(years_row, "years")
        projects = _val(proj_row, "projects")
        summary = f"{years if years is not None else '?'} yrs, {projects if projects is not None else '?'} project(s) — {extracted.get('role', '')}".strip(" —")
        await conn.execute(
            """INSERT INTO candidate_skill_experience
                 (tenant_id, candidate_id, skill_name, project_name, relevant_experience, role_types)
               VALUES ($1,$2,$3,'Self-reported via WhatsApp screening',$4,$5)""",
            tenant_id, session["candidate_id"], skill, summary, extracted.get("modules") or [])
    elif qtype == "generic_ctc_notice":
        await conn.execute(
            """UPDATE candidates SET
                 current_ctc = COALESCE(current_ctc, $1),
                 expected_ctc = COALESCE(expected_ctc, $2),
                 notice_period_days = COALESCE(notice_period_days, $3),
                 is_serving_notice = COALESCE(is_serving_notice, $4)
               WHERE id=$5""",
            extracted.get("current_ctc"), extracted.get("expected_ctc"),
            extracted.get("notice_period_days"), extracted.get("is_serving_notice"),
            session["candidate_id"])
    elif qtype == "generic_location":
        if extracted.get("location"):
            await conn.execute(
                "UPDATE candidates SET location = COALESCE(location, $1) WHERE id=$2",
                extracted["location"], session["candidate_id"])
        if extracted.get("relocation_note"):
            await conn.execute(
                "UPDATE candidates SET desired_location = COALESCE(desired_location, $1) WHERE id=$2",
                extracted["relocation_note"], session["candidate_id"])

    return extracted
