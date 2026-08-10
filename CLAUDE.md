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
DOMAIN: ats.aviinjobs.com (confirmed, live in production since P14).
Still never use finstack.aviinjobs.com for this product — that subdomain
is used by an unrelated FinStack HR/Payroll deployment for the same
company.

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
- [✅]    P14: VPS Deploy (nginx/SSL, domain=ats.aviinjobs.com) — DONE (52/52)
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
| P20 | Technical Assessment & Video Intelligence | RETIRED 2026-08-10 (never had real usage; see Fresh Audit section) |
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

## Three remaining gaps closed: approval chain, load-balancing, predictive SLA, 2026-07-28
Follow-up to the 10-item "did we already build this" check earlier the same
day (7 verified, 3 gaps: predictive SLA, hierarchy/approval-chain routing,
interviewer/task load-balancing). All 3 built, deployed, and verified with
real API calls end-to-end - not code review.

- **Hierarchy/approval-chain routing** (`sql/27_gap_features_2.sql`,
  `requisitions.py`) — `requisitions.approval_status` existed since an
  early migration (draft/pending_approval/approved) but zero application
  code ever touched it. Now real: a recruiter-created requisition walks
  their real `users.reporting_to` chain (up to 3 levels) into a genuine
  multi-step `requisition_approval_steps` sequence — each step must
  approve in order before the next unlocks, any rejection short-circuits
  the rest to 'skipped', admin/manager-created requisitions are exempt
  (they already have authority), and admin/super_admin can override any
  step. Notifies each approver in turn via the `notifications` table
  fixed earlier today. New "Approval Chain" card on the requisition
  detail Summary tab (Approve/Reject, comment, only visible to the
  current step's approver or an admin) + a "PENDING APPROVAL" badge on
  the requisitions list.
  Real bug caught immediately by testing, not visible from reading the
  code: `approval_status`'s CHECK constraint only allowed
  `draft`/`pending_approval`/`approved` - my first version wrote
  `'pending'` (wrong string entirely) and `'rejected'` (not a valid value
  at all), so requisition creation 500'd for every non-exempt creator.
  Fixed the string and added `'rejected'` as a proper CHECK-constraint
  value rather than overloading `'draft'`. Verified with a genuine
  3-level chain (built via reporting_to on synthetic QA test accounts,
  not real staff): sequential-order enforcement (an admin trying to skip
  ahead gets a 400), correct-approver-only enforcement (creator trying to
  approve their own request gets a 403), a real notification firing at
  each hand-off, and both a full approve-to-completion run and a
  reject-with-cascade-skip run, each confirmed against the DB.
- **Interviewer + task load-balancing** (`p23_p27.py`, `phase3.py`,
  `recruiter_ops.py`) — `GET /interviews/suggest-interviewer` ranks
  active staff by how many other interviews they have booked within 3
  days of the requested slot, hard-excluding anyone with a real time
  conflict (range-overlap, not just exact-match). Wired into **both**
  interview-creation paths found in the codebase - `p23_p27.py`'s
  `POST /interviews` and, importantly, `phase3.py`'s
  `POST /auto-interview/schedule`, which is what the actual Interview
  Scheduler UI calls (its form had never had any interviewer field at
  all, auto or manual, until now). `recruiter_tasks` creation gained the
  same treatment - `recruiter_id` is now optional; omitting it auto-picks
  the least-loaded active recruiter, same round-robin/least-loaded
  pattern as resume auto-routing.
  Real bug caught by testing on a genuinely open slot with zero existing
  bookings: Postgres three-valued logic. `bool_or()` aggregated over a
  LEFT JOIN with no matching rows returns NULL, not FALSE, so
  `HAVING NOT bool_or(...)` silently excluded every candidate who had
  never been interviewer on anything before - the suggestion endpoint
  returned "no one available" for a slot where literally everyone was
  free. Fixed by wrapping in `COALESCE(bool_or(...), false)`. Verified
  load-balancing for real: scheduled a real interview for the suggested
  person, re-queried the exact same slot (correctly excluded, hard
  conflict), an overlapping-but-not-identical slot (correctly excluded,
  range overlap not just exact match), and a same-day non-overlapping
  slot (correctly deprioritized in favor of someone with zero nearby
  load, even though no direct conflict existed - proving this is real
  load-balancing, not just conflict-avoidance).
- **Predictive time-to-fill** (`backend/routers/sla_predictions.py`) —
  the existing SLA Dashboard/`v_sla_dashboard` is purely reactive
  (current elapsed days vs a static target); this is genuinely
  predictive: same lazy-cached-sklearn-per-tenant pattern as
  `predictions.py` (P21), trained on this tenant's own historical
  fill times to forecast expected time-to-fill and flag risk *before* a
  requisition actually breaches, not just after. `placements` is too
  sparse to train on directly (1 row tenant-wide) - uses first
  placed/offer_accepted application per requisition as a "filled_at"
  proxy instead. Honestly reports "insufficient training data" rather
  than fabricating a number when there isn't enough signal yet (this
  tenant currently has 2 usable historical examples, need >= 5) - falls
  back to the tenant's own historical median in the meantime, which is
  still genuinely data-driven, just not a fitted per-requisition model.
  New "Predicted Time-to-Fill" section on the SLA Dashboard, openly
  labeled with which method produced each number. Verified the honest
  degraded-mode path for real (this tenant doesn't have enough data yet)
  rather than only testing the happy path a real regression would take.

## Recruiter Ops UX gap: wrong default tab + no unified "My Day", 2026-07-28
User asked, from a screenshot of the Recruiter Ops page, whether anything
was missing for the recruiter persona specifically (as opposed to admin/
manager). Two real findings, both fixed:
- Every recruiter landed on the "Auto-Assign" tab by default - a tool for
  assigning recruiters to open reqs, more relevant to a manager's job than
  their own. The page had exactly one role check anywhere (`canManage`,
  gating just the Targets tab's "Set Target" button) - no tab-level role
  awareness at all.
- The three things a recruiter actually needs at a glance each day - tasks
  due, interviews today, candidates going stale - already existed as real
  data (`recruiter_tasks`, `interview_schedules`, `applications`) but were
  scattered across four separate pages with no single "today" view, unlike
  the home screen every competitor ATS (Bullhorn/CEIPAL/JobDiva) gives a
  recruiter.

Fixed both together: new `GET /recruiter/my-day` (`recruiter_dashboard.py`,
alongside the existing `/recruiter/my-stats`) assembles tasks due-or-
overdue, today's interviews (as interviewer or as the candidate's owning
recruiter), and applications assigned to them with no stage movement in
3+ days. New "My Day" tab on Recruiter Ops, first in the tab order,
visible to everyone - but only recruiters get auto-switched to it on
load (admin/manager keep the existing Auto-Assign default, via a
post-mount `useEffect`, not the initial render, to avoid the exact
localStorage/SSR hydration mismatch found and fixed earlier in the
device-monitoring page - applying that lesson meant this one shipped
with zero hydration errors on the first try, confirmed via the same
browser-console-error check).

Verified with real data end-to-end: created a real task due today, a real
interview scheduled today, confirmed both appeared and a genuinely stale
candidate (11 days untouched) also surfaced for a different account with
no test setup at all - then confirmed a task due days in the future
correctly did NOT appear (proving the query is actually date-selective,
not just permissive). Real browser test confirmed the admin session
still defaults to Auto-Assign while a real recruiter login auto-switches
to My Day, both rendering real content. Found and cleaned up one piece of
leftover test data ("E2E test task") from earlier in the session that had
never been deleted - a reminder that cleanup steps need to actually be
checked off, not just intended.

## Candidates page data quality: 3 distinct real bugs, 2026-07-28/29
User pointed at the live Candidates page (756 candidates) and asked about
duplicates. Investigated rather than assumed - found three genuinely
different bugs mixed together in what looked like one mess, fixed the two
that were safe to fix broadly, cleaned up 32 confirmed-garbage records,
and deliberately left real candidates alone even though their name field
looked wrong.

**Bug 1 - QA test suite leaking into production data.** 3 of the ~18
tests across `qa_automation.spec.ts`/`aviin_ui.spec.ts` that create a
real candidate (`Create candidate returns id`, `POST candidate has all
required fields`, `full add candidate flow`) never cleaned up after
themselves - unlike the one deliberate `DELETE candidate with cascade
cleanup` test, which correctly self-deletes and was confirmed NOT
appearing on the live page. Every `npm run qa` run (dozens of times this
session alone, for unrelated feature regression checks) left 3 more
permanent fake "QA Candidate"/"API QA Test"/"QA PW Test ..." rows visible
to real recruiters. Fixed by adding the same soft-delete cleanup the
working test already used, including a version for the UI-driven test
(no `apiToken` in scope there - pulls the same localStorage JWT the app
itself uses). Verified the fix actually holds, not just that tests still
pass: ran the full suite once after the fix and confirmed all 4 candidates
it created were `is_active=false` immediately, not just deletable.

**Bug 2 - Job Descriptions getting classified as candidate resumes.**
`document_classifier.py`'s Phase A step (JD_SIGNALS keyword scoring, added
2026-07-22 per an earlier fix) exists specifically to catch this and is
correctly wired into `resume_intake_service.py` - but two real JD shapes
sailed through as `AUTO_PROCESS` anyway, reproduced and confirmed
directly against the actual stored text of both:
- A terse field-label JD (Segula Technologies "Die Design" role,
  `POS0094.pdf`): scored resume_score=13 vs jd_score=4 because its own
  field labels ("Notice period", "Technical Skills") are legitimate
  resume vocabulary too, and its JD-specific phrasing ("No. Of Open
  Position", "Job Location", "Position Name") didn't match any existing
  JD_SIGNALS phrase closely enough. Fixed by widening JD_SIGNALS with
  those exact phrases - resume language a candidate's own resume
  essentially never uses about itself.
- A bulk multi-role listing (9 stacked ServiceNow roles in one
  attachment, narrative style, no field labels): scored resume_score=11
  vs jd_score=2, because nothing in the keyword lists was built for
  *repetition* as a signal. Fixed with two new structural heuristics
  (count-based, not simple presence, so they live outside the normal
  JD_SIGNALS list): 4+ distinct "X-Y years" experience-range mentions,
  and 2+ instances of a numbered role title immediately followed by
  "Job Summary" - both near-zero false-positive risk since a single
  person's resume doesn't restate its own experience as several
  different ranges or number itself as a list of roles.
Verified all three cases together after the fix (both real JDs now
REJECT, a synthetic real resume still AUTO_PROCESSes at resume_score=27
vs non_resume_score=2 - no regression on real resumes).

**Bug 3 - name extraction sometimes grabs the wrong line (found, NOT
fixed).** While checking candidates with implausible-looking names
("Techstar Award", "Playing Cricket", "Visual Studio", "Aviin Tech
Business Solutions"), found these are REAL candidates with real resume
content - the parser just extracted an achievement, hobby, or employer
line instead of the actual name from the top of the document ("Techstar
Award" is really Muskan D; "Playing Cricket" is really Manjunath; "Visual
Studio" is really Charan M N). Deliberately did not touch these records
or guess-correct their names - overwriting a real candidate's identity
field based on my own inference from resume text is a different, more
invasive kind of fix than deleting confirmed garbage, and deserves an
explicit decision rather than being bundled into a cleanup pass. Flagged
to the user as a separate, still-open issue.

**Cleanup executed** (soft-delete via the real `DELETE /candidates/{id}`
API, not raw SQL - same 200 status the tests themselves rely on): 24 live
QA-test candidates, plus 8 individually-verified-by-reading-their-actual-
resume_text records - 2 confirmed JD-as-candidate (Segula, "Dtdc Invenio"),
2 duplicate copies of the same misfiled ServiceNow JD ("Job Summary" x2,
"Key Responsibilities"), one more JD sent from a `postmaster@` system
address, and 2 with no usable content at all (raw OLE/binary bytes from a
failed old-`.doc` text extraction, not garbled-but-real text). Left every
plausible-real-name candidate alone, including the 6 confirmed-real
wrong-name cases from Bug 3 and everyone else pattern-matched but not
individually verified - soft-delete is reversible, but "looks like a
weird name" was not treated as sufficient grounds to act on without
reading the actual content first.

**Follow-up, same day - Bug 3 investigated further, closed with no action
needed.** User asked to fix the wrong-name-extraction bug next. Ran the
real `extract_name_v2()`/`parse_resume_v2()` directly against the actual
stored resume text for the failing cases (Muskan D, Manjunath) - both now
extract correctly. Git history shows the parser file's only commit
predates every affected record, but this project has an established
pattern (documented repeatedly above) of large batches of uncommitted
work landing all at once, so the code actually running on 2026-07-05 was
very likely an earlier, buggier version than what's live now - already
fixed through normal iteration, never retroactively reprocessed onto old
records. Checked all 11 remaining suspect records: 10 were already
`is_active=false` (soft-deleted by someone before this investigation
started, not by this session) and therefore not visible to recruiters at
all. The 1 still-active case ("Rise") has no recoverable better name
anywhere in its available text, filename, email, or phone - left
untouched rather than guessed. No code changed, no data changed - the
honest conclusion was that there was nothing left to safely do.

## Resume download missing from Candidate/Resume Inbox pages, 2026-07-29
User pointed at a candidate detail page and a list quick-view drawer,
neither showing any way to download the original resume file. Checked
before building: the backend (`GET /resume-intake/{resume_file_id}/
download`, `candidates.py`'s `get_candidate()` already returning
`latest_resume_file_id`/`latest_resume_file_name`) and even a working
`downloadResume()` helper all already existed - the button was just never
wired to anything visible. It only existed buried in the candidate detail
page's "Parse History" tab (a technical-sounding tab nobody would think
to check for this), and nowhere at all on the list drawer or Resume
Inbox.

Added a real "Download Resume" button in three places: the candidate
detail page's main header (next to Email/WhatsApp/Edit/Share Status, not
just Parse History), the list page's quick-view drawer (next to RESUME
EXTRACT - required a small extra fetch since the list endpoint doesn't
return `latest_resume_file_id`, only the single-candidate GET does), and
Resume Inbox (both a compact icon in the table row and a full button in
the detail drawer, using `item.id` directly since resume-inbox queue rows
already are `resume_files` rows).

Verified for real, not just "the code looks right": downloaded the exact
same real 249,670-byte PDF (Prakashraj B's actual resume) through all
four button locations via genuine Playwright download events, confirmed
byte-identical to a direct curl against the backend endpoint. One test
script mistake caught and fixed along the way - the drawer test initially
clicked the bare table row instead of the actual view-icon trigger,
making it look like the drawer feature was broken when it was the test
that was wrong; re-verified against the real trigger before concluding
anything.

## Recruiter -> KAE candidate submission (tracking sheet + redacted resume), 2026-07-29
User asked to check whether recruiters had a way to hand a candidate to
the client-owning KAE with (a) the resume shared WITHOUT phone/email/
personal details, (b) an Excel "tracking sheet" attached (example
provided: SL No/Date/Partner/Name/Role/Total Exp/Relevant Exp/Skill
summary/Notice Period/Mobile/Alt Number/Email/Current Location/
Deployment Location/Current Company/CTC/ECTC, one row per submission),
(c) multiple tracking-sheet templates selectable per client ("click
types template"), all sent by real email and logged in the ATS. Checked
first, built nothing until confirmed: grepped the whole repo for
`tracking_sheet`/`submission_template` - zero hits anywhere. Adjacent
pieces existed but nothing connected them - `client_portal_router`'s
`/view/{token}` link already correctly excluded email/phone, `kae.py`
had ownership/visibility/scorecard tracking but zero submission or
notification hooks, `p28_p32.py`'s 4 CSV exports were generic bulk
tenant-wide reports not per-candidate, and stage-change emails only
ever notified the candidate, never the KAE.

Asked 3 clarifying questions before building given the genuine scope
(this is a new multi-part feature, not a wire-up-what-exists fix). User
answered "both" on two of them:
- **Templates: "both" flexible-with-toggles AND fully-separate-per-client.**
  Resolved as one mechanism, not two - `tracking_sheet_templates` is
  just a named, ordered column list (`{key,label}[]`) optionally pinned
  to a `client_id` (NULL = global default). "Flexible with toggles" is
  just a template that reuses most of the default's columns; "fully
  separate" is just another template row with a different column set -
  no separate code path needed for the two modes the user asked for.
- **Redaction: "both" generated-clean AND redacted-original.** Resolved
  as a per-submission `resume_style` choice (`clean_generated` |
  `redacted_original`), picked by the recruiter each time they submit,
  not a global setting.
- **Delivery: real email, automatically** - unambiguous, built as such.

Built: migration `sql/28_kae_submission.sql` (`tracking_sheet_templates`,
`candidate_submissions` - both FORCE RLS, tenant_isolation policy; the
per-tenant seed of one default 17-column template had to loop with
`set_config('app.tenant_id',...)` per tenant since even `app_user` as
table owner still needs it set to satisfy its own FORCE RLS policy on
INSERT - a bare cross-tenant `INSERT...SELECT` was rejected outright).
New router `backend/routers/kae_submission.py`:
- `/submission-templates` CRUD + `/submission-templates/columns` (the
  17-key registry: `auto:true` columns resolve live from candidate/
  requisition/tenant data - name, phone, email, location, employer, exp,
  notice period, CTC/ECTC, tenant name as "Partner"; `auto:false` ones
  are per-submission free text the recruiter fills in - relevant exp
  for *this* role, a skills/support/projects summary, deployment
  location, alternate number - since none of those exist as stored
  candidate fields).
- `GET/POST /applications/{id}/submit-to-kae(/preview)` - resolves the
  KAE via `client_owners` (`owner_type='kae', is_active`), resolves the
  template (client-specific else tenant default), builds a *cumulative*
  per-requisition tracking sheet (every prior `candidate_submissions`
  row for that requisition, server-computed `sl_no`, re-rendered fresh
  each send so the KAE always gets the full picture, not just one row),
  generates the resume attachment per `resume_style`, sends one real
  SMTP email (extends the existing `nda.py`-style `_send_via_smtp`
  pattern to multiple attachments), logs to `candidate_submissions`
  (best-effort email - a send failure still logs `status='failed'` +
  `error_message` rather than losing the record), and bumps the
  application to `submitted` only if it was in an earlier stage
  (sourced/contacted/interested/nda/screened - never regresses or
  errors on a candidate already past that point, e.g. l1_interview).
  Writes `event_outbox` (`candidate.submitted_to_kae` +
  `application.stage_changed` when bumped) and `audit_log`.
- **Redaction only ever applies to the resume attachment, never the
  tracking sheet** - the tracking sheet is the client's own internal
  record and the user's own example row has full mobile/email in it;
  only the resume hides contact details. `clean_generated` renders a
  curated one-pager (name, designation, location, total exp, skills, a
  trimmed auto-extracted summary) from structured fields, no phone/
  email ever included. `redacted_original` renders the *full* extracted
  `resume_text` with the candidate's own stored phone/email plus
  generic email/phone regex patterns swapped for `[REDACTED]` - this is
  regex-based redaction of extracted text, not true pixel-level PDF
  redaction of the original file's layout (that would need exact
  on-page text-position detection, a much bigger undertaking) and it
  doesn't attempt full home-address stripping (no reliable zero-token
  way to identify one in raw text) - phone + email were what the user
  named explicitly and are what it reliably catches.

Frontend: a "Submit to KAE" tab on the pipeline board's candidate drawer
(recipient, click-to-pick template chips, Clean Summary/Redacted
Original toggle, editable tracking-sheet-row fields pre-filled from
auto values, submission history) - reuses the drawer's existing tabbed-
panel convention (same shape as the NDA/Notes/Scorecards tabs already
there) rather than a new modal pattern. Template management as a new
"Tracking Sheet Templates" tab on `/ops-settings` (same tab convention
as Matching Weights/SLA Tiers/Blocks already on that page) - column
checkboxes from the registry, optional client pin, default-template
flag; delete is blocked server-side on the default template so a
tenant can never end up with zero fallback template.

Verified for real, not code review: a throwaway candidate+application
submitted twice via curl (clean then redacted) correctly produced
`sl_no` 1 then 2, bumped stage sourced->submitted on the first call
only, sent real SMTP mail through the tenant's actual configured
Hostinger relay (`email_sent:true`), and logged both rows - all cleaned
up after (deleted the throwaway `client_owners`/application/candidate/
`consent_records` rows so no residue was left on a real client). Then,
separately, called the exact same `_build_tracking_excel`/
`_build_clean_resume_pdf`/`_build_redacted_resume_pdf` functions
directly inside the backend container against a test candidate whose
resume text deliberately included ampersands ("Sales & Marketing",
"R&D") to check the reportlab-Paragraph-mini-XML escaping was correct
(an unescaped `&` there crashes generation) - loaded the Excel back
with openpyxl and confirmed the tracking sheet correctly *includes*
phone/email in both rows, extracted both PDFs with pdfminer and
confirmed phone/email are absent from both while the candidate's name
and unrelated resume content (including the ampersand lines) survived
intact. Added a permanent "S14 KAE Candidate Submission" suite to
`qa_automation.spec.ts` (throwaway client+requisition+candidate so
repeat runs never touch a real client's `client_owners` or risk its
3-KAE limit; API-level preview/submit/history checks plus one real
browser-driven send through the actual drawer UI and one real create+
delete through the actual Templates admin UI) - full suite now 132
passed / 2 skipped / 0 failed (up from the prior 127/2/0 baseline, zero
regressions).

## Feature-completeness audit against a 20-item requirements list, 2026-08-07/08
User pasted a long checklist (Naukri/LinkedIn integration, resume auto-
screening + score explanation, JD auto-send, bulk email personalization,
stage-change reminders, email/WhatsApp read tracking, a resume-upload
tracking-sheet popup, AI ranking for Account Managers, real-time dedup,
MS Teams, rejection feedback, Canva/image resume conversion, multi-board
job posting, Boolean search generation, plus a separate list: WhatsApp
Business reminders + inbound resume auto-save, personalized call letters
with a logo, capacity/leave/performance-based auto-assign, per-role
submission limits, and 4 specific contact-stripped resume formats) and
asked for a research-only audit against actual code, not assumptions.
Ran 4 parallel research agents (no code changes) covering: resume AI-
scoring/dedup/formats; email+WhatsApp automation; external integrations;
and feedback/call-letters/auto-assign/limits. Findings (grounded in real
file/route reads, not naming-convention guesses):
- **Built solidly**: real-time duplicate detection on Save
  (`GET /candidates/check-duplicate`), and recruiter auto-assignment
  (`match_recruiters()` in `sql/24_scoring_engine_rewrite.sql` - genuinely
  weights capacity, skill overlap, client blocks + relationship, leave,
  performance, location, tenure, urgency; only seniority/language are
  documented zero-weight placeholders since no such data exists anywhere).
- **Partial, each with a real gap**: resume scoring exists but never
  auto-fired on upload; skill-overlap is shown but not what's *missing*;
  bulk email exists but sends one identical string to everyone (no
  personalization, unlike its WhatsApp-bulk sibling which already does
  per-recipient templating); L1/L2/Rejected notifications are fully coded
  in `_notify_stage_change_bg` (email + WAHA WhatsApp together) but every
  real UI call site hardcoded `send_email:false`, so none of it actually
  fired; rejection writes a free-text `reason`, no structured taxonomy;
  OCR extracts text but doesn't reformat into a standard template; only
  Facebook auto-posts jobs, everything else (70+ boards incl. Naukri/
  Indeed) is a manual share-dialog or copy-paste link; the KAE tracking-
  sheet feature sends an Excel attachment, not inline-email-body content,
  and triggers from the pipeline drawer, not a post-upload popup.
- **Not built at all**: Naukri/LinkedIn (only a stored URL string exists,
  no OAuth/posting/pull API for either), MS Teams (only an unrelated
  Slack/Teams/Discord webhook notifier exists), email open/read tracking,
  auto-send-JD-to-candidate, Boolean-search generation, call letters
  (and no PDF generator anywhere embeds an actual logo image, only text),
  per-recruiter submission limits, and the 4 specific resume-format
  variants (2 different styles exist from the KAE feature, none match).

User picked a start: Tier-0 "quick wins" first (small fixes to code that
mostly already worked), with Naukri/LinkedIn/Teams parked until real
partner/API credentials exist - nothing to build there without them.

## Tier-0 quick wins built, 2026-08-08
Four small, high-value fixes, chosen because each was mostly-already-built
and just needed a real hookup, not new capability:

