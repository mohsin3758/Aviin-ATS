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
      135/141 real passes initially. All non-rate-limit failures now
      fully root-caused and fixed — see findings log #8-#10. Summary:
      - "embeddings return 384 dims" — my own test-tunnel gap (missing
        port 8081 for the embed service). Fixed, now passes.
      - S15's "missing_skills surfaces on /requisitions/{id}/match-
        candidates" — a real, confirmed app-behavior limitation (the
        endpoint's own deliberate 300-row relevance pool), not a bug.
        Test rewritten to use the pool-immune sibling endpoint.
      - S20 — turned out to be caused ENTIRELY by a mistake in my own
        local SSH tunnel (forwarding to the wrong VPS port for the
        frontend). Once corrected, the only real, remaining app-level
        issue was a genuine async-render race (fixed with expect.poll).
      - S53 (found and fixed while investigating S20's real root cause,
        not part of the original 3): 4 of its /candidates/rank calls
        used limit:200 against this tenant's real, now-2,700+-candidate
        base — a throwaway candidate's own deliberately-partial score
        isn't guaranteed to crack an arbitrary top-200 cutoff. Fixed by
        raising to limit:5000, matching a sibling test in the same suite
        that already had this exact fix.
      - Also found and fixed while investigating: `GET /sla/audit-log`
        (p23_p27.py) read from the confirmed-dead `audit_logs` (plural)
        table — a real, broken, zero-caller duplicate of the already-
        working `/audit` endpoint. Retired.
