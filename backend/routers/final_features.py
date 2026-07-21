"""
8 Final Features:
1. PDF exports (reportlab)
2. AI interview question generator (Ollama)
3. Candidate ranking explanation (Ollama)
4. Candidate status portal (token-based)
5. GDPR auto-archive
6. Nurture sequences
7. JD quality optimizer (rules)
8. Slack/Teams notifications
"""
import io, json, os, secrets, hashlib, httpx
from typing import Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
import db
from deps import Actor, get_actor

router = APIRouter(prefix="/features", tags=["features"])
OLLAMA_URL = "http://ollama:11434/api/generate"
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:1.5b-instruct-q4_K_M")

# ── PDF helpers (reportlab) ───────────────────────────────────
def pdf_header(canvas, title: str, subtitle: str = ""):
    canvas.setFillColorRGB(0.118, 0.227, 0.369)
    canvas.rect(0, 780, 612, 60, fill=1, stroke=0)
    canvas.setFillColorRGB(1, 1, 1)
    canvas.setFont("Helvetica-Bold", 18)
    canvas.drawString(40, 808, "AVIIN ATS")
    canvas.setFont("Helvetica", 11)
    canvas.drawString(40, 792, title)
    if subtitle:
        canvas.setFont("Helvetica", 9)
        canvas.drawRightString(572, 808, subtitle)
    canvas.setFillColorRGB(0, 0, 0)

def fmt_inr(n):
    if n is None: return "—"
    return f"Rs. {float(n):,.0f}"

# ── 1. PDF EXPORTS ─────────────────────────────────────────────
pdf_router = APIRouter(prefix="/pdf", tags=["pdf"])

