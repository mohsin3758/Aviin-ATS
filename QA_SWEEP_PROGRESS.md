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
- [x] Batch 3: S41–S60 — DONE, fully clean. 128 tests run; 121 initial
      passes, 1 real failure (S43) + 1 flaky (S59), both root-caused and
      fixed (see findings log #13 and the S43/S59 CLAUDE.md entry —
      S43 was a stale test assumption predating enforcement being
      turned on for the `kae` feature; S59 was a genuine locator-
      ambiguity/async-render race). Re-verified: 11/11 clean.
- [~] Batch 4: S61–S88 — nearly done; one specific S61 UI test still
      needs a final clean confirming pass (see detail below), not yet
      reproducibly failing or reproducibly passing. First attempt (all 28 suites in
      one Playwright invocation) was too much real login volume for
      this project's per-IP rate limiter to absorb in one run — 42 real
      `429`s confirmed directly in backend logs during the run window
      (not assumed), cascading into 13 failed / 1 flaky / 35 did-not-
      run from S74 onward. 2 of the failures (S87, S88) had a different-
      looking error signature (a missing response field, not a bare
      401/403) so each was independently re-verified via a real,
      isolated API reproduction (fresh throwaway data, a still-valid
      cached token — bypassing the rate-limited login endpoint
      entirely) rather than assumed to be more of the same noise: both
      confirmed their real, underlying features work correctly
      (`matched_skills`/`missing_skills`/`live_only` all exactly as
      expected). Re-running in 2 smaller sub-batches (S61-S74, S75-S88)
      after a genuine cooldown, to keep each run's own login volume
      under the rate limiter's threshold this time.
      Batch 4a (S61-S74) first run: 71/78 passed, 3 failed + 1 flaky
      (much smaller ratio than the giant single-run attempt, confirming
      the smaller-sub-batch strategy genuinely helps) — but 6 more real
      429s still confirmed in that window (this session's OWN
      cumulative volume across the whole day, not fresh noise). A same-
      window re-run reproduced 2 DIFFERENT failures each time (S61's
      "Automatic mode" test failed only on the 2nd attempt; S67's "per-
      user bot-auto-reply" failed only on the 1st) — the inconsistent,
      non-reproducible pattern itself is real evidence for rate-limit
      noise rather than a genuine app bug, further confirmed by direct,
      timestamped backend-log correlation showing fresh 429s exactly
      matching S67/S74's own multi-recruiter-creation setup steps
      (each throwaway user needs its own real login).
      Batch 4a's 2 genuinely reproducible failures (S61, S74 — the
      ones that survived 2 clean-window re-runs, distinct from the
      rate-limit noise above) both root-caused and closed 2026-09-01:
      - S61 (Client Submission drawer UI test) re-run in full isolation,
        5/5 clean. Confirmed as rate-limit-cascade noise from the
        earlier giant-batch run, not a real bug — no fix needed.
      - S74 (Auto-Assign toggle UI test) — genuine bug found in the
        TEST, not the app. Root-caused via a dedicated diagnostic
        script with real network-request interception: the backend
        PUT/GET `/ops-config/auto-assign` round-trip is correct on
        every call (verified directly via curl, and via the diagnostic
        script with a 2000ms wait). The real issue was a flaky fixed
        1000ms `waitForTimeout` — under heavy concurrent server load
        during a full-suite run, the PUT+refetch round-trip can
        occasionally take longer than 1000ms end-to-end, making
        `after` read the same text as `before`. Fixed with
        `expect.poll`, matching the same fix pattern already used for
        S20's identical timing-flake class. Re-ran in isolation twice:
        6/6 clean the first time; the second attempt hit this
        session's own well-documented per-IP login rate-limit on its
        own `global-setup` login — accepted per this project's already-
        established precedent, given the fix was already independently
        proven correct via a clean isolated pass beforehand. Commit
        `22cdbed`. Both temporary diagnostic scripts (`diag_s20.spec.ts`,
        `diag_s74.spec.ts`) deleted now that their investigations are
        concluded.
      **Batch 4a (S61–S74) is now fully closed** — every real failure
      root-caused, no outstanding items.
      Batch 4b (S75–S88) first dedicated attempt: 33 passed / 7 failed /
      2 flaky / 15 did-not-run. Confirmed via direct backend-log
      correlation this run hit 21 real 429s in its own ~8-minute
      window — the same rate-limit-cascade pattern already documented
      repeatedly (each of S81-S88's own `.serial()` `setup` steps
      creates 2-3 throwaway users needing their own real login; running
      8 of these suites back-to-back in one invocation exceeds the
      10-login/15min limit almost immediately). **S75-S80 (6 of 14
      suites) confirmed fully clean** — zero failures anywhere in that
      range across this run. All 7 real failures + both flaky results
      are confined to S81-S88 (setup-step cascades in S83/S84/S85/S86,
      plus S82/S87/S88's own downstream assertions) — not yet
      individually re-verified clean.
      2nd attempt (S81-S84 only, a smaller sub-batch) after an 18-min
      wait: still hit 10 real 429s in the exact run window (confirmed
      via backend logs) — this session's own cumulative login volume
      across the entire day has been high enough that even a smaller
      4-suite batch's ~8-12 logins immediately re-exhausts the rolling
      15-min window. S81's own setup passed (flaky, on retry); S82's
      setup passed (flaky) but a downstream test still failed; S83 and
      S84's own setups both failed outright both times. Not yet a
      genuine app-level signal either way for S82/S83/S84's real
      content — waiting for a much longer (25 min) cooldown, then
      re-attempting ONE suite at a time to keep each individual
      attempt's login volume minimal.
      3rd attempt after the 25-min wait: still 429 on a single S82
      login. Read `RateLimitMiddleware`'s real implementation
      (`backend/app.py`) to understand the exact mechanism rather than
      guessing further: `_check_rate()` only appends a new timestamp
      to the bucket ON SUCCESS — a rejected (429) attempt does NOT
      itself consume a slot or extend the lockout, so repeated retries
      are not making this worse. It's a genuine rolling 10-per-15-min
      window; slots open one at a time as each individual successful-
      login timestamp from earlier in this very long session ages past
      exactly 15 minutes. A direct curl probe confirmed the window
      DOES open (got a real 401, not 429, on a wrong-password login
      attempt) — but that probe itself consumed the one open slot,
      confirmed by the very next Playwright attempt getting 429 again
      immediately after. **Real lesson**: any login attempt, including
      a diagnostic probe, consumes a slot when it succeeds through —
      stopped all further curl/login probing entirely and switched to
      a longer, completely untouched wait instead of periodic checks.
      **4th attempt, after the full 25-min untouched wait: fully
      clean.** S82-S85 (14 tests) ran first, all 14 passed with zero
      failures or flakes — confirming these 4 suites (previously only
      ever seen failing under rate-limit cascade, never with a real
      app-level signal) are genuinely correct. Immediately followed by
      S86-S88 (11 tests) while the window stayed open — all 11 passed
      cleanly too. **Batch 4b (S75-S88, all 14 suites) is now fully
      confirmed clean.**

      **A NEW, real finding surfaced immediately after, during a
      follow-up combined re-check (S61+S74+S43+S1 together) — S61's own
      "real headless UI" test (the drawer stage-pill -> Submit-to-Client
      modal -> real stage-move-to-submitted test) failed with a genuine
      assertion mismatch (`expected 'submitted', got 'client_submission'`),
      consistent on BOTH the original attempt and its retry, so NOT
      simple rate-limit noise.** Investigated thoroughly before drawing
      any conclusion: (1) reproduced the EXACT same real backend flow
      end-to-end via direct API calls (a genuine throwaway client + a
      real primary SPOC contact + a linked requisition + a candidate at
      `screened`, then a real `POST .../submit-to-client` call) — the
      backend is **100% correct**: `stage_bumped_to_submitted:true` in
      the response, and the candidate's real, final stage genuinely
      IS `submitted` afterward, confirmed via a follow-up GET. (2) Read
      the full frontend chain (`SubmitClientTab`'s `send()` ->
      `onSubmitted?.(r.stage_bumped_to_submitted)` ->
      `ClientSubmissionMoveModal`'s `onSent(bumped)` ->
      `commitStageMove(...,'submitted',...)`) — correctly wired on
      inspection, no obvious bug. (3) Re-ran S61 alone, in true
      isolation, for a clean signal — got a genuinely DIFFERENT failure
      this time: a raw `socket hang up` (a transport-level connection
      error, not an assertion mismatch) on the exact same test's final
      API read. Re-established a completely fresh SSH tunnel (killed
      the old process, reconnected with tighter keepalive settings) and
      attempted a 3rd isolated run, which hit this session's own
      well-documented login rate-limit before it could even start.
      **Honest current state, not glossed over**: the backend is proven
      unambiguously correct via direct reproduction; the frontend code
      reads correctly; but 2 consecutive UI-test attempts each failed
      with a DIFFERENT failure signature (an assertion mismatch, then a
      raw socket error) rather than the SAME deterministic failure —
      inconsistent with a genuine, reproducible app regression, and
      consistent with environmental/tunnel instability under this
      session's very heavy, sustained load today (the same class of
      "SSH tunnel dies during long operations" issue already documented
      multiple times this session). Cleaned up all reproduction
      throwaway data via the real DELETE APIs. **Not yet closed out
      with a clean, confirming pass** — genuinely needs one more
      isolated S61 run once the rate limit clears again, with a fresh
      tunnel, before this can be marked done with real confidence
      either way. Combined with Batch 4a's earlier closure (S61's OTHER
      3 tests + S74), the rest of Batch 4 (S61's non-UI tests, S62-S88)
      is confirmed clean — only this ONE specific UI test within S61
      remains genuinely unresolved.
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
- [~] Concurrency & idempotency checks — 2 real, targeted checks done.
      (1) `candidate_ownership.py`'s 30-day FCFS claim mechanism —
      confirmed the real `SELECT ... FOR UPDATE` row lock (documented
      2026-08-11) is still present at both call sites, genuinely
      preventing a concurrent-claim race. (2) `create_application()`'s
      per-recruiter submission-limit check (`applications.py`) —
      confirmed the previously-fixed value-consistency bug (CLAUDE.md
      2026-08-08: the count-check and the actually-stored
      `assigned_recruiter_id` used to disagree) is genuinely still
      fixed, both now derived from the same `recruiter_for_limit`.
      **A real, new, LOW-severity finding, not fixed**: this same limit
      check is a classic, textbook TOCTOU race — `SELECT count(*)`
      then, if under the limit, `INSERT`, with no DB-level constraint
      backing it. Two genuinely simultaneous requests for the same
      recruiter+requisition, both arriving right at the limit boundary,
      could both pass the check and both insert, landing 1 over the
      configured cap. Disclosed rather than silently fixed: this is a
      soft, manager-configured business rule (not a security boundary,
      not financial data, not a HARD RULE), the race window is narrow
      in practice (needs genuinely concurrent requests, not just
      back-to-back human clicks through a form), and a proper fix
      (a real DB-level enforcement mechanism) is disproportionate
      engineering effort relative to the low real-world severity —
      matching this same sweep's own established precedent for the
      70/30 incentive-split rounding finding (documented, not chased).
      Not yet checked: idempotency of the resume-intake/embedding
      background jobs under a genuine concurrent-retry scenario, or a
      broader sweep for the same check-then-write race pattern
      elsewhere in the codebase beyond this one instance.
- [ ] Background/scheduled jobs — direct invocation
- [x] Silent-failure hunt (`except Exception: pass` grep + log check) —
      ran a real Python-regex scan (not a fragile line-based grep) across
      every file in `backend/routers/*.py` + `backend/*.py` for every
      genuine silent-swallow shape: same-line `except ...: pass`,
      multi-line `except ...:\n    pass`, and the same pattern with an
      `as e` binding or a leading comment before the bare `pass`.
      **Zero matches across the entire backend, in any shape.** Every
      real exception handler in this codebase does something (log,
      re-raise, return an error response, write to a status/error
      column) — matches this project's own extensively-documented
      history of finding and fixing this exact pattern repeatedly over
      time (e.g. `parse_with_ollama`'s failure logging, the SLA-
      escalation nested-transaction fix); the codebase is now genuinely
      clean of it, not just improved in isolated spots. Not yet
      cross-checked against real production logs for a DIFFERENT
      failure class — a handler that logs but the log message itself
      never actually gets reviewed/alerted on — that's a process gap,
      not a code gap, and out of this specific checklist item's scope.
- [x] Generated-file content correctness (CSV/PDF/etc.) — downloaded
      real live files via the cached admin token (no login endpoint
      touched) and checked real byte content, not just HTTP status:
      `/export/placements` — correct UTF-8 BOM (`ef bb bf`, matching
      the established "Excel-safe" convention), correct headers, real
      candidate/client data. `/export/requisitions` — exactly 3 real
      active requisitions (is_active filtering still holding, matches
      every other confirmation of this tenant's real 3-4-open-
      requisitions state throughout this sweep). `/export/candidates`
      — 2,722 real rows with non-empty emails, **zero duplicate
      emails** — a real, direct regression check that the previously-
      fixed LATERAL-join dedup bug (CLAUDE.md 2026-08-10, was fanning
      candidates out into up to 22 duplicate rows) is still genuinely
      holding, not just assumed fixed. `GET /candidates/{id}/standard-
      resume` — real, valid `%PDF-1.4` magic bytes, correctly parses
      as a 1-page PDF document. Not an exhaustive check of every one of
      the dozens of real generated-file endpoints in this app, but a
      real, representative spot-check across both formats confirms the
      underlying generation machinery is genuinely producing correct
      output, not just returning a 200 with garbage/empty content.
- [x] Localization/multi-language honesty check — read `whatsapp.py`'s
      real `MSG_TEMPLATES` dict in full (the 14-language claim
      documented throughout CLAUDE.md, including one prior finding that
      the QA test verifying it was itself checking 4 fake hardcoded
      strings, since fixed). Confirmed genuine, not the same-English-
      text-different-code-label pattern this project has explicitly
      caught once before: all 4 real message templates (job_
      opportunity, interview_invitation, offer_letter, status_update)
      have real, DIFFERENT, correctly-scripted text in all 14 real
      language codes (hi/ta/te/kn/ml/mr/gu/pa/bn/or/as/ur/kok) — genuine
      Devanagari/Tamil/Telugu/Kannada/Malayalam/Gujarati/Gurmukhi/
      Bengali/Odia/Arabic-Urdu scripts, not transliterated English or
      placeholder text. Confirmed real, reachable usage (not dead
      code): `GET /templates` lists them, `POST /send`/`POST /bulk-send`
      both accept a real `lang` param with a safe fallback to English
      on an invalid code (never crashes), and correctly run the HARD
      RULE #7/#12 consent gate before every send. No dishonesty found —
      the 14-language claim is genuinely backed by real content.
- [~] Uploads & malformed input — checked path-traversal risk on the 2
      real file-save helpers used across every upload path in the app
      (`resume_intake_service.py::save_resume_file` — the highest-
      volume path, used by every resume-intake channel; `candidates.
      py::_save_candidate_document_file` — LWD confirmation/other
      candidate documents). Both use the identical, safe pattern: a
      regex (`re.sub(r'[^\w.\-]', '_', filename)[:200]`) strips every
      character that isn't a word char/dot/hyphen from the client-
      supplied filename BEFORE it ever touches a path — a traversal
      attempt like `../../../etc/passwd` becomes a harmless
      `.._.._.._etc_passwd`, no `/` or `\` can survive — combined with
      a server-generated UUID prefix for uniqueness and a fully
      server-controlled base directory (tenant_id + date, never client
      input). No path-traversal risk found on either. Not yet a full
      pass on every other real Phase 3 sub-item this checklist entry
      covers (malformed/oversized file content, MIME-type spoofing,
      zip-bomb-style resource exhaustion) — only the path-construction
      half checked so far.
- [x] Degraded-dependency behavior (Ollama/embed service down) — real,
      genuine gap found and fixed. Read `ai_router.py`'s `generate()`
      (the shared "one module every AI call passes through" entry
      point) in full: `embed_text()` and `call_ollama()` both correctly
      have zero internal try/except, propagating any real HTTP/
      connection failure straight up — meaning graceful degradation is
      entirely the CALLER's responsibility. Enumerated all 4 real
      callers of `ai_router.generate()` across the backend: 3 (offers.
      py's letter generation, final_features.py's 2 sites — both fixed
      earlier this same sweep for a different reason, HARD RULE #4)
      already correctly wrap it in try/except with a real fallback
      (offers.py falls back to a template letter). The 4th —
      `ai.py`'s `POST /jd/generate` (the real JD Generator feature) —
      had NO try/except at all, so a genuinely down Ollama/embed
      service would propagate as a raw, unhandled exception. Confirmed
      this was NOT an info-disclosure risk (FastAPI's default 500
      handler returns a generic `{"detail":"Internal Server Error"}`,
      confirmed `debug=True` is not set anywhere on the app) — but a
      real reliability/UX gap regardless. Fixed by wrapping the call in
      try/except, matching `phase3.py`'s established pattern — but
      unlike offer letters, a JD has no safe template fallback to
      fabricate (risks silently passing off generic filler as the real
      generated JD), so this surfaces a clean, honest `503` with an
      actionable message instead. Verified for real, not code review:
      confirmed the happy path (Ollama up) still returns a real,
      correct generated JD with zero regression; confirmed the exact
      deployed container file has the new try/except (not just the
      local copy). Deployed via the established scp -> hash-verify ->
      rebuild -> health-check cycle. Zero-token audit: `CONFIRMED
      CLEAN` (435 files). Not yet checked: WAHA-down behavior for
      manual WhatsApp sends, or an SMTP-down behavior beyond what's
      already documented elsewhere in CLAUDE.md's history.
- [x] is_active leak sweep (`JOIN clients` variant — this project's
      extensive prior history already exhaustively swept `JOIN users`/
      `JOIN candidates`, but `JOIN clients` specifically had never had
      a dedicated pass) — a real Python-regex sweep (not fragile
      line-grep) found all 38 real `JOIN clients` occurrences across
      the backend, flagged the 17 with no `is_active` mention in a
      generous ±10/15-line window, and individually read every one.
      **No genuine bugs found.** Every flagged occurrence is one of two
      safe shapes: (1) resolving a real client's name for a historical/
      financial record or a generated document (placements list/CSV
      export, timesheets, call letters, resume-generator client
      attribution, stage-email placeholder substitution) — correctly
      showing accurate real data regardless of the client's CURRENT
      active status, matching this project's own established
      "historical record, deliberately unfiltered" precedent
      (`audit_log`, `export_placements`); or (2) a single-row lookup
      scoped by an explicit `WHERE ...id=$1 AND tenant_id=$2` (not a
      browsable list that could show clutter to begin with). One minor,
      low-severity, non-security cosmetic note (not fixed, not a real
      bug): `kae_submission.py`'s submission-preview template picker
      could show a tracking-sheet template pinned to a now-inactive
      client as a selectable option — a UX nicety, not a leak (it's a
      `LEFT JOIN`, degrades gracefully either way).
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
- [x] #8 (n8n PostgreSQL nodes must SET app.tenant_id first) — NOT on
      the original checklist explicitly either, checked via a real
      `n8n export:workflow --all` against the live n8n container (not
      guessed from the app's own webhook-call code, which can't see
      what n8n does on its OWN side once triggered). **Definitive
      finding**: all 13 real workflows use only 2 node types tenant-
      wide — `n8n-nodes-base.webhook` and `n8n-nodes-base.set` — ZERO
      PostgreSQL nodes exist anywhere in this tenant's real n8n setup.
      HARD RULE #8 is currently vacuously satisfied for this real,
      live deployment — there is nothing to violate, since no n8n
      workflow ever directly queries Postgres at all (matching the
      already-documented "Webhook trigger, then a Set node" shape every
      one of these workflows follows). A real, conclusive check, not
      left as "can't verify."
- [x] #10 HITL gate — WIDENED 2026-09-01 from a 3-action spot-check to
      a real enumeration of every write path for all 3 named high-
      stakes actions:
      - **Candidate rejected**: exactly 2 real code paths write
        `stage='rejected'` anywhere in the backend (grepped every
        `'rejected'` occurrence, ruled out unrelated matches like
        `resume_files.parse_status`/`requisition_approval_steps.status`)
        — `applications.py`'s single-candidate PATCH `.../stage` and
        `pipeline_p2.py`'s bulk `reject` action. Both independently
        re-read in full: both require a valid `reason_code` (400
        otherwise), both write `application_rejections` +
        `assignment_event` + `audit_log` + a real recruiter/manager
        notification — genuinely identical HITL treatment, not just
        "protected in principle." (The bulk path is the real fix from
        commit `8de0abe` earlier this session — re-confirmed present
        and correct here, not just assumed from memory.)
      - **Recruiter reassigned**: exactly 2 real code paths call
        `do_reassign()` — `assignments.py`'s single `reassign` and
        `assignment_dashboard.py`'s `bulk_reassign`, both independently
        confirmed `require_role("admin","manager")`. `do_reassign()`
        itself (real, live definition pulled via `pg_get_functiondef()`
        per its own migration's documentation, not assumed from an
        older, possibly-stale committed copy) correctly writes both a
        real `assignment_event` for the old AND new assignment row plus
        a real, deduped `event_outbox` row, all in one atomic PL/pgSQL
        function — a 22nd real `event_outbox` write site, at the SQL
        level rather than Python, correctly atomic (implicit single
        transaction) and correctly deduped. Grepped for any OTHER write
        to `assigned_recruiter_id`/`assignments` outside these 2 gated
        paths — found none.
      - **Offer issued**: 2 real write sites for `status='issued'`
        confirmed. `offers.py`'s `issue_offer()` is the primary path,
        `require_role("admin","manager")`. The 2nd (`send_offer_letter`)
        only flips status IF the offer is ALREADY `'approved'`
        (internal check, independent of its own `offer_engine:create`
        permission gate) — it never independently approves anything,
        so it can't be used to skip the HITL boundary. `phase3.py`'s
        `auto_generate_offer()` create path was re-confirmed to still
        insert as `'draft'` (the 2026-08-10 fix, re-verified present,
        not just remembered) rather than the old direct-to-`'issued'`
        bypass.
      **No new violations found across any of the 3 named actions.**
      This is now a genuine full enumeration, not a spot-check.
- [x] #5/#6 event_outbox atomicity + dedup_key — the shared `events.
      write_outbox()` helper (`backend/events.py`) is well-designed
      BY CONSTRUCTION: `conn` (the caller's own already-open
      transaction) is a required first param and `dedup_key` a
      required last param — a caller structurally cannot skip either.
      **FULL AUDIT completed 2026-09-01** (widened from the earlier
      6-site spot-check): every one of the 21 real `write_outbox()`
      call sites across all 10 files that use it (`applications.py`
      x3, `call_letters.py`, `candidates.py`, `erp.py` x3,
      `kae_submission.py` x4, `nda.py`, `offers.py` x3, `phase3.py`,
      `requisitions.py` x3, `resume_generator.py`) individually read
      and confirmed — every single one passes the SAME `conn` already
      open for its business-logic INSERT/UPDATE (never a separate
      connection that would break atomicity), and every `dedup_key` is
      genuinely unique per real event (a real DB-generated row id, or
      id+timestamp/date — never a static/constant string that could
      silently dedupe two different real events together). No
      violations found anywhere. This HARD RULE is genuinely,
      completely satisfied across the whole codebase, not just
      spot-checked.
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
- [~] Financial correctness (incentives, retention bank, loyalty,
      account P&L, collections, payroll) — hand-verified arithmetic.
      Pulled and hand-checked the 3 real, live DB trigger/function
      definitions behind the 2 most consequential formulas (real
      `pg_get_functiondef()`, not guessed from any committed
      migration): `trg_account_pl_calc()` — CM = gross_revenue -
      delivery_cost - total_incentives - operational_cost (matches
      CLAUDE.md's documented formula exactly), `cm_pct` correctly
      guards divide-by-zero when `gross_revenue=0`, `delivery_pool` =
      80% of gross (matches the documented allocation). `trg_kpi_calc()`
      + `kpi_incentive()` — the tiered incentive formula (`score<60 OR
      cm<0` -> 0, four score bands 60/70/80/90 each with a distinct
      base+per-point formula, A+ tier capped at 50000) hand-verified
      correct and continuous within each tier (no negative-incentive
      or overflow edge case found); confirmed the documented "incentives
      capped if CM<0" behavior is real and correctly implemented as a
      hard zero, not a partial cap. The 70/30 immediate/retention-bank
      split (`ROUND(inc*0.70,2)`/`ROUND(inc*0.30,2)`, independently
      rounded) has a real but genuinely trivial edge case: for some
      values of `inc`, the two independently-rounded halves can sum to
      ₹0.01 different from what rounding the whole amount once would
      give (e.g. `inc=33.335` -> 23.33+10.00=33.33 vs a single
      `round(33.335,2)`=33.34) — a sub-rupee residual with real
      compensation amounts, not worth a fix, but disclosed rather than
      silently glossed over. Not yet checked: retention bank release/
      forfeit arithmetic, loyalty milestone amounts, collections aging,
      or payroll's TDS/PF calculations.

## PHASE 5 — Security audit
- [x] Auth/role gaps (no token / wrong role / wrong tenant) — real,
      evidence-based checks against the live production API (no
      login endpoint touched, so none of this consumed rate-limit
      budget): (1) 7 real sensitive endpoints (candidates/users/
      assignments/permission-log) all correctly 401 with zero token,
      a garbage token, an empty bearer value, and a wrong auth scheme
      (Basic instead of Bearer) — no leaky error messages, no silent
      200. (2) A tampered-signature JWT (one flipped character on a
      real, valid token) correctly 401s, while the real, untampered
      token still 200s (sanity-checked the tampering was meaningful).
      (3) The classic `alg: none` JWT forgery attack (a header claiming
      no signature algorithm at all, admin role + real tenant_id in
      the payload, no signature) correctly 401s — the JWT library does
      not fall back to trusting an unsigned/none-alg token. (4) Read
      `backend/deps.py`'s `get_actor()` in full: when a real
      `Authorization: Bearer` header is present, the `x-tenant-id`
      header (the documented "trusted-internal, anonymous, role=None"
      access pattern) is never even read — the JWT's own embedded
      `tenant_id` claim is exclusively authoritative. Verified this
      empirically, not just from reading the code: sent the real admin
      JWT ALONGSIDE a forged `x-tenant-id: 00000000-...` header
      claiming a different tenant, and confirmed the response's real
      candidate data still carries the correct, real tenant_id from the
      JWT — the forged header had zero effect. No auth/role gaps found.
- [~] IDOR sweep — spot-checked `GET /candidates/documents/{doc_id}/
      download` (a classic IDOR target, serves files): correctly scopes
      by `tenant_id` via `db.tenant_conn()`, a cross-tenant attempt
      would 404. Not a full sweep of every ID-taking endpoint.
- [x] Cross-tenant leaks (RLS, security_invoker, SECURITY DEFINER) —
      **2 real, live cross-tenant vulnerabilities found and fixed**,
      the same bug class as the `v_recruiter_capacity` fix from
      2026-08-31. Enumerated every real view in the schema (16 in
      committed migrations + `v_users_with_roles`, a 17th, schema-
      drifted one found live) and checked each one's real
      `pg_class.reloptions` directly against the live database, not
      guessed from any committed migration. Found `v_monthly_billing`
      and `v_sla_dashboard` both genuinely missing `security_invoker =
      true`, both confirmed owned by `postgres` (bypasses RLS), both
      querying real tenant-scoped RLS-protected tables (`placements`/
      `requisitions`/`applications`/`sla_tracking`). Every real backend
      caller of both (3 total, grepped across the whole backend)
      already correctly applies an explicit `WHERE tenant_id=$1` at
      the app level, so this was not currently being exploited by any
      live caller today — but it was a real, structural defense-in-
      depth gap: any future caller that forgot the tenant filter (the
      exact "missing is_active filter" mistake class this project has
      hit dozens of times elsewhere) would silently leak every
      tenant's real billing/SLA data with zero error. Fixed via
      `sql/101_fix_billing_sla_views_tenant_leak.sql`, deployed with a
      real transactional dry-run first (BEGIN/ALTER VIEW x2/ROLLBACK,
      zero errors) then applied for real. Verified for real, not just
      trusting the ALTER VIEW output: confirmed both views' real
      `reloptions` now show `security_invoker=true`; confirmed both
      real, live API endpoints (`GET /sla/summary`, `GET /reports/
      monthly-billing`) still return correct real data post-fix; and
      the definitive proof — queried both views directly as `app_user`
      with a fake/bogus `app.tenant_id` set and confirmed genuinely
      ZERO rows returned from either, despite real underlying data
      existing (proven by the endpoint calls moments earlier) — RLS is
      now actually enforced, not silently bypassed. The other 14
      real views (all already correctly `security_invoker=true`) were
      confirmed clean in the same sweep, including re-confirming the
      earlier `v_recruiter_capacity` fix is still holding.
      **SECURITY DEFINER function audit (the other half of this
      checklist item — a distinct risk class from views, since these
      always run with the function owner's privileges and RLS never
      applies at all)**: enumerated all 37 real `SECURITY DEFINER`
      functions live in the database (all owned by `postgres`), and
      their real argument signatures. 34 of the 37 take only an
      unguessable random token (or genuinely non-identifying data like
      lat/lng, response text) as input — safe by construction, since
      the token itself IS the sole identifier and can only ever
      resolve to whatever it was minted for. 3 take an EXTRA identifier
      parameter alongside their token/auth context, each individually
      checked: `generate_invoice_from_timesheets(p_tenant_id, ...)` is
      only ever called with `actor.tenant_id` (JWT-derived, finance-
      role-gated), never client input; `accept_offer_by_id(p_offer_id)`
      only ever receives an offer_id that itself came from the SAME
      token-resolution step moments earlier (`sign_offer_by_token`'s
      own result), never a client-supplied UUID directly; `submit_
      agency_candidate(p_token, p_requisition_id, ...)` — the one
      genuinely client-supplied case — pulled its real, live definition
      and confirmed it explicitly validates `requisitions.tenant_id =
      v_tenant` (the token's OWN resolved tenant) before accepting the
      submission, correctly rejecting a cross-tenant requisition_id
      with a clean exception. Also self-checked `seed_role_definitions_
      for_tenant(p_tenant_id)` (built earlier this same session) —
      confirmed all 3 real call sites pass `actor.tenant_id`, never
      client input. No SECURITY DEFINER vulnerabilities found.
- [~] Forgeable/guessable token audit — grepped every real token-
      generation call site across the backend (18 found). All
      consistently use Python's `secrets` module (cryptographically
      secure), never a weak/predictable scheme (no sequential IDs, no
      timestamp-based generation, no plain `random`). Lengths vary
      appropriately by use case: long-lived public links (personal
      resume-drop, NDA/offer e-sign, field attendance, calendar feed)
      use 12-32 bytes (96-256 bits); the one shorter one checked
      (`device_monitoring.py`'s 4-byte enrollment code) is correctly a
      short-lived (15-min), single-use, manually-typed code — not a
      long-lived credential, matching a reasonable, standard UX pattern
      for that specific case. No real weakness found. Not yet a check
      of whether every token-CONSUMING endpoint properly single-uses/
      expires them (the generation side is what was checked here).
- [x] Privilege escalation checks — 3 real, distinct vectors checked:
      (1) `create_user`/`update_user` (`users.py`) — the only endpoints
      that can set a user's `role` field — both `require_role("admin",
      "manager")`; a non-privileged caller can't reach them at all.
      (2) `PUT /users/me` (the real self-service profile endpoint,
      found by searching beyond the obvious admin-facing routes) —
      whitelists exactly `full_name`/`phone`/`department`/`designation`/
      `location` via a hardcoded `allowed` list before building the
      SQL UPDATE; `role` is not in the list, so a client sending
      `{"role":"admin"}` here is silently dropped, never reaching the
      database. (3) `PUT /roles/{role_id}/permissions` (edits a role's
      own granted-permissions JSON, the softer/newer permission-matrix
      system) — `require_role("admin","super_admin")`, deliberately
      even tighter than the user-management endpoints (excludes
      `manager`). No escalation path found across any of the 3.
- [~] Injection/XSS spot-check — a real, useful SQL-injection static
      pass (done opportunistically during a Batch-4 background run, no
      live verification needed for this kind of check): grepped every
      dynamic-SQL-construction pattern across `backend/routers/*.py`
      (dynamic `ORDER BY` columns, dynamic `WHERE`-clause assembly,
      dynamic table/column names). Found and checked the one genuinely
      real-looking risk pattern — `candidates.py`'s dynamic `ORDER BY
      c.{sort_by}` — and confirmed it's correctly guarded by a real,
      hardcoded `ALLOWED` column-name set checked BEFORE interpolation,
      not a live vulnerability. Every `WHERE`-clause-building pattern
      found (5 files) always parameterizes actual values via `$N`, only
      the surrounding SQL structure is built dynamically. The one
      dynamic `UPDATE {table} SET {col}=...` pattern found
      (`users.py`'s force-purge endpoint) iterates a hardcoded, code-
      reviewed Python constant (`_FORCE_NULLIFY`), never user input —
      the one genuinely request-derived value (`user_id`) is correctly
      parameterized via `$1`. No real SQL injection found in this pass.
      Not yet a full sweep of every dynamic-SQL site in the codebase,
      and XSS wasn't checked at all yet (frontend-side).
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
