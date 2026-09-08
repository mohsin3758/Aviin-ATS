#!/bin/bash
# Resource monitor + WAHA stuck-session backstop (2026-09-08)
#
# Real incident this guards against: 3 WhatsApp sessions sat stuck in
# SCAN_QR_CODE for days, each keeping a full headless Chromium process
# alive the whole time, driving this VPS's hypervisor CPU-steal into the
# 90%+ range and exhausting Hostinger's burst-CPU reset budget. A real,
# in-app scheduler job (backend/services/waha_health.py, runs every 15
# min) is the primary fix — but if the backend container itself is ever
# unhealthy or down (plausible during exactly this kind of severe CPU
# crunch), only something OUTSIDE any container can still catch it. This
# script is deliberately self-contained: no dependency on the backend,
# the database, or any container being healthy — only curl/python3 and
# WAHA's own REST API on the host's own docker network port (3002).
#
# Run via cron every 5 minutes:
#   */5 * * * * bash ~/airecruit/scripts/resource-monitor.sh >> ~/airecruit/logs/resource-monitor.cron.log 2>&1
#
# Safe to run manually too — every action is logged, nothing here can
# lose real data (a stopped WAHA session just needs a fresh QR scan to
# reconnect, exactly like the manual fix already proven on 2026-09-08).

set -u
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_FILE="$REPO_DIR/logs/resource-monitor.log"
STATE_DIR="/tmp/aviin_waha_watch"
WAHA_KEY="${WAHA_API_KEY:-aviinATS2026secure}"
WAHA_URL="http://localhost:3002"
GRACE_SECONDS=$((45 * 60))   # matches WAHA_STUCK_GRACE_MINUTES default in waha_health.py
HIGH_LOAD_THRESHOLD=$(($(nproc) * 3))

mkdir -p "$REPO_DIR/logs" "$STATE_DIR"
ts() { date -u '+%Y-%m-%d %H:%M:%S UTC'; }

# ── 1. Real resource snapshot, always logged (durable trend history —
#      the actual incident was only ever discovered via Hostinger's own
#      external panel; this gives a local, always-on record too). ──────
LOAD1=$(awk '{print $1}' /proc/loadavg)
# Real bug caught by actually running this, not assumed correct: `iostat
# -c 1 2`'s real output has %steal in column 5 (not 6 — %user/%nice/
# %system/%iowait/%steal/%idle), and pads each of its 2 samples with 2
# blank trailing lines, so a plain `tail -1` grabs an empty line instead
# of the 2nd sample's real data. Scanning for the LAST line that actually
# looks like numeric data sidesteps the blank-line count entirely.
STEAL=$(iostat -c 1 2 2>/dev/null | awk '/^[ \t]*[0-9]+\.[0-9]/{v=$5} END{print v}')
WAHA_CPU=$(docker stats --no-stream --format '{{.Name}} {{.CPUPerc}}' 2>/dev/null | awk '/^aviin_waha /{print $2}')
echo "[$(ts)] load1=${LOAD1} steal=${STEAL:-?}% waha_cpu=${WAHA_CPU:-?}" >> "$LOG_FILE"

# ── 2. WAHA stuck-session backstop — independent re-implementation of
#      the same conservative logic as waha_health.py: never touch a
#      WORKING session, require a real grace period, always log. ───────
SESSIONS_JSON=$(curl -sf --max-time 10 -H "X-Api-Key: $WAHA_KEY" "$WAHA_URL/api/sessions" 2>/dev/null)
if [ -n "$SESSIONS_JSON" ]; then
  # Real bug caught before this ever ran unattended, not after: a
  # heredoc (`<<`) and a piped stdin (`|`) can't both feed the same
  # command — the heredoc wins, silently discarding the piped JSON. The
  # script content and the JSON data need two SEPARATE stdin sources, so
  # the parser is written to a real temp file (no quoting issues at all,
  # unlike a `python3 -c '...'` one-liner nested inside this already-
  # single-quoted-heredoc script) and the JSON is piped into THAT.
  PARSE_PY="$STATE_DIR/_parse_sessions.py"
  cat > "$PARSE_PY" << 'PYEOF'
import json, sys
try:
    for s in json.load(sys.stdin):
        print(f"{s.get('name','')}\t{(s.get('status') or '').upper()}")
except Exception:
    pass
PYEOF
  echo "$SESSIONS_JSON" | python3 "$PARSE_PY" | while IFS=$'\t' read -r NAME STATUS; do
    [ -z "$NAME" ] && continue
    STATE_FILE="$STATE_DIR/$(echo -n "$NAME" | tr -c 'A-Za-z0-9_-' '_')"
    if [ "$STATUS" = "WORKING" ] || [ "$STATUS" = "STOPPED" ]; then
      rm -f "$STATE_FILE"
      continue
    fi
    if [ "$STATUS" = "SCAN_QR_CODE" ] || [ "$STATUS" = "STARTING" ] || [ "$STATUS" = "FAILED" ]; then
      if [ ! -f "$STATE_FILE" ]; then
        date +%s > "$STATE_FILE"
        continue
      fi
      FIRST_SEEN=$(cat "$STATE_FILE" 2>/dev/null || echo 0)
      NOW=$(date +%s)
      ELAPSED=$((NOW - FIRST_SEEN))
      if [ "$ELAPSED" -ge "$GRACE_SECONDS" ]; then
        echo "[$(ts)] BACKSTOP: '$NAME' stuck in $STATUS for $((ELAPSED/60)) min — auto-stopping" >> "$LOG_FILE"
        curl -sf --max-time 10 -X POST -H "X-Api-Key: $WAHA_KEY" "$WAHA_URL/api/sessions/$NAME/stop" >/dev/null 2>&1
        rm -f "$STATE_FILE"
      fi
    fi
  done
else
  echo "[$(ts)] WARNING: could not reach WAHA API for stuck-session check" >> "$LOG_FILE"
fi

# ── 3. Sustained-high-load visibility marker — not an automated fix (no
#      single safe, general remedy for "the box is just genuinely busy"),
#      but makes it impossible to miss in status-check.sh's own output. ─
LOAD1_INT=${LOAD1%.*}
if [ "${LOAD1_INT:-0}" -ge "$HIGH_LOAD_THRESHOLD" ]; then
  echo "[$(ts)] ALERT: sustained high load (load1=${LOAD1}, threshold=${HIGH_LOAD_THRESHOLD}) — investigate: docker stats, ps aux --sort=-%cpu" >> "$LOG_FILE"
fi

# ── 4. Keep the log bounded — durable history without unbounded growth. ─
if [ -f "$LOG_FILE" ] && [ "$(wc -l < "$LOG_FILE")" -gt 20000 ]; then
  tail -n 10000 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
fi