@pdf_router.get("/kpi-report")
async def kpi_pdf(month: int, year: int, actor: Actor = Depends(get_actor)):
    """Generate KPI report PDF for all recruiters in a month."""
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.pdfgen import canvas as rl_canvas
        from reportlab.lib import colors
        from reportlab.platypus import Table, TableStyle
    except ImportError:
        raise HTTPException(503, "reportlab not installed")

    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT k.*, u.full_name, u.email
            FROM recruiter_kpi_scores k
            JOIN users u ON u.id=k.user_id
            WHERE k.tenant_id=$1 AND k.period_month=$2 AND k.period_year=$3
            ORDER BY k.total_score DESC
        """, actor.tenant_id, month, year)

    MONTH_NAMES = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    buf = io.BytesIO()
    cv = rl_canvas.Canvas(buf, pagesize=A4)
    w, h = A4

    pdf_header(cv, f"Recruiter KPI Report — {MONTH_NAMES[month]} {year}",
               f"Generated {datetime.utcnow().strftime('%d %b %Y')}")

    cv.setFont("Helvetica-Bold", 12)
    cv.drawString(40, 760, "Monthly Performance Summary")

    y = 740
    cv.setFont("Helvetica-Bold", 9)
    headers = ["Recruiter", "Score", "Grade", "Joinings", "Revenue", "Incentive", "Status"]
    col_x = [40, 200, 250, 295, 345, 430, 510]
    for i, h_txt in enumerate(headers):
        cv.drawString(col_x[i], y, h_txt)
    y -= 5
    cv.line(40, y, 572, y)
    y -= 15

    cv.setFont("Helvetica", 9)
    for row in rows:
        if y < 60:
            cv.showPage()
            pdf_header(cv, f"KPI Report — {MONTH_NAMES[month]} {year} (cont.)")
            y = 740
        grade_color = {'A+': (0,0.5,0), 'A': (0,0.4,0), 'B': (0,0,0.6),
                       'C': (0.6,0.4,0), 'D': (0.8,0,0)}
        cv.drawString(col_x[0], y, (row['full_name'] or '')[:22])
        cv.drawString(col_x[1], y, str(row['total_score'] or 0))
        g = row['grade'] or '—'
        gc = grade_color.get(g, (0,0,0))
        cv.setFillColorRGB(*gc)
        cv.drawString(col_x[2], y, g)
        cv.setFillColorRGB(0,0,0)
        cv.drawString(col_x[3], y, str(row['joinings_score'] or 0))
        cv.drawString(col_x[4], y, fmt_inr(row['contribution_margin']))
        cv.drawString(col_x[5], y, fmt_inr(row['calculated_incentive']))
        cv.drawString(col_x[6], y, (row['status'] or '—'))
        y -= 18

    # Summary box
    total_pool = sum(float(r['calculated_incentive'] or 0) for r in rows)
    avg_score  = sum(float(r['total_score'] or 0) for r in rows) / max(len(rows), 1)
    y -= 10
    cv.setFillColorRGB(0.95, 0.95, 0.95)
    cv.rect(40, y-30, 532, 35, fill=1, stroke=0)
    cv.setFillColorRGB(0,0,0)
    cv.setFont("Helvetica-Bold", 10)
    cv.drawString(50, y-15, f"Total Incentive Pool: {fmt_inr(total_pool)}")
    cv.drawString(300, y-15, f"Avg Score: {avg_score:.1f} / 100")
    cv.drawString(50, y-27, f"Recruiters Evaluated: {len(rows)}")

    cv.setFont("Helvetica", 8)
    cv.setFillColorRGB(0.5, 0.5, 0.5)
    cv.drawString(40, 30, f"AVIIN ATS — Confidential | {datetime.utcnow().strftime('%d %b %Y %H:%M')} UTC")
    cv.save()
    buf.seek(0)
    return Response(content=buf.read(), media_type="application/pdf",
                    headers={"Content-Disposition": f"attachment; filename=KPI_{month}_{year}.pdf"})

@pdf_router.get("/candidate-profile/{candidate_id}")
async def candidate_pdf(candidate_id: str, actor: Actor = Depends(get_actor)):
    """Generate candidate profile PDF."""
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.pdfgen import canvas as rl_canvas
    except ImportError:
        raise HTTPException(503, "reportlab not installed")

    async with db.tenant_conn(actor.tenant_id) as conn:
        cand = await conn.fetchrow("""
            SELECT c.*, cpd.education_level, cpd.total_years_exp,
                   cpd.extracted_skills, cpd.extracted_titles,
                   cs.readiness_index, cs.readiness_grade
            FROM candidates c
            LEFT JOIN candidate_parsed_data cpd ON cpd.candidate_id=c.id AND cpd.tenant_id=c.tenant_id
            LEFT JOIN candidate_scores cs ON cs.candidate_id=c.id AND cs.tenant_id=c.tenant_id
            WHERE c.id=$1 AND c.tenant_id=$2
        """, candidate_id, actor.tenant_id)
        if not cand: raise HTTPException(404, "Candidate not found")
        apps = await conn.fetch("""
            SELECT a.stage, r.title FROM applications a
            JOIN requisitions r ON r.id=a.requisition_id
            WHERE a.candidate_id=$1 AND a.tenant_id=$2
            ORDER BY a.updated_at DESC LIMIT 5
        """, candidate_id, actor.tenant_id)

    buf = io.BytesIO()
    cv = rl_canvas.Canvas(buf, pagesize=A4)
    pdf_header(cv, "Candidate Profile", f"AVIIN ATS — Confidential")
    y = 750
    cv.setFont("Helvetica-Bold", 14)
    cv.drawString(40, y, cand['full_name'] or 'Unknown')
    y -= 18
    cv.setFont("Helvetica", 10)
    cv.setFillColorRGB(0.3,0.3,0.3)
    cv.drawString(40, y, f"{cand['email'] or ''} | {cand['phone'] or ''} | {cand['location'] or ''}")
    y -= 25
    cv.setFillColorRGB(0,0,0)
    for label, val in [
        ("Experience", f"{(cand['total_exp_mo'] or 0)//12} years {(cand['total_exp_mo'] or 0)%12} months"),
        ("Current Employer", cand['current_employer'] or '—'),
        ("Education", str(cand['education_level'] or '—')),
        ("Readiness Index", f"{cand['readiness_index'] or '—'} / 100  (Grade: {cand['readiness_grade'] or '—'})"),
        ("Source", cand['source'] or '—'),
    ]:
        cv.setFont("Helvetica-Bold", 9)
        cv.drawString(40, y, f"{label}:")
        cv.setFont("Helvetica", 9)
        cv.drawString(180, y, str(val))
        y -= 16

    y -= 10
    cv.setFont("Helvetica-Bold", 10)
    cv.drawString(40, y, "Skills:")
    y -= 14
    cv.setFont("Helvetica", 9)
    skills = list(cand['skills'] or [])[:20]
    line = ""
    for s in skills:
        if len(line) + len(s) > 70:
            cv.drawString(40, y, line); y -= 14; line = ""
        line += s + "  •  "
    if line: cv.drawString(40, y, line); y -= 14

    if apps:
        y -= 10
        cv.setFont("Helvetica-Bold", 10)
        cv.drawString(40, y, "Applications:")
        y -= 14
        for a in apps:
            cv.setFont("Helvetica", 9)
            cv.drawString(40, y, f"• {a['title']} — {a['stage'].upper()}")
            y -= 14

    cv.setFont("Helvetica", 8)
    cv.setFillColorRGB(0.5,0.5,0.5)
    cv.drawString(40, 30, f"Generated by AVIIN ATS | {datetime.utcnow().strftime('%d %b %Y')}")
    cv.save()
    buf.seek(0)
    return Response(content=buf.read(), media_type="application/pdf",
                    headers={"Content-Disposition": f"attachment; filename=candidate_{candidate_id[:8]}.pdf"})

# ── 2. AI INTERVIEW QUESTION GENERATOR ────────────────────────
ai_router = APIRouter(prefix="/ai-tools", tags=["ai-tools"])

async def ollama_ask(prompt: str, max_tokens: int = 512) -> str:
    """Call Ollama with caching via ollama_cache table."""
    cache_key = hashlib.md5(prompt.encode()).hexdigest()
    async with db.system_conn() as conn:
        cached = await conn.fetchrow(
            "SELECT response FROM ollama_cache WHERE cache_key=$1 AND created_at > now()-INTERVAL '7 days'",
            cache_key)
        if cached:
            return cached['response']
    try:
        async with httpx.AsyncClient(timeout=90) as client:
            r = await client.post(OLLAMA_URL, json={
                "model": OLLAMA_MODEL, "prompt": prompt,
                "stream": False, "options": {"num_predict": max_tokens, "temperature": 0.3}
            })
            result = r.json().get('response', '').strip()
        if result:
            async with db.system_conn() as conn:
                await conn.execute(
                    "INSERT INTO ollama_cache (cache_key, prompt, response) VALUES ($1,$2,$3) "
                    "ON CONFLICT (cache_key) DO UPDATE SET response=EXCLUDED.response, created_at=now()",
                    cache_key, prompt[:500], result)
        return result or "[Ollama returned empty response]"
    except Exception as e:
        return f"[Ollama unavailable: {str(e)[:100]}]"

@ai_router.post("/interview-questions")
async def generate_questions(requisition_id: str, count: int = 8,
                              actor: Actor = Depends(get_actor)):
    """Generate role-specific interview questions using Ollama (cached)."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        req = await conn.fetchrow(
            "SELECT title, description, skills_required FROM requisitions WHERE id=$1 AND tenant_id=$2",
            requisition_id, actor.tenant_id)
        if not req: raise HTTPException(404, "Requisition not found")

    skills = ', '.join((req['skills_required'] or [])[:6])
    prompt = (f"Generate {count} technical interview questions for a {req['title']} role. "
              f"Key skills: {skills}. "
              f"Include: 3 technical questions, 2 coding/problem-solving, 2 behavioural, 1 system design. "
              f"Format: Q1. [question] | Type: technical | Difficulty: medium. One per line. Be concise.")

    response = await ollama_ask(prompt, max_tokens=600)
    questions = []
    for line in response.split('\n'):
        line = line.strip()
        if line and (line[0].isdigit() or line.startswith('Q')):
            questions.append({"question": line, "generated_by": "ollama"})

    return {"role": req['title'], "skills": skills,
            "questions": questions or [{"question": response, "generated_by": "ollama"}],
            "count": len(questions)}

