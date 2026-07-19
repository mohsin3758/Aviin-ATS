"""Offer state machine: draft -> pending_approval -> approved -> issued
-> accepted/declined.

HARD RULE #10: approve/issue are HITL-gated (admin/manager only) and
write assignment_event + audit_log. issue also writes event_outbox
'offer.issued' for downstream automation (P2/P11).
"""

import os
from fastapi import APIRouter, Depends, HTTPException

import db
import events
from deps import Actor, get_actor, require_role
from schemas import OfferCreate, OfferRespond

router = APIRouter(prefix="/offers", tags=["offers"])

FIELDS = """id, tenant_id, application_id, status, ctc_offered, currency,
            joining_date, approved_by, created_at, updated_at"""


async def _get_offer(conn, offer_id: str):
    row = await conn.fetchrow(f"SELECT {FIELDS} FROM offers WHERE id = $1", offer_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Offer not found")
    return row


@router.get("")
async def list_offers(application_id: str | None = None, actor: Actor = Depends(get_actor)):
    conditions: list[str] = []
    params: list = []
    if application_id:
        params.append(application_id)
        conditions.append(f"application_id = ${len(params)}")

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(f"SELECT {FIELDS} FROM offers {where} ORDER BY created_at DESC", *params)
    return [dict(r) for r in rows]


@router.post("")
async def create_offer(body: OfferCreate, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            f"""INSERT INTO offers (tenant_id, application_id, status, ctc_offered, currency, joining_date)
                VALUES ($1, $2, 'draft', $3, $4, $5)
                RETURNING {FIELDS}""",
            actor.tenant_id, body.application_id, body.ctc_offered, body.currency, body.joining_date,
        )

        await events.write_outbox(
            conn, actor.tenant_id, "offer.created",
            {"offer_id": str(row["id"]), "application_id": body.application_id},
            f"offer.created:{row['id']}",
        )

    return dict(row)


@router.get("/{offer_id}")
async def get_offer(offer_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await _get_offer(conn, offer_id)
    return dict(row)


@router.post("/{offer_id}/submit-for-approval")
async def submit_for_approval(offer_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            f"""UPDATE offers SET status = 'pending_approval', updated_at = now()
                WHERE id = $1 AND status = 'draft' RETURNING {FIELDS}""",
            offer_id,
        )
        if row is None:
            existing = await _get_offer(conn, offer_id)
            raise HTTPException(status_code=409, detail=f"Offer is '{existing['status']}', expected 'draft'")

        await events.write_assignment_event(
            conn, actor.tenant_id, "offer.pending_approval",
            reason="Submitted for manager approval", actor_user_id=actor.user_id,
            metadata={"offer_id": offer_id},
        )

    return dict(row)


@router.post("/{offer_id}/approve")
async def approve_offer(offer_id: str, actor: Actor = Depends(require_role("admin", "manager"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            f"""UPDATE offers SET status = 'approved', approved_by = $2, updated_at = now()
                WHERE id = $1 AND status = 'pending_approval' RETURNING {FIELDS}""",
            offer_id, actor.user_id,
        )
        if row is None:
            existing = await _get_offer(conn, offer_id)
            raise HTTPException(status_code=409, detail=f"Offer is '{existing['status']}', expected 'pending_approval'")

        await events.write_assignment_event(
            conn, actor.tenant_id, "offer.approved",
            actor_user_id=actor.user_id, metadata={"offer_id": offer_id},
        )
        await events.write_audit(
            conn, actor.tenant_id, actor.user_id, "approve", "offer", offer_id,
            before={"status": "pending_approval"}, after={"status": "approved"},
        )

    return dict(row)


@router.post("/{offer_id}/issue")
async def issue_offer(offer_id: str, actor: Actor = Depends(require_role("admin", "manager"))):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            f"""UPDATE offers SET status = 'issued', updated_at = now()
                WHERE id = $1 AND status = 'approved' RETURNING {FIELDS}""",
            offer_id,
        )
        if row is None:
            existing = await _get_offer(conn, offer_id)
            raise HTTPException(status_code=409, detail=f"Offer is '{existing['status']}', expected 'approved'")

        await events.write_assignment_event(
            conn, actor.tenant_id, "offer.issued",
            actor_user_id=actor.user_id, metadata={"offer_id": offer_id},
        )
        await events.write_audit(
            conn, actor.tenant_id, actor.user_id, "issue", "offer", offer_id,
            before={"status": "approved"}, after={"status": "issued"},
        )
        await events.write_outbox(
            conn, actor.tenant_id, "offer.issued",
            {"offer_id": offer_id, "application_id": str(row["application_id"])},
            f"offer.issued:{offer_id}",
        )

    return dict(row)


@router.post("/{offer_id}/respond")
async def respond_offer(offer_id: str, body: OfferRespond, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            f"""UPDATE offers SET status = $2, updated_at = now()
                WHERE id = $1 AND status = 'issued' RETURNING {FIELDS}""",
            offer_id, body.status,
        )
        if row is None:
            existing = await _get_offer(conn, offer_id)
            raise HTTPException(status_code=409, detail=f"Offer is '{existing['status']}', expected 'issued'")

        await events.write_outbox(
            conn, actor.tenant_id, f"offer.{body.status}",
            {"offer_id": offer_id, "application_id": str(row["application_id"])},
            f"offer.{body.status}:{offer_id}",
        )

        if body.status == "accepted":
            await conn.execute(
                "UPDATE applications SET stage = 'placed', updated_at = now() WHERE id = $1",
                row["application_id"],
            )

    return dict(row)


# ─── Offer Letter: CRUD + PDF + Send ──────────────────────────────────────────
from io import BytesIO
from fastapi.responses import StreamingResponse
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable, Table, TableStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_JUSTIFY
import asyncpg


def _build_offer_pdf(offer: dict, candidate: dict, company_name: str = "AVIIN Jobs Services") -> bytes:
    """Generate a professional offer letter PDF using reportlab."""
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4,
                            leftMargin=2.5*cm, rightMargin=2.5*cm,
                            topMargin=2*cm, bottomMargin=2*cm)
    styles = getSampleStyleSheet()
    PRIMARY = colors.HexColor('#1e40af')
    DARK    = colors.HexColor('#0f172a')
    GRAY    = colors.HexColor('#64748b')

    h1 = ParagraphStyle('H1', fontSize=22, textColor=PRIMARY, spaceAfter=4,
                         fontName='Helvetica-Bold', alignment=TA_CENTER)
    h2 = ParagraphStyle('H2', fontSize=11, textColor=DARK, spaceAfter=6,
                         fontName='Helvetica-Bold')
    body = ParagraphStyle('Body', fontSize=10, textColor=DARK, spaceAfter=6,
                           leading=16, fontName='Helvetica', alignment=TA_JUSTIFY)
    small = ParagraphStyle('Small', fontSize=9, textColor=GRAY, spaceAfter=4,
                            fontName='Helvetica')
    center = ParagraphStyle('Center', fontSize=10, textColor=DARK, spaceAfter=4,
                             fontName='Helvetica', alignment=TA_CENTER)

    joining = offer.get('joining_date')
    if hasattr(joining, 'strftime'):
        joining_str = joining.strftime('%d %B %Y')
    elif joining:
        joining_str = str(joining)
    else:
        joining_str = 'As mutually agreed'

    import datetime
    today = datetime.date.today().strftime('%d %B %Y')
    ctc = offer.get('ctc_offered')
    currency = offer.get('currency', 'INR')
    ctc_str = f"{currency} {ctc:,.2f} per annum" if ctc else "As discussed"

    letter_text = offer.get('offer_letter_text', '')

    story = []

    # Header
    story.append(Paragraph(company_name, h1))
    story.append(HRFlowable(width='100%', thickness=2, color=PRIMARY, spaceAfter=12))

    # Title
    title_style = ParagraphStyle('Title', fontSize=14, textColor=DARK, spaceAfter=8,
                                  fontName='Helvetica-Bold', alignment=TA_CENTER)
    story.append(Paragraph('OFFER OF EMPLOYMENT', title_style))
    story.append(Spacer(1, 0.3*cm))

    # Date + candidate
    story.append(Paragraph(f'Date: {today}', small))
    story.append(Spacer(1, 0.2*cm))
    story.append(Paragraph(f'To,', body))
    story.append(Paragraph(f'<b>{candidate.get("full_name", "Candidate")}</b>', body))
    if candidate.get('email'):
        story.append(Paragraph(candidate['email'], small))
    story.append(Spacer(1, 0.4*cm))

    story.append(Paragraph('Dear Candidate,', body))
    story.append(Spacer(1, 0.3*cm))

    # Custom letter text or default
    if letter_text and letter_text.strip():
        for para in letter_text.split(chr(10)+chr(10)):
            if para.strip():
                story.append(Paragraph(para.strip(), body))
                story.append(Spacer(1, 0.2*cm))
    else:
        story.append(Paragraph(
            f'We are pleased to extend this offer of employment to you. '
            f'After careful consideration of your qualifications and experience, '
            f'we would like to invite you to join our team.', body))
        story.append(Spacer(1, 0.3*cm))

    # Terms table
    story.append(Paragraph('OFFER DETAILS', h2))
    table_data = [
        ['Offered CTC', ctc_str],
        ['Joining Date', joining_str],
        ['Employment Type', 'Full-Time'],
    ]
    t = Table(table_data, colWidths=[5*cm, 11*cm])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (0,-1), colors.HexColor('#f1f5f9')),
        ('FONTNAME', (0,0), (0,-1), 'Helvetica-Bold'),
        ('FONTSIZE', (0,0), (-1,-1), 10),
        ('TEXTCOLOR', (0,0), (-1,-1), DARK),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#e2e8f0')),
        ('PADDING', (0,0), (-1,-1), 8),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ]))
    story.append(t)
    story.append(Spacer(1, 0.4*cm))

    story.append(Paragraph(
        'This offer is contingent upon successful completion of background verification '
        'and submission of all required documents before your joining date.', body))
    story.append(Spacer(1, 0.4*cm))

    story.append(Paragraph(
        'Please sign and return a copy of this letter to confirm your acceptance. '
        'We look forward to welcoming you to our team.', body))
    story.append(Spacer(1, 0.6*cm))

    story.append(Paragraph('Sincerely,', body))
    story.append(Spacer(1, 0.8*cm))
    story.append(Paragraph('_________________________________', small))
    story.append(Paragraph(f'<b>{company_name}</b>', body))
    story.append(Spacer(1, 1*cm))

    # Acceptance section
    story.append(HRFlowable(width='100%', thickness=1, color=GRAY, spaceAfter=10))
    story.append(Paragraph('<b>ACCEPTANCE</b>', h2))
    story.append(Paragraph(
        'I, the undersigned, hereby accept this offer of employment under the terms and conditions stated above.',
        body))
    story.append(Spacer(1, 0.8*cm))
    story.append(Paragraph('Signature: _________________________________   Date: _________________', small))

    doc.build(story)
    return buf.getvalue()


