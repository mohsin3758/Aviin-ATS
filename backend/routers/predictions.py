"""P21 - AI Shortlisting & Predictive Hiring.

Uses scikit-learn LogisticRegression trained on historical placement data.
Zero external LLM — local sklearn only.
"""
import json
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import db
from deps import Actor, get_actor

router = APIRouter(prefix="/predictions", tags=["predictions"])

# ── Lazy model cache ─────────────────────────────────────
_model_cache: dict = {}

def _build_features(candidate: dict, scores: dict) -> list[float]:
    """Build feature vector from candidate + intelligence data."""
    exp_yr      = (candidate.get("total_exp_mo") or 0) / 12
    n_skills    = len(candidate.get("skills") or [])
    readiness   = float(scores.get("readiness_index") or 0)
    stability   = float(scores.get("stability_score") or 50)
    skill_match = float(scores.get("skill_match_score") or 0)
    gap_flag    = 1.0 if scores.get("has_gap_flag") else 0.0
    edu_map     = {"PhD":4,"Masters":3,"Bachelors":2,"Diploma":1,"Other":0}
    edu_level   = edu_map.get(scores.get("education_level") or "Other", 0)
    return [exp_yr, n_skills, readiness, stability, skill_match, gap_flag, float(edu_level)]

def _get_model(tenant_id: str, training_rows: list[dict]):
    """Train or return cached LogisticRegression model."""
    try:
        from sklearn.linear_model import LogisticRegression
        from sklearn.preprocessing import StandardScaler
        import numpy as np
    except ImportError:
        return None, None, "sklearn not available"

    if len(training_rows) < 5:
        return None, None, "insufficient training data (need >=5 placements)"

    X, y = [], []
    for row in training_rows:
        feat = _build_features(row, row)
        X.append(feat)
        y.append(1 if row.get("placed") else 0)

    X = np.array(X, dtype=float)
    y = np.array(y)
    if len(set(y)) < 2:
        return None, None, "need both placed and not-placed examples"

    scaler = StandardScaler()
    Xs = scaler.fit_transform(X)
    model = LogisticRegression(max_iter=200, random_state=42)
    model.fit(Xs, y)
    _model_cache[tenant_id] = (model, scaler)
    return model, scaler, None


class PredictRequest(BaseModel):
    candidate_id: str
    requisition_id: Optional[str] = None

class BulkPredictRequest(BaseModel):
    requisition_id: Optional[str] = None
    limit: int = 50

class OutcomeUpdate(BaseModel):
    actual_outcome: str  # placed|not_placed|offer_drop


