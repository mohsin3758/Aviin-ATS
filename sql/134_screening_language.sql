-- WhatsApp Screening Blueprint, decision #15: outbound wording in the
-- recruiter-chosen language for this candidate, stored once at
-- enrollment and used for every message in that session's conversation.
ALTER TABLE screening_sessions ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'en';
