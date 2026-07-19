from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
)
from reportlab.platypus.flowables import Flowable
from reportlab.lib.enums import TA_CENTER, TA_LEFT
import os

# ── Colour palette
GREEN  = colors.HexColor('#00b87c')
NAVY   = colors.HexColor('#0f172a')
GRAY   = colors.HexColor('#64748b')
LGRAY  = colors.HexColor('#f1f5f9')
WHITE  = colors.white
PURPLE = colors.HexColor('#7c3aed')
CYAN   = colors.HexColor('#0891b2')
AMBER  = colors.HexColor('#d97706')
RED    = colors.HexColor('#dc2626')

OUTPUT_DIR = '/home/dev/airecruit/docs/training'
os.makedirs(OUTPUT_DIR, exist_ok=True)

# ── Page header/footer callback factory
def make_page_callbacks(title_text, url='https://ats.aviinjobs.com', accent=None):
    acc = accent or GREEN
    def on_page(canvas, doc):
        W, H = A4
        canvas.saveState()
        # Header bar
        canvas.setFillColor(NAVY)
        canvas.rect(0, H - 38, W, 38, fill=1, stroke=0)
        # Logo circle
        canvas.setFillColor(acc)
        canvas.circle(22, H - 19, 14, fill=1, stroke=0)
        canvas.setFillColor(WHITE)
        canvas.setFont('Helvetica-Bold', 11)
        canvas.drawCentredString(22, H - 23, 'A')
        # Title
        canvas.setFillColor(WHITE)
        canvas.setFont('Helvetica-Bold', 11)
        canvas.drawString(44, H - 23, title_text)
        # URL right
        canvas.setFont('Helvetica', 8)
        canvas.setFillColor(acc)
        canvas.drawRightString(W - 14, H - 23, url)
        # Footer bar
        canvas.setFillColor(LGRAY)
        canvas.rect(0, 0, W, 24, fill=1, stroke=0)
        canvas.setFillColor(GRAY)
        canvas.setFont('Helvetica', 7)
        canvas.drawString(14, 8, 'AVIIN ATS  |  Confidential Training Material')
        canvas.drawRightString(W - 14, 8, f'Page {doc.page}')
        canvas.restoreState()
    return on_page

# ── Styles
S_TITLE    = ParagraphStyle('S_TITLE',   fontName='Helvetica-Bold', fontSize=28,
                             textColor=WHITE,  alignment=TA_CENTER, leading=34)
S_SUBTITLE = ParagraphStyle('S_SUBTITLE',fontName='Helvetica',      fontSize=13,
                             textColor=colors.HexColor('#f1f5f9'), alignment=TA_CENTER, leading=18)
S_H1       = ParagraphStyle('S_H1',      fontName='Helvetica-Bold', fontSize=14,
                             textColor=WHITE,  alignment=TA_LEFT,   leading=18)
S_BODY     = ParagraphStyle('S_BODY',    fontName='Helvetica',      fontSize=9,
                             textColor=colors.HexColor('#0f172a'),  alignment=TA_LEFT, leading=13)

def build_cover(title_lines, subtitle, accent):
    data = [[Paragraph(line, S_TITLE)] for line in title_lines]
    data.append([Spacer(1, 4)])
    data.append([Paragraph(subtitle, S_SUBTITLE)])
    t = Table(data, colWidths=[17*cm])
    t.setStyle(TableStyle([
        ('BACKGROUND',   (0,0),(-1,-1), NAVY),
        ('TOPPADDING',   (0,0),(-1,-1), 12),
        ('BOTTOMPADDING',(0,0),(-1,-1), 12),
        ('LEFTPADDING',  (0,0),(-1,-1), 20),
        ('RIGHTPADDING', (0,0),(-1,-1), 20),
    ]))
    return t

def section_header(text, accent=None):
    acc = accent or GREEN
    t = Table([[Paragraph(text, S_H1)]], colWidths=[17*cm])
    t.setStyle(TableStyle([
        ('BACKGROUND',   (0,0),(-1,-1), acc),
        ('TOPPADDING',   (0,0),(-1,-1), 6),
        ('BOTTOMPADDING',(0,0),(-1,-1), 6),
        ('LEFTPADDING',  (0,0),(-1,-1), 10),
        ('RIGHTPADDING', (0,0),(-1,-1), 10),
    ]))
    return t

def pro_table(headers, rows, col_widths=None, accent=None):
    acc = accent or NAVY
    data = [headers] + rows
    cw = col_widths or ([17*cm / len(headers)] * len(headers))
    t = Table(data, colWidths=cw)
    t.setStyle(TableStyle([
        ('BACKGROUND',    (0,0), (-1,0),  acc),
        ('TEXTCOLOR',     (0,0), (-1,0),  WHITE),
        ('FONTNAME',      (0,0), (-1,0),  'Helvetica-Bold'),
        ('FONTSIZE',      (0,0), (-1,0),  9),
        ('BOTTOMPADDING', (0,0), (-1,0),  7),
        ('TOPPADDING',    (0,0), (-1,0),  7),
        ('LEFTPADDING',   (0,0), (-1,-1), 8),
        ('RIGHTPADDING',  (0,0), (-1,-1), 8),
        ('FONTNAME',      (0,1), (-1,-1), 'Helvetica'),
        ('FONTSIZE',      (0,1), (-1,-1), 8),
        ('TOPPADDING',    (0,1), (-1,-1), 5),
        ('BOTTOMPADDING', (0,1), (-1,-1), 5),
        ('ROWBACKGROUNDS',(0,1), (-1,-1), [WHITE, colors.HexColor('#f1f5f9')]),
        ('GRID',          (0,0), (-1,-1), 0.3, colors.HexColor('#cbd5e1')),
        ('VALIGN',        (0,0), (-1,-1), 'MIDDLE'),
    ]))
    return t

