-- Real feature (2026-09-10, reported live): "add the all missing Job
-- Type, NDA status, or Truecaller verification, Monthly Contract Salary
-- (Contract/Freelancer) in the database and keep the automatic extract
-- and insert in the tracking sheet table" -- 4 real fields the tracking-
-- sheet template (published this session) already asks recruiters for,
-- but that had nowhere to land once extracted.
--
-- monthly_contract_salary is deliberately a SEPARATE column from
-- expected_ctc, not a reused/overloaded one -- the whole point of
-- splitting "ECTC/Rate Card" into two template columns (this same
-- session, after a real bug where a "1.50 L/Month" contract rate risked
-- being misread as an annual CTC) was to keep a periodic rate and an
-- annual figure from ever being conflated in the data itself, not just
-- in the parsing logic.
--
-- job_type is free TEXT (not a DB-level CHECK/enum) -- normalized to
-- "FTE"/"Contract"/"Freelancer" by the parser before it's ever written,
-- but left unconstrained at the column level so a manual edit or a
-- future real value this parser doesn't yet recognize isn't rejected
-- outright, matching this codebase's established "application-level
-- validation over brittle DB constraints" convention for free-typed
-- fields (e.g. source_label, current_designation).
--
-- nda_received/truecaller_verified are real, separate booleans (same
-- convention as is_serving_notice, sql/119) -- NULL means "not recorded
-- yet", not "no".

ALTER TABLE candidates ADD COLUMN IF NOT EXISTS job_type TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS nda_received BOOLEAN;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS truecaller_verified BOOLEAN;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS monthly_contract_salary DOUBLE PRECISION;
