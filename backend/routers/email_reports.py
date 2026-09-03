"""
Enterprise Email Reporting & Analytics — built 2026-09-03 to close the
"zero reporting/analytics layer" gap found in the same-day audit against
the "Enterprise Email Management, Tracking & Reporting" spec: client-wise
reports, KAE-wise reports + ranking, a recruiter-only (internal-
communication) report, a daily/weekly/monthly/quarterly/yearly
performance trend, client engagement scoring, an Email SLA dashboard, an
Executive Email Dashboard, and CSV export.

Every real number here is computed from candidate_messages/email_threads
— the same tables the actual Conversations mailbox and the KAE-submission
tracking-sheet feature already write to. No second, parallel data store.

Business rule this reporting layer structurally respects, not just
displays: a recruiter can never accumulate client_id-linked messages (the
2026-09-03 RBAC fix in communications.py makes that impossible), so
"Recruiters should not appear in client email reports" falls out of the
underlying data automatically — the client-wise/KAE-wise reports don't
need a separate recruiter-exclusion filter layered on top.
"""
import csv
import io
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response

import db
from deps import Actor, get_actor, require_role_or_trusted_internal
from permissions import require_permission
from services import email_tracking

router = APIRouter(prefix="/email-reports", tags=["email-reports"])

_MGMT_ROLES = ("admin", "super_admin", "manager", "lead_recruiter", "kae", "kam")


def _period_bounds(date_from: Optional[str], date_to: Optional[str]):
    """Defaults to the last 30 days when no explicit range is given —
    matches this project's own established convention for every other
    date-range report in this codebase."""
    try:
        d_from = date.fromisoformat(date_from) if date_from else date.today() - timedelta(days=30)
    except Exception:
        d_from = date.today() - timedelta(days=30)
    try:
        d_to = date.fromisoformat(date_to) if date_to else date.today()
    except Exception:
        d_to = date.today()
    return d_from, d_to


# ── Client-wise report ───────────────────────────────────────────────────────

@router.get("/client-wise")
async def client_wise_report(
    date_from: Optional[str] = Query(None), date_to: Optional[str] = Query(None),
    client_id: Optional[str] = Query(None), kae_id: Optional[str] = Query(None),
    department: Optional[str] = Query(None),
    actor: Actor = Depends(require_permission("email_reports", "read")),
):
    d_from, d_to = _period_bounds(date_from, date_to)
    conditions = ["cm.tenant_id=$1", "cm.channel='email'", "cm.client_id IS NOT NULL",
                  "cm.is_deleted IS NOT TRUE", "cm.created_at::date BETWEEN $2 AND $3"]
    params = [actor.tenant_id, d_from, d_to]
    if client_id:
        params.append(client_id); conditions.append(f"cm.client_id=${len(params)}")
    if kae_id:
        params.append(kae_id); conditions.append(f"cm.sent_by=${len(params)}")
    if department:
        params.append(department); conditions.append(f"u.department=${len(params)}")
    where = " AND ".join(conditions)
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(f"""
            SELECT cm.client_id, cl.name AS client_name,
                   COUNT(*) AS emails_sent,
                   COUNT(*) FILTER (WHERE cm.bounced_at IS NULL) AS delivered,
                   COUNT(*) FILTER (WHERE cm.email_open_count > 0) AS opened,
                   COUNT(*) FILTER (WHERE cm.replied_at IS NOT NULL) AS replied,
                   ROUND(AVG(EXTRACT(EPOCH FROM (cm.replied_at - cm.created_at)) / 3600)
                         FILTER (WHERE cm.replied_at IS NOT NULL), 1) AS avg_response_hours
            FROM candidate_messages cm
            JOIN clients cl ON cl.id = cm.client_id AND cl.is_active IS NOT FALSE
            LEFT JOIN users u ON u.id = cm.sent_by
            WHERE {where}
            GROUP BY cm.client_id, cl.name
            ORDER BY emails_sent DESC""", *params)
        daily_trend = await conn.fetch(f"""
            SELECT cm.created_at::date AS day, COUNT(*) AS sent,
                   COUNT(*) FILTER (WHERE cm.email_open_count > 0) AS opened,
                   COUNT(*) FILTER (WHERE cm.replied_at IS NOT NULL) AS replied
            FROM candidate_messages cm LEFT JOIN users u ON u.id = cm.sent_by
            WHERE {where}
            GROUP BY day ORDER BY day""", *params)
    out = []
    for r in rows:
        d = dict(r)
        sent = d["emails_sent"] or 0
        d["open_rate_pct"] = round((d["opened"] or 0) / sent * 100, 1) if sent else 0.0
        d["reply_rate_pct"] = round((d["replied"] or 0) / sent * 100, 1) if sent else 0.0
        out.append(d)
    return {"clients": out, "daily_trend": [dict(r) for r in daily_trend],
            "period": {"from": str(d_from), "to": str(d_to)}}