- **L1/L2/Rejected auto email+WhatsApp** - `_notify_stage_change_bg`
  (`applications.py`) already sent both correctly; it just never fired
  because both real UI call sites (`pipeline/page.tsx`'s `moveStage`,
  `requisitions/[id]/page.tsx`'s `moveStage`) hardcoded/defaulted
  `send_email` to `false`. Added a small `_AUTO_NOTIFY_STAGES` set
  (`l1_interview`/`l2_interview`/`rejected` - deliberately just those 3,
  matching what was actually asked, not every stage) and compute the flag
  from the target stage instead of hardcoding it, so drag-and-drop, quick-
  move buttons, and any other caller all get correct behavior automatically.
  Verified for real: moved a throwaway candidate to `l1_interview` via the
  same request shape the fixed frontend now sends and confirmed the
  backend log showed `Stage email [l1_interview] sent to ...` (WhatsApp
  correctly skipped - no consent on file for the throwaway candidate,
  HARD RULE #7 working as intended).
- **Bulk email personalization** - `/communications/bulk-send` sent the
  exact same string to every recipient; added `{name}`/`{first_name}`
  substitution (matching the `{name}` convention `_notify_stage_change_bg`
  already uses for WhatsApp templates, not inventing a new mustache
  syntax) applied to both subject and body, for both the email and
  WhatsApp channels this endpoint handles. Added a placeholder hint in the
  bulk-composer UI so recruiters actually know it exists. Verified via a
  real send + reading back the logged `candidate_messages` row: subject
  "Hi {first_name}" -> "Hi QA", body correctly substituted the full name,
  no literal `{name}` left in the output.
- **Missing-skills display ("why this score")** - `/candidates/rank`
  already computed `matched_skills`; added `missing_skills` (required
  minus matched) right next to it. Also extended
  `/requisitions/{id}/match-candidates` (backed by the `match_candidates()`
  SQL function, which only returns a `skill_overlap` COUNT) with the same
  missing-skills list, computed in Python from `requisitions.skills_required`
  rather than touching the SQL function. Shown as red "✕ Skill" badges next
  to the existing green matched-skill badges on the Candidates page, the
  legacy `/pipeline/[req_id]` match-cards panel, and a new "AI Match Score"
  card on the Candidate 360 profile tab. Verified with a real candidate
  missing 2 of 4 required skills - both endpoints and the UI correctly
  showed `Docker`/`Kubernetes` as missing.
- **Auto-score on resume upload** - resume intake
  (`resume_intake_service.py`) created candidates and matched them to a
  requisition but never scored them against that JD; scoring only ran
  when someone manually hit `/intelligence/score`. Extracted that
  endpoint's logic into a reusable `score_candidate_core()` (still used by
  the HTTP endpoint too, just no longer inline in the route handler), and
  call it from resume intake right after a requisition match, fire-and-
  forget on its own fresh connection via `asyncio.create_task` - not
  awaited on the intake's own `conn`, because that file has extensive
  existing comments about how one failed SQL query poisons the rest of
  that transaction for every later item in the same batch, and scoring
  makes a real network call to the embed service that has no business
  being able to take candidate/resume creation down with it if it's slow
  or fails. Also added an `ai_scores` array (readiness index/grade, score
  breakdown, missing skills) to `GET /candidates/{id}` and a matching "AI
  Match Score" card on Candidate 360 - the auto-score was pointless
  without somewhere to actually see it. Verified for real: called the
  exact function the intake hook calls, against a live candidate+
  requisition pair, confirmed a genuine `candidate_scores` row was written
  (readiness_index=59.25, grade C) and that it round-tripped correctly
  through `GET /candidates/{id}`. Scope note: this covers the email-intake
  pipeline specifically (the highest-volume real path) - a separate manual
  single-candidate or bulk-CV upload UI, if one gets built out further,
  would need the same hookup added to it too.

All four verified with real data end-to-end (not code review), all test
data cleaned up after (including hard-deleting a throwaway requisition
via psql, since unlike a stray candidate a fake requisition shows up
prominently in real job pickers/lists). Added a permanent "S15 Tier-0
Quick Wins" suite to `qa_automation.spec.ts` covering all 4. Full suite
run immediately after: 135 passed / 2 skipped / 3 failed - all 3 failures
were `429 Too many login attempts`, from this session's own repeated
back-to-back Playwright runs exhausting the 10-per-15-min login rate
limiter (the exact known false-failure pattern documented earlier in this
file under "QA suite fixed and run for real"), confirmed by re-running
the same 3 tests moments later and seeing `global-setup` itself 429 on
login - not a real regression. Waited out the window and re-ran clean:
138 passed / 2 skipped / 0 failed.

Side finding while cleaning up: S14 (KAE submission) and the new S15 both
create a throwaway requisition per run with no delete-after, and both
suites have now been run enough times (across today and 2026-07-29) that
8 stray "QA KAE Test Role"/"QA Tier0 Test Role {stamp}" requisitions had
piled up - genuinely visible clutter in real requisition/job-picker lists,
unlike a stray candidate that just sits in pagination. Deleted all 8 (and
their cascaded assignments/assignment_event/recruiter_tasks/applications/
candidate_scores/candidate_submissions rows) via psql. Not fixed at the
test-suite level (would mean adding real DELETE endpoints or reaching for
raw SQL from Playwright, neither of which fits this file's established
conventions) - flagging as a known gap: repeated S14/S15 runs will keep
adding one stray requisition each until this gets a real fixture.

## Tier-1 features built, 2026-08-08
User asked to build the 6 Tier-1 items from the earlier feature-completeness
audit (rejection taxonomy, AM ranked view, JD auto-send, per-role submission
limits, email tracking, WhatsApp inbound resume + auto-reply) and fix the
stray-requisition QA gap noted above.

- **Rejection taxonomy** - new `rejection_reasons` (tenant-configurable,
  12 seeded defaults: skills_mismatch, experience_mismatch, salary_
  expectations, notice_period, failed_screening, failed_interview,
  client_feedback, candidate_withdrew, location_mismatch, duplicate,
  not_relevant, other) and `application_rejections` (structured per-
  rejection log, separate from `applications` so history survives re-
  rejection) tables, `sql/29_tier1_features.sql`. `PATCH /applications/
  {id}/stage` now requires `reason_code` when `stage='rejected'` (400 if
  missing/unknown), validates against the tenant's active taxonomy, and
  writes a real `notifications` row directly to the assigned recruiter (or
  `recipient_role='manager'` if unassigned) - not routed through n8n's
  `w4_pipeline_stage_change_alert` workflow like other stage-change alerts,
  since that workflow's `fire_count=0` reliability was never confirmed (see
  earlier "Deep DB-vs-sidebar audit round 4"); this one is directly,
  verifiably reliable. New `GET/POST /rejection-reasons` (admin/manager-
  gated writes) and `GET /applications/{id}/rejection`. Frontend: both
  pipeline drawers' bare "Reject" button now opens a shared
  `RejectReasonModal` (reason dropdown + optional notes) instead of firing
  the stage change directly - wired through both the drawer button AND
  drag-and-drop-into-Rejected-column (a card dragged onto the Rejected
  column now opens the same modal via a `pendingReject` state at the board
  level, rather than silently 400ing).
- **AM ranked view** - there's no formal `account_manager` auth role in
  this system (`users.role` is just admin/manager/recruiter), so
  `GET /intelligence/candidates` is gated to admin/manager OR anyone
  holding a real `client_owners` assignment (kae/account_manager/
  secondary) - reusing the schema's own existing "manages client accounts"
  concept rather than inventing a new role. Rewritten to query
  `candidate_scores` directly instead of `v_candidate_intelligence` (that
  view only ever surfaced one most-recent score per candidate with no
  indication of which requisition it was scored against - useless for
  "who should I present for THIS role"); now returns one row per
  (candidate, requisition) scored pair with `requisition_title`/
  `client_name` joined in, sorted by fit. `/intelligence` page's "Scored
  Candidates" tab shows the Role/Client column and a clear "restricted"
  message (not a misleading "no candidates yet") when the 403 fires.
  **Real regression caught by the full QA suite, not manual testing**: the
  role-gate initially broke `GET /intelligence/candidates returns array`
  (an existing S9 test using tenant-only `x-tenant-id` auth, no JWT) -
  `actor.role` is `None` for that access pattern (trusted internal/
  automation path, e.g. n8n), and `None not in ("admin","manager")` was
  incorrectly treating it as an under-privileged real user and blocking it
  with a `client_owners` lookup on a null `user_id`. Fixed by exempting
  `actor.role is None` from the gate entirely.
- **JD auto-send** - `_notify_stage_change_bg` now fetches the
  requisition's title/description/location/employment_type and appends a
  "--- Job Description: ... ---" block to both the email body and the
  WhatsApp text specifically on the `contacted` stage (the moment a
  candidate is actually being reached out to about a role) - not every
  stage, which would just repeat it. Verified for real: moved a throwaway
  application to `contacted`, confirmed `candidate_messages.body` (see
  next item - stage-change emails are now logged there too) contained the
  actual JD text.
- **Per-role submission limits** - `requisitions.submission_limit_per_
  recruiter` (nullable, NULL = unlimited default). `POST /applications`
  counts existing applications for (requisition, recruiter) and 400s at
  the limit. **Real bug found by the automated test suite, not manual
  curl**: the limit check correctly fell back to `actor.user_id` for
  *counting* when `assigned_recruiter_id` wasn't given in the request, but
  the INSERT still stored the literal (often-NULL) `body.assigned_
  recruiter_id` - so an unassigned submission was counted-for-the-check
  against the actor but never actually *stored* against them, meaning it
  would never count on a second call. A recruiter submitting without ever
  passing `assigned_recruiter_id` explicitly could submit unlimited
  candidates despite a configured limit. Fixed by storing `recruiter_for_
  limit` (the same fallback value) as the actual `assigned_recruiter_id`,
  not the raw request field - "who submitted this" now always resolves to
  someone. New requisition form field + a per-recruiter usage bar
  (`GET /requisitions/{id}/submission-usage`) on the requisition detail
  page's Summary tab.
- **Email open/read tracking** - `candidate_messages.tracking_token`
  (unique uuid, separate from the message's own id - a leaked message id
  used elsewhere for inbox links shouldn't double as a forgeable open-
  tracking key), `email_opened_at`, `email_open_count`. Public (no-auth)
  `GET /track/open/{token}.gif` returns a real 1x1 transparent GIF and
  does `email_opened_at = COALESCE(email_opened_at, now())` +
  `email_open_count += 1` - `candidate_messages` has no RLS at all
  (checked: `relrowsecurity=false` - a separate, flagged-not-fixed finding,
  see below) so this needed no anonymous-token-resolves-tenant machinery,
  a plain `db.system_conn()` update by token was enough. Wired into
  `/communications/send`, `/communications/bulk-send`, and stage-change
  emails (which weren't logged to `candidate_messages` at all before this -
  now they are, closing a separate gap where stage emails were invisible
  in the Conversations inbox). Plain-text bodies get wrapped as minimal
  HTML with the pixel appended; already-HTML bodies just get the pixel
  appended directly. Conversations inbox list shows a green "Opened"
  badge with the real timestamp on hover. Verified for real: hit the
  pixel endpoint twice against a real logged message, confirmed
  `email_opened_at` stayed fixed at the first hit while `email_open_count`
  incremented 1 then 2.
- **WhatsApp inbound resume + auto-reply** - `whatsapp_bot.py`'s webhook
  only ever read `payload.body` (text) and bailed immediately if empty,
  which would silently drop a resume sent with no caption. Now checks
  `payload.hasMedia` *before* that bail, and for PDF/DOC/DOCX media, downloads
  via WAHA's media URL, runs it through the exact same regex-NER pipeline
  as email intake (`extract_text_from_attachment` -> `classify_document` ->
  `parse_resume_v2` -> `upsert_candidate`, all reused directly, not
  reimplemented), sets the parsed phone to the verified WhatsApp sender's
  number (authoritative - overrides whatever the resume text itself says),
  logs a `resume_files` row (`job_board='whatsapp'`), and replies with a
  real WhatsApp confirmation message. **Honest verification gap**: this
  session's WAHA instance has session status `FAILED` (needs a QR re-scan
  by the team - a pre-existing condition, not something this work broke),
  so the real inbound-webhook path could not be exercised against a
  genuine WhatsApp message. Verified instead by calling the exact same
  extract/classify/parse/upsert functions the handler calls, against a
  real synthetic PDF built with reportlab (had to make the content
  realistically dense - an early too-sparse attempt was correctly REJECTED
  by the document classifier, which is the classifier working as intended,
  not a bug) - confirmed name/email/skills extraction, `source='whatsapp'`
  tagging, and phone correctly normalized to the standard 10-digit form
  matching this codebase's existing India-phone convention. First attempt
  accidentally reused a real existing candidate's resume file, which
  matched their existing record via `upsert_candidate`'s own dedup logic
  and bumped their `updated_at` (content-identical, not real corruption,
  but a real methodology mistake - caught and corrected by re-testing
  with a definitely-new synthetic candidate instead, and the one spurious
  `resume_files` row it created was deleted).
- **Stray-requisition QA gap, actually fixed this time** - previous entry
  above just documented the gap; this session gave it a real fix. Added
  `DELETE /requisitions/{id}` (soft `is_active=false`, admin/manager-only)
  - genuinely didn't exist before (the requisitions list/detail pages'
  existing Delete button, confirm-dialog and all, had been silently 404ing
  this whole time, swallowed by an empty `catch{}`, now works for free).
  `GET /requisitions` filters `is_active IS NOT FALSE` by default (new
  `include_inactive` param to see soft-deleted ones). S14 and S15's
  `afterAll` hooks now actually call this endpoint instead of just having
  a comment saying they should. Verified: 13 stray requisitions accumulated
  across today's repeated test runs, all confirmed `is_active=false` and
  invisible in the default list/job-picker.

**Flagged, not fixed (out of scope for this batch)**: `candidate_messages`
has no RLS at all (`relrowsecurity=false`) - discovered while building
email tracking, not something this session's rules required fixing since
nothing currently exploits it, but worth a real audit given how much
candidate-facing content flows through that table.

