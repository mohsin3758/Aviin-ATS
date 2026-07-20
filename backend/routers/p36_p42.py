import json
"""P36-P42: Advanced Reports, PF/ESI/TDS, Bulk Import,
Client Health Score, Revenue Forecast, Pipeline Rules."""
import csv, io, json
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Response
from pydantic import BaseModel
import db
from deps import Actor, get_actor

# ── P36: Advanced Reports ─────────────────────────────────────
reports_router = APIRouter(prefix="/reports", tags=["reports"])

@reports_router.get("/monthly-billing")
async def monthly_billing(year: Optional[int]=None, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT month, year, placements, estimated_revenue,
                   candidates_placed, roles_filled
            FROM v_monthly_billing
            WHERE tenant_id=$1 AND ($2::int IS NULL OR year=$2)
            ORDER BY year DESC, month DESC LIMIT 24
        """, actor.tenant_id, year)
    return [dict(r) for r in rows]

@reports_router.get("/pipeline-velocity")
async def pipeline_velocity(actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT stage, count, avg_days_in_stage, stale_count
            FROM v_pipeline_velocity WHERE tenant_id=$1
            ORDER BY count DESC
        """, actor.tenant_id)
    return [dict(r) for r in rows]

@reports_router.get("/recruiter-performance")
async def recruiter_performance(month: Optional[int]=None, year: Optional[int]=None,
                                  actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT
                u.full_name AS recruiter,
                u.email,
                COUNT(DISTINCT a.id) AS total_submissions,
                COUNT(DISTINCT a.id) FILTER (WHERE a.stage='interview') AS interviews,
                COUNT(DISTINCT a.id) FILTER (WHERE a.stage='offer') AS offers,
                COUNT(DISTINCT a.id) FILTER (WHERE a.stage='hired') AS placements,
                ROUND(COUNT(DISTINCT a.id) FILTER (WHERE a.stage='hired')::numeric /
                      NULLIF(COUNT(DISTINCT a.id),0)*100,1) AS conversion_rate,
                COALESCE(k.total_score,0) AS kpi_score,
                COALESCE(k.grade,'—') AS grade,
                COALESCE(k.calculated_incentive,0) AS incentive
            FROM users u
            LEFT JOIN applications a ON a.assigned_recruiter_id=u.id AND a.tenant_id=u.tenant_id
                AND ($1::int IS NULL OR EXTRACT(MONTH FROM a.created_at)=$1)
                AND ($2::int IS NULL OR EXTRACT(YEAR FROM a.created_at)=$2)
            LEFT JOIN recruiter_kpi_scores k ON k.user_id=u.id AND k.tenant_id=u.tenant_id
                AND ($1::int IS NULL OR k.period_month=$1)
                AND ($2::int IS NULL OR k.period_year=$2)
            WHERE u.tenant_id=$3
            GROUP BY u.id, u.full_name, u.email, k.total_score, k.grade, k.calculated_incentive
            ORDER BY placements DESC, conversion_rate DESC
        """, month, year, actor.tenant_id)
    return [dict(r) for r in rows]

@reports_router.get("/client-revenue")
async def client_revenue(actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT
                COALESCE(ap.client_name,'Unknown') AS client,
                COUNT(DISTINCT ap.id) AS months_active,
                COALESCE(SUM(ap.gross_revenue),0) AS total_revenue,
                COALESCE(SUM(ap.contribution_margin),0) AS total_cm,
                ROUND(AVG(ap.cm_pct),1) AS avg_margin,
                COALESCE(SUM(ap.delivery_pool),0) AS delivery_pool,
                0 AS open_positions
            FROM account_pl ap
            WHERE ap.tenant_id=$1
            GROUP BY ap.client_name
            ORDER BY total_revenue DESC
        """, actor.tenant_id)
    return [dict(r) for r in rows]

