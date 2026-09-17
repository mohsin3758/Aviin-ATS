# AVIIN ATS — Recruitment Workflow Gap Analysis
**Scope:** Sourcing-to-submission workflow for 5 recruiters, ~60+ profiles/role, vs. the "Google Sheet Style" requirements doc.
**Method:** Ground-truth code audit (6 parallel searches across the real backend/frontend/SQL, every claim below is file:line cited). No code was changed to produce this report.
**Date:** 2026-09-18

---

## Executive Summary

The requirements doc reads like a from-scratch build. It isn't one. AVIIN ATS is a mature, ~140-migration system that already has working versions of most of what's asked — including a **fully built WhatsApp screening automation** (consent, structured CTC/notice/location extraction, per-recruiter throttled dispatch, reminders) that goes further than the spec's own WhatsApp questionnaire ask. The real gaps cluster into a handful of specific, scoped items — not a rebuild.

**The 5 gaps that actually matter:**
1. No spreadsheet-grade grid — today's candidate tables are real (sortable, filterable, exportable, bulk-select) but have **no inline cell editing and no copy/paste**, and no grid library is installed.
2. **Status model doesn't match the wishlist.** `applications.stage` is a free-form, tenant-customizable string, not the fixed 16-value enum requested — and there's no way to represent "sourced but not yet linked to a role" at all today.
3. **No hard KAM approval gate.** The "KAM approves/rejects/returns to recruiter" step is a soft, non-blocking marker (`kae_decision`) — a KAE can submit straight to a client with no KAM sign-off.
4. **Client management UI is incomplete** — full CRUD exists in the backend, but the frontend only lets you view clients and change their tier.
5. **Skills-per-candidate isn't a clean "skill → years" map** — it's flat tags, plus a project-history table with free-text years, not a structured number you can filter/sort on.

Everything else below is either genuinely already there, or a small additive change to something that already works.

---

## Part 1: Module-by-Module Status (per the audit's own checklist)

| Module | Status | Note |
|---|---|---|
| Candidate Management | **Available** | Real schema, but 2 columns (`current_designation`, `linkedin_url`) are used in code with no tracked migration — schema drift, not missing functionality. |
| Resume Upload | **Available** | `resume_files` table + storage pipeline. |
| Resume Parsing | **Available** | pdfminer + Tesseract/OpenCV OCR fallback, regex/NER + optional Ollama enhancement, confidence score stored per resume. |
| Candidate Search | **Partially Available** | Search box + filter-bar (skill, location, employer, exp range, source, tag, owner) — real, but per-column spreadsheet-style filters don't exist, and skill+years can't be filtered together. |
| Job Management | **Available** | Two distinct systems: internal `requisitions` (client-linked, what recruiters work from) and a separate public `/jobs` job board. |
| Client Management | **Partially Available** | Backend has full CRUD (`POST/GET/PUT/DELETE /clients`); frontend only supports viewing clients + changing priority tier — no create/edit form. |
| WhatsApp Integration | **Available — more mature than requested** | See Part 2.8. |
| Email Integration | **Available** | (Verified directly in this session, not by the audit agents.) Per-recruiter IMAP IDLE sync of Sent/Inbox folders, SMTP send with resolved signatures, tracking-sheet HTML tables, message-ID matching between sent mail and the Conversations inbox. |
| User Management | **Available** | Dynamic `role_definitions` (27 seeded roles, custom roles creatable), feature×action permission matrix UI. Enforcement itself is a soft, per-tenant opt-in flag — worth knowing, not a gap. |
| Recruiter Dashboard | **Partially Available** | 3 separate, non-overlapping reporting systems (see Part 2.11) — none of them alone is the full 8-stage funnel with day/week/month cadence the wishlist wants. |
| Reporting | **Partially Available** | Same as above — real data, fragmented across pages. |
| Role Management | **Available** | Same system as User Management. |
| Activity Logs | **Partially Available** | Real per-candidate timeline UI exists, but "Candidate Created" and "Candidate Replied" are never written to it (see Part 2.10). Global audit page's backend supports a candidate filter; the frontend never uses it. |
| Candidate Notes | **Partially Available (unverified UI)** | A `note` activity type is written from the backend (`p23_p27.py:765-768`); a dedicated Notes UI was not directly confirmed in this pass — verify before relying on it. |
| Candidate Ownership | **Partially Available** | Real FCFS lock system exists and is enforced — but it's a **30-day** lock, not 90, `manager` role is also exempt (not just admin), and it's invisible on the recruiter-ops/recruiter-tracking pages. |
| Pipeline Management | **Available** | Tenant-customizable stages via `pipeline_stage_config`, deliberately not a fixed enum (see Part 2.13 for why that matters here). |
| Duplicate Detection | **Available (detection) / Partially (surfacing)** | Real 3-stage rule engine (file hash, normalized email/phone, LinkedIn URL, fuzzy name+employer) with a review queue UI — but a detected duplicate shows only the two names/emails/phones, never the "existing recruiter / client / role / status / last updated" the wishlist explicitly asks for. |

