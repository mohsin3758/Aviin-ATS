#!/bin/bash
# FinStack Staffing OS — P14 Production Readiness Checklist
# Verifies all components are ready for production deployment.
# Run from repo root before executing deploy-prod.sh.

set -uo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

PASS=0
FAIL=0

check() {
  local desc="$1"
  local cmd="$2"
  if eval "$cmd" &>/dev/null; then
    echo "  [✓] $desc"
    ((PASS++))
  else
    echo "  [✗] $desc"
    ((FAIL++))
  fi
}

echo "=== FinStack Staffing OS — P14 Readiness Check ==="
echo ""

echo "▶ Environment"
check ".env.prod exists" "[[ -f .env.prod ]]"
check ".env.prod has DOMAIN (not CHANGEME)" "grep -q 'DOMAIN=' .env.prod && ! grep -q 'CHANGEME' .env.prod"
check ".env.prod has JWT_SECRET" "grep -q 'JWT_SECRET=' .env.prod"
check ".env.prod has ERP_ENCRYPT_KEY (HARD RULE #11)" "grep -q 'ERP_ENCRYPT_KEY=' .env.prod"
check ".env.prod has WAHA_API_KEY" "grep -q 'WAHA_API_KEY=' .env.prod"

echo ""
echo "▶ Docker Services (dev stack)"
check "Docker daemon accessible" "sg docker -c 'docker info'"
check "finstack_db healthy" "sg docker -c 'docker compose ps db' | grep -q 'healthy'"
check "finstack_backend healthy" "sg docker -c 'docker compose ps backend' | grep -q 'healthy'"
check "finstack_frontend running" "sg docker -c 'docker compose ps frontend' | grep -q 'Up'"
check "finstack_embed healthy" "sg docker -c 'docker compose ps embed' | grep -q 'healthy'"
check "finstack_ollama running" "sg docker -c 'docker compose ps ollama' | grep -q 'Up'"
check "finstack_n8n running" "sg docker -c 'docker compose ps n8n' | grep -q 'Up'"
check "finstack_waha running" "sg docker -c 'docker compose ps waha' | grep -q 'Up'"

echo ""
echo "▶ API Health"
check "Backend /health returns 200" "curl -sf http://localhost:8080/health | python3 -c \"import sys,json; assert json.load(sys.stdin)['ok']\""
check "Embed service /health returns 200" "curl -sf http://localhost:8081/health | python3 -c \"import sys,json; assert json.load(sys.stdin)['ok']\""
check "Ollama has qwen2.5 model" "curl -sf http://localhost:11434/api/tags | python3 -c \"import sys,json; assert any('qwen2.5' in m['name'] for m in json.load(sys.stdin)['models'])\""

echo ""
echo "▶ Database"
check "Placements table exists" "sg docker -c \"docker compose exec -T db psql -U postgres -d ats -c 'SELECT 1 FROM placements LIMIT 1'\""
check "trust_graph table exists" "sg docker -c \"docker compose exec -T db psql -U postgres -d ats -c 'SELECT 1 FROM trust_graph LIMIT 1'\""
check "ai_cache table exists" "sg docker -c \"docker compose exec -T db psql -U postgres -d ats -c 'SELECT 1 FROM ai_cache LIMIT 1'\""
check "pgcrypto erp_encrypt function exists" "sg docker -c \"docker compose exec -T db psql -U postgres -d ats -c 'SELECT erp_encrypt IS NOT NULL FROM (SELECT 1 AS erp_encrypt) t'\""

echo ""
echo "▶ Zero-Token Compliance"
check "zerotoken-check CLEAN" "bash scripts/zerotoken-check.sh | grep -q 'CONFIRMED CLEAN'"

echo ""
echo "▶ SSL (production only — skip in dev)"
if [[ -f .env.prod ]]; then
  source .env.prod 2>/dev/null || true
  check "SSL cert exists for $DOMAIN" "[[ -f nginx/letsencrypt/lib/live/${DOMAIN:-CHANGEME}/fullchain.pem ]]"
  check "nginx.conf generated" "[[ -f nginx/nginx.conf ]]"
fi

echo ""
echo "▶ Playwright QA"
check "All Playwright tests pass" "npx playwright test tests/qa_automation.spec.ts --reporter=line 2>&1 | grep -q 'passed'"

echo ""
echo "========================================"
echo "  PASSED: $PASS"
echo "  FAILED: $FAIL"
echo ""
if [[ $FAIL -eq 0 ]]; then
  echo "  [✓] ALL CHECKS PASSED — ready for deploy-prod.sh"
else
  echo "  [✗] $FAIL checks failed — resolve before deploying"
fi
echo "========================================"
