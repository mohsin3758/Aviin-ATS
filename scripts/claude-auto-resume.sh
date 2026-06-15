#!/bin/bash
# ============================================================
# AIrecruit (FinStack Staffing OS) Claude Code Auto-Resume Monitor
# VPS: 187.127.179.128 | Ubuntu 24.04
#
# MONITOR-ONLY: watches the EXISTING `dev` tmux pane (where Claude
# Code is already logged in via OAuth/Pro subscription) for
# rate-limit messages and auto-sends "continue" after the reset
# time. Does NOT kill, create, or restart the `dev` session itself.
#
# Run this from a SEPARATE tmux window/session, e.g.:
#   tmux new-window -t dev -n monitor
#   bash ~/airecruit/scripts/claude-auto-resume.sh
# or detached:
#   nohup bash ~/airecruit/scripts/claude-auto-resume.sh \
#     > ~/airecruit/logs/monitor.out 2>&1 &
# ============================================================
set -euo pipefail

SESSION="dev"
PANE="${SESSION}:0.0"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$REPO_DIR/logs/claude-resume.log"
STATE="$REPO_DIR/state"

mkdir -p "$(dirname "$LOG")" "$STATE"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

parse_wait_seconds() {
  local msg="$1"
  python3 - "$msg" << 'PYEOF'
import sys, re
from datetime import datetime, timedelta
try:
    import pytz
except ImportError:
    import subprocess; subprocess.run(["pip3","install","pytz","--break-system-packages","-q"])
    import pytz

msg = " ".join(sys.argv[1:])
m = re.search(r'resets?\s+(\d{1,2}(?::\d{2})?(?:am|pm))\s*(?:\(([^)]+)\))?', msg, re.I)
if not m:
    print(1800); sys.exit()

time_str = m.group(1).upper()
tz_name  = m.group(2) or "UTC"
try:
    tz = pytz.timezone(tz_name)
except Exception:
    tz = pytz.UTC

now = datetime.now(tz)
fmt = "%I:%M%p" if ":" in time_str else "%I%p"
try:
    t = datetime.strptime(time_str, fmt)
    reset = now.replace(hour=t.hour, minute=t.minute, second=0, microsecond=0)
    if reset <= now: reset += timedelta(days=1)
    print(max(60, int((reset - now).total_seconds()) + 60))
except Exception:
    print(1800)
PYEOF
}

send_keys() { tmux send-keys -t "$PANE" "$1" Enter 2>/dev/null; }
get_pane()  { tmux capture-pane -t "$PANE" -p 2>/dev/null | tail -15 || echo ""; }

if ! tmux has-session -t "$SESSION" 2>/dev/null; then
  log "ERROR: tmux session '$SESSION' not found. Start Claude Code there first:"
  log "  tmux new-session -s $SESSION -c $REPO_DIR"
  log "  (inside) claude"
  exit 1
fi

log "=============================================="
log " AIrecruit Auto-Resume Monitor (monitor-only)"
log " Watching tmux pane: $PANE"
log "=============================================="
log "Checking every 30s for rate limits or exits..."

while true; do
  sleep 30
  pane=$(get_pane)

  if echo "$pane" | grep -qiE "out of extra usage|usage limit|rate.?limit|resets [0-9]"; then
    log "RATE LIMIT detected."
    wait_sec=$(parse_wait_seconds "$pane")
    wait_min=$(( wait_sec / 60 ))
    log "Sleeping ${wait_min}min until reset (${wait_sec}s total)..."
    echo "$(date '+%Y-%m-%d %H:%M:%S')|RATE_LIMITED|${wait_sec}s" >> "$STATE/events.log"
    sleep "$wait_sec"
    log "Sending 'continue' after rate limit reset..."
    send_keys "continue"
    sleep 5
    echo "$(date '+%Y-%m-%d %H:%M:%S')|RESUMED" >> "$STATE/events.log"
    log "Resumed. Watching..."

  elif echo "$pane" | grep -qE '^\$ |^dev@|# $'; then
    log "Claude Code appears to have exited (shell prompt visible)."
    sleep 5
    recheck=$(get_pane)
    if echo "$recheck" | grep -qE '^\$ |^dev@|# $'; then
      log "Restarting with 'claude --continue'..."
      send_keys "cd $REPO_DIR && claude --continue"
      sleep 4
      send_keys "Read FINSTACK_MASTER_INDEX.md and CLAUDE.md. Find the phase marked NEXT. Continue from the last incomplete task. No confirmation needed, proceed autonomously."
      echo "$(date '+%Y-%m-%d %H:%M:%S')|AUTO_RESTARTED" >> "$STATE/events.log"
      log "Claude restarted."
    fi

  elif echo "$pane" | grep -qiE "P14.*DONE|all phases.*done|project.*complete"; then
    log "Project appears complete (P14 DONE detected). Monitor stopping."
    echo "$(date '+%Y-%m-%d %H:%M:%S')|COMPLETE" >> "$STATE/events.log"
    break
  fi
done