def new_doc(filename, title_text, accent=None):
    path = os.path.join(OUTPUT_DIR, filename)
    d = SimpleDocTemplate(path, pagesize=A4,
                          leftMargin=2*cm, rightMargin=2*cm,
                          topMargin=2.2*cm, bottomMargin=1.5*cm)
    return d, make_page_callbacks(title_text, accent=accent)

def body(text):
    return Paragraph(text, S_BODY)

def sp(n=6):
    return Spacer(1, n)

def role_divider(title, accent):
    s = ParagraphStyle('div', fontName='Helvetica-Bold', fontSize=18,
                       textColor=WHITE, alignment=TA_CENTER)
    t = Table([[Paragraph(title, s)]], colWidths=[17*cm], rowHeights=[2*cm])
    t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1), accent),
                            ('VALIGN',(0,0),(-1,-1),'MIDDLE')]))
    return t

# ════════════════════════════════════════════════════════
# PDF 1 — Recruiter Guide
# ════════════════════════════════════════════════════════
def pdf1():
    d, cb = new_doc('01_Recruiter_Guide.pdf',
                    'AVIIN ATS  |  Recruiter Training Guide')
    e = []
    e.append(sp(60))
    e.append(build_cover(['AVIIN ATS', 'RECRUITER TRAINING GUIDE'],
                         'Learn to source, add, and manage candidates effectively', GREEN))
    e.append(sp(8))
    e.append(body('Role: Recruiter  |  Audience: All recruiting staff  |  Version: 2026'))
    e.append(PageBreak())

    e.append(section_header('Section 1: How to Login', GREEN))
    e.append(sp())
    e.append(pro_table(
        ['Step', 'Action', 'Detail'],
        [['1','Open Browser','Navigate to https://ats.aviinjobs.com'],
         ['2','Enter Credentials','Type your registered email and password'],
         ['3','Click Login','Press the green Login button'],
         ['4','Access Dashboard','You will land on the main ATS dashboard']],
        [1.5*cm, 5*cm, 10.5*cm]))
    e.append(sp())
    e.append(body('Tip: Bookmark https://ats.aviinjobs.com for quick access. Use the Forgot Password link if needed.'))
    e.append(sp(12))

    e.append(section_header('Section 2: Adding Candidates', GREEN))
    e.append(sp())
    e.append(pro_table(
        ['Field', 'Type', 'Notes'],
        [['Full Name',  'Text',   'First + Last name, no initials'],
         ['Email',      'Email',  'Primary contact email'],
         ['Phone',      'Number', '10-digit mobile number'],
         ['Location',   'Text',   'City or City, State'],
         ['Experience', 'Number', 'In months (e.g., 24 for 2 years)'],
         ['CTC',        'Number', 'Annual CTC in rupees (e.g., 500000)'],
         ['Skills',     'Tags',   'Comma-separated skills'],
         ['Source',     'Select', 'Naukri / LinkedIn / Referral / Walk-in / Other']],
        [4*cm, 3*cm, 10*cm]))
    e.append(sp(12))

    e.append(section_header('Section 3: Pipeline Stages', GREEN))
    e.append(sp())
    e.append(pro_table(
        ['Stage', 'Meaning', 'Your Action'],
        [['SOURCED',   'Candidate identified',       'Review profile, shortlist if suitable'],
         ['SCREENED',  'Initial screening done',     'Call candidate, confirm interest & basics'],
         ['SUBMITTED', 'Profile sent to client',     'Await client feedback, follow up in 48h'],
         ['INTERVIEW', 'Interview scheduled',        'Share JD, confirm time, prep candidate'],
         ['OFFER',     'Offer letter released',      'Confirm acceptance, collect documents'],
         ['PLACED',    'Candidate joined',           'Update date of joining, raise invoice'],
         ['REJECTED',  'Not moving forward',         'Add reason, recycle if possible']],
        [3*cm, 6*cm, 8*cm]))
    e.append(sp(12))

    e.append(section_header('Section 4: AI Match Scores', GREEN))
    e.append(sp())
    e.append(pro_table(
        ['Score Range', 'Rating', 'Action'],
        [['70% and above', 'Strong Match', 'Prioritise — submit to client immediately'],
         ['40% to 69%',    'Good Match',   'Review manually before submitting'],
         ['Below 40%',     'Poor Match',   'Skip or park for future roles']],
        [4*cm, 4*cm, 9*cm]))
    e.append(sp(12))

    e.append(section_header('Section 5: Experience Conversion Table', GREEN))
    e.append(sp())
    e.append(pro_table(
        ['Years', 'Months to Enter'],
        [['1 year','12'],['2 years','24'],['3 years','36'],['4 years','48'],
         ['5 years','60'],['6 years','72'],['7 years','84'],['8 years','96'],
         ['9 years','108'],['10 years','120']],
        [8.5*cm, 8.5*cm]))
    e.append(sp(12))

    e.append(section_header('Section 6: CTC Conversion Table', GREEN))
    e.append(sp())
    e.append(pro_table(
        ['CTC (LPA)', 'Enter in Rupees'],
        [['5 LPA','500,000'],['10 LPA','1,000,000'],['15 LPA','1,500,000'],
         ['20 LPA','2,000,000'],['25 LPA','2,500,000'],['30 LPA','3,000,000']],
        [8.5*cm, 8.5*cm]))

    d.build(e, onFirstPage=cb, onLaterPages=cb)
    print('Generated 01_Recruiter_Guide.pdf')