---

## Part 2: Findings by Theme

### 2.1 Candidate Data Model & Schema Drift
Base table (`sql/01_phase1_schema.sql:79-94`) plus 8+ tracked additive migrations cover name, email, phone, skills, experience, location, CTC, notice period, source, and more. Two fields — `current_designation` and `linkedin_url` — are used throughout `candidates.py`/`schemas.py` but have **no tracked migration anywhere**, the same schema-drift pattern this codebase has hit and fixed before (`sql/128_screening_sessions.sql` did exactly this for CTC/notice/location). Cheap, low-risk fix.

### 2.2 Duplicate Detection
`backend/services/dedup_service.py` does real work: exact file-hash, normalized email, normalized phone, LinkedIn URL match, plus fuzzy name+employer/designation matching. The review queue (`/duplicates`) is a working Pending/Merged/Dismissed UI with one-click merge. The gap is narrow: the match result never joins to `applications`/`requisitions`/`candidate_ownership`, so a recruiter sees "these two look the same" but not "and this one is already owned by X, submitted to client Y for role Z, last touched on date W" — which is the actual point of a duplicate check for this workflow.

### 2.3 Resume Upload & Parsing
Genuinely solid: OCR fallback for scanned resumes, a real extraction pipeline for name/email/phone/skills/experience/company/designation/LinkedIn, optional LLM enhancement via the zero-token-cascade's Tier 2, and a stored confidence score per parse. Nothing to build here.

### 2.4 Skills & Project Structure
`candidates.skills` is a flat `TEXT[]`. A separate table, `candidate_skill_experience`, stores per-project rows (skill, project name, date range, role type, free-text "relevant experience") — closer to a work-history log than the wishlist's clean "Java – 7 Years" map. `mandatory_skill_min_years JSONB` exists, but on `requisitions` (a JD's threshold), not on candidates. If the sourcing workflow genuinely needs "type a skill, type years, done" as a fast recruiter action, that's a real gap against the current project-history model.

### 2.5 Client & Requisition/Role Management
`requisitions.client_id` already links roles to clients, and `GET /requisitions?client_id=X&status=open` already gives you "pick a client, see their open roles" — the exact backend behavior a client→role dropdown needs. The only missing piece is the client CRUD *frontend* (create/edit forms) — the API is already there.

### 2.6 Candidate-to-Role Assignment
A candidate can already be linked to multiple requisitions simultaneously (one `applications` row per requisition; the unique constraint only prevents a duplicate application to the *same* role). "Assign to one or multiple roles" already works structurally.

### 2.7 KAE/KAM Submission & Approval Gate
This is a real, business-relevant gap. `kae_decision` (shortlisted/not_selected) is explicitly documented in its own migration as "a soft marker only, never a hard gate." The endpoint that actually emails a client, `submit-to-client`, is gated to `admin, super_admin, manager, kae, kam` — meaning a KAE can send to a client with **zero KAM sign-off**, despite the wishlist's "KAM approves/rejects/returns to recruiter" flow. If that approval step matters to you operationally, it needs to be built — it doesn't exist as a hard rule today.