@reports_router.get("/dashboard-summary")
async def dashboard_summary(actor: Actor=Depends(get_actor)):
    """Single call for executive reporting dashboard."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        pipeline = await conn.fetchrow("""
            SELECT
                COUNT(*) FILTER (WHERE status='open') AS open_reqs,
                COUNT(*) AS total_reqs,
                (SELECT COUNT(*) FROM applications WHERE tenant_id=$1) AS total_apps,
                (SELECT COUNT(*) FROM placements WHERE tenant_id=$1) AS total_placements,
                (SELECT COUNT(*) FROM candidates WHERE tenant_id=$1) AS total_candidates
            FROM requisitions WHERE tenant_id=$1
        """, actor.tenant_id)
        kpi = await conn.fetchrow("""
            SELECT ROUND(AVG(total_score),1) AS avg_score,
                   COALESCE(SUM(calculated_incentive),0) AS total_incentive
            FROM recruiter_kpi_scores WHERE tenant_id=$1
        """, actor.tenant_id)
        collection = await conn.fetchrow("""
            SELECT COALESCE(SUM(invoice_amount),0) AS total_billed,
                   COALESCE(SUM(collected_amount),0) AS collected,
                   COALESCE(SUM(outstanding_amount),0) AS outstanding
            FROM collection_records WHERE tenant_id=$1
        """, actor.tenant_id)
    return {
        "pipeline": dict(pipeline),
        "kpi": dict(kpi),
        "collections": dict(collection),
    }

# ── P37: PF/ESI/TDS Compliance ────────────────────────────────
compliance_router = APIRouter(prefix="/compliance", tags=["compliance"])

PF_CEILING = 15000   # PF calculated on max ₹15,000 basic
PF_RATE    = 0.12    # 12% employee + 12% employer
ESI_CEILING = 21000  # ESI applies if gross <= ₹21,000
ESI_EMP_RATE = 0.0075   # 0.75% employee
ESI_EMP_RATE_EMPLOYER = 0.0325  # 3.25% employer

def compute_compliance(gross: float, basic_pct: float=0.4):
    """Zero-token rule-based statutory computation."""
    basic = round(gross * basic_pct, 2)
    pf_base = min(basic, PF_CEILING)
    pf_emp = round(pf_base * PF_RATE, 2)
    pf_er  = round(pf_base * PF_RATE, 2)
    # ESI
    if gross <= ESI_CEILING:
        esi_emp = round(gross * ESI_EMP_RATE, 2)
        esi_er  = round(gross * ESI_EMP_RATE_EMPLOYER, 2)
    else:
        esi_emp = esi_er = 0
    # Professional Tax (Maharashtra slab as default)
    if gross >= 20000:
        pt = 200
    elif gross >= 10000:
        pt = 175
    elif gross >= 7500:
        pt = 150
    elif gross >= 5000:
        pt = 100
    else:
        pt = 0
    # TDS: simple 10% for contract workers above ₹30k/month
    tds = round(gross * 0.10, 2) if gross > 30000 else 0
    net = round(gross - pf_emp - esi_emp - pt - tds, 2)
    return {
        "gross_salary": gross,
        "basic_salary": basic,
        "pf_employee": pf_emp,
        "pf_employer": pf_er,
        "esi_employee": esi_emp,
        "esi_employer": esi_er,
        "professional_tax": pt,
        "tds_amount": tds,
        "net_take_home": net,
        "total_cost_to_company": round(gross + pf_er + esi_er, 2),
    }

@compliance_router.get("/calculate")
async def calculate_compliance(gross_salary: float, basic_pct: float=0.4,
                                actor: Actor=Depends(get_actor)):
    """Instant PF/ESI/TDS calculation — zero-token rule engine."""
    return compute_compliance(gross_salary, basic_pct)

@compliance_router.post("/bulk-compute")
async def bulk_compute(month: int, year: int, actor: Actor=Depends(get_actor)):
    """Compute compliance for all active placements in a month."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        placements = await conn.fetch("""
            SELECT p.id, p.candidate_id, p.bill_rate,
                   c.full_name AS candidate_name
            FROM placements p
            JOIN candidates c ON c.id=p.candidate_id
            WHERE p.tenant_id=$1 AND p.status IN ('active','completed')
        """, actor.tenant_id)
        results = []
        for pl in placements:
            gross = float(pl.get('bill_rate') or pl.get('rate') or 0)
            comp = compute_compliance(gross)
            await conn.execute("""
                INSERT INTO compliance_records
                  (tenant_id,candidate_id,placement_id,month,year,
                   gross_salary,basic_salary,pf_employee,pf_employer,
                   esi_employee,esi_employer,professional_tax,tds_amount,net_take_home)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
                ON CONFLICT (tenant_id,candidate_id,month,year) DO UPDATE SET
                  gross_salary=EXCLUDED.gross_salary,
                  pf_employee=EXCLUDED.pf_employee,
                  tds_amount=EXCLUDED.tds_amount,
                  net_take_home=EXCLUDED.net_take_home
            """, actor.tenant_id, pl['candidate_id'], pl['id'],
                 month, year, comp['gross_salary'], comp['basic_salary'],
                 comp['pf_employee'], comp['pf_employer'],
                 comp['esi_employee'], comp['esi_employer'],
                 comp['professional_tax'], comp['tds_amount'], comp['net_take_home'])
            results.append({"candidate": pl['candidate_name'], **comp})
    return {"month": month, "year": year, "computed": len(results), "records": results}

@compliance_router.get("")
async def list_compliance(month: Optional[int]=None, year: Optional[int]=None,
                           actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT cr.*, c.full_name AS candidate_name
            FROM compliance_records cr
            JOIN candidates c ON c.id=cr.candidate_id
            WHERE cr.tenant_id=$1
              AND ($2::int IS NULL OR cr.month=$2)
              AND ($3::int IS NULL OR cr.year=$3)
            ORDER BY cr.year DESC, cr.month DESC, c.full_name
        """, actor.tenant_id, month, year)
    return [dict(r) for r in rows]