# ── KAE-wise report + ranking ────────────────────────────────────────────────

@router.get("/kae-wise")
async def kae_wise_report(
    date_from: Optional[str] = Query(None), date_to: Optional[str] = Query(None),
    actor: Actor = Depends(require_permission("email_reports", "read")),
):
    d_from, d_to = _period_bounds(date_from, date_to)
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT u.id AS kae_id, u.full_name, u.role,
                   COUNT(*) FILTER (WHERE cm.direction='outbound') AS emails_sent,
                   COUNT(DISTINCT cm.client_id) FILTER (WHERE cm.client_id IS NOT NULL) AS clients_contacted,
                   COUNT(*) FILTER (WHERE cm.replied_at IS NOT NULL) AS client_replies,
                   -- Real, honest "follow-up" signal — a 2nd+ outbound email
                   -- in the same real thread (a genuine follow-up in an
                   -- existing conversation), not a guessed subject-text match.
                   COUNT(*) FILTER (
                       WHERE cm.thread_id IS NOT NULL AND EXISTS (
                           SELECT 1 FROM candidate_messages prior
                           WHERE prior.thread_id = cm.thread_id AND prior.direction='outbound'
                             AND prior.created_at < cm.created_at)
                   ) AS follow_ups_sent,
                   ROUND(AVG(EXTRACT(EPOCH FROM (cm.replied_at - cm.created_at)) / 3600)
                         FILTER (WHERE cm.replied_at IS NOT NULL), 1) AS avg_response_hours
            FROM candidate_messages cm
            JOIN users u ON u.id = cm.sent_by
            WHERE cm.tenant_id=$1 AND cm.channel='email' AND cm.client_id IS NOT NULL
              AND cm.is_deleted IS NOT TRUE AND cm.created_at::date BETWEEN $2 AND $3
            GROUP BY u.id, u.full_name, u.role
            ORDER BY emails_sent DESC""", actor.tenant_id, d_from, d_to)
    out = []
    for r in rows:
        d = dict(r)
        sent = d["emails_sent"] or 0
        d["response_rate_pct"] = round((d["client_replies"] or 0) / sent * 100, 1) if sent else 0.0
        out.append(d)
    ranked = sorted(out, key=lambda x: (-(x["response_rate_pct"]), -(x["emails_sent"] or 0)))
    for i, r in enumerate(ranked, 1):
        r["rank"] = i
    return {"kaes": ranked, "period": {"from": str(d_from), "to": str(d_to)}}


# ── Recruiter (internal-communication-only) report ──────────────────────────

@router.get("/recruiter")
async def recruiter_report(
    date_from: Optional[str] = Query(None), date_to: Optional[str] = Query(None),
    team_view: bool = Query(False),
    actor: Actor = Depends(get_actor),
):
    """Internal communication only — candidates and internal (KAE) users,
    never client contacts (the RBAC fix in communications.py makes that
    structurally impossible for a recruiter). Self-scoped by default;
    team_view only takes effect for a real management-class role."""
    d_from, d_to = _period_bounds(date_from, date_to)
    is_mgmt = actor.role in _MGMT_ROLES
    scope_team = team_view and is_mgmt
    own_cond = "" if scope_team else "AND cm.sent_by=$4"
    params = [actor.tenant_id, d_from, d_to] + ([] if scope_team else [actor.user_id])
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(f"""
            SELECT u.id AS recruiter_id, u.full_name,
                   COUNT(*) FILTER (WHERE cm.recipient_type='candidate' OR cm.candidate_id IS NOT NULL) AS to_candidates,
                   COUNT(*) FILTER (WHERE cm.direction='inbound') AS from_candidates,
                   COUNT(*) FILTER (WHERE cm.recipient_type='internal') AS to_kae,
                   COUNT(*) FILTER (WHERE cm.candidate_id IS NOT NULL AND cm.replied_at IS NOT NULL) AS candidate_replies,
                   COUNT(*) AS total_sent
            FROM candidate_messages cm JOIN users u ON u.id = cm.sent_by
            WHERE cm.tenant_id=$1 AND cm.channel='email' AND cm.client_id IS NULL
              AND cm.is_deleted IS NOT TRUE AND cm.created_at::date BETWEEN $2 AND $3 {own_cond}
            GROUP BY u.id, u.full_name
            ORDER BY total_sent DESC""", *params)
    out = []
    for r in rows:
        d = dict(r)
        cand_sent = (d["to_candidates"] or 0)
        d["candidate_response_rate_pct"] = round((d["candidate_replies"] or 0) / cand_sent * 100, 1) if cand_sent else 0.0
        out.append(d)
    return {"recruiters": out, "scope": "team" if scope_team else "personal",
            "period": {"from": str(d_from), "to": str(d_to)}}


# ── Performance trend (daily/weekly/monthly/quarterly/yearly) ──────────────

@router.get("/performance")
async def performance_trend(
    granularity: str = Query("daily", pattern="^(daily|weekly|monthly|quarterly|yearly)$"),
    date_from: Optional[str] = Query(None), date_to: Optional[str] = Query(None),
    actor: Actor = Depends(require_permission("email_reports", "read")),
):
    d_from, d_to = _period_bounds(date_from, date_to)
    bucket = {
        "daily": "day", "weekly": "week", "monthly": "month",
        "quarterly": "quarter", "yearly": "year",
    }[granularity]
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(f"""
            SELECT date_trunc('{bucket}', cm.created_at)::date AS period,
                   COUNT(*) FILTER (WHERE cm.direction='outbound') AS sent,
                   COUNT(*) FILTER (WHERE cm.direction='outbound' AND cm.bounced_at IS NULL) AS delivered,
                   COUNT(*) FILTER (WHERE cm.email_open_count > 0) AS opened,
                   COUNT(*) FILTER (WHERE cm.replied_at IS NOT NULL) AS replied
            FROM candidate_messages cm
            WHERE cm.tenant_id=$1 AND cm.channel='email' AND cm.is_deleted IS NOT TRUE
              AND cm.created_at::date BETWEEN $2 AND $3
            GROUP BY period ORDER BY period""", actor.tenant_id, d_from, d_to)
        return {"granularity": granularity, "trend": [dict(r) for r in rows],
                "period": {"from": str(d_from), "to": str(d_to)}}


# ── Client engagement scoring ────────────────────────────────────────────────

@router.get("/engagement")
async def list_engagement_scores(actor: Actor = Depends(require_permission("email_reports", "read"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT ces.*, cl.name AS client_name FROM client_engagement_scores ces
            JOIN clients cl ON cl.id = ces.client_id AND cl.is_active IS NOT FALSE
            WHERE ces.tenant_id=$1
            ORDER BY ces.period_end DESC, ces.engagement_score DESC
            LIMIT 200""", actor.tenant_id)
        return [dict(r) for r in rows]


