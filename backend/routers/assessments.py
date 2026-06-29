"""P20 - Technical Assessment & Video Intelligence.

Stores MCQ/coding/video assessments with anti-cheat metrics.
Video intelligence computed from submitted metadata (no Whisper dep).
"""
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import db
from deps import Actor, get_actor

router = APIRouter(prefix="/assessments", tags=["assessments"])

class AssessmentCreate(BaseModel):
    candidate_id: str
    requisition_id: Optional[str] = None
    assessment_type: str = "mcq"
    title: Optional[str] = None
    questions: list = []
    max_score: float = 100

class AssessmentSubmit(BaseModel):
    score: float
    time_taken_mins: Optional[int] = None
    tab_switches: int = 0
    copy_paste_count: int = 0
    focus_lost_count: int = 0
    questions: list = []  # answered questions

class VideoMetrics(BaseModel):
    video_duration_secs: Optional[int] = None
    transcript_text: Optional[str] = None
    sentiment_score: Optional[float] = None
    confidence_score: Optional[float] = None
    eye_contact_pct: Optional[float] = None
    speech_rate_wpm: Optional[int] = None
    filler_word_count: Optional[int] = None

FILLER_WORDS = ['um','uh','like','you know','basically','literally','actually','sort of','kind of']

def analyze_video_text(transcript: str, duration_secs: int) -> dict:
    """Rule-based video intelligence — zero external LLM."""
    if not transcript:
        return {}
    words   = transcript.lower().split()
    wpm     = int(len(words) / (duration_secs / 60)) if duration_secs > 0 else 0
    fillers = sum(1 for w in words if w in FILLER_WORDS)
    filler_rate = fillers / max(len(words), 1) * 100
    # Confidence proxy: longer sentences, fewer fillers, higher WPM
    conf = max(0.0, min(1.0, 1.0 - filler_rate/50 + (1 if 100 < wpm < 180 else 0) * 0.2))
    # Sentiment: simple keyword check
    pos_words = ['great','excellent','excited','passion','experience','achieve','success','love','build']
    neg_words = ['difficult','problem','hate','struggle','fail','bad','never']
    pos_count = sum(1 for w in words if w in pos_words)
    neg_count = sum(1 for w in words if w in neg_words)
    sentiment = (pos_count - neg_count) / max(pos_count + neg_count, 1)
    return {
        'speech_rate_wpm':  wpm,
        'filler_word_count': fillers,
        'confidence_score':  round(conf, 3),
        'sentiment_score':   round(min(1.0, max(-1.0, sentiment)), 3),
    }

@router.get("")
async def list_assessments(candidate_id: Optional[str]=None, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT ta.*, ca.full_name AS candidate_name
            FROM technical_assessments ta
            JOIN candidates ca ON ca.id=ta.candidate_id
            WHERE ($1::text IS NULL OR ta.candidate_id::text=$1)
            ORDER BY ta.created_at DESC
        """, candidate_id)
    return [dict(r) for r in rows]

@router.post("")
async def create_assessment(body: AssessmentCreate, actor: Actor=Depends(get_actor)):
    import json
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            INSERT INTO technical_assessments
              (tenant_id,candidate_id,requisition_id,assessment_type,title,questions,max_score)
            VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
            RETURNING *
        """, actor.tenant_id, body.candidate_id, body.requisition_id,
             body.assessment_type, body.title, json.dumps(body.questions), body.max_score)
    return dict(row)

@router.patch("/{assessment_id}/submit")
async def submit_assessment(assessment_id: str, body: AssessmentSubmit, actor: Actor=Depends(get_actor)):
    import json
    suspicious = (body.tab_switches > 5 or body.copy_paste_count > 3 or body.focus_lost_count > 10)
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            UPDATE technical_assessments SET
              score=$1, time_taken_mins=$2,
              tab_switches=$3, copy_paste_count=$4, focus_lost_count=$5,
              suspicious_flag=$6, questions=$7::jsonb,
              status=CASE WHEN $6 THEN 'flagged' ELSE 'completed' END,
              completed_at=now()
            WHERE id=$8 RETURNING *
        """, body.score, body.time_taken_mins,
             body.tab_switches, body.copy_paste_count, body.focus_lost_count,
             suspicious, json.dumps(body.questions), assessment_id)
        if not row:
            raise HTTPException(404, "Assessment not found")
    return dict(row)

@router.post("/{assessment_id}/video-analysis")
async def analyze_video(assessment_id: str, body: VideoMetrics, actor: Actor=Depends(get_actor)):
    """Submit video metadata + auto-compute intelligence scores."""
    import json
    computed = {}
    if body.transcript_text and body.video_duration_secs:
        computed = analyze_video_text(body.transcript_text, body.video_duration_secs)
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            UPDATE technical_assessments SET
              video_duration_secs=$1, transcript_text=$2,
              sentiment_score  = COALESCE($3, $8::numeric),
              confidence_score = COALESCE($4, $9::numeric),
              eye_contact_pct  = $5,
              speech_rate_wpm  = COALESCE($6, $10::int),
              filler_word_count= COALESCE($7, $11::int),
              video_flags      = $12::jsonb
            WHERE id=$13 RETURNING *
        """,
            body.video_duration_secs, body.transcript_text,
            body.sentiment_score, body.confidence_score,
            body.eye_contact_pct, body.speech_rate_wpm, body.filler_word_count,
            computed.get('sentiment_score'), computed.get('confidence_score'),
            computed.get('speech_rate_wpm'), computed.get('filler_word_count'),
            json.dumps(computed),
            assessment_id)
        if not row:
            raise HTTPException(404, "Not found")
    return dict(row)

@router.get("/stats")
async def assessment_stats(actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            SELECT COUNT(*) AS total,
                   ROUND(AVG(score),1) AS avg_score,
                   COUNT(*) FILTER (WHERE suspicious_flag) AS flagged,
                   COUNT(*) FILTER (WHERE assessment_type='video') AS video_count,
                   COUNT(*) FILTER (WHERE status='completed') AS completed
            FROM technical_assessments
        """)
    return dict(row)
