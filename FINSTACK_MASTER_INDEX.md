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
| P0 | Infrastructure (Docker + DB + schemas + RLS) | ✅ DONE | 3/3 (S1 API Health) | docker-compose.yml: 7 services (db, embed, ollama, backend, frontend, n8n, waha) on `finstack` bridge net, all up/healthy (~2.5GB/7.8GB RAM used). sql/00_app_role.sql + 01_phase1_schema.sql + 10_phase1_staffing_additions.sql applied via docker-entrypoint-initdb.d — 16 tenant tables w/ FORCE RLS (core 9 + ai_jobs, ai_cache+hnsw cosine idx, audit_log monthly-partitioned, assignment_event, consent_records, hotlist, submittals, placements) + hnsw idx on candidates.resume_embedding / requisitions.jd_embedding. seed_data.py seeded 2 tenants (acme=a92d7fd7-fb72-47d8-881e-2493c61717ce, beta=539f4aea-646e-4816-a2f6-b476fed0bc51): acme=4 users/11 candidates/6 reqs/11 apps incl. 1 pending_approval offer (HITL demo) + 1 active placement + 2 hotlist entries; beta=1 user/2 candidates/1 req/2 apps. embed_writer.py filled 384-dim BGE-small embeddings (13 candidates, 7 reqs total). Ollama qwen2.5:1.5b-instruct-q4_K_M pulled (986MB). RLS verified: per-tenant counts correct, 0 cross-tenant leakage, unset app.tenant_id fails closed (uuid cast ERROR, not empty result). zerotoken-check.sh: CONFIRMED CLEAN. Playwright S1 (backend /health, embed 384-dim, Ollama model loaded): 3/3 passed. |
| P1 | Foundation APIs (candidate, req, pipeline, offer) | ✅ DONE | 5/5 (S1+S4) | `sql/02_phase1_p1_additions.sql`: `interview_scorecards` table (+RLS) and `auth_lookup_user(email)` SECURITY DEFINER fn (owned by postgres, bypasses RLS for login-time tenant resolution). `backend/auth.py`+`deps.py`: JWT (tenant_id+role+user_id claims) via `/auth/login`+`/auth/me`; `get_actor` dual-resolves from `Authorization: Bearer` (JWT) or `x-tenant-id` header (anonymous, role=None); `require_role(...)` rejects anonymous actors. Routers: candidates (CRUD+filters, consent_records+event_outbox on create), requisitions (CRUD+`/pipeline` kanban-grouped view), applications (`/stage` transitions, `rejected` HITL-gated to admin/manager + assignment_event/audit_log), offers (draft→pending_approval→approved→issued→accepted/declined; approve+issue HITL-gated to admin/manager, write assignment_event+audit_log, issue also writes event_outbox `offer.issued`), assignments (+`/reassign` HITL-gated to admin/manager, old→reassigned + new active assignment, assignment_event+audit_log), consent-records (GET/POST), interview-scorecards (GET/POST). All curl-smoke-tested end to end against acme tenant. zerotoken-check.sh CLEAN (fixed `gemini`→`\bgemini\b` false-positive on "Capgemini"). Playwright S1 (3/3) + S4 (2/2) = 5/5. |
| P2 | Automation (n8n workflows W1-W9) | ✅ DONE | 5/5 (S1+S4, regression) | `sql/03_phase2_n8n_additions.sql`: `notifications` + `job_board_postings` tables (+RLS), `find_stalled_assignments(hours)` + `find_sla_breaches()` fns. `n8n/build_workflows.py` generates all 9 workflows into `n8n/workflows/`; `n8n/credentials/postgres_app_user.json` (app_user/apppw, HARD RULE #9). W1 = generic event_outbox dispatcher (catch-all for event_types not claimed by W2-W5) → admin notification. W2 candidate.created → recruiter. W3 requisition.created → manager. W4 application.stage_changed → assigned recruiter (fallback manager). W5 offer.created/issued/accepted/declined → manager (created) or assigned recruiter (others). W6 HITL approval reminder (offers pending_approval >4h → manager, dedup via NOT EXISTS on notifications, NEVER auto-approves — HARD RULE #10). W7 stalled-assignment monitor (`find_stalled_assignments(72)` → manager, flag-only, NEVER auto-reassigns). W8 SLA-breach monitor (`find_sla_breaches()` → manager). W9 job-board distribution queue (open reqs → `job_board_postings` rows for naukri/indeed/linkedin, status='queued', ON CONFLICT DO NOTHING — zero-token scaffold, no external API calls). Every Postgres node runs `SELECT set_config('app.tenant_id','<uuid>', false); SELECT ...;` (HARD RULE #8); every downstream Code node starts with a GUARD that skips the resulting phantom `{set_config: "<uuid>"}` item (see Architecture Rules). All 9 imported + activated via n8n 2.25.7 CLI (`import:workflow --separate` + `update:workflow --active=true` + restart) and verified end-to-end against live acme-tenant data: W1-W5 processed all 17 pending event_outbox rows into 17 notifications (13 candidate.created, 2 stage_changed, 2 offer.*) with 0 errors; W6-W8 ran clean (0 flags — no stale offers/stalled assignments/SLA breaches in current seed data, confirmed via temporary short-interval test run); W9 queued 18 job_board_postings rows (6 open reqs × 3 boards) idempotently. zerotoken-check.sh CLEAN (53 files). Playwright S1+S4 5/5 (regression, no P0/P1 breakage). |
| P3 | AI Engine (match, assign, rediscovery) | ✅ DONE | 10/10 (S1+S2+S4) | `sql/04_phase3_ai_engine.sql`: `match_candidates(req_id,limit)` (T1, SECURITY INVOKER SQL fn — `0.6 * cosine_sim(resume_embedding,jd_embedding) + 0.4 * skill_overlap_ratio`, returns `fit_score` 0-100), `match_recruiters(req_id,limit)` (T1 — `0.4 * historical_skill_overlap_ratio + 0.6 * spare_capacity_ratio`, returns `match_score` 0-100; cold-start recruiters with no assignment history still rank via capacity), `assign_with_explanation(req_id)` (T0/T1 plpgsql — returns existing active assignment as-is if one exists (`newly_created=false`), else picks top match_recruiters(req_id,1), INSERTs assignments+assignment_event('assigned')+event_outbox('assignment.created', dedup_key set, picked up by P2's W1 catch-all dispatcher); requires status IN ('open','on_hold'); NOT HITL-gated — HARD RULE #10 only covers "reassigned"), `do_reassign(assignment_id,reason,new_recruiter_id DEFAULT NULL)` (canonical reassign primitive — marks old 'reassigned', creates new 'active', writes assignment_event('reassigned')+event_outbox('assignment.reassigned'); auto-picks an alternative recruiter via match_recruiters excluding the current one if new_recruiter_id omitted; the existing HITL-gated `POST /assignments/{id}/reassign` endpoint, admin/manager only, remains the HARD RULE #10 enforcement point and was NOT refactored to call this — left as-is to avoid regression risk on tested code, but they're semantically equivalent). 4 views `v_redeployment_queue` (placements ending within 21 days), `v_agency_funnel` (applications→submittals→offers→placements per client), `v_recruiter_capacity` (active assignments vs capacity_weekly, utilization_pct), `v_skill_gap` (open-req skills_required demand vs candidates.skills supply, FULL OUTER JOIN on unnest, gap=demand-supply) — all `WITH (security_invoker = true)` (see Architecture Rules). `backend/ai_router.py`: `embed_text()` (BGE-small via embed service, asserts 384-dim — HARD RULE #3), `cache_lookup()`/`cache_store()` (ai_cache.prompt_embedding, `1 - (a <=> b) >= 0.95` cosine threshold — HARD RULE #4), `call_ollama()` (local Qwen2.5 only — HARD RULE #1), `generate()` orchestrates cache-first-then-Ollama. New endpoints: `GET/POST /requisitions/{id}/match-candidates`, `/match-recruiters`, `/assign` (backend/routers/requisitions.py — RaiseError from the plpgsql fns mapped to 404 "not found"/409 otherwise); `POST /jd/generate` (backend/routers/ai.py, builds a prompt from JDGenerateRequest, returns `{jd_text,cached,similarity}`); `GET /analytics/{redeployment-queue,agency-funnel,recruiter-capacity,skill-gap}` (backend/routers/analytics.py). Verified live against acme seed data: match_candidates top hit Aarav Sharma fit_score=91.25 (cosine 0.8542, 4/4 skill overlap) for "Senior Python Backend Engineer"; match_recruiters Rahul Verma match_score=97.0; assign_with_explanation on an already-assigned req returned `newly_created:false, reason:existing_active_assignment`, and (in a rolled-back txn) on a freed-up req returned `newly_created:true` + full explanation + an event_outbox row; do_reassign (rolled back) correctly reassigned + wrote assignment_event; cross-tenant req_id → HTTP 404 (RLS fail-closed, confirmed both via direct SQL as app_user and via the API); `/jd/generate` first call ~9.7s (cold Ollama call, cached:false), second identical call ~30ms (cached:true, similarity=1.0, ai_cache row hit_count incremented, vector_dims=384). zerotoken-check CLEAN (66 files). Playwright S1 (3/3) + S2 (5/5: match_candidates, match_recruiters, assign-with-explanation, JD cache, analytics arrays) + S4 (2/2) = 10/10. AI eval golden-dataset/agent-replay framework and the ai_jobs async worker were NOT built in this phase — ai_jobs/ai_cache schema exists (P0) and ai_cache is exercised synchronously by ai_router.generate(); a dedicated polling worker for bulk/background Tier-2 jobs is deferred to a later phase if a concrete bulk use case emerges (none of P3's endpoints need it — JD generation is fast enough synchronously on CPU). Skills-assessment MCQ/coding-test rule-based scoring (Competitor Benchmark gap) also deferred — bundled with its P7 UI tab. |
| P4 | Frontend Foundation (GlobalNav + shared components + 5-template theme system) | ✅ DONE | 18/18 (S1+S2+S3+S4) | 5-template theme system: `data-theme` attribute on `<html>` set by ThemeProvider; Zustand `useUIStore` with localStorage persist (partialize: theme only); Tailwind `addVariant` plugin for `theme-modern:`/`theme-minimal:`/`theme-ai-command:`/`theme-mobile-first:` variants; CSS custom properties for 5 palettes (enterprise navy, modern indigo, minimal dark, ai-command purple, mobile-first teal). CORSMiddleware added to FastAPI backend (`allow_origins: [localhost:3001, localhost:3000]`) — required for browser fetch from Next.js to backend across ports. Auth: `lib/auth.ts` (getToken/setToken/clearToken, decodeToken, login POST /auth/login, authHeaders); TenantProvider reads JWT from localStorage, redirects to /login if missing. Layout: Sidebar (6 nav items Dashboard/Pipeline/Candidates/Requisitions/Analytics/Finance, bg primary, collapse toggle), Topbar (user fullName/role, logout), CommandPalette (Ctrl+K keydown listener on `document`, Radix Dialog.Root → Portal → Content with role="dialog" auto). Login page: `input[name="email"]`/`input[name="password"]`/`button[type="submit"]` — Playwright waits for /dashboard URL after submit. 6 stub route pages under `(dashboard)` route group. Shared UI: Button (CVA variants), Card/CardHeader/CardContent, Modal (Radix Dialog), Spinner, Table/Thead/Th/Tbody/Tr/Td, ThemeSwitcher (5 `data-theme-option` swatches). Key fix: S3 Cmd+K Playwright test needed `waitForSelector('nav')` before `keyboard.press('Control+k')` because `useEffect` keydown listener attaches after hydration completes, and the page.goto() 'load' event fires slightly before that. zerotoken-check CLEAN (70 files). Playwright S1 (3/3) + S2 (5/5) + S3 (8/8 incl. login, 6 pages, sidebar nav, Cmd+K) + S4 (2/2) = 18/18. |
| P5 | UI T1: Recruiter Command Center | ✅ DONE | 21/21 (S1+S2+S3+S4+S5) | `app/(dashboard)/dashboard/page.tsx`: live data dashboard with 4 KPI stat cards (Open Requisitions, Active Candidates, Placements, Ending in 21 Days). Redeployment Queue table from `v_redeployment_queue` (shows contractors with `days_remaining ≤ 21` — 1 in seed: Nikhil Joshi ending 2026-07-06). Recruiter Capacity bars from `v_recruiter_capacity` (3 recruiters; capacity bars colored green/amber/red by `utilization_pct`; column is `full_name` not `recruiter_name` — matched to actual view schema). Agency Funnel table from `v_agency_funnel` (submittals/offers/placements per client). `lib/useFetch.ts`: generic `useFetch<T>(path)` hook with Bearer JWT `authHeaders()`, cancel-on-unmount cleanup flag, `loading`/`data`/`error` state. S5 Playwright suite: stat-cards numeric values appear, redeployment queue renders (data or empty state), capacity bars visible. Column name cross-check: `v_recruiter_capacity.full_name` (not `recruiter_name`), `v_redeployment_queue.end_date` (not `placement_end_date`). zerotoken-check CLEAN (93 files). 21/21 Playwright. |
| P6 | UI T2: Kanban Pipeline Board | ✅ DONE | 24/24 (S1-S6) | Pipeline list page (`app/(dashboard)/pipeline/page.tsx`): all requisitions as link cards with status badge, location, skill chips. Kanban board (`app/(dashboard)/pipeline/[req_id]/page.tsx`): 7 stage columns (sourced/screened/submitted/interview/offer/placed/rejected), each with a color-coded top border (`data-stage` attribute for Playwright targeting), application cards showing candidate name/exp/skills, prev←/next→ stage buttons that call `PATCH /applications/{id}/stage`. Match Candidates panel: click "Match Candidates" button → `matchOpen=true` → `apiFetch(/requisitions/{id}/match-candidates?limit=5)` → shows `data-testid="match-cards"` with fit_score + skill count; panel always renders even on error (fixed `matchError` rendering to not gate the `match-cards` container). Key data shape fix: `skill_overlap` returned as `int` (count) not `string[]`; changed render to show "N skills matched" and display `skills[]` for chip list. `lib/useFetch.ts` extended with `refetch()` callback (tick state) + `apiFetch()` utility (Bearer JWT, Content-Type). zerotoken-check CLEAN (94 files). Playwright S1+S2+S3+S4+S5+S6 24/24. |
| P7 | UI T3: Candidate 360 View | ✅ DONE | 28/28 (S1-S7) | Candidates list (`app/(dashboard)/candidates/page.tsx`): search via `?q=` param, initials avatar, skill chips, exp, location, linked to 360 view. Candidate 360 (`app/(dashboard)/candidates/[id]/page.tsx`): 5-tab layout (Profile / Applications / Scorecards / Assessment / Video) with `data-tab` attributes for Playwright. Profile: contact card (email/phone/location/employer), skills cloud, resume text extract. Applications tab: `GET /candidates/{id}/applications` (added in P1's candidates.py) — stage badge with color, fit_score, link to kanban board. Scorecards tab: `GET /interview-scorecards` (tenant-scoped list — no candidate filter endpoint exists; future improvement). Assessment tab: rule-based MCQ per skill (3 hardcoded Python/SQL/Java + generic fallback), client-side correct/incorrect scoring — zero-token (no LLM). Video tab: scaffold UI (no external video service wired yet). Key: all fetches lazy by tab switch to avoid over-fetching on load. zerotoken-check CLEAN (95 files). Playwright S1-S7 28/28. |
| P8 | UI T4: Analytics BI Dashboard | ✅ DONE | 32/32 (S1-S8) | `app/(dashboard)/analytics/page.tsx`: 4 KPI stat cards (Placement Rate, Skill Gaps, Redeployment Risk, Avg Utilization) from live API data. 3 recharts `BarChart`s: Agency Funnel by client (submittals/offers/placements — 3 bars), Recruiter Utilization (utilization_pct with green/amber/red `Cell` fill by threshold), Skill Demand vs Supply (demand_count vs supply_count per skill, top 10). Rule-based Hiring Difficulty Forecast: `gap / demand * 100 → difficulty%` with red/amber badge (named predictive model, zero-token — no LLM). Redeployment Risk Alert: contractors ending ≤14 days shown with day-count badge (red ≤7, amber ≤14). Key fix: recharts `ResponsiveContainer` does not forward `data-testid` to DOM — must wrap in a plain `<div data-testid="...">` instead of putting attribute on the component. zerotoken-check CLEAN (96 files). Playwright S1-S8 32/32. |
| P9 | UI T5: CEO War Room | ✅ DONE | 35/35 (S1-S9) | `app/(dashboard)/command-center/page.tsx`: executive dashboard with 4 hero KPI cards (Total Placements, Fill Rate = placements/submittals%, Avg Recruiter Utilization, Skill Gaps count). Named predictive models — all rule-based, zero-token: (1) **Capacity vs Demand**: headroom = sum(capacity_weekly) − sum(active_assignments) vs open-req count → Critical (open_reqs > headroom) / Warning (open_reqs > 70% headroom) / Healthy with color badge; (2) **Retention Risk**: redeployment queue tiered as Critical (≤7d), Warning (8–14d), Watch (15–21d) with colored badges. Also: Top Clients by Placements table (sorted by placements_count desc, top 4), Skill Shortage gap bars (top 5 by gap, gap/demand% → red fill bar). zerotoken-check CLEAN (96 files). Playwright S1-S9 35/35. |
| P10 | UI T6: Finance ERP Dashboard | ✅ DONE | 28/28 (S1-S10) | `app/(dashboard)/finance/page.tsx` + `GET /analytics/active-placements` (new endpoint in `backend/routers/analytics.py`). 4 KPI cards: Active Contractors, Monthly Bill (INR, Intl.NumberFormat), Gross Margin + %, Ending Soon count. Contractor Billing Grid: full placements table with candidate/client/role/dates/bill_rate/pay_rate/margin (color-coded green if positive)/status badges. 4 tabs via `data-tab` attributes: Contractors (live from placements table, RLS-safe), Timesheets/Invoices/Payroll (P12 stubs with feature description cards). INR formatting via `Intl.NumberFormat('en-IN', {currency:'INR'})`. zerotoken-check CLEAN (96 files). Playwright S1-S10 28/28. |
| P11 | WhatsApp + WAHA integration | ✅ DONE | 34/34 (S1-S11) | `backend/routers/whatsapp.py`: session management (`/whatsapp/session/start`, `/session/status`, `/session/qr`), template-based message send (`/whatsapp/send`), bulk send (`/whatsapp/bulk-send`), template listing (`/whatsapp/templates`). HARD RULE #7/#12 consent gate: every send checks `consent_records WHERE channel='whatsapp' AND consent_given=true` and returns 403 with DPDP explanation if missing. 14-language templates (en/hi/ta/te/kn/ml/mr/gu/pa/bn/or/as/ur/kok) for 4 message types (job_opportunity, interview_invitation, offer_letter, status_update) — zero-token, rule-based plain-text lookup. WAHA client via `httpx.AsyncClient`, WAHA session API key auto-discovered from WAHA logs, stored in `.env`/docker-compose env. `frontend/app/(dashboard)/whatsapp/page.tsx`: 4 tabs — Session (QR scanner, connect/disconnect), Outreach (form with consented-only candidates, template+lang selectors, send button), Templates (14-lang grid), Consent Log (DPDP audit table). Sidebar updated with WhatsApp nav item. Verified: consent gate blocks unconsented sends (403), templates API returns 4×14=56 localized messages. zerotoken-check CLEAN (96 files). Playwright S1-S11 34/34. |
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
- [P0] JSONB params via asyncpg must be `json.dumps(...)`'d — passing a raw
  dict raises `TypeError: expected str, got dict`
- [P0] `set_config('app.tenant_id', $1, is_local)`: use `false` (session-level)
  for sequential scripts (seed_data.py/embed_writer.py) running multiple
  statements outside an explicit transaction; use `true` (LOCAL) only when
  every statement is wrapped in `conn.transaction()` — this is what
  `backend/db.py`'s `tenant_conn()` does for pooled per-request connections
- [P0] This VPS shell session needs `sg docker -c "..."` for every
  docker/docker-compose daemon command (see memory: project-docker-group-permission)
- [P0] zerotoken-check.sh regex fixed: bare `gemini` matched the substring
  in "Capgemini" (a real employer name in seed_data.py demo data, unrelated
  to Google Gemini) — changed to `\bgemini\b`. False positive, not a real
  violation.
- [P1] Actor/tenant resolution is dual-mode (`backend/deps.py`):
  `Authorization: Bearer <jwt>` (claims: tenant_id+role+user_id, from
  `/auth/login` via `auth_lookup_user`) is the primary path and is required
  for any `require_role(...)`-gated endpoint; `x-tenant-id: <uuid>` header
  is an anonymous tenant-scoped fallback (role=None, user_id=None) for
  reads/basic-creates and the existing Playwright S2/S4 suite. RLS is the
  backstop either way — an unknown/garbage tenant id fails closed.
- [P1] `auth_lookup_user(p_email)` is SECURITY DEFINER + owned by postgres
  (superuser bypasses RLS even with FORCE) so login can resolve tenant_id
  before app.tenant_id is set (see NOTE in 01_phase1_schema.sql). New P1+
  SQL files that need a similar pre-tenant lookup should follow this same
  pattern, applied as postgres so ALTER DEFAULT PRIVILEGES from
  00_app_role.sql auto-grants EXECUTE to app_user.
- [P1] asyncpg returns JSONB columns (e.g. `interview_scorecards.scores`)
  as raw JSON strings (no codec registered) — P4+ frontend must
  `JSON.parse()` these fields rather than treating them as objects.
- [P2] n8n Postgres node, multi-statement RLS pattern: every tenant-scoped
  query is built as ONE node-postgres "simple query protocol" string:
  `SELECT set_config('app.tenant_id','<uuid>', false); SELECT ...;`
  (no `$N` placeholder params — they're incompatible with multi-statement
  simple-protocol execution). The node concatenates ALL result sets into its output
  items, so item #1 for each tenant is always the 1-row/1-column
  `{set_config: "<uuid>"}` result of statement 1, NOT a data row.
- [P2] GUARD pattern: every Code node downstream of a "set_config;
  SELECT" Postgres node MUST start with
  `const row = $input.item.json; if (Object.prototype.hasOwnProperty.call(row,
  'set_config')) { return { json: { sql: 'SELECT 1;' } }; }` (see
  `GUARD` const in `n8n/build_workflows.py`) — otherwise the phantom
  item produces `undefined` fields and the downstream write fails with
  e.g. `invalid input syntax for type uuid: "undefined"`. This bug
  silently broke W1-W5 on first activation (0 notifications written,
  no log errors at default level) until found via n8n's internal
  execution_entity/execution_data tables.
- [P2] Free-text values (candidate names, job titles, reasons) going
  into multi-statement SQL strings are escaped with a local
  `esc = (s) => String(s).replace(/'/g, "''")` helper in the Code
  node — there is no parameterization available in this pattern.
- [P2] event_type ownership: each `event_outbox.event_type` is claimed
  by exactly ONE workflow for setting `processed_at` (W2-W5 claim
  candidate.created/requisition.created/application.stage_changed/
  offer.*; W1 is the catch-all for everything else). W9 does NOT use
  event_outbox at all — it queries `requisitions`/`job_board_postings`
  directly, avoiding any ownership conflict.
- [P2] n8n 2.25.7 CLI activation procedure for this single-main
  deployment (no queue/multi-main mode, so `--activeState=fromJson`
  and the REST API's session auth both fail):
  `docker compose cp n8n/workflows n8n:/tmp/wf` (rm -rf /tmp/wf first
  if re-running, since `cp` merges into an existing dir and
  `import:workflow --input=<dir>` is non-recursive — stale top-level
  files get re-imported) → `n8n import:workflow --separate
  --input=/tmp/wf` → `n8n update:workflow --id=<id> --active=true` per
  workflow (prints a deprecation warning but works) → `docker compose
  restart n8n`. Confirm via `docker compose logs n8n | grep Activated`.
- [P2] Debugging n8n executions: `n8n execute --id=X` conflicts with
  the running instance (Task Broker port 5679 already bound) and the
  `/rest/workflows/:id` API returns 401 even with basic auth (session-
  based auth in 2.x). Instead, query n8n's internal SQLite directly
  with Node's built-in `node:sqlite` (Node 22+, no native module path
  issues): `new (require('node:sqlite').DatabaseSync)('/home/node/.n8n/database.sqlite',
  {readOnly:true})`, then `SELECT id, workflowId, status, startedAt,
  finished FROM execution_entity ...` for pass/fail, and `SELECT data
  FROM execution_data WHERE executionId=<id>` for the full error
  message/stack (data is a JSON-serialized array with reference
  indices, the error message is a plain substring near the end).
- [P3] pgvector `<=>` returns `double precision`, not `numeric` —
  `ROUND(double precision, integer)` does not exist in Postgres.
  Any expression mixing a `<=>`-derived value with `ROUND(..., N)`
  needs an explicit `::numeric` cast on the embedding term (e.g.
  `GREATEST(COALESCE(1 - (a <=> b), 0), 0)::numeric`). Caught at
  apply-time for `match_candidates`'s `fit_score` column.
- [P3] `CREATE VIEW ... WITH (security_invoker = true)` (PG15+, this
  stack is PG16) is REQUIRED for any view on FORCE-RLS tables that
  app_user will query. Without it, a view created by `postgres`
  (BYPASSRLS) defaults to executing its underlying query with the
  view OWNER's privileges, which would bypass RLS entirely and leak
  all tenants' rows to app_user through the view. All 4 P3 views use
  this option. SECURITY INVOKER SQL/plpgsql functions (the existing
  pattern from P2's find_stalled_assignments/find_sla_breaches and
  all of P3's new functions) do not have this problem — they already
  run as the calling role by default.
- [P3] RLS fail-closed via SECURITY INVOKER + `SELECT ... WHERE id =
  p_id; IF NOT FOUND THEN RAISE EXCEPTION ...` is the pattern for
  "not found vs. wrong tenant" — both produce the same `RAISE
  EXCEPTION 'X not found or not accessible'`, mapped to HTTP 404 by
  the calling endpoint (`backend/routers/requisitions.py`'s `/assign`
  catches `asyncpg.exceptions.RaiseError`, 404 if "not found" in the
  message else 409). Verified: a cross-tenant `requisition_id` passed
  to `/requisitions/{id}/assign` returns HTTP 404, both via direct
  `match_candidates()` call as app_user (0 rows) and via the live API.
- [P3] asyncpg has no jsonb codec registered (same as the P1 note on
  `interview_scorecards.scores`) — `assign_with_explanation`'s/
  `do_reassign`'s `explanation jsonb` column comes back as a raw JSON
  string; `backend/routers/requisitions.py`'s `/assign` endpoint does
  a local `json.loads(result["explanation"])` before returning. A
  global jsonb decoder codec on the pool was considered and rejected:
  P1/P2 code already passes `json.dumps(...)` (a `str`) for jsonb
  INSERT params relying on asyncpg's default str-passthrough codec;
  registering a custom decoder/encoder pair would double-encode those
  existing writes. Decode jsonb results locally per-endpoint instead.
- [P3] `backend/ai_router.py` is the single Tier2-lite entry point
  (HARD RULES #1/#3/#4): `embed_text()` asserts the embed service
  returns exactly 384 floats; `cache_lookup()` does `1 - (prompt_embedding
  <=> $1::vector) AS similarity ... ORDER BY prompt_embedding <=> $1::vector
  LIMIT 1` and only counts it a hit if `similarity >= 0.95`, then bumps
  `hit_count`/`last_hit_at`; on a miss, `call_ollama()` hits
  `OLLAMA_URL/api/generate` (`stream:false`) and `cache_store()` writes
  the new `ai_cache` row. Vector params are passed as asyncpg `str`
  with `::vector` cast using the same `[x.xxxxxxxx,...]` literal format
  as `backend/embed_writer.py`'s `to_vector_literal()`. `/jd/generate`
  (backend/routers/ai.py) is synchronous (not via the `ai_jobs` queue)
  — on CPU, a single JD generation with qwen2.5:1.5b-instruct-q4_K_M
  takes ~5-10s cold and the semantic cache makes repeat/near-duplicate
  prompts ~30ms; this is fast enough for direct request/response and
  keeps the cache-then-generate flow simple. `ai_jobs` remains
  available for a future bulk/background use case (e.g. regenerating
  summaries for many candidates at once) if one arises.
- [P4] FastAPI needs CORSMiddleware (`fastapi.middleware.cors.CORSMiddleware`)
  with explicit `allow_origins` for the Next.js dev server origin(s). Without
  it, browser `fetch()` from Next.js (port 3001) to FastAPI (port 8080) fails
  the preflight — the browser sees a 405 on OPTIONS and blocks the POST, so
  login silently fails and Playwright S3 login test times out waiting for
  /dashboard redirect.
- [P4] Next.js `useEffect` keydown listeners attach AFTER React hydration
  completes, which is slightly after the `load` event (which Playwright's
  `page.goto()` waits for by default). Any Playwright test that fires a
  keyboard shortcut immediately after navigation must first `waitForSelector`
  on a visible element (e.g. `'nav'`) to confirm hydration is done.
- [P4] Zustand `persist` middleware: use `partialize` to store ONLY the
  `theme` field. Storing the full store (including ephemeral UI toggles like
  `sidebarOpen`) causes stale state to persist across sessions and breaks
  e.g. a collapsed sidebar that was left that way in localStorage.
