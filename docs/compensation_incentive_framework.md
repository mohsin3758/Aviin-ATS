# Aviin Staffing — Compensation, Incentive, KAE & Account Ownership Framework
# Build spec for P15 / P16 / P17

## Business Context
Staffing company, low-margin clients (~5% placement fee). Roles: Founder, Recruiters, KAE.
Scale goal: 10 → 100+ recruiters. Core constraint: NEVER expose full company P&L to employees.
Incentives calculated from **Contribution Margin**, never from raw revenue.

---

## CORE RULES (enforce in every calculation)
1. Never share full company P&L with non-Founder users.
2. Never share all client margins across the company — scope to assigned account only.
3. Client ownership = Aviin, not any employee. Contracts, pricing, commercial approvals = Founder.
4. Incentives tied to outcomes (joinings, revenue, retention), NOT activity alone.
5. Profit protected first: incentive = f(contribution_margin), not f(revenue).
6. Retention bank (30% hold) reduces recruiter churn.
7. No personal spreadsheets / personal client DBs — everything in ATS/CRM.

---

## P15: Recruiter Performance & Incentive Engine

### 1. KPI Scorecard — 100 Points
| KPI | Weight |
|---|---|
| Joinings | 35 pts |
| Revenue Generated | 25 pts |
| Interview Conversion Rate | 10 pts |
| Offer Conversion Rate | 10 pts |
| Client Satisfaction Score | 10 pts |
| ATS Compliance | 10 pts |
| **Total** | **100 pts** |

### 2. Performance Grades & Incentive Ranges
| Grade | Score | Incentive (INR) |
|---|---|---|
| D | < 60 | None — PIP |
| C | 60-69 | ₹1,000 – ₹3,000 |
| B | 70-79 | ₹5,000 – ₹10,000 |
| A | 80-89 | ₹10,000 – ₹20,000 |
| A+ | 90+ | ₹20,000 – ₹50,000+ |

### 3. Advanced KPI Tracking (per recruiter, per month)
- Time to First Submission (hours)
- Submission Acceptance % (accepted / submitted)
- Interview Ratio (interviews / submissions)
- Offer Ratio (offers / interviews)
- Joining Ratio (joinings / offers)
- Offer Drop Rate (dropped offers / total offers issued)
- Candidate No-Show % (no-shows / scheduled interviews)
- Candidate Satisfaction Score (0-5)
- Client Satisfaction Score (0-5)
- 90-Day Retention Rate (placements retained 90d / total placements)

### 4. Candidate Retention Scoring
Credit for incentive calculation based on how long the placed candidate stays:
| Days Employed | Credit |
|---|---|
| < 30 days | 0% |
| 30-60 days | 50% |
| 60-90 days | 75% |
| 90+ days | 100% |
Retention credit multiplies the joining component (35 pts) of the KPI score.

### 5. Incentive Calculation Rule
- NEVER calculate from revenue directly.
- Formula: `Contribution Margin = Revenue - Delivery Cost - Incentives - Operational Cost`
- Incentive is drawn from the Delivery Pool (see P17), after CM is protected.
- Grade determines the payout range; actual payout = prorated within range by score.

### 6. Incentive Payout Split
- 70% paid immediately (same month)
- 30% held in Retention Bank → released on schedule:
  - Quarterly (Jan/Apr/Jul/Oct)
  - Half-Yearly (Jun/Dec)
  - Annual (March)
- Recruiter who leaves before release date forfeits unreleased bank amount.

### 7. Recruiter Loyalty Bonus (on joining anniversary)
| Tenure | Bonus |
|---|---|
| 1 year | ₹15,000 |
| 2 years | ₹30,000 |
| 3 years | ₹50,000 |
| 5 years | ₹1,00,000 |

### DB Tables (P15)
- `recruiter_kpi_scores` — monthly scorecard per recruiter (joinings_score, revenue_score, interview_score, offer_score, client_satisfaction_score, ats_score, total_score, grade, calculated_incentive, status: draft|approved|paid)
- `recruiter_advanced_kpis` — monthly advanced metrics (time_to_first_submission_hrs, submission_acceptance_pct, interview_ratio, offer_ratio, joining_ratio, offer_drop_rate, no_show_pct, candidate_satisfaction, client_satisfaction, retention_90day_pct)
- `candidate_retention_tracking` — per placement (joining_date, days_employed, retention_credit_pct, last_checked_at)
- `incentive_records` — per recruiter per month (gross_incentive, immediate_payout_70pct, retention_bank_30pct, contribution_margin_basis, status: pending|paid)
- `retention_bank` — per recruiter (amount, accrued_month, release_schedule: quarterly|half_yearly|annual, released_at, status: held|released|forfeited)
- `loyalty_milestones` — per user (joining_date, milestone_years, bonus_amount, achieved_at, paid_at, status: pending|paid)

