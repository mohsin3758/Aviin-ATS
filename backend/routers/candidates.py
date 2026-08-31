from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from pydantic import BaseModel, Field
from typing import List
from typing import Optional
import json
import re
import db, events
from deps import Actor, get_actor, require_role
from schemas import CandidateCreate, CandidateUpdate
from routers.pipeline_stages import is_valid_stage
from permissions import require_permission
from services import candidate_ownership as ownership
from services import activity_events

router = APIRouter(prefix="/candidates", tags=["candidates"])

FIELDS = (
    "id, tenant_id, full_name, email, phone, skills, total_exp_mo, "
    "location, desired_location, current_employer, current_designation, resume_text, source, "
    "expected_ctc, current_ctc, notice_period_days, linkedin_url, "
    # 2026-08-30 — real reported gap: these 4 columns were already correctly
    # stored (linkedin_url since the internal Add Candidate form's LinkedIn
    # field; interested_role/expert_skills/intermediate_skills since the
    # public-form field additions the same day) but never selected here, so
    # GET /candidates/{id} silently omitted them from every response.
    "interested_role, expert_skills, intermediate_skills, "
    "ai_match_score, color_indicator, last_activity, created_at, updated_at"
)

@router.get("")
async def list_candidates(
    search:   Optional[str] = Query(None),
    q:        Optional[str] = Query(None),
    skill:    Optional[str] = Query(None),
    location: Optional[str] = Query(None),
    employer: Optional[str] = Query(None),
    source:   Optional[str] = Query(None),
    min_exp:  Optional[int] = Query(None),
    max_exp:  Optional[int] = Query(None),
    tag_id:   Optional[str] = Query(None),
    owned:    Optional[str] = Query(None),  # 'unowned' | 'active' — 2026-08-11 ownership filter
    limit:    int = Query(100, le=500),
    offset:   int = Query(0, ge=0),
    sort_by:  str = Query('created_at'),
    sort_dir: str = Query('desc'),
    actor: Actor = Depends(require_permission("candidates", "read")),
):
    conditions = ["tenant_id = $1", "is_active IS NOT FALSE"]
    params = [actor.tenant_id]
    term = search or q
    if term:
        params.append(f"%{term}%")
        n = len(params)
        conditions.append(
            f"(full_name ILIKE ${n} OR email ILIKE ${n} OR phone ILIKE ${n} "
            f"OR current_employer ILIKE ${n} OR EXISTS "
            f"(SELECT 1 FROM unnest(skills) sk WHERE sk ILIKE ${n}))"
        )
    if skill:
        params.append(skill); conditions.append(f"${len(params)} ILIKE ANY(skills)")
    if location:
        params.append(f"%{location}%"); conditions.append(f"location ILIKE ${len(params)}")
    if employer:
        params.append(f"%{employer}%"); conditions.append(f"current_employer ILIKE ${len(params)}")
    if source:
        params.append(source); conditions.append(f"source = ${len(params)}")
    if min_exp is not None:
        params.append(min_exp); conditions.append(f"total_exp_mo >= ${len(params)}")
    if max_exp is not None:
        params.append(max_exp); conditions.append(f"total_exp_mo <= ${len(params)}")
    if tag_id:
        params.append(tag_id)
        conditions.append(
            f"EXISTS (SELECT 1 FROM candidate_tag_map ctm WHERE ctm.candidate_id=c.id AND ctm.tag_id=${len(params)})"
        )
    _owned_exists = ("EXISTS (SELECT 1 FROM candidate_ownership co WHERE co.candidate_id=c.id "
                      "AND co.status='active' AND co.ownership_expires_at > now())")
    if owned == "unowned":
        conditions.append(f"NOT {_owned_exists}")
    elif owned == "active":
        conditions.append(_owned_exists)
    elif owned == "mine":
        # Real feature (2026-08-30): "My Candidates" - the existing
        # 'unowned'/'active' values only ever answered "is this candidate
        # owned by ANYONE," not "owned by ME specifically." Reuses the
        # same real candidate_ownership table (the 30-day claim system,
        # 2026-08-11), just scoped to the logged-in recruiter.
        params.append(actor.user_id)
        conditions.append(
            f"EXISTS (SELECT 1 FROM candidate_ownership co WHERE co.candidate_id=c.id "
            f"AND co.status='active' AND co.ownership_expires_at > now() AND co.recruiter_id=${len(params)})"
        )
    elif owned == "mine_or_assigned":
        # Real bug fix (2026-08-31): the Recruiter Overview dashboard's
        # "Active Candidates"/"On Notice Period"/"Placements" cards are all
        # defined as "owned OR has an active application assigned to me" —
        # a broader real cohort than the plain 'mine' ownership-only value
        # above. Clicking those cards previously landed here with
        # owned=mine, showing far fewer candidates than the KPI counted
        # (reported live: "11 Active Candidates" vs 1 candidate on the
        # filtered list) — this value matches each KPI's own real
        # definition instead of silently reusing the narrower one.
        params.append(actor.user_id)
        n = len(params)
        conditions.append(
            f"(EXISTS (SELECT 1 FROM candidate_ownership co WHERE co.candidate_id=c.id "
            f"AND co.status='active' AND co.ownership_expires_at > now() AND co.recruiter_id=${n}) "
            f"OR EXISTS (SELECT 1 FROM applications a2 WHERE a2.candidate_id=c.id "
            f"AND a2.is_active IS NOT FALSE AND a2.assigned_recruiter_id=${n}))"
        )

    ALLOWED = {"full_name","total_exp_mo","expected_ctc","created_at","last_activity","updated_at"}
    if sort_by not in ALLOWED: sort_by = "created_at"
    if sort_dir not in ("asc","desc"): sort_dir = "desc"
    # Real bug fix (2026-08-30): candidates.last_activity is NULL for every
    # real row in this tenant (confirmed live — 0 of 1,865 active candidates
    # have ever had it written by anything) — sorting by a column that's
    # uniformly NULL is a structural no-op: asc and desc both return the
    # identical order, reported live as "click Activity, stuck on the same
    # resume, only a manual refresh changes it." The frontend's own display
    # already falls back to updated_at when last_activity is null
    # (`timeAgo(d.last_activity) || timeAgo(d.updated_at)`) - the sort now
    # uses the same real, populated fallback so both directions genuinely
    # produce different, meaningful orders.
    order_col = "COALESCE(c.last_activity, c.updated_at)" if sort_by == "last_activity" else f"c.{sort_by}"
    where = "WHERE " + " AND ".join(conditions)
    p_limit  = len(params) + 1
    p_offset = len(params) + 2
    pl_sub = ("(SELECT a.stage || '|' || COALESCE(r.title,'')"
              " FROM applications a JOIN requisitions r ON r.id=a.requisition_id"
              " WHERE a.candidate_id=c.id ORDER BY a.updated_at DESC LIMIT 1) AS pipeline_status")
    tags_sub = ("(SELECT json_agg(json_build_object('id',ct.id,'name',ct.name,'color',ct.color) ORDER BY ct.name)"
                " FROM candidate_tag_map ctm JOIN candidate_tags ct ON ct.id=ctm.tag_id"
                " WHERE ctm.candidate_id=c.id) AS tags_json")
    owner_sub = ("(SELECT json_build_object('recruiter_name',u.full_name,'recruiter_email',co.recruiter_email,"
                 "'expires_at',co.ownership_expires_at,'status',co.status,'source',co.source)"
                 " FROM candidate_ownership co JOIN users u ON u.id=co.recruiter_id AND u.is_active IS NOT FALSE"
                 " WHERE co.candidate_id=c.id) AS owner_json")
    # Best pre-computed JD-match score this candidate already has on file
    # (from resume-intake auto-score, a manual /intelligence/score call, or
    # the new "Match Against Open Jobs" action) — cheap, no live embed calls
    # on every list render; the profile page's dedicated action recomputes
    # a fresh set against all currently-open requisitions on demand.
    top_match_sub = ("(SELECT json_build_object('readiness_index',cs.readiness_index,"
                      "'readiness_grade',cs.readiness_grade,'requisition_title',r.title)"
                      " FROM candidate_scores cs LEFT JOIN requisitions r ON r.id=cs.requisition_id"
                      " WHERE cs.candidate_id=c.id ORDER BY cs.readiness_index DESC NULLS LAST LIMIT 1) AS top_match_json")
    flds = ", ".join("c." + f.strip() for f in FIELDS.split(","))
    async with db.tenant_conn(actor.tenant_id) as conn:
        total = await conn.fetchval(f"SELECT COUNT(*) FROM candidates c {where}", *params)
        rows  = await conn.fetch(
            f"SELECT {flds}, {pl_sub}, {tags_sub}, {owner_sub}, {top_match_sub} FROM candidates c {where} ORDER BY {order_col} {sort_dir} LIMIT ${p_limit} OFFSET ${p_offset}",
            *params, limit, offset)
    items = []
    for r in rows:
        d = dict(r)
        ps = d.pop("pipeline_status", None)
        if ps:
            parts = ps.split("|", 1)
            d["pipeline_stage"] = parts[0]
            d["pipeline_job"]   = parts[1] if len(parts) > 1 else ""
        else:
            d["pipeline_stage"] = None
            d["pipeline_job"]   = None
        tj = d.pop("tags_json", None)
        d["tags"] = json.loads(tj) if tj else []
        oj = d.pop("owner_json", None)
        d["owner"] = json.loads(oj) if oj else None
        tm = d.pop("top_match_json", None)
        d["top_match"] = json.loads(tm) if tm else None
        items.append(d)
    return {"items": items, "total": int(total), "limit": limit, "offset": offset}


