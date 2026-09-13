#!/usr/bin/env bash
# AVIIN ATS — rotate the app_user Postgres password
# Run ONCE, manually, on the VPS: bash scripts/rotate-db-password.sh
#
# Why this exists: n8n/credentials/postgres_app_user.json held this
# password in plaintext and was committed to the (public) git repo.
# This script generates a fresh password, writes it to .env, applies it
# in Postgres, and restarts the services that hold a live connection.
# It does NOT touch the n8n credential store — n8n keeps that
# encrypted in its own DB, not read from the removed JSON file, so
# update it by hand afterward: n8n UI -> Credentials -> "Postgres
# app_user (ats)" -> set the new password shown at the end of this run.

set -e
cd ~/airecruit
ENV_FILE=".env"
DB_CONTAINER="aviin_db"

test -f "$ENV_FILE" || { echo "No .env found at ~/airecruit/.env — aborting."; exit 1; }
grep -q '^APP_DB_PASSWORD=' "$ENV_FILE" || { echo "No APP_DB_PASSWORD line in .env — aborting."; exit 1; }

cp "$ENV_FILE" "${ENV_FILE}.bak.$(date +%Y%m%d_%H%M%S)"
echo "[$(date)] Backed up .env before editing."

NEW_PW=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-32)

sed -i "s|^APP_DB_PASSWORD=.*|APP_DB_PASSWORD=${NEW_PW}|" "$ENV_FILE"
echo "[$(date)] .env updated with new APP_DB_PASSWORD."

echo "[$(date)] Applying new password in Postgres..."
docker compose exec -T "$DB_CONTAINER" psql -U postgres -d ats \
  -c "ALTER ROLE app_user WITH PASSWORD '${NEW_PW}';" \
  || docker exec -i "$DB_CONTAINER" psql -U postgres -d ats \
  -c "ALTER ROLE app_user WITH PASSWORD '${NEW_PW}';"

echo "[$(date)] Restarting backend and n8n to pick up the new password..."
docker compose up -d --build backend
docker compose restart n8n

sleep 5
echo "[$(date)] Health check:"
docker compose ps db backend n8n

echo ""
echo "=============================================================="
echo " New app_user password (save this to a password manager NOW): "
echo " ${NEW_PW}"
echo "=============================================================="
echo ""
echo "REMAINING MANUAL STEP: open the n8n UI -> Credentials ->"
echo "'Postgres app_user (ats)' -> update the password field to the"
echo "value above, then Save. n8n Postgres nodes will fail until you do."
echo ""
echo "Then verify: docker compose logs backend --tail 30"
echo "             docker compose logs n8n --tail 30"
