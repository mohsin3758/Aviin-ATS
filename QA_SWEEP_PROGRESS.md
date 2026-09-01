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
- [~] Batch 1 (grep-matched a broad slice, not a strict S1-S20 range):
      135/141 real passes. 3 failures investigated:
      - "embeddings return 384 dims" — confirmed MY OWN test-tunnel gap
        (missing port 8081 for the embed service), not an app bug. Fixed
        tunnel, re-ran in isolation — now passes.
      - "S15 missing_skills surfaces on /candidates/rank" — real failure,
        NOT yet root-caused (re-run attempts have repeatedly hit this
        session's own login rate-limit before reaching the actual
        assertion a second time). Re-verify once login access is stable.
      - "S20 JD Match: ranked-candidate link..." — real failure:
        `throwawayOptValue` (a `<select>` option matched by the
        throwaway requisition's own title) came back empty/falsy twice
        in a row, not a rate-limit artifact. NOT yet root-caused — needs
        a live look at the actual dropdown state, not just re-running.
- [ ] Batch 2: S21–S40
- [ ] Batch 3: S41–S60
- [ ] Batch 4: S61–S88
- [ ] Test-suite hygiene audit (cleanup completeness, `.serial()` usage,
      no real-record mutation)

## PHASE 2 — Backend ↔ Frontend wiring audit
- [x] Systematic first-pass sweep: extracted all 753 real backend routes
      (every `@router.<method>(...)` across `backend/routers/*.py`, with
      real `APIRouter(prefix=...)` resolution) and checked whether each
      route's most-distinguishing static path segment appears anywhere
      in the frontend source. 18 flagged as no-match; each investigated
      manually (real grep + reading the actual endpoint body + real DB
      row counts where relevant, not assumed) — not treated as a final
      verdict on its own. **Result: 4 confirmed false positives, 12
      confirmed real orphans** (backend built, genuinely zero frontend
      caller anywhere) — see findings log #5-#7 below. This sweep is a
      real, useful first pass but not a substitute for the per-group
      manual click-through still listed below — it only catches "zero
      textual reference anywhere," not "referenced but subtly broken."
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
5. **`GET /sla/audit-log` (p23_p27.py) reads from the confirmed-dead
   `audit_logs` (plural) table** (0 real rows tenant-wide — verified
   directly, not assumed) instead of the real, live `audit_log`
   (singular, 6,677 real rows for the primary tenant) this whole
   codebase actually writes to, per the same finding already documented
   once in CLAUDE.md's own 2026-08-12 audit. This endpoint would return
   an empty list even if a frontend called it — worse than a plain
   orphan, it's silently broken on top of being unwired. NOT fixed yet
   — flagged for a real fix decision (repoint to `audit_log` + wire a
   UI, or retire, matching this project's own established "genuinely
   dead, matches a real already-built alternative" retirement pattern).
6. **11 more confirmed real backend-only orphans**, each individually
   verified (grep across the whole frontend + reading the endpoint body
   + real DB row counts, not assumed from the automated signal-match
   alone):
   - `bgv.py` `GET`/`POST /bgv/trust-graph`(`/edge`) — real relationship-
     graph read/write, 0 real rows ever, zero UI (the 2026-08-09 BGV
     rebuild's own 3 tabs — Overview/Checks/India Verify — never
     included a trust-graph view).
   - `final_features.py` `GET /pdf/candidate-profile/{id}` — a real,
     working, self-contained candidate-snapshot PDF (name/contact/
     experience/readiness score/recent applications) genuinely distinct
     from the Resume Generator's Standard Resume — zero UI.
   - `incentives.py` `retention-tracking` (GET/POST/PATCH, 3 endpoints)
     — real per-placement retention-credit tracking from the P15
     compensation framework — 0 real rows, zero UI anywhere.
   - `p36_p42.py` `GET /reports/monthly-billing` — reads a real,
     populated view (`v_monthly_billing`, 1 real row) — zero UI.
   - `pipeline_p2.py` `POST /pipeline/sync-scores` — a real fit_score-
     from-AI-readiness backfill maintenance op, zero UI.
   - `pipeline_p2.py` `POST /pipeline/auto-move` — a real, standalone
     "run the rule engine right now" trigger, genuinely separate code
     from `scheduler.py`'s own nightly `run_pipeline_auto_move()`
     function (confirmed via grep — the scheduler calls its own Python
     function directly, never this HTTP endpoint) — zero UI.
   - `pipeline_p2.py` `POST /pipeline/check-rules/{application_id}` —
     docstring says "After a manual move: check if any rules apply" but
     confirmed via grep it's never actually called from
     `update_stage()` or anywhere else — the described behavior never
     happens. Zero UI, zero internal caller either.
   - `pipeline_p2.py` `GET /pipeline/filter-options` — real distinct-
     sources + top-100-skills + stage-list endpoint for building a
     filter UI, zero UI caller.
   - `pipeline_p2.py` `GET /pipeline/active-requisitions` — a real
     "most active requisitions by application count" leaderboard query,
     zero UI.
   - `vendor_analytics.py` `GET /vendor-analytics/source-performance` —
     real per-source (job-board attribution) performance analytics; the
     real `/vendor-analytics` page has exactly 4 tabs (vendors/
     recruiter-funnel/diversity/summary) and none of them call this.
   - `users.py` `GET /roles/departments` — returns a real canonical
     9-department list; the real Settings > Users page has its own,
     independently-hardcoded `DEPT_LIST` with the identical 9 values
     (currently in sync by coincidence, not by being fetched from this
     endpoint) — a real "two copies of the same list, silent-drift
     risk" pattern already documented and fixed for other lists
     elsewhere in this project, just not yet actually drifted here.
   None of these 12 are fixed yet — cataloged for a batch decision
   (build real UI vs. retire, per item) rather than assumed unilaterally,
   matching this project's own established precedent for exactly this
   judgment call (e.g. BGV API, Job Distribution, Assessments — all
   retired rather than UI'd, on a case-by-case basis, in this project's
   history).
7. **4 confirmed FALSE POSITIVES from the automated first pass** (real,
   working, genuinely wired features that the static-string-matching
   script couldn't see) — recorded so a future re-run of the same
   script doesn't re-flag them and waste time re-investigating:
   - `calendar.py`'s calendar-feed `.ics` subscribe link — the frontend
     calls `POST /calendar/feed-token`, which returns a server-built
     `feed_url` string; the frontend only ever displays/copies that
     string (an external calendar app is what actually fetches it), so
     the literal path segment never appears as frontend source text —
     genuinely wired end to end, confirmed via `/calendar/page.tsx`.
   - `resume_intake.py`'s `POST /resume-intake/populate-parsed-data` —
     already confirmed deliberate, safe, idempotent admin/ops tooling
     in CLAUDE.md's 2026-08-20 entry — "correctly not a user-facing
     feature," not a bug.
   - `scheduler_router.py`'s `POST /scheduler/trigger/{retention-bank,
     loyalty,risk-scores}` — the sibling `GET /scheduler/status` IS
     genuinely wired (Dashboard page, confirmed via grep) but these 3
     manual-trigger endpoints are real, deliberate admin/ops tooling
     (per CLAUDE.md's 2026-08-09 entry — "triggered it again (POST
     /scheduler/trigger/loyalty)" via direct curl during verification),
     matching the same established pattern as `populate-parsed-data` —
     not a bug.

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