@router.post("/bulk-delete")
async def bulk_delete_candidates(body: dict, actor: Actor = Depends(get_actor)):
    ids = body.get("ids", [])
    if not ids: return {"deleted": 0}
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute(
            "UPDATE candidates SET is_active=false WHERE id=ANY($1::uuid[]) AND tenant_id=$2",
            ids, actor.tenant_id)
    return {"deleted": len(ids)}


@router.get("/duplicates")
async def list_duplicates(actor: Actor = Depends(get_actor)):
    q = (
        "SELECT full_name, COUNT(*) AS cnt,"
        " array_agg(id::text ORDER BY created_at) AS ids,"
        " array_agg(COALESCE(email, '') ORDER BY created_at) AS emails,"
        " array_agg(COALESCE(phone, '') ORDER BY created_at) AS phones,"
        " array_agg(COALESCE(current_employer, '') ORDER BY created_at) AS employers,"
        " array_agg(total_exp_mo ORDER BY created_at) AS exps,"
        " array_agg(created_at::date::text ORDER BY created_at) AS dates"
        " FROM candidates"
        " WHERE tenant_id=$1 AND is_active IS NOT FALSE AND full_name IS NOT NULL"
        " GROUP BY full_name HAVING COUNT(*) > 1"
        " ORDER BY cnt DESC, full_name"
    )
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(q, actor.tenant_id)
    return {"groups": [dict(r) for r in rows]}


@router.get("/export")
async def export_candidates(
    search:   Optional[str] = Query(None),
    skill:    Optional[str] = Query(None),
    location: Optional[str] = Query(None),
    employer: Optional[str] = Query(None),
    min_exp:  Optional[int] = Query(None),
    max_exp:  Optional[int] = Query(None),
    actor: Actor = Depends(get_actor),
):
    """Server-side CSV export — no row limit, respects all active filters."""
    import io, csv, datetime
    from fastapi.responses import StreamingResponse

    conditions = ["tenant_id = $1", "is_active IS NOT FALSE"]
    params = [actor.tenant_id]
    if search:
        params.append(f"%{search}%"); n = len(params)
        conditions.append(
            f"(full_name ILIKE ${n} OR email ILIKE ${n} OR phone ILIKE ${n} "
            f"OR current_employer ILIKE ${n} OR EXISTS "
            f"(SELECT 1 FROM unnest(skills) sk WHERE sk ILIKE ${n}))"
        )
    if skill:
        params.append(skill); conditions.append(f"${len(params)} ILIKE ANY(skills)")
    if location:
        params.append(f"%{location}%"); conditions.append(f"location ILIKE ${len(params)}")
    if employer:
        params.append(f"%{employer}%"); conditions.append(f"current_employer ILIKE ${len(params)}")
    if min_exp is not None:
        params.append(min_exp); conditions.append(f"total_exp_mo >= ${len(params)}")
    if max_exp is not None:
        params.append(max_exp); conditions.append(f"total_exp_mo <= ${len(params)}")

    where = "WHERE " + " AND ".join(conditions)
    cols = (
        "id, full_name, email, phone, location, current_employer, current_designation, "
        "total_exp_mo, expected_ctc, current_ctc, notice_period_days, linkedin_url, "
        "source, skills, created_at"
    )
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            f"SELECT {cols} FROM candidates {where} ORDER BY created_at DESC", *params)

    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(['Name','Email','Phone','Location','Employer','Designation',
                'Exp_Months','Expected_CTC','Current_CTC','Notice_Days',
                'LinkedIn','Source','Skills','Added_On'])
    for r in rows:
        w.writerow([
            r['full_name'] or '', r['email'] or '', r['phone'] or '',
            r['location'] or '', r['current_employer'] or '', r['current_designation'] or '',
            r['total_exp_mo'] or 0, r['expected_ctc'] or '', r['current_ctc'] or '',
            r['notice_period_days'] or '', r['linkedin_url'] or '', r['source'] or '',
            '; '.join(r['skills'] or []),
            r['created_at'].strftime('%Y-%m-%d') if r['created_at'] else '',
        ])
    out.seek(0)
    fname = f"candidates_{datetime.date.today()}.csv"
    return StreamingResponse(
        iter([out.getvalue()]),
        media_type='text/csv',
        headers={'Content-Disposition': f'attachment; filename="{fname}"'},
    )


from pydantic import BaseModel as _BM


class RankRequest(_BM):
    jd_text: str
    limit: int = 50
    min_exp_months: Optional[int] = None


_BULLET_LINE_RE = re.compile(r'^[\-\*•‣◦⁃∙]\s+|^\d+[\.\)]\s+')
_REQ_MARKER_RE = re.compile(
    r'(?:skills?|requirements?|experience\s+in|must\s+have|expertise\s+in|proficien(?:t|cy)\s+in)'
    # [ \t]* (not \s*) deliberately stops at a newline right after the
    # colon - a real bug caught before shipping: "Requirements:\n1. SAP
    # FICO\n2. ..." (list on the FOLLOWING lines, common JD format) let
    # \s* swallow the newline and capture "1. SAP FICO" as a single
    # garbage phrase with its list-number prefix retained, duplicating
    # what the bullet-line pass below already extracts correctly. When
    # the marker's content is on a later line, only the bullet-line pass
    # should ever fire for it.
    r'[ \t]*[:\-][ \t]*([^\n]{3,200})', re.IGNORECASE,
)
_SKILL_BREAKDOWN_STOPWORDS = {'and', 'the', 'for', 'with', 'of', 'in', 'a', 'an', 'to', 'or'}


_SENTENCE_END_RE = re.compile(r'[.!?]\s*$')
_SENTENCE_LEADING_STOPWORDS = {
    'we', 'need', 'the', 'a', 'an', 'is', 'are', 'with', 'for', 'looking',
    'seeking', 'you', 'this', 'our', 'i', 'to', 'of', 'in', 'and', 'or',
}


def _looks_like_bare_list_line(line: str) -> bool:
    """A short, punctuation-free line reads as one list item typed on its
    own line with no bullet character at all (a real, common JD-paste
    shape - "SAP FICO" / "Credit Management" / "Claim Management", each
    on its own line, no "-"/"*"/number prefix) rather than a sentence of
    prose. Deliberately conservative: 1-6 words, no sentence-ending
    punctuation."""
    words = line.split()
    return 1 <= len(words) <= 6 and not _SENTENCE_END_RE.search(line)


