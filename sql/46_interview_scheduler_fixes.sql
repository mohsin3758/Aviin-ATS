-- Interview Scheduler fixes (2026-08-10 round-3 audit):
-- public self-scheduling 500s on every call, and the reminder cron's
-- root cause (fixed in application code, backend/scheduler.py).

-- ── Self-scheduling was 100% broken ─────────────────────────────────────
-- POST /self-schedule/book/{token} writes interview_type='self_scheduled',
-- a value the CHECK constraint never allowed — every public booking
-- attempt failed with a constraint violation. Widen the constraint rather
-- than change what the public endpoint writes (self_scheduled is the
-- correct semantic label — a candidate booked this themselves, not staff).
ALTER TABLE interview_schedules DROP CONSTRAINT interview_schedules_interview_type_check;
ALTER TABLE interview_schedules ADD CONSTRAINT interview_schedules_interview_type_check
    CHECK (interview_type = ANY (ARRAY['screening','technical','hr','client','final','panel','self_scheduled']::text[]));
