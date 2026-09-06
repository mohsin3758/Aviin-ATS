"""Recruiter / Sender Tracking (2026-09-07).

Built for the user's "Sender-Based Recruiter Attribution" spec — the
Golden Rule is: candidate ownership, submission count, KPI, and recruiter
credit must always be assigned to the actual SENDER email address, never
the mailbox that merely received it. The real, correctness-fixing half of
that rule lives in resume_intake_service.py + candidate_ownership.py
(resolve_sender_identity, claim_ownership); this router is the reporting/
visibility half: a real, dedicated tab listing every recruiter/sender
(registered ATS users AND real "Temporary Sender Records" for internal
senders who haven't been created as ATS users yet) with a full Kanban-
stage funnel + Offers + Joinees, all attributed by sender-of-record —
never by applications.assigned_recruiter_id (a different concept: who's
currently doing the day-to-day WORK, not who originally SOURCED/SENT the
candidate).

Reuses candidate_ownership_history as the real, permanent, all-time
source of truth for "who has ever been a confirmed owner of a candidate"
— candidate_ownership itself only reflects TODAY's state (a 30-day lock
that can legitimately move to someone else), so an all-time submission
count is built from the append-only history table instead, matching this
project's own established "never derive a permanent report from a
mutable, expiring row" discipline.
"""
from fastapi import APIRouter, Depends, Query
from typing import Optional

import db
from deps import Actor
from permissions import require_permission
from routers.p28_p32 import to_csv
from fastapi.responses import Response

router = APIRouter(prefix="/recruiter-attribution", tags=["recruiter-attribution"])


def _date_filter(date_from: Optional[str], date_to: Optional[str], params: list, col: str = "h.created_at") -> str:
    clause = ""
    if date_from:
        params.append(date_from)
        clause += f" AND {col} >= ${len(params)}::date"
    if date_to:
        params.append(date_to)
        clause += f" AND {col} < (${len(params)}::date + interval '1 day')"
    return clause


@router.get("/unregistered-senders")
async def unregistered_senders(actor: Actor = Depends(require_permission("sender_tracking", "read"))):
    """Spec Scenario 2's real display requirement: every real
    @company-domain sender who has forwarded/sent at least one candidate
    but has no ATS user account yet — "Source Recruiter: Padmashree T,
    Source Email: padmashree.t@aviintech.com, Status: Unregistered ATS
    User". Auto-resolves away on its own the moment a matching user
    account is created (auto_map_unregistered_sender in
    candidate_ownership.py backfills recruiter_id, so this query — which
    only ever selects recruiter_id IS NULL rows — naturally stops
    returning that sender)."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT co.recruiter_email, co.recruiter_name,
                   COUNT(DISTINCT co.candidate_id) AS candidate_count,
                   MIN(co.ownership_started_at) AS first_seen_at,
                   MAX(co.updated_at) AS last_activity_at
            FROM candidate_ownership co
            WHERE co.tenant_id=$1 AND co.recruiter_id IS NULL
            GROUP BY co.recruiter_email, co.recruiter_name
            ORDER BY last_activity_at DESC
        """, actor.tenant_id)
    return [dict(r) for r in rows]