### 2.8 WhatsApp Integration & Screening Automation
The biggest positive surprise of this audit. `screening_sessions` + `consent_records` are fully built and wired, not just planned. The bot already runs a structured, multi-turn conversation that extracts **current CTC, expected CTC, notice period, is-serving-notice, and location** straight into candidate fields (`screening_extraction.py`), plus per-skill/project detail into `candidate_skill_experience`. Sending is throttled per recruiter's own connected WhatsApp number (`user_whatsapp_accounts`), with warm-up ramping, daily caps, and automatic reminders/re-engagement — all scheduler-driven. The only real gaps: (a) this questionnaire isn't auto-triggered by plain candidate creation — it needs an explicit enroll action today; (b) "total experience," "willing to relocate," and "available for interview" aren't yet asked as their own structured questions (only CTC/notice/location are). Both are small, additive changes to a system that already works — not new infrastructure.

*(Note: this directly contradicts an earlier planning document in my own memory that assumed this screening system hadn't been started yet. It has — and it's further along than that plan assumed. I'll correct that record.)*

### 2.9 Candidate Ownership & Locking
A real first-recruiter-wins lock exists (`candidate_ownership` + history table), enforced across applications/communications/candidates routers, with admin/manager transfer and a UI on the candidate list and detail page. Two deltas from the spec: the lock is **30 days**, not 90 (a one-line constant, `OWNERSHIP_DAYS` in `candidate_ownership.py`) — and `manager`, not just `admin`, can also bypass the lock. Neither is wired into the `recruiter-ops`/`recruiter-tracking` pages at all.

### 2.10 Activity Timeline & Audit Log
`GET /activities/{candidate_id}` + a real timeline UI on the candidate detail page already exist, logging stage changes, document uploads, messages sent, offers, and interviews. It's missing exactly two event types the wishlist's example timeline leads with: **"Candidate Created"** and **"Candidate Replied"** — both are silently written to other tables (`event_outbox`, `candidate_messages`) today but never to `candidate_activities`, so they never show up in the timeline. Separately, the global `/audit` page's backend already accepts a candidate filter that the frontend simply never calls.

### 2.11 Recruiter Productivity Dashboards & Reporting
Three separate systems exist and don't talk to each other: a daily/weekly time-series version (Sourced/Screened/Submitted/Interviews/Offers/Placements — missing distinct Contacted/Interested/Qualified counts), a full-funnel snapshot version keyed to real pipeline stages (closer to the wishlist's stage names, but date-range only, not bucketed by day/week/month), and a monthly leaderboard with only submissions/interviews/offers/placements. None alone is "the" recruiter productivity dashboard the wishlist describes.

### 2.12 User/Role/Permission Management
Fully built: dynamic roles (not hardcoded), a feature × action permission matrix, dedicated user-management and permission-management pages. Enforcement is intentionally soft (logged, not blocking) unless a tenant explicitly turns it on — worth confirming that's still the desired posture, but it's a configuration question, not a missing feature.

### 2.13 Status/Stage Model
This is the one piece of the wishlist that's structurally at odds with a deliberate past decision in this codebase. `applications.stage` used to be a fixed CHECK enum and was **deliberately loosened** to a permissive regex specifically so tenants could add custom stages without a migration (`sql/16_custom_stages.sql`). The default seeded stages (`sourced, contacted, interested, nda, screened, submitted, l1_interview, l2_interview, offer, offer_accepted, placed, hold, rejected`) don't match the wishlist's 16-value list, and — more importantly — `applications` requires a `requisition_id`, so there's **no way today to represent "sourced, not yet linked to any role"**, which is exactly the state a recruiter is in for most of their 60-profiles-per-role sourcing work. This needs a real product decision, not just a code change (see Part 4).

### 2.14 Candidate Grid UI & Spreadsheet Behavior
Both the Candidates page and Resume Inbox are real `<table>` grids — sortable by column, filterable via a filter bar, exportable to CSV, with proper multi-select bulk actions. What's missing, confirmed by checking `package.json` directly, is any grid library at all (no ag-grid, react-data-grid, handsontable, tanstack-table) — every table is hand-rolled JSX. That means **no inline cell editing** (edits go through a separate modal) and **no copy/paste** across cells. This is the literal gap behind "should behave like Google Sheets."