@ai_router.post("/rank-explanation/{candidate_id}")
async def rank_explanation(candidate_id: str, requisition_id: str,
                            actor: Actor = Depends(get_actor)):
    """Explain why a candidate matches (or doesn't) a role — Ollama, cached."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        cand = await conn.fetchrow("""
            SELECT c.full_name, c.total_exp_mo, c.skills,
                   cs.readiness_index, cs.readiness_grade, cs.skill_match_score,
                   cs.experience_score, cs.stability_score
            FROM candidates c
            LEFT JOIN candidate_scores cs ON cs.candidate_id=c.id AND cs.tenant_id=c.tenant_id
            WHERE c.id=$1 AND c.tenant_id=$2
        """, candidate_id, actor.tenant_id)
        req = await conn.fetchrow(
            "SELECT title, skills_required FROM requisitions WHERE id=$1 AND tenant_id=$2",
            requisition_id, actor.tenant_id)
        if not cand or not req: raise HTTPException(404, "Not found")

    cand_skills = ', '.join(list(cand['skills'] or [])[:6])
    req_skills  = ', '.join(list(req['skills_required'] or [])[:6])
    exp_yr = (cand['total_exp_mo'] or 0) // 12
    score  = cand['readiness_index'] or 0

    prompt = (f"In 3 sentences, explain why {cand['full_name']} (score: {score}/100, "
              f"{exp_yr} years exp, skills: {cand_skills}) is a "
              f"{'strong' if float(score)>=70 else 'moderate' if float(score)>=50 else 'weak'} "
              f"match for {req['title']} (needs: {req_skills}). "
              f"Be specific about skill matches and gaps. Keep it professional and concise.")

    explanation = await ollama_ask(prompt, max_tokens=200)
    return {"candidate": cand['full_name'], "role": req['title'],
            "readiness_score": score, "grade": cand['readiness_grade'],
            "explanation": explanation,
            "scores": {"skill_match": cand['skill_match_score'],
                       "experience": cand['experience_score'],
                       "stability": cand['stability_score']}}

@ai_router.post("/jd-optimizer")
async def optimize_jd(jd_text: str, actor: Actor = Depends(get_actor)):
    """Analyze JD quality — readability, bias, clarity (zero-token rules engine)."""
    words = jd_text.split()
    sentences = [s.strip() for s in jd_text.replace('\n','. ').split('.') if s.strip()]
    word_count = len(words)
    avg_sent_len = word_count / max(len(sentences), 1)
    # Bias words
    bias_words = ['young','energetic','recent graduate','digital native','fresh',
                  'aggressive','rockstar','ninja','guru','wizard']
    bias_found = [w for w in bias_words if w.lower() in jd_text.lower()]
    # Clarity checks
    vague_words = ['various','multiple','responsible for','assist','support','help with',
                   'good communication','team player']
    vague_found = [w for w in vague_words if w.lower() in jd_text.lower()]
    # Readability score (Flesch-Kincaid proxy)
    syllables = sum(max(1, len([ch for ch in w if ch in 'aeiouAEIOU'])) for w in words)
    fk_score = max(0, 206.835 - 1.015*(word_count/max(len(sentences),1))
                   - 84.6*(syllables/max(word_count,1)))
    readability = 'Easy' if fk_score>60 else 'Moderate' if fk_score>40 else 'Difficult'
    # Skills extraction
    import re
    skill_patterns = ['Python','Java','React','Node','AWS','Azure','SQL','Docker',
                      'Kubernetes','Machine Learning','Data Science']
    skills_found = [s for s in skill_patterns if re.search(s, jd_text, re.IGNORECASE)]
    score = 100
    suggestions = []
    if word_count < 150:
        score -= 20; suggestions.append("JD is too short (< 150 words). Add more detail about responsibilities.")
    if word_count > 800:
        score -= 10; suggestions.append("JD is too long (> 800 words). Trim to 300-600 words for better apply rates.")
    if bias_found:
        score -= 15; suggestions.append(f"Remove biased language: {', '.join(bias_found)}")
    if vague_found:
        score -= 10; suggestions.append(f"Replace vague phrases: {', '.join(vague_found[:3])}")
    if not skills_found:
        score -= 20; suggestions.append("No specific technical skills mentioned. Add required tech stack.")
    if avg_sent_len > 25:
        score -= 5; suggestions.append("Sentences are too long. Keep under 20 words each.")
    if score >= 80: quality = 'Excellent'
    elif score >= 65: quality = 'Good'
    elif score >= 50: quality = 'Needs Improvement'
    else: quality = 'Poor'
    return {
        "quality_score": max(0, score),
        "quality_grade": quality,
        "readability": readability,
        "flesch_score": round(fk_score, 1),
        "word_count": word_count,
        "skills_detected": skills_found,
        "bias_words": bias_found,
        "vague_phrases": vague_found,
        "suggestions": suggestions,
        "summary": f"JD scored {max(0,score)}/100 ({quality}). {len(suggestions)} issues found."
    }

# ── 4. CANDIDATE STATUS PORTAL ─────────────────────────────────
status_router = APIRouter(prefix="/candidate-status", tags=["status"])

@status_router.post("/generate-link/{candidate_id}")
async def generate_status_link(candidate_id: str, actor: Actor = Depends(get_actor)):
    """Generate a secure public link for a candidate to track their status."""
    token = secrets.token_urlsafe(32)
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute("""
            INSERT INTO candidate_status_tokens (tenant_id,candidate_id,token)
            VALUES ($1,$2,$3)
            ON CONFLICT DO NOTHING
        """, actor.tenant_id, candidate_id, token)
    base = os.getenv("FRONTEND_URL", "http://187.127.179.128")
    return {"token": token, "url": f"{base}/my-status?token={token}",
            "expires": "30 days"}

@status_router.get("/public")
async def public_status(token: str):
    """Public endpoint for candidate to check own application status."""
    import asyncpg as apg
    import os
    db_url = os.getenv("DATABASE_URL", "postgresql://app_user:apppw@db:5432/ats")
    conn2 = await apg.connect(db_url)
    try:
        row = await conn2.fetchrow(
            "SELECT candidate_id::text, tenant_id::text FROM candidate_status_tokens WHERE token=$1 AND expires_at > now()",
            token)
    finally:
        await conn2.close()
    if not row:
        raise HTTPException(404, "Invalid or expired link")
    cand_id   = row["candidate_id"]
    tenant_id = row["tenant_id"]
    STAGE_MSG = {
        "sourced": ("In Review","Under review","#64748b"),
        "applied": ("Applied","Application received","#3b82f6"),
        "shortlisted": ("Shortlisted","You are shortlisted!","#10b981"),
        "interview": ("Interview","Interview scheduled","#8b5cf6"),
        "offer": ("Offer Made","Offer extended!","#f59e0b"),
        "hired": ("Hired","Welcome aboard!","#10b981"),
        "rejected": ("Not Selected","Better luck next time","#ef4444"),
    }
    async with db.tenant_conn(tenant_id) as conn:
        cand = await conn.fetchrow(
            "SELECT full_name, email FROM candidates WHERE id=$1", cand_id)
        apps = await conn.fetch("""
            SELECT a.stage, a.updated_at, r.title AS role
            FROM applications a
            JOIN requisitions r ON r.id=a.requisition_id
            WHERE a.candidate_id=$1 AND a.tenant_id=$2
            ORDER BY a.updated_at DESC LIMIT 5
        """, cand_id, tenant_id)
        ivs = await conn.fetch("""
            SELECT i.scheduled_at, i.interview_type, i.mode, i.meeting_link, i.status
            FROM interview_schedules i
            WHERE i.candidate_id=$1 AND i.tenant_id=$2 AND i.scheduled_at >= now()-INTERVAL '7 days'
            ORDER BY i.scheduled_at
        """, cand_id, tenant_id)
        # Public, no-auth page has no JWT to call /settings/pipeline-stages
        # with — piggyback this tenant's stage labels/colors/order onto the
        # existing response instead of adding a second public endpoint.
        stage_cfg = await conn.fetch(
            "SELECT stage_key, label, color, display_order FROM pipeline_stage_config "
            "WHERE tenant_id=$1 AND is_visible=TRUE ORDER BY display_order", tenant_id)
    formatted = []
    for a in apps:
        msg, label, color = STAGE_MSG.get(a["stage"], (a["stage"].title(), "", "#64748b"))
        formatted.append({
            "role": a["role"], "stage": a["stage"], "label": label,
            "message": msg, "color": color,
            "updated": a["updated_at"].strftime("%d %b %Y") if a["updated_at"] else None,
        })
    return {
        "candidate": {"name": cand["full_name"] if cand else "?", "email": cand["email"] if cand else ""},
        "applications": formatted,
        "upcoming_interviews": [
            {"type": i["interview_type"], "mode": i["mode"],
             "when": i["scheduled_at"].strftime("%d %b %Y at %I:%M %p IST") if i["scheduled_at"] else None,
             "link": i["meeting_link"], "status": i["status"]}
            for i in ivs
        ],
        "message": "Updated in real-time. Contact your recruiter for queries.",
        "stage_config": [dict(r) for r in stage_cfg],
    }



gdpr_router = APIRouter(prefix="/gdpr", tags=["gdpr"])

@gdpr_router.post("/archive-inactive")
async def archive_inactive(days_threshold: int = 90, actor: Actor = Depends(get_actor)):
    """Anonymize candidates with no activity for N days (GDPR compliance)."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        stale = await conn.fetch("""
            SELECT c.id, c.full_name FROM candidates c
            WHERE c.tenant_id=$1
              AND c.created_at < now()-INTERVAL '1 day' * $2
              AND NOT EXISTS (
                SELECT 1 FROM applications a WHERE a.candidate_id=c.id AND a.tenant_id=c.tenant_id
              )
              AND NOT EXISTS (
                SELECT 1 FROM candidate_activities ca WHERE ca.candidate_id=c.id AND ca.tenant_id=c.tenant_id
                  AND ca.created_at > now()-INTERVAL '1 day' * $2
              )
        """, actor.tenant_id, days_threshold)
        archived = 0
        for row in stale:
            await conn.execute("""
                UPDATE candidates SET
                  email = 'archived_' || LEFT(id::text,8) || '@redacted.com',
                  phone = NULL, full_name = 'ANONYMIZED', resume_text = NULL,
                  resume_embedding = NULL
                WHERE id=$1 AND tenant_id=$2
            """, row['id'], actor.tenant_id)
            await conn.execute("""
                INSERT INTO gdpr_archive_log (tenant_id,candidate_id,action,reason,fields_cleared)
                VALUES ($1,$2,'anonymized','inactive_90_days',
                        ARRAY['email','phone','full_name','resume_text','resume_embedding'])
            """, actor.tenant_id, row['id'])
            archived += 1
    return {"archived": archived, "threshold_days": days_threshold,
            "message": f"Anonymized {archived} inactive candidates"}

@gdpr_router.get("/log")
async def gdpr_log(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            "SELECT * FROM gdpr_archive_log WHERE tenant_id=$1 ORDER BY archived_at DESC LIMIT 50",
            actor.tenant_id)
    return [dict(r) for r in rows]

# ── 6. NURTURE SEQUENCES ──────────────────────────────────────
nurture_router = APIRouter(prefix="/nurture", tags=["nurture"])

@nurture_router.get("")
async def list_sequences(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            "SELECT * FROM nurture_sequences WHERE tenant_id=$1 ORDER BY name",
            actor.tenant_id)
    return [dict(r) for r in rows]

@nurture_router.post("")
async def create_sequence(body: dict, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            INSERT INTO nurture_sequences (tenant_id,name,trigger_event,steps)
            VALUES ($1,$2,$3,$4::jsonb)
            ON CONFLICT (tenant_id,name) DO UPDATE SET steps=EXCLUDED.steps
            RETURNING *
        """, actor.tenant_id, body['name'], body['trigger_event'],
             json.dumps(body.get('steps',[])))
    return dict(row)