def _extract_requirement_phrases(jd_text: str) -> list[str]:
    """Real bug fix (2026-08-23): rank_candidates() used to determine
    "required skills" SOLELY via extract_skills_from_text() - a fixed,
    curated ~100-term tech-skill vocabulary built for resume parsing.
    Any requirement a recruiter typed that isn't in that vocabulary
    (e.g. "Credit Management"/"Claim Management"/"Disaster Management" -
    real SAP FICO module terms, not generic tech skills) was silently
    DROPPED from `required_skills` entirely - not shown as missing, just
    never checked at all. Reproduced live: pasting those 4 terms only
    ever detected "SAP FICO", so a candidate with just that one real
    skill scored 100% skill match and a 95% overall score, despite
    genuinely lacking 3 of the 4 stated requirements.

    Fixes this by pulling the recruiter's OWN typed requirement phrases
    verbatim, trying 3 real JD shapes in order:
    1. Bullet/numbered list items ("- SAP FICO", "1. SAP FICO").
    2. A comma/semicolon list right after an explicit "skills/
       requirements/experience in:" marker.
    3. REAL GAP FOUND LIVE, same day: neither of the above fires for the
       simplest, arguably most common shape of all - each requirement on
       its own line with NO bullet character whatsoever ("SAP FICO" /
       "Credit Management" / ... one per line). Reproduced directly:
       this exact input returned zero verbatim phrases from tiers 1+2,
       silently falling all the way back to the same taxonomy-only
       vocabulary this whole fix exists to stop relying on alone - the
       fix looked deployed-but-inert to the user because the specific
       JD they pasted happened to hit exactly this gap. Fires only as a
       last resort (tiers 1+2 found nothing) and only when the JD text
       itself looks like a bare list (>=60% of its non-empty lines are
       short, punctuation-free lines) - never on ordinary prose, so a
       real paragraph-style JD still falls through to the taxonomy
       extractor exactly as before.
    Falls back to nothing when the JD has no recognizable list structure
    at all (plain prose) - the caller unions this with the taxonomy
    extractor, which still covers that case as it always has."""
    phrases: list[str] = []
    seen_lower: set[str] = set()

    def _add(raw: str):
        p = raw.strip(' \t-*•‣◦⁃∙').strip()
        p = re.sub(r'\s+', ' ', p)
        if 2 <= len(p) <= 60 and p.lower() not in seen_lower:
            seen_lower.add(p.lower())
            phrases.append(p)

    for line in jd_text.split('\n'):
        stripped = line.strip()
        if _BULLET_LINE_RE.match(stripped):
            _add(_BULLET_LINE_RE.sub('', stripped, count=1))

    for m in _REQ_MARKER_RE.finditer(jd_text):
        for part in re.split(r'[,;]|\s+and\s+', m.group(1)):
            _add(part)

    if not phrases:
        lines = [l.strip() for l in jd_text.split('\n') if l.strip()]
        if len(lines) >= 2:
            list_like = [l for l in lines if _looks_like_bare_list_line(l)]
            if len(list_like) / len(lines) >= 0.6:
                for l in list_like:
                    _add(l)

    # REAL GAP FOUND LIVE, same day, second follow-up: an even simpler
    # shape than either tier above - a single line with NO bullet, NO
    # "skills/requirements:" marker, and no line breaks at all, just a
    # bare comma list ("fico, credit, claim, disaster"). Fires only as
    # the final fallback (nothing else found anything) and requires
    # EVERY comma-separated part to look like a short term, not a
    # sentence fragment - deliberately strict (any one part failing
    # skips the whole tier, not just that part) since a genuine
    # requirement list and a genuine prose sentence with commas but no
    # trailing period ("We need Python, AWS and Docker experience") can
    # otherwise look superficially similar.
    if not phrases and not re.search(r'[.!?]', jd_text):
        parts = [p.strip() for p in re.split(r'[,;]', jd_text) if p.strip()]
        if len(parts) >= 2 and all(
            len(p.split()) <= 4 and p.split()[0].lower() not in _SENTENCE_LEADING_STOPWORDS
            for p in parts
        ):
            for p in parts:
                _add(p)

    return phrases


def _related_skill_hit(phrase: str, text_lower: str) -> bool:
    """Conservative "related but not exact" signal for the missing-skills
    breakdown, informational only - never contributes to the score
    itself, to avoid reintroducing the exact over-matching problem this
    whole fix exists to correct.

    Requires an ABSOLUTE FLOOR of at least 2 distinct significant words
    from the phrase to each appear as their own whole-word match in the
    resume text - not just a 50% ratio. A plain ratio floor let a single
    generic connector word ("Management") alone satisfy 50% of a 2-word
    phrase like "Claim Management" even when the actual distinctive term
    ("Claim") is completely absent - verified live: Rishith's resume
    contains "Management" (as part of unrelated content) but never
    "Claim" or "Disaster" anywhere, and the ratio-only version wrongly
    tagged both as "related". Requiring hits>=2 means a 2-word phrase
    needs BOTH words present, closing that gap while still allowing a
    genuine 2-of-4-word overlap on a longer phrase to count."""
    words = [w for w in re.findall(r"[a-zA-Z][a-zA-Z0-9+#.]*", phrase.lower())
             if w not in _SKILL_BREAKDOWN_STOPWORDS and len(w) > 2]
    if len(words) < 2:
        return False
    hits = sum(1 for w in words if re.search(r'(?<![a-z0-9])' + re.escape(w) + r'(?![a-z0-9])', text_lower))
    return hits >= 2 and (hits / len(words)) >= 0.5


@router.post("/rank")
async def rank_candidates(body: RankRequest, actor: Actor = Depends(get_actor)):
    """
    Score and rank all active candidates against a job description.
    Uses regex skill extraction + experience + location scoring (free, instant).
    Score breakdown: skills 65pts + experience 25pts + designation 5pts + location 5pts.
    """
    from services.improved_parser import extract_skills_from_text, extract_experience_v2, _SKILL_LOOKUP
    from routers.ner import compute_skill_similarity

    jd = body.jd_text or ''
    taxonomy_skills  = extract_skills_from_text(jd)
    verbatim_phrases = _extract_requirement_phrases(jd)
    req_skills = list(taxonomy_skills)
    req_lower_set = {s.lower() for s in req_skills}
    for p in verbatim_phrases:
        # Real bug caught before shipping: reproduced live with "fico,
        # credit, claim, disaster" - taxonomy_skills already resolves
        # "fico" to its canonical "SAP FICO" via _SKILL_LOOKUP, but a
        # plain lowercase-string union still added the recruiter's own
        # bare "fico" as a SECOND, separate requirement right next to
        # "SAP FICO" - same skill, listed twice. Skip a verbatim phrase
        # when it's a known alias of a canonical name already included.
        canonical = _SKILL_LOOKUP.get(p.lower())
        if canonical and canonical.lower() in req_lower_set:
            continue
        if p.lower() not in req_lower_set:
            req_skills.append(p)
            req_lower_set.add(p.lower())

    min_exp_years = extract_experience_v2(jd) or 0
    min_exp_mo    = body.min_exp_months if body.min_exp_months is not None else int(min_exp_years * 12)

    loc_hint = ''
    lm = re.search(r'(?:location|based in|office)\s*[:\-]\s*([^\n,]{2,30})', jd, re.I)
    if lm:
        loc_hint = lm.group(1).strip().lower()[:15]

    # Honest notice-period signal: only computed when the JD itself states
    # an explicit expectation - never fabricated when it doesn't.
    notice_req_days: Optional[int] = None
    nm = re.search(r'notice\s*period\s*(?:of|is|[:\-])?\s*(\d{1,3})\s*(day|week)', jd, re.I)
    if nm:
        notice_req_days = int(nm.group(1)) * (7 if nm.group(2).lower().startswith('week') else 1)
    elif re.search(r'immediate\s+joiners?', jd, re.I):
        notice_req_days = 0

    role_words = {w.lower() for w in re.findall(r'[A-Za-z]+', jd[:300]) if len(w) > 3}

    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            f"SELECT {FIELDS} FROM candidates "
            f"WHERE tenant_id=$1 AND is_active IS NOT FALSE ORDER BY created_at DESC",
            actor.tenant_id,
        )

    scored = []
    for r in rows:
        c = dict(r)
        resume_text = c.get('resume_text') or ''
        # REAL GAP FIX (2026-08-20): matched/missing used to be checked
        # ONLY against the candidate's structured `skills` array - a
        # required skill genuinely described in the resume's own text
        # but never captured by the (imperfect) resume-parsing pass
        # showed as flatly missing. Now also does a case-insensitive
        # substring check against resume_text, via the same shared
        # helper every other missing_skills computation in this codebase
        # uses, so a "missing skill" chip means the same thing everywhere.
        #
        # REAL GAP FIX (2026-08-23): this is now also the SAME signal
        # that drives the numeric score - previously skill_score was
        # computed from a separate, structured-skills-only intersection
        # while the displayed matched_skills/missing_skills chips used
        # this richer (structured + resume_text) signal, so the number
        # and the chips could disagree with each other on the same
        # candidate. One signal, everywhere.
        _, matched_names, unmatched_names = compute_skill_similarity(
            candidate_skills=c.get('skills'), required_skills=req_skills, resume_text=resume_text,
        )
        text_lower = resume_text.lower()
        related_names = [s for s in unmatched_names if _related_skill_hit(s, text_lower)]
        missing_names = [s for s in unmatched_names if s not in related_names]

        # Overall score only ever counts REAL, exact/substring evidence -
        # "related" is informational transparency only, never inflates
        # the number. This is the direct fix for the reported bug: a
        # candidate matching 2 of 4 stated requirements now scores 50%
        # skill match, not 100%.
        skill_pct   = len(matched_names) / max(len(req_skills), 1)
        skill_score = round(skill_pct * 65)

        cand_exp = c.get('total_exp_mo') or 0
        if min_exp_mo > 0:
            exp_score = round(min(cand_exp / min_exp_mo, 1.4) / 1.4 * 25)
        else:
            exp_score = round(min(cand_exp / 60, 1.0) * 25)

        desig = (c.get('current_designation') or '').lower()
        desig_words = {w for w in re.findall(r'[a-z]+', desig) if len(w) > 3}
        desig_score = min(len(desig_words & role_words), 1) * 5

        loc_score = 5 if loc_hint and loc_hint in (c.get('location') or '').lower() else 0

        notice_match_pct: Optional[int] = None
        if notice_req_days is not None:
            cand_notice = c.get('notice_period_days')
            if cand_notice is None:
                notice_match_pct = None
            elif cand_notice <= notice_req_days:
                notice_match_pct = 100
            else:
                over_by = cand_notice - notice_req_days
                notice_match_pct = max(0, round(100 - over_by / 30 * 100))

        total = skill_score + exp_score + desig_score + loc_score

        skill_breakdown = (
            [{'skill': s, 'status': 'matched'} for s in matched_names] +
            [{'skill': s, 'status': 'related'} for s in related_names] +
            [{'skill': s, 'status': 'missing'} for s in missing_names]
        )

        c.pop('resume_text', None)  # not needed in the response; can be very large
        scored.append({
            **c,
            'rank_score':          total,
            'matched_skills':      matched_names,
            'related_skills':      related_names,
            'missing_skills':      missing_names,
            'skill_breakdown':     skill_breakdown,
            'skill_match_pct':     round(skill_pct * 100),
            'experience_match_pct': round((exp_score / 25) * 100) if min_exp_mo > 0 or cand_exp else None,
            'designation_match_pct': round((desig_score / 5) * 100) if role_words else None,
            'location_match_pct':  (round((loc_score / 5) * 100) if loc_hint else None),
            'notice_match_pct':    notice_match_pct,
        })

    scored.sort(key=lambda x: x['rank_score'], reverse=True)
    return {
        'required_skills':         req_skills,
        'min_exp_months_detected': min_exp_mo,
        'notice_period_required_days': notice_req_days,
        'total_candidates_scored': len(scored),
        'ranked':                  scored[:body.limit],
    }