OFFER_LETTER_FIELDS = "id, offer_id, candidate_id, tenant_id, draft_text, final_text, status, sent_at, signed_at, created_at"


@router.get("/{offer_id}/letter")
async def get_offer_letter(offer_id: str, actor: Actor = Depends(get_actor)):
    """Get the letter record for an offer (creates draft row if none exists)."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        offer = await _get_offer(conn, offer_id)
        letter = await conn.fetchrow(
            f"SELECT {OFFER_LETTER_FIELDS} FROM offer_letters WHERE offer_id=$1",
            offer_id)
        if not letter:
            letter = await conn.fetchrow(
                f"""INSERT INTO offer_letters (tenant_id, offer_id, candidate_id, draft_text, status)
                    SELECT $1, o.id, a.candidate_id, o.offer_letter_text, 'draft'
                    FROM offers o
                    JOIN applications a ON a.id = o.application_id
                    WHERE o.id = $2
                    RETURNING {OFFER_LETTER_FIELDS}""",
                actor.tenant_id, offer_id)
    return dict(letter)


@router.put("/{offer_id}/letter")
async def save_offer_letter(offer_id: str, body: dict, actor: Actor = Depends(get_actor)):
    """Save/update the letter text for an offer."""
    text = body.get('letter_text', '')
    async with db.tenant_conn(actor.tenant_id) as conn:
        await _get_offer(conn, offer_id)
        await conn.execute(
            "UPDATE offers SET offer_letter_text=$1, updated_at=now() WHERE id=$2",
            text, offer_id)
        letter = await conn.fetchrow(
            f"SELECT id FROM offer_letters WHERE offer_id=$1", offer_id)
        if letter:
            row = await conn.fetchrow(
                f"UPDATE offer_letters SET draft_text=$1 WHERE offer_id=$2 RETURNING {OFFER_LETTER_FIELDS}",
                text, offer_id)
        else:
            row = await conn.fetchrow(
                f"""INSERT INTO offer_letters (tenant_id, offer_id, candidate_id, draft_text, status)
                    SELECT $1, o.id, a.candidate_id, $2, 'draft'
                    FROM offers o JOIN applications a ON a.id=o.application_id
                    WHERE o.id=$3
                    RETURNING {OFFER_LETTER_FIELDS}""",
                actor.tenant_id, text, offer_id)
    return dict(row)



@router.get("/{offer_id}/letter/pdf")
async def download_offer_letter_pdf(offer_id: str, actor: Actor = Depends(get_actor)):
    """Stream the offer letter as a PDF."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        offer = await _get_offer(conn, offer_id)
        app_row = await conn.fetchrow(
            "SELECT candidate_id FROM applications WHERE id=$1",
            offer['application_id'])
        candidate = await conn.fetchrow(
            "SELECT id, full_name, email FROM candidates WHERE id=$1",
            app_row['candidate_id'])
        company_row = await conn.fetchrow(
            "SELECT name FROM tenants WHERE id=$1", actor.tenant_id)
    company_name = company_row['name'] if company_row else 'AVIIN Jobs Services'
    pdf_bytes = _build_offer_pdf(dict(offer), dict(candidate), company_name)
    fname = f"offer_{offer_id[:8]}_{str(candidate['full_name']).replace(' ','_')}.pdf"
    return StreamingResponse(
        BytesIO(pdf_bytes),
        media_type='application/pdf',
        headers={'Content-Disposition': f'attachment; filename="{fname}"'}
    )