async def _sender_tracking_rows(conn, tenant_id: str, date_from, date_to):
    """Shared query core for both the JSON tab and the CSV export — one
    implementation, not two divergent copies."""
    # Real per-tenant stage list & order — never hardcoded (this
    # project's own established discipline: a tenant can rename/add/
    # remove pipeline stages, e.g. a custom l3_interview round, and a
    # hardcoded stage-key list has silently broken reporting elsewhere in
    # this codebase's history more than once).
    stage_rows = await conn.fetch(
        "SELECT stage_key, label FROM pipeline_stage_config WHERE tenant_id=$1 ORDER BY display_order",
        tenant_id)
    stage_order = [r["stage_key"] for r in stage_rows]
    stage_labels = {r["stage_key"]: r["label"] for r in stage_rows}

    id_params = [tenant_id]
    date_clause = _date_filter(date_from, date_to, id_params, col="h.created_at")

    # Every distinct sender identity that has ever been a real, confirmed
    # ('claimed') owner of at least one candidate, plus which candidates
    # each one has ever owned — all-time, from the append-only history,
    # not the mutable current-state table.
    identity_rows = await conn.fetch(f"""
        WITH claims AS (
            SELECT
              COALESCE(h.recruiter_id::text, 'email:' || lower(h.recruiter_email)) AS identity_key,
              h.recruiter_id, h.recruiter_email, h.recruiter_name, h.created_at, h.candidate_id
            FROM candidate_ownership_history h
            WHERE h.tenant_id=$1 AND h.action='claimed'{date_clause}
        ),
        latest AS (
            SELECT DISTINCT ON (identity_key) identity_key, recruiter_id, recruiter_email, recruiter_name
            FROM claims ORDER BY identity_key, created_at DESC
        )
        SELECT l.identity_key, l.recruiter_id, l.recruiter_email,
               COALESCE(u.full_name, l.recruiter_name) AS recruiter_name,
               (l.recruiter_id IS NOT NULL) AS is_registered,
               array_agg(DISTINCT c.candidate_id) AS candidate_ids
        FROM latest l
        JOIN claims c ON c.identity_key = l.identity_key
        LEFT JOIN users u ON u.id = l.recruiter_id
        GROUP BY l.identity_key, l.recruiter_id, l.recruiter_email, l.recruiter_name, u.full_name
    """, *id_params)

    results = []
    for row in identity_rows:
        candidate_ids = [str(cid) for cid in (row["candidate_ids"] or []) if cid]
        if not candidate_ids:
            continue
        # Per-stage counts (matches recruiter_dashboard.py's own /my-stats
        # dynamic GROUP BY stage convention, generalized across every
        # sender rather than just the logged-in self).
        stage_counts_rows = await conn.fetch(
            "SELECT stage, COUNT(*) AS cnt FROM applications "
            "WHERE tenant_id=$1 AND candidate_id = ANY($2::uuid[]) AND is_active IS NOT FALSE "
            "GROUP BY stage",
            tenant_id, candidate_ids)
        stage_counts = {r["stage"]: int(r["cnt"]) for r in stage_counts_rows}
        offers = await conn.fetchval(
            "SELECT COUNT(DISTINCT o.id) FROM offers o JOIN applications a ON a.id=o.application_id "
            "WHERE o.tenant_id=$1 AND a.candidate_id = ANY($2::uuid[])",
            tenant_id, candidate_ids)
        offers_accepted = await conn.fetchval(
            "SELECT COUNT(DISTINCT o.id) FROM offers o JOIN applications a ON a.id=o.application_id "
            "WHERE o.tenant_id=$1 AND a.candidate_id = ANY($2::uuid[]) AND o.status='accepted'",
            tenant_id, candidate_ids)
        joinees = await conn.fetchval(
            "SELECT COUNT(DISTINCT id) FROM placements WHERE tenant_id=$1 AND candidate_id = ANY($2::uuid[])",
            tenant_id, candidate_ids)
        results.append({
            "recruiter_id": str(row["recruiter_id"]) if row["recruiter_id"] else None,
            "recruiter_name": row["recruiter_name"],
            "recruiter_email": row["recruiter_email"],
            "is_registered": row["is_registered"],
            "status_label": "Active ATS User" if row["is_registered"] else "Unregistered ATS User",
            "total_candidates": len(candidate_ids),
            "stages": [{"key": k, "label": stage_labels.get(k, k), "count": stage_counts.get(k, 0)} for k in stage_order],
            "offers": int(offers or 0),
            "offers_accepted": int(offers_accepted or 0),
            "joinees": int(joinees or 0),
        })
    results.sort(key=lambda r: r["total_candidates"], reverse=True)
    return results


@router.get("/sender-tracking")
async def sender_tracking(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    actor: Actor = Depends(require_permission("sender_tracking", "read")),
):
    """The spec's "Recruiter / Sender Tracking" tab — every recruiter/
    sender (registered or Temporary Sender Record) with the full Kanban-
    stage funnel + Offers + Joinees, attributed by sender-of-record."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await _sender_tracking_rows(conn, actor.tenant_id, date_from, date_to)
    return {"senders": rows}


@router.get("/sender-tracking/export")
async def sender_tracking_export(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    actor: Actor = Depends(require_permission("sender_tracking", "export")),
):
    """CSV export for the Recruiter Submission Report requirement: Total
    Resumes Submitted, Internal Screening Cleared, Sent to Client, Client
    Interviews, Offers, Joinees — all attributed to the original sender
    email, matching the spec's Reporting Enhancement section exactly."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await _sender_tracking_rows(conn, actor.tenant_id, date_from, date_to)
    flat = []
    for r in rows:
        stage_map = {s["key"]: s["count"] for s in r["stages"]}
        screened = stage_map.get("screened", 0)
        client_submitted = sum(v for k, v in stage_map.items()
                                if k in ("client_submission", "submitted") or "submit" in k)
        interviews = sum(v for k, v in stage_map.items() if "interview" in k)
        flat.append({
            "Recruiter/Sender Name": r["recruiter_name"],
            "Sender Email": r["recruiter_email"],
            "Status": r["status_label"],
            "Total Resumes Submitted": r["total_candidates"],
            "Internal Screening Cleared": screened,
            "Sent to Client": client_submitted,
            "Client Interviews": interviews,
            "Offers": r["offers"],
            "Offers Accepted": r["offers_accepted"],
            "Joinees": r["joinees"],
        })
    fields = ["Recruiter/Sender Name", "Sender Email", "Status", "Total Resumes Submitted",
              "Internal Screening Cleared", "Sent to Client", "Client Interviews", "Offers",
              "Offers Accepted", "Joinees"]
    csv_text = await to_csv(flat, fields)
    return Response(content=csv_text, media_type="text/csv",
                     headers={"Content-Disposition": "attachment; filename=recruiter_submission_report.csv"})
