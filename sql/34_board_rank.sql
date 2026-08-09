-- Within-column manual reordering on the Kanban board. NULL means "no
-- manual order set yet" — those cards keep sorting by updated_at DESC
-- (today's existing default) after any explicitly-ranked ones, so this
-- is fully backward compatible until a recruiter actually drags a card
-- to reorder a column.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS board_rank INT;
