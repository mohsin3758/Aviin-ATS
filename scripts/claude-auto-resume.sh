#!/bin/bash
# ============================================================
# AIrecruit (FinStack Staffing OS) Claude Code Auto-Resume Monitor
# VPS: 187.127.179.128 | Ubuntu 24.04
#
# 24/7 MONITOR: watches the EXISTING `dev` tmux pane (where Claude
# Code is already logged in via OAuth/Pro subscription, CLAUDE.md
# auto-loads every session, and Bypass Permissions mode has already
# been accepted once -- see CLAUDE.md 24/7 OPERATION section) and
# handles three cases without any human input:
#
#   1. Usage/rate limit hit (5-hour OR weekly limit) -> retries
#      "continue" on a backoff loop until the limit clears, then
#      resumes -- no time-parsing needed, works for any message
#      wording/reset format.
#   2. Claude Code process exited to a shell prompt -> restarts it
#      with `claude --continue --dangerously-skip-permissions`
#      (resumes prior conversation + CLAUDE.md context, no
#      permission prompts) and re-sends the autopilot resume prompt.
#   3. Project complete (P14 DONE) -> logs and stops monitoring.
#
# NOTE on tmux send-keys: Claude Code's multi-line input box treats a
# `send-keys "<text>" Enter` as inserting a newline, NOT submitting.
# A SECOND bare `send-keys Enter` is required to actually submit. The
# submit_keys() helper below does this.
#
# Does NOT kill/recreate the `dev` session itself, and does NOT
# override intentional STOP conditions from docs/autopilot.md
# (test-failure-after-3-attempts, blocking error, etc.) -- those
# leave Claude idle-but-not-rate-limited, which this monitor ignores
# by design so a human can review.
#
# Start (in a separate tmux window, survives this SSH session ending):
#   tmux new-window -t dev -n monitor \
#     'bash ~/airecruit/scripts/claude-auto-resume.sh'
# ============================================================
set -uo pipefail

SESSION="dev"
PANE="${SESSION}:0.0"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$REPO_DIR/logs/claude-resume.log"
STATE="$REPO_DIR/state"

mkdir -p "$(dirname "$LOG")" "$STATE"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }
send_keys() { tmux send-keys -t "$PANE" "$1" Enter 2>/dev/null; }
submit_keys() { tmux send-keys -t "$PANE" Enter 2>/dev/null; }
get_pane()  { tmux capture-pane -t "$PANE" -p -S -30 2>/dev/null || echo ""; }

RESUME_PROMPT="Read FINSTACK_MASTER_INDEX.md and CLAUDE.md. Find the phase marked NEXT (or in-progress) and continue from the last incomplete task in autopilot mode (docs/autopilot.md) -- no confirmation needed, proceed autonomously."

LIMIT_PATTERN='usage limit|rate.?limit|limit reached|try again (later|in)|5.?hour limit|weekly limit|out of (usage|extra)'

if ! tmux has-session -t "$SESSION" 2>/dev/null; then
  log "ERROR: tmux session '$SESSION' not found. Start Claude Code there first:"
  log "  tmux new-session -s $SESSION -c $REPO_DIR"
  log "  (inside) claude"
  exit 1
fi

log "=============================================="
log " AIrecruit Auto-Resume Monitor (24/7, monitor-only)"
log " Watching tmux pane: $PANE"
log "=============================================="
log "Checking every 30s for usage limits or exits..."

while true; do
  sleep 30
  pane=$(get_pane)

  if echo "$pane" | grep -qiE "$LIMIT_PATTERN"; then
    log "USAGE/RATE LIMIT detected. Entering retry loop (works for both 5-hour and weekly limits)."
    echo "$(date '+%Y-%m-%d %H:%M:%S')|RATE_LIMITED" >> "$STATE/events.log"

    if echo "$pane" | grep -qiE 'week|7.?day'; then
      RETRY=7200   # weekly-sounding limit -> retry every 2h
    else
      RETRY=900    # 5-hour-style limit -> retry every 15min
    fi

    while true; do
      log "Sleeping ${RETRY}s before retry..."
      sleep "$RETRY"
      send_keys "continue"
      sleep 1
      submit_keys
      sleep 10
      recheck=$(get_pane)
      if echo "$recheck" | grep -qiE "$LIMIT_PATTERN"; then
        log "Still limited, will retry again in ${RETRY}s."
        continue
      else
        log "Limit cleared -- resumed."
        echo "$(date '+%Y-%m-%d %H:%M:%S')|RESUMED" >> "$STATE/events.log"
        break
      fi
    done

  elif echo "$pane" | grep -qE '^\$ |^dev@.*[$#] *$|^# $'; then
    log "Claude Code appears to have exited (shell prompt visible)."
    sleep 5
    recheck=$(get_pane)
    if echo "$recheck" | grep -qE '^\$ |^dev@.*[$#] *$|^# $'; then
      log "Restarting with 'claude --continue --dangerously-skip-permissions'..."
      send_keys "cd $REPO_DIR && claude --continue --dangerously-skip-permissions"
      sleep 6
      send_keys "$RESUME_PROMPT"
      sleep 1
      submit_keys
      echo "$(date '+%Y-%m-%d %H:%M:%S')|AUTO_RESTARTED" >> "$STATE/events.log"
      log "Claude restarted (bypass permissions) and resume prompt sent."
    fi

  elif echo "$pane" | grep -qiE "P14.*DONE|all phases.*done|project.*complete"; then
    log "Project appears complete (P14 DONE detected). Monitor stopping."
    echo "$(date '+%Y-%m-%d %H:%M:%S')|COMPLETE" >> "$STATE/events.log"
    break
  fi
done