# ════════════════════════════════════════════════════════
# PDF 2 — Lead Recruiter Guide
# ════════════════════════════════════════════════════════
def pdf2():
    d, cb = new_doc('02_Lead_Recruiter_Guide.pdf',
                    'AVIIN ATS  |  Lead Recruiter Training Guide', PURPLE)
    e = []
    e.append(sp(60))
    e.append(build_cover(['LEAD RECRUITER', 'TRAINING GUIDE'],
                         'Monitor team performance, manage automation & SLA compliance', PURPLE))
    e.append(sp(8))
    e.append(body('Role: Lead Recruiter  |  Audience: Team leads & senior recruiters  |  Version: 2026'))
    e.append(PageBreak())

    e.append(section_header('Section 1: Dashboard Monitoring', PURPLE))
    e.append(sp())
    e.append(body('Log in daily and check these key metrics on your lead dashboard:'))
    e.append(sp())
    e.append(pro_table(
        ['Metric', 'What It Shows', 'Target'],
        [['Open Jobs',    'Active job requirements',             'Know each JD in detail'],
         ['Candidates',   'Total profiles in your pipeline',    'Keep it updated daily'],
         ['Pipeline',     'Candidates across all stages',       'No stale entries > 7 days'],
         ['SLA Breaches', 'Jobs/candidates past time limits',   'Must be zero each morning'],
         ['Placed/Month', 'Successful placements this month',   'Track against team target']],
        [3.5*cm, 8.5*cm, 5*cm], PURPLE))
    e.append(sp(12))

    e.append(section_header('Section 2: Automation Rules', PURPLE))
    e.append(sp())
    e.append(body('The ATS runs these automated rules every hour. Understand them so you can audit exceptions:'))
    e.append(sp())
    e.append(pro_table(
        ['Rule Name', 'Trigger Condition', 'Action Taken'],
        [['Auto-Screen',    'Experience >= 4 years (48 months)', 'Move to SCREENED automatically'],
         ['Auto-Submit',    'AI match score >= 50%',             'Flag for submission review'],
         ['Auto-Interview', 'AI match score >= 65%',             'Schedule interview prompt sent']],
        [4*cm, 7*cm, 6*cm], PURPLE))
    e.append(sp())
    e.append(body('Note: Automation rules do not replace human review. Always validate before final submission to client.'))
    e.append(sp(12))

    e.append(section_header('Section 3: Copilot Priority Queue', PURPLE))
    e.append(sp())
    e.append(body('The AI Copilot surfaces the following priority items at the top of your dashboard each morning:'))
    e.append(sp())
    e.append(pro_table(
        ['Priority', 'What It Means', 'Action'],
        [['Submit Today', 'Profiles ready for client submission',    'Review and send immediately'],
         ['Follow Up',    'Awaiting response > 48 hours',           'Call or message the client'],
         ['At Risk',      'SLA approaching breach in < 4 hours',    'Escalate or reassign'],
         ['Interviews',   'Interviews scheduled in next 24 hours',  'Confirm with candidate & client'],
         ['Offers',       'Offers pending acceptance > 48 hours',   'Follow up, push for closure']],
        [3*cm, 7*cm, 7*cm], PURPLE))
    e.append(sp(12))

    e.append(section_header('Section 4: SLA Status Monitoring', PURPLE))
    e.append(sp())
    e.append(pro_table(
        ['Status', 'Colour Indicator', 'Meaning', 'Action Required'],
        [['OK',     'Green',  'Within SLA time limit',             'No action needed'],
         ['WARN',   'Yellow', 'Approaching SLA breach (< 4h)',     'Prioritise immediately'],
         ['BREACH', 'Red',    'SLA time limit exceeded',           'Escalate to manager now']],
        [2.5*cm, 3*cm, 6*cm, 5.5*cm], PURPLE))

    d.build(e, onFirstPage=cb, onLaterPages=cb)
    print('Generated 02_Lead_Recruiter_Guide.pdf')

