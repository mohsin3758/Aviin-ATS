-- 110_fix_template_delete_fk_block.sql
-- Real, reported bug: deleting a tracking-sheet template through the real
-- Ops Settings UI ("Request failed", even after un-defaulting first) —
-- root-caused live: `candidate_submissions_template_id_fkey` has no
-- ON DELETE clause at all (defaults to NO ACTION/RESTRICT), so any
-- template genuinely referenced by a real, already-sent submission
-- (the exact situation for the many stray "QA S54 Client ..." test
-- templates cluttering this page — confirmed via direct query, every
-- one has real candidate_submissions rows attached from real S54 test
-- sends) can never be deleted, and the raw asyncpg
-- ForeignKeyViolationError surfaces to the frontend as a bare,
-- unhelpful "Request failed" with zero explanation.
--
-- Fixed the same way the two OTHER FKs on this exact table already are
-- (application_id, recipient_contact_id — both ON DELETE SET NULL):
-- candidate_submissions.template_id is genuinely nullable, and the
-- submission's own field_values JSONB snapshot already carries
-- everything that was actually sent — template_id is a secondary
-- "which config produced this" reference, not the record's own
-- content. Losing that one reference on a real, deliberate template
-- delete is a fair, honest trade; silently blocking the delete forever
-- is not. Confirmed via pg_constraint this is the ONLY foreign key
-- referencing tracking_sheet_templates anywhere in the schema.
--
-- Run as app_user (matches this table's own established ownership).

ALTER TABLE candidate_submissions
    DROP CONSTRAINT IF EXISTS candidate_submissions_template_id_fkey;

ALTER TABLE candidate_submissions
    ADD CONSTRAINT candidate_submissions_template_id_fkey
    FOREIGN KEY (template_id) REFERENCES tracking_sheet_templates(id) ON DELETE SET NULL;