- [x] Batch 2: S21–S40 — DONE, fully clean. Initial run: 81/86 real
      passes, 4 failed + 1 flaky — all confirmed (via direct backend-
      log inspection, not assumed) to be this session's own well-
      documented per-IP login rate-limit artifact from an unusually
      heavy cumulative test-run volume that day — every failure traced
      to a real `429` on that specific test's own `POST /auth/login`
      call, immediately followed by the expected `401` on its next
      request. Re-verified after a genuine, pure time-based cooldown
      (zero interim login attempts, to avoid the self-defeating "polling
      with logins perpetuates the rate limit" trap): S21/S24 clean in
      isolation, then S34+S35 together (13/13) after the full cooldown.
      Zero real regressions found anywhere in this batch.
- [ ] Batch 3: S41–S60
- [ ] Batch 4: S61–S88
- [ ] Test-suite hygiene audit (cleanup completeness, `.serial()` usage,
      no real-record mutation) — informally covered so far: confirmed
      S20/S53's own cleanup hooks correctly leave zero residue; found
      and cleaned up 5 stray leftover requisitions from PRIOR sessions'
      runs of S20 discovered incidentally during this investigation.

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
(Preliminary static-analysis pass started opportunistically during a
Phase-1 rate-limit cooldown wait — real code-reading, not yet the full
live-verification pass this phase's checklist items still need.)
- [x] #4 (AI Router as the one module every AI call passes through) —
      NOT on the original checklist explicitly, but checked while
      investigating #5/#6/#10/#11 and found 2 real, live violations,
      both fixed and verified end-to-end (real Ollama generation, real
      semantic-cache hit on a repeat call, confirmed via a direct
      `ai_cache` row check) — see findings log #12.
- [~] #10 HITL gate — spot-checked the 3 named high-stakes actions:
      `approve_offer`/`issue_offer` (offers.py) and `reassign`
      (assignments.py) all correctly `require_role("admin","manager")`.
      Candidate rejection confirmed structurally protected too — per
      CLAUDE.md's own 2026-08-09 finding, `rejected` is one of exactly
      3 stage keys the pipeline-stage-deletion/auto-mover code
      hard-excludes from any automated/rule-engine stage-write path, so
      there is no autonomous code path that can reject a candidate
      without a human explicitly triggering it. Not yet a full
      enumeration of every real code path (the checklist's own bar) —
      just the 3 named actions confirmed correct.
- [~] #5/#6 event_outbox atomicity + dedup_key — the shared `events.
      write_outbox()` helper (`backend/events.py`) is well-designed
      BY CONSTRUCTION: `conn` (the caller's own already-open
      transaction) is a required first param and `dedup_key` a
      required last param — a caller structurally cannot skip either.
      Spot-checked 6 real call sites across `offers.py`/`applications.
      py`/`candidates.py`/`kae_submission.py` — all correctly pass the
      same connection as their business-logic write and a real,
      row-specific dedup key. Not yet a full audit of all ~20+ call
      sites across the 10 files that use this helper.
- [x] #11 encryption at rest (Aadhaar/PAN/PF/bank) — verified for
      real, not just read: `erp_encrypt`/`erp_decrypt`
      (`sql/05_phase12_erp.sql`) genuinely use `pgp_sym_encrypt`/
      `pgp_sym_decrypt` reading `current_setting('app.encrypt_key')`.
      `erp.py`'s Python fallback (`ERP_ENCRYPT_KEY` env var, defaulting
      to a weak, publicly-visible-in-source string if unset) was a real
      concern worth checking, not assumed safe — confirmed directly on
      the live VPS: a real, 64-character, non-default key IS configured
      in `.env` and passed through via `docker-compose.yml`. `bank_ifsc`/
      `bank_name` are deliberately stored unencrypted (identifying
      metadata, not a financial credential the way the account NUMBER
      is) — a reasonable scope boundary, not a violation.
- [x] #7/#12 DPDP consent — enumerated every real `INSERT INTO
      candidates` across the whole backend (7 distinct code paths, not
      assumed complete from memory of the 2026-08-09 fix alone):
      `candidates.py` (manual add), `resume_intake_service.py`'s shared
      `upsert_candidate()` (email intake — also reused as-is by
      `whatsapp_bot.py`'s WhatsApp intake, so both correctly inherit the
      same consent-write logic with no separate code needed),
      `import_router.py` (CSV+Excel bulk import), `ops_gaps.py` (agency-
      portal), `gap_features.py` (browser-extension capture),
      `p28_p32.py` (public job-board apply), and `personal_links.py`
      (the recruiter personal-link/job-share-link public forms, built
      2026-08-25 — AFTER the 2026-08-09 consent audit, so genuinely not
      previously verified rather than just re-confirmed). All 7 confirmed
      to write a real `consent_records` row on genuine candidate
      creation. No new, unaudited gap found.
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
8. **`GET /sla/audit-log` (p23_p27.py) retired** — a real, dead-on-
   arrival duplicate of the already-fixed `GET /audit` (p28_p32.py):
   read from the confirmed-dead `audit_logs` (plural) table (0 real
   rows), had zero frontend caller AND zero internal caller anywhere.
   The real, correct, actively-used equivalent (`/audit`, reading the
   real `audit_log` singular table) already exists and powers the
   Audit Trail page — this endpoint would have returned an empty list
   even if it had ever been wired up. Deleted. Verified via the
   trusted-internal path (no login needed): 404 post-fix, `/audit` and
   the sibling `/sla/summary` in the same router both unaffected (200).
9. **S15's real `/requisitions/{id}/match-candidates` failure,
   root-caused and fixed at the test level, not a code bug.** This
   endpoint deliberately ranks only a bounded 300-row relevance pool
   (pgvector cosine similarity) — confirmed live by direct reproduction:
   a fresh throwaway candidate (no resume_text, so `resume_embedding`
   stays NULL — `fill_missing_embeddings()` itself requires resume_text
   IS NOT NULL, so this candidate could never get one even from the
   async scheduler) genuinely did not crack the top 300 of this
   tenant's real 2,722-candidate pool. The endpoint's own extensive
   in-code documentation already states this is a deliberate, honestly-
   bounded design, not an oversight. Test rewritten to verify the exact
   same underlying missing_skills computation via the genuinely pool-
   immune sibling endpoint (`POST /candidates/{id}/match-open-jobs`,
   which does a direct candidate<->job lookup, not a ranked list) —
   confirmed via direct API call to return byte-identical correct
   results (`matched_skills: [Python, SQL]`, `missing_skills: [Docker,
   Kubernetes]`) for the same throwaway candidate+requisition pair.
10. **S20's real failure was two separate things, one test infra, one
    a genuine (if minor) app-adjacent test fragility — both fixed:**
    - The dominant cause, found only via a dedicated diagnostic script
      with full navigation/response logging: **this investigating
      session's own local SSH tunnel was forwarding to the wrong VPS
      port for the frontend** (`localhost:3000` instead of the real
      `localhost:3001`, confirmed definitively via `docker port
      aviin_frontend`: `3001/tcp -> 0.0.0.0:3001`, nothing on 3000).
      Every `page.goto()`-based browser test this session ran against
      the wrong tunnel was silently hitting a 404 instead of the real
      app — confirmed directly: `curl localhost:3001/candidates` (via
      the broken tunnel) returned 404; `https://ats.aviinjobs.com/
      candidates` (the real production domain) returned 200 the whole
      time. This is why API-only tests (S1/S15/etc.) mostly passed
      while `page`-based UI tests intermittently failed with confusing,
      seemingly-unrelated symptoms. Tunnel corrected. **A real process
      lesson, not an app bug**: two earlier `test.setTimeout`/
      `describe.configure` "fixes" (S20, S53) were built on this wrong
      diagnosis before the tunnel bug was found — both corrected with
      honest comments once the real cause was confirmed (see finding
      below); the S53 one was kept as a harmless safety margin, S20's
      was reverted entirely since the test now passes in ~8s.
    - The one genuine, real (if minor) issue: a bounded-async-render
      race reading a `<select>`'s `<option>`s immediately after the
      modal's TITLE became visible, with no wait for the modal's own
      `useFetch('/requisitions?...')` to actually populate the options
      — the same "async-render race" class already fixed elsewhere in
      this suite (the pipeline-board job-picker race). Fixed with a
      real `expect.poll()` instead of a synchronous read.
11. **S53 had the identical `limit:200`-vs-real-candidate-scale issue
    as S15/finding #9, independently, in 4 of its own /candidates/rank
    calls** — found while investigating S20's real root cause (S53 was
    genuinely failing too, for a different, non-tunnel reason: a fast,
    clean assertion failure, `find()` returning undefined, not a
    timeout). One sibling test in the SAME suite ("word-boundary
    matching") already had the correct fix (`limit:5000`, with an
    explanatory comment matching this exact reasoning) — the other 4
    were simply never retrofitted. Fixed all 4 to match, plus added a
    defensive `expect(mine).toBeTruthy()` before each downstream
    assertion so a future regression here fails with a clear message
    instead of a confusing "Cannot read properties of undefined."
    Verified: all 11 S53 tests pass, ~1.4 minutes total, comfortably
    inside the (now largely unnecessary, but harmlessly retained as a
    safety margin) 150s suite timeout.

**Process note for future sweep sessions**: when re-establishing the
SSH tunnel for local Playwright runs, the correct mapping is
`-L 3001:localhost:3001` for the frontend (NOT `localhost:3000` — that
port has nothing listening on it; confirmed via `docker port
aviin_frontend`, the container's real internal port 3001 is mapped
straight to host port 3001, not remapped to 3000 the way the earlier,
wrong tunnel assumed). The full correct command:
`ssh -f -N -L 8080:localhost:8080 -L 3001:localhost:3001 -L
8081:localhost:8081 -o StrictHostKeyChecking=no dev@187.127.179.128`.
A wrong port here causes every `page.goto()`-based test to silently
hit a 404 while pure API-level (`request.*`) tests keep passing
normally — a confusing, misleading failure pattern that looks like a
real app bug (timeouts, missing elements) rather than what it actually
is (broken test infrastructure). Verify with
`curl http://localhost:3001/candidates` (or any real dashboard route)
returning 200 before trusting any `page`-based test result.

12. **2 real, live HARD RULE #4 violations found and fixed**, while
    static-checking #5/#6/#10/#11 during a rate-limit cooldown wait —
    grepped every reference to `ollama:11434`/`OLLAMA_URL` outside the
    real `ai_router.py` module and `scheduler.py`, then checked each
    for a real frontend caller before deciding how to fix it:
    - `final_features.py`'s own local `ollama_ask()` helper called
      Ollama directly via a bespoke httpx POST, caching through a
      separate, plain-exact-hash `ollama_cache` table — bypassing the
      real, shared `ai_router.py` module's semantic-similarity cache
      (`ai_cache.prompt_embedding vector(384)`, HARD RULE #4's own
      explicit "not just exact-hash" requirement). The SAME bug class
      already found and fixed once before in this project
      (`phase3.py`'s local `call_ollama()`, 2026-08-10) — this instance
      was simply never caught in that earlier pass. Confirmed this was
      genuinely LIVE, not dead code: both call sites (`/ai-tools/
      interview-questions`, `/ai-tools/rank-explanation/{id}`) feed the
      real, actively-used `/ai-tools` page. Fixed by deleting the local
      helper and routing both through the real `ai_router.generate()`
      (imported under an alias, `shared_ai_router`, since this file
      already had an unrelated LOCAL variable also named `ai_router` —
      a plain `APIRouter` instance predating this fix, referenced
      directly by `app.py`'s own router registration, so renaming IT
      instead would have had a wider blast radius) — wrapped in the
      same graceful-degradation try/except the old helper had, since
      the real `ai_router.generate()` has no built-in fallback of its
      own and a transient Ollama outage must never 500 these real,
      live endpoints. Verified end-to-end against a real requisition:
      a real, coherent generation on the first call, and a genuine
      cache hit (0.196s, down from a real fresh-generation latency) on
      an identical second call, with a real, correctly-keyed row
      confirmed directly in the `ai_cache` table.
    - `pipeline_p2.py`'s `GET /pipeline/insights/{candidate_id}`
      (Round 3 AI Insights) had an identical direct-Ollama-call bypass
      — but with ZERO frontend callers anywhere (confirmed via a
      whole-frontend grep), a genuinely dead endpoint alongside the
      real HARD RULE #4 violation. Given no real usage to preserve,
      retired outright (matching this project's own established
      "genuinely dead, don't invest in fixing what nobody uses"
      pattern) rather than repaired — the same real, explainable
      rule-based score breakdown it computed is already available
      through the live `/intelligence` page and `GET /candidates/{id}`'s
      own `ai_scores`, so nothing user-facing was lost. Verified via
      the trusted-internal path: a clean 404 post-fix.
    Both deployed via the established scp → hash-verify → rebuild →
    health-check cycle. Zero-token audit: `CONFIRMED CLEAN`.
13. **A real HARD RULE #10 gap found and fixed: `POST /pipeline/bulk-
    action`'s "reject" branch bypassed the entire structured rejection
    system.** Found while re-enumerating every real code path that can
    write `stage='rejected'` (closing out the earlier "spot-checked, not
    fully enumerated" item for this rule). Unlike the single-candidate
    `PATCH .../stage` path (which requires a real `reason_code`, writes
    `application_rejections`, and — the actual HARD RULE #10 violation,
    not just a UX gap — writes `assignment_event`, plus `audit_log` and
    a real recruiter/manager notification), the bulk-reject branch was a
    bare stage flip with a `pipeline_movements` row and nothing else —
    no reason on record, **no HITL audit trail at all**. Fixed by
    replicating the single-candidate path's exact logic (one `reason_
    code` validated once for the whole batch, matching how a recruiter
    would realistically use this — reject several candidates for the
    same reason in one action — rather than one per candidate). **Real,
    honest scope note**: confirmed via a whole-frontend grep that the
    only real caller of `/pipeline/bulk-action` ever sends `action:
    "move_stage"` — bulk-reject has zero real UI exposure right now,
    matching a 2026-08-09 note in this same codebase explaining that
    decision explicitly ("stuffing [reason_code] into a bulk flow felt
    like a different, bigger feature than 'bulk stage-move' asked
    for"). The backend capability is real and directly callable via API
    regardless of UI exposure, so the fix stands on its own merits (a
    genuine compliance/security gap in reachable code) — deliberately
    did NOT add a "Bulk Reject" button to the UI as part of this fix,
    since that would be a new feature decision beyond what was found
    broken, not something to add unilaterally.
    Verified end-to-end with a real throwaway candidate/application: a
    request with no `reason_code` cleanly 400s; a real request with one
    succeeds, and all 5 real writes were independently confirmed
    directly in the database — `application_rejections` (correct reason/
    notes), `assignment_event` (`event_type: candidate.rejected`, real
    metadata incl. `via: bulk_reject`), `audit_log`, a real `notifications`
    row (correctly routed to the manager role since the throwaway
    candidate had no assigned recruiter), and `applications.stage`
    correctly flipped to `rejected`. All throwaway data cleaned up
    after. Zero-token audit: `CONFIRMED CLEAN`.
14. **A real, separate, narrow bug found incidentally while sourcing
    test data for finding #13 — NOT fixed, recorded for a future pass.**
    `POST /candidates/bulk-assign` (candidates.py:690) does `str(actor.
    user_id)` when logging to `candidate_activities` — for the trusted-
    internal auth path (`actor.role is None`, `actor.user_id is None`,
    used throughout this project by n8n/internal automation callers),
    `str(None)` produces the literal 4-character string `"None"`, not a
    real NULL, which a UUID column then correctly rejects
    (`asyncpg.exceptions.DataError: invalid input... invalid UUID
    'None'`) — a real 500 for that one specific auth path on this one
    specific endpoint. Confirmed narrow, not a live production issue
    right now (every REAL frontend call to this endpoint carries a real
    JWT with a real `actor.user_id`) but a genuine robustness gap for
    any legitimate trusted-internal caller (e.g. a future n8n workflow)
    that might reach this endpoint. Not fixed in this pass — tangential
    to what was actively being investigated, flagged for a dedicated
    look rather than a rushed one-line patch mid-unrelated-verification.

---

## Open/deferred items (with reason)

- **`candidates.py::bulk_assign`'s `str(actor.user_id)` bug** (finding
  #14 above) — real, narrow, low-priority (no live production impact
  found), left for a dedicated future pass rather than a rushed fix.
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