# ════════════════════════════════════════════════════════
# PDF 3 — KAE Guide
# ════════════════════════════════════════════════════════
def pdf3():
    d, cb = new_doc('03_KAE_Guide.pdf',
                    'AVIIN ATS  |  KAE Training Guide', CYAN)
    e = []
    e.append(sp(60))
    e.append(build_cover(['KAE', 'TRAINING GUIDE'],
                         'Key Account Executive — Managing client requirements & submissions', CYAN))
    e.append(sp(8))
    e.append(body('Role: Key Account Executive (KAE)  |  Audience: Client-facing account executives  |  Version: 2026'))
    e.append(PageBreak())

    e.append(section_header('Section 1: Creating Job Requirements', CYAN))
    e.append(sp())
    e.append(body('When a client sends a new requirement, create a Job in the ATS immediately. Fill all 7 sections:'))
    e.append(sp())
    e.append(pro_table(
        ['Section', 'Fields to Fill', 'Notes'],
        [['1. Basic Info',       'Job Title, Client Name, Location',          'Exact title as given by client'],
         ['2. Experience',       'Min and Max experience in years',           'Convert to months internally'],
         ['3. CTC Range',        'Min CTC, Max CTC',                          'Enter in rupees, not LPA'],
         ['4. Skills',           'Mandatory skills, Good-to-have skills',     'Separate with commas'],
         ['5. Job Description',  'Full JD text',                              'Paste verbatim from client email'],
         ['6. SLA',              'Submission deadline, positions count',      'Confirm with client if unclear'],
         ['7. Internal Notes',   'Client preferences, avoid companies list',  'Confidential, not shown to candidate']],
        [3*cm, 7*cm, 7*cm], CYAN))
    e.append(sp(12))

    e.append(section_header('Section 2: Submission Quality Checklist', CYAN))
    e.append(sp())
    e.append(pro_table(
        ['#', 'Check Item', 'Pass Criteria'],
        [['1','Experience matches requirement',         'Within client-specified range'],
         ['2','CTC is within budget',                  'Not more than max CTC specified'],
         ['3','Mandatory skills present',              'At least 80% of must-have skills'],
         ['4','Current location or willing to relocate','Confirmed verbally with candidate'],
         ['5','Notice period acceptable',              'Within client timeline'],
         ['6','No duplicate submission',               'Check ATS for same candidate + same client'],
         ['7','Resume is updated',                     'Last updated within 6 months']],
        [0.8*cm, 7*cm, 9.2*cm], CYAN))
    e.append(sp(12))

    e.append(section_header('Section 3: Interview Coordination Steps', CYAN))
    e.append(sp())
    e.append(pro_table(
        ['Step', 'Who', 'Action'],
        [['1','KAE',       'Receive interview slot from client'],
         ['2','KAE',       'Confirm slot with candidate — get written confirmation'],
         ['3','KAE',       'Share JD, interview panel name, location/link'],
         ['4','Recruiter', 'Brief the candidate on company & role'],
         ['5','KAE',       'Send calendar invite to candidate and client panel'],
         ['6','KAE',       'Day-before reminder call to candidate'],
         ['7','KAE',       'Post-interview: collect feedback from client within 24h'],
         ['8','KAE',       'Update ATS stage (OFFER / REJECTED) with reason']],
        [1*cm, 3*cm, 13*cm], CYAN))
    e.append(sp(12))

    e.append(section_header('Section 4: Revenue Tracking Metrics', CYAN))
    e.append(sp())
    e.append(pro_table(
        ['Metric', 'How to Calculate', 'Where to View'],
        [['Submission Rate', 'Submissions / Open Positions x 100', 'KAE Dashboard'],
         ['Interview Rate',  'Interviews / Submissions x 100',     'KAE Dashboard'],
         ['Offer Rate',      'Offers / Interviews x 100',          'KAE Dashboard'],
         ['Join Rate',       'Joined / Offers x 100',              'KAE Dashboard'],
         ['Revenue per Hire','CTC x Billing % (typically 8.33%)',  'Finance Report'],
         ['Monthly Target',  'Placements x Avg Revenue per Hire',  'Monthly Review']],
        [4*cm, 7*cm, 6*cm], CYAN))

    d.build(e, onFirstPage=cb, onLaterPages=cb)
    print('Generated 03_KAE_Guide.pdf')

# ════════════════════════════════════════════════════════
# PDF 4 — KAM Guide
# ════════════════════════════════════════════════════════
def pdf4():
    d, cb = new_doc('04_KAM_Guide.pdf',
                    'AVIIN ATS  |  KAM Training Guide', AMBER)
    e = []
    e.append(sp(60))
    e.append(build_cover(['KAM', 'TRAINING GUIDE'],
                         'Key Account Manager — Executive oversight, funnel analysis & collections', AMBER))
    e.append(sp(8))
    e.append(body('Role: Key Account Manager (KAM)  |  Audience: Senior management  |  Version: 2026'))
    e.append(PageBreak())

    e.append(section_header('Section 1: CEO Dashboard Metrics', AMBER))
    e.append(sp())
    e.append(body('Review the CEO dashboard each morning. Current live values as of June 2026:'))
    e.append(sp())
    e.append(pro_table(
        ['Metric', 'Current Value', 'Target', 'Status'],
        [['Total Candidates',  '147',   '200+', 'On track'],
         ['Interview Rate',    '36.8%', '40%+', 'Needs attention'],
         ['Join Rate',         '50%',   '60%+', 'Needs attention'],
         ['Placed This Month', '4',     '8+',   'Below target'],
         ['Open Positions',    '12',    '-',    'Active'],
         ['SLA Breaches',      '0',     '0',    'Good']],
        [5*cm, 3.5*cm, 3.5*cm, 5*cm], AMBER))
    e.append(sp(12))

    e.append(section_header('Section 2: Recruitment Funnel Drop Analysis', AMBER))
    e.append(sp())
    e.append(pro_table(
        ['Funnel Stage', 'Drop Rate', 'Common Reason', 'KAM Action'],
        [['Sourced -> Screened',    'Varies', 'Profile does not meet basic criteria', 'Review JD quality'],
         ['Screened -> Submitted',  'Varies', 'Candidate declined / unavailable',    'Increase sourcing volume'],
         ['Submitted -> Interview', '63.2%',  'Client rejection rate high',           'Improve submission quality'],
         ['Interview -> Offer',     'Varies', 'Poor performance / mismatch',          'Better candidate briefing'],
         ['Offer -> Joined',        '50%',    'Counter-offer / change of mind',        'Strengthen offer follow-up']],
        [4*cm, 2.5*cm, 5.5*cm, 5*cm], AMBER))
    e.append(sp(12))

    e.append(section_header('Section 3: Collections Tracking', AMBER))
    e.append(sp())
    e.append(pro_table(
        ['Status', 'Criteria', 'Action', 'Escalate To'],
        [['On Time',  'Payment received by due date',    'No action needed',              '-'],
         ['Due Soon', '< 7 days to payment due date',   'Send payment reminder email',   'KAM if no response'],
         ['Overdue',  'Past payment due date',           'Call client, send formal notice','MD / Finance Head']],
        [2.5*cm, 5*cm, 5*cm, 4.5*cm], AMBER))
    e.append(sp())
    e.append(body('All placement invoices must be raised within 48 hours of the candidate joining. Track in the Finance module.'))

    d.build(e, onFirstPage=cb, onLaterPages=cb)
    print('Generated 04_KAM_Guide.pdf')