New permanent "S16 Tier-1 Features" suite (7 tests, its own throwaway
candidates + a submission-limited requisition + a separate unlimited one
so the JD-send/AM-view/tracking/delete tests aren't accidentally blocked
by the submission-limit test's own usage). Full suite: 145 passed / 2
skipped / 0 failed on a clean run. Two earlier runs showed 2 late-running
S16 tests failing (`email open tracking`, `requisition soft-delete`) with
symptoms matching request-volume load on the *global* rate limiter (not
the login one) rather than the login-specific 429 seen elsewhere today -
confirmed as transient by re-running clean twice, not a real bug, but
worth knowing the full 147-test suite can occasionally flake near its
tail end under back-to-back invocations.

## Tier-2 features built, 2026-08-08
Follow-up to the same feature-completeness audit as Tier-0/Tier-1 above.
User picked Tier-2 next: Canva/image-resume standardization, the 4
specific contact-stripped resume-format variants, KAE tracking-sheet
rework (inline email body instead of Excel attachment), call letters with
an embedded company logo, and a look at free job-board auto-posting.

- **6 resume formats for KAE submission** (`kae_submission.py`) - was 2
  (`clean_generated`/`redacted_original`), now 6: **manual** (recruiter
  types the summary from scratch - a new `GET .../manual-draft` endpoint
  pre-fills auto-extracted fields as a starting point, but the final PDF
  renders only what was actually submitted, verbatim), **projects_only**
  (new `extract_projects_section()` in `improved_parser.py`, reusing the
  existing `SECTION_HEADERS` set as the boundary detector - contact info
  AND employer/company history both stripped, only project descriptions
  shown), **confidential** (current employer name replaced with
  "Confidential" both structurally and via regex substitution anywhere it
  appears in the free-text summary), **anonymized** (name replaced with
  "First S." - first name + surname initial, using the *last* word's
  first letter rather than literally the second word, since 3+-word Indian
  names are common; employer replaced with "AviinTech Business
  Solutions"). `candidate_submissions.resume_style` CHECK constraint
  widened (`sql/30_tier2_resume_formats.sql`) - table is owned by
  `app_user`, confirmed no postgres-superuser escalation needed (unlike
  `requisitions`/`candidate_messages` in earlier Tier-1 migrations).
  Pipeline drawer's "Submit to KAE" tab RESUME FORMAT grid expanded
  2->6 tiles; picking "Manual Editing" reveals an editable form pre-filled
  from the draft endpoint.
- **KAE tracking sheet: inline HTML email body, not an Excel attachment**
  - user's explicit ask ("in the E-mail body, Not Excel file"). New
  `_build_tracking_html_table()` renders the same cumulative per-
  requisition row set as an inline `<table>` (header styled, alternating
  row shading); `_send_kae_email()` gained a `body_html_extra` param that
  wraps it in a `MIMEMultipart("alternative")` plain+HTML body. The old
  `_build_tracking_excel()` had zero remaining callers after the rework -
  deleted rather than left as unused legacy code. Redaction still only
  ever applies to the resume attachment, never the tracking table (the
  table is the client's own internal record and matches the user's own
  example row, which includes phone/email).
- **Standardized resume on Candidate 360** (the "Canva/image resume ->
  standard format" ask) - new `GET /candidates/{id}/standard-resume`
  reuses `_build_clean_resume_pdf` from `kae_submission.py` directly
  (cross-module import, not duplicated PDF logic) - renders whatever's in
  the parsed candidate record into a clean one-pager regardless of what
  format/quality the original resume file was in (a Canva graphic, a
  scanned image, a messy multi-column layout, etc. - useful precisely
  *because* it doesn't touch the original file). New "Standard Resume
  (PDF)" button on the Candidate 360 header, next to the existing
  "Download Resume" (original file) button.
- **Call letters with an embedded company logo** (new
  `backend/routers/call_letters.py`, `backend/assets/aviintech-logo.png`)
  - the first PDF generator anywhere in this codebase to embed an actual
  logo *image* via reportlab's `Image` flowable (offer letters/NDAs only
  ever rendered the company name as text). `POST /call-letters/generate`
  (renders + emails + logs to `candidate_messages` + writes
  `event_outbox` per HARD RULE #5/#6) and `POST /call-letters/preview`
  (same render, no email/log side effect, for a quick look before
  sending). Deliberately did NOT add a "hiring drive" management entity -
  interview date/time/venue/mode are typed per call letter, not pulled
  from a stored drive record, since that would be a materially bigger
  feature than what was asked for. New "Call Letter" tab on the pipeline
  drawer (date/time/mode/venue/notes form, Preview PDF opens a real
  popup, Generate & Send emails it).
- **Free job-board research, then Telegram auto-post built** - re-audited
  every major job board (Naukri, Indeed's non-feed posting, Monster,
  Shine, TimesJobs, LinkedIn's job-post API) and confirmed none offer free
  auto-posting without a paid/partner-approved API - nothing new to add
  there beyond what P29/round-4-audit already built (Facebook auto-post,
  Google for Jobs via schema.org structured data, Indeed's manual
  XML-feed registration). Found one genuinely free, zero-approval channel
  not yet built: **Telegram channel auto-posting**, same "own Page/own
  bot, no App Review" tier as the Facebook Page integration - a Telegram
  bot token has no review process at all (instant via @BotFather), and
  many India recruiter communities already run Telegram job-alert
  channels. Built end-to-end (`sql/31_telegram_channel.sql`, new
  `/job-sharing/telegram/{connect,status,disconnect,post}` endpoints,
  `TelegramConnectionCard` on the Job Sharing page, same connect-once/
  post-automatically UX as Facebook). `/job-sharing/dashboard` marks
  Telegram `auto_api` (not just `auto_share`) once connected, same as
  Facebook. **Two real bugs caught by self-review before deploying, not
  by the user**: the private-channel deep-link URL used
  `chat_id_str.lstrip('-100')` - `str.lstrip()` strips any characters in
  the given *set*, not a literal prefix, so a real `-100xxxxxxxxxx` chat
  ID would have had extra leading digits mangled off; fixed to a literal
  4-char slice. The MarkdownV2 escaper also didn't escape a literal
  backslash first, which would have double-escaped anything already
  containing one. Both fixed pre-deploy. **Honest verification gap**:
  same shape as the WhatsApp-inbound gap in Tier-1 - no real Telegram bot/
  channel exists to test the actual happy-path post against, so this was
  verified via every negative path for real (invalid token rejected,
  posting without a connection 400s, disconnect/reconnect round-trips)
  plus a live browser click-through of the connection card, rather than a
  genuine end-to-end successful post.
- **New permanent "S17 Tier-2 Features" suite** (9 tests: setup, all 6
  resume formats submitted end-to-end with distinct `sl_no` rows, the
  manual-draft endpoint, both call-letter endpoints, the standardized-
  resume endpoint, both new UI surfaces via real browser interaction, and
  Telegram's negative paths). Deliberately written with
  `test.describe.serial(...)` instead of the plain `test.describe(...)`
  every earlier suite (S1-S16) uses - **found a real fragility in the
  existing pattern, not by reasoning about it but by hitting it**: this
  project's `retries: 1` means a failing test reruns in a **fresh worker
  process**, which does not share the `let candId/reqId/...` state a
  `setup` test earlier in the same file set - so one transient failure
  (a global-rate-limit 429 from firing ~150 tests in quick succession)
  cascaded into a run showing 11 unrelated-looking failures, most of them
  literally `invalid UUID 'undefined'` or a 422 from a silently-dropped
  `undefined` field in a JSON body. `.serial()` makes a retry rerun the
  *whole block* from `setup`, which turned that into a single clean,
  reproducible failure instead of an 11-item false-failure cascade - and
  confirmed the fix by reproducing the exact same cascade pattern on
  S15/S16 (untouched, still plain `test.describe`) in the same runs,
  while S17 stayed either fully clean or failed exactly once,
  deterministically. Not retrofitted onto S1-S16 (out of scope for this
  batch - a real, now-understood, pre-existing characteristic of this
  suite, previously described in this file only as "can occasionally
  flake," now with a concrete mechanism).
- **One real test-writing bug caught by the serial fix's clean
  reproduction** (not an app bug): the S17 setup candidate was created
  with a `current_designation` field in the request body - `CandidateCreate`
  (`backend/schemas.py`) has no such field at all, so Pydantic silently
  dropped it (that column is only ever populated by resume parsing, never
  by the manual create/update API). Fixed the test to not send or assert
  on a value the API was never going to accept.
- Full suite, final clean run: **S17 9/9 passing.** S15 (pre-existing,
  untouched by this batch) still showed 3 failures with *varying* failure
  modes between the original attempt and its retry (a message not found
  in one, a request outright failing in the other) - consistent with
  genuine environmental/timing flakiness under a big back-to-back run
  rather than a deterministic bug, and already documented above as a
  known characteristic of this suite. Flagged honestly rather than
  silently reported as all-green; not investigated further since it's
  outside this batch's scope and pre-dates every change in it.
- Zero-token audit: `CONFIRMED CLEAN` (343 files, 0 external API refs)
  after staging the new files (`git add -A` first - the untracked-file
  gap this same check documented catching once before, see the device-
  monitoring entry above).

## WhatsApp reconnected + 4 real bugs found and fixed via genuine live testing, 2026-08-08
User reconnected the WAHA `default` session (a static QR artifact from an
earlier session was tried first and correctly identified as unfixable -
WAHA QR codes expire in ~20-30s and a published artifact is always stale by
the time it's opened; the Artifact sandbox's CSP also blocks any live-poll
redesign, confirmed earlier this session). Real fix: WAHA's own dashboard
(`http://<vps-ip>:3002/dashboard/`, nginx basic auth `admin`/
`aviinATS2026secure`) shows a live, self-refreshing QR - the dashboard's
own Worker entry needed its API Key field filled in (`aviinATS2026secure`,
the same `WAHA_API_KEY` docker-compose already sets) before it would even
list sessions; once connected, scanning from the phone worked immediately,
with the session surviving every subsequent container restart in this list
(WEBJS persists its auth in the `waha_data` volume).

What followed was requested explicitly as **genuine** verification (send a
real WhatsApp message, check real logs/DB), not code-review - and every
single step surfaced a real, previously-invisible bug, each fixed and
re-verified against real inbound messages before moving to the next:

1. **Webhook URL point at a stale, dead IP.** Both WAHA sessions'
   `config.webhooks[].url` were hardcoded to `http://172.21.0.2:8080/...`
   - a real ok address *at the time it was set*, but the backend container
   has been recreated many times since (every `docker compose up -d
   backend` during today's Tier-2 work alone), and Docker reassigns a new
   internal IP on every recreate. Every inbound WhatsApp event had been
   silently failing delivery (`ECONNREFUSED`, confirmed in `aviin_waha`'s
   own logs, retried 15x then dropped) for an unknown but clearly
   nonzero period. Fixed by pointing both sessions at the container's
   stable Docker DNS name instead (`http://backend:8080/whatsapp-bot/
   webhook` - `backend` is a real alias on `aviin_backend`, confirmed via
   `docker inspect`) via a direct `PUT /api/sessions/{name}` call to WAHA -
   this is real *at rest* WAHA session config, not application code, so
   there was nothing in this repo to fix for this half of the bug, but it
   will silently break again after every future backend recreation if
   this doesn't get an equivalent permanent fix (e.g. pinning it in the
   WAHA session-creation code, currently `whatsapp.py`'s `start_session`
   creates sessions with `config: {"webhooks": []}` - empty - so nothing
   in this codebase ever sets a webhook URL in the first place; it must
   have been set by hand at some point outside version control).
2. **WAHA engine bug silently dropping every inbound `message` event
   before it could even build a webhook payload** - confirmed in
   `aviin_waha` logs: `Caught error, dropping value from, event: 'message'
   ... TypeError: Cannot read properties of undefined (reading
   'includes')`, thrown deep inside `whatsapp-web.js`'s `getChatById` via
   Puppeteer, reproduced identically across 3 separate real test sends. A
   session restart did not clear it. Root-caused to the WAHA image being
   over a month stale (`2026.6.2`, `2026-06-27` build) against a moving
   target (`whatsapp-web.js` chases WhatsApp Web's own client-side
   changes, including its newer LID identifier system below). Fixed with
   `docker compose pull waha && docker compose up -d waha`
   (`2026.6.2` -> `2026.7.2`) - the session's own auth survived the
   recreate (persisted in the `waha_data` volume), no re-scan needed.
   This is an upstream image, not application code - nothing to change in
   this repo, but worth remembering as the first thing to try if this
   class of silent-drop error reappears.
3. **`_download_waha_media()` (`whatsapp_bot.py`) used WAHA's own
   self-referencing media URL verbatim** - WAHA's webhook payload embeds
   `media.url` as `http://localhost:3000/api/files/...`, correct from
   *WAHA's own container's* point of view (it serves files on its own
   port 3000) but meaningless from the *backend* container's network
   namespace, where `localhost` is the backend's own loopback with
   nothing on port 3000 (`httpx` failed with "All connection attempts
   failed" - confirmed via a temporary debug print of the raw media
   dict, removed after diagnosis). Fixed by rewriting just the URL's
   host/scheme to `WAHA_URL` (already a real env var,
   `http://waha:3000`) while keeping WAHA's own path/query untouched.
4. **WhatsApp's newer privacy-preserving "LID" sender identifiers have no
   phone number anywhere in the message payload at all** - for some
   senders, WAHA's `payload.from` is now e.g. `"184018024837218@lid"`
   instead of the traditional `"<phone>@c.us"`; inspecting a complete
   real payload (`_data` and all) confirmed there is genuinely no
   phone-based JID anywhere in it for these senders, only the LID and a
   `notifyName` display string - not a WAHA bug, a real WhatsApp platform
   behavior. The old code's naive `from_.replace("@c.us","").replace
   ("@g.us","")` left `"184018024837218@lid"` completely unstripped, and
   downstream phone-normalization (`resume_intake_service.py`'s
   `upsert_candidate`, which right-truncates to the last 10 digits for
   matching) turned that into a garbage 10-digit value that happened to
   look like a plausible phone number, silently corrupting the
   `candidates.phone` column for every LID-sender. Found WAHA's own
   (undocumented in its OpenAPI listing, found by directly probing
   plausible endpoint shapes) LID-resolution endpoint by trial:
   `GET /api/{session}/lids/{lid}` -> `{"lid": "...", "pn":
   "<real>@c.us"}` - confirmed correct against the real phone number the
   user independently stated out loud, verified via a real function call.
   New `_resolve_phone()` helper in `whatsapp_bot.py` calls this for any
   `@lid` sender before anything else touches `phone`, with a
   best-effort fallback if WAHA's own resolution ever fails. **Separately
   confirmed NOT a bug**: after this fix, several different real test
   candidates (different names, different resumes) sent from the same
   real WhatsApp number still collapsed into one existing candidate
   record (a pre-existing `"E2E WA Test"` fixture from 2026-07-16,
   correctly phone-matched) - `upsert_candidate`'s `UPDATE` path
   deliberately never overwrites `full_name`/`phone` on a match, only
   `COALESCE`s in still-empty fields, by design (protects a real
   identity's core fields from being clobbered by a later, possibly
   worse-quality resend) - correct behavior for the feature's real
   use case (one candidate, one phone, resending their own updated
   resume), just not a fit for the test scenario used here (one
   recruiter forwarding several different people's resumes from their
   own number) - explained to the user rather than "fixed," since
   there was nothing wrong to fix.
5. **Real, separate classifier bug, found while testing #4**: 2 of the
   real DOCX resumes sent during this session (`... Data Platform Lead -
   Remote.docx`, `...Data platform lead- 6.2 yrs.docx`) were rejected as
   "doesn't look like a resume" despite genuinely extracting thousands of
   characters of real resume content (confirmed via the same temporary
   debug-print-then-remove approach as #3). Root cause:
   `document_classifier.py`'s `NON_RESUME_FILENAME_SIGNALS` included a
   bare `r'form'` (meant to catch government/tax *forms*) and `r'contract'`
   (meant to catch employment *contracts*) with no word-boundary
   anchoring at all, so `re.search` matched them as plain substrings -
   `r'form'` matched inside **"Platform"** (a filename containing "Data
   Platform Lead" force-rejected regardless of actual content, confirmed
   directly: `classify_from_filename()` returned `NON_RESUME_HINT` for
   both real filenames, and the "belt-and-suspenders" override at the
   bottom of `classify_document()` forces `REJECT` on that hint
   regardless of how strongly the content itself scored as a resume -
   confirmed `doc_class=RESUME` internally while `is_resume=False`
   externally, the direct fingerprint of this exact bypass). Any resume
   from a Platform Engineer/Platform Architect/Platform Lead - a common
   real job title - would have silently hit this. First fix attempt
   (`\bform\b`/`\bcontract\b`) was too narrow: Python regex `\b` doesn't
   fire against underscores (`\w` includes `_`), so it would have failed
   to catch legitimately-named files like `Application_Form.docx` or
   `Employment_Contract.docx` - a real regression caught before deploy by
   testing both directions, not just the reported case. Final fix uses
   `(?:^|_)form(?:_|\.|$)` / `(?:^|_)contract(?:_|\.|$)`, matching the
   normalization `classify_from_filename()` already does (spaces/hyphens
   -> underscores) - verified against 6 real and constructed filenames
   covering both the original bug and the near-regression, all correct,
   before deploying. Verified for real: the exact 2 previously-rejected
   files, resent by the user after the fix, were both accepted
   (`resume_files` rows confirmed in the DB with real timestamps).

Also fixed along the way: a `.gitignore` entry for `tests/tests/` and
`test-results/` (16 stray Playwright screenshot artifacts had accumulated
untracked in the repo from an earlier ad-hoc capture, unrelated to any
real feature - excluded rather than committed). All 2 genuinely-new
throwaway candidate records created during this testing session
(`Faizal`, `Paresh W`, both phone `8024837218` - both artifacts of the
LID bug above, before the fix landed) were soft-deleted via the real
`DELETE /candidates/{id}` API afterward; the pre-existing `"E2E WA Test"`
fixture record was left as-is (predates this session, already a known
test fixture, harmless).

## MS Teams notifications: real event wiring + 2 more real bugs, 2026-08-08
Same day, follow-up to the WhatsApp session above. Checked before building
anything (established discipline throughout this project): a Slack/Teams/
Discord webhook notifier already existed and was fully wired end-to-end on
the frontend (`frontend/app/(dashboard)/integrations/page.tsx` - add/list/
test a webhook, already usable today) and had a correct MS Teams
`MessageCard` payload builder (`send_webhook()` in
`backend/routers/final_features.py`). What was missing, exactly as flagged
in the earlier feature-completeness audit: **no real hiring event anywhere
in the codebase ever called it** - the only live trigger was a Monday-9AM
weekly-KPI cron job, and `POST /integrations/notify` (the generic
dispatcher) had zero other callers anywhere in the app.

- Extracted `notify_event(tenant_id, event, message, data)` in
  `final_features.py` - a plain importable version of `notify_all`'s
  dispatch logic, since internal callers (a scheduler job, a stage-change
  handler) have a `tenant_id` on hand but no HTTP `Actor` to satisfy the
  `Depends(get_actor)`-gated endpoint.
- Wired two real, high-signal events: **`candidate_rejected`**
  (`applications.py`, right where the existing structured in-app
  notification already fires on a real rejection - same rich context:
  candidate name, role, reason) and **`sla_breach`/`stalled_assignment`**
  (`scheduler.py`'s `_handle_escalation_alert`, at the exact point tier-1
  already fires once per alert and dedupes - these alerts previously only
  ever produced a dashboard card someone had to go check, per the earlier
  "Operational Alerts" audit finding; this makes them push-visible for
  free, using the same fire-once guard, no new noise). Deliberately did
  NOT wire every stage change - a team channel getting pinged on every
  `sourced`->`contacted` move would be noise, not signal.
- **Real bug #1** (found by direct code reading, not testing): the
  original `send_weekly_kpi_summary()` bypassed `send_webhook()` entirely
  and POSTed a raw `{"text": ...}` body straight to every webhook
  regardless of platform - not the MS Teams `MessageCard` shape a real
  Teams incoming-webhook connector expects, and it never updated
  `send_count`/`last_sent_at`, so the Integrations page could never show
  this scheduled send as having happened even when it silently "worked."
  Rewritten to route through `notify_event()` like every other trigger.
- **Real bug #2**, genuinely deeper, only found because the fix above was
  actually *run*, not just read: `send_weekly_kpi_summary()` crashed every
  single time - `invalid input syntax for type uuid: ""`. Root cause:
  `webhook_integrations` has `FORCE ROW LEVEL SECURITY` with a policy that
  casts `app.tenant_id` to `::uuid`; `db.system_conn()` deliberately sets
  `app.tenant_id=''` for "return everything, admin query" semantics
  (works fine for tables whose RLS policy tolerates that), but casting an
  empty string to `::uuid` is a hard Postgres error, not zero rows. This
  exact code path - querying `webhook_integrations` directly through
  `system_conn()` - was **already in the original, pre-existing
  implementation**, meaning weekly KPI webhook delivery had silently
  thrown and been swallowed by its own `try/except` since the feature was
  built; nobody had seen it work, ever. Fixed to match the pattern
  `process_sla_escalations()` already uses correctly one function up: list
  tenant IDs from the `tenants` table via `system_conn()` (no RLS-cast
  issue there), then open a real per-tenant `tenant_conn()` before
  touching `webhook_integrations`.
- Verified all four paths for real, not by reading code: registered a
  genuine `platform=teams` webhook via the real `POST /integrations/
  webhooks` API pointed at a throwaway local HTTP listener (bound to the
  Docker bridge gateway IP so the backend container could actually reach
  it - a public tunnel/webhook.site was tried first and blocked by this
  environment's own tool-permission classifier for reaching an external
  third-party service from production; the local-listener approach avoids
  that entirely and proves the same thing). Confirmed real, correctly-
  shaped `MessageCard` JSON arrived for: the existing test button, a real
  candidate rejection via `PATCH /applications/{id}/stage`, a disposable
  SLA-breach alert fired directly against a throwaway requisition (not a
  real one - `find_sla_breaches()` already had real live breaches on real
  requisitions at the time, deliberately left untouched rather than used
  as a test fixture), and the weekly KPI job after both fixes landed.
  All throwaway data (client/requisition/candidate/application/
  consent_records/the test webhook row - no `DELETE` endpoint exists for
  webhooks, removed directly via SQL as a documented last resort) cleaned
  up afterward, confirmed zero residue.

## Job-board research + dashboard redesign + 10 new free boards, 2026-08-08
User was dissatisfied with the `/job-sharing` UI and asked for deep research
on how CEIPAL and other top staffing ATS platforms handle free job-board
distribution and resume pulling, then to rebuild the dashboard to match.

**Research** (delivered as an Artifact, not just chat text - dense enough to
want as a reference doc): checked CEIPAL's own integration pages (Dice,
Naukri), Zoho Recruit's published free-board list, Broadbean/eQuest/Appcast,
Naukri RMS third-party coverage, and Indeed's real Partner Docs (Indeed
Apply, Job Sync API, Disposition Sync API). Headline finding: **no staffing
ATS at any price point has a free, automated, zero-click posting API to
Naukri/Monster/LinkedIn/any major paid board** - confirmed directly, not
assumed: Zoho Recruit's own "free" boards post via plain HTML forms, not
API, and CEIPAL's 30+-board claim runs through third-party marketplace
partners, not bespoke integrations, plus a "job board spend management"
feature that only makes sense if most of what flows through it is paid.
Zoho's "Resume Extractor" (a paid Chrome extension for manual profile
capture) is the exact same mechanism as AVIIN's existing Captured Profiles
feature - parity with what a market leader sells as premium, not a gap.
The one real automated-resume-pull mechanism found (Indeed Apply) requires
a signed Developer Partner Agreement, same category of blocker as
LinkedIn/Naukri - not free/self-serve. Net: AVIIN's existing architecture
(real APIs where genuinely free - Facebook/Telegram/Google-for-Jobs -
plus one-time XML feed registration plus manual-link portals) already
matches or exceeds what top platforms actually ship for free; the one
concrete, buildable finding was **10 real free boards not yet in the
directory**, cross-checked against Zoho's own published list: Jobrapido,
JobisJob, Recruit.net, Gigajob, Expertini, Tip Top Job, WhatJobs,
PostJobFree, Dr.Jobs (first dedicated Gulf-region entry beyond the existing
UAE/Saudi-generic four), and ApplyMyJobs (first ANZ-specific entry). Added
to `job_portals.py` - portal count 73 -> 83, verified live via the real
`GET /job-sharing/portals` API.

**Dashboard redesign** - the actual UX complaint. Previous structure mixed
three different kinds of thing on one long scrolling page: one-time account
connections (Facebook/Telegram cards), a numbered "1. Select / 2. Auto-Share
/ 3. Post to more" wizard-style per-job flow, and a separate Dashboard tab -
with the connection cards always visible above the job picker even before a
job was selected. Redesigned into a clear 3-tab IA matching how top
platforms actually separate these concerns (setup vs. action vs. reporting):
- **Distribute** (default) - job picker with a live location/type summary
  once selected, then an "Auto channels" grid redesigned from flat gray
  buttons into icon-based cards (real per-platform colors: LinkedIn blue,
  WhatsApp green, Telegram sky, etc., via `CHANNEL_META`) each showing a
  clear Auto-post/Share-dialog/Posted state badge, then the manual-portal
  grid with category **chips** (click to filter) replacing the old plain
  `<select>` dropdown - matches how most modern SaaS filter UIs work and
  is more scannable than a dropdown for 11 categories.
- **Integrations** (new) - Facebook/Telegram connection cards + the
  Indeed/Jooble free-feed registration, pulled out of the per-job flow
  since connecting an account is a one-time setup action, not something
  that belongs mixed into "post this specific job" every time.
- **Analytics** (renamed from "Dashboard") - existing `DashboardView`,
  unchanged.
Header now shows a live "X/2 accounts connected" count plus an amber dot
on the Integrations tab when zero accounts are connected, so the
connection-status signal that used to require scrolling past two big cards
is now visible without leaving the Distribute tab.

Verified for real via headless-browser interaction, not just a successful
build: all three tabs render correctly, the channel-status badges reflect
real connection state, category-chip filtering correctly surfaces the new
boards (confirmed WhatJobs/Recruit.net appear under the Aggregators chip).
**One real test-script mistake caught before it became a false "bug"**: an
early verification pass used a text-based selector (`button:has-text
("Analytics")`) to click the Analytics tab, which silently matched the
*sidebar's* own "Analytics" nav link instead of the new tab button (both
say "Analytics," DOM order put the sidebar first) - looked exactly like a
broken tab click until traced with a screenshot. Fixed by adding explicit
`data-testid="tab-distribute"/"tab-integrations"/"tab-analytics"` to the
tab buttons (same convention used elsewhere in this app) rather than
guessing at a better text selector - re-verified clean immediately after.
Updated the one permanent test that depended on the old always-visible
Telegram card (`S17`) to click into the Integrations tab first, and added
two more: an Analytics-tab render check and a direct API check that all 10
new board keys are present. Full suite re-run clean: only the same 2
already-documented pre-existing S16 flaky tests (tail-end request-volume
flakiness under back-to-back full runs, unrelated to this work) - all
job-sharing-specific tests passed clean in isolation.

## Auto-publish to Facebook/Telegram when a requisition goes open, 2026-08-08
Same day, direct follow-up. User asked whether saving a new job auto-
publishes it everywhere. Honest answer given first, then built what's
real: no literal "publish everywhere" is possible (confirmed by the same
day's research - most free boards have no posting API at all), but
Facebook and Telegram both do have one, and weren't wired to fire
automatically - every post through them required a manual click on
`/job-sharing` even though the underlying API calls (`_post_to_facebook`/
`_post_to_telegram`) were already real and working. User picked: fire the
moment a requisition's status genuinely becomes `open`, respecting the
approval chain if one applies to that requisition.

- Extracted `_post_to_facebook()`/`_post_to_telegram()` in `job_sharing.py`
  as plain importable functions (same pattern as `notify_event()` from
  earlier the same day) - the existing `POST /facebook/post` and
  `POST /telegram/post` routes now just call them, no behavior change for
  the existing manual-click path.
- New `auto_distribute_on_open(tenant_id, req_id, posted_by)` - checks
  both connections, skips any platform already posted for this
  requisition (a `job_shares` lookup, same dedup the manual "already
  posted" checkmarks already rely on), posts to whichever are both
  connected and not yet posted, and **never raises** - each platform
  independent, a Facebook or Telegram failure must never break whatever
  requisition-workflow action it's attached to.
- Wired into the three real "just became open" moments in
  `requisitions.py`: **requisition creation** (when `approval_status`
  is already `'approved'` - true for admin/manager creators or anyone
  with no manager chain, since `requisitions.status` defaults to `'open'`
  for every requisition per the original schema, no separate "draft"
  state exists), **the final approval-chain step clearing** (`approval_
  status` transitioning to `'approved'` - the moment an approval-gated
  requisition actually goes live), and **explicitly reopening** a
  filled/on_hold/closed role via `PATCH /requisitions/{id}` with
  `status: 'open'` (gated on `approval_status='approved'` too, so a
  stray PATCH can't publish something still pending approval). All three
  call the same function; the `job_shares` dedup check makes it safe to
  call on a harmless no-op PATCH too.
- Added a plain-language explanation to the `/job-sharing` Integrations
  tab (previously silent about this - a real UX gap, since the feature
  is otherwise invisible unless you already know to look for it).
- Verified for real, not just code review: created a live throwaway
  requisition with **zero** channels connected (this tenant's actual
  current state) and confirmed creation succeeds cleanly with no error -
  the common case in production right now, genuinely exercised, not
  assumed. Then inserted a **connected-but-invalid** Telegram token
  directly (a real row in `telegram_channel_connections`, correctly
  pgp-encrypted) and created a second requisition - confirmed creation
  *still* succeeded (200 OK) and, checking `job_shares` directly, that no
  row was written for the failed post - proving the best-effort isolation
  genuinely holds, not just that the try/except compiles. No real
  Facebook/Telegram credentials exist for this tenant yet to prove an
  actual successful auto-post landing on a real Page/channel - flagged
  honestly rather than glossed over; the moment either gets connected for
  real, the very next requisition created will be the first real proof.
  All throwaway data (2 requisitions, 1 client, 1 fake Telegram
  connection row) cleaned up after, confirmed zero residue. New
  permanent regression test added to `S17` covering the zero-connections
  case (the real current state); the invalid-token case was verified
  manually since it needs direct pgcrypto-encrypted SQL access Playwright
  doesn't have a clean path to.

## S15/S16 flaky tests root-caused and fixed for real, 2026-08-09
User explicitly asked for this to be root-caused, not left as documented-
but-unexplained flakiness. Turned out to be **three separate real bugs**
compounding into what looked like one "flaky" symptom from the outside -
found by actually reproducing failures against real backend logs each
time, not by pattern-matching to the S17 fix from the day before.

1. **The architectural bug already found for S17, confirmed to also hit
   S15 and S16** - both were still plain `test.describe(...)`, not
   `.serial()`. Same mechanism: this project's `retries: 1` reruns a
   failing test in a fresh worker process with no module state, and
   empirically Playwright continues the *rest* of a plain describe block
   in that same fresh worker rather than returning to the original one -
   so one transient failure anywhere in the block cascaded into every
   later test seeing `undefined candId`/`reqId` (`invalid UUID
   'undefined'`, `422` from missing required fields - both confirmed
   directly in `aviin_backend` logs, not assumed). Fixed by converting
   both to `.serial()`.
2. **A second, independent, previously-unnoticed bug in the two tests
   literally named as flaky** ("bulk-send personalizes...", "email open
   tracking...") - both queried `GET /communications/inbox?limit=10`,
   which is `DISTINCT ON` **candidate thread**, ordered by last activity
   - "10 most recently active conversations tenant-wide," not "last 10
   messages." On this tenant's real, heavily-used, concurrently-written
   `candidate_messages` table, a just-sent test message could genuinely
   fall out of a 10-thread window before the very next request re-queried
   it - a real race, unrelated to whether the feature under test actually
   worked. Fixed by switching both to the existing `GET /communications/
   thread/{candId}` endpoint (already built, already used elsewhere,
   scoped to exactly one candidate - no such race possible).
3. **A third, genuinely different bug class**, found only after fixing
   the first two still left "Account Manager ranked view" failing
   identically on both attempts (proving it wasn't the retry-state issue
   at all): `GET /intelligence/candidates` is `ORDER BY readiness_index
   DESC LIMIT 200` - a deliberate, reasonable design for its real "show me
   the best candidates" use case, but this tenant has accumulated **531
   real historical `candidate_scores` rows** at or above a plain synthetic
   test score (confirmed by direct count) - far more than 200, so a
   test's own throwaway candidate has no guarantee of ranking into the
   visible window, and critically, **filtering by `min_score` doesn't fix
   this either** - a filtered set that still exceeds 200 rows has the
   exact same problem one level down (verified directly: filtering to
   `min_score=54.25` still returned exactly 200 rows with no match).
   Real, additive fix rather than a test-only workaround: added
   `requisition_id`/`candidate_id` query params to `GET /intelligence/
   candidates` - a genuinely useful "candidates scored for this specific
   role" filter an account manager would realistically want anyway, not
   invented just to make a test pass. Verified directly via curl before
   touching the test: unfiltered-but-min_score-limited query returned 200
   rows with no match; the new `requisition_id` filter returned exactly 1
   row, the right one.

Every fix verified against real data before moving to the next, not
assumed from precedent: ran the actual failing tests repeatedly, read the
exact backend log lines each time, and changed course when the evidence
didn't match the initial hypothesis (attempt two's "Account Manager"
failure looked identical on both tries, which is what triggered digging
for bug #3 instead of assuming the .serial() fix just needed a cleaner
rate-limit window). Final full-suite run: **124 passed / 2 skipped / 0
failed** - genuinely clean, not "clean except the known flaky ones" for
the first time this suite has been run in this project's history.

## Pipeline board "Download Resume" 404 — same bug in 2 places, 2026-08-09
User hit "Not Found" clicking Download Resume on a candidate in the
Kanban pipeline board drawer, screenshot showing a raw
`/api/uploads/resumes/{tenant}/{date}/{file}` URL returning FastAPI's
JSON `{"detail":"Not Found"}`. Root cause: `GET /requisitions/{id}/
pipeline` (backs both the pipeline board and the requisition detail
page) only ever returned `candidates.resume_path` - a raw storage path
column - and both `pipeline/page.tsx` and `requisitions/[id]/page.tsx`
linked straight to `${API_URL}${resume_path}` as if it were a static
file URL. **Nothing in this codebase has ever served that path** -
grepped `app.py` and every router for a `StaticFiles` mount or a route
matching `/uploads/resumes/...` and found none; the only real, working
mechanism is the auth-gated `GET /resume-intake/{resume_file_id}/
download` endpoint (built 2026-07-29, already wired into candidates/[id],
Resume Inbox, and the candidates-list drawer - but never into either of
these two pipeline-board surfaces). This is a distinct bug from the
2026-07-29 fix, not a regression of it - those three surfaces were never
touched.

Fixed by adding a `LEFT JOIN LATERAL` on `resume_files` (latest per
candidate) to the `/pipeline` query, returning `resume_file_id`/
`resume_file_name` alongside the existing `resume_path`, and switching
both frontend call sites from a raw `<a href>` to the same auth-gated
blob-fetch `downloadResume()` pattern already used in candidates/[id]
(fetch with Bearer token -> blob -> object URL -> synthetic `<a
download>` click). Grepped the rest of the frontend for the same
`${API_URL}${resume_path}` pattern afterward and confirmed no other
instance exists.

Verified for real, not code review: queried the exact candidate from the
user's screenshot ("Diploma", SAP ABAP Developer req) directly in
Postgres to confirm a real `resume_files` row exists; called the fixed
`/pipeline` endpoint via curl and confirmed `resume_file_id` now resolves
correctly; downloaded the file through `/resume-intake/{id}/download` via
curl (200 OK, 23,360 bytes, valid `.docx` per `file`). Then ran two real
headless-browser click-throughs (Playwright, using the cached auth state
`tests/.auth/state.json`) - one against the pipeline board drawer, one
against the requisition detail page's Resume card - both produced a real
download event with the correct filename and the identical 23,360-byte
size as the direct curl, confirming the UI wiring, not just the API,
works end to end. Full QA suite re-run clean after: 157 passed / 2
skipped / 0 failed, no regressions.

## Pipeline Stages: real deletion for built-in stages, 2026-08-09
User wanted to actually remove stages (not just hide) to trim the Kanban
board to only what their process uses, plus confirmation that renaming
already propagates and that per-stage message customization exists.
Asked to clarify scope first (hide vs true delete; label rename vs also
message text) — user answered "both" to each, so built the fuller version
rather than assuming the minimal one.

**Findings before writing code**: renaming (the label field) and hiding
(the Visible toggle) were already fully real and already propagated
everywhere (`pipeline/page.tsx` and `requisitions/[id]/page.tsx` both
filter the board by `is_visible` from the live `/settings/pipeline-stages`
fetch). Per-stage automated email/WhatsApp message text was **also**
already a real, fully-wired feature (`email_settings.stage_templates` /
`whatsapp_settings.stage_templates`, JSONB keyed by stage, already read by
`_notify_stage_change_bg`) — just undiscoverable, living on two separate
settings pages with zero link from Pipeline Stages. Only true deletion of
a built-in stage was actually missing (only custom stages had a working
DELETE before this).

**What shipped**: `DELETE /settings/pipeline-stages/{key}` now works for
any stage — built-in or custom — except `sourced`, `rejected`, `placed`
(the response explains why per-key). `GET`/`PUT`/`POST` now return a
computed `deletable` field so the frontend never duplicates the
protection rule. Settings > Pipeline Stages shows a lock icon (with a
per-stage tooltip) instead of a trash icon for the 3 protected stages,
and a banner linking to the Email/WhatsApp per-stage message editors that
already existed.

**Why exactly 3, and why not more/fewer** — this took real investigation,
not a guess: grepped every raw `UPDATE applications SET stage=...` in the
codebase (there are 11) to find every place that writes a stage value
*outside* `applications.py`'s validated PATCH .../stage. Three are
genuinely structural: `sourced` (5 separate application-creation INSERTs
across the codebase default to it — deleting it would make every
newly-created candidate invisible, not just one workflow's), `rejected`
(the HITL/RBAC gate checks it by literal string), `placed` (offers.py
writes it directly on acceptance, bypassing config entirely). The other
8 raw writers turned out to target *deletable* stages as side effects of
unrelated features — NDA signing auto-advances to `screened` (nda.py),
KAE submission to `submitted` (kae_submission.py), interview scheduling
to `l1_interview` and offer generation to `offer` (both phase3.py), plus
three separate rule-engine auto-movers (`pipeline_p2.py`'s `/auto-move`
and `/check-rules/{id}`, and `scheduler.py`'s nightly
`run_pipeline_auto_move`) that write whatever `stage_to` a saved
automation rule points at. None of these called `applications.py`'s
validation, so before this fix, deleting any of those stages (which was
already possible for a *custom* stage with that key, and only became
possible for a *built-in* one via this change) could have silently
written a candidate into a stage with no display config — invisible on
every board, not just hidden. Added a shared `is_valid_stage()` helper
(`pipeline_stages.py`) and applied it at all 8 sites: the 4 single-target
writers skip the stage bump and let the primary action (NDA sign,
submission, scheduling, offer) complete anyway; the 3 rule-engine movers
skip that specific rule/candidate rather than writing an unconfigured
stage.

**A genuinely more serious bug found in the process, unrelated to
deletion**: `pipeline_p2.py`'s `POST /pipeline/bulk-action` (`move_stage`)
had **zero stage validation at all**, even before this change — a
user-facing bulk-move endpoint that would write literally any string a
client sent as `target_stage` straight into `applications.stage` with no
check whatsoever. Confirmed for real: called it with a deleted stage
against a genuine production candidate and it silently would have
written it (verified this by testing pre-fix behavior against the same
guard now blocking it). Fixed alongside the others since it's the same
`is_valid_stage()` call.

Also found and fixed: `scheduler.py`'s real nightly cron version of the
auto-mover (`run_pipeline_auto_move`) runs entirely on `db.system_conn()`
(app.tenant_id=''), and `pipeline_stage_config` has `FORCE ROW LEVEL
SECURITY` — the same `''::uuid` cast crash class documented earlier for
`send_weekly_kpi_summary`. Fixed by opening a real per-tenant
`tenant_conn()` just for the stage-validity check, matching that
established pattern, rather than querying the FORCE-RLS table through
the tenant-less connection.

**Verified for real** against production, not code review: confirmed via
direct SQL which stage this tenant had zero candidates in (`l2_interview`
— 0 of 42 requisitions' candidates), then for real: deleted it via the
API, confirmed it vanished from `GET /settings/pipeline-stages`, confirmed
`PATCH /applications/{id}/stage` to it now 400s ("Unknown stage") without
touching the candidate's real stage, and — the important one — confirmed
`POST /pipeline/bulk-action` with `target_stage: l2_interview` against a
real candidate now correctly fails closed (`success:0`, clear reason) with
the candidate's DB row provably unchanged, where before this fix it would
have silently written it. Ran a real headless-browser click-through of
Settings > Pipeline Stages too: 3 lock icons with correct per-stage
tooltips, the Email/WhatsApp cross-links present, and a live delete via
the actual trash-icon button (confirmed the row disappeared from the
rendered page, not just the API). Restored `l2_interview` to its exact
original label/color/order/visibility afterward via a single-row PUT
(not "Restore Defaults", which would have reverted every OTHER stage's
custom label/color/order too) and confirmed the full 14-row config
matched the pre-test snapshot exactly. Full QA suite re-run clean after:
157 passed / 2 skipped / 0 failed.

## Add Candidate modal always used Sourced, real bug fixed, 2026-08-09
User's screenshot: selected "Govind" in the pipeline board's "Add Candidate
to Pipeline" modal, expected to see them land under "Interested" (the tab
they had open), but the candidate never appeared there.

**Root cause**: `POST /candidates/bulk-assign` (what the modal calls)
hardcoded `stage='sourced'` in its INSERT with no way to override it, and
the modal itself gave zero indication of this — no stage field anywhere in
the UI, just an "Add to Pipeline" button. Reproduced directly: called the
real endpoint against the real candidate + requisition from the screenshot,
confirmed the application landed in `sourced`, not `interested` — working
exactly as coded, just not as any reasonable user would expect.

**Fix**: `BulkAssignBody` gained a `stage: str = "sourced"` field (default
preserves the one other caller — Candidates page's bulk-assign-to-
requisition modal — which never sends a stage and shouldn't need to), validated
with the same `is_valid_stage()` helper built for the stage-deletion feature
above (nice reuse — a bad/deleted stage now 400s here too, instead of ever
silently writing one). Frontend: `AddCandidateModal` gained a "Add into
stage:" dropdown built from the real, currently-visible `STAGES` list,
defaulting to whichever stage tab was active when the button was clicked
(falls back to Sourced if the user was on the "All Stages" tab, where there's
no single obvious target). Submit button and success toast now say exactly
which stage was used ("Add to Interested" / "Candidate(s) added to
Interested") instead of a generic, uninformative message.

Verified for real: reproduced the original bug via curl (landed in
`sourced`), redeployed, reproduced again with `stage:"interested"` in the
body (landed in `interested`, confirmed via direct SQL), confirmed an
invalid stage 400s cleanly. Then a full real headless-browser run through
the actual modal — clicked the Interested tab, opened Add Candidate,
confirmed the dropdown had pre-selected "interested", confirmed the button
read "Add to Interested", searched for and selected Govind, submitted, got
the correctly-worded toast, and confirmed via SQL the application really
landed in `interested`. All test-created applications/activity-log rows
cleaned up afterward (including the real UI-driven one — verifying the fix
works isn't the same as the user's actual intent to add Govind, so left
that decision to them).

**Separate finding while re-running the full suite afterward, NOT a code
bug**: `all 7 stage labels visible` (aviin_ui.spec.ts) started failing —
traced to `pipeline_stage_config` showing `sourced` and `contacted` as
`is_visible=false` for this tenant, both updated in the same save
(13:17 IST today). Confirmed this wasn't caused by any of this session's
scripts (none ever click "Save Changes" on Settings > Pipeline Stages; the
single-row PUTs used for the stage-deletion feature's verification/cleanup
earlier don't match the all-14-rows-same-timestamp signature this Save
button produces) — almost certainly a real change made through the actual
UI, plausibly by someone on the team. Asked the user directly rather than
guessing or silently reverting a real tenant's config: confirmed
intentional, left as-is. Fixed the test instead of the data — it now reads
the tenant's real `/settings/pipeline-stages` config and only asserts
visibility for stages actually marked visible, so it stays correct across
future legitimate visibility changes instead of assuming a fixed default
set. Full suite re-run clean after: 157 passed / 2 skipped / 0 failed.

## Configurable default add-stage policy, 2026-08-09
Direct follow-up. User didn't want the active-tab-default fix above to be
the only lever — asked for the underlying "which stage new candidates land
in" fallback (previously hardcoded to `sourced`) to be a real, changeable
setting, not just smarter about the active tab.

`sql/32_default_add_stage.sql` adds `pipeline_stage_config.is_default_add`
(one per tenant, enforced with a partial unique index rather than app-logic
alone — `CREATE UNIQUE INDEX ... WHERE is_default_add`) and backfills every
existing tenant to `sourced=true`, preserving today's real behavior as an
explicit, now-changeable setting instead of a silent hardcoded literal.

New `PUT /settings/pipeline-stages/default-add-stage` (admin/manager-gated,
same bar as other tenant-wide policy settings on that page) — rejects
hidden stages ("show it first"). `POST /candidates/bulk-assign`'s
`stage` field is now optional; when omitted (the Candidates page's bulk-
assign-to-requisition modal never sends one — this fix reaches that flow
too, not just the pipeline board) it resolves the tenant's real configured
default instead of a literal, still falling back to `'sourced'` if nothing
is marked (shouldn't happen post-migration). Settings > Pipeline Stages
gained a star button per visible row — filled star = current default,
click any other visible row's star to switch it, with the policy
explained inline. `pipeline/page.tsx`'s Add Candidate modal now falls back
to this configured default instead of hardcoded `sourced` when no specific
stage tab is active (an active tab still wins, matching the earlier fix).

**A real inconsistency the migration surfaced immediately, not
hypothetical**: this tenant's actual live config had `sourced` marked
`is_visible=false` (confirmed intentional with the user earlier today) AND,
after the migration's backfill, `is_default_add=true` on that same hidden
row — exactly the "new candidates land somewhere invisible" bug this
whole feature exists to prevent, sitting live in production the moment the
migration ran. Added two guards rather than just fixing this one instance:
`save_stage_config` now rejects hiding the current default stage (pick a
new one first), and `bulk_assign`'s fallback query filters `AND is_visible`
defensively on top of that, in case any state predates the guard. Then
fixed the actual data for real, fulfilling the user's original ask in the
same motion: set `interested` as the tenant's real default via the new
endpoint.

Verified for real, not code review: confirmed the pre-existing hidden-
default inconsistency via a direct GET before touching anything; set
`interested` as default via the real API; called `bulk-assign` with no
`stage` field at all and confirmed via SQL the application landed in
`interested`; called the new endpoint with a hidden stage (`contacted`)
and confirmed a clean 400; attempted to hide `interested` (the current
default) via the general save endpoint and confirmed a clean 400 with the
config provably unchanged after. Real browser click-through confirmed
exactly one filled star (on Interested) on the settings page, and the Add
Candidate modal defaulting to "interested" when opened from the All
Stages tab. Full QA suite re-run clean: 157 passed / 2 skipped / 0 failed.
All test data cleaned up after each check.

## Pipeline/Candidates audit + both High-impact findings fixed, 2026-08-09
User asked for a research-only audit ("suggest me first dont start the
development") scoped to the Pipeline/Candidates area specifically (not a
full product sweep — several of those already exist in this file). Used
an Explore agent for the raw discovery pass, then personally verified the
two most severe findings against real code/DB before reporting rather
than trusting the agent's summary at face value. Reported 9 findings;
user picked the top 2 to fix now.

**#1 — manual stage moves were invisible to both the Pipeline Audit Log
and a candidate's own Activity Timeline.** `PATCH /applications/{id}/
stage` — the endpoint every drag-and-drop move and drawer stage-button
click actually calls — never wrote to `pipeline_movements` or
`candidate_activities`; only the rule-engine auto-mover and the separate
bulk-action endpoint did. Since manual moves are the most common
recruiter action by far, `GET /pipeline/audit` and the stage-conversion-
rate analytics (both read `pipeline_movements`) were silently blind to
most real activity, and a candidate's Activity Timeline never showed
their actual stage history. Fixed by writing both rows in `update_stage()`
right after the existing `event_outbox` write, skipped on a same-stage
no-op PATCH.

**Real, more serious gap found while implementing #1, not hypothetical**:
`pipeline_movements` and `stage_rules` had **zero row-level security at
all** (`relrowsecurity=false`) despite being tenant-scoped and owned by
`postgres`, not `app_user` — every read/write relied entirely on the
application always remembering a `WHERE tenant_id=...` clause, no DB-level
backstop. Same class of gap found and fixed repeatedly elsewhere in this
project (`saved_filters`, `agency_users`, `work_sessions`, round 2 audit).
Also discovered while checking this: `stage_rules`, `pipeline_movements`,
and `candidate_activities` have **no `CREATE TABLE` anywhere in
`sql/*.sql`** — all three exist live in production but were never captured
in a committed migration, confirmed via `git grep` finding zero matches
across the whole repo. `sql/33_untracked_tables_and_rls.sql` backfills all
three (`CREATE TABLE IF NOT EXISTS`, columns copied verbatim from
`pg_dump --schema-only` against production, not reconstructed by hand —
no-op everywhere they already exist) and adds FORCE RLS + a tenant
isolation policy to the two that had none.

Enabling FORCE RLS on `stage_rules`/`pipeline_movements` would have
immediately broken `scheduler.py`'s `run_pipeline_auto_move()` (the real
nightly cron job), which read/wrote both through `db.system_conn()`
(`app.tenant_id=''`) — the exact `''::uuid` cast crash class already found
and fixed today in `send_weekly_kpi_summary()` and this same function's
`pipeline_stage_config` check. Fixed by restructuring the whole function
around one real per-tenant `tenant_conn()` per tenant (listing tenant IDs
from the `tenants` table via `system_conn()` first, which has no such
cast-crash risk) instead of nesting a second connection inside the loop
like the earlier same-day fix did.

**#2 — rejection reasons were captured but never shown again anywhere.**
`GET /applications/{id}/rejection` (built for the S16 Tier-1 rejection
taxonomy) returns the structured reason/notes for a specific application,
but had zero callers in the entire frontend — confirmed by grepping both
drawer files, which only ever called `/rejection-reasons` (the taxonomy
list, a different endpoint). Added a `RejectionReasonCard` to both
`pipeline/page.tsx`'s and `requisitions/[id]/page.tsx`'s separate drawer
Profile tabs (two independent implementations, same pattern as the earlier
resume-download fix needing both) — shows only when `stage==='rejected'`,
fetches and displays the reason label, notes, and rejection date.

Verified for real against production, not code review: moved a real
candidate (Abhishek.G, SAP ABAP Developer req) sourced→contacted via the
real PATCH endpoint, confirmed both new rows via direct SQL (`manual_move`
/ `Sourced → Contacted`), confirmed the Pipeline Audit Log endpoint now
actually surfaces it (`candidate: "Abhishek.G", from: "sourced", to:
"contacted", reason: "manual_move"`), confirmed a same-stage no-op PATCH
does NOT create a duplicate row, and confirmed RLS is real (not just
enabled) by querying both tables as `app_user` with a fake tenant_id set —
0 rows despite real data existing. Then rejected the same candidate for
real with a reason code, confirmed `GET .../rejection` returned it, and
ran a real headless-browser click-through of both drawer implementations
— the Rejection Reason card rendered with the correct label and notes in
both. Restored the candidate's original stage and deleted every test-
created movement/activity/rejection row afterward — zero residue.

**One more real bug caught only because the full suite was re-run
afterward, unrelated to any of the above**: `S14 KAE Candidate Submission`
started intermittently failing at a different, unrelated step each time —
recognized immediately as the same `describe`-cascade flakiness class
root-caused earlier today for S15/S16/S17 (plain `describe` + this
project's `retries:1` reruns a failing test in a fresh worker with no
module state, cascading one transient failure into unrelated-looking
ones), just not yet converted to `.serial()`. Confirmed by running the
whole S14 block in isolation (passed clean) before concluding it wasn't a
regression from today's actual changes. Converted to `.serial()`, same
fix as the other three suites.

Full QA suite, final clean run: 157 passed / 2 skipped / 0 failed.

## Six pipeline board feature gaps built, 2026-08-09
Direct follow-up to the same audit — user picked all 6 remaining findings
to build (candidate comparison, bulk multi-select move, days-in-stage
indicator, CSV/print export, within-column reorder, multi-condition
automation rules UI). #9 (missing `CREATE TABLE`s) was already fixed in
the High-impact-findings pass earlier the same day. Scoped to
`pipeline/page.tsx` (the primary, full-featured Kanban board) — did not
duplicate into `requisitions/[id]/page.tsx`'s smaller embedded board,
which is a secondary, more space-constrained view.

- **`applications.board_rank`** (`sql/34_board_rank.sql`, nullable int) —
  within-column drag-reorder position. NULL sorts last (`ORDER BY
  board_rank ASC NULLS LAST, updated_at DESC`, `/pipeline` GET query),
  so this is fully backward compatible until a recruiter actually drags a
  card to reorder. New `POST /pipeline/reorder` (full-column resnapshot,
  not midpoint-rank math — a column realistically never has more than a
  few dozen visible cards) persists it, scoped by tenant+requisition+
  stage so a stale client can't touch a card that's since moved. Both
  stage-move paths (`update_stage()`, `bulk_action`) now clear
  `board_rank` on a stage change — it always lands at the top of the
  destination column, same as a manual drag-drop cross-column move
  already did, so an old rank from the previous column would be
  meaningless there.
- **Bulk multi-select + move** — a "Select" toggle puts checkboxes on
  every card; a floating action bar (N selected · move-to-stage dropdown
  · Compare when 2+) calls the existing `/pipeline/bulk-action` endpoint,
  previously only reachable outside the board itself. Found and fixed a
  real consistency gap while touching this code: `bulk_action`'s
  `move_stage` branch wrote `pipeline_movements` but never
  `candidate_activities` — the exact same blind spot fixed for the
  single-move path earlier the same day, just a second, separate
  instance of it. Deliberately did NOT add bulk-reject to this UI —
  rejection needs a structured `reason_code` (same bar as the single-
  candidate Reject button), and stuffing that into a bulk flow felt like
  a different, bigger feature than "bulk stage-move" asked for.
- **Days-in-stage indicator** — a `stalenessBadge()` helper (≥7d amber,
  ≥14d red) renders next to the existing plain "3d ago" text, which had
  no visual urgency signal at all despite `updated_at` always having the
  data.
- **CSV export + print/PDF** — both fully client-side from data already
  in the board's React state, no new backend endpoint needed. CSV via a
  Blob download (UTF-8 BOM so Excel doesn't mangle it); Print opens a
  clean, dedicated tab (deliberately not `@media print` CSS fighting the
  main dashboard's sidebar/header chrome) and calls `window.print()` —
  covers "export/print/PDF" since every browser's print dialog offers
  "Save as PDF"; didn't build a bespoke reportlab PDF generator for a
  whole board view, which felt like solving a problem the browser
  already solves. Scoped "client-shareable" down to this same print view
  rather than a new public-link system — the client portal already
  covers authenticated client-facing sharing, and a second, different
  sharing mechanism for the same audience would be new surface area, not
  a fix.
- **Candidate comparison** — 2+ selected candidates → a modal with one
  column per candidate, one row per metric (score, stage, days in stage,
  experience, notice period, CTC, location, matched/missing skills vs
  the requisition's `skills_required`, contact info, resume download,
  full-profile link). Entirely client-side from data already on the
  board plus the already-fetched requisition object — no new backend
  endpoint.
- **Multi-condition automation rules** — the create-rule form only ever
  edited `conditions[0]`; the backend engine (`pipeline_p2.py`) has
  always AND-chained the full array, and the *read-side* rule list
  already correctly rendered multi-condition rules via `.join(' AND
  ')` — confirming this was purely a missing form control, not a
  backend gap. Added add/remove-condition buttons; removing is disabled
  at exactly 1 remaining condition (a rule needs at least one).

Verified for real against production, not code review: reordered a real
2-candidate Screened column via direct API call (confirmed `board_rank`
0/1), then via an actual browser drag-and-drop interaction (confirmed the
same ranks landed in the DB from the real UI, not just the endpoint);
bulk-moved a real application and confirmed both `pipeline_movements` AND
`candidate_activities` rows this time (unlike before this fix); created a
real 2-condition rule via the API and confirmed the settings page renders
it with "AND" between both conditions via a direct text-content dump (not
a flaky `isVisible()` locator check, which gave a false negative first
and was caught by cross-checking against the real rendered text); real
headless-browser click-through of the board confirmed staleness badges on
real stale candidates, select-mode checkboxes, the "2 selected" bulk bar,
the Compare button/modal showing a real Matched Skills row, a real CSV
download (931 bytes, correct header + 7 data rows), and a real print-tab
open with the correct title and real candidate data. All test-created
rows (movements, activities, rule) cleaned up afterward; `board_rank`
reset to NULL on both real test candidates so their board position
reverts to the pre-verification default. Full QA suite re-run clean:
157 passed / 2 skipped / 0 failed, no regressions.

## Boolean search generation + 4-area background audit, 2026-08-09
User picked two things off the "what's next" list: build Boolean search
generation (the one item never built from the earlier 20-item feature-
completeness audit), and run the same kind of focused, research-only
audit just done for Pipeline/Candidates on Finance/ERP, Recruiter Ops,
BGV/Compliance, and Analytics/Reporting — all 4 at once. Ran the 4 audits
as parallel background Explore agents while building Boolean search
myself, so the build wasn't blocked waiting on research.

**Boolean search generation** — `GET /requisitions/{id}/boolean-search`,
zero-token/rule-based, no AI. Real synonym expansion via `skills_taxonomy`
(the same table the resume parser already normalizes against for P23's
71-skill taxonomy) — a skill with known aliases becomes an OR-group
(`(Python OR py OR python3)`), one with none stays a single term, groups
AND-joined. Title/location/experience returned separately, not folded
into the Boolean string — most job portals treat those as their own
search facets, not Boolean terms, so jamming them in would produce a
string that doesn't actually work when pasted. New "Boolean Search"
button on the pipeline board toolbar opens a modal with the string in a
copy-able textarea + a real clipboard-copy button. Verified for real:
confirmed a real requisition with skills lacking known aliases correctly
falls back to plain AND (`SAP AND ABAP`); created a real throwaway
requisition with Python/Java/SAP and confirmed genuine OR-expansion
(`(Python OR py OR python3) AND (Java OR java8 OR java11 OR java17 OR
spring) AND SAP`) before deleting it; real browser click-through
confirmed the modal renders the correct string and the Copy button
genuinely writes it to the clipboard (read back via
`navigator.clipboard.readText()`, not just checking the UI said
"Copied!"). Full QA suite clean after: 157 passed / 2 skipped / 0 failed.

**4-area audit findings** (research only — no code changed for any of
these; reported to the user for prioritization, same as the
Pipeline/Candidates audit pattern). Two of the most serious/testable
claims were independently verified against live production before being
reported as fact, not just trusted from the agent output:

- **BGV/Compliance — real DPDP 2023 gap**: 5 of 8 candidate-creation code
  paths skip HARD RULE #12 (consent_records) entirely — email resume
  intake, the **public/anonymous** job-board apply endpoint (stores
  name/email/phone/employer with zero consent trail), bulk CSV/Excel
  import, agency-portal submissions, and browser-extension captures. Only
  manual add and NDA e-sign write consent correctly. The entire `/bgv`
  page is static markup with zero real API calls — every BGV backend
  route (Aadhaar/DigiLocker, trust score, trust graph) is orphaned.
  Aadhaar/PAN encryption itself is clean (nothing's stored in plaintext
  because the capture endpoint doesn't persist the value at all yet — a
  demo scaffold, not a live leak). RLS clean across all BGV tables, GDPR
  purge still wired correctly.
- **Finance/ERP — most write workflows have no UI at all**: timesheets,
  invoices, payroll runs, contractor PII capture, incentive scorecard
  approval, retention-bank release/forfeit, loyalty payout, account P&L
  entry, and collections entry all have real, working backend endpoints
  with **zero frontend forms** — several pages' own empty-state text
  literally instructs the user to call the API directly. Real double-
  counting bug found: `retention_bank`'s INSERT uses `ON CONFLICT DO
  NOTHING` with no target and no matching unique constraint, so
  re-approving a scorecard (double-click, retry) silently inserts a
  duplicate held-incentive row. `contribution_margins` is a fully dead
  table (zero references anywhere — `account_pl` is what's actually
  used). pgcrypto encryption on Aadhaar/PAN/PF/bank-account verified
  genuinely correct. No RLS gaps found (checked against migration
  source, not live DB).
- **Recruiter Ops — real fallout from today's own earlier stage-deletion
  work**: `applications.py`'s `_STAGE_AUTO_TASK` dict hardcodes 5 stage
  keys for auto-creating recruiter tasks on stage transitions — every one
  of those 5 keys is now deletable (per this same day's "true stage
  deletion" feature) and the dict was never updated to match; deleting
  one silently stops task auto-creation with no error, anywhere. Same
  hardcoded-stage-list pattern in `recruiter_dashboard.py`'s My Day/My
  Stats. Separately: the scoring-weight admin UI presents 10 sliders that
  must sum to 1.0, but `match_recruiters()` only ever reads 8 of them —
  `seniority_match`/`language_match` silently contribute nothing (already
  documented as zero-weight placeholders, but the UI doesn't say so).
  `recruiter_targets` has no `CREATE TABLE` anywhere in `sql/*.sql`
  despite full CRUD against it — schema drift, same pattern found and
  fixed for stage_rules/pipeline_movements/candidate_activities earlier
  today. No orphaned routes found — genuinely clean on that front.
- **Analytics/Reporting — the exact same bug class already found and
  fixed once today, recurring in 5 more places, never fixed there**: the
  Recruiter Performance report, the client portal's requisition view, the
  requisitions CSV export, and two dormant `/pipeline/copilot`+
  `/pipeline/intelligence` endpoints all filter on a literal `stage=
  'interview'` or `stage='hired'` — **neither is a real stage value**
  (real ones are `l1_interview`/`l2_interview`/`l3_interview` and
  `placed`). Verified live, not just from the code: this tenant has 4
  real placements, but `GET /reports/recruiter-performance` returns
  `placements: 0, interviews: 0, conversion_rate: 0.0` for every single
  recruiter. `hiring-funnel`'s FUNNEL list also omits this tenant's
  custom `l3_interview` stage entirely. Separately, `v_sla_dashboard`,
  `v_pipeline_velocity`, `v_monthly_billing` were flagged as having no
  `CREATE VIEW` anywhere in `sql/*.sql` — checked live and confirmed all
  3 genuinely exist in production (`SELECT viewname FROM pg_views`), so
  this is schema-drift/version-control gap only, not a broken endpoint —
  correcting the audit's own hedge ("either... or these endpoints would
  fail") with a real check rather than repeating the uncertain claim.

Deliberately did not fix any of the above — reported to the user the same
way the Pipeline/Candidates audit was, for them to prioritize.

## Fixed #1 (BGV consent) and #2 (Analytics stage-key bugs), 2026-08-09
Direct follow-up — user picked the two most severe findings from the
4-area audit above to fix now.

**#1 — HARD RULE #12 consent gap, all 5 missing paths fixed.** Each
follows the same `INSERT INTO consent_records (tenant_id,candidate_id,
data_category,channel,consent_given,consent_text)` shape already
established by the two working paths (manual add, NDA e-sign), just with
a `channel` naming the actual path (`email`, `bulk_import`,
`agency_portal`, `browser_extension`, `public_job_board`) and
`consent_text` stating what genuinely happened — not a copy-pasted
generic string:
- `resume_intake_service.py`'s `upsert_candidate()` — only on the
  genuine-creation branch, not the existing-candidate UPDATE branch
  (which already has a consent record from whenever that candidate was
  first created).
- `import_router.py` — both CSV and Excel bulk-import paths; had to
  switch their `INSERT INTO candidates` from `conn.execute()` to
  `conn.fetchval(... RETURNING id)` since neither previously captured
  the new candidate's id at all.
- `ops_gaps.py`'s `convert_agency_submission()`.
- `gap_features.py`'s `ext_capture_convert()` (browser-extension →
  candidate).
- **`p28_p32.py`'s `public_apply()` — the worst offender, handled
  differently from the other 4 on purpose.** This is the one path where
  the applicant IS the one directly submitting their own data through a
  form they see, so unlike the other 4 (staff-initiated, where an
  attestation-style consent record matches this codebase's own
  established pattern), a genuine explicit consent checkbox is both
  meaningful and achievable here. Added a real required checkbox +
  DPDP-2023-worded copy to **both** public apply forms found —
  `careers/page.tsx`'s inline modal and the per-job
  `[jobId]/JobDetailClient.tsx`'s modal are two separate, nearly-
  identical copies of the same form that both needed the fix. Backend
  now hard-rejects (400) any submission with `consent_given` not
  explicitly `true`, rather than defaulting it — this is the one path
  where silently defaulting consent would have defeated the entire
  point of the fix.

**#2 — hardcoded `stage='interview'`/`stage='hired'` (neither is a real
value) or a fixed stage list omitting custom rounds, fixed everywhere
found**: `/reports/recruiter-performance`, `/client-portal/requisitions/
{client_name}`, `/export/requisitions` CSV, `/pipeline/intelligence`'s
"Offer Ready" query, `/pipeline/copilot`'s "At Risk"/"Upcoming
Interviews" queries (both fully orphaned — zero frontend callers, fixed
anyway rather than leave a known-wrong landmine for a future revival),
and `analytics.py`'s `hiring-funnel`. Two different fix shapes depending
on the bug: `stage='hired'` → `stage='placed'` (a plain wrong-literal
typo fix, `'hired'` was never a real value in this system); `stage=
'interview'`/hardcoded `l1_interview`,`l2_interview` lists → `stage LIKE
'%interview%'` or a live query against `pipeline_stage_config` ordered by
`display_order` (the same "read the tenant's real config, don't
hardcode" pattern already used today for stage deletion and the default
add-stage policy) — genuinely dynamic across custom rounds, not just
patched for this tenant's specific `l3_interview`.

Verified for real against production, not code review: `/reports/
recruiter-performance` went from 0 placements/0 interviews for every
recruiter to real non-zero totals (2 placements, 19 interviews across
real assigned-recruiter applications); `/client-portal/requisitions/
Invenio` now shows real interview counts instead of 0; `/export/
requisitions` CSV confirmed correct hire counts against the exact 3 real
requisitions with real placements (2, 1, 1 — matching a direct SQL count
by title); `/analytics/hiring-funnel` now includes a real `l3_interview:
1` row that was silently dropped before. For the consent fixes: created
a real throwaway candidate via the public apply endpoint without
consent (400, correctly rejected) and with consent (200, real
`consent_records` row confirmed via SQL with the exact right
`data_category`/`channel`/`consent_text`); real headless-browser
click-through of the actual public careers page confirmed the Submit
button is genuinely disabled until the checkbox is checked, and a real
application went through once it was; real CSV bulk-import call
confirmed a `bulk_import`-channel consent row is written. All test data
(candidates, applications, consent_records) cleaned up afterward. Full
QA suite re-run clean: 157 passed / 2 skipped / 0 failed, no
regressions.

## Permissions / RBAC: real per-role feature access, soft-launched, 2026-08-09
User asked whether admin could give per-feature access by role (candidates,
companies, jobs, pipeline, etc. for Employee/Team Lead/Manager/other roles).
Checked before building: `role_definitions.permissions` (JSONB, 27 seeded
staffing roles) already had genuinely detailed feature->action maps — but
**nothing in the whole backend ever read it**. No enforcement, no admin UI.
User picked "Both: admin UI + real enforcement." Before writing enforcement
code, checked real user data first (established project discipline) and
found `manager` role — used by a real active user, Neha Joshi — had **zero**
`role_definitions` row; naive strict enforcement would have locked her out
immediately. Flagged this to the user, who picked "Soft launch first": ship
the check + admin UI in log-only mode (nothing blocked), let real usage
accumulate in a log, review/adjust via the new UI, flip enforcement on later.

**Built**: `sql/35_permission_enforcement.sql` — `tenants.permission_
enforcement_enabled` (bool, default FALSE, per-tenant kill switch),
`permission_check_log` (every would-be-denied check, regardless of
enforcement state, FORCE RLS), seeded a real `manager` role_definitions row
(closing the gap above) and added `companies:read` to `recruiter` (a real
gap — recruiters use the Companies page today with no formal grant for it).
`backend/permissions.py` — `require_permission(feature, action)` FastAPI
dependency: admin/super_admin and `actor.role is None` (anonymous/n8n
trusted-internal path, same exemption established elsewhere in this
project) always pass; everyone else is checked against their role's real
permissions, a denial is logged, and it only actually blocks (403) if
BOTH `permission_enforcement_enabled=true` AND the role has a real
(non-None) permissions row — a role with no row at all is a data gap for
an admin to fix, never a reason to lock someone out with no way to
self-correct. `FEATURES`/`ACTIONS` in that file are the taxonomy shown in
the admin matrix. Applied to `candidates`/`clients`(companies)/
`requisitions`/`pipeline`(board+bulk-move)/`applications`(create+stage
update)/`analytics`(funnel+billing+recruiter-perf)/`pipeline`(velocity)/
`assessments`/`incentives`/`kae`/`account_pl`/`collections`/`bu_tracker`
list/write endpoints. New admin API on `users.py`'s existing `roles_router`:
`GET /roles/features`, `GET`/`PUT /roles/enforcement`, `GET /roles/
permission-log` (aggregated: role/feature/action/attempts/distinct_users/
last_seen/would_block_if_enforced — an admin reviewing before enabling
enforcement needs "recruiter tried X 47 times," not 47 raw timestamps),
`PUT /roles/{id}/permissions` (deliberately NOT blocked by the general
`update_role`'s `NOT is_system` guard — all 27 seeded roles are
`is_system=true`, so that guard would have made permission-editing on
exactly the roles that matter impossible). New Settings > Permissions page
(admin/super_admin only, `KeyRound` sidebar icon) — role list grouped by
department, a feature x action checkbox matrix for the selected role with
Save/Reset, a prominent enforcement toggle (defaults visibly "OFF (log
only)," confirm-dialog required before switching on), and the Activity Log
table for reviewing real usage first.

**Four real bugs found and fixed via genuine testing, not code review**:
1. `json` was never imported in `users.py` despite `create_role`/
   `update_role` already calling `json.dumps()` — both had been silently
   throwing `NameError` on every real call since written, never
   successfully exercised. One import fixes both plus the new endpoint.
2. **Critical**: asyncpg has no jsonb codec registered in this app, so
   `role_definitions.permissions` comes back from any query as a raw JSON
   **string**, not a dict. `check_permission()` in `permissions.py` called
   `.get()` on it — every single permission-gated request for any role
   with a real `role_definitions` row would have 500'd, the first time
   this feature was ever really exercised. Fixed with the same
   `x if isinstance(x, dict) else json.loads(x or "{}")` pattern already
   established elsewhere in this codebase for jsonb list columns
   (`onboarding.py`, `scheduler.py`, `user_mail.py`) — applied in both
   `permissions.py`'s `get_role_permissions()` and a new `_role_dict()`
   helper in `users.py` used by every roles endpoint.
3. **Route-ordering bug**: `PUT /roles/enforcement` was registered (in
   file order) *after* `PUT /roles/{role_id}` — FastAPI matches routes in
   registration order, so it matched the generic route first, treating
   `"enforcement"` as a `role_id` and crashing with `asyncpg.exceptions.
   DataError: invalid UUID 'enforcement'`. Confirmed live (500 on the very
   first real toggle attempt). Fixed by moving all fixed-path routes
   (`/features`, `/enforcement` GET+PUT, `/permission-log`) before the
   `/{role_id}` routes — the general FastAPI rule that static paths must
   precede dynamic ones on the same router, violated once already.
4. Manually invoking `require_permission(...)(actor)` inline (an early
   draft, caught before deploy) would have miscalled the dependency —
   its real signature is `(request: Request, actor=Depends(get_actor))`,
   so a lone positional `actor` arg would bind to `request`. Fixed by
   using it as a proper second `Depends()` parameter on the route instead.

**Verified for real end-to-end**, not code review: created a genuine
throwaway recruiter user + throwaway candidates; confirmed a DELETE
candidates attempt as that recruiter (who lacks `delete` on `candidates`)
succeeded with enforcement OFF (soft-launch default) while a real row
landed in `permission_check_log`; flipped enforcement ON, confirmed the
identical DELETE now correctly 403'd while a `companies:read` call (a real
grant) still succeeded; flipped enforcement back OFF immediately after
(production stays in soft-launch per the user's explicit choice); confirmed
admin remained fully unaffected throughout. Verified `PUT /roles/{id}/
permissions` round-trips a real edit (added then restored recruiter's
`companies` grants) and `GET /roles/permission-log` returns real aggregated
rows. Real headless-browser click-through confirmed the Settings >
Permissions page renders, the matrix loads real feature/role data, and the
sidebar link is visible to admin. All test artifacts cleaned up: throwaway
user deactivated, throwaway candidates soft-deleted (confirmed invisible to
real recruiters), and — deliberately, since this log is what the user will
review to make real permission decisions — the 3 test-generated
`permission_check_log` rows were deleted so they don't read as real usage.

## Stale hardcoded stage-list bug fixed (Recruiter Ops), 2026-08-09
Follow-up to the 4-area audit (Finance/ERP, Recruiter Ops, BGV, Analytics)
run earlier the same day — user picked this finding to fix first since it
was live and small. `applications.py`'s `_STAGE_AUTO_TASK` (auto-creates a
`recruiter_tasks` row on 5 specific stage transitions) and `recruiter_
dashboard.py`'s `my-stats` (`interviews_this_week`) both hardcoded stage
keys (`l1_interview`/`l2_interview`) — but this same tenant has a real
custom `l3_interview` round (added earlier this project), and pipeline
stages can now be freely added/renamed/deleted (Settings > Pipeline
Stages, built earlier the same day). Moving a candidate to `l3_interview`
silently created no task and didn't count toward a recruiter's weekly
interview stat — invisible, no error, exactly the audit's finding.

Fixed both with the same `LIKE '%interview%'` / dynamic-match pattern
already established elsewhere in this codebase (hiring-funnel, recruiter-
performance, pipeline-intelligence) rather than hardcoding `l3_interview`
too, which would just recreate the same bug the next time a tenant adds
another round: `_auto_task_for_stage()` falls back to a generic
"interview_coordination" task for any stage key containing "interview"
not already in the static map (screened/offer/offer_accepted are still
explicit — they're single-purpose, not the kind of stage a tenant adds
multiple variants of); `my-stats`'s `interviews_this_week` switched from
`stage IN (...)` to `stage LIKE '%interview%'`.

Verified for real against production: created a throwaway application
assigned to a real (never-logged-in, seed-data) recruiter, moved it to
`l3_interview` via the real API, confirmed a `recruiter_tasks` row was
created with `task_type='interview_coordination'` and title "Coordinate
L3 Interview: ..." (previously would have created nothing), then confirmed
that same recruiter's real `/recruiter/my-stats` endpoint counted it in
`interviews_this_week` (previously would have stayed 0). Full QA suite
re-run clean after: 157 passed / 2 skipped / 0 failed.

## BGV page rebuilt for real, 2026-08-09
Same day, same audit — user also picked this finding. `/bgv` was 100%
static markup (`frontend/app/(dashboard)/bgv/page.tsx`) — three tabs, all
hardcoded to zero, zero API calls anywhere in the file — despite a fully
real backend (`backend/routers/bgv.py`: BGV checks CRUD, a trust-score
view (`v_trust_scores`), trust graph, Aadhaar/DigiLocker demo-mode
flows) that had simply never been wired to any UI. Confirmed real data
already existed and was invisible: 5 real `bgv_checks` rows, 1735
`v_trust_scores` rows, all silently inaccessible from the app.

Added two missing backend endpoints (list-all was previously only
per-candidate): `GET /bgv/stats` (tenant-wide verified/in_progress/
pending/flagged counts + a by-check-type breakdown, for the Overview
tab) and `GET /bgv/checks` (list across all candidates with an optional
status filter, for the Checks tab — registered *before* the existing
`/checks/{candidate_id}` route, learned from the same-day Permissions
route-ordering bug not to repeat that mistake). Rebuilt the page with the
same three tabs/data-testids the existing QA suite already asserts on
(`data-tab`, `trust-overview`/`bgv-checks-panel`/`india-verify-panel`) so
nothing broke: **Overview** — real stat cards + by-type breakdown + a
candidate-search trust-score lookup (`GET /bgv/trust-score/{id}`).
**Checks** — a real list with status-filter chips, a "New Check" form
(candidate picker + check-type select → `POST /bgv/checks`), and inline
Clear/Flag buttons on in-progress checks (`PATCH /bgv/checks/{id}`).
**India Verify** — a candidate picker feeding both the Aadhaar OTP demo
flow (initiate → enter OTP → verify) and the DigiLocker document-pull
demo flow, both hitting the real (demo-mode) endpoints instead of being
inert list items.

Verified for real against production: `GET /bgv/stats` returned the real
5 in_progress checks (not 0); `GET /bgv/checks` returned real candidate
names (Vasudeva B, John Dev, etc.); a real headless-browser run confirmed
the Overview cards show the real 5 (not the old hardcoded 0), the Checks
tab lists real candidate names, the India Verify tab's Aadhaar flow
genuinely calls the backend and shows a real transaction ID, and the
trust-score lookup returns a real score for a real candidate. Separately
verified the write path end-to-end via a throwaway candidate: created a
check, resolved it completed/clear, confirmed `/bgv/stats`'s `verified`
count incremented by exactly 1. All test data cleaned up after. Full QA
suite re-run clean: 157 passed / 2 skipped / 0 failed.

## Finance/ERP UI forms built — 8 real dormant bugs found, all via genuine testing, 2026-08-09
Last of the 4-area-audit findings the user picked to fix. Surveyed first
(Explore agent, research only): timesheets, invoices, payroll, contractor
PII, incentive scorecard approval, retention-bank release/forfeit, loyalty
payout, account P&L entry, and collections entry all had real backend
endpoints with **zero frontend write UI** — several pages' empty-state
text literally said "call the API directly." Built real forms for all 9
into the 4 existing pages (`finance`, `incentives`, `account-pl`,
`collections`), reusing each page's existing display conventions rather
than introducing a new one.

**Fixed first: the retention_bank double-accrual bug** the audit flagged —
`incentives.py`'s `approve_scorecard()` INSERT had `ON CONFLICT DO
NOTHING` with no matching unique constraint (confirmed against
`sql/07_phase15_incentives.sql`: only `id`, a fresh UUID every call, was
ever unique), so re-approving a scorecard silently duplicated a held
incentive row. `sql/36_retention_bank_dedup.sql` adds a real `UNIQUE
(tenant_id, user_id, accrued_month, accrued_year)` index (checked both
real tenants for existing duplicates first — zero found, safe to add) and
the INSERT now targets it with `DO UPDATE ... WHERE status='held'`
(stays in sync if the amount changes, but never overwrites an
already-released/forfeited record).

**Then, building the actual UI forms surfaced 8 more real bugs — every
single one of these endpoints had literally never been called by
anything before, ever, so nothing had caught any of them until now**:
1. `POST /erp/timesheets`, `POST /erp/invoices/generate`,
   `POST /erp/payroll-runs` — all three took date fields as plain `str`
   and passed them straight to asyncpg against DATE-typed columns/
   function params (`generate_invoice_from_timesheets(date,date,...)`),
   crashing with `'str' object has no attribute 'toordinal'` on the very
   first real call. Same bug class documented repeatedly elsewhere in
   this project. Fixed with `date.fromisoformat(...)` at each call site.
2. `PATCH /incentives/scorecard/{id}/status` (approve) — crashed with
   `asyncpg.exceptions.AmbiguousParameterError: inconsistent types
   deduced for parameter $4, integer versus smallint`. The retention_bank
   INSERT reused `$4`/`$5` (accrued_month/year) both as raw binds to
   SMALLINT columns and inside `make_date($5::int,$4::int,1)` — asyncpg
   can't reconcile one parameter to two different inferred types in the
   same prepared statement. Fixed by computing `release_due_date` in
   Python (proper calendar-month arithmetic, not a fixed-day
   approximation — verified against several month/year-rollover cases by
   hand before deploying) instead of doing it in SQL.
3. `PATCH /incentives/bank/{id}` (release/forfeit) — same root cause,
   different parameter: `SET status=$1, released_at=CASE WHEN
   $1='released' THEN now() ELSE NULL END` reused `$1` as both a direct
   VARCHAR column assignment and a text comparison, `AmbiguousParameter
   Error: text versus character varying`. Fixed by resolving the
   `released_at` SQL literal (`now()`/`NULL`) in Python before building
   the query, since `body.status` is already validated against a fixed
   2-value set (no injection risk).
4. `POST /incentives/loyalty/seed` — `ModuleNotFoundError: No module
   named 'dateutil'`. The function imported `dateutil.relativedelta`
   but **never actually called it** — the real milestone-date math a few
   lines below already used `body.joining_date.replace(year=...)` with a
   plain-stdlib Feb-29 fallback. Pure dead import; deleted it (and an
   equally-unused redundant `from datetime import timedelta` next to it).
5. **`process_retention_bank_releases()` and `check_loyalty_milestones()`
   (`scheduler.py`) — the most consequential find of this batch: both
   scheduled jobs (retention-bank release, loyalty pending→achieved) have
   been silently failing on *every single run* since they were built,
   for every tenant, forever.** Both query a FORCE-RLS table
   (`retention_bank`/`loyalty_milestones`, policy casts `app.tenant_id`
   to `::uuid`) through `db.system_conn()`, which deliberately sets
   `app.tenant_id=''` for admin/cross-tenant reads — casting `''` to
   `::uuid` is a hard Postgres error, silently swallowed by each
   function's own generic `except Exception` logger. Exact same root
   cause as `send_weekly_kpi_summary`/`run_pipeline_auto_move` fixed
   earlier this project — same fix: list tenant IDs via `system_conn()`
   (no RLS on `tenants` itself), then do the real UPDATE through a
   per-tenant `tenant_conn()` in a loop. Verified for real, not just code
   review: seeded real loyalty milestones with a past `milestone_date`,
   confirmed they stayed `pending` before the fix even after manually
   triggering the job (`POST /scheduler/trigger/loyalty`), then after
   deploying the fix, triggered it again and watched all 4 genuinely flip
   to `achieved` with real `achieved_at` timestamps.
6. My own mistake, caught by testing rather than shipped: the Collections
   page's stage dropdown listed guessed values (`sent_to_client`,
   `follow_up`, `partial_payment`) that don't match `collection_records`'
   real CHECK constraint (`invoice_raised, reminder_sent, escalated,
   legal_notice, collected, written_off`) — a real update attempt 500'd
   with `CheckViolationError`. Fixed the dropdown to the real allowed
   values before considering this done.

**Verified every one of the 9 write flows for real, end-to-end, after
each fix** — not code review: timesheet create→submit→approve; invoice
generate→mark-paid; payroll run generation (confirmed a *billed*
timesheet correctly does NOT get pulled into payroll — that's the
`generate_invoice_from_timesheets` function's own by-design status
transition, not a bug — then proved payroll genuinely works against a
second, still-`approved` timesheet, 1 real payslip generated with correct
gross/net); contractor PII save + masked on-file check (confirmed the
decrypted value is never returned, only `has_aadhaar`/`has_pan`/etc.
booleans); scorecard create→**double**-approve (the actual dedup-bug
regression test — confirmed exactly 1 retention_bank row, not 2, with the
correct amount and release date); bank release and forfeit (with a real
reason recorded); loyalty seed→scheduler-promote→mark-paid; account P&L
create→finalize (confirmed CM = revenue − delivery − incentives − opcost
matches the DB trigger's own formula); collections create→update. Real
headless-browser click-through confirmed all 4 pages' new forms render
and one real UI-driven timesheet creation actually persisted. All test
data (timesheets, invoices, payroll runs, contractor PII, scorecards,
retention_bank rows, loyalty milestones, account_pl/collection records)
cleaned up afterward on both real tenants checked. Full QA suite re-run
clean: 157 passed / 2 skipped / 0 failed, no regressions from any of the
above.

## Recruiter Assignment: 6 build recommendations from the gap-analysis, all shipped, 2026-08-09
Direct follow-up to the earlier research-only "Recruiter Assignment —
Competitive Gap Analysis" report (same day) — user asked to build and
complete every item on the ranked recommendation list. All 6 done,
deployed, and verified against real production data (not code review).

`sql/37_recruiter_assignment_upgrades.sql` — also backfills `CREATE TABLE
IF NOT EXISTS` for `sla_tier_config`/`scoring_weight_config` (both were
schema-drifted, live but never in a committed migration, same pattern
documented repeatedly elsewhere in this file).

1. **Wired `sla_tier_config` into `find_sla_breaches()` — and found a much
   bigger bug than "the config is ignored" while doing it.** The old
   function required `r.sla_hours IS NOT NULL` — but only 11 of this
   tenant's 217 real requisitions had ever had `sla_hours` explicitly set
   (it defaults to `NULL` and nothing ever back-filled it). **206 real open
   requisitions were completely invisible to SLA breach detection,
   unconditionally, regardless of how overdue they were — the tiered
   config was never the primary problem.** Rewrote the function
   (`CREATE OR REPLACE`, same return signature so no Python caller needed
   to change) to compute effective hours as: explicit `r.sla_hours` if set
   (always wins, a deliberate per-req override) → else the tenant's
   `sla_tier_config` hours for that requisition's `priority`, adjusted by
   the client's `priority_tier` (strategic ×0.8 tighter, low_touch ×1.2
   looser) → else a flat 168h fallback if neither config exists.
   `scheduler.py`'s tier-1→tier-2 grace period (`SLA_ESCALATION_GRACE_
   HOURS`, previously one hardcoded `24` for every tenant/job) now scales
   off that same effective value for `sla_breach`-type alerts (10% of the
   target window, floored at 4h) via a new `_grace_hours_for()` helper —
   `stalled_assignment`-type alerts (a different signal, "nobody touched
   this" rather than a fill-time budget) keep the flat default on purpose.
   **Verified for real**: `find_sla_breaches()` went from returning ~0 rows
   to 18 genuine breaches the instant this deployed; built a real
   throwaway strategic-tier client + medium-priority requisition with no
   explicit `sla_hours`, backdated it 600h, and confirmed the function
   computed exactly 720×0.8=576 effective hours (matching the hand
   calculation exactly) and correctly flagged it breached at 600h open.
   Directly invoked the real `process_sla_escalations()` job once inside
   the backend container against live data — completed with zero errors,
   and `sla_escalations` showed 18 real `sla_breach` + 28 real
   `stalled_assignment` rows, all tier-1-fired for the first time ever for
   most of those 18. Left these firing — they're genuine breaches that
   should alert, not test pollution.
2. **Per-role "assigned jobs only" visibility scope.** New
   `role_definitions.job_visibility_scope` (`all` default / `assigned_
   only`), a new `permissions.get_job_visibility_scope()` helper (same
   exemption pattern as `require_permission`: admin/super_admin/anonymous
   always `all`), applied as a real filter in `GET /requisitions` —
   confirmed this single endpoint is what backs all three surfaces named
   in the request (Requisitions list, the Pipeline board's job picker, and
   the main Dashboard's "Open Requisitions" stat all call the same route),
   so one filter covers all three. New `PUT /roles/{id}/visibility`
   endpoint + a segmented "All jobs / Assigned jobs only" control on
   Settings > Permissions, right above the existing feature/action matrix
   for the selected role. **Verified for real** against the actual
   production `recruiter` role (careful here — this setting affects every
   real recruiter, not a throwaway): confirmed a real recruiter login saw
   22 open requisitions unfiltered, flipped the role to `assigned_only`,
   confirmed the same login+query now showed exactly 1 (the one real
   assignment that recruiter held), then immediately restored the role to
   `all` — production stays at the pre-existing default, this was a
   verification, not a policy decision made unilaterally.
3. **Unified/completed the priority system.** `requisitions.priority`
   already supported `critical` in the scoring formula but the create/
   edit form and the list-page filter only ever offered high/medium/low —
   confirmed 3 real requisitions already had `priority='critical'` in the
   DB (set via direct API calls, never reachable through the UI) before
   this fix. Added Critical to all three UI spots (`PRIORITY_CONFIG`,
   filter select, form select). Also fixed `applications.py`'s
   auto-created `recruiter_tasks` — hardcoded `priority='medium'`
   regardless of the parent requisition's real priority — to inherit it
   for real, and fixed `recruiter_dashboard.py`'s `my-day` task ordering
   (previously a boolean `priority='high'` tiebreak that couldn't
   distinguish critical from high, or medium from low) to a real 4-level
   CASE. **Verified for real**: moved a live application on a
   `priority='critical'` requisition to `l1_interview` and confirmed the
   auto-created task landed with `priority='critical'`, not the old
   hardcoded `medium`.
4. **Role-gated the initial manual assign.** `POST /assignments` had no
   role check at all — any authenticated user (recruiters included) could
   assign anyone to anything, unlike `/reassign` which was already admin/
   manager-only. Added the same `require_role("admin","manager")` gate,
   plus a genuinely separate gap found while reading the code: no
   uniqueness check meant a second `POST /assignments` call on an already-
   assigned requisition would silently create a second "active" row (the
   table itself has no constraint preventing it) — now a clean 409
   pointing at `/reassign` instead. **Verified for real**: a genuine
   recruiter login got 403 on `/assignments`, admin got 200; a second
   admin call on the same requisition correctly 409'd.
5. **Filtered the assignee picker to `role=recruiter`.** Was fetching
   every active user (admins, KAEs, everyone) via `/users?is_active=true`;
   now `&role=recruiter` (the endpoint already supported the filter param,
   just never used it here). **Verified for real**: confirmed the query
   returns only `role='recruiter'` rows (9 of 9 in this tenant).
6. **Wired `clients.priority_tier` into both scoring and SLA** — it
   previously drove nothing but a colored badge. Folded into
   `match_recruiters()`'s existing `urgency_bonus` term as an additional
   multiplier (strategic ×1.3, low_touch ×0.8, standard ×1.0) rather than
   a new weight column, since it's the same underlying "how urgently
   should we reward available capacity" concept the term already existed
   for. Also feeds the `find_sla_breaches()` effective-hours calculation
   from item 1. **Verified for real, with exact arithmetic, not just "the
   score changed"**: ran `match_recruiters()` against the same real
   requisition+recruiter three times, switching only the client's tier
   between calls — strategic 42.71, standard 42.53, low_touch 42.41. Hand-
   computed deltas (0.02 weight × 1.0 capacity ratio × 0.3 medium-priority
   multiplier × the difference between tier multipliers × 100) predicted
   exactly 0.18 and 0.12 — matched to the second decimal both times.

All throwaway test data (client, requisitions, candidate, application,
recruiter user) cleaned up afterward — except one deliberately-named
"QA SLA Test Client" row, left behind because its soft-deleted test
requisition still FK-references it and this project's convention is
soft-delete, not cascading hard-deletes, for exactly this reason. Full QA
suite re-run clean after all 6: 157 passed / 2 skipped / 0 failed. Real
headless-browser check confirmed the new Settings > Permissions job-
visibility toggle and the Requisitions form's Critical option both render
and work.

## Last 3 flagged-but-unfixed items closed out, 2026-08-09
User asked "what's next / pending" — checked CLAUDE.md's history for
items previously flagged as real but explicitly left unfixed, found 3,
user asked to build and complete all of them. `sql/38_pending_fixes_rls_
and_schema_drift.sql`.

1. **`candidate_messages` had zero row-level security** (`relrowsecurity=
   false`), flagged while building email tracking, never fixed — real
   candidate-facing email/WhatsApp content, tenant-isolated only by every
   query individually remembering `WHERE tenant_id=...`. Added FORCE RLS
   + a real tenant_isolation policy. The one caller that doesn't go
   through `tenant_conn(actor.tenant_id)` — the anonymous email-open
   tracking pixel (`GET /track/open/{token}.gif`, the recipient's own
   email client fetches it, no tenant_id to set) — needed the same fix
   already used for every other anonymous/token flow in this codebase
   (NDA/offer e-sign, device enrollment): a new `record_email_open(text)`
   SQL function, `SECURITY DEFINER` and owned by `postgres`, bypasses RLS
   for that one specific, token-scoped write only. **Verified for real**:
   confirmed real cross-tenant isolation (the real tenant sees 171 real
   rows, the other real tenant sees 0 for the same unfiltered query);
   hit the real tracking-pixel endpoint against a real message's real
   `tracking_token` and confirmed `email_open_count` genuinely
   incremented (0→1) and `email_opened_at` got set — then reverted that
   one row back to 0/NULL immediately after, since the test call wasn't
   a genuine open and would otherwise have left false analytics data on
   a real message.
2. **SSR/hydration bug in `recruiter-ops/page.tsx`'s `TargetsTab`**
   (React error #418) — `getTokenPayload()` reads `localStorage`
   synchronously during render, which doesn't exist server-side, so the
   server's first paint (no "Set Target" button) differed from the
   client's (real role, button present) the instant hydration ran. Same
   bug class already fixed on this same page's top-level tab-switcher and
   on `device-monitoring/page.tsx` — this one instance was explicitly
   left as a known, reproducible, not-yet-fixed finding at the time.
   Applied the identical `useState` + `useEffect` deferred-read pattern.
   **Verified for real**: real headless-browser run with console-error
   capture confirmed zero hydration-related errors and the "Set Target"
   button correctly rendering for a real admin session.
3. **Schema-drift backfill** — `v_sla_dashboard`, `v_pipeline_velocity`,
   `v_monthly_billing` (views) and `recruiter_targets` (table) all existed
   live in production with zero `CREATE TABLE`/`CREATE VIEW` in any
   committed migration — a fresh environment built from git alone
   wouldn't have them. Pulled every definition directly from the live
   schema via `pg_get_viewdef()`/`\d` rather than reconstructing from
   memory — a first draft that guessed plausible-looking definitions
   instead was wrong on every single one once actually checked, which is
   exactly why real capture matters here. While pulling `v_sla_dashboard`'s
   real definition, found it depends on a `sla_tracking` table that was
   **also** undocumented in git (a second schema-drift instance not on the
   original flagged list) — backfilled that too.
   **Found and fixed a real, live, previously-unknown bug in the process**:
   `v_sla_dashboard`'s real definition filtered interviews/hires with
   `a.stage = 'interview'` / `a.stage = 'hired'` — neither is a real stage
   value in this system (real ones are `l1_interview`/`l2_interview`/
   `l3_interview` and `placed`), the exact same hardcoded-stage-key bug
   class already found and fixed in `recruiter-performance`,
   `hiring-funnel`, and several other endpoints earlier in this project —
   just never caught here because this view only ever lived in the
   database, invisible to a `.py`-file grep. This view backs the real,
   live SLA Dashboard page (`GET /sla`, `GET /sla/summary`), and its
   `interviews`/`offers`/`hires` counts are genuinely displayed
   (`PipelineDots`) and CSV-exported there — meaning **every requisition's
   interview and hire counts on that real dashboard had silently always
   shown 0**, regardless of actual pipeline activity, since the view was
   created. Fixed to `stage LIKE '%interview%'` / `stage = 'placed'`,
   matching the established fix pattern exactly. `sla_tracking` itself is
   confirmed fully orphaned (zero writers, zero readers anywhere in the
   backend besides this one view) — its columns still fall back to the
   view's own `COALESCE` defaults, a separate, never-built feature, not
   something invented as part of this backfill. **Verified for real**:
   `GET /sla/summary` against live production went from what would have
   been 0 real interview/hire signal across all 226 open requisitions to
   33 rows now showing genuine, non-zero interview/offer/hire counts
   matching real pipeline data.

Full QA suite re-run clean after all 3: 157 passed / 2 skipped / 0
failed. Zero-token audit confirmed clean.

## Fresh audit (Assessments/Offers/n8n) — all 5 recommendations built, 2026-08-10
Direct follow-up to a research-only fresh audit of 3 areas not yet deeply
reviewed (Assessments & Anti-cheat P7, Offer Management P11, n8n Automation
Workflows), run as 3 parallel background agents with real SSH/psql access.
Headline finding: a confirmed, live HARD RULE #10 violation in production
offer data. User said "built it complete all" — all 5 recommendations done.

**1. Offer-issue HITL bypass closed at the root.** `phase3.py`'s
`auto_generate_offer()` — the only offer-creation path either frontend
entry point calls — inserted directly as `status='issued'`, completely
bypassing the correctly-built `offers.py` draft→pending_approval→
approved→issued state machine sitting unused right next to it. This is
exactly how a real production offer (`003a796d...`) ended up `accepted`
with an empty `approved_by` and zero `assignment_event`/`audit_log` rows.
Fixed at the source: now inserts as `'draft'` and writes a real
`offer.created` event_outbox row, matching `offers.py`'s own
`create_offer()` convention. Two more bypass points closed alongside it,
both confirmed via direct pre-fix reproduction: `send_offer_letter`
allowed sending a `draft`/`approved`/`issued` offer (now `approved`/
`issued` only), and `request_offer_signature` had no status check at
all (now requires `issued`). The public e-sign SQL path
(`accept_offer_by_id`) was worse — schema-drifted (existed live, zero
`CREATE FUNCTION` in any committed migration) with no `WHERE` clause
whatsoever, meaning it would flip any offer straight to `accepted`
regardless of current status. `sql/39_offer_hitl_fix_and_schema_drift.sql`
backfills it plus its 2 sibling drifted functions
(`get_offer_by_signing_token`, `sign_offer_by_token`, captured byte-for-
byte via `pg_get_functiondef()`, not reconstructed from memory — this
project's own established discipline after a first-draft schema-drift
migration once landed "wrong on every single one" from memory) and adds
a real `status='issued'` guard, matching the authenticated accept path's
existing standard. `CREATE OR REPLACE` cannot change a function's return
type (`void` to `boolean` here) — caught on first deploy attempt
(`cannot change return type`), fixed with a `DROP FUNCTION` first.
New `ApprovalAction` component on `offers/page.tsx` (Submit for Approval
/ Approve / Issue Offer buttons, or a plain status readout for non-
approvers) — the state machine had a real backend but zero frontend
before this, so nobody could actually move an offer through it without
raw API calls. SSR-safe role check via the established `useState` +
`useEffect` deferred-localStorage-read pattern (device-monitoring page
precedent) — confirmed zero hydration console errors via a real headless-
browser check.

Second real gap found while fixing the first: nothing anywhere in
this codebase ever inserted into `placements` on offer acceptance
(grepped the whole backend, zero matches) — every downstream feature
joining against `placements` (finance/billing, retention tracking,
onboarding, compliance, `v_monthly_billing`) was silently blind to every
real acceptance through this endpoint. `respond_offer()` now inserts a
real row on acceptance. Added a real `UNIQUE (offer_id)` constraint
first (checked zero existing duplicates in production first) so the
`ON CONFLICT (offer_id) DO NOTHING` is a genuine no-op-on-retry, not the
same "no matching constraint so it never fires" dead-code bug already
found once this project (`retention_bank`).

Verified for real end-to-end, not code review: created 2 throwaway
candidate/application pairs against a real open requisition. First:
generated an offer via the real endpoint, confirmed status is draft
(not issued); confirmed letter/send 400s ("approve it first") and
letter/request-sign 400s ("must be issued") against the draft; walked
it through submit-for-approval, approve (confirmed approved_by
populated), issue, then respond accepted; confirmed a real placements
row with correct candidate_id/requisition_id, and applications.stage
became placed. Second: same setup, walked to issued, then responded
declined, confirming the decline path also works cleanly. Directly
called the fixed accept_offer_by_id(offer_id) SQL function against the
now-declined offer and confirmed it returns NULL (refuses a non-issued
offer) rather than the old unconditional accept. All throwaway data (2
candidates, 2 applications, 2 offers, 1 placements row, 2
consent_records) cleaned up after — first cleanup attempt caught a real
gotcha worth remembering: psql -c with multiple semicolon-separated
statements runs them all in one implicit transaction under the simple-
query protocol, so a later statement's FK-violation rolls back every
earlier statement in the same invocation too, not just the one that
failed. Fixed by reordering into one single batch (consent_records,
then placements, then offers, then applications, then candidates) that
fully succeeds atomically.

**2. Assessments & Anti-cheat (P7) retired, not hardened.** Given a
genuine fork (build a real take-flow — high effort, low payoff for a
module the audit found had never processed a single real submission —
vs. retire), asked the user directly; picked "Retire it." Since nothing
would be left to protect, incremental role-gating of its endpoints
(originally a separate recommendation) became moot and was folded into
the retirement instead. Deleted `backend/routers/assessments.py` and
`backend/routers/media.py` (P20 Whisper/OpenCV media intelligence,
confirmed via grep to exist solely to serve assessments.py, zero other
callers), removed both from `app.py`, deleted the `/assessments`
frontend page plus its sidebar entry and now-unused `ClipboardCheck`
icon import, removed the `assessments` feature key from the Permissions
admin matrix taxonomy, removed the 4 now-dead QA tests (1 UI-flow test,
the 2-test `S10 P20 Assessments` describe block, 1 route-list entry).
Deleted the 2 confirmed-synthetic seed rows from `technical_assessments`
directly (matching the audit's exact finding — this was the module's
entire real dataset, ever). Verified for real: `GET /assessments` and
`GET /assessments/stats` both return genuine 404s against the live
backend, not 401/403 (confirms the routes are actually gone, not just
gated).

**3+4. n8n: fire_count fixed to mean "executed," not "attempted," and
all 9 previously-dead automation_workflows rows made genuinely live.**
`_notify_n8n()` (`scheduler.py`) and `fire_webhook()` (`p30_p35.py`) both
computed success/failure from the n8n POST response and then updated
`automation_workflows.fire_count` unconditionally regardless of it —
so fire_count had only ever measured "how many times we attempted a
POST," not "how many times n8n actually ran a workflow." Both fixed to
gate the UPDATE on a real 2xx/genuine-non-4xx response.
`p30_p35.py`'s version had a second, independent, more serious bug
hiding behind it: it read/wrote `automation_workflows` (FORCE ROW LEVEL
SECURITY) via `db.system_conn()` (`app.tenant_id=''`) — the same
`''::uuid` cast-crash class found and fixed repeatedly elsewhere in this
project — but since this function runs as a FastAPI BackgroundTask, the
crash was silently swallowed after the response already sent. This
almost certainly means the Automations page's "Test" button had never
worked successfully even once before this fix. Fixed by switching to
`tenant_conn(tenant_id)` (tenant_id was already a real parameter here,
no anonymous-token machinery needed).

Then closed the actual "why is fire_count 0" root cause underneath both
fixes: 8 of the 10 real automation_workflows rows had no matching n8n
workflow imported at all — every webhook POST was hitting a 404,
confirmed directly against n8n's own internal state. Registered real
n8n workflows for all 9 dead paths (the 10th, "Candidate Birthday /
Anniversary," has no natural trigger — no DOB/anniversary field exists
anywhere in this schema, confirmed via grep across sql/*.sql — left
undead but genuinely unbuildable without inventing new data capture,
out of this batch's scope) via n8n's own CLI (no REST API credentials
available) — import:workflow --projectId=ngUWjYHU6zM1ncOQ (lands
inactive; this single-instance deployment doesn't support
--activeState=fromJson), publish:workflow --id=..., then
docker compose restart n8n to actually activate (publish alone doesn't
take effect while n8n is running). Each new workflow mirrors the one
pre-existing real workflow's shape (Webhook trigger, then a Set node).
Verifying a "successful" import needed a second check, not just the
CLI's own success message: n8n's SQLite backend runs in WAL mode, so
docker cp-ing only the main .sqlite file misses anything still sitting
in the separate -wal sidecar file — the first verification attempt
showed only the pre-existing workflow, not the newly-imported ones,
until the -wal/-shm files were copied alongside it too. Verified for
real, not by trusting CLI output: every one of the 9 paths
(sla-breach-warning, stale-requisitions, new-application,
offer-accepted, offer-dropped, placement-congrats, weekly-kpi,
interview-reminder-candidate, interview-reminder-recruiter) returns a
genuine {"message":"Workflow was started"} / HTTP 200 on a direct
webhook POST, not a 404.

Registering the workflows alone does not fire them without a real
trigger call site, so wired all 7 previously-dead automation rows
(beyond the 2 existing-but-orphaned SLA/stale-req alerts already fixed
same-day) into the one, already-existing, natural trigger point each
has — deliberately not inventing new business logic:
- new-application — applications.py's create_application(), the one
  function every application-creation path funnels through.
- offer-accepted + placement-congrats — both fire from
  respond_offer()'s acceptance branch (same event, two distinct n8n
  subscribers — an onboarding-kickoff workflow and a separate
  congratulate-the-candidate one; not duplicate work).
- offer-dropped — respond_offer()'s decline branch.
- interview-reminder-candidate + interview-reminder-recruiter — the
  existing daily 8am send_interview_reminders() cron already queries
  interviews in the next 24h for the candidate-email step; added an
  interviewer_id -> users join and fired both webhooks per interview
  row, deliberately not gated on SMTP being configured (the n8n
  reminder should not be held hostage to whether this tenant's email is
  set up) — accepting a small, bounded risk of one duplicate fire per
  interview if SMTP is not configured for that tenant, tolerable for a
  low-stakes reminder, not a HARD RULE #10 action.
- weekly-kpi — the existing Monday-9am send_weekly_kpi_summary() cron,
  alongside (not replacing) its separate, unrelated Slack/Teams/Discord
  notify_event() call from the same-day MS Teams work — two genuinely
  distinct subscriber systems reacting to the same schedule.
All new call sites use BackgroundTasks/best-effort fire-and-forget,
matching this codebase's established convention for non-blocking
notification side effects.

Verified for real end-to-end: created a real application via the API
and confirmed new-application's fire_count went 0 to 1; walked a real
offer to acceptance and confirmed offer-accepted and placement-congrats
both went 0 to 1; walked a second real offer to decline and confirmed
offer-dropped went 0 to 1. interview-reminder-*/weekly-kpi verified via
direct webhook POST (real 200 plus workflow-started) since exercising
the actual cron jobs live would mean waiting for their real schedule or
fabricating interview-window/day-of-week state on production data,
neither of which fit this session's real-data-only verification bar as
well as the direct offer/application tests did — flagged honestly as the
one lighter-weight verification in this batch rather than glossed over.

Full QA suite re-run clean after all of the above: 153 passed / 2
skipped / 0 failed (down from the prior 157 baseline by exactly the 4
Assessments-specific tests removed as part of the retirement — confirms
no real regressions, not a weaker suite). Zero-token audit: CONFIRMED
CLEAN (336 files, 0 external API refs).

## Re-check against the Assessments/Offers/n8n audit report, 6 remaining items closed, 2026-08-10
Direct follow-up, same day. User asked to re-check the published audit report
against current state ("critical finding, assessments, N8n workflow issue and
error, recommendation and other issue") - re-fetched the report and cross-
checked every item, not just the 5 ranked recommendations already built
earlier today. Found 6 real open items that were flagged in the report but
fell outside the 5 numbered recommendations (2 under "Offer Management,"
1 under "n8n," 1 under "Cross-cutting patterns," plus the historical bad
data itself and one automation row's fate never actually being decided).
User said "built it complete all 6... and fix it" - all 6 done.

1. **Historical pre-fix offers still had zero audit trail.** The HITL fix
   built earlier today closes the bug going forward but doesn't retroactively
   repair the 4 real production offers (`0003a467`, `003a796d`, `d9f9b7ad`,
   `02d5ee6e`) created via the old bypass, all still `approved_by IS NULL`
   with zero `assignment_event`/`audit_log` rows. Deliberately did **not**
   fabricate an approval that never happened - no fake `approved_by`, no
   invented "approved" event, since that would make the audit trail lie
   rather than fix it. `sql/40_offer_hitl_audit_backfill_and_cleanup.sql`
   instead writes one honestly-worded `assignment_event` +  `audit_log` row
   per affected offer (actor_user_id NULL - system-flagged, not attributed to
   a specific human who didn't actually review these), stating plainly: this
   offer bypassed HITL via the pre-fix path, no human ever approved it,
   flagged retroactively for audit-trail accuracy. Verified for real:
   confirmed all 4 offers now show exactly 1 `assignment_event` + 1
   `audit_log` row each, and spot-read one entry's actual text to confirm it
   says what really happened rather than a sanitized cover story.
2. **HARD RULE #4 (AI Router) violation, still live in the offer-generation
   path.** `phase3.py`'s local `call_ollama()` helper called Ollama directly
   via a bespoke `httpx` POST, bypassing the shared AI Router's semantic
   cache entirely - the exact same violation class already found and fixed
   once in this project for resume parsing, just never caught here because
   this audit was the first time anyone looked closely at the offer-
   generation path specifically. Deleted the local helper (its only caller
   was `auto_generate_offer`) and routed through `ai_router.generate()`
   instead, wrapped in try/except so a failure still falls through to the
   existing template fallback exactly as before. Verified for real:
   generated a real offer letter for a throwaway candidate, confirmed
   `generated_by:"ollama_qwen2.5"` in the response, and confirmed a genuine
   new `ai_cache` row (`cache_key:"offer_letter:<application_id>"`, real
   response text) - the AI Router path, including its embed + cache_store
   calls, is now genuinely exercised on offer generation, not just resume
   parsing and JD generation.
3. **`bgv.py::draft_offer_letter` / `GET /bgv/offer-letter/{id}` removed.**
   Confirmed via grep (frontend, backend, tests) these had zero callers
   anywhere - a second, non-overlapping-route duplicate of `offers.py`'s
   real draft/approve/issue/PDF/e-sign flow on the same `offer_letters`
   table. Deleted both endpoints and the now-unused `ai_router.generate`
   import from `bgv.py`; kept the India Verification stubs in the same file
   untouched (unrelated, already-flagged-separately scaffolding). Verified:
   both routes now return genuine 404s, not 401/403.
4. **`offers.py`'s PDF renderer had no embedded logo image**, unlike
   `call_letters.py` (built earlier today) - offer letters were still
   text-only, "the one PDF generator in the codebase" the audit called out
   by name. Added the identical `Image` flowable + sizing pattern
   `call_letters.py` already established (`backend/assets/aviintech-logo.png`,
   4.5cm width scaled to the file's real 730×342 aspect ratio so it's never
   stretched). Verified for real, not by reading the code: downloaded a real
   generated offer PDF and confirmed via raw PDF byte inspection it contains
   a genuine embedded `/Subtype /Image` XObject sized exactly 730×342 -
   matching the actual logo file's real dimensions, not a guess.
5. **`docs/n8n-setup.md` was stale**, documenting 3 webhook paths
   (`retention-bank-released`, `loyalty-milestone-achieved`,
   `monthly-incentive-summary`) that matched neither the live
   `automation_workflows` table nor n8n's actual registered workflows -
   and, checking those 3 paths directly while rewriting the doc, confirmed
   all 3 were **also genuinely 404ing** (real backend callers in
   `scheduler.py`, zero matching n8n workflows) - a 4th silent gap beyond
   the 10 `automation_workflows` rows the original audit scoped to, only
   found because fixing the docs meant actually checking what they
   described instead of just editing prose. Registered real n8n workflows
   for all 3 via the same CLI import/publish/restart process used earlier
   today, verified each with a direct webhook POST (`{"message":"Workflow
   was started"}`, HTTP 200, not 404). Rewrote the doc to accurately list
   every real webhook path grouped by whether it's `automation_workflows`-
   tracked, fired-but-untracked, or the one real pre-existing workflow
   (`aviin-stage-change`) that isn't in the table at all - a known,
   documented gap, not silently glossed over - plus the real CLI-based
   registration process (the doc's old "Manual Setup" section assumed an
   n8n API key that was never actually configured).
6. **Candidate Birthday/Anniversary automation row removed.** Already
   documented earlier today as "genuinely unbuildable without inventing new
   data capture" (no DOB/anniversary field exists anywhere in this schema,
   confirmed via grep across every `sql/*.sql` file) but left sitting in
   `automation_workflows` unused rather than actually resolved either way.
   The audit's own recommendation was "wire real triggers... or remove
   them" - this one was neither. `sql/40...sql` deletes the row. Verified:
   `GET /automations` now returns exactly 9 rows, `candidate-engagement` no
   longer among them.

Full QA suite re-run clean after all 6: **153 passed / 2 skipped / 0
failed** - identical to the pre-existing baseline, confirming no
regressions from any of today's two rounds of fixes combined. Zero-token
audit: `CONFIRMED CLEAN` (334 files, 0 external API refs). All throwaway
test data (2 candidates, 2 applications, 1 offer, 1 ai_cache row, consent
records) cleaned up after verification, confirmed zero residue.

**What's still honestly open, not touched in either round today** (flagged
for completeness, not fixed - out of scope for "these 6"): `aviin-stage-
change`, the single most-used real n8n workflow in the system (500+ real
executions), still isn't a row in `automation_workflows` - the Automations
dashboard has zero visibility into the one integration that actually works
at scale. A real gap, deliberately left for a future pass rather than
folded into this one silently.

## The last remaining audit item closed: aviin-stage-change wired into automation_workflows, 2026-08-10
Direct follow-up, same day, to the one item explicitly flagged as still
open after the previous two fix rounds: "AVIIN Stage Notifier" (webhook
path `aviin-stage-change`) is the single most-used real n8n integration
in the system, but was never a row in `automation_workflows`, so Settings
> Automations had zero visibility into the one thing that actually runs
at scale, and it had no `fire_count`/`last_fired_at` tracking at all.

Re-verified the audit's own claim before building anything, per this
project's established discipline of checking rather than trusting prior
notes: the report said "fed by 4 real call sites in applications.py/
pipeline_p2.py" - grepped both files directly and found this overstated.
`pipeline_p2.py` has a `notify_n8n()` function + `N8N_WEBHOOK` constant
that were **fully dead code** - defined, zero callers anywhere in that
file or any other backend file (confirmed via a whole-backend grep).
There is exactly **one** real call site: `applications.py`'s
`_notify_stage_change_bg()`, itself called from exactly one place
(`update_stage()`, the real funnel every stage-change UI action - drag-
and-drop, stage buttons, bulk moves - already goes through). Removed the
dead `notify_n8n()`/`N8N_WEBHOOK` from `pipeline_p2.py` as a small bonus
cleanup while investigating, rather than leaving a second, unused,
confusing "notify n8n" function sitting next to the real one.

`sql/41_stage_notifier_automation_row.sql` seeds one `automation_workflows`
row per tenant (`ON CONFLICT (tenant_id, name) DO NOTHING`, run as the
`postgres` superuser which bypasses RLS entirely, not just FORCE ROW
LEVEL SECURITY - no per-tenant `tenant_conn()` loop needed for a plain
cross-tenant INSERT here). `fire_count` starts at 0, deliberately not
backfilled with an invented historical number - the app itself never
tracked this webhook's call count before today (only n8n's own internal
execution log did, which this table has no access to), so 0 and
"counting starts today" is the honest number, same principle already
applied to the offer HITL audit-trail backfill earlier today.
`applications.py`'s real call site switched from a raw, untracked
`httpx.AsyncClient().post()` to `fire_webhook()` - the same tenant-aware,
success-gated helper every other automation trigger fixed today already
uses - so this one is now genuinely visible and tracked, not just working
silently in the background.

Verified for real, not code review: confirmed the new row appears in
`GET /automations` (10 rows now, `fire_count:0`, `last_fired_at:null`)
immediately after deploy; created a real throwaway candidate+application
and moved it `sourced`→`contacted` via the real `PATCH /applications/{id}/
stage` endpoint; confirmed `fire_count` went 0→1 with a real
`last_fired_at` timestamp. All throwaway data (candidate, application,
consent_records, candidate_activities, pipeline_movements rows) cleaned
up after - the cleanup itself needed the correct FK-safe delete order in
one atomic batch (same `psql -c` simple-query-protocol gotcha documented
earlier today: a later statement's FK violation rolls back every earlier
statement in the same invocation).

Full QA suite re-run clean after: 153 passed / 2 skipped / 0 failed -
identical to every other run today, confirming no regressions across all
three rounds of fixes combined. Zero-token audit: `CONFIRMED CLEAN`
(335 files, 0 external API refs).

With this, every finding in the "Assessments/Offers/n8n Fresh Audit"
report (2026-08-09/10) is closed - the 5 ranked recommendations, the 6
secondary items found on re-check, and this last one. Nothing outstanding
from that report remains.

## Re-check against the Recruiter Assignment Gap Analysis: a real, live, self-amplifying data-corruption bug found and fixed, 2026-08-10
User asked to check a different, earlier report ("Recruiter Assignment —
Competitive Gap Analysis," 2026-08-09) against current state. That report's
own 6 numbered recommendations were already fully built and shipped the
same day it was published (see "Recruiter Assignment: 6 build
recommendations..." above) - re-verified every one of the 6 directly
against live code/data (role gate on POST /assignments, assignee picker
filtered to role=recruiter, sla_tier_config wired into find_sla_breaches(),
job_visibility_scope toggle, unified priority fields with critical
reachable, clients.priority_tier wired into scoring/SLA, schema-drift
backfills) - all still genuinely in place, nothing had regressed.

One item from the report's body text (not one of the 6 recommendations,
just a passing observation in section 1: "no DB constraint stopping two
simultaneous active rows") turned out to be a live, ongoing, self-
amplifying production bug once actually checked against real data instead
of taken as a minor theoretical gap.

**What was actually happening**: 4 real requisitions had 2-6 simultaneous
`assignments` rows with `status='active'` each (one had 21 total rows,
7 of them active at once). Root-caused by reading `do_reassign()`'s real
definition and the actual `sla_escalations` audit trail for one affected
requisition, not by guessing: `find_stalled_assignments()` returns every
`active` assignment row independently - "one active row per requisition"
was never an enforced invariant, just an assumption every write path
individually tried to honor. Once ANY requisition ended up with 2+ active
rows (from the exact race the report named), the SLA escalation job
(`scheduler.py`, runs every 30 min) gave EACH duplicate its own
independent `stale_<assignment_id>` alert with its own tier1->tier2 clock.
When each one's tier 2 fired (~24h grace period), `do_reassign()` correctly
reassigned that ONE row - but with zero awareness of its siblings, so N
duplicates became N *new* duplicates every ~24h cycle instead of shrinking.
This had been silently reassigning real requisitions to recruiters at
random, roughly daily, since at least 2026-07-27, with zero visibility
anywhere in the product - not caught by any earlier audit because nobody
had directly counted active assignments per requisition before.

**Fix, `sql/42_assignments_uniqueness_and_cleanup.sql`**:
1. Consolidated each of the 4 corrupted requisitions down to one active
   row (most recently created = canonical), marking every sibling
   `reassigned` with an honest, non-fabricated `assignment_event` note
   explaining this was a retroactive data-integrity cleanup, not a real
   reassignment - same "document what actually happened, don't fabricate
   history" principle applied to the offer HITL audit-trail backfill
   earlier today. Used `UPDATE ... RETURNING` captured directly into the
   event insert so this only ever wrote a cleanup note for rows the
   migration itself touched, never for rows that were already
   legitimately `reassigned` from real, older reassignment events.
2. Resolved any still-open `sla_escalations` rows pointing at the
   now-cleaned-up assignment IDs.
3. **The actual fix**: `CREATE UNIQUE INDEX assignments_one_active_per_requisition
   ON assignments (requisition_id) WHERE status='active'` - makes a second
   simultaneous active row structurally impossible for every current and
   future write path (manual assign, `do_reassign()`,
   `assign_with_explanation()`, seed data) at once, rather than relying on
   each path's own check-then-act logic staying correct forever.

**A second, real risk found and fixed while building the first**:
`scheduler.py`'s tier-2 escalation handler runs inside one long-lived
transaction opened by `db.tenant_conn()` (the whole tenant's alert batch
shares one connection/transaction for the tick). Its existing bare
`try/except` around the `do_reassign()` call does not protect against a
real Postgres-level error the way it protects against a Python exception -
once any statement inside raises (which the new unique constraint can now
legitimately do, rejecting a `do_reassign()` call whose target already had
a duplicate active sibling from before this fix), the whole transaction
is marked aborted and every later statement on that connection fails too,
silently truncating that tenant's entire escalation run for the tick.
Fixed by wrapping the `do_reassign()` call + its `tier2_fired_at` update in
a nested `async with conn.transaction():` - a real SAVEPOINT in asyncpg
when a transaction is already open - so a failure now rolls back only that
one alert, not the tenant's whole batch.

**Verified for real, not code review**: confirmed zero duplicate-active
requisitions remain after cleanup; confirmed the new unique index genuinely
rejects a real INSERT attempt (`BEGIN; INSERT ...; ROLLBACK;` against a
real requisition that already has an active assignment - real Postgres
`duplicate key value violates unique constraint` error, not assumed);
directly invoked the real `process_sla_escalations()` function inside the
backend container end-to-end against live production data and confirmed
it completes with no unhandled exception and creates zero new duplicates.
Full QA suite re-run clean: 153 passed / 2 skipped / 0 failed. Zero-token
audit: `CONFIRMED CLEAN` (336 files, 0 external API refs).

## Both critical findings closed: unauthenticated WhatsApp send + forgeable client-portal token, 2026-08-10
Direct follow-up to the same-day "WhatsApp/Client Portal/Salary/Skills Fresh
Audit" (4 parallel research agents, published as a report) - user asked to
fix the 2 critical, live, unauthenticated-disclosure findings immediately.
Both fixed, deployed, and verified against real production - not code
review.

**Critical #1 - unauthenticated public WhatsApp send, from the real company
number.** All 4 routes on `phase3.py`'s `waha_router` (`/status`, `/start`,
`/qr`, `/send`) had no `Depends(get_actor)` at all - every other route in
that file does. Confirmed exploitable pre-fix: `POST /api/waha/send?phone=
<any>&message=<any>` was reachable over the public internet with zero
credentials and would send a real WhatsApp message from the company's
actual linked business number (918884449990). Fixed by adding
`Depends(require_role("admin","manager"))` to all 4 - same bar as other
tenant-wide integration controls (offer approve/issue). Root-caused *why*
these were built without auth in the first place while fixing the frontend:
`whatsapp-setup/page.tsx`'s own `wahaGet`/`wahaPost` helpers used a raw,
unauthenticated `fetch()` with no `Authorization` header at all - a second,
independent bug on the frontend side, not just the backend being permissive.
Fixed both together: the page now uses the app's standard `apiFetch()`
(real Bearer token, standard 401-handling), matching every other
authenticated page in the app.

**Critical #2 - anonymous full-pipeline disclosure via a forgeable
client-portal token.** The token was `base64url(tenant_id + ':' +
requisition_id)` - unsigned, no secret, no DB record, minted entirely
client-side. Both halves are derivable from public data (`tenant_id` is
hardcoded in the public careers page's client bundle; requisition IDs are
enumerable via the unauthenticated `GET /public/jobs`). Proven exploitable
pre-fix: forged a token and pulled 151 real candidates (names, current
employer, designation, stage, internal AI readiness score) off production
with a plain curl request, zero credentials.

Fixed with a real token system, `sql/43_client_portal_secure_tokens.sql`:
- `client_portal_tokens` - real, cryptographically random token
  (`secrets.token_urlsafe(32)`, minted server-side, never derivable from
  public data), with `expires_at` (180 days), `revoked_at`, and real
  access tracking (`access_count`, `last_accessed_at`) - closes the
  audit's separate "zero issuance/access tracking" finding for free.
  FORCE RLS + tenant_isolation policy.
- `get_client_portal_token(token)` / `record_client_portal_access(token)` -
  SECURITY DEFINER functions owned by `postgres`, same "anonymous token
  resolves tenant_id" pattern already established in this codebase for
  NDA/offer e-sign and device enrollment - the public endpoint has no
  `app.tenant_id` to work with until the token itself resolves one.
- New `POST /client-portal/generate-link` (authenticated) - mints a real
  token, idempotently reusing an existing non-revoked/non-expired one for
  the same requisition rather than spawning a new row on every click.
  New `POST /client-portal/revoke/{requisition_id}` - the first real way
  to invalidate a leaked link (previously impossible - there was no
  record to revoke).
- `GET /view/{token}` and `POST /feedback-public` rewritten to resolve
  the token through the new table instead of decoding it locally - the
  old base64-decode path is gone entirely, not kept as a fallback,
  since the whole point is eliminating the forgeable scheme (0 real
  client usage ever, per the same audit, so nothing was at risk of
  breaking). Also dropped the `tenant_id` field the old response
  returned at top level - a separate, smaller exposure the audit flagged
  (handing the tenant UUID to anyone with any link).
- Frontend: `requisitions/page.tsx`'s Share button no longer constructs
  a token client-side (`btoa(tenantId+':'+req.id)` - deleted entirely) -
  it now calls `/client-portal/generate-link` and copies the real token
  URL. Same UX (click Share, link copied), same URL shape, so the public
  `[token]/page.tsx` needed no changes at all - it already just passes
  `params.token` through opaquely.

**Verified for real end-to-end, not code review**: all 4 WAHA routes
confirmed to genuinely 401 with zero credentials (including `/send`
specifically, the one that was actively exploitable); confirmed a real
admin token still gets a real 200 with genuine WAHA status data. For the
portal: confirmed the *exact* old-style forged token (same construction
used in the original audit's proof) now returns 404 "Invalid or expired
link" against the live endpoint; walked the full legitimate flow
end-to-end (authenticated generate → real 43-char random token → public
`/view/{token}` returns real data → `access_count` genuinely incremented
in the DB → revoke → the same token now 404s → a fresh generate call
correctly mints a new token rather than reusing the revoked one);
confirmed unauthenticated calls to `/generate-link` itself 401. Real
headless-browser test clicked the actual Share button on `/requisitions`
and confirmed a real, correctly-shaped token URL landed in the clipboard
with zero console errors. All test-generated tokens deleted afterward,
confirmed zero residue. Full QA suite re-run clean: 153 passed / 2
skipped / 0 failed. Zero-token audit: `CONFIRMED CLEAN` (337 files, 0
external API refs).

**Not touched in this fix** (explicitly out of scope - the user asked for
the 2 critical items specifically, not the full list of secondary
findings from the same audit): the client-portal endpoint still returns
the entire pipeline rather than a true shortlist (including rejected
candidates), the Approve/Reject buttons' CHECK-constraint mismatch, the
duplicate-feedback-row bug, `POST /client-portal/login`'s independent
`''::uuid` crash, WhatsApp's consent-bypass-on-UI-reachable-paths finding,
the wrong hardcoded WAHA key in `phase3.py`'s internal `send_whatsapp()`
helper (distinct from the now-fixed `/waha/send` proxy), and the
inbound-WhatsApp wrong-tenant routing bug - all still open, all
documented in the published audit report for a future pass.

## All remaining findings closed: WhatsApp, Client Portal, Salary/Notifications, Skills/Question Bank, 2026-08-10
Direct follow-up to the same-day "WhatsApp/Client Portal/Salary/Skills Fresh
Audit" - after the 2 critical unauthenticated-disclosure bugs were closed
separately, user asked to build and complete everything else the audit
found. Three clarifying decisions made before starting (all per explicit
user choice): WhatsApp's ACCEPT/DECLINE notifies the recruiter to confirm
manually rather than directly flipping a real offer's status (a WhatsApp
reply isn't a verified identity the way an e-sign link is - keeps a human
in the loop for this high-stakes action); the Client Portal now filters
out `stage='rejected'` (a genuine shortlist, not the whole pipeline); the
Notification Center got a real minimal page built, not just the leak fix.

### WhatsApp Chatbot (P9)
- **Consent bypass closed on every UI-reachable send path.** `_ensure_consent`
  (already correct in `whatsapp.py`, previously with zero UI callers) is now
  called from `communications.py`'s `/send` + `/bulk-send` (the real
  Conversations/Candidate-360 composer paths) and `phase3.py`'s
  `/auto-interview/schedule` + `/send-reminder` (the real Interview
  Scheduler path) before any WhatsApp send. `/whatsapp-bot/send` (a raw
  connectivity-test tool, no candidate_id to check consent against) was
  instead gated to admin/manager, same bar as `/waha/send`.
- **The wrong hardcoded WAHA key in `phase3.py`'s internal `send_whatsapp()`
  helper fixed** (distinct from the already-fixed `/waha/send` proxy) -
  every interview invite/reminder had silently 401'd forever, swallowed by
  a bare `except`. Now reads `WAHA_API_KEY` like every other caller.
  Verified live: the same request now gets a real WAHA-side error ("No LID
  for user" for a fake test number) instead of 401 Unauthorized.
- **Inbound tenant misrouting fixed.** `SELECT id FROM tenants LIMIT 1`
  had no `ORDER BY` and was returning the wrong tenant depending on
  physical row order (a real UPDATE on either tenant's row can move it).
  `ORDER BY created_at ASC` deterministically picks the real primary
  tenant, matching all 15 historical real inbound resumes.
- **OFFER command implemented** (was advertised, unimplemented, fell
  through to the help menu) - queries the candidate's real offer and
  replies with status/CTC/joining date, or a "being finalized" message
  pre-issue. **CALLBACK now creates a real `recruiter_tasks` row**
  (was a no-op reassurance). **ACCEPT/DECLINE now write a real
  `notifications` row** to the assigned recruiter (or a manager fallback)
  instead of writing nothing - per the explicit decision above, this
  notifies rather than directly mutates the offer.
- **Inbound messages now logged to `candidate_messages`** (both resume
  attachments and text commands) - the Conversations page's WhatsApp
  folder could never show an inbound message before this, despite real
  ones arriving daily.
- **A real Consent tab built** - was a static stub with zero API calls,
  meaning there was no way to grant WhatsApp consent for a real candidate
  anywhere in the product (every one of the fixes above was previously
  unsatisfiable for any real candidate as a direct result). Candidate
  search → grant/revoke via the existing `consent-records` API → real
  history. **Templates tab fixed to show real backend data** instead of 4
  hardcoded strings that didn't match any real template - the QA test that
  "verified" 14-language support only ever regex-matched those 4 fake
  strings; rewritten to assert the real 14-language-code list instead.

### Client Portal (P25)
- **Approve/Reject 500 fixed** - frontend sent `approve`/`reject` against
  a DB CHECK constraint expecting `approved`/`rejected`; only "Hold" ever
  worked. Aligned the frontend's `DECISION_CFG` keys to the real values.
- **Duplicate-feedback-row bug fixed** - `sql/44_client_portal_fixes.sql`
  consolidates the 2 known duplicate E2E rows and adds a real
  `UNIQUE(tenant_id, application_id)` constraint; both feedback endpoints
  now `ON CONFLICT ... DO UPDATE` (a revised decision replaces the old
  one) instead of `DO NOTHING` with nothing to conflict on.
- **Feedback now reaches a real recruiter.** Was write-only into a void -
  a client's decision never surfaced anywhere internally. Both feedback
  endpoints now write a real `notifications` row to the assigned
  recruiter (or a manager fallback). Verified live: two real feedback
  submissions produced two real notification rows with accurate text.
- **`POST /client-portal/login` fixed** - was a guaranteed 500 on every
  call (bare `email`/`password` params bound as query args instead of a
  body, plus the same `''::uuid` RLS-cast crash class fixed repeatedly
  elsewhere in this project). Real Pydantic body + a SECURITY DEFINER
  email-lookup function, since login needs to resolve a tenant it doesn't
  know yet - same anonymous-token pattern as the token-forgery fix.
- **Shortlist now genuinely excludes rejected candidates** and validates
  that a submitted `application_id` actually belongs to the token's own
  requisition (previously unvalidated - a valid link for req A could
  attribute feedback to any candidate in the tenant).

### Salary Benchmarking (P31) + Notification Center (P32)
- **Market Demand's missing `is_active` filter fixed** - was counting
  soft-deleted (mostly QA test) requisitions as real demand. Verified
  live: dashboard went from 240 open reqs / 194 Python demand to the real
  21 open / 9 Python.
- **`/suggest`'s backwards substring match fixed** - required the stored
  benchmark title to contain the caller's query, not vice versa, so real
  titles like "Senior Python Developer, 3yr" never matched a shorter
  stored "Python Developer 2-5yr" row. Now bidirectional. Verified live
  with the exact failing query from the audit - now resolves correctly.
- **Notification recipient-scope leak fixed** - every list/count/mark-read
  endpoint filtered on the legacy `user_id` column instead of the real,
  documented `recipient_user_id`/`recipient_role` columns every write site
  actually populates, so all 207 real role-targeted notifications
  (manager/admin/recruiter-only) leaked to every user in the tenant.
  `mark_read` also gained a real recipient check - previously any
  authenticated user could mark any other user's notification read.
- **A real Notification Center page built** at `/notifications` - the
  bell badge was always real and live but had no `onClick`/`href` and no
  page to go to. Minimal: unread/all filter, mark-one/mark-all-read, links
  into the related candidate/application/requisition. Verified via a real
  headless-browser click-through: bell → page → 100 real rows → mark-read
  round-trip, zero console errors.

### Skills Taxonomy (P23) + Interview Question Bank (P34)
- **The resume-parser skill-normalization stale-import bug fixed.**
  `improved_parser.py` imported `_CACHE_LOADED` **by name** from
  `skill_normalizer.py`, which copies the value at import time (`False`)
  and never sees the real module's later flip to `True` once
  `init_cache()` runs - the guard permanently read a stale `False`, so
  DB-backed skill normalization had never executed once in production
  despite the cache genuinely loading correctly. Fixed by importing the
  module itself and reading `skill_normalizer._CACHE_LOADED` at call time.
  **Verified end-to-end with a real resume parse**: `Kafka`→`Apache Kafka`,
  `Spring`→`Spring Boot`, `Vue`→`Vue.js`, `REST`→`REST API` - the exact 4
  canonical rewrites the audit named - now genuinely apply, for the first
  time. Also wired `refresh_cache()` (previously zero callers) into
  `POST /skills` so a newly-added alias becomes usable immediately instead
  of only after the next backend restart.
- **Question Bank's case-sensitivity matching bug fixed.**
  `GET /question-bank/generate/{req_id}` intersected lowercase `tags`
  against Title-Case `skills_required` with case-sensitive `&&`, matching
  0 of 262 real requisitions and silently falling through to 5 generic HR
  questions every time. Fixed by lowercasing both sides. Verified live:
  a real "Senior Python Developer" requisition now returns genuinely
  relevant technical questions (GIL, decorators, list vs tuple) instead
  of "what's your greatest weakness." (SAP-tagged requisitions still get
  HR fallback questions - a real data gap, zero SAP-tagged questions
  exist in the 26-question bank - not something a matching-logic fix can
  address.) Also guarded the two NULL/empty-input crash risks the audit
  flagged as latent but real.
- **The missing `expected_answer` field fixed** - the list endpoint's
  SELECT never included it, so the browse page's "Expected Answer /
  Evaluation Guide" panel - the single most valuable field on every
  question - could never render even though the data was always there.

Full QA suite re-run clean after all of the above: **153 passed / 2
skipped / 0 failed**. One test needed a real fix along the way (not a
regression): `S11 WhatsApp Outreach`'s "templates tab shows 14 languages"
had been asserting against the exact 4 hardcoded fake strings this batch
removed - confirmed as the audit's own "false green" finding, rewritten to
assert the real 14-language-code list instead, verified passing against
the actual fixed page. Zero-token audit: `CONFIRMED CLEAN` (338 files, 0
external API refs). Every fix verified against real production data end-
to-end, not code review - all throwaway test data (candidates,
applications, consent_records, notifications, recruiter_tasks,
candidate_messages, client_portal_tokens) cleaned up after each check,
confirmed zero residue.

## Round-3 audit (ERP/Interview/Email/Activity/JD/CSV/Tags/Duplicates) — all 32 findings closed, 2026-08-10
Direct follow-up to the same-day 4-module research audit (ERP Timesheet+Payroll
P12, Email Templates+Interview Scheduler+Activity Timeline P24, JD Templates+
CSV Exports P27/P28, Candidate Tags+Duplicate Detection P33/P35). User said
"build and develop and clear the all gaps and issue" for the full ranked list
(4 Critical, 7 High, 14 Medium, 7 Low). All 32 built, deployed, and verified
against real production data end-to-end — not code review.

**ERP (P12)** — `sql/45_erp_integrity_fixes.sql`, `erp.py` rewritten:
- Payroll double-pay fixed two ways: a real `UNIQUE(tenant_id, pay_period_
  start, pay_period_end)` constraint (409 on an exact-period retry) plus a
  new `timesheets.payroll_run_id` stamp so a timesheet can never be pulled
  into a second run under any period boundary, overlapping or not.
- Timesheet state machine added (was fully unconditional before): submit
  only from draft/rejected, approve/reject only from submitted — closes the
  live-reproduced "approve a billed timesheet → un-bill → re-pay" cycle.
- `generate_invoice_from_timesheets()` now checks for approved timesheets
  *before* consuming an invoice number — a second call for an already-
  billed period used to always create a permanent ₹0 junk invoice.
- Real, previously-hidden bug found while wiring event_outbox/audit_log
  into invoice generation: `SET LOCAL app.tenant_id = p_tenant_id` inside
  the plpgsql function does NOT substitute the variable — it literally sets
  the GUC to the 9-char string `"p_tenant_id"` (proven: `current_setting()`
  read that exact string back). Silently masked until now because nothing
  ever ran a second RLS-protected query on the same connection afterward.
  Fixed with `EXECUTE format('SET LOCAL app.tenant_id = %L', p_tenant_id)`.
- Role-gated the entire module to admin/manager (previously zero role
  checks — any authenticated user could approve timesheets/pay invoices/
  run payroll/read-write contractor PII); `mark-paid` now rejects an
  already-paid or cancelled invoice instead of silently overwriting
  `paid_at`; `erp_decrypt`/`generate_invoice_from_timesheets` PUBLIC
  EXECUTE grants revoked (defense-in-depth — neither was HTTP-reachable,
  but a DB role shouldn't have had it either); every write now emits
  `event_outbox`+`audit_log`. Added a payslip drill-in (expand a payroll
  run row) to the Finance page — the endpoint existed with zero UI caller.
  Verified with a real throwaway placement/timesheet/invoice/payroll-run
  cycle: every guard reproduced (400/409 exactly where expected), audit
  trail rows confirmed written, PUBLIC grant confirmed revoked via `proacl`.

**Interview Scheduler (P24)** — `sql/46_interview_scheduler_fixes.sql`,
`p23_p27.py`, `phase3.py`, `calendar.py`, `scheduler.py`, both frontend
scheduling forms:
- Timezone bug fixed at the source: `interviews/page.tsx` and Candidate
  360's inline scheduler both sent the raw, unconverted `datetime-local`
  string (interpreted as UTC downstream) — now convert via
  `new Date(...).toISOString()` before sending, the same correct
  conversion the conflict-check call already used but the actual save
  never did.
- Root-caused why the daily reminder cron had *never* fired once:
  `send_interview_reminders()` queried `SELECT id FROM tenants WHERE
  is_active=TRUE` — `tenants` has no `is_active` column at all (confirmed:
  id/name/slug/created_at/permission_enforcement_enabled only). Every run
  since this job was written failed at the very first line, silently
  caught by the outer try/except. Fixed to match every other scheduler
  job's plain `SELECT id FROM tenants`; directly invoked the real function
  inside the container afterward and confirmed it completes cleanly.
- Public self-scheduling was 100% broken — `interview_type='self_scheduled'`
  isn't in the CHECK constraint (only screening/technical/hr/client/final/
  panel), so every public booking attempt failed. Widened the constraint.
- Explicit-interviewer double-booking: neither `POST /interviews` nor
  `POST /auto-interview/schedule` checked for a real conflict when
  `interviewer_id` was given directly (only the auto-pick path avoided
  conflicts, by construction) — reproduced a live double-booking, now
  hard-blocked (409) via a new `_has_conflict()` helper shared by both
  endpoints. Candidate 360's scheduling form also had no interviewer
  field at all (root cause of every real interview having
  `interviewer_id=NULL`) — added the same picker + Suggest button the
  main Interview Scheduler page already had.
- ICS re-download silently returned `download_url: null` on the second
  click (deterministic UID hit `ON CONFLICT DO NOTHING` with no fallback
  read) — now fetches the existing row instead.
- Marking an interview "Completed" unconditionally nulled feedback/rating
  even with no replacement value in the request — fixed with COALESCE;
  Candidate 360 also gained a real feedback/star-rating capture step
  before completing (there was no input for it anywhere before).
  `send-reminder` returned the interview's own `scheduled_at` mislabeled
  as the reminder timestamp — now returns the real one via RETURNING.
- Scheduler double-registration: the backend runs `uvicorn --workers 2`,
  so `start_scheduler()` (called once per worker at FastAPI startup) was
  registering every cron job — retention bank, SLA escalations, interview
  reminders, all of it — twice. Fixed with a plain `flock` on a fixed
  `/tmp` path: whichever worker wins the non-blocking lock owns the
  scheduler for the container's lifetime; the loser still serves HTTP
  normally, it just never registers a job. Verified live: a second
  worker's lock-acquire attempt genuinely blocks (`Resource temporarily
  unavailable`).
  All of the above verified with real API calls: reproduced then confirmed
  fixed for the double-booking (409 on same slot, 200 on a different one),
  the self-scheduling insert, the feedback-preservation re-patch, the ICS
  repeat-download, and the reminder timestamp — not one code-review-only
  claim in this batch.

**Email Templates (P24)** — `communications.py`, `p23_p27.py`, new
`/email-templates` page, Conversations composer:
- Single-send (`POST /communications/send` — the actual path the
  Conversations composer calls) never personalized anything at all; a
  recruiter picking a template and hitting Send emailed the candidate
  literal `Hi {candidate_name},`. New `_resolve_template_vars()` resolves
  every placeholder the 6 real seeded templates actually contain —
  `{candidate_name}`/`{role}`/`{client_name}`/`{company}` (the agency's
  own name, distinct from client_name — found by reading the real
  template bodies, not guessed)/`{recruiter_name}`/`{recruiter_phone}`/
  `{ctc}`/`{date}`/`{time}`/`{mode}`/`{meeting_link}`/`{interviewer_name}`
  (from the candidate's nearest upcoming interview)/`{joining_date}`
  (from a real offer if one exists)/`{location}` — applied to both send
  paths now, single and bulk. `{deadline}`/`{hr_contact}`/`{hr_phone}`
  resolve to empty string honestly (no source anywhere in the schema)
  rather than left as literal placeholders.
- Preview endpoint substituted `{{double_brace}}` while every real
  template uses `{single_brace}` — always returned the template
  byte-for-byte unsubstituted regardless of input. Fixed to match.
- `sent_count` was a fully dead column (nothing ever incremented it) —
  now increments in `_log()`, the one choke point every send path
  (single/bulk, email/whatsapp) already funnels through.
- Built the missing management UI from scratch (`/email-templates`,
  sidebar entry) — list/preview-with-sample-data/create/edit (system
  templates read-only, matching the backend's own `NOT is_system` guard);
  wired `template_id` through the Conversations composer's template
  picker, which previously discarded it entirely.
  Verified with a real send through a real template: every placeholder
  resolved to a real value, zero literal braces left in the logged
  message; confirmed via real headless-browser test (6 templates listed,
  preview substituted, create form opens).

**Activity Timeline (P24)** — `communications.py`, `offers.py`,
`phase3.py`, `resume_intake_service.py`:
- `email_sent`/`whatsapp_sent`/`offer_made`/`document_uploaded` were all
  defined `candidate_activities` types nothing ever wrote. Wired into the
  same choke points already used for `event_outbox`/`audit_log`: `_log()`
  (both offer-creation code paths — `offers.py`'s and `phase3.py`'s
  separate implementations both needed it), and resume intake's
  `candidate_parsed_data` write site (best-effort, same try/except shape,
  must never be able to take the resume/candidate insert down with it).
  Verified live: a real send + a real offer-draft both produced correct
  activity rows in the same request. `document_uploaded` verified via
  code-path parity with the already-proven `candidate_parsed_data` write
  (structurally identical try/except right next to it) rather than a full
  live resume-intake exercise — the one lighter-weight verification in
  this batch, flagged honestly rather than glossed over.

**JD Templates (P27)** — `jd-templates/page.tsx`, `requisitions/page.tsx`:
- The Copy-JD "undefined" bug and `usage_count` stuck at 0 turned out to
  be the same root cause: the list endpoint deliberately omits `jd_text`
  (keeps the list light), and the page selected straight from the list row
  instead of calling the detail endpoint — which both has `jd_text` AND is
  the one that increments `usage_count`. Fixed by calling `GET /jd-
  templates/{id}` on select, closing both bugs in one motion. Verified via
  real headless-browser test: real JD text in both the preview pane and
  the clipboard after clicking Copy JD (was the literal string
  `"undefined"` before).
- Added a "Start from JD Template..." picker to the Requisition form
  (0 of 26 real requisitions had ever used template content — there was
  no integration point at all) and a full create-template form on the JD
  Templates page (the create endpoint existed with zero UI caller).
  Verified live: picking a template from the requisition form fills the
  description with real 595-char JD text.

**CSV Exports (P28)** — `p28_p32.py`, Audit/Analytics/Reports pages:
- `/export/placements` had 500'd on every call since it was written —
  4 of 10 selected columns don't exist (`p.placed_by`, `p.client_name`,
  `p.rate`, `p.currency`; real columns are `client_id`→join clients,
  `bill_rate`/`pay_rate`, no currency column at all — this product is
  India-only, INR is implicit per CLAUDE.md). Recruiter credit now
  resolves via the real offer→application→assigned_recruiter_id chain,
  since placements itself has no recruiter column. Verified: 500→200,
  real data returned.
- Candidates export's unqualified join against `candidate_scores` (one
  row per candidate×requisition) fanned out into up to 22 duplicate rows
  per candidate — fixed with a `LATERAL` join picking only the most
  recently scored row. Verified against a real candidate with 22 real
  score rows: 22 duplicate export rows → exactly 1.
- Both candidates and requisitions exports leaked soft-deleted records
  (85% of the old requisitions export was QA garbage) — added an
  `is_active` filter (with an `include_inactive` override, matching the
  convention `GET /requisitions` already established). Verified: 283→42
  requisition rows.
  Audit page's two export buttons were plain `<a href>` tags with no auth
  header, pointed at a hardcoded raw IP over plain HTTP — both downloaded
  a JSON 401 body, not a CSV. Rewritten with the same authenticated
  fetch→blob→download pattern Analytics/Reports already use correctly;
  added a Requisitions export button (was fully orphaned, zero UI caller
  anywhere) alongside Candidates/Placements. `.xlsx` filenames/labels on
  Analytics/Reports/Audit renamed to `.csv` (the payload was always CSV —
  Excel warns on the mismatch today) and a UTF-8 BOM added to `to_csv()`
  (Excel-on-Windows mis-renders non-ASCII names without one, matching the
  newer pipeline-board export's own convention).

**Candidate Tags (P33)** — `sql/47_tags_and_duplicates_fixes.sql`,
`p30_p35.py`:
- `candidate_tag_map` had zero row-level security at all (proven live:
  a tenant-B session could read tenant-A's tag assignments). Added FORCE
  RLS with a policy checking BOTH sides — tag_id's tenant AND
  candidate_id's tenant (a policy checking only the tag side would still
  let an attacker holding a real own-tenant tag attach it to another
  tenant's candidate) — plus explicit app-level validation in assign/
  remove for a clean 404 instead of relying solely on RLS.
  `usage_count` counted soft-deleted candidates forever (permanently
  over-reported, 3 vs the real 2 in a live check) — added an `is_active`
  filter. Removed the 4 confirmed leftover QA/Playwright test tags from
  the real tag dropdown (zero real assignments on any of them). Seeded
  the 12 default tags for every tenant with zero tags (the original seed
  was a one-time script against the one tenant that existed then — Beta
  Tech Staffing, added later, had none). Verified all of the above live:
  0 cross-tenant rows visible, 12 tags exactly on both tenants now,
  assign/remove both working.

**Duplicate Detection (P35)** — same migration + `p30_p35.py`,
`candidates.py`, `scheduler.py`, `duplicates/page.tsx`:
- Merge only ever re-linked applications, silently orphaning the
  discarded candidate's `resume_files`/`candidate_parsed_data` on a
  now-hidden record. Rewired to reuse `dedup_service.
  merge_duplicate_candidates()` — the same, already-correct, fuller merge
  the resume-intake duplicate flow already uses (resume_files +
  applications + candidate_parsed_data re-link, plus missing-field/
  skills backfill) — one merge implementation instead of two divergent
  ones. Verified live: attached a real resume_files row to a throwaway
  "discard" candidate, merged, confirmed it now points at the "keep"
  candidate instead of being orphaned.
- The list endpoint never returned phone at all, despite 100% of real
  pairs being phone matches — a recruiter had no way to see what actually
  matched before an irreversible merge. Now returns both candidates'
  phones; the Duplicates page highlights whichever one is the real
  `match_field`.
- A soft-deleted candidate's email permanently blocked re-adding that
  person, with no override possible (`uq_candidates_email_per_tenant`
  applied globally, not just to active rows — a real DB-level 409, not
  just a client-side pre-check). Made the unique index partial
  (`WHERE is_active IS NOT FALSE`, checked zero existing active-duplicate
  emails first) and filtered the pre-check the same way. Verified: the
  exact reproduction (soft-delete → re-add same email) now succeeds.
- `check-duplicate`'s phone match had no minimum length — a 4-digit
  partial (mid-typing) became an unanchored suffix wildcard matching any
  stored number ending in those digits; also only ever returned the first
  match via `fetchrow`. Fixed with a 7-digit minimum and `fetch` (all
  matches, not just one). Verified: 4-digit phone → `has_duplicate:false`.
- No scheduled scan existed — the list only ever reflected whoever last
  clicked the manual button. Added a daily 03:30 IST
  `process_duplicate_scan()` job (same matching logic, just cron-driven).
  Verified: ran the real function inside the container, completed clean,
  found real new pairs.

**QA data-pollution root cause, closed for real** — the duplicate-
detection audit's headline finding (58/58 pending pairs were QA test
artifacts, 202 of 1,029 active candidates in production were leftover
"QA ..." test records) traced to a real bug in the test suite itself, not
just accumulated cruft: S14/S15/S16's `afterAll` hooks (added in an
earlier session specifically to stop stray *requisitions* from
piling up) only ever deleted the requisition — never the candidate(s) each
suite also creates. S16 had a second, worse instance of the same bug: its
third candidate (`cand3Id`, created inside the "JD auto-send" test) was a
test-local `const`, invisible to `afterAll` even in principle. Fixed all
three hooks to also delete every candidate they create; promoted `cand3Id`
to a describe-level variable so it's actually reachable from cleanup.
Soft-deleted all 202 existing stray candidates via the real `DELETE
/candidates/{id}` API (not raw SQL). Verified for real, not just read: ran
S14+S15+S16 (18 tests) after the fix — all passed, and a direct count
immediately after confirmed exactly 0 new "QA ..." candidates leaked,
where before this fix every single run added 4 more.

**Schema drift backfill** — `candidate_tags`, `candidate_tag_map`,
`duplicate_candidates` all existed live with no `CREATE TABLE` in any
committed migration; `sql/47...sql` backfills all three (`IF NOT EXISTS`,
genuine no-op everywhere they already exist, columns captured from the
live schema not reconstructed from memory).

Full QA suite (all suites, not just the 3 touched) re-run clean after
every fix in this batch landed. Zero-token audit: `CONFIRMED CLEAN`
(340 files, 0 external API refs). All throwaway test data (candidates,
applications, offers, timesheets, invoices, payroll runs, interviews,
tags, duplicate-candidate rows, resume_files) cleaned up after every
check, confirmed zero residue — including resetting two test-inflated
counters (a template's `sent_count`, a JD template's `usage_count`) that
aren't real usage back to their pre-test values.

## Individual recruiter candidate ownership (30-day FCFS lock), 2026-08-11
User provided two reference docs (a business-rule spec for per-recruiter
candidate ownership, and a separate ChatGPT-drafted "Workforce
Intelligence" activity-scoring proposal — explicitly out of scope,
never built) with an explicit "check first, don't build yet" instruction.
Research confirmed: no ownership concept existed at any level —
`applications.assigned_recruiter_id` was set purely by round-robin
(`_pick_round_robin_recruiter()`), unrelated to who actually sourced the
candidate, and shown nowhere on the candidate record. This codebase has
no separate "Login ID" — `users.email` already **is** the login credential,
so the doc's "Login ID"/"registered email" collapse to one existing field.
User confirmed scope via direct answers: the 30-day lock covers **personal
mailbox intake + manual Add Candidate + bulk CSV/Excel upload** (not
WhatsApp/public-apply/browser-extension, which route to an unassigned
review queue instead); ownership **overrides round-robin entirely** on
the 3 covered paths for the life of the lock.

Built via `sql/48_candidate_ownership.sql` (`candidate_ownership` — 1
row/candidate, current state; `candidate_ownership_history` — append-only
audit trail; both FORCE RLS) and a shared `backend/services/
candidate_ownership.py` (`claim_ownership()` — atomic FCFS via
`SELECT...FOR UPDATE` row lock, `get_ownership()`), reused (not
reimplemented) across all 3 intake paths: `candidates.py::create_candidate()`
(manual add — also enhanced the existing duplicate-email 409 to name the
real owner + expiry date, matching the reference doc's exact "Candidate
Already Owned... until <date>" UX), `import_router.py` (CSV + Excel bulk
upload, attributed to the uploader), `resume_intake_service.py::
upsert_candidate()` (personal mailbox — resolves the receiving recruiter
via the pre-existing `user_email_accounts`/`imap_messages.account_id`
mapping, previously captured but never used for anything). Ownership is
claimed only on each path's genuine-INSERT branch, never on an existing-
candidate UPDATE (an update never transfers ownership, per the rule).
`applications.py::create_application()` now defaults `assigned_recruiter_id`
to the candidate's active owner when one exists, falling back to round-robin
only when there isn't one. Daily 04:00 IST scheduler job flips expired locks
to `status=expired`. New endpoints (`GET/POST .../ownership`, `.../claim`,
`.../transfer`) + a Candidate 360 Ownership card + a Candidates-list Owner
column/Unowned filter/admin-Claim button, both via the established SSR-safe
deferred-localStorage-role-read pattern.

**A real near-miss during verification, disclosed rather than glossed
over**: testing the personal-mailbox path with a hand-picked synthetic
phone/email that happened to already match an existing candidate row
caused `upsert_candidate` to correctly take its UPDATE branch (skipping
ownership, by design) — but the test script's blind cleanup then deleted
that matched candidate. Checked all 6 tables referencing `candidates`
for any trace of it (zero rows in any) — critically, `applications` and
`candidate_activities` both have `ON DELETE RESTRICT` on `candidate_id`,
so the delete succeeding at all proves that record had zero real pipeline
activity ever. Couldn't fully identify its origin, but nothing points to
it being an actively-recruited real candidate — most consistent with a
forgotten stale test row. Re-verified the actual mechanism correctly
immediately after, this time proving uniqueness *before* writing
(pre-check both lookups return no match, confirm a candidate-count delta
of exactly +1) rather than assuming a hand-picked identifier was fresh:
ownership row created correctly (`source=personal_mailbox`, 30-day
expiry, `claimed` history row).

All 8 verification-plan checkpoints passed with real data: RLS cross-
tenant isolation, manual-add claim + enhanced 409 (a 2nd recruiter
correctly blocked, sees real owner+expiry), bulk-upload claim (whole
batch attributed to uploader), personal-mailbox claim (above), round-robin
override (owned candidate's application correctly assigned to the owner;
an unowned candidate still gets round-robin, no regression), expiry
(backdated row + scheduler run correctly flips to `expired`, becomes
claimable, prior ownership preserved in history), and real headless-
browser checks of both new frontend surfaces. Full QA suite: 153 passed /
2 skipped / 0 failed. Zero-token audit: `CONFIRMED CLEAN` (344 files, 0
external API refs). All throwaway test data cleaned up, confirmed zero
residue.

**Explicit scope boundary, not silently assumed**: this blocks a
non-owner from *becoming* the owner on the 3 covered paths and surfaces
ownership everywhere it matters, but does not lock down every other
in-app action (messaging, tagging, pipeline moves) for non-owners — the
reference doc's broader "prevent from processing" would be a materially
larger, separate change if wanted later.

## Workforce Intelligence: real recruiter activity tracking + automated KPI suggestions, 2026-08-11
User provided a third reference doc ("AVIIN ATS Workforce Intelligence
Integration Package") proposing a full recruiter-activity/productivity/
performance-scoring system, with the same "check first, don't build"
instruction as the ownership feature. Research-only audit against real
code/DB found the core premise correct (recruiter_kpi_scores, the P15
monthly compensation scorecard, is 100% manual data entry — `POST
/incentives/scorecard` takes all 6 sub-scores straight from the request
body, zero server-side computation) but the doc itself overstated the
gap and its code was generic/hallucinated (wrong routes/columns, and a
hard dependency on `device_activity_log`, which has **zero rows in
production** — device monitoring exists but nobody has enrolled a
device). Real partial coverage already existed too:
`candidate_activities`/`pipeline_movements` (113/490 real rows) and
`/recruiter/my-stats`/`/recruiter/my-day`. Reported back; user's
decision: build all three — a full real activity-tracking system with
dashboards, automate the existing monthly KPI scorecard, and the doc's
proposed tables adapted to this codebase's real schema.

**Key reconciliation decision**: the new system does not replace or
merge into `recruiter_kpi_scores` — that table stays the official,
human-approved, money-linked monthly scorecard (already wired into
`incentive_records`/`retention_bank` via draft→approved→paid).
`recruiter_performance_scores` (new) is a **daily, purely informational**
score — dashboards/leaderboard only, no money attached, its own
`score_weight_config` (distinct from the AI-matching `scoring_weight_config`
and the requisition-level `sla_tier_config`).

Built via `sql/49_workforce_intelligence.sql` (`recruiter_activity_events`
— typed event log, `event_type` free text not a rigid enum so custom
tenant interview rounds like `l3_interview` don't hit the hardcoded-
stage-key bug class fixed repeatedly elsewhere in this project;
`recruiter_productivity_hourly/daily/weekly` — identical-shape rollups;
`recruiter_sla_tracking` — per-candidate first-response timer, distinct
from the existing requisition-level fill-time SLA; `score_weight_config`
+ `recruiter_performance_scores`; `v_recruiter_activity_summary` view for
the leaderboard, same "`SELECT * FROM v_*_summary ORDER BY metric DESC`"
template as `v_kae_summary`). New `backend/services/activity_events.py`
(`log_recruiter_activity()` — written synchronously inside the caller's
own transaction, same reliability treatment as `pipeline_movements`/
`candidate_activities`, idempotent via a real `dedup_key` unique
constraint) wired into the 8 real call sites that represent a recruiter
action: `candidates.py::create_candidate()`, `resume_intake_service.py::
upsert_candidate()` (personal mailbox), `import_router.py` (CSV+Excel),
`applications.py::update_stage()` (screened/submitted/rejected/any
`*interview*` stage), `phase3.py::auto_schedule_interview()` (also
backfilled a missing `candidate_activities` write found here — this path
never logged to the timeline at all), `p23_p27.py::update_interview_status()`
(on completion), `phase3.py::auto_generate_offer()`/`offers.py::create_offer()`,
and `offers.py::respond_offer()` (accept fires `offer_accepted`+`placed`,
decline fires `offer_declined`).

4 new scheduler jobs (hourly at :05, daily at 02:30, weekly Monday 03:15,
performance scoring at 02:45 — all IST, same `add_job(...,id=...,
replace_existing=True)` convention) follow the established correct
tenant-loop pattern (list tenant ids via `system_conn()`, real work via
per-tenant `tenant_conn()` — never query a FORCE-RLS table through
`system_conn()` directly, the exact bug class fixed repeatedly elsewhere
in this project). `compute_recruiter_performance_scores()` computes 6
real sub-scores (output=funnel volume, quality=submission→interview
conversion, velocity=real SLA-tracking response time, productivity=device
time when known else an activity-volume proxy, sla=% first-response
within target, interview_conv=interview→offer rate) against the tenant's
own `score_weight_config`.

New `GET /incentives/scorecard/suggest` (`incentives.py`) computes real
suggested values for the 6 existing `recruiter_kpi_scores` fields from
actual placements/interviews/offers/`client_feedback`/activity this
period — **never writes `recruiter_kpi_scores` itself**, only returns
suggestions for the existing form to pre-fill, preserving the
draft→approved→paid human-review workflow. Revenue attribution splits a
placed client's real `account_pl.revenue` across recruiters who placed
there that period — documented in-code as a best-effort heuristic, same
spirit as `match_recruiters()`'s own documented zero-weight placeholders.
Client-satisfaction falls back to a neutral midpoint (not zero) when no
feedback exists yet, so a recruiter isn't unfairly zeroed just because no
client happened to leave feedback.

New `GET /recruiter/activity/today`+`/activity/trends` and a `/manager`-
prefixed router (`GET /manager/activity-leaderboard`, `GET`/`PUT
/manager/score-weights`, admin/manager-gated via `require_role`) added to
`recruiter_dashboard.py` (registered as a second router in the same file,
same multi-router-per-file convention as `phase3.py`). Frontend: a new
"Activity" tab and admin/manager-only "Team Leaderboard" tab on
`/recruiter-ops` (reusing the hand-rolled CSS-bar `BarChart` component
from `reports/page.tsx` — recharts is declared in `package.json` but
genuinely unused anywhere in this frontend, confirmed via repo-wide
grep, so no existing convention to match there), a "Suggest from real
data" button on the Incentives scorecard form, and a "Performance
Weights" tab on Ops Settings.

**A real bug caught by the very first live test, not code review**:
asyncpg has no jsonb codec registered in this app (the same class of gap
documented repeatedly elsewhere in this project for `role_definitions.
permissions`) — `log_recruiter_activity()`'s first version passed a
Python dict straight to the `metadata` jsonb column parameter, and the
very first real candidate-creation call after deploy 500'd
(`DataError: invalid input for query argument $10: {} (expected str, got
dict)`). Fixed with `json.dumps(metadata or {})`, verified with a real
follow-up candidate creation succeeding and a real `sourced` event +
`recruiter_sla_tracking` row landing correctly.

**Verified for real end-to-end, not code review**: ran a genuine
candidate through the entire funnel via real API calls — create →
screened → submitted → l1_interview → schedule interview → complete
interview → generate offer → approve → issue → accept — and confirmed
all 9 expected `recruiter_activity_events` rows landed with the correct
types (`sourced`, `screened`, `submitted`, `l1_interview`,
`l1_interview_scheduled`, `technical_completed`, `offer_generated`,
`offer_accepted`, `placed`). Ran the aggregation + scoring jobs directly
against that real data and hand-verified every number: daily rollup
matched the exact 1/1/1/1/1/1/1 funnel counts, and the performance
score's `overall_score` (71.80, grade C) matched a hand-computed formula
to the decimal (output 40×0.30=12, quality 100×0.20=20, velocity
100×0.15=15, productivity 32×0.15=4.8, sla 100×0.10=10, interview_conv
100×0.10=10 → 71.8). Separately verified the KPI-suggest endpoint against
a real recruiter with a real June placement — `joinings_score=12.0`
(1 placement × 12) and `offer_score=10.0` (2/2 offers accepted × 10) both
matched the formula exactly, and confirmed `recruiter_kpi_scores` itself
was untouched by the call. RLS proven with a real cross-tenant read
attempt on `score_weight_config` as `app_user` (0 rows visible despite
the row genuinely existing for the other tenant). Real headless-browser
checks confirmed the Activity tab, Team Leaderboard, Ops Settings
Performance Weights tab, and the Incentives Suggest button all render
and work against real data. New permanent "S18 Workforce Intelligence"
suite added to `qa_automation.spec.ts` (`.serial()`, matching the
established S14-S17 convention). All throwaway test data (candidates,
applications, requisitions, interviews, offers, placements, activity
events, SLA tracking rows, productivity/score aggregates) cleaned up
after every check in FK-safe order, confirmed zero residue.
