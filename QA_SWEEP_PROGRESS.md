# AVIIN ATS — Full-Stack Evidence-Based QA Sweep — Progress Tracker

Started: 2026-09-01. Source plan: agreed with the user across the same
conversation this sweep began in (not a separate design doc — see this
file's own structure below, which mirrors the agreed phases exactly).

This file is the single source of truth for sweep progress — read this
FIRST in any future session before re-deriving scope. CLAUDE.md still
gets its own dated narrative entry per individual fix, as always; this
file is the checklist view across the whole sweep.

Legend: [ ] not started · [~] in progress · [x] done · [-] deferred (with reason)

---

## PHASE 0 — Environment & schema baseline — DONE 2026-09-01
- [x] Server health baseline — healthy (load 0.12-0.19, 4 cores, 16GB
      RAM/~12GB available, 65G/193G disk used). Informational: CLAUDE.md
      documents "7.8GB RAM, 2 cores" — real VPS now has more; update the
      doc opportunistically, not urgent.
- [x] Live DB schema vs committed `sql/*.sql` migrations — drift check.
      **Major finding, fixed**: 57 real, live, heavily-used tables (incl.
      resume_files, role_definitions, interview_schedules, candidate_
      messages, email_templates, recruiter_tasks, webhook_integrations,
      skills_taxonomy, saved_filters, work_sessions) had ZERO CREATE
      TABLE anywhere in committed migrations — a fresh environment from
      git alone would be missing all 57. Backfilled in
      sql/99_phase0_schema_drift_backfill.sql (captured verbatim via a
      single combined pg_dump --schema-only for correct dependency
      ordering; CREATE TABLE/SEQUENCE/INDEX use IF NOT EXISTS; every ADD
      CONSTRAINT wrapped in a real DO $$ ... EXCEPTION WHEN
      duplicate_object OR invalid_table_definition OR duplicate_table
      THEN NULL; END $$; block — 3 distinct real SQLSTATEs found and
      fixed via genuine trial against production, not assumed: 42710/
      42P16/42P07). Verified via a transactional dry-run (BEGIN...
      ROLLBACK, zero errors), then run for real (committed, zero
      errors), then run a SECOND time to prove true idempotency (zero
      errors, all 88 "already exists" notices). App health confirmed
      200 throughout.
- [x] Zero-token audit — CONFIRMED CLEAN throughout.
- [x] Integration health: Ollama/embed/n8n/SMTP all healthy.
      **Real finding, flagged (not fixed — needs a physical QR re-scan,
      can't be done by me)**: WAHA's primary "default" session — the one
      powering ALL automated stage-change WhatsApp notifications,
      confirmed connected as recently as 2026-08-31 — is now
      disconnected (SCAN_QR_CODE), along with 2 other sessions ("aviin",
      a per-user personal session). Every automated WhatsApp send has
      been silently failing since whenever this disconnected. **Needs
      the user (or whoever holds the linked phone) to re-scan via the
      WAHA dashboard**, matching the established recovery process
      documented for this exact scenario on 2026-08-30.
- [x] Integration health: Telegram/Facebook — confirmed zero real
      connections exist for this tenant (already-known, expected state).
      **Real finding, fixed**: all 4 `webhook_integrations` rows were
      confirmed stray E2E test artifacts (fake Slack/httpbin URLs,
      dated 2026-07-11) — not real customer webhooks. This tenant
      currently has ZERO real Slack/Teams/Discord integration
      configured. Cleaned up via direct SQL (documented last resort,
      no DELETE endpoint exists for this table).
      SMS (MSG91)/browser push: code paths confirmed present, not
      exercised against a real recipient (no safe way to test without
      sending a real message) — deferred to Phase 3's own honest-limits
      handling if a real test becomes safe/necessary.
- [x] n8n's own live workflow state — genuinely healthy. All 13 real
      workflows confirmed `active=1` directly in n8n's own SQLite store
      (copied with the -wal/-shm sidecars, the established gotcha),
      not just assumed from the app calling the right webhook URL.
- [x] New-tenant/onboarding bootstrap path completeness.
      **Real, structural gap found and fixed**: no tenant-creation API
      exists at all (fully manual/ad-hoc process). Created a real
      throwaway tenant directly and confirmed pipeline_stage_config/
      scoring_weight_config/sla_tier_config/auto_assign_config all
      genuinely self-heal with real defaults on first GET — but
      `role_definitions` did NOT (confirmed: `GET /roles` returned `[]`
      for the fresh tenant). sql/60's one-time migration (2026-08-16)
      fixed this ONCE for the 2 tenants that existed then, with a
      comment claiming future tenants "self-heal the same way" — but
      that was never actually wired into a live code path, so a
      genuinely new tenant would hit the exact same "Invite New User
      Failed" bug again. Fixed properly: a real SECURITY DEFINER SQL
      function (sql/100_seed_role_definitions_function.sql, matching
      the established get_client_portal_token/redeem_referral_click
      pattern for "app_user code needs a narrow, safe cross-tenant
      read") + a shared Python helper wired into GET /roles, POST
      /users, and PUT /users/{id} (defense in depth — a direct API call
      could bypass the page-load path). **A real bug in my own first
      attempt caught during verification, not shipped blind**: the
      first version tried the cross-tenant lookup through a tenant-
      scoped connection, which RLS correctly blocked — confirmed live
      (still returned `[]`), root-caused, and fixed with the SECURITY
      DEFINER function instead. Verified end-to-end: fresh tenant went
      from 0 → 28 real roles, idempotent on a second call (still
      exactly 28, no duplicates), zero regressions across S31/S33/S51/
      S81 (21/21 passed). Throwaway tenant fully cleaned up.
- [x] SSL certificate validity/renewal — valid, 18 days remaining;
      certbot.timer confirmed actively running (every 12h) and within
      its own 30-day auto-renewal window — genuinely healthy, not
      assumed.
- [x] Public-facing links reachable from OUTSIDE the VPS — confirmed via
      genuine external HTTPS requests from a separate network (the
      public job board API + the real /careers page both 200).

## PHASE 1 — Re-run existing permanent suite (S1–S88)
- [ ] Batch 1: S1–S20
- [ ] Batch 2: S21–S40
- [ ] Batch 3: S41–S60
- [ ] Batch 4: S61–S88
- [ ] Test-suite hygiene audit (cleanup completeness, `.serial()` usage,
      no real-record mutation)

## PHASE 2 — Backend ↔ Frontend wiring audit
- [ ] Core group (Dashboard, Candidates, Companies, Jobs/Requisitions,
      Pipeline, Pipeline Velocity, Duplicate Candidates, Recruiter Ops,
      Assignment Dashboard, Device Monitoring, Field Attendance, Shift
      Scheduling)
- [ ] AI & Intelligence group
- [ ] Recruitment group (Resume Inbox, Interviews, Calendar, Video
      Screening, Offer Engine, NDA Documents, JD Templates, ...)
- [ ] Analytics group
- [ ] Finance group
- [ ] Communication group
- [ ] Vendors group
- [ ] Settings group

## PHASE 3 — Functional end-to-end verification
- [ ] Core daily workflow (candidate intake → pipeline → offers →
      placements → payroll) — priority pass
- [ ] Recruiter/KAE-facing tools
- [ ] Admin/reporting/analytics
- [ ] Sub-module/variant coverage sweep (per-feature, as areas are hit)
- [ ] Scale check (real 2,700+ candidate dataset)
- [ ] Concurrency & idempotency checks
- [ ] Background/scheduled jobs — direct invocation
- [ ] Silent-failure hunt (`except Exception: pass` grep + log check)
- [ ] Generated-file content correctness (CSV/PDF/etc.)
- [ ] Localization/multi-language honesty check
- [ ] Uploads & malformed input
- [ ] Degraded-dependency behavior
- [ ] is_active leak sweep
- [ ] Responsive/narrow-viewport check
- [ ] UX/comprehension pass

## PHASE 4 — HARD RULE compliance & financial integrity
- [ ] #10 HITL gate — every real code path enumerated
- [ ] #5/#6 event_outbox atomicity + dedup_key
- [ ] #11 encryption at rest (Aadhaar/PAN/PF/bank)
- [ ] #7/#12 DPDP consent — every current candidate-creation path
- [ ] Financial correctness (incentives, retention bank, loyalty,
      account P&L, collections, payroll) — hand-verified arithmetic

## PHASE 5 — Security audit
- [ ] Auth/role gaps (no token / wrong role / wrong tenant)
- [ ] IDOR sweep
- [ ] Cross-tenant leaks (RLS, security_invoker, SECURITY DEFINER)
- [ ] Forgeable/guessable token audit
- [ ] Privilege escalation checks
- [ ] Injection/XSS spot-check
- [ ] Secrets sweep (repo + git history)
- [ ] Rate limiting/abuse on public endpoints

## PHASE 6 — Final regression pass & sign-off
- [ ] Full S1–S(final) suite, rate-limit-paced batches, clean
- [ ] All real-user-reported items confirmed by that user
- [ ] Final summary report delivered

---

## Findings log (append as found — bug, root cause, fix, verification, S-number, CLAUDE.md entry link)

1. **57-table schema drift** (resume_files, role_definitions, interview_
   schedules, candidate_messages, email_templates, recruiter_tasks,
   webhook_integrations, and 50 more) — no CREATE TABLE in any committed
   migration. Fixed: sql/99_phase0_schema_drift_backfill.sql. Verified:
   transactional dry-run + real committed run + idempotency re-run, all
   zero errors. See CLAUDE.md entry "Phase 0 schema-drift backfill...".
2. **New-tenant role_definitions never self-heals** (structural gap,
   only ever patched per-instance). Fixed: sql/100_seed_role_definitions
   _function.sql + backend/routers/users.py (list_roles/create_user/
   update_user). Verified: real throwaway tenant 0→28 roles, idempotent,
   S31/S33/S51/S81 regression-clean (21/21). See same CLAUDE.md entry.
3. **webhook_integrations: 4 stray E2E test rows**, not real customer
   webhooks (dated 2026-07-11). Cleaned up via direct SQL. Tenant
   currently has zero real Slack/Teams/Discord integration configured —
   flagged for the user's own awareness, not a code bug.
4. **WAHA "default" WhatsApp session disconnected** — flagged, NOT
   fixed (needs a physical QR re-scan). All automated WhatsApp sends
   have been silently failing since disconnection. Needs user action.

---

## Open/deferred items (with reason)

- **WAHA default session disconnected** — real, live, currently
  affecting all automated WhatsApp notifications. Cannot be fixed by me
  (needs a physical phone to re-scan the QR via the WAHA dashboard,
  same process as the 2026-08-30 precedent). Flagged to the user
  directly; re-check once reconnected.
- **CLAUDE.md's VPS RESOURCES section is stale** (documents 7.8GB/2
  cores; real VPS now has 16GB/4 cores) — informational only, no
  functional impact. Update opportunistically in a future pass.
- **SMS (MSG91) and browser push were not exercised against a real
  recipient** during Phase 0 — no safe way to send a real test message
  without spamming someone. Revisit in Phase 3 if a genuinely safe test
  path exists (e.g. a real opt-in test number), otherwise verify via
  code review + negative-path testing only, matching this project's
  established "honest limits" precedent.
- **`account_pl`'s "Infosys BPM" corrupted client_id** (client_id
  literally equals tenant_id, no real client record matches) — a real,
  pre-existing data bug documented in CLAUDE.md history (2026-08-17),
  never resolved since there's no safe way to infer the intended real
  client from the data alone. Not touched in Phase 0 (out of scope);
  worth a dedicated look during Phase 4's financial-integrity pass.