# ════════════════════════════════════════════════════════
# PDF 5 — Admin Guide
# ════════════════════════════════════════════════════════
def pdf5():
    d, cb = new_doc('05_Admin_Guide.pdf',
                    'AVIIN ATS  |  Admin Training Guide', RED)
    e = []
    e.append(sp(60))
    e.append(build_cover(['ADMIN', 'TRAINING GUIDE'],
                         'System administration — users, permissions, integrations & automation', RED))
    e.append(sp(8))
    e.append(body('Role: Administrator  |  Audience: System admins & IT leads  |  Version: 2026'))
    e.append(PageBreak())

    e.append(section_header('Section 1: Role Permissions Matrix', RED))
    e.append(sp())
    e.append(body('Each role has predefined access. Admins can add or revoke permissions from Settings > Users:'))
    e.append(sp())
    e.append(pro_table(
        ['Permission', 'Recruiter', 'Lead', 'KAE', 'KAM', 'Admin'],
        [['Add Candidates',          'Yes',      'Yes',   'No',  'No',  'Yes'],
         ['Edit Candidates',         'Own only', 'Team',  'No',  'No',  'Yes'],
         ['View All Candidates',     'No',       'Yes',   'Yes', 'Yes', 'Yes'],
         ['Create Job Postings',     'No',       'No',    'Yes', 'Yes', 'Yes'],
         ['Submit to Client',        'No',       'Yes',   'Yes', 'Yes', 'Yes'],
         ['View Reports',            'No',       'Team',  'Own', 'All', 'All'],
         ['Manage Users',            'No',       'No',    'No',  'No',  'Yes'],
         ['Configure Automation',    'No',       'No',    'No',  'No',  'Yes'],
         ['View Finance',            'No',       'No',    'No',  'Yes', 'Yes'],
         ['WhatsApp / Integrations', 'No',       'No',    'No',  'No',  'Yes']],
        [5*cm, 2.4*cm, 2.4*cm, 2.4*cm, 2.4*cm, 2.4*cm], RED))
    e.append(sp(12))

    e.append(section_header('Section 2: WhatsApp Integration Setup', RED))
    e.append(sp())
    e.append(pro_table(
        ['Step', 'Action', 'Where'],
        [['1', 'Go to Settings > Integrations > WhatsApp',                            'Admin panel'],
         ['2', 'Enter WhatsApp Business API Token',                                   'From Meta Business Manager'],
         ['3', 'Enter Phone Number ID',                                               'From Meta developer dashboard'],
         ['4', 'Enter Verify Token (create your own secret)',                          'Settings form'],
         ['5', 'Save and click Test Connection',                                       'Settings form'],
         ['6', 'Set webhook URL in Meta to: https://ats.aviinjobs.com/api/v1/whatsapp/webhook', 'Meta dashboard'],
         ['7', 'Verify the webhook handshake succeeds',                               'Meta dashboard shows green tick']],
        [0.8*cm, 10.2*cm, 6*cm], RED))
    e.append(sp(12))

    e.append(section_header('Section 3: Daily Automation Schedule', RED))
    e.append(sp())
    e.append(pro_table(
        ['Time', 'Job Name', 'What It Does'],
        [['01:00', 'Process Recurring',   'Generate invoices from recurring templates'],
         ['06:00', 'SLA Checker',         'Flag SLA breaches, send Copilot alerts'],
         ['08:00', 'AI Score Refresh',    'Re-score candidates against active jobs'],
         ['09:00', 'WhatsApp Summary',    'Send daily pipeline summary to KAMs'],
         ['12:00', 'Auto-Screen Run',     'Apply automation rules to new candidates'],
         ['18:00', 'Follow-up Reminders', 'Send reminders for stale pipeline entries'],
         ['23:00', 'Report Generation',   'Build end-of-day placement & revenue report']],
        [2*cm, 5*cm, 10*cm], RED))

    d.build(e, onFirstPage=cb, onLaterPages=cb)
    print('Generated 05_Admin_Guide.pdf')

