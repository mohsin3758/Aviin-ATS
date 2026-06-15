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
| P0 | Infrastructure (Docker + DB + schemas + RLS) | NEXT | ⏳ | Run finstack-setup.sh (adjust paths to ~/airecruit) |
| P1 | Foundation APIs (candidate, req, pipeline, offer) | ⏳ | ⏳ | Depends on P0 |
| P2 | Automation (n8n workflows W1-W8) | ⏳ | ⏳ | Depends on P1 |
| P3 | AI Engine (match, assign, rediscovery) | ⏳ | ⏳ | Depends on P2 |
| P4 | Frontend Foundation (GlobalNav + shared components + design system) | ⏳ | ⏳ | Depends on P1; needs UI template decision (see Pending Inputs) |
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

These define the 5 selectable UI templates and the full
competitor-feature-parity checklist. Re-check P4-P10 scope against
these once available — do not treat current P4-P10 descriptions as final.

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
