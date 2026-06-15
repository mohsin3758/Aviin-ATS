#!/bin/bash
# Quick status snapshot for FinStack Staffing OS (AIrecruit)
# Usage: bash scripts/status-check.sh  (run from repo root, ~/airecruit)
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=== AIrecruit Status Check ==="
echo "Time: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""
echo "--- PHASE STATUS ---"
grep -E 'NEXT|DONE|⏳|✅' "$REPO_DIR/FINSTACK_MASTER_INDEX.md" 2>/dev/null | head -20
echo ""
echo "--- DOCKER SERVICES ---"
cd "$REPO_DIR" 2>/dev/null && docker compose ps --format "table {{.Name}}\t{{.Status}}" 2>/dev/null || echo "Docker compose not running"
echo ""
echo "--- TMUX SESSIONS ---"
tmux ls 2>/dev/null || echo "No tmux sessions"
echo ""
echo "--- LAST AUTO-RESUME LOG LINES ---"
tail -5 "$REPO_DIR/logs/claude-resume.log" 2>/dev/null || echo "No auto-resume log yet"
