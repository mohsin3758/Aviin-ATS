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
96GB disk (93GB free; 21GB used after P0 image pulls/builds), 7.8GB RAM
(5.5GB free; ~2.5GB used with all 7 P0 containers up), Docker 29.5.3 +
Compose v5.1.4. `dev` is in the `docker` group per `/etc/group`, but THIS
shell session's cached `groups` output predates that grant — plain
`docker`/`docker compose` commands fail with "permission denied ... docker
API at unix:///var/run/docker.sock" in this session. WORKAROUND: prefix
every docker/docker-compose daemon command with `sg docker -c "..."` (works
without a password). `docker compose config` — pure YAML parse, no daemon —
works without the wrapper. A fresh login/tmux session would pick up the
group correctly and not need this. Node 20.20.2 / Python 3.12.3 on host.
7.8GB RAM is workable but not generous once Postgres + Ollama + n8n +
FastAPI + Next.js + WAHA (P11, Chromium-based like Playwright) are all
running together — if containers start OOM-killing in later phases, stagger
non-essential services or add swap rather than removing the zero-token
local-AI services.

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

## PROJECT FILES (paths relative to repo root ~/airecruit)
- sql/01_phase1_schema.sql              — Phase 1 foundation
- sql/02_phase1_p1_additions.sql        — P1 backend API additions
- sql/10_phase1_staffing_additions.sql  — hotlist/submittal/placement
- sql/00_app_role.sql                   — app_user role
- backend/app.py                        — FastAPI backend
- backend/embed_writer.py               — vector column filler
- backend/seed_data.py                  — India demo data
- embed/embed_service.py                — BGE-small service
- sql/03_phase2_n8n_additions.sql       — notifications, job_board_postings,
                                           find_stalled_assignments, find_sla_breaches