---

## Part 3: Prioritized Gap List

1. No spreadsheet-grade grid (inline edit, copy/paste, no library installed)
2. Status model mismatch + no pre-application "sourced" state
3. No hard KAM approval gate before client submission
4. Client management frontend CRUD missing
5. Skills-per-candidate not a clean skill→years structure
6. Screening questionnaire not auto-triggered on creation; 3 questions missing (total experience, relocation, interview availability)
7. Ownership lock is 30 days not 90; not surfaced on recruiter-ops/tracking pages
8. Timeline missing "Created"/"Replied" events; audit page missing candidate filter in the UI
9. Recruiter productivity fragmented across 3 systems, no unified day/week/month funnel
10. Duplicate-match surfacing doesn't show owner/client/role/status/last-updated
11. `assignment_event` not written on candidate-ownership transfer (minor audit-trail gap)
12. `current_designation`/`linkedin_url` schema drift

---

## Part 4: Database Changes Required

- **Backfill migration** for `current_designation`, `linkedin_url` — closes existing drift, safe, no behavior change. *(XS)*
- **Decision + one-line change**: `OWNERSHIP_DAYS` 30→90 in `candidate_ownership.py`, if you actually want 90 days. *(needs your confirmation — this changes recruiter behavior, not just code)*
- **New/extended structure for candidate-level skill→years**, if the flat-tag + project-history model genuinely isn't enough for how recruiters work — e.g., a `candidate_skills(candidate_id, skill_name, years_experience)` table, RLS pattern copied exactly from `sql/137_screening_followups.sql` (the most recent clean template: `tenant_id` + `FORCE ROW LEVEL SECURITY` + isolation policy). *(needs your confirmation this is worth the migration of existing `candidate_skill_experience` data)*
- **Decision needed on the status model**: either (a) accept the current pipeline-stage model and add a recruiter-facing "sourcing status" as a *display convenience* layered on existing stages (cheapest), or (b) add a genuine pre-application state — e.g. a `sourcing_status` column directly on `candidates` for the pre-role-assignment period, since `applications` structurally requires a `requisition_id`. Option (b) is the only way to model "recruiter sourced this person, hasn't picked a role yet."
- **`assignment_event` insert** added to the ownership-transfer endpoint, for consistency with the codebase's own Hard Rule #9.

## Part 5: API Changes Required