@router.post("/{offer_id}/letter/send")
async def send_offer_letter(offer_id: str, actor: Actor = Depends(get_actor)):
    """Email the offer letter PDF to the candidate and mark it as issued."""
    import asyncpg as _asyncpg
    import smtplib, ssl as _ssl
    from email.mime.multipart import MIMEMultipart
    from email.mime.base import MIMEBase
    from email.mime.text import MIMEText
    from email import encoders

    async with db.tenant_conn(actor.tenant_id) as conn:
        offer = await _get_offer(conn, offer_id)
        if offer['status'] not in ('approved', 'issued', 'draft'):
            raise HTTPException(400, f"Cannot send letter for offer in status '{offer['status']}'")
        app_row = await conn.fetchrow(
            "SELECT candidate_id FROM applications WHERE id=$1", offer['application_id'])
        candidate = await conn.fetchrow(
            "SELECT id, full_name, email FROM candidates WHERE id=$1",
            app_row['candidate_id'])
        company_row = await conn.fetchrow(
            "SELECT name FROM tenants WHERE id=$1", actor.tenant_id)

    if not candidate['email']:
        raise HTTPException(400, "Candidate has no email address")

    company_name = company_row['name'] if company_row else 'AVIIN Jobs Services'
    pdf_bytes = _build_offer_pdf(dict(offer), dict(candidate), company_name)

    # Fetch SMTP settings
    sent = False
    channel = 'none'
    try:
        raw_conn = await _asyncpg.connect(
            dsn=None,
            host=os.environ.get('DB_HOST', 'db'),
            port=int(os.environ.get('DB_PORT', '5432')),
            user=os.environ.get('DB_USER', 'app_user'),
            password=os.environ.get('DB_PASS', ''),
            database=os.environ.get('DB_NAME', 'ats'),
        )
        try:
            smtp_row = await raw_conn.fetchrow(
                "SELECT smtp_host,smtp_port,smtp_user,smtp_pass,from_email FROM email_settings WHERE tenant_id=$1",
                actor.tenant_id)
        finally:
            await raw_conn.close()

        if smtp_row and smtp_row['smtp_host']:
            msg = MIMEMultipart()
            msg['Subject'] = f"Offer Letter  -  {company_name}"
            msg['From'] = smtp_row['from_email'] or smtp_row['smtp_user']
            msg['To'] = candidate['email']
            msg.attach(MIMEText(
                'Dear ' + candidate['full_name'] + ',' + chr(10)*2 +
                'Please find your offer letter attached.' + chr(10)*2 +
                'Best regards,' + chr(10) + company_name, 'plain'))
            part = MIMEBase('application', 'pdf')
            part.set_payload(pdf_bytes)
            encoders.encode_base64(part)
            part.add_header('Content-Disposition',
                            f'attachment; filename="offer_letter.pdf"')
            msg.attach(part)
            ctx = _ssl.create_default_context()
            with smtplib.SMTP_SSL(smtp_row['smtp_host'], smtp_row['smtp_port'] or 465, context=ctx) as srv:
                srv.login(smtp_row['smtp_user'], smtp_row['smtp_pass'])
                srv.send_message(msg)
            sent = True
            channel = 'email'
    except Exception as exc:
        # SMTP not configured or failed  -  still mark letter as sent
        channel = 'none'

    # Update DB: mark offer as issued, stamp sent_at on offer_letters
    async with db.tenant_conn(actor.tenant_id) as conn:
        if offer['status'] == 'approved':
            await conn.execute(
                "UPDATE offers SET status='issued', updated_at=now() WHERE id=$1", offer_id)
        # Upsert offer_letters sent_at
        ltr = await conn.fetchrow("SELECT id FROM offer_letters WHERE offer_id=$1", offer_id)
        if ltr:
            await conn.execute(
                "UPDATE offer_letters SET status='sent', sent_at=now() WHERE offer_id=$1", offer_id)
        else:
            await conn.execute(
                """INSERT INTO offer_letters (tenant_id,offer_id,candidate_id,draft_text,status,sent_at)
                   SELECT $1,o.id,a.candidate_id,o.offer_letter_text,'sent',now()
                   FROM offers o JOIN applications a ON a.id=o.application_id WHERE o.id=$2""",
                actor.tenant_id, offer_id)

    return {'sent': sent, 'channel': channel, 'recipient': candidate['email']}