- n8n/build_workflows.py                — generator for n8n/workflows/*.json (W1-W9)
- n8n/workflows/                        — exported workflow JSON (re-import after editing the generator)
- n8n/credentials/                      — exported Postgres app_user credential
- sql/04_phase3_ai_engine.sql           — match_candidates/match_recruiters/
                                           assign_with_explanation/do_reassign +
                                           v_redeployment_queue/v_agency_funnel/
                                           v_recruiter_capacity/v_skill_gap
- backend/ai_router.py                  — Tier2-lite cascade: embed -> ai_cache
                                           lookup (>0.95 cosine) -> Ollama -> cache store
- backend/routers/ai.py                 — POST /jd/generate
- backend/routers/analytics.py          — GET /analytics/{4 views}
- docker-compose.yml                    — all 7 services
- tests/qa_automation.spec.ts           — Playwright QA tests
- CLAUDE.md                             — this file (auto-loaded)
- FINSTACK_MASTER_INDEX.md              — phase status tracker

## PHASE STATUS (source of truth — keep in sync with FINSTACK_MASTER_INDEX.md)
- [DONE]  P0:  Infrastructure — Docker up (7/7 healthy), schemas applied,
          RLS test passed (per-tenant isolation + fail-closed verified),
          seed+embed done (2 tenants), Ollama qwen2.5:1.5b-instruct-q4_K_M
          pulled, zerotoken-check CLEAN, Playwright S1 3/3
- [DONE]  P1:  Backend APIs — JWT auth (auth_lookup_user SECURITY DEFINER
          + Bearer JWT / x-tenant-id dual actor resolution), candidates,
          requisitions (+pipeline kanban view), applications (stage
          transitions), offers (draft->pending_approval->approved->issued
          ->accepted/declined, HITL-gated approve/issue), assignments
          (+HITL reassign), consent_records, interview_scorecards (new
          table + RLS). zerotoken-check CLEAN (regex false-positive on
          "Capgemini" fixed), Playwright S1+S4 5/5
- [DONE]  P2:  n8n Workflows — `n8n/` (build_workflows.py generator +
          credentials/ + workflows/), `sql/03_phase2_n8n_additions.sql`
          (notifications, job_board_postings, find_stalled_assignments,
          find_sla_breaches). W1 generic event_outbox dispatcher + W2-W5
          per-event notifications (candidate/requisition/stage-change/
          offer lifecycle), W6 HITL approval reminder (NEVER
          auto-approves), W7 stalled-assignment + W8 SLA-breach monitors
          (flag-only, NEVER auto-reassign), W9 job-board distribution
          queue (naukri/indeed/linkedin, queued rows only, zero-token
          scaffold). All 9 active in n8n, verified end-to-end against
          live data (acme: 17 notifications from W1-W5, 18
          job_board_postings from W9). zerotoken-check CLEAN, Playwright
          S1+S4 5/5 (regression)
- [DONE]  P3:  AI Engine — `sql/04_phase3_ai_engine.sql`: match_candidates
          (T1 pgvector cosine + skill overlap -> fit_score 0-100),
          match_recruiters (T1 skill-history + spare capacity ->
          match_score 0-100), assign_with_explanation (T0/T1 auto-assign,
          NOT HITL-gated — only "reassigned" is HARD RULE #10), do_reassign
          (canonical reassign primitive, auto-picks alternative recruiter),
          plus 4 views (v_redeployment_queue, v_agency_funnel,
          v_recruiter_capacity, v_skill_gap) all WITH (security_invoker =
          true) for RLS-safe app_user access. `backend/ai_router.py` —
          Tier2-lite cascade: BGE-small embed -> ai_cache cosine-similarity
          lookup (>0.95, HARD RULE #4) -> Ollama Qwen2.5 on miss -> cache
          store, never an external API (HARD RULE #1). New endpoints:
          GET/POST /requisitions/{id}/match-candidates,
          /match-recruiters, /assign; POST /jd/generate
          (backend/routers/ai.py); GET /analytics/{redeployment-queue,
          agency-funnel,recruiter-capacity,skill-gap}
          (backend/routers/analytics.py). Verified live: fit_score/
          match_score in range, cross-tenant req_id -> 404 (RLS
          fail-closed), JD cache hit on 2nd identical call (similarity
          1.0, ~9.7s -> ~30ms). zerotoken-check CLEAN, Playwright S1+S2+S4
          10/10
- [DONE]  P4:  Frontend Foundation — Next.js 14 app-router shell: 5-template
          theme system (data-theme + Zustand persist + Tailwind addVariant
          plugin; templates: enterprise/modern/minimal/ai-command/mobile-first),
          CORSMiddleware on FastAPI backend, TenantProvider (JWT read from
          localStorage, redirect-to-login guard), ThemeProvider (sets
          data-theme on <html>), Sidebar (6 nav items, collapse toggle),
          Topbar (user info + logout), CommandPalette (Ctrl+K, Radix Dialog,
          waitForSelector hydration fix in Playwright), login page
          (POST /auth/login -> JWT -> router.replace('/dashboard')),
          stub pages for all 6 routes, shared UI: Button (CVA variants),
          Card, Modal (Radix Dialog), Spinner, Table, ThemeSwitcher.
          zerotoken-check CLEAN, Playwright S1+S2+S3+S4 18/18
- [DONE]  P5:  UI T1 — Recruiter Command Center (app/dashboard/page.tsx): 4 KPI
          stat cards (Open Reqs, Active Candidates, Placements, Ending in 21
          Days), Redeployment Queue table (v_redeployment_queue), Recruiter
          Capacity bars (v_recruiter_capacity, color: green/amber/red by pct),
          Agency Funnel table (v_agency_funnel), useFetch hook (lib/useFetch.ts,
          Bearer JWT, cancel-on-unmount). zerotoken-check CLEAN, Playwright
          S1+S2+S3+S4+S5 21/21
- [DONE]  P6:  UI T2 — Kanban Pipeline Board: pipeline list page (all reqs as
          clickable cards), kanban board ([req_id] route, 7 columns:
          sourced/screened/submitted/interview/offer/placed/rejected, color-coded
          top border), application cards (candidate name, exp, skill chips, prev/
          next stage buttons → PATCH /applications/{id}/stage), Match Candidates
          panel (Ctrl, Radix open state, loads GET match-candidates, shows
          fit_score + skills; skill_overlap is int not array — use skills[]).
          useFetch refetch + apiFetch util in lib/useFetch.ts. zerotoken-check
          CLEAN, Playwright S1-S6 24/24
- [DONE]  P7:  UI T3 — Candidate 360 View: candidates list (search by q=,
          initials avatar, skills chips, exp, location); [id] 360 page with 5
          tabs (Profile/Applications/Scorecards/Assessment/Video). Profile: 3
          cards (contact, skills, resume extract). Applications: table via
          GET /candidates/{id}/applications (req title links to kanban).
          Scorecards: star ratings. Assessment: rule-based MCQ per skill (3
          hardcoded + fallback, no LLM — ZERO-TOKEN). Video: scaffold (no
          external service). zerotoken-check CLEAN, Playwright S1-S7 28/28
- [DONE]  P8:  UI T4 — Analytics BI Dashboard: recharts BarCharts (agency funnel,
          recruiter utilization, skill demand vs supply), KPI cards (placement
          rate, skill gaps, redeployment risk, avg utilization), rule-based
          Hiring Difficulty Forecast table (gap/demand ratio → % hard, zero-token),
          Redeployment Risk Alert (≤14 days). Fix: data-testid on div wrapper not
          ResponsiveContainer (recharts doesn't forward attrs). zerotoken-check
          CLEAN, Playwright S1-S8 32/32
- [DONE]  P9:  UI T5 — CEO War Room (app/command-center/page.tsx): 4 hero KPI
          cards (Total Placements, Fill Rate, Avg Utilization, Skill Gaps),
          Capacity vs Demand model (headroom = capacity−active vs open reqs →
          critical/warning/healthy badge), Retention Risk model (redeployment
          queue with critical/warning/watch tiering ≤7d/≤14d/≤21d), Top Clients
          table, Skill Shortage gap bars. All rule-based, zero-token. 35/35
- [DONE]  P10: UI T6 — Finance ERP Dashboard (app/finance/page.tsx): 4 KPI
          cards (Active Contractors, Monthly Bill INR, Gross Margin %, Ending
          Soon), Contractor Billing Grid (bill_rate/pay_rate/margin per placement,
          status badges, Indian INR formatting), 4 tabs: Contractors (live data
          via GET /analytics/active-placements, new endpoint added to
          analytics.py), Timesheets/Invoices/Payroll (P12 stubs with feature
          descriptions). zerotoken-check CLEAN, Playwright S1-S10 28/28
- [NEXT] P11: WhatsApp — WAHA integration + consent-gated outreach
- [ ]     P12: ERP — Timesheet + Payroll + Billing endpoints (pgcrypto for
          Aadhaar/PAN/PF/bank-account — HARD RULE #11)
- [ ]     P13: BGV — Trust Intelligence + India verification APIs
- [ ]     P14: VPS Deploy — domain + SSL + production

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
- n8n Code node sees `undefined` fields from a `SET
  app.tenant_id; SELECT ...` Postgres node → the node's output
  includes a phantom 1-column `{set_config: "<uuid>"}` item from
  statement 1; every P2 Code node starts with the GUARD check (see
  n8n/build_workflows.py) that skips this item with `SELECT 1;`. Keep
  this guard on any NEW multi-statement Postgres→Code node pair.
- n8n workflow edited → regenerate with `python3 n8n/build_workflows.py`,
  `docker compose cp n8n/workflows n8n:/tmp/wf` (clear /tmp/wf first),
  `docker compose exec -T n8n n8n import:workflow --separate
  --input=/tmp/wf`, then `n8n update:workflow --id=<id> --active=true`
  per workflow (deprecated but works), then `docker compose restart
  n8n`. To debug executions, query
  `/home/node/.n8n/database.sqlite` (`execution_entity` +
  `execution_data`) via Node's built-in `node:sqlite` (`new
  DatabaseSync(path, {readOnly:true})`) — n8n's bundled
  better-sqlite3 path varies by version and the REST API + `n8n
  execute` CLI don't work against a running single-main instance.
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