class BulkAssignBody(BaseModel):
    candidate_ids: list
    requisition_id: str
    stage: Optional[str] = None

@router.post("/bulk-assign")
async def bulk_assign(body: BulkAssignBody, actor: Actor = Depends(get_actor)):
    """Create applications for multiple candidates against a single requisition.

    Used to always hardcode stage='sourced' with no way to add directly into
    a later stage — the Add Candidate modal gave no indication of this, so a
    candidate added while looking at e.g. the Interested column would land in
    Sourced instead and appear to have silently failed. Now takes an explicit
    stage; when the caller doesn't send one (the Candidates page's bulk-
    assign-to-requisition modal never has a "current stage" context to
    default to), resolves the tenant's configured default add-stage
    (Settings > Pipeline Stages > "Default for new candidates") instead of
    a hardcoded literal, falling back to 'sourced' only if nothing is
    explicitly marked default (shouldn't happen post-migration, but a
    brand-new tenant's config could theoretically be lazy-seeded elsewhere
    first without going through get_stage_config()'s seed path).
    """
    async with db.tenant_conn(actor.tenant_id) as conn:
        # Validate requisition belongs to tenant
        req = await conn.fetchrow(
            "SELECT id, title FROM requisitions WHERE id=$1 AND tenant_id=$2",
            body.requisition_id, actor.tenant_id)
        if not req:
            from fastapi import HTTPException
            raise HTTPException(404, "Requisition not found")

        stage = body.stage
        if not stage:
            # is_visible required defensively — save_stage_config blocks hiding
            # the current default, but this covers any state predating that
            # guard rather than trusting the invariant unconditionally.
            stage = await conn.fetchval(
                "SELECT stage_key FROM pipeline_stage_config WHERE tenant_id=$1 AND is_default_add AND is_visible",
                actor.tenant_id) or "sourced"

        if not await is_valid_stage(conn, actor.tenant_id, stage):
            from fastapi import HTTPException
            raise HTTPException(400, f"Unknown stage '{stage}' — add it under Settings > Pipeline Stages first")

        # Job-specific fit_score (same formula as match_candidates()/the Add
        # Candidate modal) so the score a recruiter picked from persists onto
        # the application, instead of falling back to the candidate's stale,
        # non-job-specific jd_match_score on the pipeline board.
        score_rows = await conn.fetch(
            "SELECT candidate_id, fit_score FROM match_candidates($1, 100000)",
            body.requisition_id)
        scores = {str(r["candidate_id"]): r["fit_score"] for r in score_rows}

        created = 0
        skipped = 0
        for cid in body.candidate_ids:
            # Check if application already exists
            exists = await conn.fetchval(
                "SELECT 1 FROM applications WHERE candidate_id=$1 AND requisition_id=$2 AND tenant_id=$3 AND is_active IS NOT FALSE",
                cid, body.requisition_id, actor.tenant_id)
            if exists:
                skipped += 1
                continue
            await conn.execute("""
                INSERT INTO applications
                  (tenant_id, candidate_id, requisition_id, stage, fit_score)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT DO NOTHING
            """, actor.tenant_id, cid, body.requisition_id, stage, scores.get(cid))
            # Log activity
            await conn.execute("""
                INSERT INTO candidate_activities
                  (tenant_id, candidate_id, user_id, activity_type, title, description)
                VALUES ($1, $2, $3, 'status_change', 'Added to Pipeline', $4)
            """, actor.tenant_id, cid, str(actor.user_id),
                 f"Added to pipeline: {req['title']}" + (f" (stage: {stage})" if stage != "sourced" else ""))
            created += 1

    return {"created": created, "skipped": skipped, "requisition_title": req["title"], "stage": stage}

async def _duplicate_context(conn, tenant_id: str, candidate_id: str) -> dict:
    """Real context for the live duplicate-check banner (2026-08-25 follow-
    up — the plain name+match_type banner gave a recruiter no way to judge
    whether this is worth investigating further): the candidate's latest
    uploaded resume file name, whether they're under an active 30-day
    ownership claim (and how many days are left on it), and their current
    pipeline stage if they're actively in one anywhere."""
    from datetime import datetime, timezone
    rf = await conn.fetchrow(
        "SELECT file_name FROM resume_files WHERE candidate_id=$1 AND tenant_id=$2"
        " ORDER BY created_at DESC LIMIT 1", candidate_id, tenant_id)
    owner_out = None
    owner = await ownership.get_ownership(conn, tenant_id, candidate_id)
    if owner and owner["status"] == "active":
        expires = owner["ownership_expires_at"]
        days_left = max(0, (expires - datetime.now(timezone.utc)).days)
        owner_out = {"recruiter_name": owner["recruiter_name"], "days_left": days_left}
    pl_row = await conn.fetchrow(
        "SELECT a.stage, r.title AS requisition_title"
        " FROM applications a JOIN requisitions r ON r.id=a.requisition_id"
        " WHERE a.candidate_id=$1 AND a.is_active IS NOT FALSE"
        " ORDER BY a.updated_at DESC LIMIT 1", candidate_id)
    return {
        "resume_file_name": rf["file_name"] if rf else None,
        "owner": owner_out,
        "pipeline": {"stage": pl_row["stage"], "requisition_title": pl_row["requisition_title"]} if pl_row else None,
    }