@nurture_router.post("/seed-defaults")
async def seed_default_sequences(actor: Actor = Depends(get_actor)):
    """Seed 3 default nurture sequences for common staffing scenarios."""
    defaults = [
        {
            "name": "Post-Interview Follow-up",
            "trigger_event": "interview_completed",
            "steps": [
                {"day": 1, "type": "whatsapp", "template": "Thank you for the interview for {role}. We will update you within 2 business days. - AVIIN Jobs"},
                {"day": 3, "type": "whatsapp", "template": "Hi {name}, any update on your interview feedback? The client is keen. - AVIIN Jobs"},
                {"day": 7, "type": "sms", "template": "Hi {name}, final update on {role} role. Please call us at your earliest. - AVIIN Jobs"},
            ]
        },
        {
            "name": "Offer Drop Prevention",
            "trigger_event": "offer_made",
            "steps": [
                {"day": 0, "type": "whatsapp", "template": "Congratulations {name}! Your offer for {role} at Rs.{ctc} is ready. Please confirm by {deadline}. - AVIIN Jobs"},
                {"day": 2, "type": "whatsapp", "template": "Hi {name}, just checking on the offer for {role}. Any questions? We are here to help. - AVIIN Jobs"},
                {"day": 4, "type": "sms", "template": "Urgent: Offer for {role} expires in 2 days. Please respond. AVIIN Jobs: {recruiter_phone}"},
            ]
        },
        {
            "name": "Passive Candidate Warm-up",
            "trigger_event": "manual",
            "steps": [
                {"day": 0, "type": "whatsapp", "template": "Hi {name}, hope you are doing well! We have an exciting {role} opportunity that matches your profile. Interested? - AVIIN Jobs"},
                {"day": 3, "type": "whatsapp", "template": "Hi {name}, following up on the {role} opportunity. The client is actively hiring. 5 mins call? - AVIIN Jobs"},
                {"day": 7, "type": "sms", "template": "Hi {name}, last follow-up on {role} at {company}. CTC: Rs.{ctc}. Call us: {recruiter_phone} - AVIIN Jobs"},
            ]
        },
    ]
    created = 0
    async with db.tenant_conn(actor.tenant_id) as conn:
        for d in defaults:
            await conn.execute("""
                INSERT INTO nurture_sequences (tenant_id,name,trigger_event,steps)
                VALUES ($1,$2,$3,$4::jsonb)
                ON CONFLICT (tenant_id,name) DO NOTHING
            """, actor.tenant_id, d['name'], d['trigger_event'], json.dumps(d['steps']))
            created += 1
    return {"seeded": created, "sequences": [d['name'] for d in defaults]}

