# FinStack Staffing OS (AIrecruit)
## AUTO-LOADED EVERY SESSION — DO NOT DELETE

## REPO / NAMING NOTE
This repo lives at `~/airecruit` on the dev VPS. Across the blueprint
docs the product's internal codename is "FinStack Staffing OS" — same
product, same repo as "AIrecruit". This is a SEPARATE, unrelated
product from the FinStack HR/Payroll SaaS (different company project,
different codebase, different domain). Never share code, DB schema,
ports, or domains between the two.

## PRODUCT IDENTITY
A Zero-Token AI Staffing/ATS Operating System for staffing agencies.
India-first. No external LLM API. No GPU. No per-token cost. Goal:
feature/UI parity-or-better vs top ATS/recruitment-automation
competitors, delivered with 5 selectable UI templates.

VPS: 187.127.179.128 (srv1747263.hstgr.cloud) | OS: Ubuntu 24.04
DOMAIN: TBD — confirm with user before P14. Do NOT default to
finstack.aviinjobs.com — that subdomain may already be used by an
unrelated FinStack HR/Payroll deployment for the same company.

## UI TEMPLATES (5 selectable — defined, P4 unblocked)
Full spec: docs/ui_templates.md — Enterprise Classic, Modern SaaS,
Minimal/Focus, AI Command Center, Mobile-First/Field. Implemented as
a `data-theme` attribute + Zustand persist + Tailwind variant plugin
(same pattern as the sister FinStack product's theme switcher).
Build this infrastructure as part of P4 (Frontend Foundation) so
every later UI phase (P5-P10) is theme-aware from the start.

## TECH STACK
- Backend:    FastAPI (Python) + asyncpg
- Frontend:   Next.js 14 + TypeScript + Tailwind CSS + ShadCN UI
- Database:   PostgreSQL 16 + pgvector extension
- Embeddings: BGE-small-en-v1.5 (384 dims) at http://embed:8081
- Generation: Qwen2.5-1.5B via Ollama at http://ollama:11434
- Job queue:  Postgres-based `ai_jobs` table polled by a worker (NOT
              Redis/Celery/BullMQ — keeps footprint lean on 7.8GB RAM)
              for async Tier-2 generation (JD drafts, summaries, FAQ)
- Automation: n8n self-hosted at http://n8n:5678
- WhatsApp:   WAHA at http://waha:3000
- OCR:        Tesseract + OpenCV (CPU, free)
- Auth:       JWT (tenant_id + role + user_id claims)
- Icons:      lucide-react
- Charts:     recharts

## ZERO-TOKEN CASCADE (NEVER BREAK)
- Tier 0 (~70%): PostgreSQL rules + n8n + regex + OCR — FREE
- Tier 1 (~20%): BGE-small embeddings + pgvector — FREE (CPU)
- Tier 2-lite (~10%): Qwen via Ollama async+cached — FREE (CPU)
- AI ROUTER (P3): `backend/ai_router.py` is the ONE module every AI
  call passes through — dispatches Tier0→1→2, enforces HARD RULES
  #1/#3/#4, and does the semantic-cache lookup before any Ollama call

## HARD RULES — ZERO TOLERANCE
1. NEVER call OpenAI/Anthropic/Gemini or any external LLM API
2. NEVER connect to DB as postgres superuser (bypasses RLS)
3. ALWAYS vector(384) for all embeddings (BGE-small only)
4. ALWAYS make Ollama calls async via the AI Router + cache in
   `ai_cache` — cache lookup is by embedding similarity (>0.95 cosine
   on `ai_cache.prompt_embedding vector(384)`), not just exact-hash
5. ALWAYS write event_outbox in SAME DB transaction as business change
6. ALWAYS set dedup_key on every event_outbox row
7. WhatsApp ALWAYS requires a consent record first (India DPDP 2023) —
   one instance of rule 12 below
8. ALL n8n PostgreSQL nodes MUST SET app.tenant_id first
9. ALWAYS connect as app_user (password: apppw) NEVER postgres
10. High-stakes actions (offer issued, candidate rejected, recruiter
    reassigned) ALWAYS pause for human approval (HITL gate) and log to
    `assignment_event`/`audit_log` — never fully autonomous on these
11. ALWAYS encrypt Aadhaar/PAN/PF/bank-account columns at rest
    (pgcrypto field-level encryption) — applies to P12/P13 data
12. ALWAYS write a `consent_records` row before storing/processing ANY
    candidate PII (DPDP 2023), not just WhatsApp

## VPS RESOURCES (checked 2026-06-15)
96GB disk (93GB free), 7.8GB RAM (5.5GB free), Docker 29.5.3 +
Compose v5.1.4, `dev` user in both `sudo` and `docker` groups (no
sudo prefix needed for docker commands). Node 20.20.2 / Python 3.12.3
on host. 7.8GB RAM is workable but not generous once Postgres + Ollama
+ n8n + FastAPI + Next.js + WAHA (P11, Chromium-based like Playwright)
are all running together — if containers start OOM-killing in later
phases, stagger non-essential services or add swap rather than
removing the zero-token local-AI services.

## DATABASE CONNECTION (target — created in P0)
- Host: db (inside Docker) / localhost:5432 (outside)
- Database: ats
- App role: app_user / apppw (non-superuser, RLS enforced)
- Per request: set_config('app.tenant_id', '<uuid>', true)

## TARGET DB FUNCTIONS (build in P1/P3 — these signatures are the contract)
- match_candidates(req_id, limit)      → ranked by cosine [T1]
- match_recruiters(req_id, limit)      → ranked by skill [T1]
- assign_with_explanation(req_id)      → auto-assign+score [T0/T1]
- find_stalled_assignments(hours)      → stalled assignments [T0]
- find_sla_breaches()                  → SLA past due [T0]
- do_reassign(assignment_id, reason)   → reassign+audit [T0/T1]

## TARGET DB VIEWS (build in P1/P3)
- v_redeployment_queue   → contractors ending in 21 days
- v_agency_funnel        → submittals→placements per client
- v_recruiter_capacity   → workload vs capacity
- v_skill_gap            → skill demand vs supply

## TARGET DB TABLES — additions from zerocost_architecture_review.md (build in phase noted)
- ai_jobs                → P0 schema, P3 worker — Postgres-based async queue for Tier-2 generation
- ai_cache               → P0 schema — adds prompt_embedding vector(384) for >0.95 cosine semantic-cache hits (HARD RULE #4)
- audit_log              → P0 schema — append-only, partitioned by month
- assignment_event       → P0 schema — append-only; also written on every HITL approval (HARD RULE #10)
- consent_records        → P0/P1 — per data-category DPDP consent (HARD RULE #12; WhatsApp consent is one row type)
- interview_scorecards   → P1 — structured interview kits/scorecards
- trust_graph            → P13 — talent/trust graph adjacency table

## TARGET DB TABLES — Compensation & Incentive Framework (P15-P17)
Full spec: docs/compensation_incentive_framework.md — ALL zero-token (pure SQL/rules, no LLM).

P15 tables:
- recruiter_kpi_scores        → monthly 100-pt scorecard per recruiter (grades D/C/B/A/A+, payout ranges)
- recruiter_advanced_kpis     → monthly advanced metrics (offer_drop_rate, no_show_pct, 90-day retention, etc.)
- candidate_retention_tracking→ per placement (days_employed → 0/50/75/100% credit at <30/30-60/60-90/90+d)
- incentive_records           → 70% immediate / 30% retention bank split per month, calc from Contribution Margin
- retention_bank              → 30% hold with quarterly/half-yearly/annual release; forfeited on resignation
- loyalty_milestones          → 1/2/3/5yr bonuses (₹15k/30k/50k/1L) per user

P16 tables:
- kae_kpi_scores              → monthly KAE scorecard (Client Retention 30%, Account Growth 25%, Collection 20%, Satisfaction 15%, Compliance 10%)
- kae_incentives              → retention/growth/collection/satisfaction bonuses per KAE per period
- client_owners               → 3-owner rule per client (kae_id, founder_id, backup_id) — no single-point dependency
- account_visibility          → L1-L5 visibility level per user per client (RLS-enforced)
- kae_client_retention        → per-client retention start date + milestone trigger tracking

P17 tables:
- account_pl                  → per client per month (revenue, company_share 20%, delivery_pool 80%)
- delivery_pool_allocations   → per account_pl (recruiter_incentives, sourcing, referral, kae, growth_reserve, op_reserve)
- contribution_margins        → Revenue - Delivery Cost - Incentives - OpCost = CM (incentives capped if CM<0)
- collection_records          → per client/invoice (amount_collected, kae_id, milestone_triggered)
- bu_eligibility              → KAE BU readiness (tenure≥18m, loyalty+retention+growth scores, eligible_for_bu flag)

P17 views:
- v_account_pl                → visibility-gated L3+
- v_recruiter_revenue         → revenue per recruiter per period (leaderboard for CEO Dashboard)
- v_kae_revenue               → revenue per KAE per period
- v_90day_retention           → 90-day retention rate per recruiter
- v_collection_aging          → overdue collection aging per client (KAE: own accounts; Founder: all)

## PROJECT FILES (paths relative to repo root ~/airecruit)
- sql/01_phase1_schema.sql              — Phase 1 foundation
- sql/10_phase1_staffing_additions.sql  — hotlist/submittal/placement
- sql/05_phase2_schema.sql              — automation schema
- sql/09_phase3_schema.sql              — AI engine schema
- sql/00_app_role.sql                   — app_user role
- backend/app.py                        — FastAPI backend
- backend/embed_writer.py               — vector column filler
- backend/seed_data.py                  — India demo data
- embed/embed_service.py                — BGE-small service
- docker-compose.yml                    — all 7 services
- tests/qa_automation.spec.ts           — Playwright QA tests
- CLAUDE.md                             — this file (auto-loaded)
- FINSTACK_MASTER_INDEX.md              — phase status tracker

## PHASE STATUS (source of truth — keep in sync with FINSTACK_MASTER_INDEX.md)
- [✅]    P0:  Infrastructure — DONE (3/3)
- [✅]    P1:  Backend APIs — DONE (5/5)
- [✅]    P2:  n8n Workflows W1-W9 — DONE (5/5)
- [✅]    P3:  AI Engine — DONE (10/10)
- [✅]    P4:  Frontend Foundation — DONE (18/18)
- [✅]    P5:  UI T1 Recruiter Command Center — DONE (21/21)
- [✅]    P6:  UI T2 Kanban Pipeline Board — DONE (24/24)
- [✅]    P7:  UI T3 Candidate 360 View — DONE (28/28)
- [✅]    P8:  UI T4 Analytics BI Dashboard — DONE (32/32)
- [✅]    P9:  UI T5 CEO War Room — DONE (35/35)
- [✅]    P10: UI T6 Finance ERP Dashboard — DONE (28/28)
- [✅]    P11: WhatsApp + WAHA (14-language, DPDP) — DONE (34/34)
- [✅]    P12: ERP Timesheet + Payroll (pgcrypto) — DONE (40/40)
- [✅]    P13: BGV + Trust Intelligence — DONE (46/46)
- [✅]    P14: VPS Deploy (nginx/SSL, domain=TBD) — DONE (52/52)
- [NEXT] P15: Recruiter Performance & Incentive Engine
- [ ]     P16: KAE Module & Account Ownership
- [ ]     P17: Account Financial Framework & CEO Dashboard Extensions

## PENDING INPUTS (blocks finalizing P4-P10 detail)
Awaiting PDF conversions of these blueprint docs from the user:
- FinStack_Staffing_OS_Master_Blueprint
- FinStack_Final_Dev_Blueprint
- FinStack_Master_Architecture_Review
- FinStack_UI_UX_Todos
- FinStack_Complete_Guide
These define the 5 selectable UI templates and the full
feature/competitor-parity checklist. Until reviewed, treat P4-P10
scope as provisional — do not narrow it further without checking
these once available.

## TOKEN-SAVING COMMANDS
- /init          — create/refresh CLAUDE.md
- /compact       — compress long session (saves ~40%)
- /clear         — fresh start for new task (saves ~30%)
- Precise prompts save ~60% vs vague ones
- Specific file targeting saves ~50%

## MODEL SWITCHING RULES
- `/model haiku` (~60% cheaper) — simple tasks: read files, check
  syntax, verify code, fix small bugs, run/inspect test output
- `/model sonnet` (default) — complex tasks: build features, install
  packages, DB migrations/schema changes, deploy, architecture
  decisions
- Switch back to sonnet before any multi-file feature work or schema
  change — don't let a haiku session drift into building a phase

## TOKEN-SAVING STRATEGY (target: ~99% reduction vs naive usage)
These compound — apply ALL of them, every phase:
- CLAUDE.md auto-load context              ~70%
- /compact after each phase                ~40%
- Precise, one-line prompts                ~60%
- Playwright auto-QA (no manual debugging) ~80%
- AGENTS.md cross-tool rules               ~75%
- Custom slash commands (/qa /phase ...)   ~70%
- Self-healing AUTO-FIX RULES (below)      ~85%
- Autopilot mode (no stop-and-ask)         ~90%
- /model haiku for simple sub-tasks        ~60%
During /compact, check this list — a technique not in active use on a
phase is a token leak; fix it before starting the next phase.

## AUTO-FIX RULES (self-healing — expand this list as new errors appear)
- Backend container crash → `docker compose logs backend`, fix the
  env var/import error, `docker compose up -d --build backend`
- DB connection refused → check `db` healthcheck (`docker compose
  ps`), confirm app_user/apppw match between .env and docker-compose
- "relation does not exist" → re-run sql/*.sql migrations in order
  against the `ats` db; check RLS policy wasn't applied before the
  table existed
- Embeddings dimension mismatch → confirm embed service returns
  384-dim vectors (BGE-small-en-v1.5); never resize the vector column
- Ollama model missing → `docker exec finstack_ollama ollama pull
  qwen2.5:1.5b-instruct-q4_K_M`
- n8n workflow not firing / returns 0 rows → confirm `SET
  app.tenant_id` is the first node in that workflow's Postgres query
- Frontend 404 on a new route → confirm the route exists under `app/`
  (Next 14 app router), rebuild the frontend container
- Playwright login timeout → confirm seed_data.py ran and the demo
  user exists; check backend `/health` first
- Claude usage-limit hit mid-phase → do NOT stop; let
  scripts/claude-auto-resume.sh detect it and auto-send "continue"
  (see 24/7 OPERATION) — never silently abandon a phase

## ZERO-TOKEN AUDIT (run at the end of EVERY phase)
`bash scripts/zerotoken-check.sh` scans the full repo (code + config
+ env + compose files) for any reference to a paid/external AI API
(OpenAI, Anthropic, Gemini, Cohere, Mistral, Together, Replicate,
Groq, Bedrock, Vertex AI, HF Inference API, etc.) and must print
"ZERO-TOKEN CASCADE: CONFIRMED CLEAN". A violation = HARD RULE
breach — fix by routing through the local cascade (Ollama Qwen2.5 /
BGE-small embeddings / pgvector / Tesseract+OpenCV OCR), never by
adding a key. Use `--diff` for a quick pre-commit check on changed
files only.

## AUTOPILOT MODE
When told "autopilot" — run phases end-to-end without stopping, per
docs/autopilot.md. After each phase: run the ZERO-TOKEN AUDIT above,
update CLAUDE.md + FINSTACK_MASTER_INDEX.md, run Playwright QA, fix
failures, then start next phase automatically. Stop ONLY on: test
failure after retry, an unresolvable zero-token violation, blocking
error, or user types STOP.

## 24/7 OPERATION
Claude Code is already logged in (OAuth/Pro subscription, NOT an API
key) inside tmux session `dev` (window 0, `dev:0.0`) on this VPS —
that login persists across rate limits and reconnects. ALL development
happens on the VPS, never the local laptop.

**Bypass Permissions mode is ACTIVE** (since 2026-06-15) — `dev:0.0`
runs `claude --continue --dangerously-skip-permissions`, so Claude
proceeds through Bash/file-edit tool calls with ZERO confirmation
prompts. This is required for true unattended 24/7 autopilot (default
permission mode would otherwise stall on the first Bash command with
no one available to approve it). The one-time "WARNING: Bypass
Permissions mode" dialog has already been accepted on this VPS and
that acceptance is persisted — subsequent `claude --continue
--dangerously-skip-permissions` launches do NOT re-show it. Tradeoff
accepted by the user: this VPS is a dedicated dev sandbox for this
project only.

- scripts/status-check.sh — phase status + tmux/docker snapshot
- scripts/claude-auto-resume.sh — RUNNING 24/7 in `dev:1` (tmux window
  "monitor", restarted 2026-06-15 with bypass-permissions support).
  Monitor-only, watches `dev:0.0` every 30s and handles 3 cases with
  ZERO manual input:
  1. Usage/rate limit hit (5-HOUR OR WEEKLY limit, any wording) ->
     retry loop: sends "continue" on a backoff (15min for 5hr-style
     limits, 2h for weekly-sounding ones), rechecks, keeps retrying
     until the limit message clears, then resumes automatically. No
     reset-time parsing required — works regardless of message format.
  2. Claude Code process exited to a shell prompt -> auto-restarts
     with `claude --continue --dangerously-skip-permissions` (resumes
     prior conversation, CLAUDE.md reloads automatically, no
     permission prompts) and re-sends the autopilot resume prompt
     ("read FINSTACK_MASTER_INDEX.md + CLAUDE.md, continue NEXT phase
     autonomously per docs/autopilot.md").
  3. P14 DONE detected -> logs completion and stops monitoring.
  Does NOT override intentional STOP CONDITIONS (test failure after 3
  attempts, blocking error, etc.) — those leave Claude idle without a
  rate-limit message, which the monitor ignores so a human can review.
  Logs: logs/claude-resume.log, state/events.log.
  NOTE: Claude Code's multi-line input box treats `send-keys "<text>"
  Enter` as inserting a newline, not submitting — the script sends a
  SECOND bare `Enter` (via its `submit_keys` helper) to actually
  submit "continue"/the resume prompt.

If the VPS reboots, re-attach and check `tmux ls` — if `dev` or the
`monitor` window is missing, recreate:
```
tmux new-session -s dev -c ~/airecruit
claude --continue --dangerously-skip-permissions
tmux new-window -t dev -n monitor 'bash ~/airecruit/scripts/claude-auto-resume.sh'
```
If the bypass-permissions acceptance somehow does NOT persist across a
reboot, the one-time warning dialog will reappear — select
"2. Yes, I accept" (use arrow-down then Enter, since typing "2" directly
was observed to mis-select "1. No, exit" on 2026-06-15).

Do NOT use the systemd + ANTHROPIC_API_KEY installer pattern from the
original blueprint (install-24x7.sh) — that's a different (paid API
key) auth path and is unnecessary given the existing OAuth login.


## Phase Status
| Phase | Name | Status |
|-------|------|--------|
| P0  | Project Bootstrap & Auth | DONE |
| P1  | Candidate & Requisition Core | DONE |
| P2  | n8n Workflow Automation | DONE |
| P3  | Zero-Token AI Engine | DONE |
| P4  | Pipeline & Applications | DONE |
| P5  | Recruiter Command Center | DONE |
| P6  | Finance & ERP Module | DONE |
| P7  | Assessment & Anti-cheat | DONE |
| P8  | BGV & Compliance | DONE |
| P9  | WhatsApp Chatbot (WAHA) | DONE |
| P10 | Analytics & Reporting | DONE |
| P11 | Offer Management | DONE |
| P12 | ERP Extensions | DONE |
| P13 | BGV Deep Checks | DONE |
| P14 | Placements & Redeployment | DONE |
| P15 | Recruiter Performance & Incentive Engine | DONE |
| P16 | KAE Module & Account Ownership | DONE |
| P17 | Account Financial Framework & CEO Dashboard | DONE |
| P18 | Resume & JD Intelligence (Regex NER) | DONE |
| P19 | Candidate Intelligence Engine | DONE |
| P20 | Technical Assessment & Video Intelligence | DONE |
| P21 | AI Shortlisting & Predictive Hiring (sklearn) | DONE |
| P22 | Recruiter & Vendor Analytics | DONE |

## New Tables (P15-P22)
P15: recruiter_kpi_scores, recruiter_advanced_kpis, candidate_retention_tracking,
     incentive_records, retention_bank, loyalty_milestones
P16: client_owners, account_visibility, kae_kpi_scores, kae_incentives, kae_client_retention
P17: account_pl, delivery_pool_allocations, contribution_margins,
     collection_records, bu_eligibility
P18: candidate_parsed_data, jd_parsed_data
P19: candidate_scores (+ v_candidate_intelligence view)
P20: technical_assessments
P21: placement_predictions
P22: vendor_agencies, source_attribution

## New Routes (P15-P22)
/incentives      — KPI scorecard, grade, payout, retention bank, loyalty
/kae             — Account ownership, L1-L5 visibility, KAE scorecard
/account-pl      — Account P&L with CM engine (trigger-computed)
/collections     — Invoice collection tracking + aging
/bu-tracker      — BU eligibility evaluation
/ceo-dashboard   — Aggregated CEO view
/intelligence    — Resume NER + semantic scoring (BGE-small)
/assessments     — MCQ/video assessments + anti-cheat
/predictions     — sklearn LogisticRegression placement probability
/vendor-analytics — Vendor ROI, recruiter funnel, diversity
/scheduler       — APScheduler jobs (retention bank release, loyalty checks)

## Zero-Token Architecture
Tier 0: SQL rules (triggers, views) — KPI grading, incentive calc, CM, aging
Tier 1: BGE-small-en-v1.5 (http://embed:8081) — semantic candidate-JD matching
Tier 2: scikit-learn LogisticRegression (local, in-process) — placement prediction
Tier 3: Ollama Qwen2.5-1.5B (http://ollama:11434) — AI CFO, JD generation (cached)
NEVER call external LLM APIs.

## Scheduler (APScheduler in FastAPI)
- Daily 02:00: process_retention_bank_releases() — release held amounts past due_date
- Daily 02:15: check_loyalty_milestones() — flag achieved milestones for payment
- Weekly Sun 03:00: refresh_kae_retention_months() — increment months_served
- Monthly 1st 04:00: send_monthly_incentive_summary() — n8n webhook trigger

## Production (docker-compose.prod.yml)
- nginx with SSL termination (Let's Encrypt via certbot)
- All services internal, only nginx exposed on 80/443
- NEXT_PUBLIC_API_URL set to https://yourdomain.com/api

## P23-P35 Features (added 2026-06-21)
NOTE (2026-07-21): "DONE" below tracks backend-route existence, not
frontend UI — audit on this date found Candidate Tags (P33), Duplicate
Candidate Detection (P35), and Bulk CV Upload (P23) all had working
routers with ZERO frontend usage (plus a real bug: the email/phone
duplicate scanner's own DB default overflowed its column type on every
insert, silently, since creation). All three now have real UI wired up
as of today. Don't trust DONE alone for "does a user-facing page exist"
without spot-checking — re-audit the rest of this table opportunistically.
| Feature | Phase | Status |
|---------|-------|--------|
| Skills Taxonomy (71 skills + aliases) | P23 | DONE |
| Bulk CV Upload + AI Parse + Dup Detection | P23 | DONE (UI added 2026-07-21) |
| Email Template Engine (6 templates) | P24 | DONE |
| Interview Scheduler | P24 | DONE |
| Candidate Activity Timeline | P24 | DONE |
| Client Portal (shortlist, feedback) | P25 | DONE |
| SLA Dashboard + Time-to-fill | P26 | DONE |
| Audit Log | P26 | DONE |
| JD Template Library (10 templates) | P27 | DONE |
| CSV Exports (4 reports) | P28 | DONE |
| Public Job Board | P29 | DONE |
| n8n Automation Workflows (10 triggers) | P30 | DONE |
| Salary Benchmarking (26 benchmarks) | P31 | DONE |
| Market Demand Intelligence | P31 | DONE |
| In-app Notification Center | P32 | DONE |
| Candidate Tags (12 default tags) | P33 | DONE (UI added 2026-07-21) |
| Interview Question Bank (26 questions) | P34 | DONE |
| Duplicate Candidate Detection | P35 | DONE (UI added 2026-07-21; fixed a silent DB-overflow bug that made it record zero duplicates ever) |
| User Management (27 staffing roles) | NEW | DONE |

## New Routes (P23-P35)
/skills, /bulk-cv, /email-templates, /interviews, /client-portal,
/sla, /audit, /jd-templates, /export/*, /jobs, /salary-benchmark,
/notifications, /automations, /candidate-tags, /question-bank, /duplicates
/users, /roles

## Additional UI wired up 2026-07-21 (pre-existing backends, no UI until now)
- Recruiter Reassignment (HARD RULE #10 HITL flow, `/assignments`) — now
  on the Requisitions detail page ("Assigned Recruiter" card, admin/
  manager-gated reassign)
- Pipeline Automation Rules (`/pipeline-rules`, Tier-0 nightly stage
  auto-move) — now on Settings > Pipeline Stages page. Was silently
  never executing: `scheduler.py`'s `run_pipeline_auto_move()` called an
  undefined `_eval()` helper every night since it was scheduled — fixed.
- CSV/Excel candidate import (`/import`) — Candidates page's "Import CSV"
  button previously ran a fragile hand-rolled client-side CSV parser
  that never called this endpoint; now uses the real backend endpoint
  (adds Excel support + downloadable template as a side effect)

## Deep DB-vs-sidebar audit + fixes, 2026-07-26
Full pass over all ~150 live DB tables cross-referenced against backend
routers, frontend pages, and the sidebar (triggered by "Recruiter Auto
Assignment built but not in the sidebar"). Findings + fixes:
- **Recruiter Auto-Assign** (`POST /requisitions/{id}/assign` ->
  `assign_with_explanation()`) — real, working, HARD-RULE-#10-exempt
  (initial assign isn't HITL-gated, only reassign is) but had zero UI
  caller. Added an "Auto-Assign (AI)" button on the requisition detail
  page's Assigned Recruiter card.
- **Recruiter Presence/Activity** (`recruiter_tracking.py`) was 3 stub
  endpoints returning hardcoded empty data. Now real: heartbeat writes
  `users.last_seen_at` (a column that existed but was never written
  anywhere), presence buckets recruiters online/away/offline, activity
  reads `audit_log`. New `/recruiter-ops` page (Presence tab) + a
  heartbeat tick added to the dashboard layout.
- **Calendar/.ics export** (`calendar.py`) was fully real but had zero
  UI. Added a `/calendar` page, and replaced a dead button on the
  Interviews page (referenced a `calendar_id` field that doesn't exist
  on `interview_schedules`, so it silently never rendered) with one
  that actually calls `POST /calendar/from-interview/{id}`.
- **`recruiter_targets`, `recruiter_tasks`, `hotlist`** tables had real
  seed data but zero API — only `seed_data.py` ever touched them. Built
  a new router (`recruiter_ops.py`) + UI (Tasks/Targets/Hotlist tabs on
  `/recruiter-ops`). Found and fixed a real gap in the process:
  `recruiter_tasks` had neither RLS enabled nor a policy at all —
  any tenant could read/write any other tenant's tasks via `app_user`.
- **The 9 "GAP Features"** (`gap_features.py`: NPS, Talent Pool,
  Referrals, Reference Checks, Video Screening, Job Distribution
  status, BGV API, Report Builder, Browser Extension) were all
  hardcoded stubs (e.g. `{"candidates": []}`) that ignored the DB
  entirely, despite real tables with seed data existing for most of
  them. Rebuilt with real logic + UI for 7 of the 9 (NPS survey
  send+capture, Talent Pool + public join-form on `/careers`,
  Referrals with click tracking + application attribution, Reference
  Checks with a public no-login referee form, async Video Screening
  with real webcam recording + upload, Report Builder, Captured
  Profiles for the browser-extension/LinkedIn ingestion path).
  Job Distribution and BGV API were retired instead of rebuilt — both
  duplicated real functionality that already exists (Job Sharing's
  `job_shares`/`job_portal_issues`, and `/bgv`'s Aadhaar/DigiLocker +
  trust score) and a second copy would just be new dead weight.
  `job_board_postings`/`job_distributions` (57/35 legacy rows) are
  confirmed superseded relics of a pre-Job-Sharing system — no code
  references them anymore, left as historical data, not rebuilt.
  Also found and fixed real RLS gaps on `video_screening_tokens` and
  `reference_responses` (no RLS at all) — both now use the same
  SECURITY-DEFINER-owned-by-postgres pattern as `nda_documents`'
  public signing flow for their anonymous token-based access.
- Migration: `sql/21_gap_features_rls_and_public_tokens.sql`.
## QA suite fixed and run for real, 2026-07-27
The 129-test Playwright suite (`tests/*.spec.ts`) had never been able to
complete a run against this deployment: nearly every describe block logs
in fresh in `beforeEach` (11 browser-form logins + 7 more direct API
logins per full run, 18+ total), which blows through `app.py`'s login
rate limiter (10/15min, a real anti-brute-force control — not weakened)
almost immediately and cascade-fails everything after with 429s that
look like application bugs but aren't. This is very likely *why* so many
of the dead/orphaned features found in the audits above went uncaught
for so long — an always-red or never-finishing suite gets ignored.

Fixed properly (test-side only): added `tests/global-setup.ts` (logs in
ONCE via direct API call, saves session to `tests/.auth/state.json` via
Playwright's storageState — the app keeps its JWT in localStorage, not
cookies, so this captures that too), wired via `globalSetup` in
`playwright.config.ts`. Every describe block that only needs to *already
be* authenticated now does `test.use({ storageState: AUTH_FILE })`
instead of re-submitting the login form; the handful of direct-API tests
needing a raw bearer token share one cached login via a `getApiToken()`
helper. S1's login-flow tests and S6's unauthenticated-redirect test are
untouched — they specifically need to start unauthenticated. Net: 18+
logins per run down to 2 (global-setup + the couple of tests that must
exercise login for real).

Also had to reset `admin@example.com`'s password back to the seed
default ("changeme", per `seed_data.py`) — it no longer matched, which
is why the very first attempt at this failed differently (401 "Invalid
email or password", not a 429) even after the rate limiter was cleared.
Confirmed via DB first that this is the seed/demo QA account, not a real
staff login, before resetting (user approved).

**First real (non-cascade) run: 114 passed, 13 failed, 2 skipped.**
Of the 13:
- **1 real backend bug, found and fixed**: `GET /pipeline/metrics`
  (feeds the Dashboard and Pipeline Velocity pages) computed
  `interview`/`interview_rate`/`offer_rate`/`upcoming_interviews` via
  `by_stage.get("interview", 0)` — but "interview" was split into
  `l1_interview`/`l2_interview` (see `STAGES` in `pipeline_p2.py` /
  `_DEFAULT_STAGE_KEYS` in `applications.py`) a while ago, and this
  tenant has even added a custom `l3_interview` round on top via
  `pipeline_stage_config`. The lookup never matched any of them —
  `upcoming_interviews` was silently always 0, `interview_rate`/
  `offer_rate` always undercounted, on two real pages, indefinitely.
  Fixed to sum every `by_stage` key containing `"interview"` (matches
  the dynamic, tenant-configurable stage-key pattern already used for
  `by_stage` itself) rather than hardcoding stage names.
- **1 test bug, fixed**: `assign-with-explanation` test grabbed
  `reqs[0]` unconditionally and asserted on the response as if it always
  succeeds — `assign_with_explanation()` correctly 409s on a non-open
  requisition by design, and `reqs[0]` isn't guaranteed to be open.
  Verified the real endpoint works correctly against an actual open
  requisition before concluding this wasn't an app bug. Fixed the test
  to filter for `status==='open'`.
- **11 stale-selector/text failures — since fixed, suite is fully green**
  (127 passed, 2 legitimately skipped, 0 failed, 129/129 accounted for).
  Root causes, all confirmed by directly inspecting rendered output before
  touching anything (never guessed a fix):
  - Candidates page count text changed from "N candidates in..." to
    "{total} candidates · Page {n}/{total}" (there's also a second,
    separately-worded "Showing X–Y of Z candidates" near pagination —
    matching both needed `.first()` to avoid a strict-mode violation).
  - Candidates search input placeholder gained a capital N ("Name,
    email...") — the test's lowercase substring selector was
    case-sensitive and matched nothing; also added the missing
    `.press('Enter')` since search only applies on Enter/button-click,
    not live-as-you-type.
  - Add-Candidate modal's "COMPENSATION" section was merged into
    "Professional Details" at some point; added the real 4th section
    ("Resume / Notes") in its place.
  - The full-add-candidate-flow test's hardcoded phone number, reused
    across years of prior runs, now trips the app's own duplicate-
    candidate detection (working correctly) — made all fields unique
    per run. Separately, its `rowsAfter > rowsBefore` check stopped
    being valid once the candidate count exceeded one page (50 rows) —
    adding a candidate never changes the visible row *count* once the
    page is full; switched to asserting the new candidate's own name
    becomes visible instead.
  - `/pipeline` stopped being the Kanban board directly — it's now a
    job-*picker* landing page; the board only renders once a job is
    selected via `?job=<id>` (a query param, not a route). Tests that
    need the board now fetch a real open requisition via the API first
    and navigate straight to `/pipeline?job={id}`.
  - No native `<select>` exists on the pipeline pages anymore — job
    selection is a custom searchable button-list dropdown. Repointed
    "first select has options" to check that dropdown has ≥1 entry
    instead, via a `data-testid="requisition-list"` added to
    `pipeline/page.tsx` (small, additive, zero behavior change — matches
    the same convention already used for `kanban-board`, `analytics-kpi`,
    etc. elsewhere in the app, this one page just never got it). Also hit
    a real race condition here: the container renders before its
    async-fetched job list populates, so a bare `.count()` right after
    `waitForSelector` could see 0 buttons — switched to an
    auto-retrying `expect().toBeVisible()` first.
  - Candidate 360's Profile/Applications tabs lost their `data-tab`/
    `data-testid` hooks in some past redesign (zero such attributes
    existed anywhere in `candidates/[id]/page.tsx`) — restored them
    (`data-tab={tab.key}` on each tab button, `data-testid="profile-panel"`
    / `"applications-panel"` on their content panels), same reasoning as
    the requisition-list fix above.
  - Candidate 360's "assessment tab" test no longer maps to anything —
    there is no assessment tab in this page's `TABS` array at all
    (technical assessments are their own dedicated `/assessments` module
    now, not embedded per-candidate). Repointed the test to check that
    real page instead of forcing a strained fit to a UI concept that no
    longer exists.
  - Analytics KPI cards' `data-testid="analytics-kpi"` was always real —
    only the expected text was stale (`Placement Rate`/`Skill Gaps`/
    `Utilization` don't appear anywhere; current cards are Total
    Candidates/Open Jobs/Total Placements/etc.).

## Job board deep-dive, 2026-07-27
User asked specifically about job-board-related DB tables vs sidebar.
"Job board" turned out to span 6 tables/endpoint-groups, half genuinely
live and half dead duplicates of the same service:
- **Live**: `GET /jobs` (backs the internal, read-only Job Board sidebar
  page — browse only, no apply button), `/public/jobs*` (backs the
  public Career Page — the actual apply flow, writes to
  `candidates`+`applications`), `job_shares`/`job_portal_issues`/
  `facebook_page_connections` (backs Job Sharing — distribution
  tracking + real Facebook auto-post, built earlier this project).
- **Dead, removed**: `GET /jobs/{job_id}` and `POST /jobs/{job_id}/apply`
  in `p28_p32.py` had zero callers — the internal Job Board page never
  had an apply button, so these silently duplicated `/public/jobs/
  {job_id}` and `/public/jobs/apply` while also (nonsensically, for a
  public applicant) requiring login. Concretely dangerous, not just
  clutter: referral click-through tracking was added to `/public/jobs/
  apply` only (round 2) — anyone still hitting the dead duplicate would
  have silently missed it. Removed both endpoints.
- **Dead, left as historical data (not dropped — real rows, no code
  path to safely reconcile)**: `job_board_postings` (57 rows) +
  `job_distributions` (35 rows) — legacy distribution-tracking,
  superseded by `job_shares` (confirmed round 1). `public_job_applications`
  (3 rows, new finding) — an older application-capture design, zero code
  references anywhere; the real flow writes straight into
  `candidates`+`applications` instead.

## Deep DB-vs-sidebar audit round 4, 2026-07-27
Checked the reverse direction (frontend pages with no sidebar link — only
found `/pipeline-rules`, already a deliberate redirect stub, not a gap)
and swept every remaining backend router for orphaned individual
endpoints rather than whole orphaned routers. Found:
- **`POST /jd/generate`** (`backend/ai_router.py`'s Tier-2-lite cascade —
  embed, semantic-cache lookup, Ollama Qwen2.5, cache-store) had never
  been called by anything, anywhere, since it was built. Grepping for
  every `ai_router` import found only two: `ai.py` (this endpoint) and
  `bgv.py` (imports the module but never actually calls a function on
  it). **The core module CLAUDE.md documents as "the ONE module every
  AI call passes through" had zero real traffic ever.** Added a "JD
  Generator" tab to the AI Tools page (title/skills/experience in,
  drafted JD out) — the natural home, since that page's tagline is
  literally "Ollama Qwen2.5-1.5B · Cached · Zero external API". Verified
  for real: called `ai_router.generate()` directly inside the backend
  container end-to-end — first call hit real Ollama and returned a
  coherent JD sentence (cached=False), second identical call hit the
  semantic cache (cached=True, similarity=1.0). This is the first
  confirmed-working exercise of that module in the project's history.
- **`sse_router.py`** (`/sse/recruiter-monitor`) retired, not built out —
  it only ever sent a `{"type":"ping"}` heartbeat every 30s with no real
  data source and no tenant scoping, and the actual "recruiter
  monitoring" feature already exists and works via the poll-based
  `/recruiter-tracking` endpoints from round 1. Building a second,
  push-based version of the same feature would be new dead weight, not
  a fix — same judgment call as retiring bgv-api/job-distribution in
  round 1.
- n8n's 10 `automation_workflows` rows (P30) all exist, are all
  API+UI-wired via `/automations` (confirmed in round 1) — none have
  ever fired (`fire_count=0` on all 10), but whether n8n's own workflow
  JSON is correctly configured to trigger them is an n8n-side
  operational question, not a missing DB-table/API/UI gap, so out of
  scope for this audit.

## Deep DB-vs-sidebar audit round 3, 2026-07-27
Widened the search past tables to views and functions. Found:
- **`do_reassign(assignment_id, reason, new_recruiter_id)`** — documented
  in CLAUDE.md's TARGET DB FUNCTIONS since P1/P3, had zero callers.
  `/assignments/{id}/reassign` had quietly reimplemented the same swap
  by hand in Python instead of calling it — and that hand-rolled version
  never wrote `event_outbox` (HARD RULE #5/#6 gap: a reassignment fired
  `assignment_event` + `audit_log` but never actually dispatched via the
  outbox pattern, unlike auto-assign's `assignment.created`). Rewired
  the endpoint to call `do_reassign()` instead of duplicating it, which
  fixes the outbox gap for free and also unlocks the function's other
  half: passing no `new_recruiter_id` now auto-picks the next-best
  alternative via `match_recruiters()`. Added an "Auto-Reassign (AI)"
  button next to the existing Auto-Assign one on the requisition page.
  Verified both paths directly against prod inside a rolled-back
  transaction before deploying.
- **`v_kae_summary`** (per-KAE revenue/collection/incentive leaderboard,
  real since P16) had zero callers — `/kae/summary` only ever returned
  tenant-wide totals, never a per-person breakdown. Added
  `GET /kae/leaderboard` + a Leaderboard tab on `/kae`.
- Checked every other business-logic DB function for a caller
  (`accept_offer_by_id`, `auth_lookup_user`, `generate_invoice_from_
  timesheets`, `kpi_grade`/`kpi_incentive`/`kae_*_bonus` via triggers,
  etc.) — all had real callers or fire from triggers, no other gaps.
  `get_nps_by_token`/`get_refcheck_by_token`/`get_referral_by_code`/
  `increment_referral_clicks` are leftover unused scaffolding that
  predates round 2's rebuild (simpler/older shape than what got built) —
  harmless, not wired to anything, left alone.

## Deep DB-vs-sidebar audit round 2, 2026-07-27
Same methodology, repeated against the full ~150-table list (not just the
suspicious subset from round 1). Found and fixed:
- **Operational Alerts** — `find_stalled_assignments()` and
  `find_sla_breaches()` (both documented in CLAUDE.md's TARGET DB
  FUNCTIONS section since P1/P3) had **zero callers anywhere** in the
  app, and `alert_acknowledgments` had 134 real rows with no router at
  all. New `/alerts` endpoint combines both functions + dedupes against
  acknowledgments; new panel on the War Room page. There were real,
  live SLA breaches and stalled assignments sitting invisible before this.
- **Scoring Weight Config / SLA Tier Config** — admin-tunable weights for
  the AI recruiter-matching engine and SLA breach thresholds, each with
  exactly 1 default row and zero API. Now on Settings > Ops Settings.
- **Submittals** — `submitted_rate`/`client_feedback` per application had
  5 real rows, no API. New `/submittals` page.
- **Work Sessions** — recruiter clock-in/clock-out (distinct from the
  candidate-billing `timesheets` table) had 2 real rows, no API. Added
  as a tab on `/recruiter-ops`.
- **Recruiter-Client Blocks**, **Saved Filters** — both zero rows, zero
  API. Built into Ops Settings and the Candidates page filter bar
  respectively.
- **Candidate Portal Uploads** — let a candidate upload documents via
  their existing `/my-status?token=` self-service link.
- **GDPR Archive/Log** — `final_features.gdpr_router` was fully real
  (anonymizes inactive candidates) but had no UI *and* no role gate on
  an irreversible PII-redaction action; added both (Settings > Ops
  Settings, admin-only now).
- **Agency/Vendor Submission Portal** — `agency_submissions`/
  `agency_users` had zero rows and zero API: a no-login portal for
  empanelled vendor agencies to submit candidates straight to open
  roles. Built end-to-end (`/agency-portal` internal + `/agency-submit/
  {token}` public), reusing the `vendor_agencies` table from P22.
- **RLS gap, same pattern as round 1**: 9 of these tables had NO row-level
  security at all (not just unforced) — `saved_filters`, `agency_users`,
  `agency_submissions`, `candidate_portal_uploads`, `work_sessions`,
  `alert_acknowledgments`, `sla_tier_config`, `scoring_weight_config`,
  `recruiter_client_blocks`. Three of those (`sla_tier_config`,
  `scoring_weight_config`, `recruiter_client_blocks`) are owned by
  `app_user` itself, meaning without FORCE ROW LEVEL SECURITY any tenant
  could read/write any other tenant's config. Fixed in
  `sql/22_round2_rls_and_portals.sql`, same SECURITY-DEFINER-owned-by-
  postgres pattern as round 1 for the three anonymous token flows
  (agency portal, candidate uploads).
- **Bonus fix**: `resume_intake_service.py`'s low-confidence routing
  branch referenced `requisition_id` unconditionally but only ever
  assigned it inside `if candidate_id:` — every low-confidence resume
  threw `UnboundLocalError` and got stuck retrying forever (caught live
  in the backend logs right after this deploy). One-line fix
  (`requisition_id = None` before the branch), unrelated to the DB
  audit but too easy and too broken to leave.
- `login_rate_limits` table confirmed genuinely dead (superseded by
  `app.py`'s in-memory `RateLimitMiddleware`, zero code references it) —
  not rebuilt, nothing points at it including auth.py.

- **Zero-token violation fixed (same day)**: `ai_resume_parser.py` called
  Claude Haiku directly via `api.anthropic.com` (HARD RULE #1) — but
  `parse_resume_with_ai`/`is_configured` were imported in
  `resume_intake_service.py` and never actually called anywhere, and
  `ANTHROPIC_API_KEY` was never set in `.env` or the running container.
  Confirmed fully dead code (not a live leak), so deleted the file and
  the dead import instead of building an unnecessary Ollama
  replacement for a path nothing ever invoked. Production resume
  parsing has only ever run through `improved_parser.parse_resume_v2`
  (regex-based, Tier 0). `docker compose` no longer passes through
  `ANTHROPIC_API_KEY` either. `zerotoken-check.sh` now reports
  CONFIRMED CLEAN.

## AI Auto-Assignment Engine: research audit + approved implementation, 2026-07-28
User asked for a research-only audit (no code) of the recruiter
auto-assignment/matching engine against top ATS competitors before any
build work — delivered a Verified/Partial/Gap report against the real DB
and codebase, with a ranked 9-item "Awaiting Approval" list. User approved
all 9, picked round-robin for resume auto-routing (item 03) and a layered
policy for SLA escalation (item 05: tier-1 alert + manager notify, THEN
tier-2 auto-reassign only after a grace period — not immediate
auto-reassign), then required genuine end-to-end verification (real API
calls, real data, before/after proof) over code-presence checks, plus a
frontend/sidebar connectivity sweep, for every item. All 9 done:

- **Scoring engine rewrite** (`match_recruiters()`, `sql/24_scoring_engine_
  rewrite.sql`) — was `LANGUAGE sql` with a hardcoded 0.4 skill / 0.6
  capacity formula that ignored `scoring_weight_config` entirely and never
  checked `recruiter_client_blocks`. Rewritten to `LANGUAGE plpgsql`
  reading real weights and computing 8 of 10 configured factors from real
  data (capacity, skill match, location, performance via
  `recruiter_kpi_scores`, leave status via the new `recruiter_leave` table,
  prior-client relationship, tenure, urgency); `seniority_match`/
  `language_match` deliberately left at 0-contribution — no data source
  exists for either, documented in-code rather than invented. Blocked
  recruiters are now a hard filter, not a weight. Proved with real
  experiments, not just code review: set weights to capacity=1.0/rest=0
  via the live API and confirmed every returned score exactly matched the
  formula; created a real block via the API and confirmed that recruiter
  vanished from results; added a real leave record and got an exact
  10-point score drop matching the configured weight.
- **Resume auto-routing** (`create_application()`) — round-robin/
  least-loaded active recruiter, tie-broken alphabetically, skipping
  anyone on leave. Proved by calling the real function against a live
  candidate+requisition pair and checking the assignment landed on the
  expected recruiter.
- **Layered SLA escalation** (`sql/25_sla_escalation.sql`,
  `scheduler.py: process_sla_escalations()`, every 30 min) —
  `find_sla_breaches()`/`find_stalled_assignments()` (real since P1/P3)
  only ever produced a dashboard card a human had to click. Tier 1 (once,
  on first sight): fires the existing n8n webhook + notifies the
  recruiter's manager. Tier 2 (only if still open 24h later): calls the
  real `do_reassign()` to auto-pick the next-best recruiter. Proved by
  backdating a real escalation's `first_detected_at` 25h and confirming a
  genuine reassignment fired with the correct audit trail.
- **Auto-generate recruiter tasks on stage change** (`applications.py:
  update_stage()`) — 5 stage transitions (screened, l1/l2 interview,
  offer, offer_accepted) create a typed `recruiter_tasks` row when the
  application has an assigned recruiter. Proved with a real stage-change
  API call (positive case: task created with correct fields; negative
  case: no assigned recruiter -> no task), both reverted afterward since
  they were test transitions, not real recruiting decisions.
- **Client priority tier**, **recruiter leave/availability tracking** —
  straightforward column+API+UI, real POST/PATCH/GET/DELETE cycles.
- **Frontend/sidebar connectivity**: 15/15 real headless-browser checks
  passed (not code presence) — sidebar links, Leave/Tasks tabs, client
  tier selectors, SLA Dashboard, and the requisition detail page's
  Auto-Reassign button correctly showing state from an earlier real
  Auto-Assign in the same session.
- Full QA suite re-run clean after all of the above: 127 passed, 2
  skipped, 0 failed — unchanged from baseline.

**Two more real bugs found only because testing was genuine, not
code-review-only:**
- Two `Optional[str]` Pydantic fields (`LeaveIn.start_date`/`end_date`,
  `TaskIn.due_at`) bound directly to DATE/TIMESTAMPTZ columns — asyncpg
  needs real `date`/`datetime` objects, not strings; crashed on the first
  real insert. Retyped both; while at it, found and fixed the same
  pre-existing bug in `HotlistIn.available_from` (silently broken since
  round 2 above).
- Follow-up ("fix it") on a gap flagged honestly rather than hidden:
  tier-1 manager notifications were wired correctly but a no-op because
  `users.reporting_to` was NULL for all 12 users in the tenant — a data
  gap, not a code gap (the field already has full backend + frontend
  support via Settings > Users & Roles, unused since it was built). Set
  all 9 active recruiters to report to the tenant's one manager (Neha
  Joshi), via the real `PUT /users/{id}` API with explicit user
  confirmation before writing to real user records. That surfaced a
  second, deeper bug: re-running the escalation job after the data fix
  still didn't produce a notification, because `notifications` has two
  overlapping column generations from different features — the insert
  wrote a `message` column that doesn't exist and never set
  `recipient_user_id` (required by a CHECK constraint), so **every
  tier-1 notification insert had been silently failing since it was
  built**, the whole time it was being "verified" by checking
  `fire_count` instead of the notifications table itself. Fixed to match
  the working convention already used by `nda.py`/`resume_intake_
  service.py` (which is also unblocked by the same `reporting_to` fix —
  its manager-notify-on-NDA-signed path had the identical silent gap).
  Found and fixed the same column-name bug in a second, separate
  `POST /notifications` endpoint (`p28_p32.py`) while there, even though
  it currently has no frontend caller. Proved for real: reset one
  genuinely-still-open escalation's `tier1_fired_at` to force a re-fire,
  ran the actual scheduler function, and got a correctly-formed
  notification row for the manager (`notifications` count 4147→4148).

## Device Monitoring (company devices), 2026-07-28
User asked for full "micro management" employee tracking on the
Recruiter Ops Presence tab — login/logout, product usage, laptop use,
website use. Scoped down through explicit back-and-forth before any code:
**company-issued devices only** (no personal/BYOD — consent to monitor a
personal device as a condition of employment fails DPDP 2023's "free"
consent standard), **transparent only** (written policy + visible tray
icon; recruiter self-consents and self-generates the enrollment code —
no admin-push path exists), **no screenshots, no keystroke logging**
(both explicitly declined — keylogging captures passwords/personal
messages indiscriminately and is refused regardless of employer intent
or disclosure). What shipped: active-window/idle time + browser URL
history (Chrome/Edge) only.

- **`sql/26_device_monitoring.sql`** — `device_monitoring_consent`
  (separate from `consent_records`, which is `candidate_id`-FK'd by
  design and can't be reused for employee consent),
  `device_enrollment_tokens` (15-min single-use codes), `monitored_devices`,
  `device_activity_log`, `device_browsing_history`. All forced-RLS. Two
  `SECURITY DEFINER` functions (`get_device_by_key_hash`,
  `redeem_device_enrollment`) owned by `postgres` — the agent authenticates
  with a device API key, not a user JWT, so it doesn't know its own
  tenant_id ahead of time, same "cast '' to uuid" problem as every other
  anonymous/token flow (`nda.py`, `offers.py`), same fix.
- **`backend/routers/device_monitoring.py`** — consent give/revoke/status,
  enrollment-token issuance (blocked without active consent — 403),
  device enroll (single-use token redemption), heartbeat + browsing
  ingest (device-key auth), and role-scoped dashboards: recruiters can
  only ever see their own data (server-enforced — a `user_id` query param
  from a non-manager role is silently ignored, not honored), admin/manager
  see everyone's. Revoking consent deactivates all of that user's devices
  immediately; a deactivated device's key is rejected on the next request.
- **`agent/aviin_device_agent.py`** — Windows agent. Active window +
  process name (`pywin32`), idle detection via `GetLastInputInfo`
  (boolean idle/active only, never keystroke content), Chrome/Edge
  browsing history (copies the locked SQLite `History` file before
  reading, converts Chrome's webkit-epoch timestamps). Always shows a
  system tray icon while running — this agent has no silent/hidden mode.
  `enroll`/`run`/`install-autostart` CLI; `install-autostart` only
  touches `HKEY_CURRENT_USER` (no admin rights, current user only).
  `README.md` has PyInstaller packaging instructions for real deployment.
- **`frontend/app/(dashboard)/device-monitoring/page.tsx`** — "My Device"
  tab (everyone): policy text, consent toggle, enrollment code generator,
  own devices list, own activity summary, own browsing history — a
  recruiter can always see the exact same data a manager can see about
  them. "Team Overview" tab (admin/manager only): all enrolled devices,
  per-person active-time, browsing history by selected recruiter.
- **`purge_old_device_monitoring_data()`** (`scheduler.py`, daily 03:00
  IST) — data-minimization purge of activity/browsing rows older than 90
  days. Consent and enrollment records are kept (compliance audit trail),
  only the granular activity data ages out.

**Verification** (real API calls + real browser interaction, not code
review): full consent→enrollment-token→enroll→heartbeat→browsing→
dashboard cycle proven via curl against production; single-use token
reuse correctly rejected (400); role-scoping proven with a real
`recruiter`-role login (QA Test Recruiter, password reset via the real
admin API) that could not see the admin's device/history even when
explicitly requesting it by `user_id`; consent revoke proven to
deactivate the device and reject its key on the next request (401);
frontend proven via a real headless-browser click-through (consent →
enroll → revoke → Team Overview), not just a successful build; the
**actual agent code** (`enroll()`, `post_batch()`) run for real against
production from an isolated config directory (never touching this
machine's real AppData or its real device identity); all three capture
functions proven against real local data on this Windows machine
(idle detection, active-window capture, and reading 2,203 real Chrome/Edge
history entries with correct webkit-epoch timestamp conversion) —
without ever printing actual URLs/titles to the session transcript, to
avoid exposing personal browsing content. All test data cleaned up
from production after each proof.

**Two real bugs found via genuine testing, not code review**:
- The SSR/hydration bug class — `getTokenPayload()` reads `localStorage`,
  which doesn't exist during server-render, so calling it synchronously
  during a component's render body makes the server's first paint differ
  from the client's (React error #418). This same pattern already exists
  in `recruiter-ops/page.tsx`'s `TargetsTab` — not fixed there (out of
  scope for this feature), but now a known, reproducible finding rather
  than a theoretical one. Fixed in the new page via the standard
  `useState` + `useEffect` deferred-read pattern.
- `purge_old_device_monitoring_data()`'s first version passed a plain
  Python string (`"90 days"`) as an asyncpg query parameter cast to
  `::interval` — asyncpg can't bind a bare string to an interval
  parameter that way. Fixed by computing the cutoff as a real
  `datetime` in Python and comparing directly, no interval casting
  needed. Caught by actually running the job against real inserted rows
  (one dated 2026-01-01, one dated "now") and confirming exactly the old
  one was deleted — not by reading the code.

Also caught: the zero-token audit's `git ls-files`-based scan silently
skips brand-new untracked files — the first post-build run reported
CONFIRMED CLEAN at 307 files, identical to the pre-build count, meaning
none of this feature's new files were actually scanned. Staged them
(`git add`, no commit yet) and re-ran: 313 files, genuinely clean.
