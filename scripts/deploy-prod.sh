#!/bin/bash
# FinStack Staffing OS — Production Deploy Script
# Run from repo root on the VPS.
#
# Prerequisites:
#   1. .env.prod filled in (cp .env.prod.example .env.prod && edit)
#   2. bash scripts/ssl-init.sh <domain> <email>
#   3. Docker + docker compose installed, dev user in docker group
#
# Usage: bash scripts/deploy-prod.sh [--skip-ssl]

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

ENV_FILE=".env.prod"
SKIP_SSL="${1:-}"

echo "=== FinStack Staffing OS — Production Deploy ==="
echo ""

# ─── Pre-flight checks ────────────────────────────────────────────────────────

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found."
  echo "  cp .env.prod.example .env.prod && nano .env.prod"
  exit 1
fi

source "$ENV_FILE"

if [[ "${DOMAIN:-CHANGEME}" == "CHANGEME"* ]]; then
  echo "ERROR: DOMAIN not set in $ENV_FILE"
  echo "  Set DOMAIN to your actual domain (NOT finstack.aviinjobs.com — that may be taken)"
  exit 1
fi

if [[ "${POSTGRES_PASSWORD:-CHANGEME}" == "CHANGEME"* ]]; then
  echo "ERROR: POSTGRES_PASSWORD not set in $ENV_FILE"
  exit 1
fi

if [[ "${JWT_SECRET:-CHANGEME}" == "CHANGEME"* ]]; then
  echo "ERROR: JWT_SECRET not set in $ENV_FILE"
  exit 1
fi

if [[ "${ERP_ENCRYPT_KEY:-CHANGEME}" == "CHANGEME"* ]]; then
  echo "ERROR: ERP_ENCRYPT_KEY not set in $ENV_FILE (HARD RULE #11 — required for PII encryption)"
  exit 1
fi

echo "[✓] Pre-flight checks passed for domain: $DOMAIN"
echo ""

# ─── SSL cert check ───────────────────────────────────────────────────────────

if [[ "$SKIP_SSL" != "--skip-ssl" ]]; then
  if [[ ! -f "nginx/letsencrypt/lib/live/$DOMAIN/fullchain.pem" ]]; then
    echo "No SSL cert found. Running ssl-init.sh..."
    echo "  You'll need to provide your email for Let's Encrypt registration."
    read -r -p "Email for Let's Encrypt: " LE_EMAIL
    bash scripts/ssl-init.sh "$DOMAIN" "$LE_EMAIL"
  else
    echo "[✓] SSL cert found for $DOMAIN"
  fi
fi

# ─── Generate nginx config from template ─────────────────────────────────────

echo "[1/5] Generating nginx config..."
sed "s/\${DOMAIN}/$DOMAIN/g" nginx/nginx.conf.template > nginx/nginx.conf

# Copy certbot SSL files to where nginx expects them (docker volume paths)
# This is handled by the certbot volumes in docker-compose.prod.yml

# ─── Zero-token audit before deploy ──────────────────────────────────────────

echo "[2/5] Running zero-token audit..."
bash scripts/zerotoken-check.sh
echo ""

# ─── Pull latest images + build ───────────────────────────────────────────────

echo "[3/5] Building and pulling images..."
sg docker -c "docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  --env-file $ENV_FILE pull --ignore-buildable"
sg docker -c "docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  --env-file $ENV_FILE build --no-cache backend frontend"

# ─── Start services ───────────────────────────────────────────────────────────

echo "[4/5] Starting all services..."
sg docker -c "docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  --env-file $ENV_FILE up -d"

# ─── Health checks ────────────────────────────────────────────────────────────

echo "[5/5] Waiting for health checks..."
sleep 15

BACKEND_OK=$(sg docker -c "docker compose ps backend" | grep "healthy" | wc -l)
DB_OK=$(sg docker -c "docker compose ps db" | grep "healthy" | wc -l)

if [[ "$BACKEND_OK" -lt 1 ]]; then
  echo "WARNING: Backend not yet healthy. Check: docker compose logs backend"
fi
if [[ "$DB_OK" -lt 1 ]]; then
  echo "WARNING: DB not yet healthy. Check: docker compose logs db"
fi

echo ""
echo "=== Deploy Complete ==="
echo ""
echo "  App URL:    https://$DOMAIN"
echo "  n8n:        http://localhost:5678 (internal only)"
echo "  Backend:    http://localhost:8080 (internal only)"
echo ""
echo "  Monitor:    bash scripts/status-check.sh"
echo "  Zero-token: bash scripts/zerotoken-check.sh"
echo ""
echo "  REMINDER: Confirm WAHA_API_KEY is correct — check docker logs finstack_waha"
echo "  REMINDER: Re-import n8n workflows after first deploy (n8n/build_workflows.py)"
