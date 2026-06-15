# FinStack Staffing OS (AIrecruit) — Phase Status Tracker

## Project Info
- Product: FinStack Staffing OS, repo name `airecruit`
- VPS: 187.127.179.128 (srv1747263.hstgr.cloud), repo at ~/airecruit
- Domain: TBD — do not assume finstack.aviinjobs.com (see CLAUDE.md)
- Stack: FastAPI + Next.js + PostgreSQL + pgvector + Ollama + n8n
- Zero-Token: No external LLM API. No GPU. BGE-small + Qwen2.5-1.5B CPU only.
- Goal: AI/Automation/ATS feature parity-or-better vs top staffing-industry
  competitors, 5 selectable UI templates (see Pending Inputs)

## Phase Status Table

| Phase | Name | Status | QA | Notes |
|-------|------|--------|-----|-------|
| P0 | Infrastructure (Docker + DB + schemas + RLS) | NEXT | ⏳ | No pre-existing setup script — write docker-compose.yml + sql/*.sql + .env from scratch per CLAUDE.md TECH STACK / TARGET DB sections. Also add `ai_jobs`, `ai_cache` (+`prompt_embedding vector(384)`), `audit_log`, `assignment_event`, `consent_records` tables (see Zero-Cost Architecture Review) |
| P1 | Foundation APIs (candidate, req, pipeline, offer) | ⏳ | ⏳ | Depends on P0. Add `interview_scorecards` endpoints + HITL pause-for-approval gate on offer/reject/reassign actions (logs to `assignment_event`/`audit_log`) + `consent_records` read/write endpoints (see Zero-Cost Architecture Review) |
| P2 | Automation (n8n workflows W1-W8) | ⏳ | ⏳ | Depends on P1. Workflows touching offer/reject/reassign must pause at the HITL approval gate added in P1 (see Zero-Cost Architecture Review) |
| P3 | AI Engine (match, assign, rediscovery) | ⏳ | ⏳ | Depends on P2. Add `backend/ai_router.py` (single cascade-enforcement module: Tier0→1→2 + semantic cache via `ai_cache.prompt_embedding` >0.95 cosine) + AI eval golden-datasets/agent-replay/cache-hit-rate QA (see Zero-Cost Architecture Review) |
| P4 | Frontend Foundation (GlobalNav + shared components + 5-template theme system) | ⏳ | ⏳ | Depends on P1; 5 templates defined in docs/ui_templates.md — build data-theme/Zustand/Tailwind-variant infra here. Also establish a11y (WCAG 2.2 AA) + i18n (14+ languages) baseline and WebSocket/SSE real-time infra (see Zero-Cost Architecture Review) |
| P5 | UI T1: Recruiter Command Center | ⏳ | ⏳ | Depends on P4 |
| P6 | UI T2: Kanban Pipeline Board | ⏳ | ⏳ | Depends on P4. Includes client/hiring-manager read-only portal (Competitor Benchmark gap) + candidate self-service portal — apply, track status, self-schedule (Zero-Cost Architecture Review gap) + live WebSocket/SSE pipeline updates |
| P7 | UI T3: Candidate 360 View | ⏳ | ⏳ | Depends on P4. Includes async video screening + skills assessment/MCQ+coding test UI tab (Competitor Benchmark gaps) |
| P8 | UI T4: Analytics BI Dashboard | ⏳ | ⏳ | Depends on P4. Include named predictive models: offer-drop risk, hiring-difficulty (see Zero-Cost Architecture Review) |
| P9 | UI T5: CEO War Room | ⏳ | ⏳ | Depends on P4. Include named predictive models: retention risk, capacity-vs-demand (see Zero-Cost Architecture Review) |
| P10 | UI T6: Finance ERP Dashboard | ⏳ | ⏳ | Depends on P4 |
| P11 | WhatsApp + WAHA integration | ⏳ | ⏳ | Depends on P1. Broaden to include Email (SMTP) + SMS comms channels alongside WhatsApp, plus multilingual (14+ languages) support (see Zero-Cost Architecture Review) |
| P12 | Timesheet + Payroll ERP | ⏳ | ⏳ | Depends on P1. Apply pgcrypto field-level encryption to Aadhaar/PAN/PF/bank-account columns (see Zero-Cost Architecture Review) |
| P13 | BGV + Trust Intelligence | ⏳ | ⏳ | Depends on P1. Add `trust_graph`/`talent_graph` adjacency tables, offer-letter generation + onboarding e-sign via Aadhaar OTP/DigiLocker, and pgcrypto field-level encryption for Aadhaar/PAN/PF/bank-account columns (see Zero-Cost Architecture Review) |
| P14 | VPS Deploy (SSL + domain + production) | ⏳ | ⏳ | LAST — needs all phases + domain decision |

## Pending Inputs
Awaiting PDF conversions from the user of:
- FinStack_Staffing_OS_Master_Blueprint
- FinStack_Final_Dev_Blueprint
- FinStack_Master_Architecture_Review
- FinStack_UI_UX_Todos
- FinStack_Complete_Guide

The "5 selectable UI templates" item is now RESOLVED — see
`docs/ui_templates.md` (defined against the competitor landscape,
P4 unblocked). The full competitor-feature-parity checklist is also
resolved — see `docs/competitor_landscape_and_feature_blueprint.md`.
If/when the PDFs above are provided, use them only to refine
per-template visual details and P4-P10 specifics — they should not
change the template count (5), the theme-switcher mechanism, or the
P0-P14 phase numbering.

## Competitor Benchmark & Gap Additions (2026-06-15)
Full analysis: `docs/competitor_landscape_and_feature_blueprint.md`
(~100 vendors across staffing ATS/CRM, enterprise ATS, AI sourcing,
conversational AI, automation, communication, video, assessments,
BGV, payroll/ERP, job boards — mapped to AIrecruit's zero-token
modules and P0-P14 phases). Four gap items identified, to implement
as sub-tasks of the noted phase (no new phase numbers):
- Async video screening -> sub-task of P7 (Candidate 360)
- Skills assessment / MCQ + coding test, rule-based scoring -> P3 (backend) + P7 (UI tab)
- Job-board distribution (Naukri/Indeed/LinkedIn posting via n8n) -> P2 workflow W9
- Client/hiring-manager read-only portal -> P6 (Kanban, read-only mode for `client` role)

## Zero-Cost Architecture Review (2026-06-15)
Full analysis: `docs/zerocost_architecture_review.md` — cross-check of a
second, independent "14-Discipline Build Specification" PDF against the
current plan and the Competitor Benchmark above.

**Validation**: the PDF's Zero-Cost Model/Four Levers table independently
confirms the existing zero-token cascade (rules+n8n+OCR Tier0, BGE-small+
pgvector Tier1, Qwen2.5-via-Ollama cached Tier2-lite, Postgres+pgvector+RLS,
`event_outbox` instead of Kafka, single no-GPU VPS) — **no architectural
pivot required**.

16 additive gaps identified, folded into the Notes column of the phase
table above (no new phase numbers): candidate self-service portal (P6),
Postgres-based `ai_jobs` async queue (P0/P3), central `backend/ai_router.py`
(P3), embedding-similarity semantic cache via `ai_cache.prompt_embedding`
(P0/P3), HITL approval gates on offer/reject/reassign (new HARD RULE #10 +
P1/P2), `audit_log`/`assignment_event` append-only tables (P0), broader
`consent_records` DPDP subsystem (P0/P1, HARD RULE #12), pgcrypto
field-level encryption for Aadhaar/PAN/PF/bank columns (new HARD RULE #11 +
P0/P12/P13), `interview_scorecards` (P1/P6/P7), Email+SMS comms channels
(P11), offer/onboarding e-sign via Aadhaar/DigiLocker (P13), named
predictive models — offer-drop/hiring-difficulty (P8), retention/capacity-
vs-demand (P9), a11y (WCAG 2.2 AA) + i18n 14+ languages (P4/P11), real-time
WebSocket/SSE (P4/P6), AI eval/golden-dataset/agent-replay/cache-hit-rate QA
(P3), and `trust_graph`/`talent_graph` adjacency tables (P13).

CLAUDE.md already updated: HARD RULES expanded 9→12 (#10 HITL, #11
encryption, #12 broad consent), TECH STACK gained the `ai_jobs` job-queue
line, ZERO-TOKEN CASCADE gained the AI Router bullet, and a new "TARGET DB
TABLES — additions from zerocost_architecture_review.md" section lists the
6 new tables above with their target phase.

## Deferred / Future (P15+ candidates)
The PDF's "Stage 5: Agents + Beyond" items are explicitly NOT part of
P0-P14 — out of scope for now, revisit only post-launch:
- CRM / BD pipeline for the agency's own sales (leads/deals) — sister
  FinStack HR product has an equivalent (its P9.8)
- VMS integration (Fieldglass/Beeline-style vendor-management submission)
- GraphQL read layer (optional REST alternative)
- Data warehouse + dbt (DuckDB/ClickHouse CDC) — a Postgres analytics
  replica is sufficient at current scale
- Voice AI / strong autonomous agents — infeasible on CPU, only revisit
  if a GPU is ever added

## How to Update This File
After each phase completes ALL Playwright tests:
1. Change status from ⏳ to ✅ DONE
2. Add QA result (tests passed/total)
3. Add brief notes on what was built
4. Update CLAUDE.md phase status section
5. Run /compact then start next phase

## Architecture Rules (append after each phase)
- [P0] RLS enforced: every table has tenant_id + FORCE RLS
- [P0] app_user is non-superuser — never connect as postgres
- [P0] vector(384) only — BGE-small dimensions locked
- [P0] event_outbox written in same tx as business change
- [P0] dedup_key required on every event_outbox row
