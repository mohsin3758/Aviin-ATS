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
echo ""
# Real gap fix (2026-09-08): a WAHA session sat stuck in SCAN_QR_CODE for
# days, driving hypervisor CPU-steal to 90%+ and exhausting Hostinger's
# burst-CPU reset budget — only found via Hostinger's own external panel.
# resource-monitor.sh (cron, every 5 min) now keeps a local, durable trend
# log of load/steal/WAHA CPU and any auto-recovery it takes — surfaced
# here so a plain status check catches it too, not just an outside panel.
echo "--- RESOURCE MONITOR (last 10 lines) ---"
tail -10 "$REPO_DIR/logs/resource-monitor.log" 2>/dev/null || echo "No resource-monitor log yet — is the cron job installed? (crontab -l)"
echo ""
echo "--- CURRENT LOAD / WAHA CPU ---"
awk '{print "load1="$1" load5="$2" load15="$3}' /proc/loadavg 2>/dev/null
docker stats --no-stream --format '{{.Name}}: {{.CPUPerc}}' 2>/dev/null | grep -E 'waha|backend|db' || true
