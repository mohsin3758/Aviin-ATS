"""CRUD + submission pack for /clients."""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from typing import Optional
from pydantic import BaseModel
from datetime import datetime, timezone
from io import BytesIO
import uuid
from deps import get_actor, Actor
import db

try:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
    from reportlab.lib.enums import TA_CENTER, TA_LEFT
    _PDF_OK = True
except ImportError:
    _PDF_OK = False

router = APIRouter(tags=["clients"])


class ClientIn(BaseModel):
    name: str
    industry: Optional[str] = None


# ─── Basic CRUD ─────────────────────────────────────────────────────────────

@router.get("/clients")
async def list_clients(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            "SELECT id, name, industry, created_at FROM clients ORDER BY name")
        return [dict(r) for r in rows]


@router.post("/clients", status_code=201)
async def create_client(body: ClientIn, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "INSERT INTO clients (id, tenant_id, name, industry) "
            "VALUES ($1, $2, $3, $4) RETURNING *",
            uuid.uuid4(), actor.tenant_id, body.name, body.industry)
        return dict(row)


@router.get("/clients/{client_id}/submission-pack")
async def get_submission_pack(client_id: str, actor: Actor = Depends(get_actor)):
    """Return all candidate applications for a client, grouped by stage."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        client = await conn.fetchrow("SELECT * FROM clients WHERE id=$1", client_id)
        if not client:
            raise HTTPException(404, "Client not found")

        rows = await conn.fetch("""
            SELECT
                a.id            AS application_id,
                a.stage,
                a.fit_score,
                a.created_at    AS applied_at,
                r.id            AS requisition_id,
                r.title         AS requisition_title,
                r.location      AS job_location,
                c.id            AS candidate_id,
                c.full_name     AS candidate_name,
                c.email,
                c.phone,
                c.skills,
                c.total_exp_mo,
                c.current_employer,
                (SELECT is2.scheduled_at FROM interview_schedules is2
                 WHERE is2.application_id = a.id
                 ORDER BY is2.scheduled_at DESC LIMIT 1) AS last_interview_at,
                (SELECT is2.interview_type FROM interview_schedules is2
                 WHERE is2.application_id = a.id
                 ORDER BY is2.scheduled_at DESC LIMIT 1) AS last_interview_type,
                (SELECT is2.status FROM interview_schedules is2
                 WHERE is2.application_id = a.id
                 ORDER BY is2.scheduled_at DESC LIMIT 1) AS last_interview_status
            FROM applications a
            JOIN requisitions r ON r.id = a.requisition_id
            JOIN candidates   c ON c.id = a.candidate_id
            WHERE r.client_id = $1
            ORDER BY a.stage, c.full_name
        """, client_id)

        STAGE_ORDER = [
            "sourced", "contacted", "interested", "nda",
            "screened", "submitted", "l1_interview", "l2_interview",
            "offer", "offer_accepted", "placed", "rejected", "hold"
        ]

        candidates = []
        by_stage: dict = {s: [] for s in STAGE_ORDER}

        for r in rows:
            entry = {
                "application_id": str(r["application_id"]),
                "stage": r["stage"],
                "fit_score": float(r["fit_score"]) if r["fit_score"] is not None else None,
                "applied_at": r["applied_at"].isoformat() if r["applied_at"] else None,
                "requisition_id": str(r["requisition_id"]),
                "requisition_title": r["requisition_title"],
                "job_location": r["job_location"],
                "candidate_id": str(r["candidate_id"]),
                "candidate_name": r["candidate_name"],
                "email": r["email"],
                "phone": r["phone"],
                "skills": list(r["skills"]) if r["skills"] else [],
                "experience_months": r["total_exp_mo"],
                "current_employer": r["current_employer"],
                "last_interview_at": r["last_interview_at"].isoformat() if r["last_interview_at"] else None,
                "last_interview_type": r["last_interview_type"],
                "last_interview_status": r["last_interview_status"],
            }
            candidates.append(entry)
            stage = r["stage"]
            if stage not in by_stage:
                by_stage[stage] = []
            by_stage[stage].append(entry)

        # Remove empty stages
        by_stage = {k: v for k, v in by_stage.items() if v}

        stage_counts = {k: len(v) for k, v in by_stage.items()}

        return {
            "client": dict(client),
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "summary": {
                "total_candidates": len(candidates),
                "by_stage": stage_counts,
            },
            "candidates": candidates,
            "by_stage": by_stage,
        }


@router.get("/clients/{client_id}/submission-pack/pdf")
async def get_submission_pack_pdf(client_id: str, actor: Actor = Depends(get_actor)):
    """Download a PDF submission report for a client."""
    if not _PDF_OK:
        raise HTTPException(500, "reportlab not available")

    # Reuse the JSON logic
    data = await get_submission_pack(client_id, actor)
    client = data["client"]
    candidates = data["candidates"]
    summary = data["summary"]
    by_stage = data["by_stage"]

    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4,
                            leftMargin=20*mm, rightMargin=20*mm,
                            topMargin=20*mm, bottomMargin=20*mm)
    styles = getSampleStyleSheet()
    story = []

    # Header
    title_style = ParagraphStyle("Title", parent=styles["Title"],
                                 fontSize=18, textColor=colors.HexColor("#1e3a5f"),
                                 spaceAfter=4)
    sub_style = ParagraphStyle("Sub", parent=styles["Normal"],
                               fontSize=10, textColor=colors.grey, spaceAfter=12)
    story.append(Paragraph("Candidate Submission Report", title_style))
    story.append(Paragraph(
        f"Client: <b>{client['name']}</b>"
        + (f" | Industry: {client.get('industry','—')}" if client.get('industry') else "")
        + f" | Generated: {datetime.now(timezone.utc).strftime('%d %b %Y %H:%M UTC')}",
        sub_style))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#1e3a5f")))
    story.append(Spacer(1, 6*mm))

    # Summary table
    story.append(Paragraph("Summary", styles["Heading2"]))
    sum_data = [["Total Candidates", str(summary["total_candidates"])]]
    for stage, cnt in summary["by_stage"].items():
        sum_data.append([stage.replace("_", " ").title(), str(cnt)])
    sum_tbl = Table(sum_data, colWidths=[80*mm, 40*mm])
    sum_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#1e3a5f")),
        ("TEXTCOLOR",  (0,0), (-1,0), colors.white),
        ("FONTNAME",   (0,0), (-1,0), "Helvetica-Bold"),
        ("GRID",       (0,0), (-1,-1), 0.5, colors.HexColor("#cccccc")),
        ("FONTSIZE",   (0,0), (-1,-1), 9),
        ("ROWBACKGROUNDS", (0,1), (-1,-1), [colors.white, colors.HexColor("#f5f7fb")]),
    ]))
    story.append(sum_tbl)
    story.append(Spacer(1, 8*mm))

    # Candidates by stage
    SHOW_STAGES = ["submitted", "screened", "l1_interview", "l2_interview",
                   "offer", "offer_accepted", "placed"]
    displayed_stages = [s for s in SHOW_STAGES if s in by_stage]
    other_stages = [s for s in by_stage if s not in SHOW_STAGES]
    ordered = displayed_stages + other_stages

    for stage in ordered:
        apps = by_stage.get(stage, [])
        if not apps:
            continue
        stage_label = stage.replace("_", " ").title()
        story.append(Paragraph(f"{stage_label} ({len(apps)})", styles["Heading3"]))

        tbl_data = [["Candidate", "Role", "Exp", "Skills", "Last Interview"]]
        for app in apps:
            exp_str = (f"{app['experience_months']//12}y {app['experience_months']%12}m"
                      if app["experience_months"] else "—")
            skills_str = ", ".join((app.get("skills") or [])[:4])
            if len(app.get("skills") or []) > 4:
                skills_str += "..."
            iv_str = "—"
            if app["last_interview_at"]:
                try:
                    iv_dt = datetime.fromisoformat(app["last_interview_at"].replace("Z", "+00:00"))
                    iv_str = iv_dt.strftime("%d %b %Y")
                    if app["last_interview_type"]:
                        iv_str += f"\n({app['last_interview_type'].title()})"
                except Exception:
                    iv_str = app["last_interview_at"][:10]
            tbl_data.append([
                Paragraph(f"<b>{app['candidate_name']}</b><br/><font size=8>{app.get('email','') or ''}</font>", styles["Normal"]),
                Paragraph(app["requisition_title"] or "—", styles["Normal"]),
                exp_str,
                Paragraph(skills_str or "—", styles["Normal"]),
                Paragraph(iv_str, styles["Normal"]),
            ])

        col_w = [50*mm, 45*mm, 18*mm, 42*mm, 28*mm]
        tbl = Table(tbl_data, colWidths=col_w, repeatRows=1)
        tbl.setStyle(TableStyle([
            ("BACKGROUND",   (0,0), (-1,0), colors.HexColor("#2563eb")),
            ("TEXTCOLOR",    (0,0), (-1,0), colors.white),
            ("FONTNAME",     (0,0), (-1,0), "Helvetica-Bold"),
            ("FONTSIZE",     (0,0), (-1,-1), 8),
            ("GRID",         (0,0), (-1,-1), 0.4, colors.HexColor("#cccccc")),
            ("ROWBACKGROUNDS",(0,1),(-1,-1), [colors.white, colors.HexColor("#eff6ff")]),
            ("VALIGN",       (0,0), (-1,-1), "TOP"),
            ("TOPPADDING",   (0,0), (-1,-1), 4),
            ("BOTTOMPADDING",(0,0), (-1,-1), 4),
        ]))
        story.append(tbl)
        story.append(Spacer(1, 5*mm))

    if not ordered:
        story.append(Paragraph("No candidates submitted for this client yet.", styles["Normal"]))

    # Footer note
    story.append(Spacer(1, 5*mm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.grey))
    story.append(Paragraph(
        "Confidential — AVIIN Recruitment. For internal use only.",
        ParagraphStyle("Footer", parent=styles["Normal"], fontSize=8,
                       textColor=colors.grey, alignment=TA_CENTER)
    ))

    doc.build(story)
    buf.seek(0)
    safe_name = client["name"].replace(" ", "_").replace("/", "-")
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="SubmissionPack_{safe_name}.pdf"'
        }
    )


@router.get("/clients/{client_id}")
async def get_client(client_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("SELECT * FROM clients WHERE id=$1", client_id)
        if not row:
            raise HTTPException(404, "Client not found")
        return dict(row)


@router.put("/clients/{client_id}")
async def update_client(client_id: str, body: ClientIn, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "UPDATE clients SET name=$1, industry=$2 WHERE id=$3 RETURNING *",
            body.name, body.industry, client_id)
        if not row:
            raise HTTPException(404, "Client not found")
        return dict(row)


@router.delete("/clients/{client_id}", status_code=204)
async def delete_client(client_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        result = await conn.execute("DELETE FROM clients WHERE id=$1", client_id)
        if result == "DELETE 0":
            raise HTTPException(404, "Client not found")