@compliance_router.get("/summary")
async def compliance_summary(month: Optional[int]=None, year: Optional[int]=None,
                              actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            SELECT
                COUNT(*) AS employees,
                COALESCE(SUM(gross_salary),0) AS total_gross,
                COALESCE(SUM(pf_employee+pf_employer),0) AS total_pf,
                COALESCE(SUM(esi_employee+esi_employer),0) AS total_esi,
                COALESCE(SUM(tds_amount),0) AS total_tds,
                COALESCE(SUM(net_take_home),0) AS total_net,
                COALESCE(SUM(pf_employer+esi_employer),0) AS employer_burden
            FROM compliance_records
            WHERE tenant_id=$1
              AND ($2::int IS NULL OR month=$2)
              AND ($3::int IS NULL OR year=$3)
        """, actor.tenant_id, month, year)
    return dict(row)

# P38 moved to import_router.py
import_router = None  # placeholder

# ── P39: Client Health Score ──────────────────────────────────
health_router = APIRouter(prefix="/client-health", tags=["client-health"])

@health_router.post("/compute")
async def compute_health_scores(actor: Actor=Depends(get_actor)):
    """Compute health scores for all clients — zero-token rule engine."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        clients = await conn.fetch("""
            SELECT DISTINCT COALESCE(client_name,'Unknown') AS client_name
            FROM account_pl WHERE tenant_id=$1 AND client_name IS NOT NULL
            UNION
            SELECT DISTINCT COALESCE(client_name,'Unknown') AS client_name
            FROM collection_records WHERE tenant_id=$1 AND client_name IS NOT NULL
        """, actor.tenant_id)
        results = []
        for row in clients:
            client = row['client_name']
            try:
                rev_data = await conn.fetchrow("""
                    SELECT COALESCE(SUM(gross_revenue),0) AS total_rev,
                           COALESCE(AVG(cm_pct),0) AS avg_margin,
                           COUNT(*) AS months
                    FROM account_pl WHERE tenant_id=$1 AND client_name=$2
                """, actor.tenant_id, client)
                coll_data = await conn.fetchrow("""
                    SELECT COALESCE(SUM(invoice_amount),0) AS total_billed,
                           COALESCE(SUM(collected_amount),0) AS collected,
                           COUNT(*) FILTER (WHERE status='overdue') AS overdue_count
                    FROM collection_records WHERE tenant_id=$1 AND client_name=$2
                """, actor.tenant_id, client)
                fill_data = await conn.fetchrow("""
                    SELECT COUNT(*) AS total,
                           COUNT(*) FILTER (WHERE status='filled') AS filled
                    FROM requisitions WHERE tenant_id=$1
                """, actor.tenant_id)  # no client filter - requisitions has no client_name
                rev_score   = min(100, float(rev_data['total_rev'] or 0) / 10000)
                margin_score= min(100, float(rev_data['avg_margin'] or 0) * 3)
                coll_rate   = (float(coll_data['collected'] or 0) / max(float(coll_data['total_billed'] or 1),1)) * 100
                coll_score  = min(100, coll_rate)
                overdue_pen = min(50, float(coll_data['overdue_count'] or 0) * 10)
                fill_rate   = (float(fill_data['filled'] or 0) / max(float(fill_data['total'] or 1),1)) * 100
                fill_score  = min(100, fill_rate)
                growth_score= min(100, float(rev_data['months'] or 0) * 10)
                health = round(rev_score*0.25 + coll_score*0.30 + fill_score*0.20 + margin_score*0.15 + growth_score*0.10 - overdue_pen*0.5, 2)
                health = max(0, min(100, health))
                grade = ('A+' if health>=85 else 'A' if health>=75 else 'B' if health>=65 else 'C' if health>=50 else 'D')
                risk = ('low' if health>=70 else 'medium' if health>=50 else 'high' if health>=30 else 'critical')
                insights = []
                if coll_rate < 80: insights.append(f"Collection rate low ({coll_rate:.0f}%)")
                if float(coll_data['overdue_count'] or 0) > 2: insights.append(f"{int(coll_data['overdue_count'])} overdue invoices")
                await conn.execute("""
                    INSERT INTO client_health_scores
                      (tenant_id,client_name,revenue_score,collection_score,
                       fill_rate_score,growth_score,relationship_score,
                       health_score,health_grade,risk_level,insights)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
                    ON CONFLICT (tenant_id,client_name,score_date) DO UPDATE SET
                      health_score=EXCLUDED.health_score, health_grade=EXCLUDED.health_grade,
                      risk_level=EXCLUDED.risk_level, insights=EXCLUDED.insights
                """, actor.tenant_id, client,
                     round(rev_score,2), round(coll_score,2), round(fill_score,2),
                     round(growth_score,2), 75.0, health, grade, risk, json.dumps(insights))
                results.append({"client": client, "health_score": health, "grade": grade})
            except Exception as e:
                results.append({"client": client, "health_score": 0, "error": str(e)[:50]})
    return {"computed": len(results), "clients": sorted(results, key=lambda x:-x['health_score'])}

@health_router.get("")
async def list_health_scores(actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT DISTINCT ON (client_name) *
            FROM client_health_scores WHERE tenant_id=$1
            ORDER BY client_name, score_date DESC
        """, actor.tenant_id)
    out = []
    for r in rows:
        d = dict(r)
        if isinstance(d.get("insights"), str):
            d["insights"] = json.loads(d["insights"])
        out.append(d)
    return out

