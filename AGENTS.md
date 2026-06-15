# AGENTS.md — AIrecruit (FinStack Staffing OS)

Cross-tool instructions for any AI coding agent working in this repo
(Claude Code, Cursor, Aider, Copilot, etc.). `CLAUDE.md` is the
canonical/detailed doc for Claude Code specifically — this file is a
condensed version of the same rules so other tools stay consistent.
If the two ever disagree, `CLAUDE.md` wins; fix this file to match.

## What this is
Zero-Token AI Staffing/ATS Operating System for staffing agencies
(India-first). Repo: `~/airecruit` on VPS 187.127.179.128. Codename
"FinStack Staffing OS" in the blueprint docs — same product as
"AIrecruit". NOT related to the separate FinStack HR/Payroll SaaS;
never share code, schema, ports, or domains between the two.

## Stack
FastAPI (Python) + asyncpg · Next.js 14 + TypeScript + Tailwind +
ShadCN · PostgreSQL 16 + pgvector · BGE-small-en-v1.5 embeddings
(384-dim) · Qwen2.5-1.5B via Ollama · n8n automation · WAHA WhatsApp ·
Tesseract + OpenCV OCR · JWT auth (tenant_id + role + user_id claims)

## Hard rules — zero tolerance
1. NEVER call OpenAI/Anthropic/Gemini or any external LLM API
2. NEVER connect to the DB as the `postgres` superuser (bypasses RLS)
3. ALWAYS `vector(384)` for embeddings (BGE-small only)
4. ALWAYS make Ollama calls async + cache results in `ai_cache`
5. ALWAYS write `event_outbox` in the SAME DB transaction as the
   business change it describes
6. ALWAYS set a `dedup_key` on every `event_outbox` row
7. WhatsApp messages ALWAYS require a consent record first (India
   DPDP 2023)
8. ALL n8n Postgres nodes MUST `SET app.tenant_id` first
9. ALWAYS connect as `app_user` (password `apppw`), NEVER `postgres`

## Zero-token cascade (never break)
- Tier 0 (~70%): Postgres rules + n8n + regex + OCR — free
- Tier 1 (~20%): BGE-small embeddings + pgvector — free (CPU)
- Tier 2-lite (~10%): Qwen via Ollama, async + cached — free (CPU)

## Workflow expectations
- Read `FINSTACK_MASTER_INDEX.md` first — it tracks phase status
  (P0-P14). Work the phase marked `NEXT`.
- After finishing a phase: update `CLAUDE.md` +
  `FINSTACK_MASTER_INDEX.md`, run the Playwright QA suite
  (`tests/qa_automation.spec.ts`), fix failures, then move on.
- Multi-tenancy is enforced via Postgres RLS keyed on
  `app.tenant_id` — every query path must set this, never trust a
  tenant id from request body alone.
- Use `scripts/zerotoken-check.sh` before committing — it scans diffs
  for accidental external-LLM-API usage.

## Model / effort switching
- Simple tasks (read files, syntax checks, small bug fixes, running
  tests) → cheapest/fastest model available in your tool
- Complex tasks (new features, package installs, DB migrations,
  deploys, architecture decisions) → strongest model available

## Token-efficiency habits
- Keep prompts precise and scoped to specific files/functions
- Compact/clear context between unrelated tasks
- Prefer custom slash-commands / saved prompts over re-explaining
  context each time
- Don't re-read files you just wrote/edited — trust the tool result