@router.get("/check-duplicate")
async def check_duplicate(
    email: str = None,
    phone: str = None,
    actor: Actor = Depends(get_actor),
):
    # BUG FIXES (2026-08-10 audit):
    # 1. Neither query filtered is_active — a soft-deleted candidate's
    #    email/phone falsely flagged as a duplicate against a genuinely
    #    new person.
    # 2. Short phone input (e.g. a 4-digit partial while typing) became an
    #    unanchored suffix wildcard matching any stored number ending in
    #    those digits — now requires at least 7 real digits before
    #    attempting a match, same as a real Indian local-number length.
    # 3. fetchrow only ever returned the FIRST match — a candidate
    #    duplicated three ways looked like one. Now returns every match.
    async with db.tenant_conn(actor.tenant_id) as conn:
        results = []
        if email:
            rows = await conn.fetch(
                f"SELECT {FIELDS} FROM candidates WHERE email ILIKE $1 AND is_active IS NOT FALSE",
                email.strip())
            for row in rows:
                results.append({"match_type": "email", "candidate": dict(row)})
        if phone:
            clean = phone.strip().replace(" ","").replace("-","").replace("+91","").replace("+","")
            if len(clean) >= 7:
                rows = await conn.fetch(
                    f"SELECT {FIELDS} FROM candidates WHERE REPLACE(REPLACE(REPLACE(phone,'+91',''),'-',''),' ','') ILIKE $1"
                    f" AND is_active IS NOT FALSE",
                    "%" + clean[-10:])
                for row in rows:
                    results.append({"match_type": "phone", "candidate": dict(row)})
        # Real context per unique candidate — computed once even if the
        # same person matched both email and phone, not once per match row.
        ctx_cache: dict = {}
        for r in results:
            cid = str(r["candidate"]["id"])
            if cid not in ctx_cache:
                ctx_cache[cid] = await _duplicate_context(conn, actor.tenant_id, cid)
            r.update(ctx_cache[cid])
        return {"duplicates": results, "has_duplicate": len(results) > 0}


async def _ownership_conflict_detail(conn, tenant_id: str, existing_row) -> dict:
    """Builds the 409 payload for an existing-candidate match, adding real
    ownership context when the match is actively owned by someone else —
    the "Candidate Already Owned... until <date>" UX the ownership rule
    calls for, instead of a bare "already exists" with no context."""
    detail = {
        "detail": "A candidate with this email already exists",
        "existing_id": str(existing_row["id"]),
        "existing_name": existing_row["full_name"],
    }
    owner = await ownership.get_ownership(conn, tenant_id, str(existing_row["id"]))
    if owner and owner["status"] == "active":
        detail["detail"] = (
            f"Candidate Already Owned — currently owned by {owner['recruiter_name']} "
            f"until {owner['ownership_expires_at']}. You cannot claim or process this "
            f"candidate during the active ownership period."
        )
        detail["owner"] = {
            "recruiter_id": str(owner["recruiter_id"]),
            "recruiter_name": owner["recruiter_name"],
            "recruiter_email": owner["recruiter_email"],
            "expires_at": owner["ownership_expires_at"].isoformat(),
        }
    return detail