# ── P40: Revenue Forecast ─────────────────────────────────────
forecast_router = APIRouter(prefix="/revenue-forecast", tags=["forecast"])

@forecast_router.get("")
async def revenue_forecast(months_ahead: int=6, actor: Actor=Depends(get_actor)):
    """Linear trend revenue forecast — zero-token, local computation."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        historical = await conn.fetch("""
            SELECT EXTRACT(MONTH FROM p.start_date)::int AS month,
                   EXTRACT(YEAR FROM p.start_date)::int AS year,
                   COUNT(*) AS placements,
                   COALESCE(SUM(p.bill_rate * 30), 0) AS revenue
            FROM placements p
            WHERE p.tenant_id=$1 AND p.start_date IS NOT NULL
            GROUP BY month, year ORDER BY year, month
        """, actor.tenant_id)

    hist_list = [dict(r) for r in historical]
    if len(hist_list) < 2:
        return {"historical": hist_list, "forecast": [],
                "trend": "insufficient_data",
                "monthly_growth": 0,
                "model": "none",
                "message": "Need placement data for ML forecast. Add placements to enable revenue forecasting."}

    # Simple linear regression on revenue
    n = len(hist_list)
    revenues = [float(r['revenue']) for r in hist_list]
    x = list(range(n))
    x_mean = sum(x) / n
    y_mean = sum(revenues) / n
    slope = sum((x[i]-x_mean)*(revenues[i]-y_mean) for i in range(n)) /             max(sum((xi-x_mean)**2 for xi in x), 1)
    intercept = y_mean - slope * x_mean

    # Generate forecast
    from datetime import date
    import calendar
    last = hist_list[-1]
    forecast = []
    cur_month = last['month']
    cur_year  = last['year']
    for i in range(1, months_ahead+1):
        cur_month += 1
        if cur_month > 12:
            cur_month = 1
            cur_year += 1
        predicted = max(0, round(intercept + slope * (n + i - 1), 2))
        confidence = max(50, min(95, 90 - i * 5))
        forecast.append({
            "month": cur_month, "year": cur_year,
            "predicted_revenue": predicted,
            "confidence_pct": confidence,
        })

    return {
        "historical": hist_list,
        "forecast": forecast,
        "trend": "upward" if slope > 0 else "downward",
        "monthly_growth": round(slope, 2),
        "model": "linear_regression",
    }

# ── P41: Pipeline Rules ───────────────────────────────────────
rules_router = APIRouter(prefix="/pipeline-rules", tags=["pipeline-rules"])

@rules_router.get("")
async def list_rules(actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            "SELECT * FROM pipeline_rules WHERE tenant_id=$1 ORDER BY name",
            actor.tenant_id)
    return [dict(r) for r in rows]

@rules_router.post("")
async def create_rule(body: dict, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            INSERT INTO pipeline_rules
              (tenant_id,name,trigger_event,condition_field,condition_op,
               condition_value,action_type,action_data)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
            ON CONFLICT (tenant_id,name) DO UPDATE SET
              is_active=EXCLUDED.is_active, action_data=EXCLUDED.action_data
            RETURNING *
        """, actor.tenant_id, body['name'], body['trigger_event'],
             body.get('condition_field'), body.get('condition_op'),
             body.get('condition_value'), body['action_type'],
             json.dumps(body.get('action_data',{})))
    return dict(row)

@rules_router.patch("/{rule_id}/toggle")
async def toggle_rule(rule_id: str, actor: Actor=Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            UPDATE pipeline_rules SET is_active=NOT is_active WHERE id=$1 AND tenant_id=$2
            RETURNING *
        """, rule_id, actor.tenant_id)
        if not row: raise HTTPException(404,"Not found")
    return dict(row)
