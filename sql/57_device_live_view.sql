-- On-demand live screen view (Time Champ gap-analysis, 2026-08-11): a
-- manager requests a fresh capture; the agent picks up the request on
-- its next heartbeat and uploads one screenshot immediately. Not literal
-- video streaming (a much bigger undertaking) -- a fresh on-demand
-- capture, refreshed by polling if the requester wants a live feel.

ALTER TABLE monitored_devices ADD COLUMN IF NOT EXISTS live_view_requested_at TIMESTAMPTZ;
ALTER TABLE monitored_devices ADD COLUMN IF NOT EXISTS live_view_requested_by UUID REFERENCES users(id);
