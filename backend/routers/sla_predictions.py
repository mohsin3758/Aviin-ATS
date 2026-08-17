"""Gap-audit item 07: predictive time-to-fill / SLA risk forecasting.

v_sla_dashboard (existing, sql/*) is purely reactive - current elapsed days
compared against a static target. This is genuinely predictive: trains a
regression model on this tenant's own historical closed requisitions to
forecast expected time-to-fill for currently OPEN requisitions, same
lazy-cache-per-tenant pattern as predictions.py (P21's placement-probability
model). Zero external LLM - local sklearn only (HARD RULE #1).

The `placements` table linkage is too sparse to train on directly (1 row
tenant-wide at the time this was built) - instead uses the first
placed/offer_accepted application per requisition as a "filled_at" proxy,
which is far more populated. Falls back to the tenant's own historical
median fill time (still genuinely data-driven, just not a fitted model)
when there isn't enough data for a real regression, and honestly reports
"insufficient data" rather than fabricating a number when there's no
historical signal at all yet.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends

import db
from deps import Actor, get_actor

router = APIRouter(prefix="/sla-predictions", tags=["sla-predictions"])

MIN_TRAINING_ROWS = 5
_model_cache: dict = {}


def _encode_priority(p: Optional[str]) -> float:
    return {"critical": 3, "high": 2, "medium": 1, "low": 0}.get((p or "medium").lower(), 1)


def _build_features(req: dict) -> list[float]:
    return [
        float(len(req.get("skills_required") or [])),
        float(req.get("positions_count") or 1),
        _encode_priority(req.get("priority")),
        1.0 if (req.get("work_mode") or "") == "remote" else 0.0,
        float(req.get("experience_min") or 0),
        float(req.get("experience_max") or 0),
    ]


async def _training_rows(conn, tenant_id: str):
    return await conn.fetch(
        """SELECT r.id, r.skills_required, r.positions_count, r.priority, r.work_mode,
                  r.experience_min, r.experience_max, r.created_at,
                  MIN(a.updated_at) AS filled_at
           FROM requisitions r
           JOIN applications a ON a.requisition_id = r.id AND a.tenant_id = r.tenant_id
           JOIN candidates c ON c.id = a.candidate_id
           WHERE r.tenant_id = $1 AND a.stage IN ('placed', 'offer_accepted')
             AND r.is_active IS NOT FALSE AND c.is_active IS NOT FALSE
           GROUP BY r.id""",
        tenant_id,
    )


def _fill_days(row: dict) -> Optional[float]:
    if not row.get("filled_at") or not row.get("created_at"):
        return None
    d = (row["filled_at"] - row["created_at"]).total_seconds() / 86400
    return d if d > 0 else None


def _get_model(tenant_id: str, rows: list):
    try:
        from sklearn.linear_model import LinearRegression
        from sklearn.preprocessing import StandardScaler
        import numpy as np
    except ImportError:
        return None, None, "sklearn not available"

    X, y = [], []
    for r in rows:
        r = dict(r)
        days = _fill_days(r)
        if days is None:
            continue
        X.append(_build_features(r))
        y.append(days)

    if len(X) < MIN_TRAINING_ROWS:
        return None, None, f"insufficient training data (have {len(X)} filled requisitions, need >= {MIN_TRAINING_ROWS})"

    X = np.array(X, dtype=float)
    y = np.array(y, dtype=float)
    scaler = StandardScaler()
    Xs = scaler.fit_transform(X)
    model = LinearRegression()
    model.fit(Xs, y)
    _model_cache[tenant_id] = (model, scaler)
    return model, scaler, None


def _fallback_median(rows: list) -> Optional[float]:
    days = sorted(d for d in (_fill_days(dict(r)) for r in rows) if d is not None)
    if not days:
        return None
    n = len(days)
    return days[n // 2] if n % 2 else (days[n // 2 - 1] + days[n // 2]) / 2


@router.get("/stats")
async def stats(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await _training_rows(conn, actor.tenant_id)
    model, _, err = _get_model(actor.tenant_id, rows)
    fallback = _fallback_median(rows)
    return {
        "historical_requisitions_available": len(rows),
        "model_trained": model is not None,
        "model_status": err or "trained",
        "fallback_median_days": round(fallback, 1) if fallback is not None else None,
    }


@router.get("/forecast")
async def forecast(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        training = await _training_rows(conn, actor.tenant_id)
        open_reqs = await conn.fetch(
            """SELECT id, title, skills_required, positions_count, priority, work_mode,
                      experience_min, experience_max, created_at
               FROM requisitions WHERE tenant_id=$1 AND status='open' AND is_active IS NOT FALSE""",
            actor.tenant_id,
        )

    model, scaler, err = _get_model(actor.tenant_id, training)
    fallback_days = _fallback_median(training)
    now = datetime.now(timezone.utc)

    results = []
    for r in open_reqs:
        r = dict(r)
        elapsed_days = (now - r["created_at"]).total_seconds() / 86400
        predicted_days, method = None, "none"

        if model is not None:
            import numpy as np
            feat = np.array([_build_features(r)])
            predicted_days = max(float(model.predict(scaler.transform(feat))[0]), 1.0)
            method = "regression"
        elif fallback_days is not None:
            predicted_days = fallback_days
            method = "historical_median"

        risk, projected_close = None, None
        if predicted_days is not None:
            ratio = elapsed_days / predicted_days
            risk = "overdue" if ratio >= 1.0 else "at_risk" if ratio >= 0.8 else "watch" if ratio >= 0.5 else "on_track"
            projected_close = (r["created_at"] + timedelta(days=predicted_days)).isoformat()

        results.append({
            "requisition_id": str(r["id"]),
            "title": r["title"],
            "elapsed_days": round(elapsed_days, 1),
            "predicted_fill_days": round(predicted_days, 1) if predicted_days is not None else None,
            "projected_close_date": projected_close,
            "risk_level": risk,
            "prediction_method": method,
        })

    order = {"overdue": 0, "at_risk": 1, "watch": 2, "on_track": 3, None: 4}
    results.sort(key=lambda x: order[x["risk_level"]])
    return {"model_status": err or "trained", "training_rows": len(training), "forecasts": results}
