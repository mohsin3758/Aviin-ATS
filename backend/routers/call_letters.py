"""Call letters — personalised interview/drive call letters with the
AviinTech Business Solutions logo embedded. No PDF generator anywhere in
this codebase embedded an actual logo image before this (offer letters/
NDAs only render the company name as text) — reportlab's Image flowable
needed adding, not just more text styling.

Deliberately does not introduce a "hiring drive" management entity —
interview date/time/venue/mode are entered ad-hoc per call letter rather
than pulled from a stored drive record, since no such table exists and
building one is a materially bigger feature than "generate a call letter."
"""
import os
import re
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
from io import BytesIO
from typing import Optional

import asyncpg
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import db
import events
from deps import Actor, get_actor

router = APIRouter(prefix="/call-letters", tags=["call-letters"])

LOGO_PATH = os.path.join(os.path.dirname(__file__), "..", "assets", "aviintech-logo.png")


def _build_call_letter_pdf(candidate_name: str, role_title: str, client_name: Optional[str],
                            tenant_name: str, interview_date: str, interview_time: Optional[str],
                            venue: Optional[str], mode: str, notes: Optional[str]) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable, Table, TableStyle, Image
    from xml.sax.saxutils import escape as esc

    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=2.3 * cm, rightMargin=2.3 * cm,
                             topMargin=1.8 * cm, bottomMargin=2 * cm)
    PRIMARY = colors.HexColor("#1e40af")
    DARK = colors.HexColor("#0f172a")
    GRAY = colors.HexColor("#64748b")

    title_style = ParagraphStyle("Title", fontSize=16, textColor=DARK, fontName="Helvetica-Bold",
                                  alignment=TA_CENTER, spaceAfter=4)
    small = ParagraphStyle("Small", fontSize=9, textColor=GRAY, fontName="Helvetica", alignment=TA_CENTER, spaceAfter=4)
    body = ParagraphStyle("Body", fontSize=10.5, textColor=DARK, leading=17, fontName="Helvetica", spaceAfter=8)
    h2 = ParagraphStyle("H2", fontSize=11, textColor=PRIMARY, fontName="Helvetica-Bold", spaceBefore=10, spaceAfter=6)

    story = []
    if os.path.exists(LOGO_PATH):
        # Fixed display width, height scaled to the source file's own
        # aspect ratio (730x342) so the logo never looks stretched.
        logo_w = 4.5 * cm
        logo_h = logo_w * (342 / 730)
        img = Image(LOGO_PATH, width=logo_w, height=logo_h)
        img.hAlign = "CENTER"
        story.append(img)
        story.append(Spacer(1, 0.4 * cm))

    story.append(Paragraph(esc(tenant_name), title_style))
    story.append(Paragraph("INTERVIEW CALL LETTER", small))
    story.append(HRFlowable(width="100%", thickness=1.2, color=PRIMARY, spaceAfter=14))

    story.append(Paragraph(f"Dear <b>{esc(candidate_name)}</b>,", body))
    role_line = f"We are pleased to invite you for an interview for the role of <b>{esc(role_title)}</b>"
    if client_name:
        role_line += f" with our client <b>{esc(client_name)}</b>"
    role_line += "."
    story.append(Paragraph(role_line, body))

    details = [["Date", esc(interview_date)]]
    if interview_time:
        details.append(["Time", esc(interview_time)])
    details.append(["Mode", esc("Virtual" if mode == "virtual" else "In-Person")])
    if venue:
        details.append(["Venue" if mode != "virtual" else "Meeting Link", esc(venue)])

    story.append(Paragraph("INTERVIEW DETAILS", h2))
    t = Table(details, colWidths=[3.5 * cm, 11.5 * cm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f1f5f9")),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("TEXTCOLOR", (0, 0), (-1, -1), DARK),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ("PADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(t)
    story.append(Spacer(1, 0.3 * cm))

    if notes:
        story.append(Paragraph("ADDITIONAL NOTES", h2))
        for para in notes.split("\n"):
            if para.strip():
                story.append(Paragraph(esc(para.strip()), body))

    story.append(Spacer(1, 0.4 * cm))
    story.append(Paragraph(
        "Please carry a valid photo ID and a copy of this letter. We look forward to meeting you.", body))
    story.append(Paragraph(f"Best regards,<br/>{esc(tenant_name)}", body))

    doc.build(story)
    return buf.getvalue()


async def _send_call_letter_email(tenant_id: str, to_email: str, subject: str, body_text: str,
                                   pdf_bytes: bytes, filename: str) -> tuple:
    try:
        db_url = os.environ.get("DATABASE_URL", "postgresql://app_user:apppw@db:5432/ats")
        conn = await asyncpg.connect(db_url)
        try:
            cfg = await conn.fetchrow(
                "SELECT smtp_host,smtp_port,smtp_user,smtp_password,smtp_from,smtp_from_name,smtp_tls "
                "FROM email_settings WHERE tenant_id=$1 AND is_active=TRUE LIMIT 1", tenant_id)
        finally:
            await conn.close()
        if not cfg or not cfg["smtp_host"]:
            return False, "No active SMTP configuration for this tenant"

        msg = MIMEMultipart()
        msg["Subject"] = subject
        msg["From"] = f'{cfg["smtp_from_name"] or "AVIIN ATS"} <{cfg["smtp_from"] or cfg["smtp_user"]}>'
        msg["To"] = to_email
        msg.attach(MIMEText(body_text, "plain"))
        part = MIMEBase("application", "pdf")
        part.set_payload(pdf_bytes)
        encoders.encode_base64(part)
        part.add_header("Content-Disposition", f'attachment; filename="{filename}"')
        msg.attach(part)

        port = cfg["smtp_port"] or 587
        with smtplib.SMTP(cfg["smtp_host"], port, timeout=15) as s:
            s.ehlo()
            if cfg["smtp_tls"] and port == 587:
                s.starttls()
                s.ehlo()
            if cfg["smtp_user"]:
                s.login(cfg["smtp_user"], cfg["smtp_password"] or "")
            s.sendmail(cfg["smtp_from"] or cfg["smtp_user"], [to_email], msg.as_string())
        return True, None
    except Exception as exc:
        return False, str(exc)


class CallLetterIn(BaseModel):
    application_id: str
    interview_date: str
    interview_time: Optional[str] = None
    venue: Optional[str] = None
    mode: str = "in_person"  # 'in_person' | 'virtual'
    notes: Optional[str] = None
    send_email: bool = True


@router.post("/generate")
async def generate_call_letter(body: CallLetterIn, actor: Actor = Depends(get_actor)):
    if body.mode not in ("in_person", "virtual"):
        raise HTTPException(400, "mode must be 'in_person' or 'virtual'")

    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """SELECT a.id AS application_id, c.id AS candidate_id, c.full_name, c.email,
                      r.title AS role_title, cl.name AS client_name, t.name AS tenant_name
               FROM applications a
               JOIN candidates c ON c.id = a.candidate_id
               JOIN requisitions r ON r.id = a.requisition_id
               LEFT JOIN clients cl ON cl.id = r.client_id
               JOIN tenants t ON t.id = a.tenant_id
               WHERE a.id = $1""",
            body.application_id)
        if not row:
            raise HTTPException(404, "Application not found")

        pdf_bytes = _build_call_letter_pdf(
            row["full_name"], row["role_title"], row["client_name"], row["tenant_name"] or "Aviin Technology Business Solutions Pvt Ltd",
            body.interview_date, body.interview_time, body.venue, body.mode, body.notes)
        safe_name = re.sub(r"[^A-Za-z0-9_-]+", "_", row["full_name"] or "candidate")
        filename = f"Call_Letter_{safe_name}.pdf"

        email_sent, email_error = False, None
        if body.send_email:
            if not row["email"]:
                email_error = "Candidate has no email address on file"
            else:
                subject = f"Interview Call Letter — {row['role_title']}"
                body_text = (
                    f"Dear {row['full_name']},\n\nPlease find attached your interview call letter for "
                    f"{row['role_title']}. Details are in the attached PDF.\n\nBest regards,\n{row['tenant_name'] or 'Aviin Technology Business Solutions Pvt Ltd'}"
                )
                email_sent, email_error = await _send_call_letter_email(
                    actor.tenant_id, row["email"], subject, body_text, pdf_bytes, filename)

            await conn.execute(
                """INSERT INTO candidate_messages
                     (tenant_id,candidate_id,application_id,channel,direction,subject,body,status,sent_by,to_email)
                   VALUES ($1,$2,$3,'email','outbound',$4,$5,$6,$7,$8)""",
                actor.tenant_id, row["candidate_id"], body.application_id,
                f"Call letter — {row['role_title']}", f"Interview: {body.interview_date} {body.interview_time or ''} ({body.mode})",
                "sent" if email_sent else "failed", actor.user_id, row["email"])

        await events.write_outbox(
            conn, actor.tenant_id, "call_letter.generated",
            {"application_id": body.application_id, "candidate_id": str(row["candidate_id"]), "email_sent": email_sent},
            f"call_letter.generated:{body.application_id}:{body.interview_date}",
        )

    return {
        "ok": True, "email_sent": email_sent, "email_error": email_error,
        "filename": filename, "candidate_name": row["full_name"],
    }


class CallLetterPreviewIn(BaseModel):
    application_id: str
    interview_date: str
    interview_time: Optional[str] = None
    venue: Optional[str] = None
    mode: str = "in_person"
    notes: Optional[str] = None


@router.post("/preview")
async def preview_call_letter(body: CallLetterPreviewIn, actor: Actor = Depends(get_actor)):
    """Same rendering as /generate but returns the PDF directly for
    download/preview, no email side effect and no candidate_messages log."""
    if body.mode not in ("in_person", "virtual"):
        raise HTTPException(400, "mode must be 'in_person' or 'virtual'")
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """SELECT c.full_name, r.title AS role_title, cl.name AS client_name, t.name AS tenant_name
               FROM applications a
               JOIN candidates c ON c.id = a.candidate_id
               JOIN requisitions r ON r.id = a.requisition_id
               LEFT JOIN clients cl ON cl.id = r.client_id
               JOIN tenants t ON t.id = a.tenant_id
               WHERE a.id = $1""",
            body.application_id)
        if not row:
            raise HTTPException(404, "Application not found")
    pdf_bytes = _build_call_letter_pdf(
        row["full_name"], row["role_title"], row["client_name"], row["tenant_name"] or "Aviin Technology Business Solutions Pvt Ltd",
        body.interview_date, body.interview_time, body.venue, body.mode, body.notes)
    safe_name = re.sub(r"[^A-Za-z0-9_-]+", "_", row["full_name"] or "candidate")
    return StreamingResponse(
        BytesIO(pdf_bytes), media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="Call_Letter_{safe_name}.pdf"'})