# ════════════════════════════════════════════════════════
# PDF 6 — Complete Training Manual
# ════════════════════════════════════════════════════════
def pdf6():
    d, cb = new_doc('00_Complete_Training_Manual.pdf',
                    'AVIIN ATS  |  Complete Training Manual', GREEN)
    e = []

    # Master cover
    e.append(sp(40))
    e.append(build_cover(
        ['AVIIN ATS', 'COMPLETE TRAINING MANUAL', 'ALL ROLES'],
        'Recruiter  |  Lead Recruiter  |  KAE  |  KAM  |  Admin', GREEN))
    e.append(sp(8))
    e.append(body('This manual combines all five role-specific guides into a single reference document.'))
    e.append(sp(4))
    e.append(body('Sections: A. Recruiter  B. Lead Recruiter  C. KAE  D. KAM  E. Admin'))
    e.append(PageBreak())

    # ── SECTION A: Recruiter ─────────────────────────────────────────────
    e.append(role_divider('SECTION A  —  RECRUITER GUIDE', GREEN))
    e.append(sp(10))

    e.append(section_header('How to Login', GREEN))
    e.append(sp())
    e.append(pro_table(
        ['Step', 'Action', 'Detail'],
        [['1','Open Browser','Navigate to https://ats.aviinjobs.com'],
         ['2','Enter Credentials','Type your registered email and password'],
         ['3','Click Login','Press the green Login button'],
         ['4','Access Dashboard','You will land on the main ATS dashboard']],
        [1.5*cm, 5*cm, 10.5*cm]))
    e.append(sp(8))

    e.append(section_header('Adding Candidates', GREEN))
    e.append(sp())
    e.append(pro_table(
        ['Field', 'Type', 'Notes'],
        [['Full Name',  'Text',   'First + Last name, no initials'],
         ['Email',      'Email',  'Primary contact email'],
         ['Phone',      'Number', '10-digit mobile number'],
         ['Location',   'Text',   'City or City, State'],
         ['Experience', 'Number', 'In months (e.g., 24 for 2 years)'],
         ['CTC',        'Number', 'Annual CTC in rupees (e.g., 500000)'],
         ['Skills',     'Tags',   'Comma-separated skills'],
         ['Source',     'Select', 'Naukri / LinkedIn / Referral / Walk-in / Other']],
        [4*cm, 3*cm, 10*cm]))
    e.append(sp(8))

    e.append(section_header('Pipeline Stages', GREEN))
    e.append(sp())
    e.append(pro_table(
        ['Stage', 'Meaning', 'Your Action'],
        [['SOURCED',   'Candidate identified',    'Review profile, shortlist if suitable'],
         ['SCREENED',  'Initial screening done',  'Call candidate, confirm interest & basics'],
         ['SUBMITTED', 'Profile sent to client',  'Await client feedback, follow up in 48h'],
         ['INTERVIEW', 'Interview scheduled',     'Share JD, confirm time, prep candidate'],
         ['OFFER',     'Offer letter released',   'Confirm acceptance, collect documents'],
         ['PLACED',    'Candidate joined',        'Update date of joining, raise invoice'],
         ['REJECTED',  'Not moving forward',      'Add reason, recycle if possible']],
        [3*cm, 6*cm, 8*cm]))
    e.append(sp(8))

    e.append(section_header('AI Scores', GREEN))
    e.append(sp())
    e.append(pro_table(
        ['Score Range', 'Rating', 'Action'],
        [['70% and above', 'Strong Match', 'Prioritise — submit to client immediately'],
         ['40% to 69%',    'Good Match',   'Review manually before submitting'],
         ['Below 40%',     'Poor Match',   'Skip or park for future roles']],
        [4*cm, 4*cm, 9*cm]))
    e.append(sp(8))

    e.append(section_header('Experience & CTC Conversion', GREEN))
    e.append(sp())
    # side-by-side tables via outer Table
    exp_t = pro_table(
        ['Years', 'Months'],
        [['1 year','12'],['2 years','24'],['3 years','36'],['4 years','48'],
         ['5 years','60'],['6 years','72'],['7 years','84'],['8 years','96'],
         ['9 years','108'],['10 years','120']],
        [4*cm, 4*cm])
    ctc_t = pro_table(
        ['CTC (LPA)', 'Rupees'],
        [['5 LPA','500,000'],['10 LPA','1,000,000'],['15 LPA','1,500,000'],
         ['20 LPA','2,000,000'],['25 LPA','2,500,000'],['30 LPA','3,000,000']],
        [4*cm, 5*cm])
    side = Table([[exp_t, ctc_t]], colWidths=[8.4*cm, 8.6*cm])
    side.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),
                               ('LEFTPADDING',(0,0),(-1,-1),0),
                               ('RIGHTPADDING',(0,0),(-1,-1),4)]))
    e.append(side)
    e.append(PageBreak())

    # ── SECTION B: Lead Recruiter ────────────────────────────────────────
    e.append(role_divider('SECTION B  —  LEAD RECRUITER GUIDE', PURPLE))
    e.append(sp(10))

    e.append(section_header('Dashboard Monitoring', PURPLE))
    e.append(sp())
    e.append(pro_table(
        ['Metric', 'What It Shows', 'Target'],
        [['Open Jobs',    'Active job requirements',          'Know each JD in detail'],
         ['Candidates',   'Total profiles in your pipeline',  'Keep it updated daily'],
         ['Pipeline',     'Candidates across all stages',     'No stale entries > 7 days'],
         ['SLA Breaches', 'Jobs/candidates past time limits', 'Must be zero each morning'],
         ['Placed/Month', 'Successful placements this month', 'Track against team target']],
        [3.5*cm, 8.5*cm, 5*cm], PURPLE))
    e.append(sp(8))

    e.append(section_header('Automation Rules', PURPLE))
    e.append(sp())
    e.append(pro_table(
        ['Rule Name', 'Trigger Condition', 'Action Taken'],
        [['Auto-Screen',    'Experience >= 4 years (48 months)', 'Move to SCREENED automatically'],
         ['Auto-Submit',    'AI match score >= 50%',             'Flag for submission review'],
         ['Auto-Interview', 'AI match score >= 65%',             'Schedule interview prompt sent']],
        [4*cm, 7*cm, 6*cm], PURPLE))
    e.append(sp(8))

    e.append(section_header('Copilot Priority Queue', PURPLE))
    e.append(sp())
    e.append(pro_table(
        ['Priority', 'What It Means', 'Action'],
        [['Submit Today', 'Profiles ready for client submission',   'Review and send immediately'],
         ['Follow Up',    'Awaiting response > 48 hours',          'Call or message the client'],
         ['At Risk',      'SLA approaching breach in < 4 hours',   'Escalate or reassign'],
         ['Interviews',   'Interviews scheduled in next 24 hours', 'Confirm with candidate & client'],
         ['Offers',       'Offers pending acceptance > 48 hours',  'Follow up, push for closure']],
        [3*cm, 7*cm, 7*cm], PURPLE))
    e.append(sp(8))

    e.append(section_header('SLA Status Monitoring', PURPLE))
    e.append(sp())
    e.append(pro_table(
        ['Status', 'Colour', 'Meaning', 'Action Required'],
        [['OK',     'Green',  'Within SLA time limit',         'No action needed'],
         ['WARN',   'Yellow', 'Approaching SLA breach (< 4h)', 'Prioritise immediately'],
         ['BREACH', 'Red',    'SLA time limit exceeded',       'Escalate to manager now']],
        [2.5*cm, 3*cm, 6*cm, 5.5*cm], PURPLE))
    e.append(PageBreak())

    # ── SECTION C: KAE ──────────────────────────────────────────────────
    e.append(role_divider('SECTION C  —  KAE GUIDE', CYAN))
    e.append(sp(10))

    e.append(section_header('Creating Job Requirements', CYAN))
    e.append(sp())
    e.append(pro_table(
        ['Section', 'Fields to Fill', 'Notes'],
        [['1. Basic Info',      'Job Title, Client Name, Location',         'Exact title as given by client'],
         ['2. Experience',      'Min and Max experience in years',          'Convert to months internally'],
         ['3. CTC Range',       'Min CTC, Max CTC',                         'Enter in rupees, not LPA'],
         ['4. Skills',          'Mandatory skills, Good-to-have skills',    'Separate with commas'],
         ['5. JD',              'Full JD text',                             'Paste verbatim from client email'],
         ['6. SLA',             'Submission deadline, positions count',     'Confirm with client if unclear'],
         ['7. Internal Notes',  'Client preferences, avoid companies list', 'Confidential']],
        [3*cm, 7*cm, 7*cm], CYAN))
    e.append(sp(8))

    e.append(section_header('Submission Quality Checklist', CYAN))
    e.append(sp())
    e.append(pro_table(
        ['#', 'Check Item', 'Pass Criteria'],
        [['1','Experience matches requirement',          'Within client-specified range'],
         ['2','CTC is within budget',                   'Not more than max CTC specified'],
         ['3','Mandatory skills present',               'At least 80% of must-have skills'],
         ['4','Location / willing to relocate',         'Confirmed verbally with candidate'],
         ['5','Notice period acceptable',               'Within client timeline'],
         ['6','No duplicate submission',                'Check ATS for same candidate + same client'],
         ['7','Resume is updated',                      'Last updated within 6 months']],
        [0.8*cm, 7*cm, 9.2*cm], CYAN))
    e.append(sp(8))

    e.append(section_header('Interview Coordination Steps', CYAN))
    e.append(sp())
    e.append(pro_table(
        ['Step', 'Who', 'Action'],
        [['1','KAE',       'Receive interview slot from client'],
         ['2','KAE',       'Confirm slot with candidate — get written confirmation'],
         ['3','KAE',       'Share JD, interview panel name, location/link'],
         ['4','Recruiter', 'Brief the candidate on company & role'],
         ['5','KAE',       'Send calendar invite to candidate and client panel'],
         ['6','KAE',       'Day-before reminder call to candidate'],
         ['7','KAE',       'Post-interview: collect feedback from client within 24h'],
         ['8','KAE',       'Update ATS stage (OFFER / REJECTED) with reason']],
        [1*cm, 3*cm, 13*cm], CYAN))
    e.append(sp(8))

    e.append(section_header('Revenue Tracking Metrics', CYAN))
    e.append(sp())
    e.append(pro_table(
        ['Metric', 'How to Calculate', 'Where to View'],
        [['Submission Rate', 'Submissions / Open Positions x 100', 'KAE Dashboard'],
         ['Interview Rate',  'Interviews / Submissions x 100',     'KAE Dashboard'],
         ['Offer Rate',      'Offers / Interviews x 100',          'KAE Dashboard'],
         ['Join Rate',       'Joined / Offers x 100',              'KAE Dashboard'],
         ['Revenue per Hire','CTC x Billing % (typically 8.33%)',  'Finance Report'],
         ['Monthly Target',  'Placements x Avg Revenue per Hire',  'Monthly Review']],
        [4*cm, 7*cm, 6*cm], CYAN))
    e.append(PageBreak())

    # ── SECTION D: KAM ──────────────────────────────────────────────────
    e.append(role_divider('SECTION D  —  KAM GUIDE', AMBER))
    e.append(sp(10))

    e.append(section_header('CEO Dashboard Metrics', AMBER))
    e.append(sp())
    e.append(pro_table(
        ['Metric', 'Current Value', 'Target', 'Status'],
        [['Total Candidates',  '147',   '200+', 'On track'],
         ['Interview Rate',    '36.8%', '40%+', 'Needs attention'],
         ['Join Rate',         '50%',   '60%+', 'Needs attention'],
         ['Placed This Month', '4',     '8+',   'Below target'],
         ['Open Positions',    '12',    '-',    'Active'],
         ['SLA Breaches',      '0',     '0',    'Good']],
        [5*cm, 3.5*cm, 3.5*cm, 5*cm], AMBER))
    e.append(sp(8))

    e.append(section_header('Recruitment Funnel Drop Analysis', AMBER))
    e.append(sp())
    e.append(pro_table(
        ['Funnel Stage', 'Drop Rate', 'Common Reason', 'KAM Action'],
        [['Sourced -> Screened',    'Varies', 'Profile does not meet basic criteria', 'Review JD quality'],
         ['Screened -> Submitted',  'Varies', 'Candidate declined / unavailable',     'Increase sourcing volume'],
         ['Submitted -> Interview', '63.2%',  'Client rejection rate high',           'Improve submission quality'],
         ['Interview -> Offer',     'Varies', 'Poor performance / mismatch',          'Better candidate briefing'],
         ['Offer -> Joined',        '50%',    'Counter-offer / change of mind',       'Strengthen offer follow-up']],
        [4*cm, 2.5*cm, 5.5*cm, 5*cm], AMBER))
    e.append(sp(8))

    e.append(section_header('Collections Tracking', AMBER))
    e.append(sp())
    e.append(pro_table(
        ['Status', 'Criteria', 'Action', 'Escalate To'],
        [['On Time',  'Payment received by due date',  'No action needed',              '-'],
         ['Due Soon', '< 7 days to payment due date',  'Send payment reminder email',   'KAM if no response'],
         ['Overdue',  'Past payment due date',          'Call client, send formal notice','MD / Finance Head']],
        [2.5*cm, 5*cm, 5*cm, 4.5*cm], AMBER))
    e.append(PageBreak())

    # ── SECTION E: Admin ────────────────────────────────────────────────
    e.append(role_divider('SECTION E  —  ADMIN GUIDE', RED))
    e.append(sp(10))

    e.append(section_header('Role Permissions Matrix', RED))
    e.append(sp())
    e.append(pro_table(
        ['Permission', 'Recruiter', 'Lead', 'KAE', 'KAM', 'Admin'],
        [['Add Candidates',          'Yes',      'Yes',   'No',  'No',  'Yes'],
         ['Edit Candidates',         'Own only', 'Team',  'No',  'No',  'Yes'],
         ['View All Candidates',     'No',       'Yes',   'Yes', 'Yes', 'Yes'],
         ['Create Job Postings',     'No',       'No',    'Yes', 'Yes', 'Yes'],
         ['Submit to Client',        'No',       'Yes',   'Yes', 'Yes', 'Yes'],
         ['View Reports',            'No',       'Team',  'Own', 'All', 'All'],
         ['Manage Users',            'No',       'No',    'No',  'No',  'Yes'],
         ['Configure Automation',    'No',       'No',    'No',  'No',  'Yes'],
         ['View Finance',            'No',       'No',    'No',  'Yes', 'Yes'],
         ['WhatsApp / Integrations', 'No',       'No',    'No',  'No',  'Yes']],
        [5*cm, 2.4*cm, 2.4*cm, 2.4*cm, 2.4*cm, 2.4*cm], RED))
    e.append(sp(8))

    e.append(section_header('WhatsApp Integration Setup', RED))
    e.append(sp())
    e.append(pro_table(
        ['Step', 'Action', 'Where'],
        [['1', 'Go to Settings > Integrations > WhatsApp',                               'Admin panel'],
         ['2', 'Enter WhatsApp Business API Token',                                      'Meta Business Manager'],
         ['3', 'Enter Phone Number ID',                                                  'Meta developer dashboard'],
         ['4', 'Enter Verify Token (create your own secret)',                             'Settings form'],
         ['5', 'Save and click Test Connection',                                          'Settings form'],
         ['6', 'Set webhook URL in Meta: https://ats.aviinjobs.com/api/v1/whatsapp/webhook', 'Meta dashboard'],
         ['7', 'Verify the webhook handshake succeeds',                                  'Meta dashboard']],
        [0.8*cm, 10.2*cm, 6*cm], RED))
    e.append(sp(8))

    e.append(section_header('Daily Automation Schedule', RED))
    e.append(sp())
    e.append(pro_table(
        ['Time', 'Job Name', 'What It Does'],
        [['01:00', 'Process Recurring',   'Generate invoices from recurring templates'],
         ['06:00', 'SLA Checker',         'Flag SLA breaches, send Copilot alerts'],
         ['08:00', 'AI Score Refresh',    'Re-score candidates against active jobs'],
         ['09:00', 'WhatsApp Summary',    'Send daily pipeline summary to KAMs'],
         ['12:00', 'Auto-Screen Run',     'Apply automation rules to new candidates'],
         ['18:00', 'Follow-up Reminders', 'Send reminders for stale pipeline entries'],
         ['23:00', 'Report Generation',   'Build end-of-day placement & revenue report']],
        [2*cm, 5*cm, 10*cm], RED))

    d.build(e, onFirstPage=cb, onLaterPages=cb)
    print('Generated 00_Complete_Training_Manual.pdf')

# ── Run all ──────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    pdf1()
    pdf2()
    pdf3()
    pdf4()
    pdf5()
    pdf6()
    print('All PDFs generated successfully.')
