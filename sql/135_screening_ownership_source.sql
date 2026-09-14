-- WhatsApp Screening Blueprint: candidate_ownership.source CHECK never
-- included 'screening_enroll' (the value routers/screening.py passes to
-- services.candidate_ownership.claim_ownership for a brand-new candidate
-- created via the quick-add grid). Confirmed live: enrolling a genuinely
-- new candidate failed the CHECK constraint outright. Same widening
-- pattern this constraint has already gone through 4 times before
-- (sql/48, 81, 114, 118) as each new intake source was added.
ALTER TABLE candidate_ownership DROP CONSTRAINT IF EXISTS candidate_ownership_source_check;
ALTER TABLE candidate_ownership ADD CONSTRAINT candidate_ownership_source_check
    CHECK (source = ANY (ARRAY[
        'personal_mailbox', 'manual_add', 'bulk_upload', 'manual_assign',
        'personal_link', 'job_share_link', 'sender_email', 'unregistered_sender',
        'job_portal_feed', 'screening_enroll'
    ]));