# ── 7. JD QUALITY OPTIMIZER (already in ai_router above) ──────
# Exposed as /features/ai-tools/jd-optimizer

# ── 8. SLACK/TEAMS NOTIFICATIONS ─────────────────────────────
notif_router = APIRouter(prefix="/integrations", tags=["integrations"])

class WebhookIn(BaseModel):
    platform: str
    name: str
    webhook_url: str
    events: list = []

async def send_webhook(url: str, platform: str, message: str, data: dict = {}) -> bool:
    """Send Slack/Teams/Discord webhook notification."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            if platform == 'slack':
                payload = {
                    "text": message,
                    "attachments": [{"color": "#1e3a5f", "text": str(data)[:500]}] if data else []
                }
            elif platform == 'teams':
                payload = {
                    "@type": "MessageCard",
                    "@context": "http://schema.org/extensions",
                    "summary": message,
                    "themeColor": "1e3a5f",
                    "title": "AVIIN ATS Notification",
                    "text": message,
                }
            elif platform == 'discord':
                payload = {"content": f"**AVIIN ATS** | {message}"}
            else:
                payload = {"text": message, "data": data}
            r = await client.post(url, json=payload)
            return r.status_code < 400
    except Exception:
        return False

@notif_router.get("/webhooks")
async def list_webhooks(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            "SELECT id,platform,name,events,is_active,send_count,last_sent_at FROM webhook_integrations WHERE tenant_id=$1 ORDER BY platform,name",
            actor.tenant_id)
    return [dict(r) for r in rows]

@notif_router.post("/webhooks")
async def add_webhook(body: WebhookIn, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            INSERT INTO webhook_integrations (tenant_id,platform,name,webhook_url,events)
            VALUES ($1,$2,$3,$4,$5)
            ON CONFLICT (tenant_id,name) DO UPDATE SET
              webhook_url=EXCLUDED.webhook_url, events=EXCLUDED.events
            RETURNING *
        """, actor.tenant_id, body.platform, body.name, body.webhook_url, body.events)
    return dict(row)