- Extend the `/duplicates` list query to join `applications`/`requisitions`/`candidate_ownership` and return recruiter/client/role/status/last-updated on a match.
- Wire the existing client CRUD endpoints to a real frontend (no backend change needed — it's already there).
- If you want the 90-day / manager-exemption behavior changed, that's a one-constant change plus a role-check tweak in `candidate_ownership.py` — not a new endpoint.
- Add "total experience," "willing to relocate," "available for interview" to `screening_questions.py`/`screening_extraction.py`, following the exact pattern CTC/notice/location already use.
- New aggregate endpoint (or extend the fullest existing one, `recruiter-attribution/sender-tracking`) to add day/week/month bucketing to the full-funnel view, rather than building a 4th reporting system.
- If a hard KAM gate is wanted: a new state transition (approve/reject/return-to-recruiter) that actually blocks `submit-to-client` until a `kam`-specific approval is recorded — currently `kae` and `kam` are equally authorized, so this is a real logic change, not just a UI addition.

## Part 6: Frontend Changes Required

- **Inline cell editing** on the Candidates and Resume Inbox tables — reuse the exact pattern already proven in this codebase (the editable `<input>`/`<textarea>` cells bound directly to state, just shipped for the client-submission tracking sheet), rather than introducing a new dependency for this part.
- **Copy/paste across cells** — genuinely needs either a grid library (ag-grid Community and react-data-grid are both free/MIT) or hand-built clipboard-event handling. This is the one item worth a small, scoped pilot before committing, given every other table in this app is hand-rolled.
- Client management: build the missing create/edit/delete forms against the already-existing backend.
- Duplicate review page: show the new recruiter/client/role/status/last-updated fields once Part 5's endpoint change ships.
- Candidate timeline: two new insert call sites (candidate creation in `candidates.py`; inbound message handling in `whatsapp_bot.py`/`communications.py`) — no new UI needed, the timeline component already renders whatever `candidate_activities` contains.
- Audit page: wire the candidate filter the backend already supports.
- Ownership info surfaced on `recruiter-ops`/`recruiter-tracking` pages (currently absent there).
- Recruiter dashboard: consolidate to one canonical funnel view once you decide which of the 3 existing sources to keep.

## Part 7: WhatsApp Integration Changes Required

Smallest section in this report, because the system is already there. Two scoped additions only:
1. Auto-trigger screening enrollment from plain candidate creation when a role is already chosen at intake time.
2. Add the 3 missing structured questions (total experience, relocation, interview availability) to the existing question/extraction pipeline.

No new bot framework, no WAHA changes, no new tables.

## Part 8: Google Sheet Style Grid — Recommendation

The source document explicitly asks to evaluate two options. Recommendation: **Option A (ATS-internal grid), not Option B (real Google Sheets sync).**

A real Google Sheets integration means a second, external source of truth for candidate PII — exactly the double-entry and sync-lag problem this whole initiative exists to eliminate — plus it pushes candidate mobile numbers/CTC/personal data into a Google Sheet outside your tenant's DB and RLS boundary, which sits awkwardly against the DPDP consent model already built into this codebase (Hard Rule #6). An ATS-internal grid — styled and behaving like a spreadsheet (inline edit, keyboard navigation, sort/filter/export, and copy/paste as the one new capability) — gets recruiters the muscle-memory feel of Google Sheets while keeping one real source of truth, one RLS boundary, and one consent trail.

## Part 9: Estimated Development Effort

Rough sizing, not committed hours — sequencing matters more than the totals:

| Item | Size |
|---|---|
| Schema drift backfill | XS (~1 day) |
| Timeline "Created"/"Replied" + audit page filter | XS–S (1–2 days) |
| Ownership: 90-day decision + surfacing on recruiter pages | XS–S (config + 2–3 days UI) |
| WhatsApp: 3 new structured questions | S (2–3 days) |
| WhatsApp: auto-trigger on creation | S (~2 days) |
| Duplicate-match surfacing (owner/client/role/status) | S (2–3 days) |
| Client management CRUD UI | S (2–3 days) |
| Inline cell editing (existing tables, no new library) | M (5–7 days) |
| Recruiter dashboard consolidation | M (4–6 days, blocked on a decision) |
| KAM hard-approval gate | M (5–7 days, blocked on a business decision) |
| Candidate-level skill→years restructuring | M (5–8 days, includes data migration) |
| Real grid library adoption (copy/paste, per-column filters) | L (10–15 days — new dependency, 2 pages migrated, real testing) |

Everything here ships independently — this is not a single project.

## Part 10: Recommended Roadmap

- **Phase 0 (quick wins, <1 week):** schema drift backfill, timeline gaps, audit page filter, ownership-duration decision.
- **Phase 1 (the actual "feels like Google Sheets" work, 1–2 weeks):** duplicate-match surfacing, client CRUD UI, inline cell editing using the pattern already proven in this codebase. This alone delivers most of the wishlist's daily-use experience with zero new dependencies.
- **Phase 2 (WhatsApp completeness, ~1 week):** the 3 new questions + auto-trigger on creation.
- **Phase 3 (reporting, ~1 week):** pick the canonical recruiter-productivity source and extend it to full funnel + day/week/month.
- **Phase 4 (only after 0–3 are live and recruiters have used them):** grid-library adoption for copy/paste, the KAM hard-gate, and candidate-level skill restructuring — the three most expensive and most business-decision-dependent items, worth scoping for real once there's usage feedback rather than guessing upfront.

Explicitly **not recommended**: real Google Sheets API sync (Option B) — see Part 8.
