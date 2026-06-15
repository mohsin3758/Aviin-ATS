# AIrecruit — Zero-Cost Architecture Review (P0 reference, part 2)

Source: user-provided "ATS · AI · Automate — Master Solution Architecture:
All-in-One Autonomous Staffing OS" (14-Discipline Build Specification,
Zero-Token / Zero-Cost Edition, India-First, June 2026).

Purpose: cross-check this independent architecture spec against the
current CLAUDE.md / FINSTACK_MASTER_INDEX.md plan (and the earlier
`competitor_landscape_and_feature_blueprint.md`), confirm nothing is
missing for "best-in-class, zero-token AI + automation ATS", and fold
any real gaps into existing phases — additive only, no new phase
numbers, per the established rule.

## 1. Architecture validation — already aligned, no pivot needed

The PDF's "Zero-Cost Model" table and "Four Zero-Token Levers" describe
*exactly* the cascade already locked into CLAUDE.md. This is strong
independent confirmation the current plan is correctly scoped:

| PDF requirement | AIrecruit equivalent |
|---|---|
| Rules + CPU embeddings (BGE-small) for parse/match/search/assign/dedup — Tier 0/1, free | `match_candidates()`, `match_recruiters()`, `assign_with_explanation()` — ZERO-TOKEN CASCADE Tier 0/1 |
| n8n self-hosted event workflows — free | P2 (W1-W9) |
| Qwen2.5-1.5B / Llama-3.2-1B 4-bit GGUF via Ollama, async, semantic-cached — free after download | Tier 2-lite |
| Postgres + pgvector + RLS + tenant_id, pooled multi-tenant DB | P0, HARD RULES #2/3/9, TARGET DB |
| Event-driven flow (PDF suggests Kafka/RabbitMQ) | Our `event_outbox` table + n8n polling is the zero-infra equivalent — no extra broker needed at this scale (HARD RULES #5/#6) |
| Single VPS, no GPU, vertical scaling first | VPS RESOURCES note (7.8GB RAM — workable, watch for OOM per existing note) |
| Voice AI / strong autonomous agents infeasible on CPU, deferred | Matches existing "Hard limit" framing — no change |

**Conclusion**: no architectural pivot required. The gaps below are
refinements/additions, not corrections.

## 2. New gaps identified — fold into existing phases (additive, no new phase numbers)

| # | Gap (from PDF) | Fold into | What to build |
|---|---|---|---|
| 1 | Candidate-facing career site / self-service portal (apply, track status, self-schedule, WhatsApp/SMS nudges) — currently absent from P5-P10 | **P6** | Extend P6 (already gaining a read-only client portal per the competitor-blueprint gap-fix) to also serve a `candidate` role: application status, self-scheduling, document upload |
| 2 | Async job queue for Tier-2 generation (PDF suggests Redis/BullMQ/Celery — not in our TECH STACK at all) | **P0 schema + P3** | Postgres-based `ai_jobs` table polled by a worker — avoids adding a Redis service on a 7.8GB-RAM box, stays consistent with "vertical first, no extra infra" |
| 3 | Central "AI Router" enforcing the Tier0→1→2 cascade + cache + zero-token policy as one component | **P3** | `backend/ai_router.py` — single module every AI call passes through; one place to enforce HARD RULES #1/#3/#4 |
| 4 | Semantic cache via embedding similarity (>0.95 cosine), not just exact-prompt-hash | **P0 schema + P3** | `ai_cache.prompt_embedding vector(384)` column; router does cosine lookup before calling Ollama |
| 5 | HITL approval gates on high-stakes actions (offer issued, candidate rejected, recruiter reassigned), every decision audited | **New HARD RULE + P1/P2** | Workflow engine pause-for-approval state; write `assignment_event`/`audit_log` row on every gated decision |
| 6 | `audit_log` + `assignment_event` append-only tables, partitioned by month | **P0 schema** | Add to `sql/01_phase1_schema.sql` |
| 7 | DPDP consent/retention/erasure subsystem broader than WhatsApp-only (current HARD RULE #7 is WhatsApp-specific) | **P0/P1** | `consent_records` table per data-category + retention job + erasure endpoint |
| 8 | Field-level encryption for Aadhaar/PAN/PF/bank-account data | **New HARD RULE + P0/P12/P13** | pgcrypto column-level encryption for those fields |
| 9 | Structured interview scorecards/kits (Greenhouse-style) — not currently named | **P1 backend + P6/P7 UI** | `interview_scorecards` table + scoring tab |
| 10 | Email (SMTP) + SMS comms channels alongside WhatsApp | **P11** | Broaden P11: n8n SMTP/SMS nodes alongside WAHA |
| 11 | Offer-letter generation + onboarding doc checklist via Aadhaar OTP e-sign / DigiLocker | **P13** | Natural fit — P13 already covers India BGV compliance integrations (Aadhaar/DigiLocker) |
| 12 | Named predictive models: offer-drop, retention, hiring-difficulty, capacity-vs-demand (Tier 0/1 feature pipelines, not generative) | **P8/P9** | Specific dashboards, beyond generic "BI/analytics" wording |
| 13 | a11y (WCAG 2.2 AA) + i18n (14+ languages) | **P4 baseline + P11** | Cross-cutting frontend requirement; multilingual ties into WhatsApp/screening |
| 14 | Real-time WebSocket/SSE for live pipeline/agent-status updates | **P4 infra + P6** | Live Kanban updates |
| 15 | AI eval (golden datasets + drift tracking), agent replay harness, cache hit-rate monitoring | **P3 QA** | Extend Playwright/QA suite once P3 ships |
| 16 | `trust_graph` / `talent_graph` adjacency tables | **P13** | Backs the "Trust Intelligence" naming already used for P13 |

## 3. Deferred — PDF "Stage 5: Agents + Beyond" items (explicitly NOT part of P0-P14)

The PDF itself frames these as a separate, later discipline set — they
are P15+ candidates if pursued post-launch, not blockers now:

- **CRM / BD pipeline** for the agency's own sales (leads/deals with
  prospective clients) — sister FinStack HR product has an equivalent
  (its P9.8); AIrecruit doesn't need this for P0-P14.
- **VMS integration** (Fieldglass/Beeline-style external
  vendor-management submission) — separate discipline per the PDF.
- **GraphQL read layer** — optional REST alternative, not blocking.
- **Data warehouse + dbt** (DuckDB/ClickHouse CDC) — a Postgres
  analytics replica is sufficient at current scale.
- **Voice AI / strong autonomous agents** — PDF confirms infeasible on
  CPU; only revisit if a GPU is ever added.

## 4. Status

This review confirms the P0-P14 plan and zero-token cascade need **no
architectural pivot** — the PDF independently validates the approach
already in CLAUDE.md. The 16 items in §2 are folded additively into the
phases noted (build when that phase comes up); §3 items are explicitly
out of scope for P0-P14.