@notif_router.post("/webhooks/{webhook_id}/test")
async def test_webhook(webhook_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT * FROM webhook_integrations WHERE id=$1 AND tenant_id=$2",
            webhook_id, actor.tenant_id)
        if not row: raise HTTPException(404, "Not found")
    success = await send_webhook(
        row['webhook_url'], row['platform'],
        f"✅ Test notification from AVIIN ATS | {datetime.utcnow().strftime('%d %b %Y %H:%M')} UTC",
        {"type": "test", "platform": row['platform']}
    )
    if success:
        async with db.tenant_conn(actor.tenant_id) as conn:
            await conn.execute("""
                UPDATE webhook_integrations SET send_count=send_count+1, last_sent_at=now()
                WHERE id=$1
            """, webhook_id)
    return {"sent": success, "platform": row['platform'], "name": row['name']}

@notif_router.post("/notify")
async def notify_all(event: str, message: str, data: dict = {},
                      actor: Actor = Depends(get_actor)):
    """Send notification to all active webhooks subscribed to an event."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        hooks = await conn.fetch("""
            SELECT * FROM webhook_integrations
            WHERE tenant_id=$1 AND is_active
              AND ($2=ANY(events) OR events='{}'::text[] OR events IS NULL)
        """, actor.tenant_id, event)
        sent = 0
        for h in hooks:
            ok = await send_webhook(h['webhook_url'], h['platform'], message, data)
            if ok:
                await conn.execute("""
                    UPDATE webhook_integrations SET send_count=send_count+1, last_sent_at=now()
                    WHERE id=$1
                """, h['id'])
                sent += 1
    return {"event": event, "webhooks_notified": sent}


@nurture_router.post('/{seq_id}/run-now')
async def run_sequence_now(seq_id: str, actor: Actor = Depends(get_actor)):
    '''Manually trigger a nurture sequence — returns count of candidates it would reach.'''
    async with db.tenant_conn(actor.tenant_id) as conn:
        seq = await conn.fetchrow(
            'SELECT * FROM nurture_sequences WHERE id=$1::uuid AND tenant_id=$2',
            seq_id, actor.tenant_id)
        if not seq:
            raise HTTPException(404, 'Sequence not found')
        import json as _json
        steps = seq['steps'] if isinstance(seq['steps'], list) else _json.loads(seq['steps'] or '[]')
        stage_map = {
            'offer_made': 'offer', 'offer_accepted': 'offer_accepted',
            'interview_scheduled': 'l1_interview', 'candidate_placed': 'placed',
            'candidate_rejected': 'rejected', 'application_received': 'sourced',
            'stage_change': None,
        }
        stage = stage_map.get(seq['trigger_event'])
        if not stage:
            return {'triggered': 0, 'message': 'No matching stage for trigger'}
        rows = await conn.fetch('''
            SELECT a.candidate_id, c.full_name, c.email
            FROM applications a JOIN candidates c ON c.id=a.candidate_id
            WHERE a.tenant_id=$1 AND a.stage=$2 AND c.email IS NOT NULL LIMIT 50
        ''', actor.tenant_id, stage)
        triggered = 0
        for r in rows:
            try:
                await conn.execute('''
                    INSERT INTO nurture_executions (tenant_id, sequence_id, candidate_id, step_idx, channel, sent_at)
                    VALUES ($1, $2::uuid, $3, 0, $4, now())
                    ON CONFLICT (sequence_id, candidate_id) DO UPDATE SET sent_at=now(), step_idx=0
                ''', actor.tenant_id, seq_id, r['candidate_id'],
                     steps[0].get('type', 'email') if steps else 'email')
                triggered += 1
            except Exception:
                pass
        return {'triggered': triggered, 'sequence': seq['name'],
                'message': f'Sequence queued for {triggered} candidates in stage: {stage}'}