@router.post("")
async def create_candidate(body: CandidateCreate, actor: Actor = Depends(require_permission("candidates", "create"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        # Check for existing ACTIVE candidate with same email (per tenant).
        # BUG FIX (2026-08-10 audit): previously ignored is_active, so a
        # soft-deleted candidate's email permanently blocked re-adding that
        # person with no override possible — sql/47 also made the unique
        # index itself partial (active rows only) so the INSERT below no
        # longer hard-409s at the DB level for a soft-deleted match either.
        if body.email:
            existing = await conn.fetchrow(
                f"SELECT {FIELDS} FROM candidates WHERE email=$1 AND is_active IS NOT FALSE LIMIT 1",
                body.email.strip().lower())
            if existing:
                raise HTTPException(409, await _ownership_conflict_detail(conn, actor.tenant_id, existing))
        try:
            # Real bug found via a genuine collision under test load
            # (2026-08-25): db.tenant_conn() wraps this whole endpoint in
            # one outer transaction (needed so the transaction-local
            # set_config('app.tenant_id',...) stays in effect across every
            # statement here). Catching a UniqueViolationError from a bare
            # INSERT leaves that outer transaction aborted, so the fallback
            # re-query below used to raise a second, unrelated
            # InFailedSQLTransactionError instead of returning a clean 409
            # - confirmed live via a real duplicate-email collision, not
            # assumed. A nested `async with conn.transaction():` is a real
            # asyncpg SAVEPOINT when a transaction is already open (the
            # same established fix already used elsewhere in this project
            # for the identical "poisoned outer transaction" shape, e.g.
            # scheduler.py's tier-2 escalation handler) - only the INSERT
            # itself rolls back, the outer connection stays usable.
            async with conn.transaction():
                row = await conn.fetchrow(
                    f"""INSERT INTO candidates
                        (tenant_id,full_name,email,phone,skills,total_exp_mo,location,desired_location,
                         current_employer,current_designation,resume_text,source,expected_ctc,current_ctc,notice_period_days)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
                       RETURNING {FIELDS}""",
                    actor.tenant_id, body.full_name, body.email, body.phone, body.skills,
                    body.total_exp_mo, body.location, body.desired_location, body.current_employer,
                    body.current_designation, body.resume_text, body.source,
                    getattr(body, "expected_ctc", None), getattr(body, "current_ctc", None),
                    getattr(body, "notice_period_days", None))
        except Exception as exc:
            if "uq_candidates_email_per_tenant" in str(exc):
                existing2 = await conn.fetchrow(
                    f"SELECT {FIELDS} FROM candidates WHERE email=$1 AND is_active IS NOT FALSE LIMIT 1",
                    body.email.strip().lower())
                if existing2:
                    raise HTTPException(409, await _ownership_conflict_detail(conn, actor.tenant_id, existing2)) from exc
                raise HTTPException(409, {"detail": "A candidate with this email already exists", "existing_id": None}) from exc
            raise
        cid = row["id"]
        ct = getattr(body, "consent_text", None) or f"{body.full_name} consented to DPDP 2023."
        await conn.execute(
            "INSERT INTO consent_records (tenant_id,candidate_id,data_category,channel,consent_given,consent_text) VALUES ($1,$2,'resume_processing','api',TRUE,$3)",
            actor.tenant_id, cid, ct)
        # Individual recruiter ownership (2026-08-11): the logged-in
        # recruiter who manually adds a candidate individually owns them
        # for 30 days — never trust a submitted owner id, always the
        # authenticated actor.
        if actor.user_id and actor.email:
            await ownership.claim_ownership(
                conn, actor.tenant_id, str(cid), str(actor.user_id), actor.email, "manual_add",
            )
        if actor.user_id:
            await activity_events.log_recruiter_activity(
                conn, actor.tenant_id, str(actor.user_id), activity_events.SOURCED, candidate_id=str(cid),
            )
        await events.write_outbox(conn, actor.tenant_id, "candidate.created",
            {"candidate_id": str(cid), "full_name": body.full_name}, f"candidate.created:{cid}")
    return dict(row)


def _save_candidate_document_file(data: bytes, tenant_id: str, filename: str) -> str:
    """Generic disk-write for candidate_documents (LWD confirmation / other),
    a real, separate folder from save_resume_file's own resume-specific one —
    never served as a raw URL, only ever read back through the auth-gated
    download endpoint below, matching this codebase's established
    resume_files/generated_resumes download convention."""
    from pathlib import Path
    from datetime import datetime
    import re as _re, uuid as _uuid
    base = Path('/app/uploads/candidate_documents')
    date_str = datetime.now().strftime('%Y/%m/%d')
    folder = base / tenant_id / date_str
    folder.mkdir(parents=True, exist_ok=True)
    safe = _re.sub(r'[^\w.\-]', '_', filename)[:200]
    uid = _uuid.uuid4().hex[:8]
    dest = folder / f'{uid}_{safe}'
    dest.write_bytes(data)
    return f'/uploads/candidate_documents/{tenant_id}/{date_str}/{uid}_{safe}'


@router.post("/{candidate_id}/upload-document")
async def upload_candidate_document(
    candidate_id: str,
    document_type: str = Form(...),
    file: UploadFile = File(...),
    notes: Optional[str] = Form(None),
    actor: Actor = Depends(require_permission("candidates", "update")),
):
    """Resume upload reuses the already-established resume_files table +
    save_resume_file() (same disk-storage helper WhatsApp/email/public-apply
    intake already use) plus the same extract->classify->parse enrichment,
    gap-fill-only (never overwrites a manually-typed field — same COALESCE
    convention as upsert_candidate/public_apply). LWD confirmation and other
    documents use the new, simpler candidate_documents table — no parsing
    semantics apply to either of those."""
    if document_type not in ("resume", "lwd_confirmation", "other"):
        raise HTTPException(400, "document_type must be one of: resume, lwd_confirmation, other")
    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty file")
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(400, "File too large (max 10MB)")
    filename = file.filename or "upload"
    mime = file.content_type or ""

    async with db.tenant_conn(actor.tenant_id) as conn:
        cand = await conn.fetchrow(
            "SELECT id, full_name, email FROM candidates WHERE id=$1 AND is_active IS NOT FALSE",
            candidate_id)
        if not cand:
            raise HTTPException(404, "Candidate not found")

        if document_type == "resume":
            from services.resume_intake_service import save_resume_file, extract_text_from_attachment
            from services.document_classifier import classify_document
            from services.improved_parser import parse_resume_v2
            file_path = save_resume_file(data, actor.tenant_id, filename)
            parsed: dict = {}
            try:
                text = extract_text_from_attachment(data, mime, filename)
                doc_result = classify_document(text, filename, mime)
                if doc_result.is_resume:
                    parsed = parse_resume_v2(text, from_name=cand["full_name"], from_email=cand["email"], filename=filename)
                    parsed["_resume_text"] = text
            except Exception:
                parsed = {}
            row = await conn.fetchrow(
                """INSERT INTO resume_files
                    (tenant_id, candidate_id, job_board, job_board_label,
                     file_name, file_path, mime_type, file_size,
                     parse_status, parsed_data, parse_confidence, routing_decision)
                   VALUES ($1,$2,'manual_add','Manual Add Candidate',$3,$4,$5,$6,$7,$8,$9,$10)
                   RETURNING id""",
                actor.tenant_id, candidate_id, filename, file_path, mime, len(data),
                "auto_accepted" if parsed else "not_a_resume",
                json.dumps(parsed) if parsed else "{}",
                round(float(parsed.get("_confidence", 0.7) or 0.7), 3) if parsed else 0.0,
                "auto_accepted" if parsed else "manual_upload")
            if parsed.get("_resume_text"):
                await conn.execute(
                    """UPDATE candidates SET
                        resume_text = CASE WHEN (resume_text IS NULL OR resume_text='') THEN $2 ELSE resume_text END,
                        skills = CASE WHEN skills = '{}' AND $3::text[] <> '{}' THEN $3 ELSE skills END
                       WHERE id=$1""",
                    candidate_id, parsed.get("_resume_text"), parsed.get("skills") or [])
            return {"id": str(row["id"]), "document_type": "resume", "file_name": filename}

        file_path = _save_candidate_document_file(data, actor.tenant_id, filename)
        row = await conn.fetchrow(
            """INSERT INTO candidate_documents
                (tenant_id, candidate_id, document_type, file_name, file_path, mime_type, file_size, notes, uploaded_by)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id""",
            actor.tenant_id, candidate_id, document_type, filename, file_path, mime, len(data),
            notes, actor.user_id)
        return {"id": str(row["id"]), "document_type": document_type, "file_name": filename}


@router.get("/documents/{doc_id}/download")
async def download_candidate_document(doc_id: str, actor: Actor = Depends(get_actor)):
    from fastapi.responses import FileResponse
    from pathlib import Path
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT file_name, file_path, mime_type FROM candidate_documents WHERE id=$1 AND tenant_id=$2",
            doc_id, actor.tenant_id)
    if not row:
        raise HTTPException(404, "Document not found")
    fp = (row["file_path"] or "").lstrip("/")
    abs_path = Path("/app") / fp
    if not abs_path.exists():
        raise HTTPException(404, "File missing from disk")
    mime = row["mime_type"] or "application/octet-stream"
    fn = row["file_name"] or abs_path.name
    return FileResponse(str(abs_path), media_type=mime, filename=fn,
        headers={"Content-Disposition": f'attachment; filename="{fn}"'})


@router.get("/{candidate_id}/documents")
async def list_candidate_documents(candidate_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        resumes = await conn.fetch(
            "SELECT id, file_name, mime_type, file_size, created_at FROM resume_files "
            "WHERE candidate_id=$1 AND tenant_id=$2 ORDER BY created_at DESC",
            candidate_id, actor.tenant_id)
        docs = await conn.fetch(
            "SELECT id, document_type, file_name, mime_type, file_size, notes, created_at FROM candidate_documents "
            "WHERE candidate_id=$1 AND tenant_id=$2 ORDER BY created_at DESC",
            candidate_id, actor.tenant_id)
    return {"resumes": [dict(r) for r in resumes], "documents": [dict(d) for d in docs]}


class SkillExperienceRow(BaseModel):
    skill_name: str
    project_name: Optional[str] = None
    duration_from: Optional[str] = None
    duration_to: Optional[str] = None
    role_types: list[str] = Field(default_factory=list)
    relevant_experience: Optional[str] = None
    last_used: Optional[str] = None


@router.get("/{candidate_id}/skill-experience")
async def list_skill_experience(candidate_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            "SELECT id, skill_name, project_name, duration_from, duration_to, role_types,"
            " relevant_experience, last_used FROM candidate_skill_experience"
            " WHERE candidate_id=$1 AND tenant_id=$2 ORDER BY sort_order, created_at",
            candidate_id, actor.tenant_id)
    return {"rows": [dict(r) for r in rows]}


@router.put("/{candidate_id}/skill-experience")
async def replace_skill_experience(
    candidate_id: str, body: list[SkillExperienceRow],
    actor: Actor = Depends(require_permission("candidates", "update")),
):
    """Full replace, not a diff/patch - matches this project's established
    pattern for a small per-candidate child list nothing else references
    (same shape as how this modal's document uploads work). The recruiter
    builds the whole table in the Add/Edit modal before submitting; on
    save, whatever's in the modal becomes the real, complete set."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        cand = await conn.fetchrow(
            "SELECT id FROM candidates WHERE id=$1 AND is_active IS NOT FALSE", candidate_id)
        if not cand:
            raise HTTPException(404, "Candidate not found")
        async with conn.transaction():
            await conn.execute(
                "DELETE FROM candidate_skill_experience WHERE candidate_id=$1 AND tenant_id=$2",
                candidate_id, actor.tenant_id)
            for i, row in enumerate(body):
                if not row.skill_name.strip():
                    continue
                await conn.execute(
                    """INSERT INTO candidate_skill_experience
                        (tenant_id, candidate_id, skill_name, project_name, duration_from, duration_to,
                         role_types, relevant_experience, last_used, sort_order)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)""",
                    actor.tenant_id, candidate_id, row.skill_name.strip(), row.project_name,
                    row.duration_from, row.duration_to, row.role_types, row.relevant_experience,
                    row.last_used, i)
    return {"ok": True, "count": len(body)}


class SkillSummaryParseIn(BaseModel):
    text: str


@router.post("/skill-experience/parse-preview")
async def parse_skill_summary_preview(body: SkillSummaryParseIn, actor: Actor = Depends(get_actor)):
    """Real feature (2026-08-30): a recruiter often has real, rich
    skill/experience detail already typed as free text somewhere (the
    KAE-submission tracking sheet's own manual "skill_summary" field, or
    literally pasted from an email they already have) - this parses it
    into proposed Skill/Project Experience rows for review, never a
    silent write. Read-only, no candidate_id needed."""
    from services.skill_experience_parser import parse_skill_summary_text
    return {"rows": parse_skill_summary_text(body.text)}


@router.post("/{candidate_id}/skill-experience/append")
async def append_skill_experience(
    candidate_id: str, body: list[SkillExperienceRow],
    actor: Actor = Depends(require_permission("candidates", "update")),
):
    """A real, genuine append - unlike the PUT above (full replace, for
    the Add/Edit modal's own build-the-whole-table flow), this adds rows
    on top of whatever already exists - the right semantics for
    'I parsed some new detail, add it without touching what's already
    there', matching the same append-with-sort_order-offset convention
    already used by the public resume-drop forms' skill_experience
    submission (personal_links.py)."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        cand = await conn.fetchrow(
            "SELECT id FROM candidates WHERE id=$1 AND is_active IS NOT FALSE", candidate_id)
        if not cand:
            raise HTTPException(404, "Candidate not found")
        existing_count = await conn.fetchval(
            "SELECT COUNT(*) FROM candidate_skill_experience WHERE candidate_id=$1 AND tenant_id=$2",
            candidate_id, actor.tenant_id)
        added = 0
        for i, row in enumerate(body):
            if not row.skill_name.strip():
                continue
            await conn.execute(
                """INSERT INTO candidate_skill_experience
                    (tenant_id, candidate_id, skill_name, project_name, duration_from, duration_to,
                     role_types, relevant_experience, last_used, sort_order)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)""",
                actor.tenant_id, candidate_id, row.skill_name.strip(), row.project_name,
                row.duration_from, row.duration_to, row.role_types, row.relevant_experience,
                row.last_used, existing_count + i)
            added += 1
    return {"ok": True, "added": added}


@router.get("/{candidate_id}")
async def get_candidate(candidate_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(f"SELECT {FIELDS} FROM candidates WHERE id=$1", candidate_id)
        if not row:
            raise HTTPException(404, "Candidate not found")
        # Fetch latest resume file for download button
        rf = await conn.fetchrow(
            "SELECT id, file_name FROM resume_files WHERE candidate_id=$1 AND tenant_id=$2"
            " ORDER BY created_at DESC LIMIT 1",
            candidate_id, actor.tenant_id
        )
        # AI scores (one per requisition scored against, e.g. via auto-score
        # on resume intake or a manual /intelligence/score call).
        score_rows = await conn.fetch(
            """SELECT cs.readiness_index, cs.readiness_grade, cs.skill_match_score,
                      cs.experience_score, cs.stability_score, cs.education_score,
                      cs.scored_at, cs.requisition_id, r.title AS requisition_title,
                      r.skills_required
               FROM candidate_scores cs LEFT JOIN requisitions r ON r.id=cs.requisition_id
               WHERE cs.candidate_id=$1 AND cs.tenant_id=$2
               ORDER BY cs.scored_at DESC LIMIT 5""",
            candidate_id, actor.tenant_id)
        # Current pipeline stage (most-recently-updated real application),
        # matching the same pl_sub convention already used by the list
        # endpoint — real gap fix (2026-08-20): the profile page had no
        # stage visibility at all outside a buried Applications-tab list.
        pl_row = await conn.fetchrow(
            "SELECT a.stage, r.title AS pipeline_job, a.updated_at"
            " FROM applications a JOIN requisitions r ON r.id=a.requisition_id"
            " WHERE a.candidate_id=$1 ORDER BY a.updated_at DESC LIMIT 1",
            candidate_id)
    d = dict(row)
    if rf:
        d['latest_resume_file_id'] = str(rf['id'])
        d['latest_resume_file_name'] = rf['file_name']
    d['pipeline_stage'] = pl_row['stage'] if pl_row else None
    d['pipeline_job'] = pl_row['pipeline_job'] if pl_row else None
    from routers.ner import compute_skill_similarity
    scores_out = []
    for sr in score_rows:
        s = dict(sr)
        req_skills = s.pop('skills_required', None) or []
        _, matched, missing = compute_skill_similarity(
            candidate_skills=d.get('skills'), required_skills=req_skills, resume_text=d.get('resume_text'),
        )
        s['missing_skills'] = missing
        s['matched_skills'] = matched
        scores_out.append(s)
    d['ai_scores'] = scores_out
    return d


@router.post("/{candidate_id}/match-open-jobs")
async def match_candidate_against_open_jobs(candidate_id: str, actor: Actor = Depends(get_actor)):
    """Real gap fix (2026-08-20): the existing AI Match Score panel only
    ever shows requisitions this candidate happened to already be scored
    against (auto-score on intake, or a manual /intelligence/score call) —
    there was no way to see how a candidate stacks up against EVERY
    currently-open job. Reuses score_candidate_core (the same Tier-1
    embed-similarity engine already used by auto-score-on-intake and the
    manual scorer) against each real open requisition, upserting into the
    same candidate_scores table so results show up in the existing AI
    Match Score panel afterward too - one scoring path, not a second one."""
    from routers.intelligence import score_candidate_core
    from routers.ner import compute_skill_similarity
    async with db.tenant_conn(actor.tenant_id) as conn:
        cand = await conn.fetchrow(
            "SELECT id, skills, resume_text FROM candidates WHERE id=$1 AND tenant_id=$2 AND is_active IS NOT FALSE",
            candidate_id, actor.tenant_id)
        if not cand:
            raise HTTPException(404, "Candidate not found")
        reqs = await conn.fetch(
            "SELECT id, title, description, experience_min, experience_max, education_required, skills_required"
            " FROM requisitions WHERE tenant_id=$1 AND status='open' AND is_active IS NOT FALSE"
            " ORDER BY created_at DESC LIMIT 25",
            actor.tenant_id)
        results = []
        for r in reqs:
            try:
                res = await score_candidate_core(
                    conn, actor.tenant_id, candidate_id, str(r["id"]),
                    required_exp_yr_min=(r["experience_min"] or 0),
                    required_exp_yr_max=r["experience_max"],
                    required_education=r["education_required"],
                    jd_text=r["description"],
                    required_skills=r["skills_required"],
                )
                res["requisition_title"] = r["title"]
                # Same matched/missing computation as get_candidate()'s
                # ai_scores field - real bug fixed here: the first version
                # of this endpoint returned raw candidate_scores rows with
                # no skill breakdown at all, caught by the S38 regression
                # test (matched_skills came back undefined). Uses the same
                # resume-text-aware shared helper score_candidate_core()
                # itself now uses internally (2026-08-20) rather than a
                # separate, structured-skills-only computation that would
                # otherwise silently contradict it.
                _, matched, missing = compute_skill_similarity(
                    candidate_skills=cand["skills"], required_skills=r["skills_required"],
                    resume_text=cand["resume_text"],
                )
                res["matched_skills"] = matched
                res["missing_skills"] = missing
                results.append(res)
            except Exception as e:
                print(f"[JobMatch] Failed scoring candidate {candidate_id} vs req {r['id']}: {e}")
    results.sort(key=lambda x: x.get("readiness_index") or 0, reverse=True)
    return {"matched": len(results), "results": results}


@router.get("/{candidate_id}/standard-resume")
async def download_standard_resume(candidate_id: str, actor: Actor = Depends(get_actor)):
    """Renders the candidate's parsed data into a clean, standardized
    one-pager PDF — the "Canva/image resume -> standard format" ask.
    Whatever the ORIGINAL resume looked like (a Canva export, a scanned
    image via OCR, a plain-text doc), the OUTPUT here is always the same
    consistent layout, because it's built from parsed structured fields,
    not the original file. Reuses the exact same renderer already proven
    for the KAE-submission "Clean Summary" style, rather than a second
    near-duplicate PDF builder."""
    from fastapi.responses import StreamingResponse
    import io as _io
    from services.resume_formatting import render_resume_pdf, build_resume_filename

    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT full_name, phone, email, location, current_employer, current_designation, "
            "total_exp_mo, skills, resume_text FROM candidates WHERE id=$1 AND tenant_id=$2",
            candidate_id, actor.tenant_id)
    if not row:
        raise HTTPException(404, "Candidate not found")
    pdf_bytes = render_resume_pdf(dict(row), {
        "name_format": "full", "show_mobile": False, "show_email": False, "show_location": True,
        "company_mode": "original", "project_mode": "include",
    })
    filename = build_resume_filename(row["full_name"], row["current_designation"], row["total_exp_mo"], "pdf")
    return StreamingResponse(
        _io.BytesIO(pdf_bytes), media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.patch("/{candidate_id}")
@router.put("/{candidate_id}")
async def update_candidate(candidate_id: str, body: CandidateUpdate, actor: Actor = Depends(require_permission("candidates", "update"))):
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(400, "No fields to update")
    params, clauses = [], []
    for k, v in updates.items():
        params.append(v); clauses.append(f"{k}=${len(params)}")
    params.append(candidate_id)
    sql = f"UPDATE candidates SET {chr(44).join(clauses)}, updated_at=now() WHERE id=${len(params)} RETURNING {FIELDS}"
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(sql, *params)
    if not row:
        raise HTTPException(404, "Candidate not found")
    return dict(row)


@router.delete("/{candidate_id}")
async def delete_candidate(candidate_id: str, actor: Actor = Depends(require_permission("candidates", "delete"))):
    """Soft-delete (matches bulk_delete_candidates/merge_candidate below, and
    the frontend's own confirm copy: 'They will be hidden from the list').
    This used to be a real DELETE that tried to clean up 14 child tables but
    missed 18 others with a candidate_id FK (applications, resume_files,
    placements, timesheets, payslips, offer_letters, ...) - so it silently
    failed with a ForeignKeyViolationError for any candidate that had ever
    been added to a pipeline or had a resume uploaded, i.e. most candidates."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        r = await conn.execute(
            "UPDATE candidates SET is_active=false WHERE id=$1 AND tenant_id=$2",
            candidate_id, actor.tenant_id)
    if not int((r or "UPDATE 0").split()[-1]):
        raise HTTPException(404, "Not found")
    return {"ok": True, "deleted": candidate_id}


@router.post("/{candidate_id}/merge")
async def merge_candidate(candidate_id: str, body: dict, actor: Actor = Depends(get_actor)):
    discard_id = body.get("discard_id")
    if not discard_id: raise HTTPException(400, "discard_id required")
    async with db.tenant_conn(actor.tenant_id) as conn:
        keep    = await conn.fetchrow("SELECT id FROM candidates WHERE id=$1 AND tenant_id=$2", candidate_id, actor.tenant_id)
        discard = await conn.fetchrow("SELECT id FROM candidates WHERE id=$1 AND tenant_id=$2", discard_id, actor.tenant_id)
        if not keep or not discard: raise HTTPException(404, "Candidate not found")
        await conn.execute("""
            UPDATE applications SET candidate_id=$1
            WHERE candidate_id=$2 AND tenant_id=$3
              AND requisition_id NOT IN (
                  SELECT requisition_id FROM applications WHERE candidate_id=$1)
        """, candidate_id, discard_id, actor.tenant_id)
        await conn.execute("UPDATE candidates SET is_active=false WHERE id=$1 AND tenant_id=$2", discard_id, actor.tenant_id)
    return {"merged": True, "kept": candidate_id, "discarded": discard_id}


@router.get("/{candidate_id}/applications")
async def candidate_applications(candidate_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            "SELECT a.id, a.requisition_id, r.title AS requisition_title, a.stage, "
            "a.fit_score, a.created_at, a.updated_at "
            "FROM applications a JOIN requisitions r ON r.id=a.requisition_id "
            "WHERE a.candidate_id=$1 ORDER BY a.created_at DESC",
            candidate_id)
    return [dict(r) for r in rows]


@router.get("/{candidate_id}/parse-history")
async def parse_history(candidate_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        cpd = await conn.fetchrow(
            "SELECT * FROM candidate_parsed_data WHERE tenant_id=$1 AND candidate_id=$2",
            actor.tenant_id, candidate_id)
        files = await conn.fetch(
            "SELECT id, imap_msg_id, job_board_label, source_email, file_name, "
            "routing_decision, parse_confidence, dedup_status, "
            "parsed_data->>'name' AS parsed_name, parsed_data->'skills' AS parsed_skills, "
            "parsed_data->>'experience_years' AS parsed_exp, "
            "parsed_data->>'current_company' AS parsed_company, created_at "
            "FROM resume_files WHERE tenant_id=$1 AND candidate_id=$2 "
            "ORDER BY parse_confidence DESC NULLS LAST, created_at DESC",
            actor.tenant_id, candidate_id)
        cand = await conn.fetchrow(
            "SELECT id, full_name, email, skills, total_exp_mo, source_label "
            "FROM candidates WHERE id=$1",
            candidate_id)
    if not cand:
        raise HTTPException(404, "Candidate not found")

    import json as _json
    def _skills(raw):
        if not raw: return []
        try:
            v = _json.loads(raw) if isinstance(raw, str) else raw
            return list(v)[:10] if isinstance(v, list) else []
        except Exception:
            return []

    return {
        "candidate": dict(cand),
        "current_parsed_data": {
            "resume_file_id":   str(cpd["resume_file_id"]) if cpd and cpd["resume_file_id"] else None,
            "parse_source":     cpd["parse_source"] if cpd else None,
            "parse_version":    cpd["parse_version"] if cpd else 0,
            "parsed_at":        cpd["parsed_at"].isoformat() if cpd and cpd["parsed_at"] else None,
            "extracted_skills": list(cpd["extracted_skills"] or []) if cpd else [],
            "total_years_exp":  float(cpd["total_years_exp"] or 0) if cpd else 0,
            "education_level":  cpd["education_level"] if cpd else None,
            "extracted_email":  cpd["extracted_email"] if cpd else None,
            "extracted_phone":  cpd["extracted_phone"] if cpd else None,
            "linkedin_url":     cpd["linkedin_url"] if cpd else None,
        } if cpd else None,
        "resume_files": [
            {
                "id":               str(f["id"]),
                "file_name":        f["file_name"],
                "source":           f["job_board_label"],
                "source_email":     f["source_email"],
                "routing_decision": f["routing_decision"],
                "parse_confidence": float(f["parse_confidence"] or 0),
                "dedup_status":     f["dedup_status"],
                "parsed_name":      f["parsed_name"],
                "parsed_skills":    _skills(f["parsed_skills"]),
                "parsed_exp":       f["parsed_exp"],
                "parsed_company":   f["parsed_company"],
                "created_at":       f["created_at"].isoformat(),
            }
            for f in files
        ],
        "total_files":     len(files),
        "has_parsed_data": cpd is not None,
    }


# ─── Individual Recruiter Candidate Ownership (30-day FCFS lock) ────────────

class OwnershipTransferBody(BaseModel):
    reason: str | None = None


@router.get("/{candidate_id}/ownership")
async def get_candidate_ownership(candidate_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        owner = await ownership.get_ownership(conn, actor.tenant_id, candidate_id)
        history = await conn.fetch(
            """SELECT h.*, u.full_name AS recruiter_name
               FROM candidate_ownership_history h
               LEFT JOIN users u ON u.id = h.recruiter_id
               WHERE h.tenant_id=$1 AND h.candidate_id=$2
               ORDER BY h.created_at DESC""",
            actor.tenant_id, candidate_id,
        )
    return {"owner": owner, "history": [dict(h) for h in history]}


@router.post("/{candidate_id}/ownership/claim")
async def claim_candidate_ownership(candidate_id: str, actor: Actor = Depends(require_role("admin", "manager"))):
    """Manual claim from the unowned/review queue — admin/manager only,
    matching the ownership rule's "authorized manager/admin can assign the
    candidate" for the channels with no individual recruiter naturally in
    the loop at intake (WhatsApp, public apply, browser extension)."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        cand = await conn.fetchrow("SELECT id FROM candidates WHERE id=$1 AND tenant_id=$2", candidate_id, actor.tenant_id)
        if not cand:
            raise HTTPException(404, "Candidate not found")
        result = await ownership.claim_ownership(
            conn, actor.tenant_id, candidate_id, str(actor.user_id), actor.email, "manual_assign",
        )
    return result


@router.post("/{candidate_id}/ownership/transfer/{new_recruiter_id}")
async def transfer_candidate_ownership(candidate_id: str, new_recruiter_id: str, body: OwnershipTransferBody,
                                        actor: Actor = Depends(require_role("admin", "manager"))):
    """Explicit admin/manager override — always allowed regardless of an
    active lock (rule 10/11's "authorized ownership transfer")."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        cand = await conn.fetchrow("SELECT id FROM candidates WHERE id=$1 AND tenant_id=$2", candidate_id, actor.tenant_id)
        if not cand:
            raise HTTPException(404, "Candidate not found")
        new_recruiter = await conn.fetchrow(
            "SELECT id, email FROM users WHERE id=$1 AND tenant_id=$2 AND role='recruiter' AND is_active",
            new_recruiter_id, actor.tenant_id)
        if not new_recruiter:
            raise HTTPException(404, "Recruiter not found")
        result = await ownership.transfer_ownership(
            conn, actor.tenant_id, candidate_id, new_recruiter_id, new_recruiter["email"],
            str(actor.user_id), body.reason,
        )
        await events.write_audit(
            conn, actor.tenant_id, actor.user_id, "candidate.ownership_transferred",
            "candidate", candidate_id, after={"new_recruiter_id": new_recruiter_id, "reason": body.reason},
        )
    return result