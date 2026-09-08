#!/bin/bash
# Weekly disk-hygiene cleanup (2026-09-08)
#
# Real, recurring pattern in this project's own history: Docker build
# cache from repeated `docker compose up -d --build` deploys has bloated
# to 20-25GB+ at least twice before, always found manually via `docker
# system df` and cleaned by hand. This automates the same, already-proven-
# safe action (docker builder prune) on a schedule so it can't quietly
# build up unnoticed again — genuinely low-risk: build cache has zero
# relationship to any currently-running container (confirmed each time
# this was done manually), only affects how long a FUTURE build takes.
#
# Run via cron weekly (Sunday 03:00 UTC — matches this project's own
# established off-hours-maintenance convention, e.g. the GDPR archive job):
#   0 3 * * 0 bash ~/airecruit/scripts/weekly-cleanup.sh >> ~/airecruit/logs/weekly-cleanup.log 2>&1

set -u
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_FILE="$REPO_DIR/logs/weekly-cleanup.log"
mkdir -p "$REPO_DIR/logs"
ts() { date -u '+%Y-%m-%d %H:%M:%S UTC'; }

echo "[$(ts)] weekly cleanup starting" >> "$LOG_FILE"
echo "[$(ts)] before:" >> "$LOG_FILE"
docker system df >> "$LOG_FILE" 2>&1

# Full prune, not age-filtered — verified live on 2026-09-08 that an
# "until=168h" age filter reclaimed 0B here, because this project rebuilds
# near-daily, so almost all cache is under a week old and the filter never
# fires. Build cache prune never touches a running container or image
# (proven every time this has been done manually in this project's
# history) — the only real cost of pruning "too much" is a slightly slower
# next build, never data loss or downtime. Dangling (untagged) images too
# — real byproducts of image rebuilds, zero relationship to any running
# container.
docker builder prune -af >> "$LOG_FILE" 2>&1
docker image prune -f >> "$LOG_FILE" 2>&1

echo "[$(ts)] after:" >> "$LOG_FILE"
docker system df >> "$LOG_FILE" 2>&1
echo "[$(ts)] weekly cleanup done" >> "$LOG_FILE"

# Keep the log itself bounded too.
if [ -f "$LOG_FILE" ] && [ "$(wc -l < "$LOG_FILE")" -gt 5000 ]; then
  tail -n 2000 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
fi
