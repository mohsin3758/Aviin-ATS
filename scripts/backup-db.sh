#!/usr/bin/env bash
# AVIIN ATS — automated daily database backup
# Runs via cron: 0 1 * * * /home/dev/airecruit/scripts/backup-db.sh

set -e
BACKUP_DIR="/var/backups/airecruit"
DB_CONTAINER="finstack_db"
DB_NAME="ats"
DB_USER="postgres"
DATE=$(date +%Y%m%d_%H%M%S)
KEEP_DAYS=30

mkdir -p "$BACKUP_DIR"

# Create backup
echo "[$(date)] Starting backup..."
docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -Fc "$DB_NAME" > "$BACKUP_DIR/ats_${DATE}.dump"
echo "[$(date)] Backup saved: ats_${DATE}.dump ($(du -sh "$BACKUP_DIR/ats_${DATE}.dump" | cut -f1))"

# Rotate old backups
find "$BACKUP_DIR" -name "*.dump" -mtime +$KEEP_DAYS -delete
echo "[$(date)] Rotated backups older than $KEEP_DAYS days"

# List current backups
ls -lh "$BACKUP_DIR"/*.dump 2>/dev/null | tail -5
echo "[$(date)] Backup complete."
