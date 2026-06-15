# FinStack Staffing OS (AIrecruit) — Autopilot Mode

## What Autopilot Does
Runs the FinStack Staffing OS roadmap end-to-end, phase by phase,
WITHOUT waiting for user input between phases.

## Autopilot Prompt (paste this to start full autopilot)
```
Run the FinStack Staffing OS roadmap end-to-end, phase by phase,
without waiting for user input between phases.

Phase queue (current phase = first marked NEXT in CLAUDE.md):
P0.  Infrastructure - Docker up, schemas applied, RLS test passed, seed+embed done
P1.  Backend APIs - all FastAPI endpoints for candidates/reqs/pipeline/offers
P2.  n8n Workflows - W1-W8 automation workflows built and activated
P3.  AI Engine - match, assign, rediscovery endpoints wired
P4.  Frontend Foundation - GlobalNav, TenantProvider, shared components
P5.  UI T1 - Recruiter Command Center (app/dashboard/page.tsx)
P6.  UI T2 - Kanban Pipeline Board (app/pipeline/[req_id]/page.tsx)
P7.  UI T3 - Candidate 360 View (app/candidates/[id]/page.tsx)
P8.  UI T4 - Analytics BI Dashboard (app/analytics/page.tsx)
P9.  UI T5 - CEO War Room (app/command-center/page.tsx)
P10. UI T6 - Finance ERP Dashboard (app/finance/page.tsx)
P11. WhatsApp - WAHA integration + consent-gated outreach
P12. ERP - Timesheet + Payroll + Billing endpoints
P13. BGV - Trust Intelligence + India verification APIs
P14. VPS Deploy - domain + SSL + production

All phases are purely additive - do not modify or regress any existing feature.

For each phase apply this template:
[Px] [name]. Build backend+frontend. Run Playwright QA. Run
`bash scripts/zerotoken-check.sh` (must print CONFIRMED CLEAN).
Fix errors. Update CLAUDE.md + FINSTACK_MASTER_INDEX.md. Code only.
No stops.

After each phase finishes with ALL Playwright tests passing:
1. Run `bash scripts/zerotoken-check.sh` — must print "ZERO-TOKEN
   CASCADE: CONFIRMED CLEAN". If it reports a violation, replace the
   offending call with the local cascade (Ollama/BGE/pgvector/OCR)
   before continuing — this is a HARD RULE, not optional.
2. Update CLAUDE.md (add architecture-rule + mark phase DONE + next NEXT)
3. Update FINSTACK_MASTER_INDEX.md (status row + QA result)
4. Run /compact to free context
5. Immediately start next phase - no user input needed

STOP CONDITIONS (pause and report to user):
- Playwright test fails and cannot be fixed after 3 attempts
- zerotoken-check.sh reports a violation that can't be resolved with
  the local cascade (i.e. the feature genuinely requires a paid
  external API) — STOP and ask the user before adding it
- Blocking error (missing credentials, DB unreachable, migration conflict)
- VPS Deploy (P14): STOP and ask for domain + SSL details first
- User types: STOP
```

## Single Phase Prompt Template
```
[P1] Backend APIs.
Build backend+frontend.
Run Playwright QA at tests/qa_automation.spec.ts.
Fix all failures.
Update CLAUDE.md + FINSTACK_MASTER_INDEX.md.
Code only. No stops.
```

## Token Budget Per Phase
- Use /compact after every phase
- Use /clear between unrelated tasks
- Target: complete P0-P3 in one long session with /compact between
- Target: P4-P10 UI phases in separate sessions (one per day)