@router.post("/predict")
async def predict_one(body: PredictRequest, actor: Actor=Depends(get_actor)):
    """Predict placement probability for a single candidate."""
    import numpy as np
    async with db.tenant_conn(actor.tenant_id) as conn:
        cand = await conn.fetchrow("""
            SELECT ca.id, ca.total_exp_mo, ca.skills,
                   cs.readiness_index, cs.stability_score, cs.skill_match_score,
                   cs.has_gap_flag, cs.education_score,
                   cpd.education_level
            FROM candidates ca
            LEFT JOIN candidate_scores cs ON cs.candidate_id=ca.id AND cs.tenant_id=ca.tenant_id
            LEFT JOIN candidate_parsed_data cpd ON cpd.candidate_id=ca.id AND cpd.tenant_id=ca.tenant_id
            WHERE ca.id=$1 AND ca.tenant_id=$2
        """, body.candidate_id, actor.tenant_id)
        if not cand:
            raise HTTPException(404, "Candidate not found")

        # Get historical data for training
        hist = await conn.fetch("""
            SELECT ca.total_exp_mo, ca.skills,
                   cs.readiness_index, cs.stability_score, cs.skill_match_score,
                   cs.has_gap_flag, cpd.education_level,
                   CASE WHEN pl.id IS NOT NULL THEN true ELSE false END AS placed
            FROM candidates ca
            LEFT JOIN candidate_scores cs ON cs.candidate_id=ca.id AND cs.tenant_id=ca.tenant_id
            LEFT JOIN candidate_parsed_data cpd ON cpd.candidate_id=ca.id AND cpd.tenant_id=ca.tenant_id
            LEFT JOIN placements pl ON pl.candidate_id=ca.id AND pl.tenant_id=ca.tenant_id
            WHERE ca.tenant_id=$1
            LIMIT 200
        """, actor.tenant_id)

    features = _build_features(dict(cand), dict(cand))
    model, scaler, err = _get_model(actor.tenant_id, [dict(r) for r in hist])

    placement_prob = 0.0
    offer_drop_prob = 0.0
    model_note = err or "logistic_regression"

    if model and scaler:
        try:
            import numpy as np
            Xf = scaler.transform([features])
            proba = model.predict_proba(Xf)[0]
            placement_prob  = float(proba[1])
            offer_drop_prob = max(0.0, 1.0 - placement_prob - 0.2)
        except Exception as e:
            model_note = f"predict_error: {e}"
    else:
        # Fallback: rule-based probability from readiness_index
        ri = float(cand["readiness_index"] or 50)
        placement_prob  = round(ri / 100 * 0.8, 4)
        offer_drop_prob = round((1 - placement_prob) * 0.3, 4)
        model_note = "rule_based_fallback"

    grade = ('A+' if placement_prob >= 0.8 else 'A' if placement_prob >= 0.65
             else 'B' if placement_prob >= 0.5 else 'C' if placement_prob >= 0.35 else 'D')

    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            INSERT INTO placement_predictions
              (tenant_id,candidate_id,requisition_id,placement_prob,offer_drop_prob,
               predicted_grade,features,model_version)
            VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
            ON CONFLICT (tenant_id,candidate_id,requisition_id) DO UPDATE SET
              placement_prob=EXCLUDED.placement_prob,
              offer_drop_prob=EXCLUDED.offer_drop_prob,
              predicted_grade=EXCLUDED.predicted_grade,
              features=EXCLUDED.features,
              model_version=EXCLUDED.model_version,
              predicted_at=now()
            RETURNING *
        """, actor.tenant_id, body.candidate_id, body.requisition_id,
             placement_prob, offer_drop_prob, grade,
             json.dumps({"features": features, "model": model_note}),
             "v1-logistic" if (model and scaler) else "v1-rule")
    return dict(row)


@router.post("/bulk")
async def bulk_predict(body: BulkPredictRequest, actor: Actor=Depends(get_actor)):
    """Predict placement probability for all scoreable candidates."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        candidates = await conn.fetch("""
            SELECT ca.id, ca.total_exp_mo, ca.skills,
                   cs.readiness_index, cs.stability_score, cs.skill_match_score,
                   cs.has_gap_flag, cpd.education_level
            FROM candidates ca
            LEFT JOIN candidate_scores cs ON cs.candidate_id=ca.id AND cs.tenant_id=ca.tenant_id
            LEFT JOIN candidate_parsed_data cpd ON cpd.candidate_id=ca.id AND cpd.tenant_id=ca.tenant_id
            WHERE ca.tenant_id=$1 LIMIT $2
        """, actor.tenant_id, body.limit)
        hist = await conn.fetch("""
            SELECT ca.total_exp_mo, ca.skills, cs.readiness_index,
                   cs.stability_score, cs.skill_match_score, cs.has_gap_flag,
                   cpd.education_level,
                   CASE WHEN pl.id IS NOT NULL THEN true ELSE false END AS placed
            FROM candidates ca
            LEFT JOIN candidate_scores cs ON cs.candidate_id=ca.id AND cs.tenant_id=ca.tenant_id
            LEFT JOIN candidate_parsed_data cpd ON cpd.candidate_id=ca.id AND cpd.tenant_id=ca.tenant_id
            LEFT JOIN placements pl ON pl.candidate_id=ca.id AND pl.tenant_id=ca.tenant_id
            WHERE ca.tenant_id=$1 LIMIT 200
        """, actor.tenant_id)

    model, scaler, err = _get_model(actor.tenant_id, [dict(r) for r in hist])
    results = []
    async with db.tenant_conn(actor.tenant_id) as conn:
        for cand in candidates:
            features = _build_features(dict(cand), dict(cand))
            if model and scaler:
                try:
                    import numpy as np
                    Xf = scaler.transform([features])
                    prob = float(model.predict_proba(Xf)[0][1])
                except Exception:
                    ri = float(cand["readiness_index"] or 50)
                    prob = round(ri / 100 * 0.8, 4)
            else:
                ri = float(cand["readiness_index"] or 50)
                prob = round(ri / 100 * 0.8, 4)

            drop_prob = max(0.0, 1.0 - prob - 0.2)
            grade = ('A+' if prob >= 0.8 else 'A' if prob >= 0.65
                     else 'B' if prob >= 0.5 else 'C' if prob >= 0.35 else 'D')
            await conn.execute("""
                INSERT INTO placement_predictions
                  (tenant_id,candidate_id,requisition_id,placement_prob,
                   offer_drop_prob,predicted_grade,model_version)
                VALUES ($1,$2,$3,$4,$5,$6,$7)
                ON CONFLICT (tenant_id,candidate_id,requisition_id) DO UPDATE SET
                  placement_prob=EXCLUDED.placement_prob,
                  predicted_grade=EXCLUDED.predicted_grade,
                  predicted_at=now()
            """, actor.tenant_id, cand["id"], body.requisition_id,
                 prob, drop_prob, grade,
                 "v1-logistic" if (model and scaler) else "v1-rule")
            results.append({"candidate_id": str(cand["id"]), "placement_prob": prob, "grade": grade})

    results.sort(key=lambda x: x["placement_prob"], reverse=True)
    return {"total": len(results), "model_used": "logistic" if model else "rule_based",
            "top": results[:20]}


@router.get("")
async def list_predictions(actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT pp.*, ca.full_name
            FROM placement_predictions pp
            JOIN candidates ca ON ca.id=pp.candidate_id
            WHERE pp.tenant_id=$1
            ORDER BY pp.placement_prob DESC
        """, actor.tenant_id)
    return [dict(r) for r in rows]

@router.patch("/{pred_id}/outcome")
async def record_outcome(pred_id: str, body: OutcomeUpdate, actor: Actor=Depends(get_actor)):
    if body.actual_outcome not in ('placed','not_placed','offer_drop'):
        raise HTTPException(400, "outcome must be placed|not_placed|offer_drop")
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            UPDATE placement_predictions SET actual_outcome=$1,outcome_recorded_at=now()
            WHERE id=$2 RETURNING *
        """, body.actual_outcome, pred_id)
        if not row:
            raise HTTPException(404, "Not found")
    _model_cache.pop(actor.tenant_id, None)  # invalidate cache
    return dict(row)

@router.get("/stats")
async def prediction_stats(actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            SELECT COUNT(*) AS total_predictions,
                   ROUND(AVG(placement_prob)*100,1) AS avg_placement_prob,
                   COUNT(*) FILTER (WHERE predicted_grade IN ('A+','A')) AS high_confidence,
                   COUNT(*) FILTER (WHERE offer_drop_prob > 0.3) AS offer_drop_risk,
                   COUNT(*) FILTER (WHERE actual_outcome IS NOT NULL) AS outcomes_recorded
            FROM placement_predictions WHERE tenant_id=$1
        """, actor.tenant_id)
    return dict(row)
