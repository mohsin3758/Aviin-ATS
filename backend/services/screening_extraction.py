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
    """Confirmed live (2026-09-14): dumping the whole raw reply into both
    `location` AND `relocation_note` produced a messy, duplicated result
    ("Bangalore, open to relocating" as the location; the relocation note
    repeating the same full sentence again). The natural reply pattern is
    "<city>, <relocation answer>" -- split on the first comma so
    `location` holds just the place name. Falls back to the whole raw
    text when there's no comma (a recruiter can always correct via the
    existing candidate edit form, same as any other free-text field)."""
    raw = (raw or "").strip()
    # WhatsApp automation research (2026-09-15), gap #1: a native WhatsApp
    # "share location" message is a distinct payload type, not free text --
    # routed here as a synthetic "@lat,lng" marker by the webhook (see
    # routers/whatsapp_bot.py's has_location branch) specifically so it
    # never goes through the comma-split heuristic below, which is built
    # for a typed sentence like "Bangalore, open to relocating" and would
    # otherwise mangle two floating-point numbers the same way the original
    # whole-raw-answer bug did (fixed 2026-09-14, see 541570a).
    if raw.startswith("@") and "," in raw:
        lat, _, lng = raw[1:].partition(",")
        if lat.strip().replace("-", "").replace(".", "").isdigit() and \
           lng.strip().replace("-", "").replace(".", "").isdigit():
            return {"location": f"Shared GPS location ({lat.strip()}, {lng.strip()})", "relocation_note": None}
    if "," in raw:
        city_part, rest = raw.split(",", 1)
    else:
        city_part, rest = raw, raw
    relocation_note = None
    willing_to_relocate = None
    if re.search(r"\b(yes|open|willing)\b", rest, re.I):
        relocation_note = "Open to relocation"
        willing_to_relocate = True
    elif re.search(r"\b(no|not)\b", rest, re.I):
        relocation_note = "Not open to relocation"
        willing_to_relocate = False
    return {"location": city_part.strip()[:200] or None, "relocation_note": relocation_note,
            "willing_to_relocate": willing_to_relocate}


def _parse_total_experience(raw: str) -> dict:
    """Total experience was never actually asked over WhatsApp before this
    (2026-09-18 gap-analysis follow-up) even though candidates.total_exp_mo
    already existed, populated only by resume parsing/manual entry. Same
    unit heuristic already used by _parse_ctc_notice's notice-period
    number: a bare number means years (the natural way someone answers
    "how many years of experience"), "months" in the reply means the
    number is already in months."""
    years_or_months = _first_number(raw)
    if years_or_months is None:
        return {"total_exp_mo": None}
    if re.search(r"month", raw or "", re.I):
        return {"total_exp_mo": int(round(years_or_months))}
    return {"total_exp_mo": int(round(years_or_months * 12))}


def _parse_yes_no(raw: str) -> dict:
    if re.search(r"\b(yes|available|sure|anytime|ok|okay)\b", raw or "", re.I):
        return {"available": True}
    if re.search(r"\b(no|not|unavailable|busy)\b", raw or "", re.I):
        return {"available": False}
    return {"available": None}


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
    if qtype == "generic_total_experience":
        return _parse_total_experience(raw_answer), "regex"
    if qtype == "generic_interview_availability":
        return _parse_yes_no(raw_answer), "regex"
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
        # Skill Matrix (2026-09-19): years_experience is the same raw
        # number already extracted for skill_years above, just also
        # written as a clean numeric column -- relevant_experience stays
        # the human-readable summary line, unchanged.
        await conn.execute(
            """INSERT INTO candidate_skill_experience
                 (tenant_id, candidate_id, skill_name, project_name, relevant_experience, role_types, years_experience)
               VALUES ($1,$2,$3,'Self-reported via WhatsApp screening',$4,$5,$6)""",
            tenant_id, session["candidate_id"], skill, summary, extracted.get("modules") or [], years)
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
        if extracted.get("willing_to_relocate") is not None:
            await conn.execute(
                "UPDATE candidates SET willing_to_relocate = COALESCE(willing_to_relocate, $1) WHERE id=$2",
                extracted["willing_to_relocate"], session["candidate_id"])
    elif qtype == "generic_total_experience":
        if extracted.get("total_exp_mo") is not None:
            await conn.execute(
                "UPDATE candidates SET total_exp_mo = COALESCE(total_exp_mo, $1) WHERE id=$2",
                extracted["total_exp_mo"], session["candidate_id"])
    elif qtype == "generic_interview_availability":
        if extracted.get("available") is not None:
            await conn.execute(
                "UPDATE candidates SET available_for_interview = $1 WHERE id=$2",
                extracted["available"], session["candidate_id"])

    return extracted
