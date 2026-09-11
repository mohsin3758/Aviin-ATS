-- Browser extension candidate import (LinkedIn v1) -- see plan
-- "Browser Extension — One-Click LinkedIn Candidate Import".
--
-- extension_captures already exists (sql/99) with name/email/phone/
-- current_title/current_company/profile_url/source. Adding the 3
-- fields the LinkedIn content-script adapter can reliably scrape that
-- the existing schema has no home for: a structured linkedin_url
-- (distinct from the generic profile_url, used as the dedup_service
-- Stage-A exact-match signal), location, and a formatted best-effort
-- experience/education text block (resume_text_like) that lets the
-- existing skill/experience extraction machinery run on an extension
-- import exactly like it does for any other candidate.
ALTER TABLE extension_captures ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE extension_captures ADD COLUMN IF NOT EXISTS linkedin_url TEXT;
ALTER TABLE extension_captures ADD COLUMN IF NOT EXISTS resume_text_like TEXT;