### Frontend (P15)
- `/incentives` page — Recruiter KPI Scorecard (100-pt breakdown + grade badge), Incentive Calculator (live preview of gross/immediate/bank split), Retention Bank balance (released/held/forfeited), Loyalty Milestone timeline, Advanced KPI table, 90-Day Retention tracker.
- Recruiter sees ONLY their own scorecard. Admin/Founder sees all recruiters.

---

## P16: KAE Module & Account Ownership

### 1. KAE Role
- Role name: `kae` (add to RBAC PERMS alongside existing recruiter/manager/admin)
- Responsibilities: client relationship, requirement intake, escalation management, client satisfaction, collection follow-up, delivery coordination, account growth.
- KAE does NOT own clients. Aviin/Founder owns all client relationships.

### 2. KAE KPI Scorecard — 100%
| KPI | Weight |
|---|---|
| Client Retention | 30% |
| Account Growth | 25% |
| Collection Achievement | 20% |
| Client Satisfaction | 15% |
| Process Compliance | 10% |
| **Total** | **100%** |

### 3. KAE Incentive Plan

**Client Retention Bonus** (milestone-based, per retained client):
| Retention Period | Bonus |
|---|---|
| 6 months | ₹5,000 |
| 12 months | ₹15,000 |
| 24 months | ₹30,000 |

**Account Growth Bonus** (vs same period last year):
| Growth | Bonus |
|---|---|
| 25% | ₹2,500 |
| 50% | ₹5,000 |
| 100% | ₹10,000 |
| 200% | ₹25,000 |

**Collection Bonus** (per collection milestone in the month):
| Amount Collected | Bonus |
|---|---|
| ₹1 Lakh | ₹1,000 |
| ₹5 Lakh | ₹5,000 |
| ₹10 Lakh | ₹10,000 |

**Client Satisfaction Bonus** (based on client rating):
| Rating | Bonus |
|---|---|
| > 4.5 | ₹5,000 |
| > 4.8 | ₹10,000 |

### 4. Account Ownership Model
Every client must have THREE owners assigned — no single-point dependency:
- Primary KAE (`kae_id`)
- Founder/Director (`founder_id`)
- Backup Account Owner (`backup_id`)

If any one leaves, the other two maintain continuity. Handover workflow triggered automatically when a KAE's employment ends.

### 5. Account P&L Visibility Levels
| Level | Role | Sees |
|---|---|---|
| L1 | Recruiter | Nothing financial |
| L2 | Senior Recruiter | Own revenue contribution only |
| L3 | KAE | Assigned account revenue + delivery budget |
| L4 | Account Manager | Full account P&L |
| L5 | Founder | Full company P&L |

RLS + visibility_level field enforces this — KAE running a query sees only their assigned accounts. Founder sees everything.

### DB Tables (P16)
- `kae_kpi_scores` — monthly (client_retention_score, account_growth_score, collection_score, client_satisfaction_score, compliance_score, total_score, total_incentive, status)
- `kae_incentives` — per KAE per period (client_retention_bonus, account_growth_bonus, collection_bonus, satisfaction_bonus, total_incentive, paid_at)
- `client_owners` — per client (kae_id, founder_id, backup_id, assigned_at, notes)
- `account_visibility` — per user per client (visibility_level 1-5, granted_by, granted_at)
- `kae_client_retention` — tracks each client's retention start date and milestone triggers per KAE

### Frontend (P16)
- `/kae` page — KAE Dashboard (KPI scorecard donut chart, incentive breakdown card, client retention milestone tracker, account growth chart, collection achievement tracker, client satisfaction ratings)
- Client detail view extended: shows KAE + Founder + Backup owners, handover history
- Admin view: all KAE KPIs side-by-side for comparison (admin/founder only)

---

## P17: Account Financial Framework & CEO Dashboard Extensions

### 1. Account P&L Structure
For every client, per month:

```
Revenue (Client billing)
  - Company Share (20%) → Management, Finance, Compliance, Operations, Legal, Risk Buffer
  = Delivery Pool (80%)
    - Recruiter Incentives
    - Sourcing Bonus
    - Referral Bonus
    - KAE Incentive
    - Growth Reserve
    - Operational Reserve
```

Company Share % is configurable per account (default 20%).

### 2. Contribution Margin Calculator
```
Contribution Margin = Revenue
  - Delivery Cost (salaries, sourcing, tools)
  - Total Incentives Paid
  - Operational Cost
```
Incentives are calculated AFTER CM is confirmed positive. If CM < 0, incentive grade is capped at C.

