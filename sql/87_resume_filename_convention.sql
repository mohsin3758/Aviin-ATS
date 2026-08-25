-- Resume filename convention (2026-08-26): "Candidate Name_Position_
-- TotalExp.ext" — e.g. "Usha N_SAP FICO Consultant_12Yrs.pdf" — computed
-- once at generation time (same "each version is a frozen snapshot"
-- convention this table already uses for display_name/template_name)
-- and stored so it never has to be recomputed from a possibly-since-
-- changed candidate record. Pre-existing rows (generated before this
-- feature shipped) keep file_name NULL — download_generated() falls
-- back to the older filename convention for those, never breaking a
-- previously-generated document's download.
ALTER TABLE generated_resumes ADD COLUMN IF NOT EXISTS file_name TEXT;
