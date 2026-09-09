"""
Skill Verification Panel — Shortlist Rule Engine (2026-09-09, Phase 4 of
the roadmap: https://claude.ai/code/artifact/86b41cc7-ffc4-44cb-8fb1-016210c75683).

The recruiter's real manual decision, as explicit rules in the exact
order they actually check them — not one blended composite score (the
two scoring engines that already exist in this codebase, ner.py's
score_candidate() and match_candidates() SQL, are both generic quality/
fit numbers, neither implements this rule-by-rule logic):

  1. All mandatory skills found — a hard gate, checked first.
  2. Relevant experience per mandatory skill meets any minimum the
     requisition sets (requisitions.mandatory_skill_min_years, sql/121).
  3. Each mandatory skill's evidence sits in Experience or Projects, not
     the Skills list alone.
  4. Role/domain relevance — advisory only, enriches the reasons but
     never blocks by itself (this is the fuzziest signal here, and this
     codebase's own established convention for a fuzzy signal —
     dedup_service.py's POSSIBLE_MATCH tier — is to flag, never auto-
     decide).

Zero API cost, pure rule evaluation over data the caller has already
computed (mandatory coverage, section-aware counts, relevant experience,
role relevance) — this module makes no DB calls and computes nothing
itself, it only judges.
"""
from typing import Optional


def _has_real_evidence(section_counts: dict) -> Optional[bool]:
    """True if a skill has a genuine hit in Experience or Projects; False
    if those sections exist but the skill has zero occurrences in either
    (i.e. only ever appears in the Skills tag list); None if neither
    section was found in this resume at all — "can't evaluate," not "no
    evidence." Same "no section, no guess, never penalize" discipline as
    the section extractors themselves (services/improved_parser.py)."""
    exp = section_counts.get("experience")
    proj = section_counts.get("projects")
    if exp is None and proj is None:
        return None
    return (exp or 0) > 0 or (proj or 0) > 0


def evaluate_shortlist(
    verification: dict,
    relevant_experience: dict,
    role_relevance: dict,
    mandatory_skill_min_years: dict,
) -> dict:
    """verification: the full /skill-verification response dict
    (mandatory_coverage + skills[] with is_mandatory/count/sections).
    relevant_experience: {skill_name: years} from ner.py's
    compute_relevant_experience(). role_relevance: {"relevant": bool,
    "matched_tokens": [...]} from ner.py's compute_role_relevance().
    mandatory_skill_min_years: the requisition's own {skill: min_years}
    map (sparse — a mandatory skill with no entry has no threshold).

    Returns {"recommendation": "shortlist"|"reject", "reasons": [...]}
    — reasons are written in the order the 4 rules were actually
    checked, matching how a recruiter would explain the same decision."""
    reasons: list[str] = []
    coverage = verification["mandatory_coverage"]

    # Rule 1 — mandatory coverage gate.
    if not coverage["gate_passed"]:
        reasons.append(
            f"Missing mandatory skill(s): {', '.join(coverage['mandatory_missing'])}")
        return {"recommendation": "reject", "reasons": reasons}
    reasons.append(
        f"All {coverage['mandatory_total']} mandatory skills found ({coverage['coverage_pct']}%)")

    # Rule 2 — relevant experience per mandatory skill, where the
    # requisition sets a minimum. A skill with no entry in
    # mandatory_skill_min_years has no threshold to check.
    exp_fails = []
    for skill_name, min_years in (mandatory_skill_min_years or {}).items():
        if skill_name not in coverage["mandatory_found"]:
            continue  # already covered by Rule 1 above
        actual = relevant_experience.get(skill_name, 0.0)
        if actual < min_years:
            exp_fails.append(f"{skill_name} ({actual} yrs found, {min_years} required)")
    if exp_fails:
        reasons.append(f"Below required relevant experience: {', '.join(exp_fails)}")
        return {"recommendation": "reject", "reasons": reasons}
    if mandatory_skill_min_years:
        reasons.append("Relevant experience meets every set threshold")

    # Rule 3 — evidence must be in Experience/Projects, not just the
    # Skills tag list. A skill with no Experience/Projects section to
    # check at all (_has_real_evidence returns None) is never penalized.
    evidence_fails = [
        s["name"] for s in verification["skills"]
        if s["is_mandatory"] and _has_real_evidence(s["sections"]) is False
    ]
    if evidence_fails:
        reasons.append(
            f"Only listed as a skill tag, no evidence in Experience/Projects: {', '.join(evidence_fails)}")
        return {"recommendation": "reject", "reasons": reasons}
    reasons.append("Mandatory skills backed by real Experience/Projects evidence, not just a tag list")

    # Rule 4 — role/domain relevance, advisory only.
    if role_relevance.get("relevant"):
        reasons.append(f"Role-relevant background (matches: {', '.join(role_relevance['matched_tokens'])})")
    else:
        reasons.append("Role/domain relevance not clearly established from the resume text — worth a manual look")

    return {"recommendation": "shortlist", "reasons": reasons}