# -- Offer E-Signing (self-hosted, uses SECURITY DEFINER functions for public endpoints) --
import secrets as _secrets

offer_sign_public = APIRouter(prefix='/offer-sign', tags=['offer-sign'])


@router.post('/{offer_id}/letter/request-sign')
async def request_offer_signature(offer_id: str, actor: Actor = Depends(get_actor)):
    """Generate a signing link for the candidate (idempotent)."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        letter = await conn.fetchrow(
            "SELECT id FROM offer_letters"
            " WHERE offer_id=$1::uuid AND tenant_id=$2::uuid",
            offer_id, actor.tenant_id
        )
        if not letter:
            raise HTTPException(400, 'Generate an offer letter first')
        token = _secrets.token_urlsafe(32)
        await conn.execute(
            "UPDATE offer_letters"
            " SET signing_token=$1, status='sent', sent_at=now()"
            " WHERE offer_id=$2::uuid AND tenant_id=$3::uuid",
            token, offer_id, actor.tenant_id
        )
    base = os.environ.get("NEXT_PUBLIC_APP_URL", "https://ats.aviinjobs.com")
    return {'token': token, 'url': f'{base}/sign-offer/{token}',
            'message': 'Share this link with the candidate to collect their e-signature'}


@offer_sign_public.get('/public')
async def get_offer_for_signing(token: str):
    """No-auth — uses SECURITY DEFINER function to bypass RLS."""
    async with db.system_conn() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM get_offer_by_signing_token($1)", token
        )
    if not row:
        raise HTTPException(404, 'Signing link is invalid or expired')
    if row['status'] == 'e_signed':
        return {'already_signed': True, 'candidate_name': row['candidate_name'],
                'company_name': row['company_name']}
    return {
        'already_signed': False,
        'candidate_name': row['candidate_name'],
        'job_title': row['job_title'],
        'company_name': row['company_name'],
        'ctc_offered': str(row['ctc_offered'] or ''),
        'joining_date': str(row['joining_date'] or ''),
        'letter_text': row['final_text'] or row['draft_text'] or 'Offer letter not available',
    }


@offer_sign_public.post('/sign')
async def sign_offer_letter(token: str, body: dict):
    """No-auth — uses SECURITY DEFINER function to bypass RLS."""
    signatory_name = (body.get('signatory_name') or '').strip()
    agreed = body.get('agreed', False)
    if not signatory_name:
        raise HTTPException(400, 'Please enter your full name as a signature')
    if not agreed:
        raise HTTPException(400, 'Please check the agreement box to proceed')
    async with db.system_conn() as conn:
        result = await conn.fetchrow(
            "SELECT * FROM sign_offer_by_token($1, $2)", token, signatory_name
        )
    if not result:
        raise HTTPException(400, 'Signing link is invalid, already used, or expired')
    async with db.system_conn() as conn:
        await conn.execute(
            "SELECT accept_offer_by_id($1)", result['offer_id']
        )
    return {'signed': True, 'message': 'Thank you! Your e-signature has been recorded.'}