@router.post("/engagement/compute")
async def compute_engagement_scores(
    date_from: Optional[str] = Query(None), date_to: Optional[str] = Query(None),
    actor: Actor = Depends(require_role_or_trusted_internal(*_MGMT_ROLES)),
):
    d_from, d_to = _period_bounds(date_from, date_to)
    async with db.tenant_conn(actor.tenant_id) as conn:
        results = await email_tracking.compute_client_engagement_scores(conn, actor.tenant_id, d_from, d_to)
    return {"computed": len(results), "clients": results}


# ── Email SLA dashboard ──────────────────────────────────────────────────────

@router.get("/sla")
async def email_sla_dashboard(actor: Actor = Depends(require_permission("email_reports", "read"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            "SELECT * FROM v_client_email_sla WHERE tenant_id=$1 ORDER BY avg_response_hours DESC NULLS LAST",
            actor.tenant_id)
        return [dict(r) for r in rows]


# ── Executive Email Dashboard ────────────────────────────────────────────────

@router.get("/executive")
async def executive_dashboard(actor: Actor = Depends(require_role_or_trusted_internal(*_MGMT_ROLES))):
    today = date.today()
    async with db.tenant_conn(actor.tenant_id) as conn:
        today_stats = await conn.fetchrow("""
            SELECT COUNT(*) FILTER (WHERE direction='outbound') AS sent_today,
                   COUNT(*) FILTER (WHERE email_open_count > 0 AND direction='outbound') AS opened_today,
                   COUNT(*) FILTER (WHERE replied_at::date = $2) AS replies_today
            FROM candidate_messages
            WHERE tenant_id=$1 AND channel='email' AND is_deleted IS NOT TRUE AND created_at::date=$2""",
            actor.tenant_id, today)
        pending_followups = await conn.fetchval(
            "SELECT COUNT(*) FROM recruiter_tasks WHERE tenant_id=$1 AND status IN ('pending','in_progress')",
            actor.tenant_id)
        rates_30d = await conn.fetchrow("""
            SELECT COUNT(*) AS sent,
                   COUNT(*) FILTER (WHERE email_open_count > 0) AS opened,
                   COUNT(*) FILTER (WHERE replied_at IS NOT NULL) AS replied
            FROM candidate_messages
            WHERE tenant_id=$1 AND direction='outbound' AND channel='email' AND is_deleted IS NOT TRUE
              AND created_at >= now() - INTERVAL '30 days'""", actor.tenant_id)
        sent30 = rates_30d["sent"] or 0
        active_clients = await conn.fetchval(
            "SELECT COUNT(*) FROM client_engagement_scores WHERE tenant_id=$1 AND engagement_level != 'inactive'",
            actor.tenant_id)
        inactive_clients = await conn.fetchval(
            "SELECT COUNT(*) FROM client_engagement_scores WHERE tenant_id=$1 AND engagement_level='inactive'",
            actor.tenant_id)
        top_responsive = await conn.fetch("""
            SELECT cl.name AS client_name, ces.engagement_score, ces.reply_rate
            FROM client_engagement_scores ces JOIN clients cl ON cl.id = ces.client_id AND cl.is_active IS NOT FALSE
            WHERE ces.tenant_id=$1 ORDER BY ces.reply_rate DESC NULLS LAST LIMIT 5""", actor.tenant_id)
        least_responsive = await conn.fetch("""
            SELECT cl.name AS client_name, ces.engagement_score, ces.reply_rate
            FROM client_engagement_scores ces JOIN clients cl ON cl.id = ces.client_id AND cl.is_active IS NOT FALSE
            WHERE ces.tenant_id=$1 ORDER BY ces.reply_rate ASC NULLS LAST LIMIT 5""", actor.tenant_id)
        top_kae = await conn.fetch("""
            SELECT u.full_name, COUNT(*) AS emails_sent
            FROM candidate_messages cm JOIN users u ON u.id=cm.sent_by AND u.is_active IS NOT FALSE
            WHERE cm.tenant_id=$1 AND cm.client_id IS NOT NULL AND cm.channel='email'
              AND cm.is_deleted IS NOT TRUE AND cm.created_at >= now() - INTERVAL '30 days'
            GROUP BY u.full_name ORDER BY emails_sent DESC LIMIT 5""", actor.tenant_id)
        pending_client_responses = await conn.fetch("""
            SELECT cl.name AS client_name, cm.subject, cm.created_at,
                   ROUND(EXTRACT(EPOCH FROM (now() - cm.created_at)) / 3600, 1) AS hours_pending
            FROM candidate_messages cm JOIN clients cl ON cl.id=cm.client_id AND cl.is_active IS NOT FALSE
            WHERE cm.tenant_id=$1 AND cm.direction='outbound' AND cm.replied_at IS NULL
              AND cm.channel='email' AND cm.is_deleted IS NOT TRUE
            ORDER BY cm.created_at ASC LIMIT 10""", actor.tenant_id)
    return {
        "emails_sent_today": today_stats["sent_today"] or 0,
        "emails_opened_today": today_stats["opened_today"] or 0,
        "client_replies_today": today_stats["replies_today"] or 0,
        "pending_followups": pending_followups or 0,
        "open_rate_pct": round((rates_30d["opened"] or 0) / sent30 * 100, 1) if sent30 else 0.0,
        "reply_rate_pct": round((rates_30d["replied"] or 0) / sent30 * 100, 1) if sent30 else 0.0,
        "active_clients": active_clients or 0,
        "inactive_clients": inactive_clients or 0,
        "top_responsive_clients": [dict(r) for r in top_responsive],
        "least_responsive_clients": [dict(r) for r in least_responsive],
        "top_kae_by_activity": [dict(r) for r in top_kae],
        "pending_client_responses": [dict(r) for r in pending_client_responses],
    }


# ── Scheduled report config ──────────────────────────────────────────────────

@router.get("/schedule-config")
async def get_schedule_config(actor: Actor = Depends(require_role_or_trusted_internal(*_MGMT_ROLES))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT * FROM email_report_schedule_config WHERE tenant_id=$1", actor.tenant_id)
        if not row:
            row = await conn.fetchrow(
                """INSERT INTO email_report_schedule_config (tenant_id) VALUES ($1)
                   ON CONFLICT (tenant_id) DO UPDATE SET tenant_id=EXCLUDED.tenant_id
                   RETURNING *""", actor.tenant_id)
        return dict(row)


class ScheduleConfigBody(dict):
    pass


@router.put("/schedule-config")
async def put_schedule_config(body: dict, actor: Actor = Depends(require_role_or_trusted_internal(*_MGMT_ROLES))):
    emails = [e.strip() for e in (body.get("recipient_emails") or []) if e.strip()]
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """INSERT INTO email_report_schedule_config
                 (tenant_id, daily_enabled, weekly_enabled, monthly_enabled, recipient_emails, updated_by)
               VALUES ($1,$2,$3,$4,$5,$6)
               ON CONFLICT (tenant_id) DO UPDATE SET
                 daily_enabled=EXCLUDED.daily_enabled, weekly_enabled=EXCLUDED.weekly_enabled,
                 monthly_enabled=EXCLUDED.monthly_enabled, recipient_emails=EXCLUDED.recipient_emails,
                 updated_at=now(), updated_by=EXCLUDED.updated_by
               RETURNING *""",
            actor.tenant_id, bool(body.get("daily_enabled")), bool(body.get("weekly_enabled")),
            bool(body.get("monthly_enabled")), emails, actor.user_id)
        return dict(row)


# ── Export (CSV/Excel/PDF) ───────────────────────────────────────────────────

def _rows_to_csv(rows: list, fields: list) -> str:
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({k: (str(v) if v is not None else "") for k, v in row.items() if k in fields})
    return "﻿" + output.getvalue()  # UTF-8 BOM — Excel-on-Windows convention already established in this codebase


@router.get("/export")
async def export_report(
    report: str = Query(..., pattern="^(client_wise|kae_wise|recruiter|sla|engagement)$"),
    fmt: str = Query("csv", pattern="^(csv|xlsx)$"),
    date_from: Optional[str] = Query(None), date_to: Optional[str] = Query(None),
    actor: Actor = Depends(require_permission("email_reports", "read")),
):
    d_from, d_to = _period_bounds(date_from, date_to)
    async with db.tenant_conn(actor.tenant_id) as conn:
        if report == "client_wise":
            rows = await conn.fetch("""
                SELECT cl.name AS client_name, COUNT(*) AS emails_sent,
                       COUNT(*) FILTER (WHERE cm.email_open_count > 0) AS opened,
                       COUNT(*) FILTER (WHERE cm.replied_at IS NOT NULL) AS replied
                FROM candidate_messages cm JOIN clients cl ON cl.id=cm.client_id AND cl.is_active IS NOT FALSE
                WHERE cm.tenant_id=$1 AND cm.channel='email' AND cm.client_id IS NOT NULL
                  AND cm.is_deleted IS NOT TRUE AND cm.created_at::date BETWEEN $2 AND $3
                GROUP BY cl.name ORDER BY emails_sent DESC""", actor.tenant_id, d_from, d_to)
            fields = ["client_name", "emails_sent", "opened", "replied"]
        elif report == "kae_wise":
            rows = await conn.fetch("""
                SELECT u.full_name AS kae_name, COUNT(*) AS emails_sent,
                       COUNT(*) FILTER (WHERE cm.replied_at IS NOT NULL) AS client_replies
                FROM candidate_messages cm JOIN users u ON u.id=cm.sent_by
                WHERE cm.tenant_id=$1 AND cm.channel='email' AND cm.client_id IS NOT NULL
                  AND cm.is_deleted IS NOT TRUE AND cm.created_at::date BETWEEN $2 AND $3
                GROUP BY u.full_name ORDER BY emails_sent DESC""", actor.tenant_id, d_from, d_to)
            fields = ["kae_name", "emails_sent", "client_replies"]
        elif report == "sla":
            rows = await conn.fetch(
                "SELECT client_name, emails_sent, avg_response_hours, fastest_response_hours, longest_pending_hours "
                "FROM v_client_email_sla WHERE tenant_id=$1", actor.tenant_id)
            fields = ["client_name", "emails_sent", "avg_response_hours", "fastest_response_hours", "longest_pending_hours"]
        elif report == "engagement":
            rows = await conn.fetch(
                """SELECT cl.name AS client_name, ces.engagement_score, ces.engagement_level,
                          ces.open_rate, ces.reply_rate
                   FROM client_engagement_scores ces JOIN clients cl ON cl.id=ces.client_id AND cl.is_active IS NOT FALSE
                   WHERE ces.tenant_id=$1 ORDER BY ces.engagement_score DESC""", actor.tenant_id)
            fields = ["client_name", "engagement_score", "engagement_level", "open_rate", "reply_rate"]
        else:  # recruiter
            rows = await conn.fetch("""
                SELECT u.full_name AS recruiter_name, COUNT(*) AS to_candidates
                FROM candidate_messages cm JOIN users u ON u.id=cm.sent_by
                WHERE cm.tenant_id=$1 AND cm.channel='email' AND cm.client_id IS NULL
                  AND cm.is_deleted IS NOT TRUE AND cm.created_at::date BETWEEN $2 AND $3
                GROUP BY u.full_name ORDER BY to_candidates DESC""", actor.tenant_id, d_from, d_to)
            fields = ["recruiter_name", "to_candidates"]
    data = [dict(r) for r in rows]
    if fmt == "xlsx":
        try:
            import openpyxl
        except ImportError:
            raise HTTPException(500, "Excel export is unavailable in this environment")
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = report[:31]
        ws.append(fields)
        for row in data:
            ws.append([row.get(f) for f in fields])
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        return Response(
            content=buf.read(),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{report}_report.xlsx"'},
        )
    csv_text = _rows_to_csv(data, fields)
    return Response(
        content=csv_text, media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{report}_report.csv"'},
    )