### 3. Collection Tracking
- Per client, per invoice: amount_collected, collected_date, KAE responsible
- Auto-triggers KAE Collection Bonus milestones (₹1L/₹5L/₹10L)
- KAE sees: assigned account collections only
- Founder sees: all client collections + overdue aging

### 4. BU Model Eligibility Tracker
For KAEs being considered for a Business Unit:
- Eligibility criteria: 18+ months tenure, loyalty_score, client_retention_score, account_growth_score
- BU Revenue Split: Company 20%, Delivery Pool 60%, KAE Success Pool 20%
- Even BU KAEs: contracts remain with Aviin, pricing approval = Founder
- Track: `bu_eligibility` table with eligibility_score and eligible_for_bu boolean

### 5. CEO Dashboard Extensions (add to existing /command-center)
**Weekly Review additions:**
- Revenue (week-on-week trend)
- Joinings (week)
- Open Requisitions
- Interviews Scheduled / Completed
- Offers Issued / Accepted / Dropped
- Collections Received
- Client Satisfaction Average
- Recruiter Retention (active vs resigned)
- Account Growth (MoM %)

**Monthly Review additions:**
- Revenue per Recruiter (leaderboard)
- Revenue per KAE (leaderboard)
- Gross Margin % (company-wide, Founder-only)
- Recruiter Retention Rate
- Client Expansion count (accounts with >10% growth)
- 90-Day Candidate Retention Rate

### DB Tables (P17)
- `account_pl` — per client per period (revenue, company_share_pct, company_share_amount, delivery_pool_amount, status: draft|locked)
- `delivery_pool_allocations` — per account_pl row (recruiter_incentives, sourcing_bonus, referral_bonus, kae_incentive, growth_reserve, operational_reserve, unallocated)
- `contribution_margins` — per client per period (revenue, delivery_cost, incentives_total, operational_cost, contribution_margin, cm_pct, is_profitable)
- `collection_records` — per client per invoice (amount_collected, collected_at, kae_id, milestone_triggered, milestone_type)
- `bu_eligibility` — per KAE (tenure_months, loyalty_score, client_retention_score, account_growth_score, eligibility_score, eligible_for_bu, evaluated_at, approved_by)

### DB Views (P17)
- `v_account_pl` — joined with delivery_pool_allocations + contribution_margins, visibility-gated (L3+ only)
- `v_recruiter_revenue` — revenue per recruiter per period (joins placements + invoices)
- `v_kae_revenue` — revenue per KAE per period (joins account_pl + client_owners)
- `v_90day_retention` — 90-day retention rate per recruiter (from candidate_retention_tracking)
- `v_collection_aging` — overdue collection aging per client (Founder/KAE only)

### Frontend (P17)
- `/account-pl` page — L3+ gated: per-account revenue, company share, delivery pool breakdown, CM calculator, collection status. L1/L2 users see access-denied.
- `/collections` page — KAE sees assigned accounts only; Founder sees all + aging.
- `/bu-tracker` page — Founder-only: KAE eligibility scores, BU readiness checklist.
- Extended `/command-center` — add weekly + monthly CEO panels described above.

---

## Competitor Coverage Confirmation
| Feature | Top-100 Equivalents |
|---|---|
| Recruiter KPI Scorecard | Bullhorn Analytics, JobDiva Metrics, Vincere KPIs, Ceipal Performance |
| Incentive / Commission Calc | TempWorks Financials, Avionte Commission, PCRecruiter, Bullhorn Back Office |
| Retention Bank | PrismHR, TempWorks, Asanify |
| Account Ownership (multi-owner) | Vincere Account Manager, Bullhorn CRM, Crelate |
| Account P&L Visibility Levels | Bullhorn Back Office, TempWorks Financials, PrismHR |
| KAE Role & KPI | Vincere, JobDiva, Ceipal |
| Contribution Margin Engine | TempWorks, PrismHR, Bullhorn Back Office |
| CEO Dashboard (recruiter/KAE rev) | JobDiva Executive Dashboard, Vincere CEO, Bullhorn Analytics |

All three phases are standard in top-tier staffing platforms. This is a required gap to close for enterprise-grade feature parity.

---

## Zero-Token Compliance
All calculations in P15/P16/P17 are:
- Pure SQL (PostgreSQL functions, views, triggers) — Tier 0, zero AI tokens
- No LLM calls for any calculation
- Grade/incentive logic = rule-based (score thresholds, lookup tables)
- CM = arithmetic formula in SQL
- Retention bank releases = scheduled Postgres cron job (pg_cron) or BullMQ equivalent
`bash scripts/zerotoken-check.sh` must still print CONFIRMED CLEAN after each phase.
