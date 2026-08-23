"""P13 BGV: Trust Intelligence + India Verification APIs.

BGV checks (identity/education/employment/criminal/credit/address/reference/digilocker)
Trust graph (referral/worked_with/placed/vouched/reported_fraud edges)
Aadhaar OTP e-sign + DigiLocker: scaffolded endpoints (require production credentials)
"""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import db
from deps import Actor, get_actor
from permissions import require_permission

router = APIRouter(prefix="/bgv", tags=["bgv"])

# BGV score points per check type (rule-based — no LLM needed)
BGV_SCORE_POINTS = {
    "identity": 25,
    "education": 20,
    "employment": 30,
    "criminal": 10,
    "credit": 10,
    "address": 10,
    "reference": 15,
    "digilocker": 20,
}


# ─── BGV Checks ───────────────────────────────────────────────────────────────

class BGVCheckCreate(BaseModel):
    candidate_id: str
    check_type: str
    vendor: Optional[str] = "in_house"
    notes: Optional[str] = None


class BGVCheckUpdate(BaseModel):
    status: str
    result: Optional[str] = None
    reference_id: Optional[str] = None
    notes: Optional[str] = None


@router.get("/stats")
async def bgv_stats(actor: Actor = Depends(get_actor)):
    """Tenant-wide overview for the BGV dashboard — was always all-zero
    hardcoded on the frontend despite bgv_checks having real rows."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """SELECT
                 COUNT(*) FILTER (WHERE status='completed' AND result='clear') AS verified,
                 COUNT(*) FILTER (WHERE status='in_progress') AS in_progress,
                 COUNT(*) FILTER (WHERE status='pending') AS pending,
                 COUNT(*) FILTER (WHERE result='flagged') AS flagged,
                 COUNT(*) AS total
               FROM bgv_checks"""
        )
        by_type = await conn.fetch(
            """SELECT check_type, COUNT(*) AS total,
                      COUNT(*) FILTER (WHERE status='completed' AND result='clear') AS verified
               FROM bgv_checks GROUP BY check_type"""
        )
    return {**dict(row), "by_type": [dict(r) for r in by_type]}


@router.get("/checks")
async def list_all_bgv_checks(
    status: Optional[str] = None,
    limit: int = 100,
    actor: Actor = Depends(get_actor),
):
    """List across all candidates (candidates/{id} route below only ever
    covered a single candidate — nothing surfaced a tenant-wide view for
    the Checks tab)."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            """SELECT bc.id, bc.check_type, bc.status, bc.result, bc.score_points,
                      bc.initiated_at, bc.completed_at, bc.vendor, bc.reference_id, bc.notes,
                      bc.candidate_id, c.full_name AS candidate_name
               FROM bgv_checks bc
               JOIN candidates c ON c.id = bc.candidate_id
               WHERE c.is_active IS NOT FALSE AND ($1::text IS NULL OR bc.status = $1)
               ORDER BY bc.created_at DESC
               LIMIT $2""",
            status, limit,
        )
    return [dict(r) for r in rows]


@router.get("/checks/{candidate_id}")
async def list_bgv_checks(candidate_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            """SELECT id, check_type, status, result, score_points,
                      initiated_at, completed_at, vendor, reference_id, notes, created_at
               FROM bgv_checks
               WHERE candidate_id = $1
               ORDER BY created_at DESC""",
            candidate_id,
        )
    return [dict(r) for r in rows]


@router.post("/checks")
async def create_bgv_check(body: BGVCheckCreate, actor: Actor = Depends(require_permission("bgv_checks", "create"))):
    score_pts = BGV_SCORE_POINTS.get(body.check_type, 10)
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """INSERT INTO bgv_checks
               (tenant_id, candidate_id, check_type, status, score_points, vendor, notes, initiated_at)
               VALUES ($1,$2,$3,'in_progress',$4,$5,$6,now())
               RETURNING id, check_type, status, score_points, initiated_at""",
            actor.tenant_id, body.candidate_id, body.check_type,
            score_pts, body.vendor, body.notes,
        )
    return dict(row)


@router.patch("/checks/{check_id}")
async def update_bgv_check(check_id: str, body: BGVCheckUpdate, actor: Actor = Depends(require_permission("bgv_checks", "update"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        completed_at = "now()" if body.status == "completed" else "NULL"
        row = await conn.fetchrow(
            f"""UPDATE bgv_checks SET
                  status = $1, result = $2, reference_id = $3, notes = COALESCE($4, notes),
                  completed_at = CASE WHEN $1='completed' THEN now() ELSE completed_at END
               WHERE id = $5
               RETURNING id, check_type, status, result, completed_at""",
            body.status, body.result, body.reference_id, body.notes, check_id,
        )
    if not row:
        raise HTTPException(404, "BGV check not found")
    return dict(row)


# ─── Trust Score ──────────────────────────────────────────────────────────────

@router.get("/trust-score/{candidate_id}")
async def trust_score(candidate_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """SELECT candidate_id, full_name,
                      bgv_score, trust_graph_score, fraud_flags,
                      total_checks, checks_clear,
                      LEAST(bgv_score + trust_graph_score - fraud_flags * 30, 100) AS total_score
               FROM v_trust_scores
               WHERE candidate_id = $1""",
            candidate_id,
        )
    if not row:
        raise HTTPException(404, "Candidate not found")
    d = dict(row)
    d["trust_rating"] = (
        "Excellent" if d["total_score"] >= 90 else
        "Good"      if d["total_score"] >= 70 else
        "Fair"      if d["total_score"] >= 50 else
        "Low"       if d["total_score"] >= 0  else
        "Flagged"
    )
    return d


# ─── Trust Graph ──────────────────────────────────────────────────────────────

class TrustEdgeCreate(BaseModel):
    source_type: str
    source_id: str
    target_type: str
    target_id: str
    edge_type: str
    weight: float = 1.0
    metadata: dict = {}


@router.get("/trust-graph")
async def list_trust_edges(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            """SELECT id, source_type, source_id, target_type, target_id,
                      edge_type, weight, metadata, created_at
               FROM trust_graph
               ORDER BY created_at DESC
               LIMIT 100""",
        )
    return [dict(r) for r in rows]


@router.post("/trust-graph/edge")
async def add_trust_edge(body: TrustEdgeCreate, actor: Actor = Depends(require_permission("bgv_checks", "create"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """INSERT INTO trust_graph
               (tenant_id, source_type, source_id, target_type, target_id,
                edge_type, weight, metadata)
               VALUES ($1,$2,$3::uuid,$4,$5::uuid,$6,$7,$8)
               RETURNING id, edge_type, weight, created_at""",
            actor.tenant_id,
            body.source_type, body.source_id,
            body.target_type, body.target_id,
            body.edge_type, body.weight, body.metadata or {},
        )
    return dict(row)


# Offer-letter generation used to live here as a second, non-overlapping-
# route duplicate of offers.py's real draft/approve/issue/PDF/e-sign flow
# on the same offer_letters table — confirmed zero callers anywhere
# (frontend or backend) before removal (2026-08-10 audit follow-up).
# offers.py is the one real offer-letter path now.


# ─── India Verification API Stubs ─────────────────────────────────────────────
# These endpoints have the correct interface but require production credentials:
# - Aadhaar OTP: UIDAI Aadhaar Authentication API (requires UIDAI partner onboarding)
# - DigiLocker: DigiLocker API v2 (requires NIC partner ID + client secret)
# Both are scaffolded here — wire in production keys at P14/go-live.

class AadhaarVerifyRequest(BaseModel):
    candidate_id: str
    aadhaar_number: str   # HARD RULE #11: will be encrypted before storage
    mobile_last4: str     # Last 4 digits of registered mobile for OTP routing


@router.post("/aadhaar/initiate")
async def aadhaar_initiate(body: AadhaarVerifyRequest, actor: Actor = Depends(get_actor)):
    """
    Initiates Aadhaar OTP verification.
    Production: calls UIDAI /auth/OTP endpoint with ASA credentials.
    Demo: returns a mock transaction ID.
    """
    # In production: await uidai_client.initiate_otp(aadhaar_enc, mobile_last4)
    return {
        "status": "otp_sent",
        "transaction_id": f"DEMO-AADHAAR-{body.candidate_id[:8]}",
        "message": "Aadhaar OTP initiated (demo mode — production requires UIDAI ASA onboarding)",
        "production_required": True,
    }


class AadhaarOTPVerify(BaseModel):
    transaction_id: str
    otp: str
    candidate_id: str


@router.post("/aadhaar/verify-otp")
async def aadhaar_verify_otp(body: AadhaarOTPVerify, actor: Actor = Depends(get_actor)):
    """
    Verifies Aadhaar OTP and records identity BGV check.
    Production: validates OTP with UIDAI, stores encrypted eKYC result.
    Demo: auto-passes the check.
    """
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """INSERT INTO bgv_checks
               (tenant_id, candidate_id, check_type, status, result, score_points,
                vendor, reference_id, initiated_at, completed_at)
               VALUES ($1,$2,'identity','completed','clear',25,'aadhaar_demo',$3,now(),now())
               RETURNING id, status, result, score_points""",
            actor.tenant_id, body.candidate_id, body.transaction_id,
        )
    return {
        **dict(row),
        "aadhaar_verified": True,
        "message": "Demo verification complete. Production: validates with UIDAI Auth API.",
    }


class DigiLockerRequest(BaseModel):
    candidate_id: str
    document_type: str  # 'degree', 'pan_card', 'driving_licence', etc.


@router.post("/digilocker/initiate")
async def digilocker_initiate(body: DigiLockerRequest, actor: Actor = Depends(get_actor)):
    """
    Initiates DigiLocker document pull.
    Production: OAuth2 redirect to DigiLocker with NIC client credentials.
    Demo: returns mock auth URL.
    """
    return {
        "status": "initiated",
        "auth_url": f"https://digilocker.gov.in/oauth2/authorize?demo=true&candidate={body.candidate_id}",
        "document_type": body.document_type,
        "message": "DigiLocker OAuth2 flow (demo — production requires NIC partner credentials)",
        "production_required": True,
    }
