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
| P0 | Infrastructure (Docker + DB + schemas + RLS) | NEXT | ⏳ | No pre-existing setup script — write docker-compose.yml + sql/*.sql + .env from scratch per CLAUDE.md TECH STACK / TARGET DB sections |
| P1 | Foundation APIs (candidate, req, pipeline, offer) | ⏳ | ⏳ | Depends on P0 |
| P2 | Automation (n8n workflows W1-W8) | ⏳ | ⏳ | Depends on P1 |
| P3 | AI Engine (match, assign, rediscovery) | ⏳ | ⏳ | Depends on P2 |
| P4 | Frontend Foundation (GlobalNav + shared components + 5-template theme system) | ⏳ | ⏳ | Depends on P1; 5 templates defined in docs/ui_templates.md — build data-theme/Zustand/Tailwind-variant infra here |
| P5 | UI T1: Recruiter Command Center | ⏳ | ⏳ | Depends on P4 |
| P6 | UI T2: Kanban Pipeline Board | ⏳ | ⏳ | Depends on P4 |
| P7 | UI T3: Candidate 360 View | ⏳ | ⏳ | Depends on P4 |
| P8 | UI T4: Analytics BI Dashboard | ⏳ | ⏳ | Depends on P4 |
| P9 | UI T5: CEO War Room | ⏳ | ⏳ | Depends on P4 |
| P10 | UI T6: Finance ERP Dashboard | ⏳ | ⏳ | Depends on P4 |
| P11 | WhatsApp + WAHA integration | ⏳ | ⏳ | Depends on P1 |
| P12 | Timesheet + Payroll ERP | ⏳ | ⏳ | Depends on P1 |
| P13 | BGV + Trust Intelligence | ⏳ | ⏳ | Depends on P1 |
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
