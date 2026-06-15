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

## HARD RULES — ZERO TOLERANCE
1. NEVER call OpenAI/Anthropic/Gemini or any external LLM API
2. NEVER connect to DB as postgres superuser (bypasses RLS)
3. ALWAYS vector(384) for all embeddings (BGE-small only)
4. ALWAYS make Ollama calls async + cache in ai_cache table
5. ALWAYS write event_outbox in SAME DB transaction as business change
6. ALWAYS set dedup_key on every event_outbox row
7. WhatsApp ALWAYS requires consent record first (India DPDP 2023)
8. ALL n8n PostgreSQL nodes MUST SET app.tenant_id first
9. ALWAYS connect as app_user (password: apppw) NEVER postgres

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
- [NEXT] P0:  Infrastructure — Docker up, schemas applied, RLS test passed, seed+embed done
- [ ]     P1:  Backend APIs — all FastAPI endpoints for candidates/reqs/pipeline/offers
- [ ]     P2:  n8n Workflows — W1-W8 automation workflows built and activated
- [ ]     P3:  AI Engine — match, assign, rediscovery endpoints wired
- [ ]     P4:  Frontend Foundation — GlobalNav, TenantProvider, shared components
- [ ]     P5:  UI T1 — Recruiter Command Center (app/dashboard/page.tsx)
- [ ]     P6:  UI T2 — Kanban Pipeline Board (app/pipeline/[req_id]/page.tsx)
- [ ]     P7:  UI T3 — Candidate 360 View (app/candidates/[id]/page.tsx)
- [ ]     P8:  UI T4 — Analytics BI Dashboard (app/analytics/page.tsx)
- [ ]     P9:  UI T5 — CEO War Room (app/command-center/page.tsx)
- [ ]     P10: UI T6 — Finance ERP Dashboard (app/finance/page.tsx)
- [ ]     P11: WhatsApp — WAHA integration + consent-gated outreach
- [ ]     P12: ERP — Timesheet + Payroll + Billing endpoints
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
key) inside tmux session `dev` on this VPS — that login persists.
- scripts/status-check.sh    — phase status + tmux/docker snapshot
- scripts/claude-auto-resume.sh — monitor-only: watch the `dev` tmux
  pane for rate-limit messages and auto-send "continue" after reset;
  run it from a SEPARATE tmux window/session, never inside `dev`
  itself (it does not kill or recreate `dev`)
Do NOT use the systemd + ANTHROPIC_API_KEY installer pattern from the
original blueprint (install-24x7.sh) — that's a different (paid API
key) auth path and is unnecessary given the existing OAuth login.
