# AIrecruit — Competitor Landscape & Feature Blueprint (P0 reference)

Purpose: before P0 starts, lock in the feature/module list AIrecruit
must hit to be "best-in-class, all-in-one" for staffing agencies,
benchmarked against ~100 real ATS/AI/Automation vendors — while
keeping every AI capability on the Zero-Token cascade (no
OpenAI/Anthropic/Gemini calls, ever). Source: industry knowledge as
of mid-2025; re-verify pricing/specifics per-vendor only if a feature
decision hinges on it (don't burn tokens re-researching all 100).

## 1. Competitor landscape, by category (~100 vendors)

### A. Staffing-focused ATS/CRM (direct competitors)
Bullhorn, JobDiva, Ceipal (CEIPAL ATS), Crelate, Vincere, TempWorks,
Avionté (Bold), COATS Staffing Software, AkkenCloud, TargetRecruit,
Erecruit, PCRecruiter, JobAdder, Zoho Recruit, Recruit CRM,
Recruiterflow, Manatal, Firefish Software, Top Echelon (ATS/Big
Biller), Mercury xRM, Staffing Engine, RealHQ, ATS OnContracting,
Bond Adapt, Sense (CRM layer on top of ATS)

### B. Enterprise/corporate ATS (feature-parity targets)
Workday Recruiting, SAP SuccessFactors Recruiting, Oracle Recruiting
Cloud, iCIMS, SmartRecruiters, Greenhouse, Lever, Ashby, JazzHR,
Workable, Breezy HR, BambooHR, Recruitee, Teamtailor, Personio,
ApplicantStack, ClearCompany, Paycor Recruiting

### C. AI sourcing & talent intelligence
SeekOut, hireEZ (Hiretual), Loxo, Eightfold AI, Beamery, Phenom
People, Gem, Findem, Entelo, TalentBin, Textkernel, Daxtra, Sovren,
HiredScore

### D. Conversational AI / chatbots / screening
Paradox (Olivia), XOR, Mya Systems, Humanly, Wade & Wendy, Brazen,
Jobvite Chatbot, Sense AI Chat

### E. Automation / workflow / integration
Bullhorn Automation (Herefish), Zapier, Make (Integromat), Workato,
n8n (self-hosted — our engine)

### F. Communication (SMS/WhatsApp/email)
TextUs, Emissary, Sense Messaging, WhatsApp Business API
(360dialog/Twilio/WAHA), SendGrid/Mailchimp drip campaigns

### G. Video interviewing
HireVue, VidCruiter, Spark Hire, Willo, myInterview, Indeed
Interview Scheduler

### H. Assessments / skills testing
HackerRank, Codility, Mercer Mettl, Vervoe, Pymetrics, TestGorilla,
iMocha, Criteria Corp

### I. Background verification (India-focused, P13)
SpringVerify, AuthBridge, IDfy, HireRight, First Advantage, Checkr

### J. Payroll / billing / back-office ERP for staffing
Bullhorn Back Office, PrismHR, TempWorks Financials, Asanify, Keka,
GreytHR, Zoho Payroll

### K. Job-board / sourcing channels (integration targets)
LinkedIn Recruiter, Naukri, Indeed, Monster, Dice, ZipRecruiter,
Glassdoor, Shine, TimesJobs

## 2. Capability → AIrecruit zero-token module → phase

| Capability seen across competitors | Representative vendors | AIrecruit zero-token equivalent | Phase |
|---|---|---|---|
| Candidate/job/pipeline ATS core | Bullhorn, JobDiva, Ceipal, Crelate | Postgres schema + FastAPI CRUD | P1 |
| Client CRM, hotlist, submittals, placements | Bullhorn CRM, Vincere, TargetRecruit | `10_phase1_staffing_additions.sql` | P1 |
| Resume parsing | Daxtra, Sovren, Textkernel | Tesseract+OpenCV OCR + regex/rule extraction [T0] | P1/P3 |
| AI candidate-job matching/ranking | SeekOut, hireEZ, Loxo AI, Eightfold | `match_candidates()` — BGE-small + pgvector cosine [T1] | P3 |
| Recruiter workload/capacity AI | Eightfold, Beamery | `match_recruiters()` + `v_recruiter_capacity` [T1] | P3 |
| Explainable auto-assignment | Eightfold, HiredScore | `assign_with_explanation()` [T0/T1] | P3 |
| SLA/stalled-pipeline alerts | Bullhorn Automation, Sense | `find_sla_breaches()`, `find_stalled_assignments()` [T0] + n8n | P2/P3 |
| Bench/redeployment management | Vincere, AkkenCloud | `v_redeployment_queue` [T0] | P3 |
| Workflow automation, drip sequences | Herefish, Zapier, Workato | n8n workflows W1-W8 | P2 |
| Conversational AI screening | Paradox Olivia, XOR, Mya | WAHA + Qwen2.5/Ollama [T2-lite, cached] | P11 |
| SMS/WhatsApp engagement | TextUs, Sense Messaging | WAHA, consent-gated | P11 |
| JD generation | Paradox, Eightfold, GPT plugins | Ollama Qwen2.5 + `ai_cache` [T2-lite] | P3 |
| Kanban pipeline board | Crelate, Loxo, Greenhouse | T2 UI `app/pipeline/[req_id]` | P6 |
| Candidate 360 profile | Bullhorn, Vincere | T3 UI `app/candidates/[id]` | P7 |
| Recruiter command center | Bullhorn Analytics, Sense | T1 UI `app/dashboard` | P5 |
| BI/analytics (funnel, time-to-fill, skill gaps) | Bullhorn/JobDiva/Crelate Analytics | T4 UI + `v_agency_funnel`, `v_skill_gap` | P8 |
| Executive dashboard | Custom BI / Tableau exec views | T5 UI `app/command-center` | P9 |
| Timesheet/payroll/billing (back office) | Bullhorn Back Office, PrismHR, TempWorks | T6 UI + P12 ERP endpoints | P10/P12 |
| Background verification | SpringVerify, AuthBridge, IDfy, HireRight | India verification APIs | P13 |
| Video interviewing | HireVue, VidCruiter, Spark Hire | **gap — see §3** | candidate for P7 add-on |
| Skills assessment/testing | HackerRank, Mercer Mettl, TestGorilla | **gap — see §3** | candidate for P3 add-on |
| Job-board distribution | LinkedIn, Naukri, Indeed, Dice | **gap — see §3** | candidate for P2 add-on |
| Client/hiring-manager self-serve view | Greenhouse, Lever portals | **gap — see §3** | candidate for P6/P7 add-on |

## 3. Gaps vs. top-100 — recommended additions (lightweight, fold into existing phases, no new phase numbers)

1. **Async video screening** — candidate records a short video answer
   via browser (WebRTC → file on disk); recruiter reviews from
   Candidate 360. Optional local transcription via `whisper.cpp`
   (CPU, zero token). Fold into **P7** as an optional tab.
2. **Skills assessment / MCQ + short coding test** — rule-based
   auto-scoring (no LLM needed: exact-match/keyword/unit-test
   scoring). Fold into **P3** (`assessments` table + scoring
   function) with a UI tab in **P7**.
3. **Job-board distribution** — n8n workflow posts a requisition's JD
   to Naukri/Indeed/LinkedIn via their posting APIs (subscription
   cost is the vendor's, not an LLM token — doesn't break Rule 1).
   Fold into **P2** as workflow W9.
4. **Client/hiring-manager portal** — read-only view of a client's
   open requisitions + submitted candidates + status, JWT-scoped to
   `client` role. Fold into **P6** (reuses the Kanban board,
   read-only mode) rather than a new UI template.

These four are *additive* — they don't change the P0-P14 numbering in
`FINSTACK_MASTER_INDEX.md`. Implement them as sub-tasks of the phase
noted, when that phase comes up.

## 4. End-to-end workflow

```
Requisition created
  -> JD auto-generated (Ollama, cached)                [T2-lite]
  -> AI candidate matching (BGE + pgvector)            [T1]
  -> Explainable auto-assign to recruiter              [T0/T1]
  -> WhatsApp/SMS outreach (consent-gated)             [n8n + WAHA]
  -> AI screening chat + optional skills test/video    [T2-lite]
  -> Kanban pipeline: Submitted -> Interview -> Offer -> Placed
  -> SLA monitors / stalled-pipeline alerts            [T0 + n8n]
  -> Placement -> timesheet -> billing -> payroll      [P12 ERP]
  -> Redeployment queue (21 days before contract end)  [T0]
  -> BGV if required                                   [P13]
  -> Rollups -> BI dashboards (T4 Analytics / T5 CEO War Room)
```

## 5. UI templates mapped to roles
- **T1 Recruiter Command Center** — daily queue, SLA alerts, quick actions
- **T2 Kanban Pipeline Board** — per-requisition drag/drop pipeline (+ client read-only mode)
- **T3 Candidate 360** — profile, resume, AI fit score, history, video/assessment tabs
- **T4 Analytics BI** — funnel, time-to-fill, skill-gap charts
- **T5 CEO War Room** — company-wide KPIs, revenue, placements
- **T6 Finance/ERP** — timesheets, invoices, payroll, billing

## 6. Positioning
AIrecruit matches Bullhorn/Ceipal/Vincere on core ATS+CRM,
SeekOut/hireEZ/Loxo on AI matching, Paradox/XOR on conversational
screening, and Bullhorn Automation/Zapier on workflow automation —
with **$0 marginal AI cost** (local embeddings + local LLM + rules).
Every other vendor above either charges a per-seat AI add-on or
routes through a paid external LLM API. That is the headline
differentiator to build the 5-template UI around.
