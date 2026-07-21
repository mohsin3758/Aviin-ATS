-- Fix: duplicate_candidates.match_score was numeric(4,2) (max 99.99) but
-- defaulted to 100, so the column's own DEFAULT overflowed on every insert.
-- Every call to POST /duplicates/scan silently failed to record a single
-- row (the exception was swallowed by a bare except/pass in scan_duplicates),
-- so the P35 email/phone duplicate scanner never actually worked in
-- production. Widen the column so 100.00 fits.
ALTER TABLE duplicate_candidates ALTER COLUMN match_score TYPE numeric(5,2);
