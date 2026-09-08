## Rules for this file
- This file is auto-loaded in full on EVERY turn of EVERY session.
  Every line costs tokens on every message.
- Never append session notes, fix narratives, deploy logs, status
  updates, or investigation results here. Those go in docs/ or in the
  commit message.
- Historical record: CLAUDE_HISTORY.md (not auto-loaded, read only
  when explicitly asked).
- Hard cap: 150 lines. If an edit would exceed it, remove something
  first.

# AVIIN ATS — FinStack Staffing OS
Zero-token AI Staffing/ATS for staffing agencies. India-first: no
external LLM API, no GPU, no per-token cost.

Repo: `~/airecruit` on the VPS. "FinStack Staffing OS" = "AVIIN ATS" =
"AIrecruit" — same product/repo. UNRELATED to the separate FinStack
HR/Payroll SaaS (different company project — never share code, DB
schema, ports, or domains between the two).

Legal/company name: Aviin Technology Business Solutions Pvt Ltd
("Aviin Tech"). Never use the old name "Aviin Jobs Services"/"AVIIN
Jobs" in new code, UI text, or generated documents.

Domain: ats.aviintech.com. VPS: 187.127.179.128, Ubuntu 24.04. `dev`
user has sudo + docker group membership — no `sudo` prefix needed for
docker commands.

## Tech stack
- Backend: FastAPI (Python) + asyncpg
- Frontend: Next.js 14 + TypeScript + Tailwind CSS + ShadCN UI
- DB: PostgreSQL 16 + pgvector, multi-tenant via row-level security
- Embeddings: BGE-small-en-v1.5 (384 dims) at http://embed:8081
- Generation: Qwen2.5-1.5B via Ollama at http://ollama:11434
- Job queue: Postgres `ai_jobs` table polled by a worker (never
  Redis/Celery/BullMQ)
- Automation: n8n at http://n8n:5678 | WhatsApp: WAHA at
  http://waha:3000
- OCR: Tesseract + OpenCV | Auth: JWT (tenant_id + role + user_id
  claims)
- DB connection: `app_user`/`apppw` (non-superuser, RLS enforced). Per
  request: `set_config('app.tenant_id', '<uuid>', true)`.

## Zero-token cascade — never break
Tier 0 (~70%, SQL rules/n8n/regex/OCR) -> Tier 1 (~20%, BGE embeddings
+ pgvector) -> Tier 2-lite (~10%, Qwen via Ollama, async + cached).
Every AI call must pass through `backend/ai_router.py` — it dispatches
the tiers, enforces hard rules #1/#3/#4, and does the semantic-cache
lookup (cosine similarity >0.95 on `ai_cache.prompt_embedding
vector(384)`) before any Ollama call. Never call Ollama directly from
a router — go through `ai_router.generate()`, with a graceful-
degradation fallback for when it's down.

## Hard rules — zero tolerance
1. Never call OpenAI/Anthropic/Gemini or any external LLM API
2. Never connect to the DB as the `postgres` superuser from app code
   (bypasses RLS)
3. Always `vector(384)` for embeddings (BGE-small only)
4. Always route Ollama calls through the AI Router + `ai_cache`
   (semantic cache, not just exact-hash)
5. Always write `event_outbox` in the SAME DB transaction as the
   business change, with a `dedup_key` on every row
6. Any candidate PII processing (WhatsApp included) always requires a
   `consent_records` row first (DPDP 2023) — check this on every new
   intake path
7. Every n8n Postgres node MUST `SET app.tenant_id` first
8. Always connect as `app_user`, never `postgres`
9. High-stakes actions (offer issued, candidate rejected, recruiter
   reassigned) always pause for human approval (HITL) and log to
   `assignment_event`/`audit_log` — never fully autonomous
10. Aadhaar/PAN/PF/bank-account columns: pgcrypto field-level
    encryption at rest

## Recurring bug classes — check these before writing new code
- asyncpg needs real `date`/`datetime`/`UUID` objects, not bare
  strings — a blank string (`''`) bound to a date/uuid column crashes
  or silently matches nothing
- A `SECURITY DEFINER` function on a FORCE RLS table must be OWNED BY
  `postgres`, not `app_user` — `CREATE OR REPLACE` does NOT change
  ownership, needs an explicit `ALTER FUNCTION ... OWNER TO postgres`
- `CREATE OR REPLACE VIEW` does not preserve `security_invoker=true`
  — re-set it explicitly after every replace on a view over an RLS
  table, or it silently leaks data cross-tenant
- Never hardcode a pipeline stage key (e.g. `'l1_interview'`) — read
  the tenant's real `pipeline_stage_config`/`skills_required`, tenants
  customize both
- One bad row in a loop poisons the whole shared DB transaction unless
  wrapped in its own SAVEPOINT (`async with conn.transaction():`)
- A missing `is_active` filter on a joined `users`/`clients`/
  `candidates` table is the single most-repeated bug in this codebase
  — check it on every new list/report/leaderboard query
- Editing a file on Windows can silently flip its line endings
  (LF<->CRLF) — compare the byte count against HEAD before deploying
  if a diff looks disproportionately large
- Deploy: scp -> sha256 hash-verify (local vs VPS) -> `docker compose
  up -d --build` -> health-check. Never assume a copy landed
  correctly.
- Container crash -> `docker compose logs <service>`; DB connection
  refused -> check the `db` healthcheck; "relation does not exist" ->
  re-run `sql/*.sql` in order; Ollama model missing -> `docker exec
  aviin_ollama ollama pull qwen2.5:1.5b-instruct-q4_K_M`

## Do not touch without explicit evidence
- Never bulk-delete/modify candidates or `resume_files` by name-
  pattern match alone (e.g. `"QA "`/`"test"`) — verify actual resume
  content and email domain first. "QA" is often a real Quality
  Assurance job role, not test data.
- Never hard-delete a candidate/application without checking for real
  downstream activity (interviews, offers, placements,
  `consent_records`) first — most such tables have no delete endpoint
  by design; that's deliberate, not a gap to route around with raw
  SQL.
- Never guess-correct a candidate's parsed name/email/phone from
  inference. Leave it as extracted and flag it for review — a wrong
  guess overwrites a real person's identity.
- Never reset a real staff member's password, or otherwise act on
  their account, without their or the user's explicit go-ahead — not
  even "just to verify" something.
- `resume_files` and any Aadhaar/PAN/PF/bank-account data are real
  production PII — soft-delete only, treat as irreversible otherwise.
